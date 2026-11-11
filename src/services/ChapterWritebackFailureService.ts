import type { AppData, ChapterCommitBundle, ChapterWritebackFailure, ID, RevisionCommitBundle } from '../shared/types'
import { normalizeChapterWritebackFailure, normalizeChapterWritebackFailures } from '../shared/normalizers/chapterWritebackFailures'
import type { StorageWriteResult } from '../shared/ipc/ipcTypes'
import type { FormalChapterCommitWriter, StorageService } from '../storage/StorageService'
import { draftContentHash } from './DraftDiagnosticBindingService'

type Evidence = Pick<AppData, 'chapterWritebackFailures' | 'chapterCommitBundles' | 'revisionCommitBundles' | 'chapterVersions'>
type FormalBundle = ChapterCommitBundle | RevisionCommitBundle

function sourceIds(bundle: FormalBundle) {
  if ('revisionCommitId' in bundle) return {
    draftId: bundle.generatedDraft?.id ?? bundle.revisionSession?.sourceDraftId ?? undefined,
    jobId: bundle.generatedDraft?.jobId ?? bundle.generationRunTrace?.jobId,
    revisionSessionId: bundle.revisionSessionId ?? bundle.revisionSession?.id ?? undefined,
    revisionVersionId: bundle.revisionVersionId ?? bundle.revisionVersion?.id ?? undefined
  }
  return {
    draftId: bundle.generatedDraftId ?? bundle.generatedDraft?.id, jobId: bundle.jobId ?? bundle.generatedDraft?.jobId,
    revisionSessionId: undefined, revisionVersionId: undefined
  }
}

function intentFingerprint(bundle: FormalBundle): string | undefined {
  const version = bundle.chapterVersion
  if (!version || typeof bundle.chapter?.body !== 'string' || version.body !== bundle.chapter.body) return
  const target = [bundle.chapter.title, bundle.chapter.body]
  let intent: unknown[]
  if ('revisionCommitId' in bundle) {
    if (typeof bundle.beforeText !== 'string' || bundle.afterText !== version.body) return
    const candidate = sourceIds(bundle).revisionVersionId
    // A restore writes the historical title/body. Its source ID may be reassigned by a project import.
    const operation = /^Restore chapter version .+$/.test(bundle.revisionReason ?? '')
      ? ['restore', bundle.revisedBy] : ['edit', bundle.revisedBy, bundle.revisionReason ?? '']
    intent = ['revision', bundle.beforeText, target,
      candidate ? 'candidate' : operation]
  } else {
    if (version.source === 'before_accept_draft') return
    const previous = bundle.previousChapterVersion
    // A retry may allocate a new ID for the same automatic before-image, or for a not-yet-created chapter.
    const base = previous ? ['snapshot', previous.title, previous.body] : version.baseChapterVersionId ? 'version' : 'new'
    intent = ['chapter', base, target, bundle.chapter.summary]
  }
  return 'writeback-v1:' + draftContentHash(JSON.stringify(intent))
}

// Real base IDs must follow merge remaps. Generated before-image IDs change on retry and are never compared.
function baseId(bundle: FormalBundle): ID | undefined {
  if ('revisionCommitId' in bundle) return bundle.baseChapterVersionId ?? undefined
  return bundle.previousChapterVersion ? undefined : bundle.chapterVersion?.baseChapterVersionId ?? undefined
}

/** Exact replay or a later, content-bound retry with a real receipt AND its separately stored target version. */
export function unresolvedChapterWritebackFailures(data: Evidence, projectId: ID): ChapterWritebackFailure[] {
  const failures = normalizeChapterWritebackFailures(data.chapterWritebackFailures).filter((row) => row.projectId === projectId)
  if (!failures.length) return []
  const versions = new Map(data.chapterVersions.filter((row) => row?.projectId === projectId).map((row) => [row.id, row]))
  const hashes = new Map<FormalBundle, string | undefined>()
  function settles(failure: ChapterWritebackFailure, receipt: FormalBundle): boolean {
    if (receipt?.projectId !== projectId || receipt.chapter?.projectId !== projectId || receipt.chapter.id !== receipt.chapterId) return false
    const revision = 'revisionCommitId' in receipt
    if (revision !== (failure.kind === 'revision_commit')) return false
    const commitId = revision ? receipt.revisionCommitId : receipt.commitId
    const versionId = revision ? receipt.newChapterVersionId : receipt.chapterVersion?.id
    const sameChapter = receipt.chapterId === failure.chapterId
    const exact = sameChapter && commitId === failure.commitId && versionId === failure.versionId
    const source = sourceIds(receipt)
    for (const key of ['jobId', 'draftId', 'revisionVersionId', 'revisionSessionId'] as const) {
      if (failure[key] && failure[key] !== source[key]) return false
    }
    if (!exact) {
      if (!failure.intentFingerprint || receipt.chapter?.order !== failure.chapterOrder ||
        !(Date.parse(revision ? receipt.revisedAt : receipt.acceptedAt) > Date.parse(failure.attemptedAt))) return false
      if (revision) {
        if (!sameChapter || failure.revisionSessionId !== source.revisionSessionId ||
          failure.revisionVersionId !== source.revisionVersionId ||
          Boolean(failure.revisionVersionId) !== Boolean(failure.revisionSessionId)) return false
      } else {
        if (!failure.jobId || !failure.draftId) return false
        if (!sameChapter && (receipt.previousChapterVersion || receipt.chapterVersion?.baseChapterVersionId)) return false
      }
    }
    const version = versionId && versions.get(versionId)
    if (!version || version.chapterId !== receipt.chapterId || receipt.chapterVersion?.id !== version.id ||
      receipt.chapterVersion.projectId !== projectId || receipt.chapterVersion.chapterId !== version.chapterId ||
      typeof version.body !== 'string' || typeof version.title !== 'string' ||
      version.body !== receipt.chapterVersion.body || version.title !== receipt.chapterVersion.title ||
      version.body !== receipt.chapter?.body || version.title !== receipt.chapter.title) return false
    if ((version.baseChapterVersionId ?? null) !== (receipt.chapterVersion.baseChapterVersionId ?? null) ||
      (revision && (version.baseChapterVersionId ?? null) !== (receipt.baseChapterVersionId ?? null))) return false
    const link = revision ? version.linkedRevisionCommitId : version.linkedChapterCommitId
    if (link && link !== commitId) return false
    if (!exact && (link !== commitId || !(Date.parse(version.createdAt) > Date.parse(failure.attemptedAt)))) return false
    if (!failure.intentFingerprint) return exact
    if (failure.baseChapterVersionId !== baseId(receipt)) return false
    if (!hashes.has(receipt)) hashes.set(receipt, intentFingerprint(receipt))
    return failure.intentFingerprint === hashes.get(receipt)
  }
  return failures.filter((failure) => failure.kind === 'chapter_commit'
    ? !data.chapterCommitBundles.some((row) => settles(failure, row))
    : !data.revisionCommitBundles.some((row) => settles(failure, row)))
}

function failureFor(bundle: FormalBundle, attemptedAt: string): ChapterWritebackFailure | undefined {
  const revision = 'revisionCommitId' in bundle
  const commitId = revision ? bundle.revisionCommitId : bundle.commitId
  const versionId = revision ? bundle.newChapterVersionId : bundle.chapterVersion?.id
  const fingerprint = intentFingerprint(bundle)
  if (!fingerprint) return // A legacy before-image or a missing target is not an intended new version.
  return normalizeChapterWritebackFailure({
    id: crypto.randomUUID(), projectId: bundle.projectId, chapterId: bundle.chapterId, chapterOrder: bundle.chapter.order,
    kind: revision ? 'revision_commit' : 'chapter_commit', commitId, versionId,
    ...sourceIds(bundle), baseChapterVersionId: baseId(bundle), intentFingerprint: fingerprint, attemptedAt
  })
}

/** Scope observation to the formal write only, after preview, authorization and bundle validation. */
export function observeFormalChapterWrites(storage: StorageService, assertCurrent?: () => void): FormalChapterCommitWriter {
  async function observe(bundle: FormalBundle, write: (started: () => void) => Promise<StorageWriteResult>) {
    let attemptedAt: string | undefined
    try {
      return await write(() => { attemptedAt = new Date().toISOString() })
    } catch (error) {
      if (attemptedAt) {
        try {
          assertCurrent?.()
          const failure = failureFor(bundle, attemptedAt)
          if (failure) await storage.recordChapterWritebackFailureIfUncommitted(failure)
        } catch {
          // The independent evidence write can fail too (e.g. disk full). Preserve the original rejection.
        }
      }
      throw error
    }
  }
  return {
    saveChapterCommitBundle: (bundle, revision) =>
      observe(bundle, (started) => storage.saveChapterCommitBundle(bundle, revision, started)),
    saveRevisionCommitBundle: (bundle, revision) =>
      observe(bundle, (started) => storage.saveRevisionCommitBundle(bundle, revision, started))
  }
}
