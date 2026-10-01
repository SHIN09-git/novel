import type { AiCallTelemetry, ContinuitySource, ID, TimelineEvent } from './base'
import type {
  CharacterCardField,
  CharacterStateChangeCandidate,
  CharacterStateFact,
  CharacterStateTransaction,
  StateFactCategory
} from './character'
import type {
  ContextBudgetProfile,
  ContextCompressionRecord,
  ContextDecisionReasonCode,
  ContextNeedPlan,
  ContextSelectionTrace,
  OmittedContextItem,
  PromptContextSnapshot
} from './context'
import type { Foreshadowing, ForeshadowingTreatmentMode } from './foreshadowing'
import type {
  ChapterGenerationJob,
  ChapterGenerationStep,
  ChapterGenerationStepType,
  GeneratedChapterDraft,
  PipelineAIRole,
  PipelineContextSource,
  PipelineRecipeId,
  PipelineRecipeVersion
} from './generation'
import type { MemoryUpdateCandidate } from './memory'
import type { Chapter } from './project'
import type { ConsistencyReviewReport, ConsistencySeverity, EditorialVerdict, NoveltyAuditResult, QualityGateReport, RedundancyReport } from './quality'
import type { ChapterVersion } from './revision'
import type { StoryDirectionGuideSource, StoryDirectionHorizon } from './storyDirection'

export interface ForcedContextBlock {
  kind: 'continuity_bridge' | 'quality_gate_issue' | string
  sourceId?: ID | null
  sourceType?: string | null
  sourceChapterId?: ID | null
  sourceChapterOrder?: number | null
  title: string
  tokenEstimate: number
}

export type AIWorkflowCallOutcome = 'success' | 'failed'

/** Safe per-call metadata. Prompt, prose, reasoning, credentials, and raw responses are deliberately excluded. */
export interface AIWorkflowCallTrace extends AiCallTelemetry {
  id: ID
  stepId: ID
  stepType: ChapterGenerationStepType
  role: PipelineAIRole
  logicalCallIndex: number
  outcome: AIWorkflowCallOutcome
  createdAt: string
}

export interface PromptBlockOrderItem {
  id: string
  title: string
  kind: string
  priority: number
  tokenEstimate: number
  source: string
  sourceIds?: ID[]
  included: boolean
  compressed?: boolean
  forced?: boolean
  omittedReason?: string | null
  reason: string
}

export type PromptCompositionCategory = 'positive_task' | 'factual_context' | 'constraints' | 'review_tone' | 'other'

export type PromptCompositionAlertKind = 'repeated_sentence' | 'similar_constraint'

export interface PromptCompositionBlockMetric {
  id: string
  tokenEstimate: number
  tokenSharePercent: number
  category: PromptCompositionCategory
  // Legacy fields remain optional so persisted P0 metrics still normalize safely.
  title?: string
  kind?: string
  priority?: number
  source?: string
  sourceIds?: ID[]
  included?: boolean
  compressed?: boolean
  forced?: boolean
}

export interface PromptCompositionAlert {
  kind: PromptCompositionAlertKind
  severity: 'warning'
  sample: string
  relatedBlockIds: string[]
  fingerprints?: string[]
  occurrences?: number
  similarity?: number
  reason: string
}

export interface PromptCompositionMetrics {
  totalTokenEstimate: number
  attributedTokenEstimate: number
  unattributedTokenEstimate: number
  categoryTokenEstimates: Record<PromptCompositionCategory, number>
  categoryShares: Record<PromptCompositionCategory, number>
  blockMetrics: PromptCompositionBlockMetric[]
  repeatedSentences: PromptCompositionAlert[]
  similarConstraints: PromptCompositionAlert[]
  alerts: PromptCompositionAlert[]
  constraintLineCount: number
  reviewToneLineCount: number
  summary: string
}

export interface GenerationRunTrace {
  id: ID
  projectId: ID
  jobId: ID
  targetChapterOrder: number
  promptContextSnapshotId: ID | null
  contextSource: PipelineContextSource
  pipelineRecipeId: PipelineRecipeId | null
  pipelineRecipeVersion: PipelineRecipeVersion | null
  pipelineRecipeExplanation: string
  aiCalls: AIWorkflowCallTrace[]
  selectedChapterIds: ID[]
  selectedStageSummaryIds: ID[]
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
  selectedTimelineEventIds: ID[]
  foreshadowingTreatmentModes: Record<ID, ForeshadowingTreatmentMode>
  foreshadowingTreatmentOverrides: Record<ID, ForeshadowingTreatmentMode>
  omittedContextItems: OmittedContextItem[]
  contextWarnings: string[]
  contextTokenEstimate: number
  contextSelectionTrace: ContextSelectionTrace | null
  forcedContextBlocks: ForcedContextBlock[]
  compressionRecords: ContextCompressionRecord[]
  promptBlockOrder: PromptBlockOrderItem[]
  finalPromptTokenEstimate: number
  promptCompositionMetrics: PromptCompositionMetrics | null
  promptLintWarnings: string[]
  promptLintIssueCount: number
  generatedDraftId: ID | null
  consistencyReviewReportId: ID | null
  qualityGateReportId: ID | null
  editorialVerdictId?: ID | null
  editorialVerdictDraftId?: ID | null
  editorialVerdictDraftContentHash?: string | null
  revisionSessionIds: ID[]
  acceptedRevisionVersionId: ID | null
  acceptedMemoryCandidateIds: ID[]
  rejectedMemoryCandidateIds: ID[]
  continuityBridgeId: ID | null
  continuitySource: ContinuitySource | null
  redundancyReportId: ID | null
  continuityWarnings: string[]
  contextNeedPlanId: ID | null
  requiredCharacterCardFields: Record<ID, CharacterCardField[]>
  requiredStateFactCategories: Record<ID, StateFactCategory[]>
  contextNeedPlanWarnings: string[]
  contextNeedPlanMatchedItems: ID[]
  contextNeedPlanOmittedItems: OmittedContextItem[]
  includedCharacterStateFactIds: ID[]
  characterStateWarnings: string[]
  characterStateIssueIds: ID[]
  noveltyAuditResult: NoveltyAuditResult | null
  storyDirectionGuideId: ID | null
  storyDirectionGuideSource: StoryDirectionGuideSource | null
  storyDirectionGuideHorizon: StoryDirectionHorizon | null
  storyDirectionGuideStartChapterOrder: number | null
  storyDirectionGuideEndChapterOrder: number | null
  storyDirectionBeatId: ID | null
  storyDirectionAppliedToChapterTask: boolean
  hardCanonPackItemCount: number
  hardCanonPackTokenEstimate: number
  includedHardCanonItemIds: ID[]
  truncatedHardCanonItemIds: ID[]
  createdAt: string
  updatedAt: string
}

export type RunTraceAuthorSummaryStatus = 'good' | 'needs_attention' | 'risky' | 'failed' | 'unknown'

export type RunTraceProblemSource =
  | 'context_missing'
  | 'context_noise'
  | 'task_contract'
  | 'character_state'
  | 'foreshadowing'
  | 'novelty_drift'
  | 'consistency'
  | 'quality_gate'
  | 'redundancy'
  | 'model_output'
  | 'revision_needed'
  | 'unknown'

export type RunTraceAuthorActionType =
  | 'revise_chapter'
  | 'adjust_context'
  | 'update_character_state'
  | 'review_memory_candidate'
  | 'review_foreshadowing'
  | 'edit_chapter_task'
  | 'rerun_generation'
  | 'ignore'

export interface RunTraceAuthorProblemSource {
  source: RunTraceProblemSource
  severity: ConsistencySeverity
  evidence: string[]
  recommendation: string
}

export interface RunTraceAuthorNextAction {
  label: string
  actionType: RunTraceAuthorActionType
  reason: string
}

export type PromptContractReplayStatus = 'complete' | 'needs_attention' | 'incomplete'

export type PromptContractReplayIssueCode =
  | 'missing_block_order'
  | 'opaque_snapshot'
  | 'missing_continuity_bridge'
  | 'missing_chapter_task'
  | 'duplicate_block_id'
  | 'forced_context_untracked'
  | 'forced_bridge_after_task'
  | 'compression_untracked'
  | 'confirmed_need_unmet'
  | 'hard_canon_truncated'
  | 'prompt_lint_cleanup'
  | 'token_accounting_gap'

export interface PromptContractReplayIssue {
  code: PromptContractReplayIssueCode
  severity: 'info' | 'warning' | 'error'
  message: string
  evidence: string[]
}

export interface PromptContractReplayBlock {
  position: number
  id: string
  title: string
  kind: string
  authorityPriority: number
  tokenEstimate: number
  tokenSharePercent: number
  source: string
  sourceIds: ID[]
  forced: boolean
  compressed: boolean
  reason: string
  omittedReason: string | null
  decisionReasonCodes: ContextDecisionReasonCode[]
}

export interface PromptContractReplay {
  traceId: ID
  targetChapterOrder: number
  contextSource: PipelineContextSource
  status: PromptContractReplayStatus
  summary: string
  finalPromptTokenEstimate: number
  accountedBlockTokenEstimate: number
  tokenAccountingDelta: number
  includedBlocks: PromptContractReplayBlock[]
  omittedBlocks: PromptContractReplayBlock[]
  selectedContextCount: number
  droppedContextCount: number
  unmetNeedCount: number
  promptLintIssueCount: number
  issues: PromptContractReplayIssue[]
}

export interface RunTraceAuthorSummary {
  id: ID
  projectId: ID
  chapterId: ID | null
  jobId?: ID
  traceId?: ID
  generatedDraftId?: ID | null
  createdAt: string
  summaryVersion: number
  overallStatus: RunTraceAuthorSummaryStatus
  oneLineDiagnosis: string
  likelyProblemSources: RunTraceAuthorProblemSource[]
  contextDiagnosis?: {
    usedContextCount?: number
    missingContextHints?: string[]
    noisyContextHints?: string[]
    budgetPressure?: 'low' | 'medium' | 'high' | 'unknown'
  }
  continuityDiagnosis?: {
    characterStateIssues?: string[]
    foreshadowingIssues?: string[]
    timelineIssues?: string[]
    newCanonRisks?: string[]
  }
  draftDiagnosis?: {
    qualityGatePassed?: boolean
    consistencyPassed?: boolean
    redundancyRisk?: 'low' | 'medium' | 'high' | 'unknown'
    mainDraftIssues?: string[]
  }
  nextActions: RunTraceAuthorNextAction[]
  sourceRefs: {
    qualityGateReportId?: ID
    consistencyReviewReportId?: ID
    redundancyReportIds?: ID[]
    noveltyAuditId?: ID
    generationRunTraceId?: ID
    contextNeedPlanId?: ID
  }
}

export interface GenerationRunBundle {
  schemaVersion: number
  jobId: ID
  projectId: ID
  chapterId: ID | null
  updatedAt: string
  job: ChapterGenerationJob
  steps: ChapterGenerationStep[]
  promptContextSnapshot?: PromptContextSnapshot
  contextNeedPlans?: ContextNeedPlan[]
  contextBudgetProfiles?: ContextBudgetProfile[]
  generatedDrafts: GeneratedChapterDraft[]
  qualityGateReports: QualityGateReport[]
  consistencyReviewReports: ConsistencyReviewReport[]
  memoryUpdateCandidates: MemoryUpdateCandidate[]
  characterStateChangeCandidates: CharacterStateChangeCandidate[]
  redundancyReports: RedundancyReport[]
  editorialVerdicts?: EditorialVerdict[]
  runTrace?: GenerationRunTrace
}

export interface ChapterAcceptanceReview {
  mode: 'reviewed' | 'unreviewed'
  draftContentHash: string
  editorialRequired: boolean
  qualityGateReportId: ID | null
  editorialVerdictId: ID | null
  qualityStatus: 'not_available' | 'passed' | 'needs_review' | 'blocked'
  editorialStatus: 'not_available' | 'approved' | 'advisory' | 'blocked' | 'incomplete'
}

export interface ChapterCommitBundle {
  schemaVersion: number
  id: ID
  commitId: ID
  projectId: ID
  chapterId: ID
  jobId?: ID | null
  generatedDraftId?: ID | null
  acceptedAt: string
  acceptedBy: 'user' | 'agent'
  actor?: { kind: 'agent'; agentRunId: ID; actionPreviewId: ID; authorizationGrantId?: ID }
  /** Missing on legacy commits; never infer a passed review from that absence. */
  acceptanceReview?: ChapterAcceptanceReview
  chapter: Chapter
  chapterVersion?: ChapterVersion
  previousChapterVersion?: ChapterVersion
  generatedDraft?: GeneratedChapterDraft
  acceptedMemoryUpdateCandidates?: MemoryUpdateCandidate[]
  acceptedCharacterStateChangeCandidates?: CharacterStateChangeCandidate[]
  appliedCharacterStateFacts?: CharacterStateFact[]
  appliedCharacterStateTransactions?: CharacterStateTransaction[]
  appliedForeshadowingUpdates?: Foreshadowing[]
  appliedTimelineEvents?: TimelineEvent[]
  qualityGateReportId?: ID | null
  consistencyReviewReportId?: ID | null
  generationRunTraceId?: ID | null
  qualityGateReports?: QualityGateReport[]
  consistencyReviewReports?: ConsistencyReviewReport[]
  redundancyReports?: RedundancyReport[]
  generationRunTrace?: GenerationRunTrace
  commitNote?: string
}
