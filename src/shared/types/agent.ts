import type { ID } from './base'

export type AgentRunMode = 'single_chapter' | 'multi_chapter' | 'arc'

export type AgentSafetyMode = 'conservative' | 'autonomous' | 'experimental'

export type AgentRunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export type AgentRiskLevel = 'low' | 'medium' | 'high'

export type AgentDecisionAction =
  | 'run_pipeline'
  | 'retry_step'
  | 'revise_draft'
  | 'accept_draft'
  | 'reject_draft'
  | 'accept_memory_candidate'
  | 'reject_memory_candidate'
  | 'propose_hard_canon_candidate'
  | 'continue_next_chapter'
  | 'cancel_run'
  | 'pause_for_human'

export type AgentDecisionResult = 'applied' | 'skipped' | 'failed' | 'pending_human'

export type AgentActionPreviewType =
  | 'chapter_commit'
  | 'revision_commit'
  | 'memory_candidate_batch'
  | 'character_state_candidate_batch'
  | 'foreshadowing_candidate_batch'
  | 'hard_canon_candidate'
  | 'rerun_generation'
  | 'pause_for_human'

export type AgentActionPreviewStatus = 'pending' | 'approved' | 'applied' | 'dismissed'

export interface AgentDecision {
  id: ID
  agentRunId: ID
  projectId: ID
  chapterId?: ID | null
  jobId?: ID | null
  step: string
  action: AgentDecisionAction
  reason: string
  evidence: string[]
  riskLevel: AgentRiskLevel
  result: AgentDecisionResult
  createdAt: string
}

export interface AgentRun {
  id: ID
  projectId: ID
  goal: string
  mode: AgentRunMode
  safetyMode: AgentSafetyMode
  targetChapterOrders: number[]
  status: AgentRunStatus
  createdJobIds: ID[]
  createdDraftIds: ID[]
  createdCommitIds: ID[]
  pendingHumanReviewItemIds: ID[]
  decisions: AgentDecision[]
  summary: string
  warnings: string[]
  startedAt: string
  updatedAt: string
  completedAt?: string | null
  schemaVersion: number
}

export interface AgentActionPreview {
  id: ID
  agentRunId: ID
  projectId: ID
  chapterId?: ID | null
  jobId?: ID | null
  actionType: AgentActionPreviewType
  status: AgentActionPreviewStatus
  summary: string
  riskLevel: AgentRiskLevel
  diffSummary: string[]
  affectedIds: ID[]
  requiresHumanApproval: boolean
  recommendation: 'accept' | 'revise' | 'reject' | 'wait' | 'pause'
  reason: string
  evidence: string[]
  createdAt: string
  updatedAt: string
  schemaVersion: number
}
