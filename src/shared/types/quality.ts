import type { AiCallTelemetry, ID } from './base'

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

export type ConsistencySeverity = 'low' | 'medium' | 'high'

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

export interface ConsistencyReviewReport {
  id: ID
  projectId: ID
  jobId: ID
  chapterId: ID | null
  draftId?: ID | null
  draftContentHash?: string | null
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
  jobId?: ID | null
  chapterId: ID | null
  draftId: ID | null
  draftContentHash?: string | null
  repeatedPhrases: string[]
  repeatedSceneDescriptions: string[]
  repeatedExplanations: string[]
  overusedIntensifiers: string[]
  redundantParagraphs: string[]
  compressionSuggestions: string[]
  overallRedundancyScore: number
  createdAt: string
  updatedAt?: string
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
  draftContentHash?: string | null
  promptContextSnapshotId?: ID | null
  overallScore: number
  pass: boolean
  dimensions: QualityGateDimensionScores
  issues: QualityGateIssue[]
  requiredFixes: string[]
  optionalSuggestions: string[]
  aiTelemetry?: AiCallTelemetry
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
  confidence?: 'high' | 'medium' | 'low'
  semanticEvidence?: NoveltySemanticEvidence
}

export interface NoveltySemanticEvidence {
  ruleTarget?: string | null
  beneficiary?: string | null
  crisisCue?: string | null
  resolutionCue?: string | null
  costOrLimitCue?: string | null
  sourceMediumCue?: string | null
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
  sourceDraftId?: ID | null
  sourceContentHash?: string | null
  auditedAt?: string | null
}

export type EditorialVerdictStatus = 'approved' | 'advisory' | 'blocked' | 'incomplete'
export type EditorialCoverageStatus = 'current' | 'not_requested' | 'unavailable' | 'stale'

export interface EditorialVerdictCoverage {
  quality: EditorialCoverageStatus
  consistency: EditorialCoverageStatus
}

export type EditorialVerdictIssueLevel = 'blocker' | 'advisory'

export type EditorialVerdictIssueSource =
  | 'quality_gate'
  | 'consistency_review'
  | 'novelty_audit'
  | 'redundancy_report'
  | 'character_state'
  | 'diagnostic_binding'

export interface EditorialVerdictIssue {
  id: ID
  level: EditorialVerdictIssueLevel
  source: EditorialVerdictIssueSource
  code: string
  title: string
  evidence: string[]
  recommendation: string
  sourceId?: ID | null
}

export type EditorialVerdictActionType =
  | 'accept_draft'
  | 'revise_draft'
  | 'rerun_diagnostics'
  | 'review_novelty'
  | 'update_character_state'

export interface EditorialVerdictAction {
  actionType: EditorialVerdictActionType
  label: string
  reason: string
  priority: 1 | 2 | 3
}

export interface EditorialVerdictSourceRefs {
  qualityGateReportId?: ID | null
  consistencyReviewReportId?: ID | null
  redundancyReportId?: ID | null
  noveltyAuditTraceId?: ID | null
  generationRunTraceId?: ID | null
  characterStateIssueIds: ID[]
  ignoredStaleReportIds: ID[]
}

/** Compact, deterministic editorial decision bound to one exact draft revision. */
export interface EditorialVerdict {
  id: ID
  projectId: ID
  chapterId: ID | null
  jobId: ID
  draftId: ID
  draftContentHash: string
  draftRevision: string
  status: EditorialVerdictStatus
  /** Explicit diagnostic coverage; optional only for persisted pre-0.1.6 compatibility. */
  coverage?: EditorialVerdictCoverage
  canAccept: boolean
  summary: string
  blockers: EditorialVerdictIssue[]
  advisories: EditorialVerdictIssue[]
  actions: EditorialVerdictAction[]
  sourceRefs: EditorialVerdictSourceRefs
  schemaVersion: number
  createdAt: string
  updatedAt: string
}
