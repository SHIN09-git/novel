import type { ContinuitySource, ID, TimelineEvent } from './base'
import type { CharacterCardField, CharacterStateChangeCandidate, CharacterStateFact, StateFactCategory } from './character'
import type { ContextCompressionRecord, ContextSelectionTrace, OmittedContextItem, PromptContextSnapshot } from './context'
import type { Foreshadowing, ForeshadowingTreatmentMode } from './foreshadowing'
import type { ChapterGenerationJob, ChapterGenerationStep, GeneratedChapterDraft, PipelineContextSource } from './generation'
import type { MemoryUpdateCandidate } from './memory'
import type { Chapter } from './project'
import type { ConsistencyReviewReport, ConsistencySeverity, NoveltyAuditResult, QualityGateReport, RedundancyReport } from './quality'
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

export interface GenerationRunTrace {
  id: ID
  projectId: ID
  jobId: ID
  targetChapterOrder: number
  promptContextSnapshotId: ID | null
  contextSource: PipelineContextSource
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
  generatedDraftId: ID | null
  consistencyReviewReportId: ID | null
  qualityGateReportId: ID | null
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
  generatedDrafts: GeneratedChapterDraft[]
  qualityGateReports: QualityGateReport[]
  consistencyReviewReports: ConsistencyReviewReport[]
  memoryUpdateCandidates: MemoryUpdateCandidate[]
  characterStateChangeCandidates: CharacterStateChangeCandidate[]
  redundancyReports: RedundancyReport[]
  runTrace?: GenerationRunTrace
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
  acceptedBy: 'user'
  chapter: Chapter
  chapterVersion?: ChapterVersion
  generatedDraft?: GeneratedChapterDraft
  acceptedMemoryUpdateCandidates?: MemoryUpdateCandidate[]
  acceptedCharacterStateChangeCandidates?: CharacterStateChangeCandidate[]
  appliedCharacterStateFacts?: CharacterStateFact[]
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
