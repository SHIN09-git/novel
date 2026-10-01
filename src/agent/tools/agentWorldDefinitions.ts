import type { AgentToolDefinition, JsonSchema } from './agentToolTypes'
import { WORLD_MANAGEMENT_FIELD_HELP } from '../../services/WorldManagementService'

const string = { type: 'string', minLength: 1 }
const common = {
  storagePath: { type: 'string' }, userDataPath: { type: 'string' }, projectId: { type: 'string' }, project: { type: 'string' }
}
const read = {
  detail: { type: 'string', enum: ['summary', 'compact', 'full'], default: 'compact' }, maxChars: { type: 'integer', minimum: 1 }
}
const entity = { type: 'string', enum: ['character', 'character_state', 'foreshadowing', 'timeline_event', 'hard_canon', 'story_direction'] }
const action = { type: 'string', enum: ['create', 'update', 'set_status', 'archive'] }
const source = {
  type: 'object', additionalProperties: false,
  properties: { kind: { type: 'string', enum: ['agent_director'] }, reason: string, agentRunId: string, requestedAt: string },
  required: ['kind', 'reason']
}
const worldAction = {
  entity, action, operationId: string, id: string,
  patch: {
    type: 'object',
    description: 'Use only the selected entity fields in x-worldEditableFieldsByEntity; the service rejects cross-entity fields.',
    'x-worldEditableFieldsByEntity': WORLD_MANAGEMENT_FIELD_HELP
  },
  source,
  expectedFingerprint: string
}
const schema = (properties: JsonSchema, required: string[] = []): JsonSchema => ({
  type: 'object', additionalProperties: false, properties: { ...common, ...properties }, required
})

export const AGENT_WORLD_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: 'agent.getWorldRecords', riskLevel: 'read',
    description: 'Read one project-scoped world collection with stable pagination. Compact is the default; detail=full returns the complete permitted record fields. No reports or inferred canon are generated.',
    inputSchema: schema({ ...read, entity, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, default: 0 }, includeArchived: { type: 'boolean' } }, ['entity'])
  },
  {
    name: 'agent.getWorldRecord', riskLevel: 'read',
    description: 'Read one project-scoped role, state, foreshadowing, timeline event, HardCanon item, or story direction. Compact is the default; request detail=full only when needed.',
    inputSchema: schema({ ...read, entity, id: string }, ['entity', 'id'])
  },
  {
    name: 'agent.getWorldActionReceipt', riskLevel: 'read',
    description: 'Read one persisted world-management receipt by operationId, including the authorized before/after audit snapshot. Compact is the default; request detail=full only when needed.',
    inputSchema: schema({ ...read, operationId: string }, ['operationId'])
  },
  {
    name: 'agent.getWorldActionHistory', riskLevel: 'read',
    description: 'Read project-scoped persisted world-management receipts with stable pagination. Compact output preserves identifiers, enums, fingerprints, and audit links.',
    inputSchema: schema({ ...read, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, default: 0 } })
  },
  {
    name: 'agent.previewWorldAction', riskLevel: 'write_preview',
    description: 'Preview a strict allowlisted world-management action. The source must be an explicit agent_director action; AI detection or review output cannot become canon by itself. Return fingerprint is required for apply.',
    inputSchema: schema(worldAction, ['entity', 'action', 'operationId', 'source'])
  },
  {
    name: 'agent.applyWorldAction', riskLevel: 'write_commit',
    description: 'Apply a previewed world-management action under an active author-issued project-wide edit_world grant. The handler derives the project and omits chapter scope; no caller acknowledgement can authorize a write. Reuse operationId for exact retries; no delete operation exists.',
    inputSchema: schema(worldAction, ['entity', 'action', 'operationId', 'source', 'expectedFingerprint'])
  }
]
