export type ID = string

export type PromptMode = 'light' | 'standard' | 'full'
export type ContextBudgetMode = PromptMode | 'custom'
export type ApiProvider = 'openai' | 'compatible' | 'local'
export type ForeshadowingStatus = 'unresolved' | 'partial' | 'resolved' | 'abandoned'
export type ForeshadowingWeight = 'low' | 'medium' | 'high' | 'payoff'
export type ForeshadowingTreatmentMode = 'hidden' | 'hint' | 'advance' | 'mislead' | 'pause' | 'payoff'
export type PipelineMode = 'conservative' | 'standard' | 'aggressive'
export type PromptContextSnapshotSource = 'manual' | 'auto' | 'pipeline'
export type PipelineContextSource = 'auto' | 'prompt_snapshot'
export type ContinuitySource = 'saved_bridge' | 'auto_from_previous_ending' | 'manual'
export type ContextNeedPlanSource = 'prompt_builder' | 'generation_pipeline' | 'manual' | 'auto'
export type ExpectedSceneType =
  | 'action'
  | 'dialogue'
  | 'investigation'
  | 'transition'
  | 'relationship'
  | 'reveal'
  | 'setup'
  | 'payoff'
  | 'recovery'
  | 'custom'
export type CharacterRoleInChapter = 'protagonist' | 'antagonist' | 'ally' | 'witness' | 'support' | 'offscreen' | 'mentioned'
export type ExpectedPresence = 'onstage' | 'offscreen' | 'referenced'
export type CharacterCardField =
  | 'roleFunction'
  | 'surfaceGoal'
  | 'deepNeed'
  | 'coreFear'
  | 'decisionLogic'
  | 'abilitiesAndResources'
  | 'weaknessAndCost'
  | 'relationshipTension'
  | 'futureHooks'
export type StateFactCategory =
  | 'resource'
  | 'inventory'
  | 'location'
  | 'physical'
  | 'mental'
  | 'knowledge'
  | 'relationship'
  | 'goal'
  | 'promise'
  | 'secret'
  | 'ability'
  | 'status'
  | 'custom'
export type CharacterStateValueType = 'string' | 'number' | 'boolean' | 'list' | 'text'
export type CharacterStateTrackingLevel = 'hard' | 'soft' | 'note'
export type CharacterStatePromptPolicy = 'always' | 'when_relevant' | 'manual_only'
export type CharacterStateFactStatus = 'active' | 'resolved' | 'inactive' | 'retconned'
export type CharacterStateTransactionType =
  | 'create'
  | 'update'
  | 'increment'
  | 'decrement'
  | 'add_item'
  | 'remove_item'
  | 'move'
  | 'learn'
  | 'resolve'
  | 'invalidate'
export type CharacterStateTransactionSource = 'manual' | 'chapter_review' | 'pipeline' | 'revision'
export type CharacterStateTransactionStatus = 'pending' | 'accepted' | 'rejected'
export type CharacterStateChangeCandidateType = 'create_fact' | 'update_fact' | 'transaction' | 'resolve_fact' | 'conflict'
export type CharacterStateRiskLevel = 'low' | 'medium' | 'high'
export type ContinuityCheckCategory = 'location' | 'injury' | 'money' | 'inventory' | 'knowledge' | 'relationship' | 'promise' | 'ability' | 'timeline'
export type ContextRetrievalPriorityType =
  | 'character_card'
  | 'character_state'
  | 'foreshadowing'
  | 'timeline'
  | 'story_bible'
  | 'stage_summary'
  | 'chapter_ending'
export type NoveltyAuditSeverity = 'pass' | 'warning' | 'fail'
export type NoveltyFindingSeverity = 'info' | 'warning' | 'fail'
export type NoveltyFindingKind =
  | 'new_named_character'
  | 'new_world_rule'
  | 'new_system_mechanic'
  | 'new_organization_or_rank'
  | 'major_lore_reveal'
  | 'deus_ex_rule'
  | 'suspicious_deus_ex_rule'
  | 'untraced_name'
export type ChapterGenerationJobStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed'
export type ChapterGenerationStepType =
  | 'context_need_planning'
  | 'context_budget_selection'
  | 'build_context'
  | 'generate_chapter_plan'
  | 'context_need_planning_from_plan'
  | 'context_budget_selection_delta'
  | 'rebuild_context_with_plan'
  | 'generate_chapter_draft'
  | 'generate_chapter_review'
  | 'propose_character_updates'
  | 'propose_foreshadowing_updates'
  | 'consistency_review'
  | 'quality_gate'
  | 'await_user_confirmation'
export type ChapterGenerationStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type GeneratedChapterDraftStatus = 'draft' | 'accepted' | 'rejected'
export type MemoryUpdateCandidateType = 'character' | 'foreshadowing' | 'chapter_review' | 'stage_summary' | 'timeline_event'
export type MemoryUpdateCandidateStatus = 'pending' | 'accepted' | 'rejected'
export type ConsistencySeverity = 'low' | 'medium' | 'high'
export type RevisionCandidateStatus = 'pending' | 'accepted' | 'rejected'
export type RevisionCandidateContextSource = 'reused_current_job_context' | 'rebuilt_from_explicit_selection' | 'fallback_legacy'
export type RevisionSessionStatus = 'active' | 'completed' | 'abandoned'
export type RevisionRequestType =
  | 'polish_style'
  | 'reduce_ai_tone'
  | 'strengthen_conflict'
  | 'improve_dialogue'
  | 'compress_pacing'
  | 'enhance_emotion'
  | 'fix_ooc'
  | 'fix_continuity'
  | 'fix_worldbuilding'
  | 'fix_character_knowledge'
  | 'fix_foreshadowing'
  | 'fix_plot_logic'
  | 'improve_continuity'
  | 'reduce_redundancy'
  | 'compress_description'
  | 'remove_repeated_explanation'
  | 'strengthen_chapter_transition'
  | 'rewrite_section'
  | 'custom'
export type RevisionScope = 'full' | 'local'
export type RevisionVersionStatus = 'pending' | 'accepted' | 'rejected'
export type ConsistencyIssueType =
  | 'timeline_conflict'
  | 'worldbuilding_conflict'
  | 'character_knowledge_leak'
  | 'character_motivation_gap'
  | 'character_ooc'
  | 'foreshadowing_misuse'
  | 'foreshadowing_leak'
  | 'geography_or_physics_conflict'
  | 'previous_chapter_contradiction'
  | 'continuity_gap'
  | 'other'
export type ConsistencyIssueStatus = 'open' | 'ignored' | 'converted_to_revision' | 'resolved'
export type DataMergeAction =
  | 'keep_target'
  | 'add_from_source'
  | 'dedupe_same_id'
  | 'rename_source_id'
  | 'skip_source'
  | 'conflict'
export type DataMergeConflictResolution = 'keep_target' | 'import_source_as_copy' | 'skip_source' | 'unresolved'

export interface DataFileSummary {
  projectCount: number
  chapterCount: number
  characterCount: number
  foreshadowingCount: number
  memoryCandidateCount: number
  promptVersionCount: number
  pipelineJobCount: number
  updatedAt?: string | null
}

export interface DataMergeOperation {
  collection: string
  action: DataMergeAction
  entityId?: ID
  entityTitle?: string
  reason: string
}

export interface DataMergeConflict {
  collection: string
  entityId: ID
  sourceTitle?: string
  targetTitle?: string
  reason: string
  resolution: DataMergeConflictResolution
}

export interface DataMergePreview {
  sourcePath: string
  targetPath: string
  sourceSummary: DataFileSummary
  targetSummary: DataFileSummary
  mergedSummary: DataFileSummary
  operations: DataMergeOperation[]
  conflicts: DataMergeConflict[]
  warnings: string[]
  canAutoMerge: boolean
}

export interface RevisionGenerationRequest {
  type: RevisionRequestType
  instruction: string
  revisionScope: RevisionScope
  fullChapterText: string
  targetRange?: string
}

export interface Project {
  id: ID
  name: string
  genre: string
  description: string
  targetReaders: string
  coreAppeal: string
  style: string
  createdAt: string
  updatedAt: string
}

export interface StoryBible {
  projectId: ID
  worldbuilding: string
  corePremise: string
  protagonistDesire: string
  protagonistFear: string
  mainConflict: string
  powerSystem: string
  bannedTropes: string
  styleSample: string
  narrativeTone: string
  immutableFacts: string
  updatedAt: string
}

export interface Chapter {
  id: ID
  projectId: ID
  order: number
  title: string
  body: string
  summary: string
  newInformation: string
  characterChanges: string
  newForeshadowing: string
  resolvedForeshadowing: string
  endingHook: string
  riskWarnings: string
  includedInStageSummary: boolean
  createdAt: string
  updatedAt: string
}

export interface Character {
  id: ID
  projectId: ID
  name: string
  role: string
  surfaceGoal: string
  deepDesire: string
  coreFear: string
  selfDeception: string
  knownInformation: string
  unknownInformation: string
  protagonistRelationship: string
  emotionalState: string
  nextActionTendency: string
  forbiddenWriting: string
  lastChangedChapter: number | null
  isMain: boolean
  createdAt: string
  updatedAt: string
}

export interface CharacterStateLog {
  id: ID
  projectId: ID
  characterId: ID
  chapterId: ID | null
  chapterOrder: number | null
  note: string
  linkedFactId?: ID | null
  linkedCandidateId?: ID | null
  convertedAt?: string | null
  createdAt: string
}

export type CharacterStateFactValue = string | number | boolean | string[]

export interface CharacterStateFact {
  id: ID
  projectId: ID
  characterId: ID
  category: StateFactCategory
  key: string
  label: string
  valueType: CharacterStateValueType
  value: CharacterStateFactValue
  unit: string
  linkedCardFields: CharacterCardField[]
  trackingLevel: CharacterStateTrackingLevel
  promptPolicy: CharacterStatePromptPolicy
  status: CharacterStateFactStatus
  sourceChapterId: ID | null
  sourceChapterOrder: number | null
  evidence: string
  confidence: number
  createdAt: string
  updatedAt: string
}

export interface CharacterStateTransaction {
  id: ID
  projectId: ID
  characterId: ID
  factId: ID
  chapterId: ID | null
  chapterOrder: number | null
  transactionType: CharacterStateTransactionType
  beforeValue: CharacterStateFactValue | null
  afterValue: CharacterStateFactValue | null
  delta: number | null
  reason: string
  evidence: string
  source: CharacterStateTransactionSource
  status: CharacterStateTransactionStatus
  createdAt: string
  updatedAt: string
}

export interface CharacterStateChangeSuggestion {
  characterId: ID
  category: StateFactCategory
  key: string
  label: string
  changeType: CharacterStateChangeCandidateType
  beforeValue: CharacterStateFactValue | null
  afterValue: CharacterStateFactValue | null
  delta: number | null
  evidence: string
  confidence: number
  riskLevel: CharacterStateRiskLevel
  suggestedTransactionType: CharacterStateTransactionType
  linkedCardFields: CharacterCardField[]
}

export interface CharacterStateChangeCandidate {
  id: ID
  projectId: ID
  characterId: ID
  chapterId: ID | null
  chapterOrder: number | null
  candidateType: CharacterStateChangeCandidateType
  targetFactId: ID | null
  proposedFact: CharacterStateFact | null
  proposedTransaction: CharacterStateTransaction | null
  beforeValue: CharacterStateFactValue | null
  afterValue: CharacterStateFactValue | null
  evidence: string
  confidence: number
  riskLevel: CharacterStateRiskLevel
  status: CharacterStateTransactionStatus
  createdAt: string
  updatedAt: string
}

export interface Foreshadowing {
  id: ID
  projectId: ID
  title: string
  firstChapterOrder: number | null
  description: string
  status: ForeshadowingStatus
  weight: ForeshadowingWeight
  treatmentMode: ForeshadowingTreatmentMode
  expectedPayoff: string
  payoffMethod: string
  relatedCharacterIds: ID[]
  relatedMainPlot: string
  notes: string
  actualPayoffChapter: number | null
  createdAt: string
  updatedAt: string
}

export interface TimelineEvent {
  id: ID
  projectId: ID
  title: string
  chapterOrder: number | null
  storyTime: string
  narrativeOrder: number
  participantCharacterIds: ID[]
  result: string
  downstreamImpact: string
  createdAt: string
  updatedAt: string
}

export interface StageSummary {
  id: ID
  projectId: ID
  chapterStart: number
  chapterEnd: number
  coveredChapterRange?: string
  compressedPlotSummary?: string
  irreversibleChanges?: string
  endingCarryoverState?: string
  emotionalAftertaste?: string
  pacingState?: string
  plotProgress: string
  characterRelations: string
  secrets: string
  foreshadowingPlanted: string
  foreshadowingResolved: string
  unresolvedQuestions: string
  nextStageDirection: string
  createdAt: string
  updatedAt: string
}

export interface PromptModuleSelection {
  bible: boolean
  progress: boolean
  recentChapters: boolean
  characters: boolean
  foreshadowing: boolean
  stageSummaries: boolean
  timeline: boolean
  chapterTask: boolean
  forbidden: boolean
  outputFormat: boolean
}

export interface ChapterTask {
  goal: string
  conflict: string
  suspenseToKeep: string
  allowedPayoffs: string
  forbiddenPayoffs: string
  endingHook: string
  readerEmotion: string
  targetWordCount: string
  styleRequirement: string
}

export interface PromptConfig {
  projectId: ID
  targetChapterOrder: number
  mode: PromptMode
  modules: PromptModuleSelection
  task: ChapterTask
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
  foreshadowingTreatmentOverrides?: Record<ID, ForeshadowingTreatmentMode>
  continuityInstructions?: string
  useContinuityBridge?: boolean
}

export interface ExpectedCharacterNeed {
  characterId: ID
  roleInChapter: CharacterRoleInChapter
  expectedPresence: ExpectedPresence
  reason: string
}

export interface RetrievalPriority {
  type: ContextRetrievalPriorityType
  id: ID
  priority: number
  reason: string
}

export interface ContextExclusionRule {
  type: string
  id: ID
  reason: string
}

export interface ContextNeedPlan {
  id: ID
  projectId: ID
  targetChapterOrder: number
  source: ContextNeedPlanSource
  chapterIntent: string
  expectedSceneType: ExpectedSceneType
  expectedCharacters: ExpectedCharacterNeed[]
  requiredCharacterCardFields: Record<ID, CharacterCardField[]>
  requiredStateFactCategories: Record<ID, StateFactCategory[]>
  requiredForeshadowingIds: ID[]
  forbiddenForeshadowingIds: ID[]
  requiredTimelineEventIds: ID[]
  requiredWorldbuildingKeys: string[]
  mustCheckContinuity: ContinuityCheckCategory[]
  retrievalPriorities: RetrievalPriority[]
  exclusionRules: ContextExclusionRule[]
  warnings: string[]
  createdAt: string
  updatedAt: string
}

export interface PlanContextGapAnalysisResult {
  baseContextNeedPlanId: ID | null
  derivedContextNeedPlan: ContextNeedPlan
  newlyRequiredCharacterIds: ID[]
  newlyRequiredForeshadowingIds: ID[]
  newlyRequiredTimelineEventIds: ID[]
  newlyRequiredStateFactCategories: Record<ID, StateFactCategory[]>
  warnings: string[]
  reason: string
}

export type StoryDirectionGuideStatus = 'draft' | 'active' | 'archived'
export type StoryDirectionGuideSource = 'user_polished' | 'ai_generated' | 'mixed'
export type StoryDirectionHorizon = 5 | 10

export interface StoryDirectionChapterBeat {
  id: ID
  chapterOffset: number
  chapterOrder: number | null
  goal: string
  conflict: string
  characterFocus: string
  foreshadowingToUse: string
  foreshadowingNotToReveal: string
  suspenseToKeep: string
  endingHook: string
  readerEmotion: string
  mustAvoid: string
  notes: string
}

export interface StoryDirectionGuide {
  id: ID
  projectId: ID
  title: string
  status: StoryDirectionGuideStatus
  source: StoryDirectionGuideSource
  horizonChapters: StoryDirectionHorizon
  startChapterOrder: number
  endChapterOrder: number
  userRawIdea: string
  userPolishedIdea: string
  aiGuidance: string
  strategicTheme: string
  coreDramaticPromise: string
  emotionalCurve: string
  characterArcDirectives: string
  foreshadowingDirectives: string
  constraints: string
  forbiddenTurns: string
  chapterBeats: StoryDirectionChapterBeat[]
  generatedFromStageSummaryIds: ID[]
  generatedFromChapterIds: ID[]
  warnings: string[]
  createdAt: string
  updatedAt: string
}

export interface StoryDirectionPolishResult {
  polishedIdea: string
  preservedUserIntent: string
  assumptions: string[]
  constraints: string[]
  warnings: string[]
}

export interface StoryDirectionGenerationResult {
  title: string
  aiGuidance: string
  strategicTheme: string
  coreDramaticPromise: string
  emotionalCurve: string
  characterArcDirectives: string
  foreshadowingDirectives: string
  constraints: string
  forbiddenTurns: string
  chapterBeats: Omit<StoryDirectionChapterBeat, 'id'>[]
  warnings: string[]
}

export interface PromptVersion {
  id: ID
  projectId: ID
  targetChapterOrder: number
  title: string
  mode: PromptMode
  content: string
  tokenEstimate: number
  moduleSelection: PromptModuleSelection
  task: ChapterTask
  createdAt: string
}

export interface PromptContextSnapshot {
  id: ID
  projectId: ID
  targetChapterOrder: number
  mode: ContextBudgetMode
  budgetProfileId: ID | null
  budgetProfile: ContextBudgetProfile
  contextSelectionResult: ContextSelectionResult
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
  foreshadowingTreatmentOverrides: Record<ID, ForeshadowingTreatmentMode>
  chapterTask: ChapterTask
  contextNeedPlan: ContextNeedPlan | null
  storyDirectionGuide: StoryDirectionGuide | null
  finalPrompt: string
  estimatedTokens: number
  source: PromptContextSnapshotSource
  note: string
  createdAt: string
  updatedAt: string
}

export interface BuildPromptResult {
  finalPrompt: string
  estimatedTokens: number
  promptBlockOrder: PromptBlockOrderItem[]
  contextSelectionResult: ContextSelectionResult | null
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
  foreshadowingTreatmentOverrides: Record<ID, ForeshadowingTreatmentMode>
  chapterTask: ChapterTask
  contextNeedPlan: ContextNeedPlan | null
  storyDirectionGuide: StoryDirectionGuide | null
  continuityBridge: ChapterContinuityBridge | null
  continuitySource: ContinuitySource | null
  compressionRecords: ContextCompressionRecord[]
  warnings: string[]
}

export interface AppSettings {
  apiProvider: ApiProvider
  apiKey: string
  hasApiKey: boolean
  baseUrl: string
  modelName: string
  temperature: number
  maxTokens: number
  enableAutoSummary: boolean
  enableChapterDiagnostics: boolean
  defaultTokenBudget: number
  defaultPromptMode: PromptMode
  theme: 'system' | 'light' | 'dark'
}

export interface ContextBudgetProfile {
  id: ID
  projectId: ID
  name: string
  maxTokens: number
  mode: ContextBudgetMode
  includeRecentChaptersCount: number
  includeStageSummariesCount: number
  includeMainCharacters: boolean
  includeRelatedCharacters: boolean
  includeForeshadowingWeights: ForeshadowingWeight[]
  includeTimelineEventsCount: number
  styleSampleMaxChars: number
  createdAt: string
  updatedAt: string
}

export interface OmittedContextItem {
  type: string
  id: ID | null
  reason: string
  estimatedTokensSaved: number
}

export type ContextCompressionKind =
  | 'chapter_recap_to_stage_summary'
  | 'chapter_recap_to_one_line_summary'
  | 'chapter_recap_to_summary_excerpt'
  | 'chapter_recap_dropped'

export type ContextCompressionReplacementKind =
  | 'stage_summary'
  | 'chapter_one_line_summary'
  | 'summary_excerpt'
  | 'dropped'

export interface ContextCompressionRecord {
  id: ID
  kind: ContextCompressionKind
  originalContextKind: 'chapter_recap'
  originalChapterId: ID
  originalChapterOrder: number
  originalTitle?: string
  originalTokenEstimate: number
  replacementKind: ContextCompressionReplacementKind
  replacementSourceId?: ID | null
  replacementText?: string
  replacementTokenEstimate: number
  savedTokenEstimate: number
  reason: string
}

export interface ContextSelectionResult {
  selectedStoryBibleFields: string[]
  selectedChapterIds: ID[]
  selectedStageSummaryIds: ID[]
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
  selectedTimelineEventIds: ID[]
  estimatedTokens: number
  omittedItems: OmittedContextItem[]
  compressionRecords: ContextCompressionRecord[]
  warnings: string[]
}

export interface AIResult<T> {
  ok: boolean
  usedAI: boolean
  data: T | null
  error?: string
  rawText?: string
  parseError?: string
  finishReason?: string
}

export interface ChapterContinuityBridgeSuggestion {
  lastSceneLocation: string
  lastPhysicalState: string
  lastEmotionalState: string
  lastUnresolvedAction: string
  lastDialogueOrThought: string
  immediateNextBeat: string
  mustContinueFrom: string
  mustNotReset: string
  openMicroTensions: string
}

export interface ChapterContinuityBridge extends ChapterContinuityBridgeSuggestion {
  id: ID
  projectId: ID
  fromChapterId: ID
  toChapterOrder: number
  createdAt: string
  updatedAt: string
}

export interface ChapterReviewDraft {
  summary: string
  newInformation: string
  characterChanges: string
  newForeshadowing: string
  resolvedForeshadowing: string
  endingHook: string
  riskWarnings: string
  continuityBridgeSuggestion: ChapterContinuityBridgeSuggestion
  characterStateChangeSuggestions: CharacterStateChangeSuggestion[]
}

export interface CharacterStateSuggestion {
  characterId: ID
  changeSummary: string
  newCurrentEmotionalState: string
  newRelationshipWithProtagonist: string
  newNextActionTendency: string
  relatedChapterId: ID | null
  confidence: number
}

export interface ForeshadowingCandidate {
  title: string
  description: string
  firstChapterOrder: number | null
  suggestedWeight: ForeshadowingWeight
  recommendedTreatmentMode?: ForeshadowingTreatmentMode
  expectedPayoff: string
  relatedCharacterIds: ID[]
  notes: string
}

export interface ForeshadowingStatusChangeSuggestion {
  foreshadowingId: ID
  suggestedStatus: ForeshadowingStatus
  recommendedTreatmentMode?: ForeshadowingTreatmentMode
  evidenceText: string
  notes: string
  confidence: number
}

export interface MemoryPatchBase {
  schemaVersion: number
  kind: string
  summary: string
  sourceChapterOrder?: number | null
  warnings?: string[]
}

export interface ChapterReviewMemoryPatch extends MemoryPatchBase {
  kind: 'chapter_review_update'
  targetChapterId: ID | null
  targetChapterOrder: number | null
  review: {
    summary: string
    newInformation: string
    characterChanges: string
    newForeshadowing: string
    resolvedForeshadowing: string
    endingHook: string
    riskWarnings: string
  }
  continuityBridgeSuggestion: ChapterContinuityBridgeSuggestion | null
}

export interface CharacterStateMemoryPatch extends MemoryPatchBase {
  kind: 'character_state_update'
  characterId: ID
  relatedChapterId: ID | null
  relatedChapterOrder: number | null
  changeSummary: string
  newCurrentEmotionalState: string
  newRelationshipWithProtagonist: string
  newNextActionTendency: string
}

export interface ForeshadowingCreateMemoryPatch extends MemoryPatchBase {
  kind: 'foreshadowing_create'
  candidate: ForeshadowingCandidate
}

export interface ForeshadowingStatusMemoryPatch extends MemoryPatchBase {
  kind: 'foreshadowing_status_update'
  foreshadowingId: ID
  suggestedStatus: ForeshadowingStatus
  recommendedTreatmentMode?: ForeshadowingTreatmentMode
  actualPayoffChapter?: number | null
  evidenceText: string
  notes: string
}

export interface StageSummaryMemoryPatch extends MemoryPatchBase {
  kind: 'stage_summary_create'
  stageSummary: Partial<StageSummary>
}

export interface TimelineEventMemoryPatch extends MemoryPatchBase {
  kind: 'timeline_event_create'
  event: Partial<TimelineEvent>
}

export interface LegacyRawMemoryPatch extends MemoryPatchBase {
  kind: 'legacy_raw'
  rawText: string
  parsedValue?: unknown
  parseError?: string
}

export type MemoryUpdatePatch =
  | ChapterReviewMemoryPatch
  | CharacterStateMemoryPatch
  | ForeshadowingCreateMemoryPatch
  | ForeshadowingStatusMemoryPatch
  | StageSummaryMemoryPatch
  | TimelineEventMemoryPatch
  | LegacyRawMemoryPatch

export interface ForeshadowingExtractionResult {
  newForeshadowingCandidates: ForeshadowingCandidate[]
  advancedForeshadowingIds: ID[]
  resolvedForeshadowingIds: ID[]
  abandonedForeshadowingCandidates: ForeshadowingCandidate[]
  statusChanges: ForeshadowingStatusChangeSuggestion[]
}

export interface NextChapterSuggestions {
  nextChapterGoal: string
  conflictToPush: string
  suspenseToKeep: string
  foreshadowingToHint: string
  foreshadowingNotToReveal: string
  suggestedEndingHook: string
  readerEmotionTarget: string
}

export interface ChapterAllowedNovelty {
  allowedNewCharacters: string[]
  allowedNewRules: string[]
  allowedNewSystemMechanics: string[]
  allowedNewOrganizationsOrRanks: string[]
  allowedLoreReveals: string[]
  notes: string
}

export interface ChapterForbiddenNovelty {
  forbiddenNewCharacters: string[]
  forbiddenNewRules: string[]
  forbiddenSystemMechanics: string[]
  forbiddenOrganizationsOrRanks: string[]
  forbiddenLoreReveals: string[]
  notes: string
}

export interface ChapterPlan {
  chapterTitle: string
  chapterGoal: string
  conflictToPush: string
  characterBeats: string
  foreshadowingToUse: string
  foreshadowingNotToReveal: string
  endingHook: string
  readerEmotionTarget: string
  estimatedWordCount: string
  openingContinuationBeat: string
  carriedPhysicalState: string
  carriedEmotionalState: string
  unresolvedMicroTensions: string
  forbiddenResets: string
  allowedNovelty: string | ChapterAllowedNovelty
  forbiddenNovelty: string | ChapterForbiddenNovelty
}

export interface ChapterDraftResult {
  title: string
  body: string
}

export interface ConsistencyReviewIssue {
  id: ID
  type: ConsistencyIssueType
  category?: 'timeline' | 'setting' | 'character_ooc' | 'foreshadowing' | 'pacing' | 'reader_emotion'
  severity: ConsistencySeverity
  title: string
  description: string
  evidence: string
  relatedChapterIds: ID[]
  relatedCharacterIds: ID[]
  relatedForeshadowingIds: ID[]
  suggestedFix: string
  revisionInstruction: string
  status: ConsistencyIssueStatus
  suggestion?: string
}

export interface ConsistencyReviewData {
  timelineProblems: string[]
  settingConflicts: string[]
  characterOOC: string[]
  foreshadowingMisuse: string[]
  pacingProblems: string[]
  emotionPayoffProblems: string[]
  suggestions: string[]
  severitySummary: ConsistencySeverity
  issues: ConsistencyReviewIssue[]
}

export interface ChapterGenerationJob {
  id: ID
  projectId: ID
  targetChapterOrder: number
  promptContextSnapshotId?: ID | null
  contextSource: PipelineContextSource
  status: ChapterGenerationJobStatus
  currentStep: ChapterGenerationStepType | null
  createdAt: string
  updatedAt: string
  errorMessage: string
}

export interface ChapterGenerationStep {
  id: ID
  jobId: ID
  type: ChapterGenerationStepType
  status: ChapterGenerationStepStatus
  inputSnapshot: string
  output: string
  errorMessage: string
  createdAt: string
  updatedAt: string
}

export interface GeneratedChapterDraft {
  id: ID
  projectId: ID
  chapterId: ID | null
  jobId: ID
  title: string
  body: string
  summary: string
  status: GeneratedChapterDraftStatus
  tokenEstimate: number
  createdAt: string
  updatedAt: string
}

export interface MemoryUpdateCandidate {
  id: ID
  projectId: ID
  jobId: ID
  type: MemoryUpdateCandidateType
  targetId: ID | null
  proposedPatch: MemoryUpdatePatch
  evidence: string
  confidence: number
  status: MemoryUpdateCandidateStatus
  createdAt: string
  updatedAt: string
}

export interface ConsistencyReviewReport {
  id: ID
  projectId: ID
  jobId: ID
  chapterId: ID | null
  promptContextSnapshotId?: ID | null
  issues: ConsistencyReviewIssue[]
  legacyIssuesText?: string
  suggestions: string
  severitySummary: ConsistencySeverity
  createdAt: string
}

export interface QualityGateDimensionScores {
  plotCoherence: number
  characterConsistency: number
  characterStateConsistency: number
  foreshadowingControl: number
  chapterContinuity: number
  redundancyControl: number
  styleMatch: number
  pacing: number
  emotionalPayoff: number
  originality: number
  promptCompliance: number
  contextRelevanceCompliance: number
}

export interface RedundancyReport {
  id: ID
  projectId: ID
  chapterId: ID | null
  draftId: ID | null
  repeatedPhrases: string[]
  repeatedSceneDescriptions: string[]
  repeatedExplanations: string[]
  overusedIntensifiers: string[]
  redundantParagraphs: string[]
  compressionSuggestions: string[]
  overallRedundancyScore: number
  createdAt: string
}

export interface QualityGateIssue {
  severity: ConsistencySeverity
  type: string
  description: string
  evidence: string
  suggestedFix: string
  linkedConsistencyIssueId?: ID
}

export interface QualityGateReport {
  id: ID
  projectId: ID
  jobId: ID
  chapterId: ID | null
  draftId: ID | null
  promptContextSnapshotId?: ID | null
  overallScore: number
  pass: boolean
  dimensions: QualityGateDimensionScores
  issues: QualityGateIssue[]
  requiredFixes: string[]
  optionalSuggestions: string[]
  createdAt: string
}

export interface ChapterNoveltyPolicy {
  allowNewNamedCharacters: boolean
  maxNewNamedCharacters: number
  allowNewWorldRules: boolean
  maxNewWorldRules: number
  allowNewSystemMechanics: boolean
  maxNewSystemMechanics: number
  allowNewOrganizationsOrRanks: boolean
  maxNewOrganizationsOrRanks: number
  allowMajorLoreReveal: boolean
  allowedNewCharacterNames?: string[]
  allowedNewRuleTopics?: string[]
  allowedSystemMechanicTopics?: string[]
  allowedOrganizationOrRankTopics?: string[]
  allowedLoreRevealTopics?: string[]
  forbiddenNewRuleTopics?: string[]
  forbiddenSystemMechanicTopics?: string[]
  forbiddenOrganizationOrRankTopics?: string[]
  forbiddenRevealTopics?: string[]
  requireForeshadowingForNewRules: boolean
  requireTraceForNewEntities: boolean
}

export interface NoveltyFinding {
  kind: NoveltyFindingKind
  text: string
  evidenceExcerpt: string
  reason: string
  severity: NoveltyFindingSeverity
  allowedByTask: boolean
  hasPriorForeshadowing: boolean
  sourceHint?: string | null
  suggestedAction: string
}

export interface NoveltyAuditResult {
  newNamedCharacters: NoveltyFinding[]
  newWorldRules: NoveltyFinding[]
  newSystemMechanics: NoveltyFinding[]
  newOrganizationsOrRanks: NoveltyFinding[]
  majorLoreReveals: NoveltyFinding[]
  suspiciousDeusExRules: NoveltyFinding[]
  untracedNames: NoveltyFinding[]
  severity: NoveltyAuditSeverity
  summary: string
}

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
  createdAt: string
  updatedAt: string
}

export interface RevisionCandidate {
  id: ID
  projectId: ID
  jobId: ID
  draftId: ID
  sourceReportId: ID
  targetIssue: string
  revisionInstruction: string
  revisedText: string
  status: RevisionCandidateStatus
  contextSource?: RevisionCandidateContextSource
  contextWarnings?: string[]
  createdAt: string
  updatedAt: string
}

export interface RevisionSession {
  id: ID
  projectId: ID
  chapterId: ID
  sourceDraftId: ID | null
  status: RevisionSessionStatus
  createdAt: string
  updatedAt: string
}

export interface RevisionRequest {
  id: ID
  sessionId: ID
  type: RevisionRequestType
  targetRange: string
  instruction: string
  createdAt: string
}

export interface RevisionResult {
  revisedText: string
  changedSummary: string
  risks: string
  preservedFacts: string
}

export interface RevisionVersion {
  id: ID
  sessionId: ID
  requestId: ID
  title: string
  body: string
  changedSummary: string
  risks: string
  preservedFacts: string
  status: RevisionVersionStatus
  createdAt: string
  updatedAt: string
}

export interface ChapterVersion {
  id: ID
  projectId: ID
  chapterId: ID
  source: string
  title: string
  body: string
  note: string
  createdAt: string
}

export interface AppData {
  schemaVersion: number
  projects: Project[]
  storyBibles: StoryBible[]
  chapters: Chapter[]
  characters: Character[]
  characterStateLogs: CharacterStateLog[]
  characterStateFacts: CharacterStateFact[]
  characterStateTransactions: CharacterStateTransaction[]
  characterStateChangeCandidates: CharacterStateChangeCandidate[]
  foreshadowings: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  stageSummaries: StageSummary[]
  promptVersions: PromptVersion[]
  promptContextSnapshots: PromptContextSnapshot[]
  storyDirectionGuides: StoryDirectionGuide[]
  contextNeedPlans: ContextNeedPlan[]
  chapterContinuityBridges: ChapterContinuityBridge[]
  chapterGenerationJobs: ChapterGenerationJob[]
  chapterGenerationSteps: ChapterGenerationStep[]
  generatedChapterDrafts: GeneratedChapterDraft[]
  memoryUpdateCandidates: MemoryUpdateCandidate[]
  consistencyReviewReports: ConsistencyReviewReport[]
  contextBudgetProfiles: ContextBudgetProfile[]
  qualityGateReports: QualityGateReport[]
  generationRunTraces: GenerationRunTrace[]
  redundancyReports: RedundancyReport[]
  revisionCandidates: RevisionCandidate[]
  revisionSessions: RevisionSession[]
  revisionRequests: RevisionRequest[]
  revisionVersions: RevisionVersion[]
  chapterVersions: ChapterVersion[]
  settings: AppSettings
}

export interface PromptBuildInput {
  project: Project
  bible: StoryBible | null
  chapters: Chapter[]
  characters: Character[]
  characterStateLogs: CharacterStateLog[]
  characterStateFacts: CharacterStateFact[]
  foreshadowings: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  stageSummaries: StageSummary[]
  chapterContinuityBridges?: ChapterContinuityBridge[]
  budgetProfile?: ContextBudgetProfile
  explicitContextSelection?: ContextSelectionResult
  contextNeedPlan?: ContextNeedPlan | null
  storyDirectionGuide?: StoryDirectionGuide | null
  config: PromptConfig
}
