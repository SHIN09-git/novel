import type {
  CharacterCardField,
  CharacterStateChangeSuggestion,
  CharacterStateSuggestion,
  CharacterStateTransactionType,
  ID,
  StateFactCategory
} from '../../../shared/types'
import { asNumber, asObject, asString, asStringArray, asText } from './primitives'

const STATE_CATEGORIES: StateFactCategory[] = [
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

const CARD_FIELDS: CharacterCardField[] = [
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

const TRANSACTION_TYPES: CharacterStateTransactionType[] = [
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

function normalizeStateCategory(value: unknown): StateFactCategory {
  const raw = asString(value)
  return STATE_CATEGORIES.includes(raw as StateFactCategory) ? (raw as StateFactCategory) : 'custom'
}

function normalizeCardFields(value: unknown): CharacterCardField[] {
  return asStringArray(value).filter((field): field is CharacterCardField => CARD_FIELDS.includes(field as CharacterCardField))
}

function normalizeTransactionType(value: unknown): CharacterStateTransactionType {
  const raw = asString(value)
  return TRANSACTION_TYPES.includes(raw as CharacterStateTransactionType) ? (raw as CharacterStateTransactionType) : 'update'
}

function normalizeStateValue(value: unknown): CharacterStateChangeSuggestion['afterValue'] {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value
  return asText(value)
}

export function ensureCharacterStateChangeSuggestion(value: unknown): CharacterStateChangeSuggestion {
  const obj = asObject(value)
  const changeType = asString(obj.changeType)
  const riskLevel = asString(obj.riskLevel)
  const delta = asNumber(obj.delta, Number.NaN)
  return {
    characterId: asString(obj.characterId),
    category: normalizeStateCategory(obj.category),
    key: asString(obj.key),
    label: asString(obj.label) || asString(obj.key) || '状态变化',
    changeType:
      changeType === 'create_fact' ||
      changeType === 'update_fact' ||
      changeType === 'transaction' ||
      changeType === 'resolve_fact' ||
      changeType === 'conflict'
        ? changeType
        : 'update_fact',
    beforeValue: normalizeStateValue(obj.beforeValue),
    afterValue: normalizeStateValue(obj.afterValue),
    delta: Number.isFinite(delta) ? delta : null,
    evidence: asText(obj.evidence),
    confidence: Math.max(0, Math.min(1, asNumber(obj.confidence, 0.5))),
    riskLevel: riskLevel === 'low' || riskLevel === 'medium' || riskLevel === 'high' ? riskLevel : 'medium',
    suggestedTransactionType: normalizeTransactionType(obj.suggestedTransactionType),
    linkedCardFields: normalizeCardFields(obj.linkedCardFields)
  }
}

export function ensureCharacterSuggestions(value: unknown, characterIds: Set<ID>): CharacterStateSuggestion[] {
  const list = Array.isArray(value) ? value : asObject(value).suggestions
  if (!Array.isArray(list)) return []

  return list
    .map((item) => asObject(item))
    .filter((item) => characterIds.has(asString(item.characterId)))
    .map((item) => ({
      characterId: asString(item.characterId),
      changeSummary: asString(item.changeSummary),
      newCurrentEmotionalState: asString(item.newCurrentEmotionalState),
      newRelationshipWithProtagonist: asString(item.newRelationshipWithProtagonist),
      newNextActionTendency: asString(item.newNextActionTendency),
      relatedChapterId: asString(item.relatedChapterId) || null,
      confidence: Math.max(0, Math.min(1, asNumber(item.confidence, 0.5)))
    }))
}
