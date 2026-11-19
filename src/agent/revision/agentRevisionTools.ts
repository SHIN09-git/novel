import type { AppData } from '../../shared/types'
import type { AgentRuntimeData } from '../AgentRuntime'
import type { AgentToolHandlerResult } from '../tools/agentToolTypes'
import { createAgentRevisionRequest, createManualAgentRevisionVersion, editAgentRevisionVersion } from './agentRevisionCandidates'
import { generateAgentRevisionVersion } from './agentRevisionGeneration'
import { applyApprovedAgentRevisionCommit, previewAgentRevisionCommit } from './agentRevisionCommits'
import { applyAgentRevisionToDraft } from './agentPendingDraftRevision'
import { readAgentChapterWorkItem } from '../tools/agentChapterWorkItem'
import { startAgentBookRevisionBatch } from './agentBookRevisionBatch'
import { reviewAgentRevisionVersion } from './agentRevisionReview'

export async function handleRevisionWrite(name: string, args: Record<string, unknown>, data: AppData, runtime: AgentRuntimeData): Promise<AgentToolHandlerResult> {
  switch (name) {
    case 'agent.startBookRevisionBatch': {
      const batch = await startAgentBookRevisionBatch(runtime, args)
      return { handled: true, payload: { ...batch, workItem: await readAgentChapterWorkItem(runtime, batch) } }
    }
    case 'agent.reviewRevisionVersion': return { handled: true, payload: await reviewAgentRevisionVersion(runtime, args) }
    case 'agent.createRevisionRequest': return { handled: true, payload: await createAgentRevisionRequest(data, args, runtime) }
    case 'agent.generateRevisionVersion': return { handled: true, payload: await generateAgentRevisionVersion(data, args, runtime) }
    case 'agent.createManualRevisionVersion': return { handled: true, payload: await createManualAgentRevisionVersion(data, args, runtime) }
    case 'agent.editRevisionVersion': return { handled: true, payload: await editAgentRevisionVersion(data, args, runtime) }
    case 'agent.previewRevisionCommit': return { handled: true, payload: await previewAgentRevisionCommit(data, args, runtime) }
    case 'agent.applyApprovedRevisionCommit': {
      const result = await applyApprovedAgentRevisionCommit(data, args, runtime)
      const run = runtime.data.agentRuns.find(item => item.id === result.preview.agentRunId && item.projectId === result.preview.projectId)
      return { handled: true, payload: run?.mode === 'book_revision' ? {
        ...result, workItem: await readAgentChapterWorkItem(runtime, { projectId: run.projectId, agentRunId: run.id })
      } : result }
    }
    case 'agent.applyRevisionToDraft': {
      const saved = await applyAgentRevisionToDraft(runtime, args)
      return { handled: true, payload: { ...saved,
        workItem: await readAgentChapterWorkItem(runtime, { projectId: saved.projectId, agentRunId: saved.agentRunId })
      } }
    }
    default: return { handled: false }
  }
}
