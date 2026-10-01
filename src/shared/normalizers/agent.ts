import type {
  AgentActionPreview,
  AgentActionPreviewStatus,
  AgentActionPreviewType,
  AgentDecision,
  AgentDecisionAction,
  AgentDecisionResult,
  AgentRiskLevel,
  AgentRun,
  AgentRunMode,
  AgentRunStatus,
  AgentSafetyMode
} from '../types'
import { arrayOrEmpty, objectOrEmpty, stringArrayValue, stringValue } from './common'

function normalizeRunMode(value: unknown): AgentRunMode {
  return value === 'multi_chapter' || value === 'arc' ? value : 'single_chapter'
}

function normalizeSafetyMode(value: unknown): AgentSafetyMode {
  return value === 'autonomous' || value === 'experimental' ? value : 'conservative'
}

function normalizeRunStatus(value: unknown): AgentRunStatus {
  if (value === 'paused' || value === 'completed' || value === 'failed' || value === 'cancelled') return value
  return 'running'
}

function normalizeRiskLevel(value: unknown): AgentRiskLevel {
  if (value === 'medium' || value === 'high') return value
  return 'low'
}

function normalizeDecisionAction(value: unknown): AgentDecisionAction {
  const allowed: AgentDecisionAction[] = [
    'run_pipeline',
    'retry_step',
    'revise_draft',
    'accept_draft',
    'reject_draft',
    'accept_memory_candidate',
    'reject_memory_candidate',
    'propose_hard_canon_candidate',
    'continue_next_chapter',
    'pause_for_human'
  ]
  return allowed.includes(value as AgentDecisionAction) ? (value as AgentDecisionAction) : 'pause_for_human'
}

function normalizeDecisionResult(value: unknown): AgentDecisionResult {
  if (value === 'skipped' || value === 'failed' || value === 'pending_human') return value
  return 'applied'
}

function normalizeActionPreviewType(value: unknown): AgentActionPreviewType {
  const allowed: AgentActionPreviewType[] = [
    'chapter_commit',
    'revision_commit',
    'memory_candidate_batch',
    'character_state_candidate_batch',
    'foreshadowing_candidate_batch',
    'hard_canon_candidate',
    'rerun_generation',
    'pause_for_human'
  ]
  return allowed.includes(value as AgentActionPreviewType) ? (value as AgentActionPreviewType) : 'pause_for_human'
}

function normalizeActionPreviewStatus(value: unknown): AgentActionPreviewStatus {
  if (value === 'approved' || value === 'applied' || value === 'dismissed') return value
  return 'pending'
}

function numberArrayValue(value: unknown): number[] {
  return arrayOrEmpty<unknown>(value)
    .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number.parseInt(String(item), 10)))
    .filter((item) => Number.isFinite(item))
}

export function normalizeAgentDecision(value: unknown, agentRunIdHint = '', projectIdHint = ''): AgentDecision {
  const raw = objectOrEmpty(value)
  const createdAt = stringValue(raw.createdAt) || new Date().toISOString()
  return {
    id: stringValue(raw.id) || `agent-decision-${createdAt}`,
    agentRunId: stringValue(raw.agentRunId) || agentRunIdHint,
    projectId: stringValue(raw.projectId) || projectIdHint,
    chapterId: stringValue(raw.chapterId) || null,
    jobId: stringValue(raw.jobId) || null,
    step: stringValue(raw.step),
    action: normalizeDecisionAction(raw.action),
    reason: stringValue(raw.reason),
    evidence: stringArrayValue(raw.evidence),
    riskLevel: normalizeRiskLevel(raw.riskLevel),
    result: normalizeDecisionResult(raw.result),
    createdAt
  }
}

export function normalizeAgentRun(value: unknown): AgentRun {
  const raw = objectOrEmpty(value)
  const startedAt = stringValue(raw.startedAt) || stringValue(raw.createdAt) || new Date().toISOString()
  const projectId = stringValue(raw.projectId)
  const id = stringValue(raw.id) || `agent-run-${startedAt}`
  return {
    id,
    projectId,
    goal: stringValue(raw.goal),
    mode: normalizeRunMode(raw.mode),
    safetyMode: normalizeSafetyMode(raw.safetyMode),
    targetChapterOrders: numberArrayValue(raw.targetChapterOrders),
    status: normalizeRunStatus(raw.status),
    createdJobIds: stringArrayValue(raw.createdJobIds),
    createdDraftIds: stringArrayValue(raw.createdDraftIds),
    createdCommitIds: stringArrayValue(raw.createdCommitIds),
    pendingHumanReviewItemIds: stringArrayValue(raw.pendingHumanReviewItemIds),
    decisions: arrayOrEmpty<AgentDecision>(raw.decisions).map((decision) => normalizeAgentDecision(decision, id, projectId)),
    summary: stringValue(raw.summary),
    warnings: stringArrayValue(raw.warnings),
    startedAt,
    updatedAt: stringValue(raw.updatedAt) || startedAt,
    completedAt: stringValue(raw.completedAt) || null,
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1
  }
}

export function normalizeAgentActionPreview(value: unknown): AgentActionPreview {
  const raw = objectOrEmpty(value)
  const createdAt = stringValue(raw.createdAt) || new Date().toISOString()
  return {
    id: stringValue(raw.id) || `agent-action-preview-${createdAt}`,
    agentRunId: stringValue(raw.agentRunId),
    projectId: stringValue(raw.projectId),
    chapterId: stringValue(raw.chapterId) || null,
    jobId: stringValue(raw.jobId) || null,
    actionType: normalizeActionPreviewType(raw.actionType),
    status: normalizeActionPreviewStatus(raw.status),
    summary: stringValue(raw.summary),
    riskLevel: normalizeRiskLevel(raw.riskLevel),
    diffSummary: stringArrayValue(raw.diffSummary),
    affectedIds: stringArrayValue(raw.affectedIds),
    requiresHumanApproval: typeof raw.requiresHumanApproval === 'boolean' ? raw.requiresHumanApproval : true,
    recommendation:
      raw.recommendation === 'accept' ||
      raw.recommendation === 'revise' ||
      raw.recommendation === 'reject' ||
      raw.recommendation === 'wait' ||
      raw.recommendation === 'pause'
        ? raw.recommendation
        : 'pause',
    reason: stringValue(raw.reason),
    evidence: stringArrayValue(raw.evidence),
    createdAt,
    updatedAt: stringValue(raw.updatedAt) || createdAt,
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1
  }
}
