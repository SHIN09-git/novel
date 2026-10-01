import type {
  CharacterCardField,
  CharacterStateFact,
  CharacterStateFactValue,
  CharacterStateTransactionType,
  ID,
  StateFactCategory
} from '../../shared/types'

export type CharacterStateFactDraft = Partial<CharacterStateFact> & { projectId: ID; characterId: ID; label: string }

export function newStateId(): ID {
  return `state-${crypto.randomUUID()}`
}

export function stateTimestamp(): string {
  return new Date().toISOString()
}

export function stateValueToText(value: CharacterStateFactValue | null | undefined): string {
  if (Array.isArray(value)) return value.join('、')
  if (value === null || value === undefined || value === '') return '未记录'
  return String(value)
}

export function normalizeStateList(value: CharacterStateFactValue | null | undefined): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[,\n，、]/).map((item) => item.trim()).filter(Boolean)
  return []
}

export function inferStateValueType(value: CharacterStateFactValue | null): CharacterStateFact['valueType'] {
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return String(value ?? '').length > 80 ? 'text' : 'string'
}

export function defaultLinkedCardFields(category: StateFactCategory): CharacterCardField[] {
  if (category === 'resource' || category === 'inventory') return ['abilitiesAndResources']
  if (category === 'location' || category === 'goal' || category === 'status') return ['surfaceGoal']
  if (category === 'physical') return ['weaknessAndCost', 'abilitiesAndResources']
  if (category === 'knowledge' || category === 'secret') return ['abilitiesAndResources', 'relationshipTension']
  if (category === 'mental' || category === 'relationship') return ['relationshipTension']
  if (category === 'promise') return ['relationshipTension', 'weaknessAndCost']
  if (category === 'ability') return ['abilitiesAndResources', 'weaknessAndCost']
  return []
}

export function withDefaultLinkedCardFields(
  fields: CharacterCardField[] | null | undefined,
  category: StateFactCategory
): CharacterCardField[] {
  return fields?.length ? [...new Set(fields)] : defaultLinkedCardFields(category)
}

export function applyStateTransactionValue(
  beforeValue: CharacterStateFactValue,
  afterValue: CharacterStateFactValue | null,
  delta: number | null,
  type: CharacterStateTransactionType
): CharacterStateFactValue {
  if (type === 'increment' || type === 'decrement') {
    const before = typeof beforeValue === 'number' ? beforeValue : Number(beforeValue || 0)
    const signedDelta = type === 'decrement' ? -Math.abs(delta ?? 0) : Math.abs(delta ?? 0)
    return before + signedDelta
  }
  if (type === 'add_item') return [...new Set([...normalizeStateList(beforeValue), ...normalizeStateList(afterValue)])]
  if (type === 'remove_item') {
    const toRemove = new Set(normalizeStateList(afterValue))
    return normalizeStateList(beforeValue).filter((item) => !toRemove.has(item))
  }
  return afterValue ?? beforeValue
}
