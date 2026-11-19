import { loadAgentRuntimeData } from '../AgentRuntime'
import { handleAgentOverviewReadTool } from './agentOverviewReadHandlers'
import { isChapterTitleTool, runChapterTitleTool } from './agentChapterTitleTools'
import { stringArg } from './agentToolArguments'
import { decorateCandidateAuthorization } from './agentCandidateAuthorization'
import { AGENT_TOOL_DEFINITIONS } from './agentToolDefinitions'
import { handleAgentRuntimeReadTool } from './agentToolReadHandlers'
import { handleAgentLibraryTool } from './agentLibraryTools'
import type {
  AgentToolCallInput,
  AgentToolCallResult,
  AgentToolDefinition
} from './agentToolTypes'
import { handleAgentWriteTool } from './agentToolWriteHandlers'

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
    if (isChapterTitleTool(input.name)) return runChapterTitleTool(input.name, args)
    const library = await handleAgentLibraryTool(input.name, args)
    if (library) return library
    const overview = await handleAgentOverviewReadTool(input.name, args)
    if (overview) return overview
    const runtime = await loadAgentRuntimeData({
      storagePath: stringArg(args, 'storagePath'),
      userDataPath: stringArg(args, 'userDataPath')
    })

    const readResult = await handleAgentRuntimeReadTool(input.name, args, runtime)
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
