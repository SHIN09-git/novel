import type {
  AppData,
  Chapter,
  ChapterVersion,
  GeneratedChapterDraft,
  GenerationRunTrace,
  ID,
  RevisionCommitBundle,
  RevisionSession,
  RevisionVersion
} from '../shared/types'

export const REVISION_COMMIT_BUNDLE_SCHEMA_VERSION = 1

export interface BuildRevisionCommitBundleInput {
  appData: AppData
  projectId: ID
  chapterId: ID
  revisionCommitId: ID
  newChapterVersionId: ID
  revisionSessionId?: ID | null
  revisionVersionId?: ID | null
  revisedAt: string
  revisedBy?: RevisionCommitBundle['revisedBy']
  afterText?: string
  revisionReason?: string
  revisionNote?: string
}

function upsertById<T extends { id: ID }>(items: T[], item: T): T[] {
  const exists = items.some((current) => current.id === item.id)
  return exists ? items.map((current) => (current.id === item.id ? item : current)) : [item, ...items]
}

function requireText(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
}

function latestChapterVersion(appData: AppData, chapterId: ID): ChapterVersion | null {
  return (
    [...appData.chapterVersions]
      .filter((version) => version.chapterId === chapterId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
}

function findRunTraceForRevision(appData: AppData, session: RevisionSession | null): GenerationRunTrace | null {
  if (!session?.sourceDraftId) return null
  const draft = appData.generatedChapterDrafts.find((item) => item.id === session.sourceDraftId)
  if (!draft?.jobId) return null
  return appData.generationRunTraces.find((trace) => trace.jobId === draft.jobId) ?? null
}

function findDraftForRevision(appData: AppData, session: RevisionSession | null): GeneratedChapterDraft | null {
  if (!session?.sourceDraftId) return null
  return appData.generatedChapterDrafts.find((item) => item.id === session.sourceDraftId) ?? null
}

function latestChapterCommitId(appData: AppData, chapterId: ID): ID | null {
  return (
    [...appData.chapterCommitBundles]
      .filter((commit) => commit.chapterId === chapterId)
      .sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt))[0]?.commitId ?? null
  )
}

function appendUnique(values: ID[], nextValue: ID | null | undefined): ID[] {
  if (!nextValue) return values
  return [...new Set([...values, nextValue])]
}

export function buildRevisionCommitBundle(input: BuildRevisionCommitBundleInput): RevisionCommitBundle {
  requireText(input.revisionCommitId, 'RevisionCommitBundle requires revisionCommitId.')
  requireText(input.projectId, 'RevisionCommitBundle requires projectId.')
  requireText(input.chapterId, 'RevisionCommitBundle requires chapterId.')
  requireText(input.newChapterVersionId, 'RevisionCommitBundle requires newChapterVersionId.')
  requireText(input.revisedAt, 'RevisionCommitBundle requires revisedAt.')

  const chapter = input.appData.chapters.find((item) => item.id === input.chapterId && item.projectId === input.projectId)
  if (!chapter) throw new Error(`RevisionCommitBundle cannot find chapter ${input.chapterId}.`)

  const revisionVersion = input.revisionVersionId
    ? input.appData.revisionVersions.find((item) => item.id === input.revisionVersionId) ?? null
    : null
  const revisionSessionId = input.revisionSessionId ?? revisionVersion?.sessionId ?? null
  const revisionSession = revisionSessionId
    ? input.appData.revisionSessions.find((item) => item.id === revisionSessionId) ?? null
    : null
  const afterText = input.afterText ?? revisionVersion?.body ?? ''
  requireText(afterText, 'RevisionCommitBundle requires afterText.')

  const baseVersion = latestChapterVersion(input.appData, chapter.id)
  const linkedTrace = findRunTraceForRevision(input.appData, revisionSession)
  const linkedDraft = findDraftForRevision(input.appData, revisionSession)
  const linkedChapterCommitId = latestChapterCommitId(input.appData, chapter.id)

  const nextChapter: Chapter = {
    ...chapter,
    body: afterText,
    updatedAt: input.revisedAt
  }
  const chapterVersion: ChapterVersion = {
    id: input.newChapterVersionId,
    projectId: input.projectId,
    chapterId: chapter.id,
    source: revisionVersion ? 'ai_revision' : 'manual_revision',
    title: chapter.title,
    body: afterText,
    note: input.revisionNote || `正式修订提交：${revisionVersion?.title ?? input.revisionReason ?? '未命名修订'}`,
    createdAt: input.revisedAt,
    linkedRevisionCommitId: input.revisionCommitId,
    linkedGenerationRunTraceId: linkedTrace?.id ?? null,
    linkedChapterCommitId,
    baseChapterVersionId: baseVersion?.id ?? null
  }

  const nextRevisionVersion = revisionVersion
    ? {
        ...revisionVersion,
        body: afterText,
        status: 'accepted' as const,
        updatedAt: input.revisedAt
      }
    : undefined
  const nextRevisionSession = revisionSession
    ? {
        ...revisionSession,
        status: 'completed' as const,
        updatedAt: input.revisedAt
      }
    : undefined
  const nextRunTrace = linkedTrace
    ? {
        ...linkedTrace,
        revisionSessionIds: appendUnique(linkedTrace.revisionSessionIds ?? [], nextRevisionSession?.id),
        acceptedRevisionVersionId: nextRevisionVersion?.id ?? linkedTrace.acceptedRevisionVersionId,
        updatedAt: input.revisedAt
      }
    : undefined
  const nextGeneratedDraft = linkedDraft
    ? {
        ...linkedDraft,
        body: afterText,
        chapterId: chapter.id,
        status: 'accepted' as const,
        updatedAt: input.revisedAt
      }
    : undefined

  return {
    schemaVersion: REVISION_COMMIT_BUNDLE_SCHEMA_VERSION,
    id: input.revisionCommitId,
    revisionCommitId: input.revisionCommitId,
    projectId: input.projectId,
    chapterId: chapter.id,
    baseChapterVersionId: baseVersion?.id ?? null,
    newChapterVersionId: chapterVersion.id,
    revisionSessionId: nextRevisionSession?.id ?? revisionSessionId,
    revisionVersionId: nextRevisionVersion?.id ?? input.revisionVersionId ?? null,
    revisedAt: input.revisedAt,
    revisedBy: input.revisedBy ?? (revisionVersion ? 'user_with_ai' : 'user'),
    beforeText: chapter.body,
    afterText,
    chapter: nextChapter,
    chapterVersion,
    generatedDraft: nextGeneratedDraft,
    revisionSession: nextRevisionSession,
    revisionVersion: nextRevisionVersion,
    revisionReason: input.revisionReason ?? '',
    revisionNote: input.revisionNote ?? '',
    linkedGenerationRunTraceId: nextRunTrace?.id ?? null,
    linkedChapterCommitId,
    generationRunTrace: nextRunTrace,
    affectedCharacterIds: [],
    affectedForeshadowingIds: [],
    affectedTimelineEventIds: []
  }
}

export function validateRevisionCommitBundle(bundle: RevisionCommitBundle, existingData?: AppData): void {
  if (!bundle || typeof bundle !== 'object') throw new Error('RevisionCommitBundle is required.')
  requireText(bundle.revisionCommitId, 'RevisionCommitBundle requires revisionCommitId.')
  requireText(bundle.id, 'RevisionCommitBundle requires id.')
  if (bundle.id !== bundle.revisionCommitId) throw new Error('RevisionCommitBundle id must match revisionCommitId.')
  requireText(bundle.projectId, 'RevisionCommitBundle requires projectId.')
  requireText(bundle.chapterId, 'RevisionCommitBundle requires chapterId.')
  requireText(bundle.newChapterVersionId, 'RevisionCommitBundle requires newChapterVersionId.')
  requireText(bundle.revisedAt, 'RevisionCommitBundle requires revisedAt.')
  requireText(bundle.afterText, 'RevisionCommitBundle requires afterText.')
  if (!['user', 'ai', 'user_with_ai'].includes(bundle.revisedBy)) {
    throw new Error('RevisionCommitBundle revisedBy is invalid.')
  }
  if (bundle.schemaVersion !== REVISION_COMMIT_BUNDLE_SCHEMA_VERSION) {
    throw new Error(`Unsupported RevisionCommitBundle schemaVersion: ${bundle.schemaVersion}.`)
  }
  if (!bundle.chapter || bundle.chapter.id !== bundle.chapterId) throw new Error('RevisionCommitBundle chapter id mismatch.')
  if (bundle.chapter.projectId !== bundle.projectId) throw new Error('RevisionCommitBundle chapter projectId mismatch.')
  if (bundle.chapter.body !== bundle.afterText) throw new Error('RevisionCommitBundle chapter body must match afterText.')

  if (!bundle.chapterVersion || bundle.chapterVersion.id !== bundle.newChapterVersionId) {
    throw new Error('RevisionCommitBundle chapterVersion id mismatch.')
  }

  if (bundle.generatedDraft) {
    if (bundle.generatedDraft.projectId !== bundle.projectId) throw new Error('RevisionCommitBundle generatedDraft projectId mismatch.')
    if (bundle.generatedDraft.chapterId !== bundle.chapterId) throw new Error('RevisionCommitBundle generatedDraft chapterId mismatch.')
    if (bundle.generatedDraft.body !== bundle.afterText) throw new Error('RevisionCommitBundle generatedDraft body must match afterText.')
  }
  if (bundle.chapterVersion.projectId !== bundle.projectId) throw new Error('RevisionCommitBundle chapterVersion projectId mismatch.')
  if (bundle.chapterVersion.chapterId !== bundle.chapterId) throw new Error('RevisionCommitBundle chapterVersion chapterId mismatch.')
  if (bundle.chapterVersion.body !== bundle.afterText) throw new Error('RevisionCommitBundle chapterVersion body must match afterText.')
  if (bundle.chapterVersion.linkedRevisionCommitId && bundle.chapterVersion.linkedRevisionCommitId !== bundle.revisionCommitId) {
    throw new Error('RevisionCommitBundle chapterVersion linkedRevisionCommitId mismatch.')
  }

  if (bundle.revisionSession) {
    if (bundle.revisionSessionId && bundle.revisionSession.id !== bundle.revisionSessionId) {
      throw new Error('RevisionCommitBundle revisionSession id mismatch.')
    }
    if (bundle.revisionSession.projectId !== bundle.projectId) throw new Error('RevisionCommitBundle revisionSession projectId mismatch.')
    if (bundle.revisionSession.chapterId !== bundle.chapterId) throw new Error('RevisionCommitBundle revisionSession chapterId mismatch.')
  }

  if (bundle.revisionVersion) {
    if (bundle.revisionVersionId && bundle.revisionVersion.id !== bundle.revisionVersionId) {
      throw new Error('RevisionCommitBundle revisionVersion id mismatch.')
    }
    if (bundle.revisionSessionId && bundle.revisionVersion.sessionId !== bundle.revisionSessionId) {
      throw new Error('RevisionCommitBundle revisionVersion sessionId mismatch.')
    }
    if (bundle.revisionVersion.body !== bundle.afterText) throw new Error('RevisionCommitBundle revisionVersion body must match afterText.')
  }

  if (bundle.generationRunTrace) {
    if (bundle.generationRunTrace.projectId !== bundle.projectId) throw new Error('RevisionCommitBundle trace projectId mismatch.')
    if (bundle.linkedGenerationRunTraceId && bundle.generationRunTrace.id !== bundle.linkedGenerationRunTraceId) {
      throw new Error('RevisionCommitBundle trace id mismatch.')
    }
    if (bundle.revisionVersionId && bundle.generationRunTrace.acceptedRevisionVersionId !== bundle.revisionVersionId) {
      throw new Error('RevisionCommitBundle trace acceptedRevisionVersionId mismatch.')
    }
  }

  if (existingData && bundle.baseChapterVersionId) {
    const baseExists = existingData.chapterVersions.some((version) => version.id === bundle.baseChapterVersionId)
    if (!baseExists) throw new Error(`RevisionCommitBundle references missing baseChapterVersionId ${bundle.baseChapterVersionId}.`)
  }
}

export function applyRevisionCommitBundleToAppData(appData: AppData, bundle: RevisionCommitBundle): AppData {
  validateRevisionCommitBundle(bundle, appData)

  let revisionVersions = bundle.revisionVersion
    ? upsertById(appData.revisionVersions, bundle.revisionVersion)
    : appData.revisionVersions
  if (!bundle.revisionVersion && bundle.revisionVersionId) {
    revisionVersions = revisionVersions.map((version) =>
      version.id === bundle.revisionVersionId
        ? { ...version, body: bundle.afterText, status: 'accepted' as const, updatedAt: bundle.revisedAt }
        : version
    )
  }

  let revisionSessions = bundle.revisionSession
    ? upsertById(appData.revisionSessions, bundle.revisionSession)
    : appData.revisionSessions
  if (!bundle.revisionSession && bundle.revisionSessionId) {
    revisionSessions = revisionSessions.map((session) =>
      session.id === bundle.revisionSessionId ? { ...session, status: 'completed' as const, updatedAt: bundle.revisedAt } : session
    )
  }

  return {
    ...appData,
    projects: appData.projects.map((project) =>
      project.id === bundle.projectId ? { ...project, updatedAt: bundle.revisedAt } : project
    ),
    chapters: upsertById(appData.chapters, bundle.chapter),
    chapterVersions: upsertById(appData.chapterVersions, bundle.chapterVersion),
    generatedChapterDrafts: bundle.generatedDraft
      ? upsertById(appData.generatedChapterDrafts, bundle.generatedDraft)
      : appData.generatedChapterDrafts,
    revisionSessions,
    revisionVersions,
    generationRunTraces: bundle.generationRunTrace
      ? upsertById(appData.generationRunTraces, bundle.generationRunTrace)
      : appData.generationRunTraces,
    revisionCommitBundles: upsertById(appData.revisionCommitBundles, bundle)
  }
}
