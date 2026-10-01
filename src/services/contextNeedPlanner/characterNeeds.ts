import type {
  ChapterTask,
  CharacterCardField,
  CharacterStateFact,
  ContextNeedItem,
  ContextNeedPriority,
  ExpectedCharacterNeed,
  ExpectedSceneType,
  ID,
  RetrievalPriority,
  StateFactCategory
} from '../../shared/types'
import {
  contextNeed,
  inferRequiredCharacterFields,
  inferRequiredStateCategories,
  priorityLevel,
  priorityRank,
  stateCategoryPriority,
  stateCategoryReason,
  strongestPriority,
  unique
} from './rules'
import {
  characterCardRetrievalPriority,
  characterStateRetrievalPriority,
  inferExpectedCharacterNeeds,
  type InferExpectedCharacterNeedsInput
} from './characterInference'

export interface BuildCharacterNeedPlanSliceInput extends InferExpectedCharacterNeedsInput {
  chapterTaskDraft: Partial<ChapterTask>
  sceneType: ExpectedSceneType
  characterStateFacts: CharacterStateFact[]
}

export interface CharacterNeedPlanSlice {
  expectedCharacters: ExpectedCharacterNeed[]
  requiredCharacterCardFields: Record<ID, CharacterCardField[]>
  requiredStateFactCategories: Record<ID, StateFactCategory[]>
  retrievalPriorities: RetrievalPriority[]
  contextNeeds: ContextNeedItem[]
  timelineRelevantCharacterIds: ID[]
}

function strongerPriority(left: ContextNeedPriority, right: ContextNeedPriority): ContextNeedPriority {
  return priorityRank(left) >= priorityRank(right) ? left : right
}

function capUncertainPriority(priority: ContextNeedPriority, uncertain: boolean): ContextNeedPriority {
  if (!uncertain) return priority
  return priority === 'must' || priority === 'high' ? 'medium' : priority
}

export function buildCharacterNeedPlanSlice(input: BuildCharacterNeedPlanSliceInput): CharacterNeedPlanSlice {
  const expectedCharacters = inferExpectedCharacterNeeds(input)
  const requiredCharacterCardFields: Record<ID, CharacterCardField[]> = {}
  const requiredStateFactCategories: Record<ID, StateFactCategory[]> = {}

  for (const need of expectedCharacters) {
    const character = input.characters.find((candidate) => candidate.id === need.characterId)
    if (!character) continue
    requiredCharacterCardFields[need.characterId] = inferRequiredCharacterFields(
      character,
      input.chapterTaskDraft,
      input.sceneType,
      need.expectedPresence
    )
    const categories = inferRequiredStateCategories(
      character,
      input.chapterTaskDraft,
      input.sceneType,
      need.expectedPresence,
      need.involvement,
      need.stateCheckRequired
    )
    if (categories.length > 0 || need.stateCheckRequired) requiredStateFactCategories[need.characterId] = categories
  }

  for (const fact of input.characterStateFacts) {
    if (fact.status !== 'active') continue
    const expected = expectedCharacters.find((character) => character.characterId === fact.characterId)
    if (!expected) continue
    if (!expected.stateCheckRequired && fact.promptPolicy !== 'always') continue
    if (fact.trackingLevel !== 'hard' && fact.promptPolicy !== 'always') continue
    requiredStateFactCategories[fact.characterId] = unique([
      ...(requiredStateFactCategories[fact.characterId] ?? []),
      fact.category
    ])
  }

  const retrievalPriorities: RetrievalPriority[] = []
  const contextNeeds: ContextNeedItem[] = []
  for (const expected of expectedCharacters) {
    const character = input.characters.find((candidate) => candidate.id === expected.characterId)
    const categories = requiredStateFactCategories[expected.characterId] ?? []
    const stateCheckRequired = expected.stateCheckRequired || categories.length > 0
    const cardScore = characterCardRetrievalPriority(expected)
    const stateScore = characterStateRetrievalPriority({ ...expected, stateCheckRequired })
    const stateCategoryNeed = strongestPriority(
      categories.map((category) => stateCategoryPriority(category, input.sceneType, expected.expectedPresence))
    )
    const statePriority = capUncertainPriority(
      strongerPriority(priorityLevel(stateScore), stateCategoryNeed),
      expected.uncertain || !stateCheckRequired
    )
    const stateReasons = categories.map((category) =>
      stateCategoryReason(category, character?.name ?? '角色', input.sceneType)
    )

    retrievalPriorities.push(
      {
        type: 'character_card',
        id: expected.characterId,
        priority: cardScore,
        reason: expected.reason
      },
      {
        type: 'character_state',
        id: expected.characterId,
        priority: stateScore,
        reason: stateCheckRequired
          ? `需要核对本章相关状态：${categories.join('、') || '当前硬状态'}。`
          : '角色只被提及，当前不要求读取完整状态账本。'
      }
    )
    contextNeeds.push(
      contextNeed(
        'character_card',
        'character',
        expected.characterId,
        priorityLevel(cardScore),
        expected.reason,
        expected.uncertain || expected.involvement === 'mentioned'
      ),
      contextNeed(
        'character_state',
        'character_state',
        expected.characterId,
        statePriority,
        stateCheckRequired
          ? `本章需要核对该角色状态账本类别：${categories.join('、') || 'status'}。${stateReasons.join('；') || expected.reason}`
          : '该角色仅被提及，不要求读取完整状态账本。',
        expected.uncertain || !stateCheckRequired
      )
    )
  }

  return {
    expectedCharacters,
    requiredCharacterCardFields,
    requiredStateFactCategories,
    retrievalPriorities,
    contextNeeds,
    timelineRelevantCharacterIds: expectedCharacters
      .filter((character) => !character.uncertain && (character.involvement !== 'mentioned' || character.stateCheckRequired))
      .map((character) => character.characterId)
  }
}
