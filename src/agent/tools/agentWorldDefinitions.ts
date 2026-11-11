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
const words = { type: 'array', items: string }
const checkScope = {
  enforcement: { type: 'string', enum: ['block', 'review'] },
  fromChapter: { type: 'integer', minimum: 1 }, toChapter: { type: 'integer', minimum: 1 }
}
const limit = { type: 'integer', minimum: 0 }
const hardCanonCheck = {
  description: 'Explicit author condition for hard_canon only. Omit on create for a writing hint; omit on update to preserve it. Send null on update to remove it. A literal with neither limit forbids occurrences in the chapter; a book-only limit sets no chapter cap.',
  oneOf: [
    {
      type: 'object', additionalProperties: false,
      properties: { kind: { const: 'literal' }, mode: { enum: ['terms', 'latin'] }, terms: words, exceptions: words,
        maxPerChapter: limit, maxPerBook: limit, ...checkScope },
      required: ['kind', 'mode', 'terms', 'enforcement'],
      allOf: [{ if: { properties: { mode: { const: 'terms' } } }, then: { properties: { terms: { minItems: 1 } } } }]
    },
    {
      type: 'object', additionalProperties: false,
      properties: { kind: { const: 'actor_action' }, actor: string, characterId: string, aliases: words,
        actions: { ...words, minItems: 1 }, side: { enum: ['左', '右'] }, objects: words, state: string,
        effect: { enum: ['forbid', 'allow'] }, ...checkScope },
      required: ['kind', 'actor', 'actions', 'effect', 'enforcement']
    },
    { type: 'null' }
  ]
}
const worldAction = {
  entity, action, operationId: string, id: string,
  patch: {
    type: 'object',
    description: 'Use only the selected entity fields in x-worldEditableFieldsByEntity. For hard_canon use title, content and optional check. Exact create duplicates reuse the original unchanged; hardCanonDuplicates.possible is advisory.',
    additionalProperties: true,
    properties: { title: string, content: string, check: hardCanonCheck,
      startChapterOrder: { type: 'integer', minimum: 1, description: 'story_direction: first covered chapter (inclusive).' },
      endChapterOrder: { type: 'integer', minimum: 1, description: 'story_direction: last covered chapter (inclusive); determines length together with startChapterOrder.' },
      horizonChapters: { type: 'integer', minimum: 1, maximum: WORLD_MANAGEMENT_FIELD_HELP.story_direction.range.maxChapters,
        description: 'story_direction: optional legacy length. Prefer startChapterOrder and endChapterOrder.' } },
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
    description: 'Read one project-scoped world record. For a character, cardReview summarizes human review and confirmed facts. detail=full adds short evidence excerpts and chapter locators. Reads do not mark cards reviewed.',
    inputSchema: schema({ ...read, entity, id: string, asOfChapterOrder: { type: 'integer', minimum: 1,
      description: 'Character only: inclusive cutoff for cardReview, not a historical reconstruction of the editable profile.' } }, ['entity', 'id'])
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
