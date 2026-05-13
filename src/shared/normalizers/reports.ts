import type {
  AppData,
  AppSettings,
  ChapterCommitBundle,
  ChapterTask,
  ChapterContinuityBridge,
  ChapterGenerationJob,
  CharacterCardField,
  CharacterStateChangeCandidate,
  CharacterStateChangeSuggestion,
  CharacterStateFact,
  CharacterStateLog,
  CharacterStateFactStatus,
  CharacterStatePromptPolicy,
  CharacterStateRiskLevel,
  CharacterStateTrackingLevel,
  CharacterStateTransaction,
  CharacterStateTransactionSource,
  CharacterStateTransactionStatus,
  CharacterStateTransactionType,
  CharacterStateValueType,
  CharacterStateFactValue,
  ContinuityCheckCategory,
  ContextBudgetProfile,
  ContextExclusionRule,
  ContextNeedItem,
  ContextNeedPlan,
  ContextNeedPriority,
  ContextNeedSourceHint,
  ContextSelectionTrace,
  ExpectedCharacterNeed,
  ExpectedPresence,
  ExpectedSceneType,
  ContextSelectionResult,
  ConsistencyIssueStatus,
  ConsistencyIssueType,
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  ConsistencySeverity,
  Foreshadowing,
  ForeshadowingCandidate,
  ForeshadowingStatus,
  ForeshadowingWeight,
  ForcedContextBlock,
  GenerationRunTrace,
  HardCanonItem,
  HardCanonItemCategory,
  HardCanonPack,
  HardCanonPriority,
  HardCanonStatus,
  MemoryUpdateCandidate,
  MemoryUpdateCandidateType,
  MemoryUpdatePatch,
  NoveltyAuditResult,
  NoveltyAuditSeverity,
  NoveltyFinding,
  NoveltyFindingKind,
  QualityGateReport,
  RedundancyReport,
  RevisionCommitBundle,
  RunTraceAuthorSummary,
  PromptMode,
  PromptModuleSelection,
  PromptContextSnapshot,
  PromptBlockOrderItem,
  Project,
  RetrievalPriority,
  StateFactCategory,
  StageSummary,
  StoryBible,
  StoryDirectionChapterBeat,
  StoryDirectionGuide,
  StoryDirectionGuideSource,
  StoryDirectionGuideStatus,
  StoryDirectionHorizon
} from '../types'

import { arrayOrEmpty, objectOrEmpty, stringArrayValue, stringValue } from './common'

export function normalizeQualityGateReport(value: QualityGateReport | Record<string, unknown>): QualityGateReport {
  const report = objectOrEmpty(value)
  const dimensions = objectOrEmpty(report.dimensions)
  return {
    ...(value as QualityGateReport),
    dimensions: {
      plotCoherence: typeof dimensions.plotCoherence === 'number' ? dimensions.plotCoherence : 70,
      characterConsistency: typeof dimensions.characterConsistency === 'number' ? dimensions.characterConsistency : 70,
      characterStateConsistency: typeof dimensions.characterStateConsistency === 'number' ? dimensions.characterStateConsistency : 70,
      foreshadowingControl: typeof dimensions.foreshadowingControl === 'number' ? dimensions.foreshadowingControl : 70,
      chapterContinuity: typeof dimensions.chapterContinuity === 'number' ? dimensions.chapterContinuity : 70,
      redundancyControl: typeof dimensions.redundancyControl === 'number' ? dimensions.redundancyControl : 70,
      styleMatch: typeof dimensions.styleMatch === 'number' ? dimensions.styleMatch : 70,
      pacing: typeof dimensions.pacing === 'number' ? dimensions.pacing : 70,
      emotionalPayoff: typeof dimensions.emotionalPayoff === 'number' ? dimensions.emotionalPayoff : 70,
      originality: typeof dimensions.originality === 'number' ? dimensions.originality : 70,
      promptCompliance: typeof dimensions.promptCompliance === 'number' ? dimensions.promptCompliance : 70,
      contextRelevanceCompliance: typeof dimensions.contextRelevanceCompliance === 'number' ? dimensions.contextRelevanceCompliance : 70
    },
    issues: Array.isArray(report.issues) ? (report.issues as QualityGateReport['issues']) : [],
    requiredFixes: stringArrayValue(report.requiredFixes),
    optionalSuggestions: stringArrayValue(report.optionalSuggestions)
  }
}

export function normalizeRedundancyReport(value: RedundancyReport | Record<string, unknown>): RedundancyReport {
  const report = objectOrEmpty(value)
  return {
    ...(value as RedundancyReport),
    id: stringValue(report.id) || `redundancy-${new Date().toISOString()}`,
    projectId: stringValue(report.projectId),
    chapterId: stringValue(report.chapterId) || null,
    draftId: stringValue(report.draftId) || null,
    repeatedPhrases: stringArrayValue(report.repeatedPhrases),
    repeatedSceneDescriptions: stringArrayValue(report.repeatedSceneDescriptions),
    repeatedExplanations: stringArrayValue(report.repeatedExplanations),
    overusedIntensifiers: stringArrayValue(report.overusedIntensifiers),
    redundantParagraphs: stringArrayValue(report.redundantParagraphs),
    compressionSuggestions: stringArrayValue(report.compressionSuggestions),
    overallRedundancyScore: typeof report.overallRedundancyScore === 'number' ? report.overallRedundancyScore : 0,
    createdAt: stringValue(report.createdAt) || new Date().toISOString()
  }
}

export function normalizeConsistencySeverity(value: unknown): ConsistencySeverity {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium'
}

function normalizeConsistencyIssueType(value: unknown): ConsistencyIssueType {
  const allowed: ConsistencyIssueType[] = [
    'timeline_conflict',
    'worldbuilding_conflict',
    'character_knowledge_leak',
    'character_motivation_gap',
    'character_ooc',
    'foreshadowing_misuse',
    'foreshadowing_leak',
    'geography_or_physics_conflict',
    'previous_chapter_contradiction',
    'continuity_gap',
    'other'
  ]
  if (allowed.includes(value as ConsistencyIssueType)) return value as ConsistencyIssueType
  if (value === 'timeline') return 'timeline_conflict'
  if (value === 'setting') return 'worldbuilding_conflict'
  if (value === 'character_ooc') return 'character_ooc'
  if (value === 'foreshadowing') return 'foreshadowing_misuse'
  return 'other'
}

function normalizeConsistencyIssueStatus(value: unknown): ConsistencyIssueStatus {
  return value === 'open' || value === 'ignored' || value === 'converted_to_revision' || value === 'resolved' ? value : 'open'
}

function normalizeConsistencyIssue(value: unknown, index = 0): ConsistencyReviewIssue {
  const issue = objectOrEmpty(value)
  const type = normalizeConsistencyIssueType(issue.type ?? issue.category)
  const suggestedFix = stringValue(issue.suggestedFix) || stringValue(issue.suggestion)
  const description = stringValue(issue.description)
  return {
    id: stringValue(issue.id) || `legacy-consistency-issue-${index}`,
    type,
    category: issue.category as ConsistencyReviewIssue['category'],
    severity: normalizeConsistencySeverity(issue.severity),
    title: stringValue(issue.title) || description.slice(0, 36) || '一致性问题',
    description,
    evidence: stringValue(issue.evidence),
    relatedChapterIds: stringArrayValue(issue.relatedChapterIds),
    relatedCharacterIds: stringArrayValue(issue.relatedCharacterIds),
    relatedForeshadowingIds: stringArrayValue(issue.relatedForeshadowingIds),
    suggestedFix,
    revisionInstruction: stringValue(issue.revisionInstruction) || suggestedFix || description,
    status: normalizeConsistencyIssueStatus(issue.status),
    suggestion: stringValue(issue.suggestion) || suggestedFix
  }
}

function issueFromLegacyText(text: string): ConsistencyReviewIssue[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed.map((item, index) => normalizeConsistencyIssue(item, index))
    if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { issues?: unknown }).issues)) {
      return ((parsed as { issues: unknown[] }).issues).map((item, index) => normalizeConsistencyIssue(item, index))
    }
  } catch {
    // Keep the original text as a legacy issue below.
  }
  return [
    normalizeConsistencyIssue(
      {
        type: 'other',
        severity: 'medium',
        title: '旧版审稿问题',
        description: trimmed,
        evidence: '',
        suggestedFix: '请人工查看旧版一致性审稿文本，并决定是否需要修订。'
      },
      0
    )
  ]
}

export function normalizeConsistencyReviewReport(value: ConsistencyReviewReport | Record<string, unknown>): ConsistencyReviewReport {
  const report = objectOrEmpty(value)
  const rawIssues = report.issues
  const legacyIssuesText = typeof rawIssues === 'string' ? rawIssues : stringValue(report.legacyIssuesText)
  const issues = Array.isArray(rawIssues)
    ? rawIssues.map((item, index) => normalizeConsistencyIssue(item, index))
    : issueFromLegacyText(legacyIssuesText)
  return {
    ...(value as ConsistencyReviewReport),
    id: stringValue(report.id),
    projectId: stringValue(report.projectId),
    jobId: stringValue(report.jobId),
    chapterId: stringValue(report.chapterId) || null,
    promptContextSnapshotId: stringValue(report.promptContextSnapshotId) || null,
    issues,
    legacyIssuesText,
    suggestions: stringValue(report.suggestions),
    severitySummary: normalizeConsistencySeverity(report.severitySummary),
    createdAt: stringValue(report.createdAt) || new Date().toISOString()
  }
}

function normalizeNoveltyFindingKind(value: unknown): NoveltyFindingKind {
  const raw = stringValue(value)
  if (
    raw === 'new_named_character' ||
    raw === 'new_world_rule' ||
    raw === 'new_system_mechanic' ||
    raw === 'new_organization_or_rank' ||
    raw === 'major_lore_reveal' ||
    raw === 'deus_ex_rule' ||
    raw === 'suspicious_deus_ex_rule' ||
    raw === 'untraced_name'
  ) {
    return raw
  }
  return 'new_world_rule'
}

export function normalizeNoveltyAuditSeverity(value: unknown): NoveltyAuditSeverity {
  return value === 'pass' || value === 'warning' || value === 'fail' ? value : 'pass'
}

function normalizeNoveltyFindingSeverity(value: unknown): NoveltyFinding['severity'] {
  if (value === 'info' || value === 'warning' || value === 'fail') return value
  if (value === 'low') return 'info'
  if (value === 'medium') return 'warning'
  if (value === 'high') return 'fail'
  return 'warning'
}

function normalizeNoveltyFinding(value: unknown): NoveltyFinding {
  const finding = objectOrEmpty(value)
  return {
    kind: normalizeNoveltyFindingKind(finding.kind),
    text: stringValue(finding.text),
    evidenceExcerpt: stringValue(finding.evidenceExcerpt),
    reason: stringValue(finding.reason),
    severity: normalizeNoveltyFindingSeverity(finding.severity),
    allowedByTask: typeof finding.allowedByTask === 'boolean' ? finding.allowedByTask : false,
    hasPriorForeshadowing: typeof finding.hasPriorForeshadowing === 'boolean' ? finding.hasPriorForeshadowing : false,
    sourceHint: stringValue(finding.sourceHint) || null,
    suggestedAction: stringValue(finding.suggestedAction)
  }
}

export function normalizeNoveltyAuditResult(value: unknown): NoveltyAuditResult | null {
  if (!value || typeof value !== 'object') return null
  const audit = objectOrEmpty(value)
  return {
    newNamedCharacters: arrayOrEmpty<NoveltyFinding>(audit.newNamedCharacters).map(normalizeNoveltyFinding),
    newWorldRules: arrayOrEmpty<NoveltyFinding>(audit.newWorldRules).map(normalizeNoveltyFinding),
    newSystemMechanics: arrayOrEmpty<NoveltyFinding>(audit.newSystemMechanics).map(normalizeNoveltyFinding),
    newOrganizationsOrRanks: arrayOrEmpty<NoveltyFinding>(audit.newOrganizationsOrRanks).map(normalizeNoveltyFinding),
    majorLoreReveals: arrayOrEmpty<NoveltyFinding>(audit.majorLoreReveals).map(normalizeNoveltyFinding),
    suspiciousDeusExRules: arrayOrEmpty<NoveltyFinding>(audit.suspiciousDeusExRules).map(normalizeNoveltyFinding),
    untracedNames: arrayOrEmpty<NoveltyFinding>(audit.untracedNames).map(normalizeNoveltyFinding),
    severity: normalizeNoveltyAuditSeverity(audit.severity),
    summary: stringValue(audit.summary)
  }
}
