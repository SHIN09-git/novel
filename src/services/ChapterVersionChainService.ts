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
import { draftContentHash } from './DraftDiagnosticBindingService'

export type ChapterVersionSourceKind =
  | 'current'
  | 'imported'
  | 'generated_draft'
  | 'pre_commit_snapshot'
  | 'pre_revision_snapshot'
  | 'manual_revision'
  | 'ai_revision'
  | 'agent_revision'
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
  if (source === 'before_accept_draft' || source === 'pre_commit_snapshot') return 'pre_commit_snapshot'
  if (source === 'ai_revision') return 'ai_revision'
  if (source === 'agent_revision') return 'agent_revision'
  if (source === 'user_with_ai_revision' || source.includes('revision_accept')) return 'user_with_ai_revision'
  if (source === 'manual_revision') return note.includes('restore') || note.includes('恢复') ? 'restore' : 'manual_revision'
  if (source.includes('restore')) return 'restore'
  if (source.includes('import')) return 'imported'
  if (source.includes('generated') || version.linkedChapterCommitId) return 'generated_draft'
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
    case 'pre_commit_snapshot':
      return '草稿采纳前快照'
    case 'pre_revision_snapshot':
      return '修订前正文'
    case 'manual_revision':
      return '手动修订'
    case 'ai_revision':
      return 'AI 辅助修订'
    case 'agent_revision':
      return 'Agent 采纳修订'
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

function chapterCommitEntryId(commitId: ID): string {
  return `chapter-commit:${commitId}`
}

function toLegacyChapterCommitEntry(commit: ChapterCommitBundle, chapter: Chapter): ChapterVersionChainEntry {
  const version: ChapterVersion = {
    id: chapterCommitEntryId(commit.commitId),
    projectId: commit.projectId,
    chapterId: commit.chapterId,
    source: 'generated_draft',
    title: commit.chapter.title || chapter.title,
    body: commit.chapter.body,
    note: commit.commitNote || '旧版 AI 草稿采纳记录。',
    createdAt: commit.acceptedAt,
    linkedChapterCommitId: commit.commitId,
    linkedGenerationRunTraceId: commit.generationRunTraceId ?? null,
    baseChapterVersionId: commit.chapterVersion?.source === 'before_accept_draft' ? commit.chapterVersion.id : null
  }
  return toVersionEntry(version, chapter)
}

function missingRevisionBaselines(appData: AppData, chapter: Chapter, entries: ChapterVersionChainEntry[]): ChapterVersionChainEntry[] {
  const representedBodies = new Set(entries.map((entry) => entry.body))
  const baselines: ChapterVersionChainEntry[] = []
  for (const commit of [...appData.revisionCommitBundles].sort((a, b) => a.revisedAt.localeCompare(b.revisedAt))) {
    if (commit.projectId !== chapter.projectId || commit.chapterId !== chapter.id ||
      typeof commit.beforeText !== 'string' || !commit.beforeText.trim() || representedBodies.has(commit.beforeText)) continue
    representedBodies.add(commit.beforeText)
    baselines.push({
      id: `revision-before:${commit.revisionCommitId}`, chapterId: chapter.id,
      title: chapter.title, body: commit.beforeText,
      source: 'pre_revision_snapshot', sourceKind: 'pre_revision_snapshot', sourceLabel: '修订前正文',
      createdAt: commit.revisedAt, isCurrent: false, version: null,
      linkedChapterCommitId: null, linkedRevisionCommitId: commit.revisionCommitId,
      linkedGenerationRunTraceId: commit.linkedGenerationRunTraceId ?? null
    })
  }
  return baselines
}

export function getChapterVersionChain(appData: AppData, chapterId: ID): ChapterVersionChainEntry[] {
  const chapter = appData.chapters.find((item) => item.id === chapterId)
  if (!chapter) return []
  const persistedEntries = appData.chapterVersions
    .filter((version) => version.chapterId === chapterId && version.projectId === chapter.projectId)
    .map((version) => toVersionEntry(version, chapter))
  const representedChapterCommitIds = new Set(
    persistedEntries.map((entry) => entry.linkedChapterCommitId).filter((id): id is ID => Boolean(id))
  )
  const legacyCommitEntries = appData.chapterCommitBundles
    .filter(
      (commit) =>
        commit.chapterId === chapterId &&
        commit.projectId === chapter.projectId &&
        !representedChapterCommitIds.has(commit.commitId) &&
        commit.chapter?.body
    )
    .map((commit) => toLegacyChapterCommitEntry(commit, chapter))
  const representedEntries = [...persistedEntries, ...legacyCommitEntries]
  // Older/manual chapters may never have had a ChapterVersion before their first
  // revision. The immutable commit already preserves that text; expose it without a migration.
  const historicalEntries = [...representedEntries, ...missingRevisionBaselines(appData, chapter, representedEntries)].sort(byCreatedAtDesc)
  const currentEntryIndex = historicalEntries.findIndex(
    (entry) => entry.body === chapter.body && entry.title === chapter.title
  )
  if (currentEntryIndex < 0) return [toCurrentEntry(chapter), ...historicalEntries]
  return historicalEntries.map((entry, index) => (index === currentEntryIndex ? { ...entry, isCurrent: true } : entry))
}

function findChapterCommit(appData: AppData, entry: ChapterVersionChainEntry): ChapterCommitBundle | null {
  const projectId = entry.version?.projectId ?? appData.chapters.find((chapter) => chapter.id === entry.chapterId)?.projectId ?? null
  const matchesEntryScope = (commit: ChapterCommitBundle): boolean =>
    commit.chapterId === entry.chapterId && (!projectId || commit.projectId === projectId)
  if (entry.linkedChapterCommitId) {
    const direct = appData.chapterCommitBundles.find(
      (commit) =>
        matchesEntryScope(commit) &&
        (commit.commitId === entry.linkedChapterCommitId || commit.id === entry.linkedChapterCommitId)
    )
    if (direct) return direct
  }
  const versionId = entry.version?.id
  if (!versionId) return null
  return appData.chapterCommitBundles.find(
    (commit) => matchesEntryScope(commit) && commit.chapterVersion?.id === versionId
  ) ?? null
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

type VersionDiagnosticReport = QualityGateReport | ConsistencyReviewReport

function chapterCommitDirectlyProducedEntry(entry: ChapterVersionChainEntry, commit: ChapterCommitBundle): boolean {
  if (commit.chapterId !== entry.chapterId || commit.chapter.body !== entry.body) return false
  if (entry.id === chapterCommitEntryId(commit.commitId)) return true
  if (entry.version?.id && commit.chapterVersion?.id === entry.version.id) return true
  const linkedCommitId = entry.version?.linkedChapterCommitId
  return Boolean(
    entry.sourceKind === 'generated_draft' &&
      linkedCommitId &&
      (linkedCommitId === commit.commitId || linkedCommitId === commit.id)
  )
}

function commitJobId(commit: ChapterCommitBundle): ID | null {
  return commit.jobId ?? commit.generatedDraft?.jobId ?? commit.generationRunTrace?.jobId ?? null
}

function findCommittedReport<T extends VersionDiagnosticReport>(
  reports: T[],
  committedReports: T[] | undefined,
  reportId: ID | null | undefined,
  entry: ChapterVersionChainEntry,
  commit: ChapterCommitBundle | null
): T | null {
  if (!commit || !reportId || !chapterCommitDirectlyProducedEntry(entry, commit)) return null
  const report = committedReports?.find((item) => item.id === reportId) ?? reports.find((item) => item.id === reportId)
  if (
    !report ||
    report.projectId !== commit.projectId ||
    (report.chapterId !== null && report.chapterId !== commit.chapterId)
  ) {
    return null
  }
  const jobId = commitJobId(commit)
  if (jobId && report.jobId !== jobId) return null
  const draftId = commit.generatedDraftId ?? commit.generatedDraft?.id ?? null
  if (draftId && report.draftId && report.draftId !== draftId) return null
  if (report.draftContentHash && report.draftContentHash !== draftContentHash(entry.body)) return null
  return report
}

function findTraceReport<T extends VersionDiagnosticReport>(
  reports: T[],
  reportId: ID | null | undefined,
  entry: ChapterVersionChainEntry,
  chapter: Chapter,
  trace: GenerationRunTrace | null
): T | null {
  if (!trace || !reportId || trace.projectId !== chapter.projectId || !trace.generatedDraftId) return null
  const report = reports.find((item) => item.id === reportId)
  if (
    !report ||
    report.projectId !== chapter.projectId ||
    report.chapterId !== entry.chapterId ||
    report.jobId !== trace.jobId ||
    report.draftId !== trace.generatedDraftId ||
    !report.draftContentHash ||
    report.draftContentHash !== draftContentHash(entry.body)
  ) {
    return null
  }
  return report
}

export function getChapterVersionDetail(appData: AppData, versionId: ID | string): ChapterVersionDetail | null {
  const historicalVersion = appData.chapterVersions.find((version) => version.id === versionId) ?? null
  const legacyCommitId = String(versionId).startsWith('chapter-commit:')
    ? String(versionId).slice('chapter-commit:'.length)
    : null
  const legacyCommit = legacyCommitId
    ? appData.chapterCommitBundles.find((commit) => commit.commitId === legacyCommitId || commit.id === legacyCommitId) ?? null
    : null
  const beforeRevision = String(versionId).startsWith('revision-before:')
    ? appData.revisionCommitBundles.find((commit) => `revision-before:${commit.revisionCommitId}` === versionId)
    : null
  const chapterId =
    historicalVersion?.chapterId ??
    legacyCommit?.chapterId ??
    beforeRevision?.chapterId ??
    (String(versionId).startsWith('current:') ? String(versionId).slice('current:'.length) : null)
  if (!chapterId) return null
  const entry = getChapterVersionChain(appData, chapterId).find((item) => item.id === versionId) ?? null
  if (!entry) return null
  const chapter = appData.chapters.find((item) => item.id === chapterId)
  if (!chapter) return null
  const chapterCommitBundle = findChapterCommit(appData, entry)
  const revisionCommitBundle = findRevisionCommit(appData, entry)
  const generationRunTrace = findTrace(appData, entry, chapterCommitBundle, revisionCommitBundle)
  const qualityGateReport =
    findCommittedReport(
      appData.qualityGateReports,
      chapterCommitBundle?.qualityGateReports,
      chapterCommitBundle?.qualityGateReportId,
      entry,
      chapterCommitBundle
    ) ??
    findTraceReport(appData.qualityGateReports, generationRunTrace?.qualityGateReportId, entry, chapter, generationRunTrace)
  const consistencyReviewReport =
    findCommittedReport(
      appData.consistencyReviewReports,
      chapterCommitBundle?.consistencyReviewReports,
      chapterCommitBundle?.consistencyReviewReportId,
      entry,
      chapterCommitBundle
    ) ??
    findTraceReport(
      appData.consistencyReviewReports,
      generationRunTrace?.consistencyReviewReportId,
      entry,
      chapter,
      generationRunTrace
    )
  return {
    entry,
    chapterCommitBundle,
    revisionCommitBundle,
    generationRunTrace,
    qualityGateReport: beforeRevision ? null : qualityGateReport,
    consistencyReviewReport: beforeRevision ? null : consistencyReviewReport
  }
}

export function getChapterVersionProtectionReason(appData: AppData, versionId: ID | string): string | null {
  const id = String(versionId)
  if (id.startsWith('chapter-commit:')) return 'AI 草稿采纳记录属于正式提交链，不能直接删除。'
  const version = appData.chapterVersions.find((item) => item.id === versionId)
  if (!version) return '该版本不是可删除的本地历史快照。'
  if (version.linkedChapterCommitId || version.linkedRevisionCommitId) {
    return '该版本属于正式提交链，不能直接删除。'
  }
  if (
    appData.chapterCommitBundles.some(
      (commit) => commit.chapterVersion?.id === version.id || commit.previousChapterVersion?.id === version.id
    )
  ) {
    return '该版本被草稿采纳提交引用，不能直接删除。'
  }
  if (
    appData.revisionCommitBundles.some(
      (commit) =>
        commit.newChapterVersionId === version.id ||
        commit.baseChapterVersionId === version.id ||
        commit.chapterVersion?.id === version.id
    ) ||
    appData.chapterVersions.some((item) => item.baseChapterVersionId === version.id)
  ) {
    return '该版本被后续修订链引用，不能直接删除。'
  }
  return null
}

export function buildRestoreRevisionCommitBundle(input: BuildRestoreRevisionCommitBundleInput): RevisionCommitBundle {
  const sourceEntry = getChapterVersionChain(input.appData, input.chapterId).find(
    (entry) => entry.id === input.sourceVersionId && !entry.isCurrent
  )
  if (!sourceEntry) throw new Error(`Cannot restore missing chapter version ${input.sourceVersionId}.`)
  const chapter = input.appData.chapters.find((item) => item.id === input.chapterId && item.projectId === input.projectId)
  if (!chapter) throw new Error(`Cannot restore version for missing chapter ${input.chapterId}.`)
  if (chapter.body === sourceEntry.body) {
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
    afterText: sourceEntry.body,
    revisionReason: `Restore chapter version ${sourceEntry.id}`,
    revisionNote: input.note ?? `历史版本恢复：${sourceEntry.title || sourceEntry.id}（${sourceEntry.createdAt}）`
  })
  return {
    ...bundle,
    chapter: { ...bundle.chapter, title: sourceEntry.title || bundle.chapter.title },
    chapterVersion: { ...bundle.chapterVersion, title: sourceEntry.title || bundle.chapterVersion.title }
  }
}
