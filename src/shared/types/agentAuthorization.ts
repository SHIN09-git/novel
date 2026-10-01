export const AGENT_AUTHORIZATION_ACTIONS = [
  'edit_world',
  'accept_high_risk_candidates',
  'accept_unreviewed_draft',
  'accept_draft',
  'apply_revision',
  'manage_chapters',
  'edit_chapter_task'
] as const

export type AgentAuthorizationAction = (typeof AGENT_AUTHORIZATION_ACTIONS)[number]
export type AgentAuthorizationStatus = 'active' | 'revoked'

export const AGENT_GRANT_ACTIONS = AGENT_AUTHORIZATION_ACTIONS
export type AgentGrantAction = AgentAuthorizationAction

export interface AgentAuthorizationGrant {
  id: string
  projectId: string
  storagePath: string
  actions: AgentAuthorizationAction[]
  chapterStart: number | null
  chapterEnd: number | null
  status: AgentAuthorizationStatus
  createdAt: string
  updatedAt: string
  revokedAt: string | null
  grantedBy: 'user'
  source: string
}

export interface AgentAuthorizationGrantInput {
  storagePath: string
  projectId: string
  actions: AgentAuthorizationAction[]
  chapterStart?: number | null
  chapterEnd?: number | null
}

// Local authority must never be included in AppData/imported backups.
export type AgentProjectGrant = AgentAuthorizationGrant
export type AgentProjectGrantInput = AgentAuthorizationGrantInput

export interface AgentAuthorizationRequest {
  storagePath: string
  projectId: string
  actions: readonly AgentGrantAction[]
  chapterOrder?: number | null
  // Combine both forms when supplied. Every order must fit one grant; [] is invalid.
  // No orders (undefined/null) requires a project-wide grant.
  chapterOrders?: readonly number[] | null
}
