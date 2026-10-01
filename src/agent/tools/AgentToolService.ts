import { loadAgentRuntimeData } from '../AgentRuntime'
import { handleAgentOverviewReadTool } from './agentOverviewReadHandlers'
import { findProjectId, requiredString, stringArg } from './agentToolArguments'
import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { decorateCandidateAuthorization } from './agentCandidateAuthorization'
import { AGENT_TOOL_DEFINITIONS } from './agentToolDefinitions'
import { handleAgentReadTool } from './agentToolReadHandlers'
import type {
  AgentToolCallInput,
  AgentToolCallResult,
  AgentToolDefinition
} from './agentToolTypes'
import { handleAgentWriteTool } from './agentToolWriteHandlers'
import { AgentExecutionControlService } from '../AgentExecutionControlService'

export { AGENT_TOOL_DEFINITIONS } from './agentToolDefinitions'
export type {
  AgentToolCallInput,
  AgentToolCallResult,
  AgentToolDefinition
} from './agentToolTypes'

// Stable CLI/MCP facade. Definitions, argument validation, reads, and writes live
// in separate modules so new tools do not grow another cross-domain monolith.
export class AgentToolService {
  static listTools(): AgentToolDefinition[] {
    return AGENT_TOOL_DEFINITIONS
  }

  static async callTool(input: AgentToolCallInput): Promise<AgentToolCallResult> {
    const args = input.arguments ?? {}
    const overview = await handleAgentOverviewReadTool(input.name, args)
    if (overview) return overview
    const runtime = await loadAgentRuntimeData({
      storagePath: stringArg(args, 'storagePath'),
      userDataPath: stringArg(args, 'userDataPath')
    })

    const authority = new AgentAuthorizationService(runtime.userDataPath)
    const controlReadResult = input.name === 'agent.getProjectAuthorization'
      ? { handled: true as const, payload: { projectId: findProjectId(runtime.data, args),
          grants: runtime.storagePath ? await authority.list(runtime.storagePath, findProjectId(runtime.data, args)) : [] } }
      : input.name === 'agent.getPipelineProgress'
      ? {
          handled: true as const,
          payload: await AgentExecutionControlService.getProgress(
            runtime.data,
            runtime,
            requiredString(args, 'jobId')
          )
        }
      : { handled: false as const }
    const readResult = controlReadResult.handled
      ? controlReadResult
      : handleAgentReadTool(input.name, args, runtime.data)
    const result = readResult.handled
      ? readResult
      : await handleAgentWriteTool(input.name, args, runtime.data, runtime)
    if (!result.handled) throw new Error(`Unknown agent tool: ${input.name}`)

    await decorateCandidateAuthorization(input.name, args, result.payload, runtime)

    return {
      tool: input.name,
      ok: true,
      storage: {
        source: runtime.source,
        storagePath: runtime.storagePath,
        userDataPath: runtime.userDataPath,
        revision: runtime.revision
      },
      data: result.payload
    }
  }
}
