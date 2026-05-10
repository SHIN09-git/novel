import type {
  Character,
  CharacterStateFact,
  ContextNeedItem,
  ContextNeedPlan,
  ExpectedCharacterNeed,
  Foreshadowing,
  ID,
  PlanContextGapAnalysisResult,
  Project,
  RetrievalPriority,
  StateFactCategory,
  TimelineEvent,
  ChapterPlan
} from '../shared/types'

export interface BuildPlanDerivedContextNeedPlanInput {
  project: Project
  targetChapterOrder: number
  baseContextNeedPlan: ContextNeedPlan | null
  plan: ChapterPlan
  characters: Character[]
  foreshadowings: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  characterStateFacts: CharacterStateFact[]
}

const PHYSICAL_CATEGORIES: StateFactCategory[] = ['physical', 'status']
const EMOTIONAL_CATEGORIES: StateFactCategory[] = ['mental', 'relationship']
const OPENING_CATEGORIES: StateFactCategory[] = ['location', 'goal', 'promise']
const MICRO_TENSION_CATEGORIES: StateFactCategory[] = ['knowledge', 'secret', 'relationship', 'promise']
const FORBIDDEN_RESET_CATEGORIES: StateFactCategory[] = ['location', 'physical', 'mental', 'inventory', 'knowledge', 'relationship', 'promise']
const CHARACTER_BEAT_CATEGORIES: StateFactCategory[] = ['goal', 'relationship', 'mental', 'knowledge']

function timestamp(): string {
  return new Date().toISOString()
}

function stableHash(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean))]
}

function uniqueByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyOf(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  return Object.values(value as Record<string, unknown>)
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .filter((item): item is string => typeof item === 'string')
    .join('\n')
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

function containsText(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeText(needle)
  return normalizedNeedle.length >= 2 && haystack.includes(normalizedNeedle)
}

function excerpt(text: string, maxLength = 1200): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned
}

function planToText(plan: ChapterPlan): string {
  return [
    plan.chapterTitle,
    plan.chapterGoal,
    plan.conflictToPush,
    plan.characterBeats,
    plan.foreshadowingToUse,
    plan.foreshadowingNotToReveal,
    plan.endingHook,
    plan.openingContinuationBeat,
    plan.carriedPhysicalState,
    plan.carriedEmotionalState,
    plan.unresolvedMicroTensions,
    plan.forbiddenResets,
    textValue(plan.allowedNovelty),
    textValue(plan.forbiddenNovelty)
  ]
    .filter(Boolean)
    .join('\n')
}

function emptyPlan(project: Project, targetChapterOrder: number, planText: string): ContextNeedPlan {
  const now = timestamp()
  return {
    id: `context-need-plan-plan-${project.id}-${targetChapterOrder}-${stableHash(planText)}`,
    projectId: project.id,
    targetChapterOrder,
    source: 'generation_pipeline',
    chapterIntent: '',
    expectedSceneType: 'custom',
    expectedCharacters: [],
    requiredCharacterCardFields: {},
    requiredStateFactCategories: {},
    requiredForeshadowingIds: [],
    forbiddenForeshadowingIds: [],
    requiredTimelineEventIds: [],
    requiredWorldbuildingKeys: [],
    mustCheckContinuity: [],
    retrievalPriorities: [],
    exclusionRules: [],
    contextNeeds: [],
    warnings: [],
    createdAt: now,
    updatedAt: now
  }
}

function mergeStateCategories(
  base: Record<ID, StateFactCategory[]>,
  characterIds: ID[],
  categories: StateFactCategory[]
): Record<ID, StateFactCategory[]> {
  const next = { ...base }
  for (const characterId of characterIds) {
    next[characterId] = unique([...(next[characterId] ?? []), ...categories])
  }
  return next
}

function addPriority(priorities: RetrievalPriority[], priority: RetrievalPriority): RetrievalPriority[] {
  if (priorities.some((item) => item.type === priority.type && item.id === priority.id)) return priorities
  return [...priorities, priority]
}

function expectedCharacterNeed(character: Character, reason: string): ExpectedCharacterNeed {
  return {
    characterId: character.id,
    roleInChapter: 'support',
    expectedPresence: 'onstage',
    reason
  }
}

export class PlanContextGapAnalyzerService {
  static buildFromChapterPlan(input: BuildPlanDerivedContextNeedPlanInput): PlanContextGapAnalysisResult {
    const planText = planToText(input.plan)
    const normalizedPlanText = normalizeText(planText)
    const base = input.baseContextNeedPlan ?? emptyPlan(input.project, input.targetChapterOrder, planText)
    const warnings: string[] = []
    const baseExpectedCharacterIds = new Set(base.expectedCharacters.map((item) => item.characterId))
    const baseRequiredForeshadowingIds = new Set(base.requiredForeshadowingIds)
    const baseForbiddenForeshadowingIds = new Set(base.forbiddenForeshadowingIds)
    const baseTimelineIds = new Set(base.requiredTimelineEventIds)

    const matchedCharacters = input.characters.filter((character) => containsText(normalizedPlanText, character.name))
    const newlyRequiredCharacterIds = matchedCharacters
      .map((character) => character.id)
      .filter((id) => !baseExpectedCharacterIds.has(id))

    const matchedForbiddenForeshadowings = input.foreshadowings.filter((item) => containsText(normalizeText(input.plan.foreshadowingNotToReveal || ''), item.title))
    const forbiddenForeshadowingIds = unique([...base.forbiddenForeshadowingIds, ...matchedForbiddenForeshadowings.map((item) => item.id)])

    const matchedRequiredForeshadowings = input.foreshadowings.filter((item) => containsText(normalizeText(input.plan.foreshadowingToUse || ''), item.title))
    const newlyRequiredForeshadowingIds = matchedRequiredForeshadowings
      .map((item) => item.id)
      .filter((id) => !baseRequiredForeshadowingIds.has(id) && !baseForbiddenForeshadowingIds.has(id) && !forbiddenForeshadowingIds.includes(id))

    for (const item of input.foreshadowings) {
      if (!matchedRequiredForeshadowings.some((matched) => matched.id === item.id)) {
        if (item.description && containsText(normalizedPlanText, item.description)) {
          warnings.push(`章节计划弱匹配到伏笔描述「${item.title}」，建议人工确认是否需要纳入。`)
        }
        if (item.expectedPayoff && containsText(normalizedPlanText, item.expectedPayoff)) {
          warnings.push(`章节计划弱匹配到伏笔回收方向「${item.title}」，建议人工确认是否需要纳入。`)
        }
      }
    }

    const matchedTimelineEvents = input.timelineEvents.filter((event) => containsText(normalizedPlanText, event.title))
    const newlyRequiredTimelineEventIds = matchedTimelineEvents.map((event) => event.id).filter((id) => !baseTimelineIds.has(id))
    for (const event of input.timelineEvents) {
      if (!matchedTimelineEvents.some((matched) => matched.id === event.id)) {
        if (event.result && containsText(normalizedPlanText, event.result)) {
          warnings.push(`章节计划弱匹配到时间线结果「${event.title}」，建议人工确认是否需要纳入。`)
        }
        if (event.downstreamImpact && containsText(normalizedPlanText, event.downstreamImpact)) {
          warnings.push(`章节计划弱匹配到时间线后效「${event.title}」，建议人工确认是否需要纳入。`)
        }
      }
    }

    const onstageBaseCharacterIds = base.expectedCharacters
      .filter((item) => item.expectedPresence === 'onstage')
      .map((item) => item.characterId)
    const stateTargetCharacterIds = unique([...onstageBaseCharacterIds, ...matchedCharacters.map((character) => character.id)])
    let requiredStateFactCategories = { ...base.requiredStateFactCategories }
    const newlyRequiredStateFactCategories: Record<ID, StateFactCategory[]> = {}
    const addCategories = (categories: StateFactCategory[], trigger: string) => {
      if (!trigger.trim() || stateTargetCharacterIds.length === 0) return
      requiredStateFactCategories = mergeStateCategories(requiredStateFactCategories, stateTargetCharacterIds, categories)
      for (const characterId of stateTargetCharacterIds) {
        newlyRequiredStateFactCategories[characterId] = unique([...(newlyRequiredStateFactCategories[characterId] ?? []), ...categories])
      }
    }

    addCategories(PHYSICAL_CATEGORIES, input.plan.carriedPhysicalState)
    addCategories(EMOTIONAL_CATEGORIES, input.plan.carriedEmotionalState)
    addCategories(OPENING_CATEGORIES, input.plan.openingContinuationBeat)
    addCategories(MICRO_TENSION_CATEGORIES, input.plan.unresolvedMicroTensions)
    addCategories(FORBIDDEN_RESET_CATEGORIES, input.plan.forbiddenResets)
    addCategories(CHARACTER_BEAT_CATEGORIES, input.plan.characterBeats)

    for (const [characterId, categories] of Object.entries(newlyRequiredStateFactCategories)) {
      const availableCategories = new Set(
        input.characterStateFacts
          .filter((fact) => fact.characterId === characterId && fact.status === 'active')
          .map((fact) => fact.category)
      )
      const missing = categories.filter((category) => !availableCategories.has(category))
      if (missing.length > 0) warnings.push(`章节计划需要角色状态 ${characterId}: ${missing.join('、')}，但账本中暂无 active 事实。`)
    }

    let retrievalPriorities = [...base.retrievalPriorities]
    for (const character of matchedCharacters) {
      retrievalPriorities = addPriority(retrievalPriorities, {
        type: 'character_card',
        id: character.id,
        priority: newlyRequiredCharacterIds.includes(character.id) ? 88 : 78,
        reason: '章节任务书明确提及该角色。'
      })
      retrievalPriorities = addPriority(retrievalPriorities, {
        type: 'character_state',
        id: character.id,
        priority: 84,
        reason: '章节任务书提及该角色，需要核对当前状态账本。'
      })
    }
    for (const item of matchedRequiredForeshadowings) {
      retrievalPriorities = addPriority(retrievalPriorities, {
        type: 'foreshadowing',
        id: item.id,
        priority: 90,
        reason: '章节任务书的伏笔使用计划明确提及。'
      })
    }
    for (const event of matchedTimelineEvents) {
      retrievalPriorities = addPriority(retrievalPriorities, {
        type: 'timeline',
        id: event.id,
        priority: 78,
        reason: '章节任务书明确提及该时间线事件。'
      })
    }

    const expectedCharacters = [
      ...base.expectedCharacters,
      ...matchedCharacters
        .filter((character) => newlyRequiredCharacterIds.includes(character.id))
        .map((character) => expectedCharacterNeed(character, '章节任务书补全阶段识别到该角色。'))
    ]

    const contextNeeds: ContextNeedItem[] = uniqueByKey(
      [
        ...(base.contextNeeds ?? []),
        ...newlyRequiredCharacterIds.flatMap((id) => [
          {
            id: `need-plan-character-card-${id}`,
            needType: 'character_card',
            sourceHint: 'character' as const,
            sourceId: id,
            priority: 'high' as const,
            reason: '章节计划生成后明确提到该角色，需要补充角色卡切片。',
            uncertain: false
          },
          {
            id: `need-plan-character-state-${id}`,
            needType: 'character_state',
            sourceHint: 'character_state' as const,
            sourceId: id,
            priority: 'must' as const,
            reason: '章节计划生成后明确提到该角色，需要补充当前硬状态。',
            uncertain: false
          }
        ]),
        ...newlyRequiredForeshadowingIds.map((id) => ({
          id: `need-plan-foreshadowing-${id}`,
          needType: 'foreshadowing',
          sourceHint: 'foreshadowing' as const,
          sourceId: id,
          priority: 'must' as const,
          reason: '章节计划生成后明确要求使用该伏笔。',
          uncertain: false
        })),
        ...newlyRequiredTimelineEventIds.map((id) => ({
          id: `need-plan-timeline-${id}`,
          needType: 'timeline_anchor',
          sourceHint: 'timeline' as const,
          sourceId: id,
          priority: 'high' as const,
          reason: '章节计划生成后明确提到该时间线事件。',
          uncertain: false
        }))
      ],
      (item) => `${item.needType}:${item.sourceId ?? item.sourceHint}`
    )

    const derivedContextNeedPlan: ContextNeedPlan = {
      ...base,
      id: `context-need-plan-plan-${input.project.id}-${input.targetChapterOrder}-${stableHash(`${base.id}:${planText}`)}`,
      projectId: input.project.id,
      targetChapterOrder: input.targetChapterOrder,
      source: 'generation_pipeline',
      chapterIntent: [base.chapterIntent, '[由章节计划补全]', excerpt(planText)].filter(Boolean).join('\n\n'),
      expectedCharacters,
      requiredForeshadowingIds: unique([...base.requiredForeshadowingIds, ...newlyRequiredForeshadowingIds]).filter(
        (id) => !forbiddenForeshadowingIds.includes(id)
      ),
      forbiddenForeshadowingIds,
      requiredTimelineEventIds: unique([...base.requiredTimelineEventIds, ...newlyRequiredTimelineEventIds]),
      requiredStateFactCategories,
      retrievalPriorities,
      contextNeeds,
      warnings: unique([...base.warnings, ...warnings]),
      createdAt: timestamp(),
      updatedAt: timestamp()
    }

    const hasNewRequirements =
      newlyRequiredCharacterIds.length > 0 ||
      newlyRequiredForeshadowingIds.length > 0 ||
      newlyRequiredTimelineEventIds.length > 0 ||
      Object.values(newlyRequiredStateFactCategories).some((items) => items.length > 0)

    return {
      baseContextNeedPlanId: input.baseContextNeedPlan?.id ?? null,
      derivedContextNeedPlan,
      newlyRequiredCharacterIds,
      newlyRequiredForeshadowingIds,
      newlyRequiredTimelineEventIds,
      newlyRequiredStateFactCategories,
      warnings,
      reason: hasNewRequirements ? '章节计划补全了新的角色、伏笔、时间线或状态账本需求。' : '章节计划未发现新的上下文缺口。'
    }
  }
}
