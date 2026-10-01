import type { QuickRewriteDraft, QuickRewriteTarget } from '../../../shared/types'
import { composeRewriteResult, type AiRewriteCandidate } from './aiRewriteResultModel'
import type { QuickRewriteDraftStore } from './quickRewriteDraftStore'

export function clearAppliedQuickRewriteDraft(store: QuickRewriteDraftStore | null, target: QuickRewriteTarget, body: string) {
  const draft = store?.read(target)
  if (!draft || !store) return
  try {
    if (composeRewriteResult(restoreQuickRewriteCandidate(draft, ''), draft.sourceBody) === body) store.write(target, null, true)
  } catch { /* Incomplete editing drafts remain recoverable. */ }
}

export function restoreQuickRewriteCandidate(draft: QuickRewriteDraft, context: string): AiRewriteCandidate {
  return { targetKey: draft.targetKind === 'revision_version' ? draft.revisionVersionId : draft.chapterId,
    sourceBody: draft.sourceBody, selection: draft.selection, text: draft.text, scope: draft.scope,
    label: draft.label, usedAI: draft.usedAI, context }
}

export function toQuickRewriteDraft(candidate: AiRewriteCandidate, target: QuickRewriteTarget, previous: QuickRewriteDraft | null): QuickRewriteDraft {
  const timestamp = new Date().toISOString()
  return { id: previous?.id ?? crypto.randomUUID(), projectId: target.projectId, targetKind: target.kind,
    chapterId: target.kind === 'revision_version' ? null : target.targetId,
    revisionVersionId: target.kind === 'revision_version' ? target.targetId : null,
    sourceBody: candidate.sourceBody, selection: candidate.selection, text: candidate.text,
    scope: candidate.scope, label: candidate.label, usedAI: candidate.usedAI,
    createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp }
}
