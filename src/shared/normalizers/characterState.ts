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

import { normalizeRecordArray, objectOrEmpty, stringValue } from './common'

const CHARACTER_CARD_FIELDS: CharacterCardField[] = [
  'roleFunction',
  'surfaceGoal',
  'deepNeed',
  'coreFear',
  'decisionLogic',
  'abilitiesAndResources',
  'weaknessAndCost',
  'relationshipTension',
  'futureHooks'
]

const STATE_FACT_CATEGORIES: StateFactCategory[] = [
  'resource',
  'inventory',
  'location',
  'physical',
  'mental',
  'knowledge',
  'relationship',
  'goal',
  'promise',
  'secret',
  'ability',
  'status',
  'custom'
]

const CHARACTER_STATE_VALUE_TYPES: CharacterStateValueType[] = ['string', 'number', 'boolean', 'list', 'text']
const CHARACTER_STATE_TRACKING_LEVELS: CharacterStateTrackingLevel[] = ['hard', 'soft', 'note']
const CHARACTER_STATE_PROMPT_POLICIES: CharacterStatePromptPolicy[] = ['always', 'when_relevant', 'manual_only']
const CHARACTER_STATE_FACT_STATUSES: CharacterStateFactStatus[] = ['active', 'resolved', 'inactive', 'retconned']
const CHARACTER_STATE_TRANSACTION_TYPES: CharacterStateTransactionType[] = [
  'create',
  'update',
  'increment',
  'decrement',
  'add_item',
  'remove_item',
  'move',
  'learn',
  'resolve',
  'invalidate'
]
const CHARACTER_STATE_TRANSACTION_SOURCES: CharacterStateTransactionSource[] = ['manual', 'chapter_review', 'pipeline', 'revision']
const CHARACTER_STATE_TRANSACTION_STATUSES: CharacterStateTransactionStatus[] = ['pending', 'accepted', 'rejected']
const CHARACTER_STATE_CANDIDATE_TYPES = ['create_fact', 'update_fact', 'transaction', 'resolve_fact', 'conflict'] as const
const CHARACTER_STATE_RISK_LEVELS: CharacterStateRiskLevel[] = ['low', 'medium', 'high']

function normalizeStateFactCategory(value: unknown): StateFactCategory {
  const raw = stringValue(value)
  return STATE_FACT_CATEGORIES.includes(raw as StateFactCategory) ? (raw as StateFactCategory) : 'custom'
}

function normalizeStateFactValue(value: unknown, valueType: CharacterStateValueType): CharacterStateFactValue {
  if (valueType === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
    return 0
  }
  if (valueType === 'boolean') return typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true'
  if (valueType === 'list') {
    if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean)
    if (typeof value === 'string') return value.split(/[,\n，、]/).map((item) => item.trim()).filter(Boolean)
    return []
  }
  return value === null || value === undefined ? '' : String(value)
}

export function normalizeCharacterStateFact(value: unknown): CharacterStateFact {
  const fact = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  const valueTypeRaw = stringValue(fact.valueType)
  const valueType = CHARACTER_STATE_VALUE_TYPES.includes(valueTypeRaw as CharacterStateValueType)
    ? (valueTypeRaw as CharacterStateValueType)
    : 'text'
  const trackingLevelRaw = stringValue(fact.trackingLevel)
  const promptPolicyRaw = stringValue(fact.promptPolicy)
  const statusRaw = stringValue(fact.status)
  return {
    id: stringValue(fact.id),
    projectId: stringValue(fact.projectId),
    characterId: stringValue(fact.characterId),
    category: normalizeStateFactCategory(fact.category),
    key: stringValue(fact.key),
    label: stringValue(fact.label) || stringValue(fact.key) || '状态事实',
    valueType,
    value: normalizeStateFactValue(fact.value, valueType),
    unit: stringValue(fact.unit),
    linkedCardFields: normalizeRecordArray(fact.linkedCardFields, CHARACTER_CARD_FIELDS),
    trackingLevel: CHARACTER_STATE_TRACKING_LEVELS.includes(trackingLevelRaw as CharacterStateTrackingLevel)
      ? (trackingLevelRaw as CharacterStateTrackingLevel)
      : 'hard',
    promptPolicy: CHARACTER_STATE_PROMPT_POLICIES.includes(promptPolicyRaw as CharacterStatePromptPolicy)
      ? (promptPolicyRaw as CharacterStatePromptPolicy)
      : 'when_relevant',
    status: CHARACTER_STATE_FACT_STATUSES.includes(statusRaw as CharacterStateFactStatus)
      ? (statusRaw as CharacterStateFactStatus)
      : 'active',
    sourceChapterId: stringValue(fact.sourceChapterId) || null,
    sourceChapterOrder: typeof fact.sourceChapterOrder === 'number' ? fact.sourceChapterOrder : null,
    evidence: stringValue(fact.evidence),
    confidence: typeof fact.confidence === 'number' ? Math.max(0, Math.min(1, fact.confidence)) : 0.7,
    createdAt: stringValue(fact.createdAt) || timestamp,
    updatedAt: stringValue(fact.updatedAt) || timestamp
  }
}

export function normalizeCharacterStateLog(value: unknown): CharacterStateLog {
  const log = objectOrEmpty(value)
  return {
    id: stringValue(log.id),
    projectId: stringValue(log.projectId),
    characterId: stringValue(log.characterId),
    chapterId: stringValue(log.chapterId) || null,
    chapterOrder: typeof log.chapterOrder === 'number' ? log.chapterOrder : null,
    note: stringValue(log.note),
    linkedFactId: stringValue(log.linkedFactId) || null,
    linkedCandidateId: stringValue(log.linkedCandidateId) || null,
    convertedAt: stringValue(log.convertedAt) || null,
    createdAt: stringValue(log.createdAt) || new Date().toISOString()
  }
}

export function normalizeCharacterStateTransaction(value: unknown): CharacterStateTransaction {
  const transaction = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  const transactionTypeRaw = stringValue(transaction.transactionType)
  const sourceRaw = stringValue(transaction.source)
  const statusRaw = stringValue(transaction.status)
  return {
    id: stringValue(transaction.id),
    projectId: stringValue(transaction.projectId),
    characterId: stringValue(transaction.characterId),
    factId: stringValue(transaction.factId),
    chapterId: stringValue(transaction.chapterId) || null,
    chapterOrder: typeof transaction.chapterOrder === 'number' ? transaction.chapterOrder : null,
    transactionType: CHARACTER_STATE_TRANSACTION_TYPES.includes(transactionTypeRaw as CharacterStateTransactionType)
      ? (transactionTypeRaw as CharacterStateTransactionType)
      : 'update',
    beforeValue: transaction.beforeValue === undefined ? null : (transaction.beforeValue as CharacterStateFactValue),
    afterValue: transaction.afterValue === undefined ? null : (transaction.afterValue as CharacterStateFactValue),
    delta: typeof transaction.delta === 'number' ? transaction.delta : null,
    reason: stringValue(transaction.reason),
    evidence: stringValue(transaction.evidence),
    source: CHARACTER_STATE_TRANSACTION_SOURCES.includes(sourceRaw as CharacterStateTransactionSource)
      ? (sourceRaw as CharacterStateTransactionSource)
      : 'manual',
    status: CHARACTER_STATE_TRANSACTION_STATUSES.includes(statusRaw as CharacterStateTransactionStatus)
      ? (statusRaw as CharacterStateTransactionStatus)
      : 'accepted',
    createdAt: stringValue(transaction.createdAt) || timestamp,
    updatedAt: stringValue(transaction.updatedAt) || timestamp
  }
}

export function normalizeCharacterStateChangeSuggestion(value: unknown): CharacterStateChangeSuggestion {
  const item = objectOrEmpty(value)
  const candidateTypeRaw = stringValue(item.changeType)
  const transactionTypeRaw = stringValue(item.suggestedTransactionType)
  const riskRaw = stringValue(item.riskLevel)
  return {
    characterId: stringValue(item.characterId),
    category: normalizeStateFactCategory(item.category),
    key: stringValue(item.key),
    label: stringValue(item.label) || stringValue(item.key) || '状态变化',
    changeType: CHARACTER_STATE_CANDIDATE_TYPES.includes(candidateTypeRaw as CharacterStateChangeCandidate['candidateType'])
      ? (candidateTypeRaw as CharacterStateChangeCandidate['candidateType'])
      : 'update_fact',
    beforeValue: item.beforeValue === undefined ? null : (item.beforeValue as CharacterStateFactValue),
    afterValue: item.afterValue === undefined ? null : (item.afterValue as CharacterStateFactValue),
    delta: typeof item.delta === 'number' ? item.delta : null,
    evidence: stringValue(item.evidence),
    confidence: typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 0.6,
    riskLevel: CHARACTER_STATE_RISK_LEVELS.includes(riskRaw as CharacterStateRiskLevel) ? (riskRaw as CharacterStateRiskLevel) : 'medium',
    suggestedTransactionType: CHARACTER_STATE_TRANSACTION_TYPES.includes(transactionTypeRaw as CharacterStateTransactionType)
      ? (transactionTypeRaw as CharacterStateTransactionType)
      : 'update',
    linkedCardFields: normalizeRecordArray(item.linkedCardFields, CHARACTER_CARD_FIELDS)
  }
}

export function normalizeCharacterStateChangeCandidate(value: unknown): CharacterStateChangeCandidate {
  const candidate = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  const candidateTypeRaw = stringValue(candidate.candidateType)
  const riskRaw = stringValue(candidate.riskLevel)
  const statusRaw = stringValue(candidate.status)
  return {
    id: stringValue(candidate.id),
    projectId: stringValue(candidate.projectId),
    characterId: stringValue(candidate.characterId),
    chapterId: stringValue(candidate.chapterId) || null,
    chapterOrder: typeof candidate.chapterOrder === 'number' ? candidate.chapterOrder : null,
    candidateType: CHARACTER_STATE_CANDIDATE_TYPES.includes(candidateTypeRaw as CharacterStateChangeCandidate['candidateType'])
      ? (candidateTypeRaw as CharacterStateChangeCandidate['candidateType'])
      : 'update_fact',
    targetFactId: stringValue(candidate.targetFactId) || null,
    proposedFact: candidate.proposedFact ? normalizeCharacterStateFact(candidate.proposedFact) : null,
    proposedTransaction: candidate.proposedTransaction ? normalizeCharacterStateTransaction(candidate.proposedTransaction) : null,
    beforeValue: candidate.beforeValue === undefined ? null : (candidate.beforeValue as CharacterStateFactValue),
    afterValue: candidate.afterValue === undefined ? null : (candidate.afterValue as CharacterStateFactValue),
    evidence: stringValue(candidate.evidence),
    confidence: typeof candidate.confidence === 'number' ? Math.max(0, Math.min(1, candidate.confidence)) : 0.6,
    riskLevel: CHARACTER_STATE_RISK_LEVELS.includes(riskRaw as CharacterStateRiskLevel) ? (riskRaw as CharacterStateRiskLevel) : 'medium',
    status: CHARACTER_STATE_TRANSACTION_STATUSES.includes(statusRaw as CharacterStateTransactionStatus)
      ? (statusRaw as CharacterStateTransactionStatus)
      : 'pending',
    createdAt: stringValue(candidate.createdAt) || timestamp,
    updatedAt: stringValue(candidate.updatedAt) || timestamp
  }
}
