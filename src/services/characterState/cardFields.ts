import type { Character, CharacterCardField } from '../../shared/types'

export const CARD_FIELDS: readonly CharacterCardField[] = ['roleFunction', 'surfaceGoal', 'deepNeed', 'coreFear',
  'decisionLogic', 'abilitiesAndResources', 'weaknessAndCost', 'relationshipTension', 'futureHooks']

function filled(value?: string) {
  const text = value?.trim() ?? ''
  return /^(?:待补充|暂无|未填写|未设置)$/.test(text) ? '' : text
}

/** The writer and its budget estimator must read the same card, including legacy-only imports. */
export function characterFieldValue(c: Character, field: CharacterCardField): string {
  const value = filled(c[field])
  if (value) return value
  switch (field) {
    case 'roleFunction': return filled(c.role)
    case 'deepNeed': return filled(c.deepDesire)
    case 'decisionLogic': return [filled(c.nextActionTendency), filled(c.selfDeception)].filter(Boolean).join('；')
    case 'abilitiesAndResources': return filled(c.knownInformation)
    case 'weaknessAndCost': return [filled(c.coreFear), filled(c.forbiddenWriting)].filter(Boolean).join('；')
    case 'relationshipTension': return filled(c.protagonistRelationship)
    case 'futureHooks': return filled(c.nextActionTendency)
    default: return ''
  }
}
