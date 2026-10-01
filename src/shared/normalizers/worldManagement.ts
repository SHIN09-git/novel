import type { WorldManagementReceipt } from '../types/worldManagement'
import { arrayOrEmpty, objectOrEmpty, stringValue } from './common'

const entities = new Set(['character', 'character_state', 'foreshadowing', 'timeline_event', 'hard_canon', 'story_direction'])
const actions = new Set(['create', 'update', 'set_status', 'archive'])

function validTimestamp(value: string): boolean {
  return Boolean(value) && Number.isFinite(Date.parse(value))
}

export function normalizeWorldManagementReceipts(value: unknown): WorldManagementReceipt[] {
  return arrayOrEmpty<unknown>(value).flatMap((item) => {
    const raw = objectOrEmpty(item)
    const source = objectOrEmpty(raw.source)
    const id = stringValue(raw.id)
    const projectId = stringValue(raw.projectId)
    const operationId = stringValue(raw.operationId)
    const commandFingerprint = stringValue(raw.commandFingerprint)
    const previewFingerprint = stringValue(raw.previewFingerprint)
    const entity = stringValue(raw.entity)
    const action = stringValue(raw.action)
    const targetId = stringValue(raw.targetId)
    const authorizationGrantId = stringValue(raw.authorizationGrantId)
    const reason = stringValue(source.reason)
    const createdAt = stringValue(raw.createdAt)
    if (!id || !projectId || !operationId || !commandFingerprint || !previewFingerprint || !targetId || !authorizationGrantId ||
      !reason || !validTimestamp(createdAt) || source.kind !== 'agent_director' ||
      !entities.has(entity) || !actions.has(action) || raw.schemaVersion !== 1 ||
      !raw.after || typeof raw.after !== 'object' || Array.isArray(raw.after)) return []
    const requestedAt = stringValue(source.requestedAt)
    return [{
      id, projectId, operationId, commandFingerprint, previewFingerprint,
      entity: entity as WorldManagementReceipt['entity'], action: action as WorldManagementReceipt['action'], targetId,
      source: {
        kind: 'agent_director', reason,
        ...(stringValue(source.agentRunId) ? { agentRunId: stringValue(source.agentRunId) } : {}),
        ...(requestedAt && validTimestamp(requestedAt) ? { requestedAt } : {})
      },
      authorizationGrantId,
      before: raw.before && typeof raw.before === 'object' && !Array.isArray(raw.before) ? raw.before as Record<string, unknown> : null,
      after: raw.after as Record<string, unknown>, createdAt, schemaVersion: 1
    }]
  })
}
