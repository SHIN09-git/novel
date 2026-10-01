import type { AgentToolDefinition, JsonSchema } from './agentToolTypes'

const string = { type: 'string', minLength: 1 }
const common = { storagePath: string, userDataPath: string, projectId: string, project: string }
const reading = { detail: { type: 'string', enum: ['summary', 'compact', 'full'], default: 'compact' }, maxChars: { type: 'integer', minimum: 1 } }
const schema = (properties: JsonSchema, required: string[] = []): JsonSchema => ({
  type: 'object', additionalProperties: false, properties: { ...common, ...reading, ...properties }, required
})

export const AGENT_CANDIDATE_UNDO_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: 'agent.getCandidateDecisionHistory', riskLevel: 'read',
    description: 'Read project-scoped candidate decision and undo receipts, newest first. Compact summaries omit field snapshots; detail=full includes redacted before/after values. Legacy or remapped receipts without effects cannot be undone.',
    inputSchema: schema({ receiptId: string, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, default: 0 } })
  },
  {
    name: 'agent.previewCandidateDecisionUndo', riskLevel: 'read',
    description: 'Read a compensating undo preview from current data, including fingerprint, conflicts and project-grant eligibility. No writes. detail=full shows before/after/current field values. Use the returned fingerprint and storage revision for undo.',
    inputSchema: schema({ receiptId: string }, ['receiptId'])
  },
  {
    name: 'agent.undoCandidateDecision', riskLevel: 'write_commit',
    description: 'Undo a previewed candidate decision through the existing transactional command/storage chain as an Agent. Requires confirm=true to acknowledge the exact preview and stable operationId/command fields for retry. High-risk undo also needs an active accept_high_risk_candidates grant; acknowledgement is not authority. Restores only recorded fields and preserves later unrelated edits.',
    inputSchema: schema({
      operationId: { ...string, description: 'Stable ID for this exact undo command; reuse on retry.' }, receiptId: string,
      expectedFingerprint: string, expectedRevision: { ...string, description: 'Storage revision from preview; defaults to current loaded runtime revision.' },
      agentRunId: string, reason: string, decidedAt: { ...string, description: 'Optional fixed timestamp; omitted timestamp reuses a replay receipt time.' },
      confirm: { type: 'boolean' }, restoreChangedFields: { type: 'boolean', description: 'Explicitly restore conflicted fields only when the shared preview allows it. Does not grant high-risk permission.' }
    }, ['operationId', 'receiptId', 'expectedFingerprint', 'reason', 'confirm'])
  }
]
