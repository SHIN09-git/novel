import type { CharacterStateFact, ContextNeedPlan, ID } from '../../shared/types'

function matchesNeed(fact: CharacterStateFact, plan: ContextNeedPlan | null, targetChapterOrder: number): boolean {
  if (fact.status !== 'active' || fact.promptPolicy === 'manual_only') return false
  if (fact.promptPolicy === 'always') return true
  if (!plan) return fact.trackingLevel === 'hard'
  const categories = plan.requiredStateFactCategories[fact.characterId] ?? []
  if (categories.includes(fact.category)) return true
  if (fact.category === 'physical' && plan.mustCheckContinuity.includes('injury')) return true
  if (fact.category === 'location' && plan.mustCheckContinuity.includes('location')) return true
  if (fact.category === 'inventory' && plan.mustCheckContinuity.includes('inventory')) return true
  if (fact.category === 'resource' && plan.mustCheckContinuity.includes('money')) return true
  if ((fact.category === 'knowledge' || fact.category === 'secret') && plan.mustCheckContinuity.includes('knowledge')) return true
  if (fact.category === 'promise' && plan.mustCheckContinuity.includes('promise')) return true
  if (fact.category === 'ability' && plan.mustCheckContinuity.includes('ability')) return true
  return fact.trackingLevel === 'hard' && (fact.sourceChapterOrder ?? 0) <= targetChapterOrder
}

function score(fact: CharacterStateFact, plan: ContextNeedPlan | null): number {
  let value = 0
  if (fact.promptPolicy === 'always') value += 50
  if (fact.trackingLevel === 'hard') value += 35
  if (fact.trackingLevel === 'soft') value += 15
  if (plan?.requiredStateFactCategories[fact.characterId]?.includes(fact.category)) value += 45
  if (fact.confidence >= 0.8) value += 5
  return value
}

export function getRelevantCharacterStatesForPrompt(
  characterIds: ID[],
  contextNeedPlan: ContextNeedPlan | null,
  targetChapterOrder: number,
  facts: CharacterStateFact[]
): CharacterStateFact[] {
  const characterSet = new Set(characterIds)
  return facts
    .filter((fact) => characterSet.has(fact.characterId))
    .filter((fact) => matchesNeed(fact, contextNeedPlan, targetChapterOrder))
    .sort((a, b) => score(b, contextNeedPlan) - score(a, contextNeedPlan) || a.label.localeCompare(b.label))
}
