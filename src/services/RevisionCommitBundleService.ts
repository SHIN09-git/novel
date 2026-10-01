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
import { canAcceptRevisionVersionStatus } from '../shared/revisionVersionPolicy'
import { isChapterArchived } from './ChapterLifecycleService'
import { requireCommitText, upsertCommitEntity } from './commitBundles/commitBundleUtils'
import { validateRevisionCommitBundleData } from './commitBundles/revisionCommitValidation'
import { assertRevisionSourceMatches } from './RevisionSourceBindingService'

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
  actor?: RevisionCommitBundle['actor']
  afterText?: string
  revisionReason?: string
  revisionNote?: string
}

function latestChapterVersion(appData: AppData, projectId: ID, chapterId: ID): ChapterVersion | null {
  return (
    [...appData.chapterVersions]
      .filter((version) => version.projectId === projectId && version.chapterId === chapterId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
}

function findDraftForRevision(
  appData: AppData,
  projectId: ID,
  session: RevisionSession | null
): GeneratedChapterDraft | null {
  if (!session?.sourceDraftId) return null
  return (
    appData.generatedChapterDrafts.find(
      (item) =>
        item.id === session.sourceDraftId &&
        item.projectId === projectId &&
        (!item.chapterId || item.chapterId === session.chapterId)
    ) ?? null
  )
}

function findRunTraceForRevision(
  appData: AppData,
  projectId: ID,
  session: RevisionSession | null
): GenerationRunTrace | null {
  const draft = findDraftForRevision(appData, projectId, session)
  if (!draft?.jobId) return null
  return appData.generationRunTraces.find(
    (trace) => trace.projectId === projectId && trace.jobId === draft.jobId
  ) ?? null
}

function latestChapterCommitId(appData: AppData, projectId: ID, chapterId: ID): ID | null {
  return (
    [...appData.chapterCommitBundles]
      .filter((commit) => commit.projectId === projectId && commit.chapterId === chapterId)
      .sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt))[0]?.commitId ?? null
  )
}

function appendUnique(values: ID[], nextValue: ID | null | undefined): ID[] {
  if (!nextValue) return values
  return [...new Set([...values, nextValue])]
}

function revisionSource(revisedBy: RevisionCommitBundle['revisedBy']): ChapterVersion['source'] {
  if (revisedBy === 'agent') return 'agent_revision'
  if (revisedBy === 'ai') return 'ai_revision'
  if (revisedBy === 'user_with_ai') return 'user_with_ai_revision'
  return 'manual_revision'
}

export function buildRevisionCommitBundle(input: BuildRevisionCommitBundleInput): RevisionCommitBundle {
  requireCommitText(input.revisionCommitId, 'RevisionCommitBundle requires revisionCommitId.')
  requireCommitText(input.projectId, 'RevisionCommitBundle requires projectId.')
  requireCommitText(input.chapterId, 'RevisionCommitBundle requires chapterId.')
  requireCommitText(input.newChapterVersionId, 'RevisionCommitBundle requires newChapterVersionId.')
  requireCommitText(input.revisedAt, 'RevisionCommitBundle requires revisedAt.')

  const chapter = input.appData.chapters.find(
    (item) => item.id === input.chapterId && item.projectId === input.projectId
  )
  if (!chapter) throw new Error(`RevisionCommitBundle cannot find chapter ${input.chapterId}.`)
  if (isChapterArchived(chapter)) {
    throw new Error('归档章节不能直接提交修订，请先恢复该章节。')
  }

  const revisionVersion = input.revisionVersionId
    ? input.appData.revisionVersions.find((item) => item.id === input.revisionVersionId) ?? null
    : null
  if (revisionVersion && !canAcceptRevisionVersionStatus(revisionVersion.status)) {
    throw new Error(`RevisionCommitBundle cannot accept revision version in ${revisionVersion.status} status.`)
  }
  const revisionSessionId = input.revisionSessionId ?? revisionVersion?.sessionId ?? null
  const revisionSession = revisionSessionId
    ? input.appData.revisionSessions.find((item) => item.id === revisionSessionId) ?? null
    : null
  const afterText = input.afterText ?? revisionVersion?.body ?? ''
  requireCommitText(afterText, 'RevisionCommitBundle requires afterText.')

  const baseVersion = latestChapterVersion(input.appData, input.projectId, chapter.id)
  const linkedTrace = findRunTraceForRevision(input.appData, input.projectId, revisionSession)
  const linkedDraft = findDraftForRevision(input.appData, input.projectId, revisionSession)
  if (revisionVersion && (revisionVersion.sourceContentHash !== undefined || revisionVersion.sourceChapterContentHash !== undefined)) {
    if (!revisionSession || revisionSession.id !== revisionVersion.sessionId ||
      revisionSession.projectId !== input.projectId || revisionSession.chapterId !== chapter.id) {
      throw new Error('Revision source session does not match the target chapter.')
    }
    if (revisionVersion.sourceContentHash !== undefined && revisionSession.sourceDraftId && !linkedDraft) {
      throw new Error(`RevisionVersion ${revisionVersion.id} references a missing source draft.`)
    }
    assertRevisionSourceMatches(revisionVersion, linkedDraft?.body ?? chapter.body, chapter.body)
  }
  const linkedChapterCommitId = latestChapterCommitId(input.appData, input.projectId, chapter.id)
  const revisedBy = input.revisedBy ?? (revisionVersion ? 'user_with_ai' : 'user')
  const nextChapter: Chapter = { ...chapter, body: afterText, updatedAt: input.revisedAt }
  const chapterVersion: ChapterVersion = {
    id: input.newChapterVersionId,
    projectId: input.projectId,
    chapterId: chapter.id,
    source: revisionSource(revisedBy),
    title: chapter.title,
    body: afterText,
    note: input.revisionNote || `正式修订提交：${revisionVersion?.title ?? input.revisionReason ?? '未命名修订'}`,
    createdAt: input.revisedAt,
    linkedRevisionCommitId: input.revisionCommitId,
    linkedGenerationRunTraceId: linkedTrace?.id ?? null,
    linkedChapterCommitId,
    baseChapterVersionId: baseVersion?.id ?? null
  }

  const nextRevisionVersion: RevisionVersion | undefined = revisionVersion
    ? { ...revisionVersion, body: afterText, status: 'accepted', updatedAt: input.revisedAt }
    : undefined
  const nextRevisionSession: RevisionSession | undefined = revisionSession
    ? { ...revisionSession, status: 'completed', updatedAt: input.revisedAt }
    : undefined
  const nextRunTrace: GenerationRunTrace | undefined = linkedTrace
    ? {
        ...linkedTrace,
        revisionSessionIds: appendUnique(linkedTrace.revisionSessionIds ?? [], nextRevisionSession?.id),
        acceptedRevisionVersionId: nextRevisionVersion?.id ?? linkedTrace.acceptedRevisionVersionId,
        updatedAt: input.revisedAt
      }
    : undefined
  const nextGeneratedDraft: GeneratedChapterDraft | undefined = linkedDraft
    ? {
        ...linkedDraft,
        body: afterText,
        chapterId: chapter.id,
        status: 'accepted',
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
    revisedBy,
    ...(input.actor ? { actor: { ...input.actor } } : {}),
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
  validateRevisionCommitBundleData(bundle, existingData, REVISION_COMMIT_BUNDLE_SCHEMA_VERSION)
}

export function applyRevisionCommitBundleToAppData(appData: AppData, bundle: RevisionCommitBundle): AppData {
  validateRevisionCommitBundle(bundle, appData)
  const existingCommit = appData.revisionCommitBundles.find(
    (commit) => commit.revisionCommitId === bundle.revisionCommitId || commit.id === bundle.id
  )
  // Idempotent replay must be a no-op, even when a later revision now owns the
  // chapter. Re-applying the old bundle would otherwise roll the manuscript
  // back while leaving the newer version records in place.
  if (existingCommit) return appData

  let revisionVersions = bundle.revisionVersion
    ? upsertCommitEntity(appData.revisionVersions, bundle.revisionVersion)
    : appData.revisionVersions
  if (!bundle.revisionVersion && bundle.revisionVersionId) {
    revisionVersions = revisionVersions.map((version) =>
      version.id === bundle.revisionVersionId
        ? { ...version, body: bundle.afterText, status: 'accepted' as const, updatedAt: bundle.revisedAt }
        : version
    )
  }

  let revisionSessions = bundle.revisionSession
    ? upsertCommitEntity(appData.revisionSessions, bundle.revisionSession)
    : appData.revisionSessions
  if (!bundle.revisionSession && bundle.revisionSessionId) {
    revisionSessions = revisionSessions.map((session) =>
      session.id === bundle.revisionSessionId
        ? { ...session, status: 'completed' as const, updatedAt: bundle.revisedAt }
        : session
    )
  }

  return {
    ...appData,
    projects: appData.projects.map((project) =>
      project.id === bundle.projectId ? { ...project, updatedAt: bundle.revisedAt } : project
    ),
    chapters: upsertCommitEntity(appData.chapters, bundle.chapter),
    chapterVersions: upsertCommitEntity(appData.chapterVersions, bundle.chapterVersion),
    generatedChapterDrafts: bundle.generatedDraft
      ? upsertCommitEntity(appData.generatedChapterDrafts, bundle.generatedDraft)
      : appData.generatedChapterDrafts,
    revisionSessions,
    revisionVersions,
    generationRunTraces: bundle.generationRunTrace
      ? upsertCommitEntity(appData.generationRunTraces, bundle.generationRunTrace)
      : appData.generationRunTraces,
    revisionCommitBundles: upsertCommitEntity(appData.revisionCommitBundles, bundle)
  }
}
