import type { AppData, RevisionCommitBundle } from '../../shared/types'
import { canAcceptRevisionVersionStatus } from '../../shared/revisionVersionPolicy'
import { assertRevisionSourceRecordsMatch } from '../RevisionSourceBindingService'
import { validateRevisionActorReferences, validateRevisionCommitActor } from './revisionCommitActor'
import {
  assertImmutableCommit,
  assertNoCrossProjectIdCollision,
  assertProjectScope,
  requireCommitText
} from './commitBundleUtils'

function validateCore(bundle: RevisionCommitBundle, schemaVersion: number): void {
  if (!bundle || typeof bundle !== 'object') throw new Error('RevisionCommitBundle is required.')
  requireCommitText(bundle.revisionCommitId, 'RevisionCommitBundle requires revisionCommitId.')
  requireCommitText(bundle.id, 'RevisionCommitBundle requires id.')
  if (bundle.id !== bundle.revisionCommitId) throw new Error('RevisionCommitBundle id must match revisionCommitId.')
  requireCommitText(bundle.projectId, 'RevisionCommitBundle requires projectId.')
  requireCommitText(bundle.chapterId, 'RevisionCommitBundle requires chapterId.')
  requireCommitText(bundle.newChapterVersionId, 'RevisionCommitBundle requires newChapterVersionId.')
  requireCommitText(bundle.revisedAt, 'RevisionCommitBundle requires revisedAt.')
  requireCommitText(bundle.afterText, 'RevisionCommitBundle requires afterText.')
  for (const key of ['revisionVersionId', 'revisionSessionId'] as const) {
    if (bundle[key] !== undefined && bundle[key] !== null) {
      requireCommitText(bundle[key], `RevisionCommitBundle ${key} must be a non-empty id when provided.`)
    }
  }
  validateRevisionCommitActor(bundle)
  if (bundle.schemaVersion !== schemaVersion) {
    throw new Error(`Unsupported RevisionCommitBundle schemaVersion: ${bundle.schemaVersion}.`)
  }
  if (!bundle.chapter || bundle.chapter.id !== bundle.chapterId) {
    throw new Error('RevisionCommitBundle chapter id mismatch.')
  }
  assertProjectScope(bundle.chapter, bundle.projectId, 'Chapter')
  if (bundle.chapter.body !== bundle.afterText) {
    throw new Error('RevisionCommitBundle chapter body must match afterText.')
  }
  if (!bundle.chapterVersion || bundle.chapterVersion.id !== bundle.newChapterVersionId) {
    throw new Error('RevisionCommitBundle chapterVersion id mismatch.')
  }
  assertProjectScope(bundle.chapterVersion, bundle.projectId, 'ChapterVersion')
  if (bundle.chapterVersion.chapterId !== bundle.chapterId) {
    throw new Error('RevisionCommitBundle chapterVersion chapterId mismatch.')
  }
  if (bundle.chapterVersion.body !== bundle.afterText) {
    throw new Error('RevisionCommitBundle chapterVersion body must match afterText.')
  }
  if (
    bundle.chapterVersion.linkedRevisionCommitId &&
    bundle.chapterVersion.linkedRevisionCommitId !== bundle.revisionCommitId
  ) {
    throw new Error('RevisionCommitBundle chapterVersion linkedRevisionCommitId mismatch.')
  }
  if ((bundle.chapterVersion.baseChapterVersionId ?? null) !== (bundle.baseChapterVersionId ?? null)) {
    throw new Error('RevisionCommitBundle chapterVersion baseChapterVersionId mismatch.')
  }
  if ((bundle.chapterVersion.linkedGenerationRunTraceId ?? null) !== (bundle.linkedGenerationRunTraceId ?? null)) {
    throw new Error('RevisionCommitBundle chapterVersion linkedGenerationRunTraceId mismatch.')
  }
  if ((bundle.chapterVersion.linkedChapterCommitId ?? null) !== (bundle.linkedChapterCommitId ?? null)) {
    throw new Error('RevisionCommitBundle chapterVersion linkedChapterCommitId mismatch.')
  }
}

function validateLinkedRecords(bundle: RevisionCommitBundle): void {
  if (bundle.generatedDraft) {
    assertProjectScope(bundle.generatedDraft, bundle.projectId, 'GeneratedChapterDraft')
    if (bundle.generatedDraft.chapterId !== bundle.chapterId) {
      throw new Error('RevisionCommitBundle generatedDraft chapterId mismatch.')
    }
    if (bundle.generatedDraft.body !== bundle.afterText) {
      throw new Error('RevisionCommitBundle generatedDraft body must match afterText.')
    }
  }

  if (bundle.revisionSession) {
    if (bundle.revisionSessionId && bundle.revisionSession.id !== bundle.revisionSessionId) {
      throw new Error('RevisionCommitBundle revisionSession id mismatch.')
    }
    assertProjectScope(bundle.revisionSession, bundle.projectId, 'RevisionSession')
    if (bundle.revisionSession.chapterId !== bundle.chapterId) {
      throw new Error('RevisionCommitBundle revisionSession chapterId mismatch.')
    }
  }

  if (bundle.revisionVersion) {
    if (bundle.revisionVersionId && bundle.revisionVersion.id !== bundle.revisionVersionId) {
      throw new Error('RevisionCommitBundle revisionVersion id mismatch.')
    }
    if (bundle.revisionSessionId && bundle.revisionVersion.sessionId !== bundle.revisionSessionId) {
      throw new Error('RevisionCommitBundle revisionVersion sessionId mismatch.')
    }
    if (bundle.revisionVersion.body !== bundle.afterText) {
      throw new Error('RevisionCommitBundle revisionVersion body must match afterText.')
    }
  }

  if (bundle.generationRunTrace) {
    assertProjectScope(bundle.generationRunTrace, bundle.projectId, 'GenerationRunTrace')
    if (bundle.linkedGenerationRunTraceId && bundle.generationRunTrace.id !== bundle.linkedGenerationRunTraceId) {
      throw new Error('RevisionCommitBundle trace id mismatch.')
    }
    if (bundle.revisionVersionId && bundle.generationRunTrace.acceptedRevisionVersionId !== bundle.revisionVersionId) {
      throw new Error('RevisionCommitBundle trace acceptedRevisionVersionId mismatch.')
    }
    if (bundle.generationRunTrace.targetChapterOrder !== bundle.chapter.order) {
      throw new Error('RevisionCommitBundle trace target chapter order mismatch.')
    }
    if (bundle.generatedDraft && bundle.generationRunTrace.jobId !== bundle.generatedDraft.jobId) {
      throw new Error('RevisionCommitBundle trace jobId does not match generatedDraft.')
    }
  }
}

function validateBaseVersion(bundle: RevisionCommitBundle, existingData: AppData): void {
  if (!bundle.baseChapterVersionId) return
  const baseVersion = existingData.chapterVersions.find((version) => version.id === bundle.baseChapterVersionId)
  if (!baseVersion) {
    throw new Error(`RevisionCommitBundle references missing baseChapterVersionId ${bundle.baseChapterVersionId}.`)
  }
  if (baseVersion.projectId !== bundle.projectId || baseVersion.chapterId !== bundle.chapterId) {
    throw new Error(`Base ChapterVersion ${baseVersion.id} does not match the target chapter.`)
  }
}

function validateCrossProjectCollisions(bundle: RevisionCommitBundle, existingData: AppData): void {
  assertNoCrossProjectIdCollision(existingData.chapters, [bundle.chapter], 'Chapter')
  assertNoCrossProjectIdCollision(existingData.chapterVersions, [bundle.chapterVersion], 'ChapterVersion')
  assertNoCrossProjectIdCollision(
    existingData.generatedChapterDrafts,
    bundle.generatedDraft ? [bundle.generatedDraft] : [],
    'GeneratedChapterDraft'
  )
  assertNoCrossProjectIdCollision(
    existingData.revisionSessions,
    bundle.revisionSession ? [bundle.revisionSession] : [],
    'RevisionSession'
  )
  assertNoCrossProjectIdCollision(
    existingData.generationRunTraces,
    bundle.generationRunTrace ? [bundle.generationRunTrace] : [],
    'GenerationRunTrace'
  )
}

function validateCommitLinks(bundle: RevisionCommitBundle, existingData: AppData): void {
  if (bundle.linkedChapterCommitId) {
    const linkedCommit = existingData.chapterCommitBundles.find(
      (commit) => commit.commitId === bundle.linkedChapterCommitId || commit.id === bundle.linkedChapterCommitId
    )
    if (!linkedCommit) {
      throw new Error(`RevisionCommitBundle references missing linkedChapterCommitId ${bundle.linkedChapterCommitId}.`)
    }
    if (linkedCommit.projectId !== bundle.projectId || linkedCommit.chapterId !== bundle.chapterId) {
      throw new Error(`ChapterCommitBundle ${linkedCommit.commitId} does not match the target chapter.`)
    }
  }

  if (bundle.linkedGenerationRunTraceId) {
    const linkedTrace =
      bundle.generationRunTrace?.id === bundle.linkedGenerationRunTraceId
        ? bundle.generationRunTrace
        : existingData.generationRunTraces.find((trace) => trace.id === bundle.linkedGenerationRunTraceId)
    if (!linkedTrace) {
      throw new Error(
        `RevisionCommitBundle references missing linkedGenerationRunTraceId ${bundle.linkedGenerationRunTraceId}.`
      )
    }
    if (linkedTrace.projectId !== bundle.projectId || linkedTrace.targetChapterOrder !== bundle.chapter.order) {
      throw new Error(`GenerationRunTrace ${linkedTrace.id} does not match the target chapter.`)
    }
    if (bundle.generatedDraft && linkedTrace.jobId !== bundle.generatedDraft.jobId) {
      throw new Error(`GenerationRunTrace ${linkedTrace.id} does not match the generated draft job.`)
    }
  }
}

function validateRevisionRecords(
  bundle: RevisionCommitBundle,
  existingData: AppData
): void {
  if (bundle.generatedDraft) {
    const existingDraft = existingData.generatedChapterDrafts.find((draft) => draft.id === bundle.generatedDraft?.id)
    if (existingDraft?.chapterId && existingDraft.chapterId !== bundle.chapterId) {
      throw new Error(`GeneratedDraft ${existingDraft.id} belongs to another chapter.`)
    }
  }

  const versionId = bundle.revisionVersionId ?? bundle.revisionVersion?.id
  const existingVersion = versionId ? existingData.revisionVersions.find((version) => version.id === versionId) : undefined
  if (versionId) {
    if (!existingVersion) {
      throw new Error(`RevisionCommitBundle references missing revisionVersionId ${versionId}.`)
    }
    if (bundle.revisionSessionId && existingVersion.sessionId !== bundle.revisionSessionId) {
      throw new Error(`RevisionVersion ${existingVersion.id} does not match the revision session.`)
    }
    if (bundle.revisionVersion && bundle.revisionVersion.sessionId !== existingVersion.sessionId) {
      throw new Error(`RevisionVersion ${existingVersion.id} cannot change its source session.`)
    }
    if (!canAcceptRevisionVersionStatus(existingVersion.status)) {
      throw new Error(`Revision version ${existingVersion.id} is already ${existingVersion.status}.`)
    }
    // Source bindings belong to the persisted version, not its submitted copy.
    // Do not allow a successful commit to erase or replace those bindings either.
    for (const field of ['sourceContentHash', 'sourceChapterContentHash'] as const) {
      if (bundle.revisionVersion && existingVersion[field] !== undefined && bundle.revisionVersion[field] !== existingVersion[field]) {
        throw new Error(`RevisionVersion ${existingVersion.id} cannot change or remove ${field}.`)
      }
    }
  }

  const sessionId = existingVersion?.sessionId ?? bundle.revisionSessionId ?? bundle.revisionSession?.id
  if (sessionId) {
    const existingSession = existingData.revisionSessions.find((session) => session.id === sessionId)
    if (!existingSession) {
      throw new Error(`RevisionCommitBundle references missing revisionSessionId ${sessionId}.`)
    }
    if (existingSession.projectId !== bundle.projectId || existingSession.chapterId !== bundle.chapterId) {
      throw new Error(`RevisionSession ${existingSession.id} does not match the target chapter.`)
    }
    if (bundle.revisionSession && (bundle.revisionSession.id !== existingSession.id ||
      bundle.revisionSession.sourceDraftId !== existingSession.sourceDraftId)) {
      throw new Error(`RevisionSession ${existingSession.id} cannot change its source draft.`)
    }
    if (bundle.generatedDraft && bundle.generatedDraft.id !== existingSession.sourceDraftId) {
      throw new Error(`RevisionSession ${existingSession.id} does not match the submitted source draft.`)
    }
    if (existingVersion) {
      const chapter = existingData.chapters.find((item) => item.id === bundle.chapterId && item.projectId === bundle.projectId)!
      assertRevisionSourceRecordsMatch(existingVersion, existingSession, chapter, existingData.generatedChapterDrafts)
    }
  }
}

function validateExistingData(bundle: RevisionCommitBundle, existingData: AppData): void {
  const existingCommit = existingData.revisionCommitBundles.find(
    (commit) => commit.revisionCommitId === bundle.revisionCommitId || commit.id === bundle.id
  )
  assertImmutableCommit(existingCommit, bundle, 'RevisionCommitBundle')
  // A historical receipt certifies the original write; replay must not validate
  // its old source against newer (or removed) manuscript/version records.
  if (existingCommit) return
  validateRevisionActorReferences(bundle, existingData)
  validateBaseVersion(bundle, existingData)
  validateCrossProjectCollisions(bundle, existingData)

  const existingChapter = existingData.chapters.find((chapter) => chapter.id === bundle.chapterId)
  if (!existingChapter) throw new Error(`RevisionCommitBundle references missing chapter ${bundle.chapterId}.`)
  if (existingChapter.projectId !== bundle.projectId) {
    throw new Error('RevisionCommitBundle existing chapter projectId mismatch.')
  }
  // An empty manuscript is still a valid revision baseline; absence is not.
  if (typeof bundle.beforeText !== 'string') {
    throw new Error('RevisionCommitBundle requires beforeText for a new commit.')
  }
  if (bundle.beforeText !== existingChapter.body) {
    throw new Error('RevisionCommitBundle is stale because beforeText no longer matches the current chapter body.')
  }

  const existingChapterVersion = existingData.chapterVersions.find(
    (version) => version.id === bundle.newChapterVersionId
  )
  assertImmutableCommit(existingChapterVersion, bundle.chapterVersion, 'ChapterVersion')
  validateCommitLinks(bundle, existingData)
  validateRevisionRecords(bundle, existingData)
}

export function validateRevisionCommitBundleData(
  bundle: RevisionCommitBundle,
  existingData: AppData | undefined,
  schemaVersion: number
): void {
  validateCore(bundle, schemaVersion)
  validateLinkedRecords(bundle)
  if (existingData) validateExistingData(bundle, existingData)
}
