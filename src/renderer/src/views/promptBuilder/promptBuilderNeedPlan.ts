import type {
  ChapterTask,
  Character,
  ContextNeedPlan,
  ForeshadowingTreatmentMode,
  ID
} from '../../../../shared/types'
import { ContextNeedPlannerService } from '../../../../services/ContextNeedPlannerService'
import { now } from '../../utils/format'

export function toggleNeedPlanCharacter(
  plan: ContextNeedPlan,
  character: Character,
  task: ChapterTask,
  checked: boolean
): ContextNeedPlan {
  const timestamp = now()
  const characterId = character.id
  if (!checked) {
    return {
      ...plan,
      expectedCharacters: plan.expectedCharacters.filter((item) => item.characterId !== characterId),
      requiredCharacterCardFields: Object.fromEntries(
        Object.entries(plan.requiredCharacterCardFields).filter(([id]) => id !== characterId)
      ),
      requiredStateFactCategories: Object.fromEntries(
        Object.entries(plan.requiredStateFactCategories).filter(([id]) => id !== characterId)
      ),
      exclusionRules: [
        ...plan.exclusionRules.filter((rule) => !(rule.type === 'character' && rule.id === characterId)),
        {
          type: 'character',
          id: characterId,
          reason: '用户在上下文需求计划中手动排除该角色。',
          source: 'user' as const
        }
      ],
      updatedAt: timestamp
    }
  }

  return {
    ...plan,
    expectedCharacters: [
      ...plan.expectedCharacters.filter((item) => item.characterId !== characterId),
      {
        characterId,
        roleInChapter: character.isMain ? 'protagonist' : 'support',
        expectedPresence: 'onstage',
        involvement: 'present',
        stateCheckRequired: true,
        uncertain: false,
        reason: '用户在 Prompt 构建器中手动加入。'
      }
    ],
    requiredCharacterCardFields: {
      ...plan.requiredCharacterCardFields,
      [characterId]: ContextNeedPlannerService.inferRequiredCharacterFields(character, task, plan.expectedSceneType)
    },
    requiredStateFactCategories: {
      ...plan.requiredStateFactCategories,
      [characterId]: ContextNeedPlannerService.inferRequiredStateCategories(character, task, plan.expectedSceneType)
    },
    exclusionRules: plan.exclusionRules.filter((rule) => !(rule.type === 'character' && rule.id === characterId)),
    updatedAt: timestamp
  }
}

export function toggleNeedPlanForeshadowing(
  plan: ContextNeedPlan,
  id: ID,
  role: 'required' | 'forbidden',
  checked: boolean
): ContextNeedPlan {
  const required = new Set(plan.requiredForeshadowingIds)
  const forbidden = new Set(plan.forbiddenForeshadowingIds)
  if (role === 'required') {
    checked ? required.add(id) : required.delete(id)
    if (checked) forbidden.delete(id)
  } else {
    checked ? forbidden.add(id) : forbidden.delete(id)
    if (checked) required.delete(id)
  }
  const existingForeshadowingRules = new Map(
    plan.exclusionRules.filter((rule) => rule.type === 'foreshadowing').map((rule) => [rule.id, rule])
  )
  const preservedRules = plan.exclusionRules.filter((rule) => rule.type !== 'foreshadowing')
  return {
    ...plan,
    requiredForeshadowingIds: [...required],
    forbiddenForeshadowingIds: [...forbidden],
    exclusionRules: [
      ...preservedRules,
      ...[...forbidden].map((foreshadowingId) => {
        if (role === 'forbidden' && checked && foreshadowingId === id) {
          return {
            type: 'foreshadowing',
            id: foreshadowingId,
            reason: '用户在上下文需求计划中标记为禁止。',
            source: 'user' as const
          }
        }
        return existingForeshadowingRules.get(foreshadowingId) ?? {
          type: 'foreshadowing',
          id: foreshadowingId,
          reason: '本章需求计划要求禁止推进该伏笔。',
          source: 'planner' as const
        }
      })
    ],
    updatedAt: now()
  }
}

export function updateForeshadowingTreatmentOverrides(
  overrides: Record<ID, ForeshadowingTreatmentMode>,
  id: ID,
  nextMode: ForeshadowingTreatmentMode
): Record<ID, ForeshadowingTreatmentMode> {
  return { ...overrides, [id]: nextMode }
}
