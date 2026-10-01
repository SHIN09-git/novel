import type { AppData } from '../../shared/types'
import type { AgentRuntimeData } from '../AgentRuntime'
import type { AgentToolHandlerResult } from '../tools/agentToolTypes'
import { createAgentRevisionRequest, editAgentRevisionVersion } from './agentRevisionCandidates'
import { generateAgentRevisionVersion } from './agentRevisionGeneration'
import { applyApprovedAgentRevisionCommit, previewAgentRevisionCommit } from './agentRevisionCommits'

export async function handleRevisionWrite(name: string, args: Record<string, unknown>, data: AppData, runtime: AgentRuntimeData): Promise<AgentToolHandlerResult> {
  switch (name) {
    case 'agent.createRevisionRequest': return { handled: true, payload: await createAgentRevisionRequest(data, args, runtime) }
    case 'agent.generateRevisionVersion': return { handled: true, payload: await generateAgentRevisionVersion(data, args, runtime) }
    case 'agent.editRevisionVersion': return { handled: true, payload: await editAgentRevisionVersion(data, args, runtime) }
    case 'agent.previewRevisionCommit': return { handled: true, payload: await previewAgentRevisionCommit(data, args, runtime) }
    case 'agent.applyApprovedRevisionCommit': return { handled: true, payload: await applyApprovedAgentRevisionCommit(data, args, runtime) }
    default: return { handled: false }
  }
}
