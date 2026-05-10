import type {
  AppData,
  Chapter,
  ChapterCommitBundle,
  ChapterVersion,
  ConsistencyReviewReport,
  GenerationRunTrace,
  ID,
  QualityGateReport,
  RevisionCommitBundle
} from '../shared/types'
import { buildRevisionCommitBundle } from './RevisionCommitBundleService'

export type ChapterVersionSourceKind =
  | 'current'
  | 'imported'
  | 'generated_draft'
  | 'manual_revision'
  | 'ai_revision'
  | 'user_with_ai_revision'
  | 'restore'
  | 'legacy'
  | 'unknown'

export interface ChapterVersionChainEntry {
  id: ID | string
  chapterId: ID
  title: string
  body: string
  source: string
  sourceKind: ChapterVersionSourceKind
  sourceLabel: string
  createdAt: string
  isCurrent: boolean
  version: ChapterVersion | null
  linkedChapterCommitId: ID | null
  linkedRevisionCommitId: ID | null
  linkedGenerationRunTraceId: ID | null
}

export interface ChapterVersionDetail {
  entry: ChapterVersionChainEntry
  chapterCommitBundle: ChapterCommitBundle | null
  revisionCommitBundle: RevisionCommitBundle | null
  generationRunTrace: GenerationRunTrace | null
  qualityGateReport: QualityGateReport | null
  consistencyReviewReport: ConsistencyReviewReport | null
}

export interface BuildRestoreRevisionCommitBundleInput {
  appData: AppData
  projectId: ID
  chapterId: ID
  sourceVersionId: ID
  revisionCommitId: ID
  newChapterVersionId: ID
  restoredAt: string
  note?: string
}

function byCreatedAtDesc<T extends { createdAt: string }>(a: T, b: T): number {
  return b.createdAt.localeCompare(a.createdAt)
}

function normalizeSource(source: string | null | undefined): string {
  return String(source ?? '').trim().toLowerCase()
}

function versionSourceKind(version: ChapterVersion): ChapterVersionSourceKind {
  const source = normalizeSource(version.source)
  const note = normalizeSource(version.note)
  if (source.includes('generated') || source.includes('accept_draft') || version.linkedChapterCommitId) return 'generated_draft'
  if (source === 'ai_revision') return 'ai_revision'
  if (source === 'user_with_ai_revision' || source.includes('revision_accept')) return 'user_with_ai_revision'
  if (source === 'manual_revision') return note.includes('restore') || note.includes('恢复') ? 'restore' : 'manual_revision'
  if (source.includes('restore')) return 'restore'
  if (source.includes('import')) return 'imported'
  if (source) return 'legacy'
  return 'unknown'
}

export function chapterVersionSourceLabel(kind: ChapterVersionSourceKind, source?: string): string {
  switch (kind) {
    case 'current':
      return '当前正文'
    case 'imported':
      return '导入版本'
    case 'generated_draft':
      return 'AI 草稿采纳'
    case 'manual_revision':
      return '手动修订'
    case 'ai_revision':
      return 'AI 辅助修订'
    case 'user_with_ai_revision':
      return 'AI 辅助修订'
    case 'restore':
      return '历史版本恢复'
    case 'legacy':
      return source || '旧版快照'
    default:
      return source || '未知来源'
  }
}

function toCurrentEntry(chapter: Chapter): ChapterVersionChainEntry {
  return {
    id: `current:${chapter.id}`,
    chapterId: chapter.id,
    title: chapter.title,
    body: chapter.body,
    source: 'current',
    sourceKind: 'current',
    sourceLabel: chapterVersionSourceLabel('current'),
    createdAt: chapter.updatedAt || chapter.createdAt,
    isCurrent: true,
    version: null,
    linkedChapterCommitId: null,
    linkedRevisionCommitId: null,
    linkedGenerationRunTraceId: null
  }
}

function toVersionEntry(version: ChapterVersion, chapter: Chapter): ChapterVersionChainEntry {
  const sourceKind = versionSourceKind(version)
  return {
    id: version.id,
    chapterId: version.chapterId,
    title: version.title || chapter.title,
    body: version.body,
    source: version.source,
    sourceKind,
    sourceLabel: chapterVersionSourceLabel(sourceKind, version.source),
    createdAt: version.createdAt,
    isCurrent: false,
    version,
    linkedChapterCommitId: version.linkedChapterCommitId ?? null,
    linkedRevisionCommitId: version.linkedRevisionCommitId ?? null,
    linkedGenerationRunTraceId: version.linkedGenerationRunTraceId ?? null
  }
}

export function getChapterVersionChain(appData: AppData, chapterId: ID): ChapterVersionChainEntry[] {
  const chapter = appData.chapters.find((item) => item.id === chapterId)
  if (!chapter) return []
  const historicalEntries = appData.chapterVersions
    .filter((version) => version.chapterId === chapterId)
    .sort(byCreatedAtDesc)
    .map((version) => toVersionEntry(version, chapter))
  return [toCurrentEntry(chapter), ...historicalEntries]
}

function findChapterCommit(appData: AppData, entry: ChapterVersionChainEntry): ChapterCommitBundle | null {
  if (entry.linkedChapterCommitId) {
    const direct = appData.chapterCommitBundles.find((commit) => commit.commitId === entry.linkedChapterCommitId || commit.id === entry.linkedChapterCommitId)
    if (direct) return direct
  }
  return appData.chapterCommitBundles.find((commit) => commit.chapterVersion?.id === entry.version?.id) ?? null
}

function findRevisionCommit(appData: AppData, entry: ChapterVersionChainEntry): RevisionCommitBundle | null {
  if (entry.linkedRevisionCommitId) {
    const direct = appData.revisionCommitBundles.find(
      (commit) => commit.revisionCommitId === entry.linkedRevisionCommitId || commit.id === entry.linkedRevisionCommitId
    )
    if (direct) return direct
  }
  return appData.revisionCommitBundles.find((commit) => commit.newChapterVersionId === entry.version?.id) ?? null
}

function findTrace(
  appData: AppData,
  entry: ChapterVersionChainEntry,
  chapterCommit: ChapterCommitBundle | null,
  revisionCommit: RevisionCommitBundle | null
): GenerationRunTrace | null {
  const traceId =
    entry.linkedGenerationRunTraceId ??
    chapterCommit?.generationRunTraceId ??
    revisionCommit?.linkedGenerationRunTraceId ??
    revisionCommit?.generationRunTrace?.id ??
    null
  if (!traceId) return null
  return appData.generationRunTraces.find((trace) => trace.id === traceId) ?? null
}

export function getChapterVersionDetail(appData: AppData, versionId: ID | string): ChapterVersionDetail | null {
  const historicalVersion = appData.chapterVersions.find((version) => version.id === versionId) ?? null
  const chapterId = historicalVersion?.chapterId ?? (String(versionId).startsWith('current:') ? String(versionId).slice('current:'.length) : null)
  if (!chapterId) return null
  const entry = getChapterVersionChain(appData, chapterId).find((item) => item.id === versionId) ?? null
  if (!entry) return null
  const chapterCommitBundle = findChapterCommit(appData, entry)
  const revisionCommitBundle = findRevisionCommit(appData, entry)
  const generationRunTrace = findTrace(appData, entry, chapterCommitBundle, revisionCommitBundle)
  const qualityGateReport =
    (generationRunTrace?.qualityGateReportId
      ? appData.qualityGateReports.find((report) => report.id === generationRunTrace.qualityGateReportId)
      : null) ??
    (chapterCommitBundle?.qualityGateReportId
      ? appData.qualityGateReports.find((report) => report.id === chapterCommitBundle.qualityGateReportId)
      : null) ??
    null
  const consistencyReviewReport =
    (generationRunTrace?.consistencyReviewReportId
      ? appData.consistencyReviewReports.find((report) => report.id === generationRunTrace.consistencyReviewReportId)
      : null) ??
    (chapterCommitBundle?.consistencyReviewReportId
      ? appData.consistencyReviewReports.find((report) => report.id === chapterCommitBundle.consistencyReviewReportId)
      : null) ??
    null
  return {
    entry,
    chapterCommitBundle,
    revisionCommitBundle,
    generationRunTrace,
    qualityGateReport,
    consistencyReviewReport
  }
}

export function buildRestoreRevisionCommitBundle(input: BuildRestoreRevisionCommitBundleInput): RevisionCommitBundle {
  const sourceVersion = input.appData.chapterVersions.find(
    (version) => version.id === input.sourceVersionId && version.chapterId === input.chapterId && version.projectId === input.projectId
  )
  if (!sourceVersion) throw new Error(`Cannot restore missing chapter version ${input.sourceVersionId}.`)
  const chapter = input.appData.chapters.find((item) => item.id === input.chapterId && item.projectId === input.projectId)
  if (!chapter) throw new Error(`Cannot restore version for missing chapter ${input.chapterId}.`)
  if (chapter.body === sourceVersion.body) {
    throw new Error('Selected historical version is already the current chapter body.')
  }

  const bundle = buildRevisionCommitBundle({
    appData: input.appData,
    projectId: input.projectId,
    chapterId: input.chapterId,
    revisionCommitId: input.revisionCommitId,
    newChapterVersionId: input.newChapterVersionId,
    revisedAt: input.restoredAt,
    revisedBy: 'user',
    afterText: sourceVersion.body,
    revisionReason: `Restore chapter version ${sourceVersion.id}`,
    revisionNote: input.note ?? `历史版本恢复：${sourceVersion.title || sourceVersion.id}（${sourceVersion.createdAt}）`
  })
  return {
    ...bundle,
    chapter: { ...bundle.chapter, title: sourceVersion.title || bundle.chapter.title },
    chapterVersion: { ...bundle.chapterVersion, title: sourceVersion.title || bundle.chapterVersion.title }
  }
}
