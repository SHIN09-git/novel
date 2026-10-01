import type {
  CandidateDecisionAmendment,
  CandidateDecisionAmendmentAudit,
  CandidateDecisionAmendmentSnapshot,
  CandidateDecisionReceipt,
  CandidateMemoryPatchAmendment,
  CharacterCardField,
  CharacterStateFactValue,
  StateFactCategory
} from '../types'
import { normalizeMemoryUpdatePatch } from './memoryUpdate'
import { normalizeCandidateDecisionEffects } from './candidateDecisionHistory'

type UnknownRecord = Record<string, unknown>

const CHARACTER_CARD_FIELDS: CharacterCardField[] = [
  'roleFunction', 'surfaceGoal', 'deepNeed', 'coreFear', 'decisionLogic',
  'abilitiesAndResources', 'weaknessAndCost', 'relationshipTension', 'futureHooks'
]
const STATE_FACT_CATEGORIES: StateFactCategory[] = [
  'resource', 'inventory', 'location', 'physical', 'mental', 'knowledge', 'relationship',
  'goal', 'promise', 'secret', 'ability', 'status', 'custom'
]
const CONTINUITY_FIELDS = [
  'lastSceneLocation', 'lastPhysicalState', 'lastEmotionalState', 'lastUnresolvedAction',
  'lastDialogueOrThought', 'immediateNextBeat', 'mustContinueFrom', 'mustNotReset', 'openMicroTensions'
] as const
const REVIEW_FIELDS = [
  'summary', 'newInformation', 'characterChanges', 'newForeshadowing',
  'resolvedForeshadowing', 'endingHook', 'riskWarnings'
] as const
const STAGE_SUMMARY_FIELDS = [
  'coveredChapterRange', 'compressedPlotSummary', 'irreversibleChanges', 'endingCarryoverState',
  'emotionalAftertaste', 'pacingState', 'plotProgress', 'characterRelations', 'secrets',
  'foreshadowingPlanted', 'foreshadowingResolved', 'unresolvedQuestions', 'nextStageDirection'
] as const

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function optionalString(value: UnknownRecord, key: string): string | undefined | null {
  if (!Object.hasOwn(value, key)) return undefined
  return typeof value[key] === 'string' ? value[key] : null
}

function stringFields(value: unknown, fields: readonly string[], requireAll = false): UnknownRecord | null {
  const source = record(value)
  if (!source || !hasOnlyKeys(source, fields)) return null
  const result: UnknownRecord = {}
  for (const field of fields) {
    if (!Object.hasOwn(source, field)) {
      if (requireAll) return null
      continue
    }
    if (typeof source[field] !== 'string') return null
    result[field] = source[field]
  }
  return result
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...new Set(value)] : null
}

function stateValue(value: unknown): CharacterStateFactValue | null | undefined {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  return stringArray(value) ?? undefined
}

function optionalStrings(source: UnknownRecord, result: UnknownRecord, fields: readonly string[]): boolean {
  for (const field of fields) {
    const value = optionalString(source, field)
    if (value === null) return false
    if (value !== undefined) result[field] = value
  }
  return true
}

export function normalizeCandidateMemoryPatchAmendment(input: unknown): CandidateMemoryPatchAmendment | undefined {
  const patch = record(input)
  if (!patch || typeof patch.kind !== 'string') return undefined
  if (patch.kind === 'chapter_review_update') {
    if (!hasOnlyKeys(patch, ['kind', 'summary', 'review', 'continuityBridgeSuggestion'])) return undefined
    const result: UnknownRecord = { kind: patch.kind }
    if (!optionalStrings(patch, result, ['summary'])) return undefined
    if (Object.hasOwn(patch, 'review')) {
      const review = stringFields(patch.review, REVIEW_FIELDS)
      if (!review) return undefined
      result.review = review
    }
    if (Object.hasOwn(patch, 'continuityBridgeSuggestion')) {
      if (patch.continuityBridgeSuggestion === null) result.continuityBridgeSuggestion = null
      else {
        const bridge = stringFields(patch.continuityBridgeSuggestion, CONTINUITY_FIELDS, true)
        if (!bridge) return undefined
        result.continuityBridgeSuggestion = bridge
      }
    }
    return result as unknown as CandidateMemoryPatchAmendment
  }
  if (patch.kind === 'character_state_update') {
    const fields = ['summary', 'changeSummary', 'newCurrentEmotionalState', 'newRelationshipWithProtagonist', 'newNextActionTendency']
    if (!hasOnlyKeys(patch, ['kind', ...fields])) return undefined
    const result: UnknownRecord = { kind: patch.kind }
    return optionalStrings(patch, result, fields) ? result as unknown as CandidateMemoryPatchAmendment : undefined
  }
  if (patch.kind === 'foreshadowing_create') {
    if (!hasOnlyKeys(patch, ['kind', 'summary', 'candidate'])) return undefined
    const result: UnknownRecord = { kind: patch.kind }
    if (!optionalStrings(patch, result, ['summary'])) return undefined
    if (Object.hasOwn(patch, 'candidate')) {
      const candidate = record(patch.candidate)
      const fields = ['title', 'description', 'suggestedWeight', 'recommendedTreatmentMode', 'expectedPayoff', 'relatedCharacterIds', 'notes']
      if (!candidate || !hasOnlyKeys(candidate, fields)) return undefined
      const normalized: UnknownRecord = {}
      if (!optionalStrings(candidate, normalized, ['title', 'description', 'expectedPayoff', 'notes'])) return undefined
      if (Object.hasOwn(candidate, 'suggestedWeight')) {
        if (typeof candidate.suggestedWeight !== 'string' ||
          !['low', 'medium', 'high', 'payoff'].includes(candidate.suggestedWeight)) return undefined
        normalized.suggestedWeight = candidate.suggestedWeight
      }
      if (Object.hasOwn(candidate, 'recommendedTreatmentMode')) {
        if (typeof candidate.recommendedTreatmentMode !== 'string' ||
          !['hidden', 'hint', 'advance', 'mislead', 'pause', 'payoff'].includes(candidate.recommendedTreatmentMode)) return undefined
        normalized.recommendedTreatmentMode = candidate.recommendedTreatmentMode
      }
      if (Object.hasOwn(candidate, 'relatedCharacterIds')) {
        const ids = stringArray(candidate.relatedCharacterIds)
        if (!ids) return undefined
        normalized.relatedCharacterIds = ids
      }
      result.candidate = normalized
    }
    return result as unknown as CandidateMemoryPatchAmendment
  }
  if (patch.kind === 'foreshadowing_status_update') {
    const fields = ['summary', 'suggestedStatus', 'recommendedTreatmentMode', 'evidenceText', 'notes']
    if (!hasOnlyKeys(patch, ['kind', ...fields])) return undefined
    const result: UnknownRecord = { kind: patch.kind }
    if (!optionalStrings(patch, result, ['summary', 'evidenceText', 'notes'])) return undefined
    if (Object.hasOwn(patch, 'suggestedStatus')) {
      if (typeof patch.suggestedStatus !== 'string' ||
        !['unresolved', 'partial', 'resolved', 'abandoned'].includes(patch.suggestedStatus)) return undefined
      result.suggestedStatus = patch.suggestedStatus
    }
    if (Object.hasOwn(patch, 'recommendedTreatmentMode')) {
      if (typeof patch.recommendedTreatmentMode !== 'string' ||
        !['hidden', 'hint', 'advance', 'mislead', 'pause', 'payoff'].includes(patch.recommendedTreatmentMode)) return undefined
      result.recommendedTreatmentMode = patch.recommendedTreatmentMode
    }
    return result as unknown as CandidateMemoryPatchAmendment
  }
  if (patch.kind === 'stage_summary_create') {
    if (!hasOnlyKeys(patch, ['kind', 'summary', 'stageSummary'])) return undefined
    const result: UnknownRecord = { kind: patch.kind }
    if (!optionalStrings(patch, result, ['summary'])) return undefined
    if (Object.hasOwn(patch, 'stageSummary')) {
      const summary = stringFields(patch.stageSummary, STAGE_SUMMARY_FIELDS)
      if (!summary) return undefined
      result.stageSummary = summary
    }
    return result as unknown as CandidateMemoryPatchAmendment
  }
  if (patch.kind === 'timeline_event_create') {
    if (!hasOnlyKeys(patch, ['kind', 'summary', 'event'])) return undefined
    const result: UnknownRecord = { kind: patch.kind }
    if (!optionalStrings(patch, result, ['summary'])) return undefined
    if (Object.hasOwn(patch, 'event')) {
      const event = record(patch.event)
      const fields = ['title', 'storyTime', 'participantCharacterIds', 'result', 'downstreamImpact']
      if (!event || !hasOnlyKeys(event, fields)) return undefined
      const normalized: UnknownRecord = {}
      if (!optionalStrings(event, normalized, ['title', 'storyTime', 'result', 'downstreamImpact'])) return undefined
      if (Object.hasOwn(event, 'participantCharacterIds')) {
        const ids = stringArray(event.participantCharacterIds)
        if (!ids) return undefined
        normalized.participantCharacterIds = ids
      }
      result.event = normalized
    }
    return result as unknown as CandidateMemoryPatchAmendment
  }
  return undefined
}

export function normalizeCandidateDecisionAmendment(input: unknown): CandidateDecisionAmendment | undefined {
  const amendment = record(input)
  if (!amendment || typeof amendment.kind !== 'string') return undefined
  if (amendment.kind === 'memory') {
    if (!hasOnlyKeys(amendment, ['kind', 'patch'])) return undefined
    const patch = normalizeCandidateMemoryPatchAmendment(amendment.patch)
    return patch ? { kind: 'memory', patch } : undefined
  }
  if (amendment.kind !== 'character_state' ||
    !hasOnlyKeys(amendment, ['kind', 'label', 'category', 'targetValue', 'linkedCardFields'])) return undefined
  const result: UnknownRecord = { kind: 'character_state' }
  const label = optionalString(amendment, 'label')
  if (label === null) return undefined
  if (label !== undefined) result.label = label
  if (Object.hasOwn(amendment, 'category')) {
    if (!STATE_FACT_CATEGORIES.includes(amendment.category as StateFactCategory)) return undefined
    result.category = amendment.category
  }
  if (Object.hasOwn(amendment, 'targetValue')) {
    const value = stateValue(amendment.targetValue)
    if (value === undefined) return undefined
    result.targetValue = value
  }
  if (Object.hasOwn(amendment, 'linkedCardFields')) {
    const fields = stringArray(amendment.linkedCardFields)
    if (!fields || !fields.every((field) => CHARACTER_CARD_FIELDS.includes(field as CharacterCardField))) return undefined
    result.linkedCardFields = fields
  }
  return result as unknown as CandidateDecisionAmendment
}

function normalizeSnapshot(input: unknown): CandidateDecisionAmendmentSnapshot | undefined {
  const snapshot = record(input)
  if (!snapshot) return undefined
  if (snapshot.kind === 'memory' && hasOnlyKeys(snapshot, ['kind', 'patch'])) {
    return { kind: 'memory', patch: normalizeMemoryUpdatePatch(snapshot.patch) }
  }
  if (snapshot.kind !== 'character_state' ||
    !hasOnlyKeys(snapshot, ['kind', 'label', 'category', 'targetValue', 'linkedCardFields'])) return undefined
  const label = snapshot.label === null || typeof snapshot.label === 'string' ? snapshot.label : undefined
  const category = snapshot.category === null || STATE_FACT_CATEGORIES.includes(snapshot.category as StateFactCategory)
    ? snapshot.category as StateFactCategory | null : undefined
  const targetValue = stateValue(snapshot.targetValue)
  const linkedCardFields = stringArray(snapshot.linkedCardFields)
  if (label === undefined || category === undefined || targetValue === undefined || !linkedCardFields ||
    !linkedCardFields.every((field) => CHARACTER_CARD_FIELDS.includes(field as CharacterCardField))) return undefined
  return { kind: 'character_state', label, category, targetValue,
    linkedCardFields: linkedCardFields as CharacterCardField[] }
}

function normalizeAudit(input: unknown): CandidateDecisionAmendmentAudit | undefined {
  const audit = record(input)
  if (!audit || !hasOnlyKeys(audit, ['kind', 'candidateId', 'amendment', 'before', 'after']) ||
    !['memory', 'character_state'].includes(String(audit.kind)) || typeof audit.candidateId !== 'string') return undefined
  const amendment = normalizeCandidateDecisionAmendment(audit.amendment)
  const before = normalizeSnapshot(audit.before)
  const after = normalizeSnapshot(audit.after)
  if (!amendment || amendment.kind !== audit.kind || !before || before.kind !== audit.kind || !after || after.kind !== audit.kind) return undefined
  return { kind: audit.kind as CandidateDecisionAmendmentAudit['kind'], candidateId: audit.candidateId, amendment, before, after }
}

export function normalizeCandidateDecisionReceipts(input: unknown): CandidateDecisionReceipt[] {
  if (!Array.isArray(input)) return []
  return input.filter((value): value is CandidateDecisionReceipt => Boolean(
    value && typeof value === 'object' && typeof value.id === 'string' && value.id &&
    typeof value.projectId === 'string' && value.projectId &&
    typeof value.commandFingerprint === 'string' && value.commandFingerprint &&
    (value.actor?.kind === 'user' || value.actor?.kind === 'agent') && Array.isArray(value.decisions)
  )).map((value) => {
    const effects = normalizeCandidateDecisionEffects(value.effects)
    return {
    id: value.id,
    projectId: value.projectId,
    actor: { kind: value.actor.kind, ...(typeof value.actor.agentRunId === 'string' ? { agentRunId: value.actor.agentRunId } : {}) },
    reason: typeof value.reason === 'string' ? value.reason : '',
    decidedAt: typeof value.decidedAt === 'string' ? value.decidedAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    schemaVersion: 1,
    commandFingerprint: value.commandFingerprint,
    ...(typeof value.authorizationGrantId === 'string' && value.authorizationGrantId ? { authorizationGrantId: value.authorizationGrantId } : {}),
    ...(effects ? { effects } : {}),
    ...(typeof value.requiresConfirmation === 'boolean' ? { requiresConfirmation: value.requiresConfirmation } : {}),
    ...(value.operation === 'undo' && typeof value.undoesReceiptId === 'string' && value.undoesReceiptId
      ? { operation: 'undo' as const, undoesReceiptId: value.undoesReceiptId } : {}),
    decisions: value.decisions.filter((item) => item && typeof item.candidateId === 'string' &&
      (item.kind === 'memory' || item.kind === 'character_state') && (item.decision === 'accept' || item.decision === 'reject'))
      .map((item) => {
        const amendment = normalizeCandidateDecisionAmendment(item.amendment)
        return { kind: item.kind, candidateId: item.candidateId, decision: item.decision,
          expectedFingerprint: typeof item.expectedFingerprint === 'string' ? item.expectedFingerprint : '',
          ...(amendment ? { amendment } : {}) }
      }),
    ...(Array.isArray(value.amendments)
      ? { amendments: value.amendments.map(normalizeAudit).filter((item): item is CandidateDecisionAmendmentAudit => Boolean(item)) }
      : {}),
    changedRecords: Array.isArray(value.changedRecords) ? value.changedRecords
      .filter((item) => item && typeof item.collection === 'string' && Array.isArray(item.ids))
      .map((item) => ({ collection: item.collection, ids: item.ids.filter((id) => typeof id === 'string') })) : []
    }
  })
}
