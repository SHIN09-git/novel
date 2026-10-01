import type {
  AppData,
  Chapter,
  ChapterCommitBundle,
  ChapterAcceptanceReview,
  ChapterVersion,
  CharacterStateTransaction,
  GeneratedChapterDraft,
  ID
} from '../shared/types'
import { isChapterArchived } from './ChapterLifecycleService'
import {
  normalizeConsistencyReviewReport,
  normalizeQualityGateReport,
  normalizeRedundancyReport
} from '../shared/normalizers/reports'
import { normalizeGenerationRunTrace } from '../shared/normalizers/runTrace'
import {
  consistencyReportMatchesDraft,
  noveltyAuditMatchesDraft,
  qualityReportMatchesDraft,
  redundancyReportMatchesDraft
} from './DraftDiagnosticBindingService'
import { validateChapterCommitBundleData } from './commitBundles/chapterCommitValidation'
import { requireCommitText, upsertCommitEntities, upsertCommitEntity } from './commitBundles/commitBundleUtils'
import { buildChapterAcceptanceReview } from './ChapterAcceptanceReviewService'

export const CHAPTER_COMMIT_BUNDLE_SCHEMA_VERSION = 1

export interface BuildAcceptedDraftCommitBundleInput {
  appData: AppData
  projectId: ID
  draftId: ID
  targetChapterOrder: number
  commitId: ID
  chapterId: ID
  acceptedAt: string
  chapterVersionId?: ID | null
  commitNote?: string
  acceptanceMode?: ChapterAcceptanceReview['mode']
  requireEditorialVerdict?: boolean
}

function normalizeAppliedStateTransactions(bundle: ChapterCommitBundle): CharacterStateTransaction[] {
  return (bundle.appliedCharacterStateTransactions ?? []).map((transaction) => ({
    ...transaction,
    chapterId: transaction.chapterId ?? bundle.chapterId
  }))
}

function findDraft(appData: AppData, draftId: ID): GeneratedChapterDraft {
  const draft = appData.generatedChapterDrafts.find((item) => item.id === draftId)
  if (!draft) throw new Error(`ChapterCommitBundle cannot find draft ${draftId}.`)
  if (draft.status !== 'draft') {
    throw new Error(`ChapterCommitBundle can only accept a draft in draft status; ${draftId} is ${draft.status}.`)
  }
  return draft
}

function matchingChapterVersion(appData: AppData, chapter: Chapter): ChapterVersion | null {
  return (
    [...appData.chapterVersions]
      .filter(
        (version) =>
          version.chapterId === chapter.id &&
          version.projectId === chapter.projectId &&
          version.title === chapter.title &&
          version.body === chapter.body
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
}

function createChapterVersionBeforeCommit(
  chapter: Chapter,
  projectId: ID,
  versionId: ID,
  acceptedAt: string
): ChapterVersion {
  return {
    id: versionId,
    projectId,
    chapterId: chapter.id,
    source: 'before_accept_draft',
    title: chapter.title,
    body: chapter.body,
    note: '接受 AI 草稿覆盖已有章节前自动保存。',
    createdAt: acceptedAt
  }
}

function createAcceptedDraftChapterVersion(input: {
  chapter: Chapter
  draft: GeneratedChapterDraft
  versionId: ID
  commitId: ID
  acceptedAt: string
  baseChapterVersionId: ID | null
  generationRunTraceId: ID | null
  note: string
}): ChapterVersion {
  return {
    id: input.versionId,
    projectId: input.chapter.projectId,
    chapterId: input.chapter.id,
    source: 'generated_draft',
    title: input.draft.title,
    body: input.draft.body,
    note: input.note,
    createdAt: input.acceptedAt,
    linkedChapterCommitId: input.commitId,
    linkedGenerationRunTraceId: input.generationRunTraceId,
    baseChapterVersionId: input.baseChapterVersionId
  }
}

export function buildAcceptedDraftCommitBundle(input: BuildAcceptedDraftCommitBundleInput): ChapterCommitBundle {
  const draft = findDraft(input.appData, input.draftId)
  if (draft.projectId !== input.projectId) {
    throw new Error('ChapterCommitBundle draft projectId does not match projectId.')
  }
  const acceptanceReview = input.acceptanceMode !== undefined
    ? buildChapterAcceptanceReview(input.appData, draft, input.acceptanceMode, input.requireEditorialVerdict)
    : undefined

  const existingChapter = input.appData.chapters.find(
    (chapter) => chapter.projectId === input.projectId && chapter.order === input.targetChapterOrder
  )
  if (existingChapter && isChapterArchived(existingChapter)) {
    throw new Error(`第 ${input.targetChapterOrder} 章已归档，请先恢复该章节再接受草稿。`)
  }
  const chapterId = existingChapter?.id ?? input.chapterId
  requireCommitText(chapterId, 'ChapterCommitBundle requires chapterId.')

  const chapter: Chapter = existingChapter
    ? {
        ...existingChapter,
        title: draft.title,
        body: draft.body,
        summary: draft.summary,
        updatedAt: input.acceptedAt
      }
    : {
        id: chapterId,
        projectId: input.projectId,
        order: input.targetChapterOrder,
        title: draft.title,
        body: draft.body,
        summary: draft.summary,
        newInformation: '',
        characterChanges: '',
        newForeshadowing: '',
        resolvedForeshadowing: '',
        endingHook: '',
        riskWarnings: '',
        includedInStageSummary: false,
        archivedAt: null,
        createdAt: input.acceptedAt,
        updatedAt: input.acceptedAt
      }

  const generatedDraft: GeneratedChapterDraft = {
    ...draft,
    chapterId,
    status: 'accepted',
    updatedAt: input.acceptedAt
  }
  const qualityReports = input.appData.qualityGateReports
    .filter((report) => report.projectId === input.projectId && report.jobId === draft.jobId && qualityReportMatchesDraft(report, draft))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map((report) => normalizeQualityGateReport({ ...report, chapterId, draftId: draft.id }))
  const consistencyReports = input.appData.consistencyReviewReports
    .filter((report) => report.projectId === input.projectId && report.jobId === draft.jobId && consistencyReportMatchesDraft(report, draft))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map((report) => normalizeConsistencyReviewReport({ ...report, chapterId }))
  const redundancyReports = input.appData.redundancyReports
    .filter((report) => report.projectId === input.projectId && redundancyReportMatchesDraft(report, draft))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map((report) => normalizeRedundancyReport({
      ...report,
      chapterId,
      jobId: report.jobId ?? draft.jobId,
      updatedAt: report.updatedAt ?? input.acceptedAt
    }))
  const storedRunTrace =
    input.appData.generationRunTraces.find(
      (trace) => trace.projectId === input.projectId && trace.jobId === draft.jobId
    ) ?? null
  // Match the storage read representation before building an immutable receipt.
  // Runtime traces may omit optional defaults that normalizeAppData fills on load.
  const runTrace = storedRunTrace
    ? normalizeGenerationRunTrace({
        ...storedRunTrace,
        qualityGateReportId: qualityReports[0]?.id ?? null,
        consistencyReviewReportId: consistencyReports[0]?.id ?? null,
        redundancyReportId: redundancyReports[0]?.id ?? null,
        noveltyAuditResult: noveltyAuditMatchesDraft(storedRunTrace.noveltyAuditResult, draft)
          ? storedRunTrace.noveltyAuditResult
          : null,
        updatedAt: input.acceptedAt
      })
    : null
  const chapterVersionId = input.chapterVersionId ?? `${input.commitId}:version`
  const matchingBaseVersion = existingChapter ? matchingChapterVersion(input.appData, existingChapter) : null
  const previousChapterVersion =
    existingChapter && !matchingBaseVersion
      ? createChapterVersionBeforeCommit(
          existingChapter,
          input.projectId,
          `${chapterVersionId}:before`,
          input.acceptedAt
        )
      : undefined
  const chapterVersion = createAcceptedDraftChapterVersion({
    chapter,
    draft,
    versionId: chapterVersionId,
    commitId: input.commitId,
    acceptedAt: input.acceptedAt,
    baseChapterVersionId: matchingBaseVersion?.id ?? previousChapterVersion?.id ?? null,
    generationRunTraceId: runTrace?.id ?? null,
    note: input.commitNote || '接受 AI 草稿为正式章节。'
  })

  return {
    schemaVersion: CHAPTER_COMMIT_BUNDLE_SCHEMA_VERSION,
    id: input.commitId,
    commitId: input.commitId,
    projectId: input.projectId,
    chapterId,
    jobId: draft.jobId,
    generatedDraftId: draft.id,
    acceptedAt: input.acceptedAt,
    acceptedBy: 'user',
    ...(acceptanceReview ? { acceptanceReview } : {}),
    chapter,
    chapterVersion,
    previousChapterVersion,
    generatedDraft,
    acceptedMemoryUpdateCandidates: [],
    acceptedCharacterStateChangeCandidates: [],
    appliedCharacterStateFacts: [],
    appliedCharacterStateTransactions: [],
    appliedForeshadowingUpdates: [],
    appliedTimelineEvents: [],
    qualityGateReportId: qualityReports[0]?.id ?? null,
    consistencyReviewReportId: consistencyReports[0]?.id ?? null,
    generationRunTraceId: runTrace?.id ?? null,
    qualityGateReports: qualityReports,
    consistencyReviewReports: consistencyReports,
    redundancyReports,
    generationRunTrace: runTrace ?? undefined,
    commitNote: input.commitNote ?? ''
  }
}

export function validateChapterCommitBundle(bundle: ChapterCommitBundle, existingData?: AppData): void {
  validateChapterCommitBundleData(bundle, existingData, CHAPTER_COMMIT_BUNDLE_SCHEMA_VERSION)
}

export function applyChapterCommitBundleToAppData(appData: AppData, bundle: ChapterCommitBundle): AppData {
  validateChapterCommitBundle(bundle, appData)
  const existingCommit = appData.chapterCommitBundles.find(
    (commit) => commit.commitId === bundle.commitId || commit.id === bundle.id
  )
  // A transport retry may replay an already committed bundle after a newer
  // revision has been applied. Immutable validation above proves that this is
  // the same commit; returning current state prevents the old chapter snapshot
  // from overwriting later work.
  if (existingCommit) return appData

  const appliedCharacterStateTransactions = normalizeAppliedStateTransactions(bundle)
  const generatedDrafts = bundle.generatedDraft
    ? upsertCommitEntity(appData.generatedChapterDrafts, bundle.generatedDraft)
    : appData.generatedChapterDrafts.map((draft) =>
        draft.id === bundle.generatedDraftId
          ? { ...draft, chapterId: bundle.chapterId, status: 'accepted' as const, updatedAt: bundle.acceptedAt }
          : draft
      )

  return {
    ...appData,
    projects: appData.projects.map((project) =>
      project.id === bundle.projectId ? { ...project, updatedAt: bundle.acceptedAt } : project
    ),
    chapters: upsertCommitEntity(appData.chapters, bundle.chapter),
    chapterVersions: upsertCommitEntities(
      appData.chapterVersions,
      [bundle.previousChapterVersion, bundle.chapterVersion].filter((item): item is ChapterVersion => Boolean(item))
    ),
    generatedChapterDrafts: generatedDrafts,
    qualityGateReports: upsertCommitEntities(appData.qualityGateReports, bundle.qualityGateReports),
    consistencyReviewReports: upsertCommitEntities(appData.consistencyReviewReports, bundle.consistencyReviewReports),
    redundancyReports: upsertCommitEntities(appData.redundancyReports, bundle.redundancyReports),
    memoryUpdateCandidates: upsertCommitEntities(appData.memoryUpdateCandidates, bundle.acceptedMemoryUpdateCandidates),
    characterStateChangeCandidates: upsertCommitEntities(
      appData.characterStateChangeCandidates,
      bundle.acceptedCharacterStateChangeCandidates
    ),
    characterStateFacts: upsertCommitEntities(appData.characterStateFacts, bundle.appliedCharacterStateFacts),
    characterStateTransactions: upsertCommitEntities(
      appData.characterStateTransactions,
      appliedCharacterStateTransactions
    ),
    foreshadowings: upsertCommitEntities(appData.foreshadowings, bundle.appliedForeshadowingUpdates),
    timelineEvents: upsertCommitEntities(appData.timelineEvents, bundle.appliedTimelineEvents),
    generationRunTraces: bundle.generationRunTrace
      ? upsertCommitEntity(appData.generationRunTraces, bundle.generationRunTrace)
      : appData.generationRunTraces,
    chapterCommitBundles: upsertCommitEntity(appData.chapterCommitBundles, bundle)
  }
}
