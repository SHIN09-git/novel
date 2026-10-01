export type JsonSchema = Record<string, unknown>

export interface AgentToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchema
  riskLevel: 'read' | 'write_preview' | 'write_commit'
}

export interface AgentToolCallInput {
  name: string
  arguments?: Record<string, unknown>
}

export interface AgentToolCallResult {
  tool: string
  ok: boolean
  storage: {
    source: 'sqlite' | 'json' | 'empty'
    storagePath: string | null
    userDataPath: string | null
    revision: string
  }
  data: unknown
}

export interface AgentToolHandlerResult {
  handled: boolean
  payload?: unknown
}
