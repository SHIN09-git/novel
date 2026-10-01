import type { ID } from './base'

export type WorldManagedEntity =
  | 'character'
  | 'character_state'
  | 'foreshadowing'
  | 'timeline_event'
  | 'hard_canon'
  | 'story_direction'

export type WorldManagementAction = 'create' | 'update' | 'set_status' | 'archive'

export interface WorldManagementSource {
  kind: 'agent_director'
  reason: string
  /** Optional provenance link for a run-originated action; standalone director edits need no run. */
  agentRunId?: ID
  requestedAt?: string
}

export interface WorldManagementCommand {
  projectId: ID
  entity: WorldManagedEntity
  action: WorldManagementAction
  operationId: ID
  id?: ID
  patch?: Record<string, unknown>
  source: WorldManagementSource
  expectedFingerprint?: string
}

export interface WorldManagementReceipt {
  id: ID
  projectId: ID
  operationId: ID
  commandFingerprint: string
  previewFingerprint: string
  entity: WorldManagedEntity
  action: WorldManagementAction
  targetId: ID
  source: WorldManagementSource
  /** A persisted receipt is created only inside AgentAuthorizationService.withAuthorization. */
  authorizationGrantId: ID
  before: Record<string, unknown> | null
  after: Record<string, unknown>
  createdAt: string
  schemaVersion: 1
}
