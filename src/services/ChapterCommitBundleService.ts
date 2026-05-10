import type {
  AppData,
  Chapter,
  ChapterCommitBundle,
  ChapterVersion,
  GeneratedChapterDraft,
  ID
} from '../shared/types'

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
}

function upsertById<T extends { id: ID }>(items: T[], item: T): T[] {
  const exists = items.some((current) => current.id === item.id)
  return exists ? items.map((current) => (current.id === item.id ? item : current)) : [item, ...items]
}

function upsertManyById<T extends { id: ID }>(items: T[], nextItems: T[] = []): T[] {
  return nextItems.reduce((next, item) => upsertById(next, item), items)
}

function requireText(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
}

function findDraft(appData: AppData, draftId: ID): GeneratedChapterDraft {
  const draft = appData.generatedChapterDrafts.find((item) => item.id === draftId)
  if (!draft) throw new Error(`ChapterCommitBundle cannot find draft ${draftId}.`)
  return draft
}

function createChapterVersionBeforeCommit(chapter: Chapter, projectId: ID, versionId: ID, acceptedAt: string): ChapterVersion {
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

export function buildAcceptedDraftCommitBundle(input: BuildAcceptedDraftCommitBundleInput): ChapterCommitBundle {
  const draft = findDraft(input.appData, input.draftId)
  if (draft.projectId !== input.projectId) {
    throw new Error('ChapterCommitBundle draft projectId does not match projectId.')
  }

  const existingChapter = input.appData.chapters.find(
    (chapter) => chapter.projectId === input.projectId && chapter.order === input.targetChapterOrder
  )
  const chapterId = existingChapter?.id ?? input.chapterId
  requireText(chapterId, 'ChapterCommitBundle requires chapterId.')

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
    .filter((report) => report.jobId === draft.jobId)
    .map((report) => ({ ...report, chapterId, draftId: draft.id }))
  const consistencyReports = input.appData.consistencyReviewReports
    .filter((report) => report.jobId === draft.jobId)
    .map((report) => ({ ...report, chapterId }))
  const redundancyReports = input.appData.redundancyReports
    .filter((report) => report.draftId === draft.id)
    .map((report) => ({ ...report, chapterId, jobId: report.jobId ?? draft.jobId, updatedAt: report.updatedAt ?? input.acceptedAt }))
  const runTrace = input.appData.generationRunTraces.find((trace) => trace.jobId === draft.jobId) ?? null

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
    chapter,
    chapterVersion: existingChapter && input.chapterVersionId
      ? createChapterVersionBeforeCommit(existingChapter, input.projectId, input.chapterVersionId, input.acceptedAt)
      : undefined,
    generatedDraft,
    acceptedMemoryUpdateCandidates: [],
    acceptedCharacterStateChangeCandidates: [],
    appliedCharacterStateFacts: [],
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
  if (!bundle || typeof bundle !== 'object') throw new Error('ChapterCommitBundle is required.')
  requireText(bundle.commitId, 'ChapterCommitBundle requires commitId.')
  requireText(bundle.id, 'ChapterCommitBundle requires id.')
  if (bundle.id !== bundle.commitId) throw new Error('ChapterCommitBundle id must match commitId.')
  requireText(bundle.projectId, 'ChapterCommitBundle requires projectId.')
  requireText(bundle.chapterId, 'ChapterCommitBundle requires chapterId.')
  requireText(bundle.acceptedAt, 'ChapterCommitBundle requires acceptedAt.')
  if (bundle.acceptedBy !== 'user') throw new Error('ChapterCommitBundle acceptedBy must be user.')
  if (bundle.schemaVersion !== CHAPTER_COMMIT_BUNDLE_SCHEMA_VERSION) {
    throw new Error(`Unsupported ChapterCommitBundle schemaVersion: ${bundle.schemaVersion}.`)
  }
  if (!bundle.chapter || bundle.chapter.id !== bundle.chapterId) throw new Error('ChapterCommitBundle chapter id mismatch.')
  if (bundle.chapter.projectId !== bundle.projectId) throw new Error('ChapterCommitBundle chapter projectId mismatch.')

  if (bundle.generatedDraft) {
    if (bundle.generatedDraftId && bundle.generatedDraft.id !== bundle.generatedDraftId) {
      throw new Error('ChapterCommitBundle generatedDraftId mismatch.')
    }
    if (bundle.generatedDraft.projectId !== bundle.projectId) throw new Error('ChapterCommitBundle draft projectId mismatch.')
    if (bundle.jobId && bundle.generatedDraft.jobId !== bundle.jobId) throw new Error('ChapterCommitBundle draft jobId mismatch.')
    if (bundle.generatedDraft.chapterId !== bundle.chapterId) throw new Error('ChapterCommitBundle draft chapterId mismatch.')
  }

  if (bundle.chapterVersion) {
    if (bundle.chapterVersion.projectId !== bundle.projectId) throw new Error('ChapterCommitBundle chapterVersion projectId mismatch.')
    if (bundle.chapterVersion.chapterId !== bundle.chapterId) throw new Error('ChapterCommitBundle chapterVersion chapterId mismatch.')
  }

  for (const report of bundle.qualityGateReports ?? []) {
    if (report.projectId !== bundle.projectId) throw new Error(`QualityGateReport ${report.id} projectId mismatch.`)
    if (bundle.jobId && report.jobId !== bundle.jobId) throw new Error(`QualityGateReport ${report.id} jobId mismatch.`)
    if (report.chapterId !== bundle.chapterId) throw new Error(`QualityGateReport ${report.id} chapterId mismatch.`)
  }

  for (const report of bundle.consistencyReviewReports ?? []) {
    if (report.projectId !== bundle.projectId) throw new Error(`ConsistencyReviewReport ${report.id} projectId mismatch.`)
    if (bundle.jobId && report.jobId !== bundle.jobId) throw new Error(`ConsistencyReviewReport ${report.id} jobId mismatch.`)
    if (report.chapterId !== bundle.chapterId) throw new Error(`ConsistencyReviewReport ${report.id} chapterId mismatch.`)
  }

  for (const report of bundle.redundancyReports ?? []) {
    if (report.projectId !== bundle.projectId) throw new Error(`RedundancyReport ${report.id} projectId mismatch.`)
    if (report.chapterId !== bundle.chapterId) throw new Error(`RedundancyReport ${report.id} chapterId mismatch.`)
  }

  if (bundle.generatedDraftId) {
    const draftExists =
      bundle.generatedDraft?.id === bundle.generatedDraftId ||
      Boolean(existingData?.generatedChapterDrafts.some((draft) => draft.id === bundle.generatedDraftId))
    if (!draftExists) throw new Error(`ChapterCommitBundle references missing generatedDraftId ${bundle.generatedDraftId}.`)
  }
}

export function applyChapterCommitBundleToAppData(appData: AppData, bundle: ChapterCommitBundle): AppData {
  validateChapterCommitBundle(bundle, appData)

  const generatedDrafts = bundle.generatedDraft
    ? upsertById(appData.generatedChapterDrafts, bundle.generatedDraft)
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
    chapters: upsertById(appData.chapters, bundle.chapter),
    chapterVersions: bundle.chapterVersion ? upsertById(appData.chapterVersions, bundle.chapterVersion) : appData.chapterVersions,
    generatedChapterDrafts: generatedDrafts,
    qualityGateReports: upsertManyById(appData.qualityGateReports, bundle.qualityGateReports),
    consistencyReviewReports: upsertManyById(appData.consistencyReviewReports, bundle.consistencyReviewReports),
    redundancyReports: upsertManyById(appData.redundancyReports, bundle.redundancyReports),
    memoryUpdateCandidates: upsertManyById(appData.memoryUpdateCandidates, bundle.acceptedMemoryUpdateCandidates),
    characterStateChangeCandidates: upsertManyById(appData.characterStateChangeCandidates, bundle.acceptedCharacterStateChangeCandidates),
    characterStateFacts: upsertManyById(appData.characterStateFacts, bundle.appliedCharacterStateFacts),
    foreshadowings: upsertManyById(appData.foreshadowings, bundle.appliedForeshadowingUpdates),
    timelineEvents: upsertManyById(appData.timelineEvents, bundle.appliedTimelineEvents),
    generationRunTraces: bundle.generationRunTrace ? upsertById(appData.generationRunTraces, bundle.generationRunTrace) : appData.generationRunTraces,
    chapterCommitBundles: upsertById(appData.chapterCommitBundles, bundle)
  }
}
