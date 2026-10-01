import type { AgentToolCallInput } from './agentToolTypes'
import { AGENT_TOOL_DEFINITIONS } from './agentToolDefinitions'

export function buildNamedAgentToolCall(flags: Record<string, string | boolean>): AgentToolCallInput {
  const name = flags.name
  if (typeof name !== 'string' || !AGENT_TOOL_DEFINITIONS.some((tool) => tool.name === name)) {
    throw new Error('Missing or unknown --name; use a registered agent tool name.')
  }
  const raw = flags['arguments-json']
  if (raw !== undefined && typeof raw !== 'string') throw new Error('--arguments-json must be a JSON object.')
  const args: unknown = raw === undefined ? {} : JSON.parse(raw)
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('--arguments-json must be a JSON object.')
  return {
    name,
    arguments: {
      ...args,
      ...(typeof flags.storage === 'string' ? { storagePath: flags.storage } : {}),
      ...(typeof flags['user-data'] === 'string' ? { userDataPath: flags['user-data'] } : {})
    }
  }
}
