import type { CandidateDecisionCommand } from '../../shared/types'
import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { candidateDecisionChapterOrders } from '../agentAuthorizationScope'
import type { AgentRuntimeData } from '../AgentRuntime'
import { requiredString } from './agentToolArguments'

interface CandidateAuthorizationPreview {
  requiresConfirmation?: boolean
  projectId: string
  agentCanApply?: boolean
  agentCanUndo?: boolean
  authorization?: string
  authorizationGrantId?: string
  status?: string
  canRestoreConflicts?: boolean
}

// Read-time eligibility is informational; the transactional write rechecks the
// grant and its actual chapter targets while holding the authority lock.
export async function decorateCandidateAuthorization(
  name: string, args: Record<string, unknown>, payload: unknown, runtime: AgentRuntimeData
): Promise<void> {
  if (!runtime.storagePath || !['agent.previewCandidateDecisions', 'agent.previewCandidateDecisionUndo'].includes(name)) return
  const preview = payload as CandidateAuthorizationPreview
  if (!preview.requiresConfirmation) return
  const command = {
    projectId: preview.projectId,
    decisions: (args.decisions ?? []) as CandidateDecisionCommand['decisions'],
    ...(name.endsWith('Undo') ? { undo: { receiptId: requiredString(args, 'receiptId'), expectedFingerprint: '' } } : {})
  }
  const grant = await new AgentAuthorizationService(runtime.userDataPath).findGrant({
    storagePath: runtime.storagePath, projectId: preview.projectId,
    chapterOrders: candidateDecisionChapterOrders(runtime.data, command), actions: ['accept_high_risk_candidates']
  })
  if (!grant) return
  preview.authorization = 'project_grant'
  preview.authorizationGrantId = grant.id
  if ('agentCanApply' in preview) preview.agentCanApply = true
  if ('agentCanUndo' in preview) preview.agentCanUndo = preview.status === 'ready' ||
    (preview.status === 'conflict' && preview.canRestoreConflicts === true)
}
