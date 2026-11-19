import type { AppData, CharacterStateChangeCandidate, GeneratedChapterDraft, MemoryUpdateCandidate } from '../shared/types'
import type { CandidateDraftSourceStatus } from '../shared/types/candidateDecision'
import { draftContentHash } from './DraftDiagnosticBindingService'
import { CandidateDecisionError } from './candidateDecisionPrimitives'

type Candidate = MemoryUpdateCandidate | CharacterStateChangeCandidate
type Library = Pick<AppData, 'generatedChapterDrafts' | 'chapters'>

export function candidateDraftBinding(draft: Pick<GeneratedChapterDraft, 'id' | 'body'> | null | undefined) {
  return draft ? { sourceDraftId: draft.id, sourceDraftContentHash: draftContentHash(draft.body) } : {}
}

export function readCandidateDraftSource(data: Library, candidate: Candidate): {
  status: CandidateDraftSourceStatus
  chapterId?: string
  draft?: GeneratedChapterDraft
} {
  const { sourceDraftId, sourceDraftContentHash, projectId, jobId } = candidate
  const legacyHash = 'proposedTransaction' in candidate ? candidate.proposedTransaction?.sourceBodyHash : null
  const scopedDrafts = () => data.generatedChapterDrafts.filter(item => item.projectId === projectId && item.jobId === jobId)
  let draft: GeneratedChapterDraft | undefined
  let hash = sourceDraftContentHash
  if (sourceDraftId || hash) {
    draft = scopedDrafts().find(item => item.id === sourceDraftId)
    if (!draft || !hash) return { status: 'stale' }
  } else {
    // Old state extraction kept a hash on its transaction but not always a draft ID.
    // A memory candidate with neither must not be rebound to a different version.
    if (!legacyHash || !jobId) return { status: 'unverified' }
    const drafts = scopedDrafts()
    if (drafts.length !== 1) return { status: 'unverified' }
    draft = drafts[0]
    hash = legacyHash
  }
  if (draft.status === 'rejected' || draftContentHash(draft.body) !== hash) return { status: 'stale', draft }
  if (draft.status !== 'accepted') {
    // A retry can produce a new draft ID without overwriting the older history.
    const replaced = scopedDrafts().some(item => item.id !== draft.id && item.createdAt > draft.createdAt)
    return { status: replaced ? 'stale' : 'current_draft', draft }
  }
  const chapter = data.chapters.find(item => item.id === draft.chapterId && item.projectId === projectId && !item.archivedAt)
  return chapter && draftContentHash(chapter.body) === hash
    ? { status: 'current_chapter', chapterId: chapter.id, draft }
    : { status: 'stale', draft }
}

export const STALE_CANDIDATE_SOURCE = '候选来自已替换、拒绝或缺失的正文。请按当前正文重新提取，或拒绝旧候选。'

export function assertCandidateDraftSource(data: Library, candidate: Candidate): void {
  if (readCandidateDraftSource(data, candidate).status === 'stale') {
    throw new CandidateDecisionError(STALE_CANDIDATE_SOURCE, 'CANDIDATE_SOURCE_STALE')
  }
}
