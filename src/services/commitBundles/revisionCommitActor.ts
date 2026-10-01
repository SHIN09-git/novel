import type { AppData, RevisionCommitBundle } from '../../shared/types'
import { requireCommitText } from './commitBundleUtils'

export function validateRevisionCommitActor(bundle: RevisionCommitBundle): void {
  if (!['user', 'ai', 'user_with_ai', 'agent'].includes(bundle.revisedBy)) {
    throw new Error('RevisionCommitBundle revisedBy is invalid.')
  }
  if (bundle.revisedBy === 'agent') {
    if (bundle.actor?.kind !== 'agent') throw new Error('Agent revision requires its actor binding.')
    requireCommitText(bundle.actor.agentRunId, 'Agent revision requires agentRunId.')
    requireCommitText(bundle.actor.actionPreviewId, 'Agent revision requires actionPreviewId.')
    if (bundle.chapterVersion?.source !== 'agent_revision') throw new Error('Agent revision version must identify the Agent decision.')
  } else if (bundle.actor !== undefined) {
    throw new Error('Agent actor cannot be labelled as a user or model-only revision.')
  }
}

// Check live references only for a new write. Historical replay is certified by
// its immutable receipt, even if the original Agent history is no longer present.
export function validateRevisionActorReferences(bundle: RevisionCommitBundle, data: AppData): void {
  const actor = bundle.actor
  if (!actor) return
  const run = data.agentRuns.find((item) => item.id === actor.agentRunId && item.projectId === bundle.projectId)
  const preview = data.agentActionPreviews.find((item) => item.id === actor.actionPreviewId)
  if (!run || !preview || preview.agentRunId !== run.id || preview.projectId !== bundle.projectId ||
    preview.chapterId !== bundle.chapterId || preview.actionType !== 'revision_commit') {
    throw new Error('Agent revision actor references a missing or foreign run/preview.')
  }
}
