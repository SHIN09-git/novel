import type {
  CharacterCardField,
  CharacterNeedInvolvement,
  ContextExclusionRule,
  ContextNeedItem,
  ContextNeedPlan,
  ContinuityCheckCategory,
  ExpectedCharacterNeed,
  ExpectedPresence,
  ExpectedSceneType,
  RetrievalPriority,
  StateFactCategory
} from '../types'
import { arrayOrEmpty, normalizeRecordArray, objectOrEmpty, stringArrayValue, stringValue } from './common'
import {
  normalizeContextNeedPriority,
  normalizeContextNeedSourceHint
} from './contextPrimitives'

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

const EXPECTED_SCENE_TYPES: ExpectedSceneType[] = [
  'action',
  'dialogue',
  'investigation',
  'transition',
  'relationship',
  'reveal',
  'setup',
  'payoff',
  'recovery',
  'custom'
]

const EXPECTED_PRESENCES: ExpectedPresence[] = ['onstage', 'offscreen', 'referenced']
const CHARACTER_NEED_INVOLVEMENTS: CharacterNeedInvolvement[] = ['mentioned', 'present', 'must_act']
const CONTINUITY_CHECK_CATEGORIES: ContinuityCheckCategory[] = [
  'location',
  'injury',
  'money',
  'inventory',
  'knowledge',
  'relationship',
  'promise',
  'ability',
  'timeline'
]

export function normalizeRequiredCharacterCardFields(value: unknown): Record<string, CharacterCardField[]> {
  return Object.fromEntries(
    Object.entries(objectOrEmpty(value)).map(([id, fields]) => [
      id,
      normalizeRecordArray(fields, CHARACTER_CARD_FIELDS)
    ])
  )
}

export function normalizeRequiredStateFactCategories(value: unknown): Record<string, StateFactCategory[]> {
  return Object.fromEntries(
    Object.entries(objectOrEmpty(value)).map(([id, categories]) => [
      id,
      normalizeRecordArray(categories, STATE_FACT_CATEGORIES)
    ])
  )
}

function normalizeExpectedCharacterNeed(value: unknown): ExpectedCharacterNeed {
  const item = objectOrEmpty(value)
  const role = stringValue(item.roleInChapter)
  const presence = stringValue(item.expectedPresence)
  const normalizedPresence = EXPECTED_PRESENCES.includes(presence as ExpectedPresence)
    ? (presence as ExpectedPresence)
    : 'onstage'
  const involvement = stringValue(item.involvement)
  return {
    characterId: stringValue(item.characterId),
    roleInChapter:
      role === 'protagonist' ||
      role === 'antagonist' ||
      role === 'ally' ||
      role === 'witness' ||
      role === 'support' ||
      role === 'offscreen' ||
      role === 'mentioned'
        ? role
        : 'support',
    expectedPresence: normalizedPresence,
    involvement: CHARACTER_NEED_INVOLVEMENTS.includes(involvement as CharacterNeedInvolvement)
      ? (involvement as CharacterNeedInvolvement)
      : normalizedPresence === 'referenced'
        ? 'mentioned'
        : 'present',
    stateCheckRequired:
      typeof item.stateCheckRequired === 'boolean' ? item.stateCheckRequired : normalizedPresence === 'onstage',
    uncertain: typeof item.uncertain === 'boolean' ? item.uncertain : false,
    reason: stringValue(item.reason)
  }
}

function normalizeRetrievalPriority(value: unknown): RetrievalPriority {
  const item = objectOrEmpty(value)
  const type = stringValue(item.type)
  return {
    type:
      type === 'character_card' ||
      type === 'character_state' ||
      type === 'foreshadowing' ||
      type === 'timeline' ||
      type === 'story_bible' ||
      type === 'stage_summary' ||
      type === 'chapter_ending' ||
      type === 'hard_canon' ||
      type === 'story_direction' ||
      type === 'recent_chapter'
        ? type
        : 'story_bible',
    id: stringValue(item.id),
    priority: typeof item.priority === 'number' ? Math.max(0, Math.min(100, item.priority)) : 50,
    reason: stringValue(item.reason)
  }
}

function normalizeContextNeedItem(value: unknown, index = 0): ContextNeedItem {
  const item = objectOrEmpty(value)
  return {
    id: stringValue(item.id) || `context-need-${index}`,
    needType: stringValue(item.needType) || 'unknown',
    sourceHint: normalizeContextNeedSourceHint(item.sourceHint),
    sourceId: stringValue(item.sourceId) || null,
    priority: normalizeContextNeedPriority(item.priority),
    reason: stringValue(item.reason) || '旧数据缺少上下文需求原因。',
    uncertain: typeof item.uncertain === 'boolean' ? item.uncertain : false
  }
}

function normalizeContextExclusionRule(value: unknown): ContextExclusionRule {
  const item = objectOrEmpty(value)
  return {
    type: stringValue(item.type) || 'unknown',
    id: stringValue(item.id),
    reason: stringValue(item.reason),
    source: item.source === 'user' ? 'user' : 'planner'
  }
}

export function normalizeContextNeedPlan(value: ContextNeedPlan | Record<string, unknown>): ContextNeedPlan {
  const plan = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  const sceneType = stringValue(plan.expectedSceneType)
  const source = stringValue(plan.source)
  return {
    ...(value as ContextNeedPlan),
    id: stringValue(plan.id) || `context-need-plan-${timestamp}`,
    projectId: stringValue(plan.projectId),
    targetChapterOrder: typeof plan.targetChapterOrder === 'number' ? plan.targetChapterOrder : 1,
    source:
      source === 'prompt_builder' || source === 'generation_pipeline' || source === 'manual' || source === 'auto'
        ? source
        : 'auto',
    chapterIntent: stringValue(plan.chapterIntent),
    expectedSceneType: EXPECTED_SCENE_TYPES.includes(sceneType as ExpectedSceneType)
      ? (sceneType as ExpectedSceneType)
      : 'custom',
    expectedCharacters: arrayOrEmpty(plan.expectedCharacters)
      .map(normalizeExpectedCharacterNeed)
      .filter((item) => item.characterId),
    requiredCharacterCardFields: normalizeRequiredCharacterCardFields(plan.requiredCharacterCardFields),
    requiredStateFactCategories: normalizeRequiredStateFactCategories(plan.requiredStateFactCategories),
    requiredForeshadowingIds: stringArrayValue(plan.requiredForeshadowingIds),
    forbiddenForeshadowingIds: stringArrayValue(plan.forbiddenForeshadowingIds),
    requiredTimelineEventIds: stringArrayValue(plan.requiredTimelineEventIds),
    requiredWorldbuildingKeys: stringArrayValue(plan.requiredWorldbuildingKeys),
    mustCheckContinuity: normalizeRecordArray(plan.mustCheckContinuity, CONTINUITY_CHECK_CATEGORIES),
    retrievalPriorities: arrayOrEmpty(plan.retrievalPriorities).map(normalizeRetrievalPriority),
    exclusionRules: arrayOrEmpty(plan.exclusionRules).map(normalizeContextExclusionRule),
    contextNeeds: arrayOrEmpty(plan.contextNeeds).map(normalizeContextNeedItem),
    warnings: stringArrayValue(plan.warnings),
    createdAt: stringValue(plan.createdAt) || timestamp,
    updatedAt: stringValue(plan.updatedAt) || timestamp
  }
}
