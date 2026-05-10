import type {
  Chapter,
  ChapterContinuityBridge,
  ChapterTask,
  Character,
  CharacterCardField,
  CharacterRoleInChapter,
  CharacterStateFact,
  ContextNeedPlan,
  ContextNeedItem,
  ContextNeedPriority,
  ContextNeedSourceHint,
  ContextNeedPlanSource,
  ContextRetrievalPriorityType,
  ContinuityCheckCategory,
  ExpectedPresence,
  ExpectedSceneType,
  Foreshadowing,
  ID,
  Project,
  StageSummary,
  StateFactCategory,
  StoryBible,
  StoryDirectionGuide,
  TimelineEvent
} from '../shared/types'
import { StoryDirectionService } from './StoryDirectionService'

interface BuildNeedPlanInput {
  project: Project
  storyBible: StoryBible | null
  targetChapterOrder: number
  chapterTaskDraft: Partial<ChapterTask>
  previousChapter: Chapter | null
  continuityBridge: ChapterContinuityBridge | null
  characters: Character[]
  characterStateFacts: CharacterStateFact[]
  foreshadowing: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  stageSummaries: StageSummary[]
  storyDirectionGuide?: StoryDirectionGuide | null
  storyDirectionPromptText?: string
  source?: ContextNeedPlanSource
}

const RELATIONSHIP_FIELDS: CharacterCardField[] = ['relationshipTension', 'coreFear', 'deepNeed', 'decisionLogic']
const ACTION_FIELDS: CharacterCardField[] = ['abilitiesAndResources', 'weaknessAndCost', 'decisionLogic', 'surfaceGoal']
const REVEAL_FIELDS: CharacterCardField[] = ['deepNeed', 'coreFear', 'futureHooks', 'decisionLogic']
const TRANSITION_FIELDS: CharacterCardField[] = ['surfaceGoal', 'roleFunction', 'futureHooks']
const MINIMAL_FIELDS: CharacterCardField[] = ['roleFunction']

function newId(): ID {
  return `need-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function now(): string {
  return new Date().toISOString()
}

function textValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function combinedTaskText(task: Partial<ChapterTask>): string {
  return [
    task.goal,
    task.conflict,
    task.suspenseToKeep,
    task.allowedPayoffs,
    task.forbiddenPayoffs,
    task.endingHook,
    task.readerEmotion,
    task.targetWordCount,
    task.styleRequirement
  ]
    .map(textValue)
    .filter(Boolean)
    .join('\n')
}

function containsAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase()
  return words.some((word) => lower.includes(word.toLowerCase()))
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
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

function clampPriority(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function priorityLevel(score: number): ContextNeedPriority {
  if (score >= 86) return 'must'
  if (score >= 70) return 'high'
  if (score >= 45) return 'medium'
  return 'low'
}

function contextNeed(
  needType: string,
  sourceHint: ContextNeedSourceHint,
  sourceId: ID | null,
  priority: ContextNeedPriority,
  reason: string,
  uncertain = false
): ContextNeedItem {
  return {
    id: `need-item-${needType}-${sourceId ?? sourceHint}-${Math.abs(reason.length * 17)}`,
    needType,
    sourceHint,
    sourceId,
    priority,
    reason,
    uncertain
  }
}

function inferSceneType(task: Partial<ChapterTask>, continuityBridge: ChapterContinuityBridge | null): ExpectedSceneType {
  const text = `${combinedTaskText(task)}\n${continuityBridge?.immediateNextBeat ?? ''}\n${continuityBridge?.openMicroTensions ?? ''}`
  if (containsAny(text, ['战斗', '追击', '逃亡', '搏斗', '突围', '袭击', '行动'])) return 'action'
  if (containsAny(text, ['对话', '谈判', '质问', '争吵', '审问', '坦白'])) return 'dialogue'
  if (containsAny(text, ['调查', '线索', '推理', '搜索', '查找', '侦查', '解谜'])) return 'investigation'
  if (containsAny(text, ['关系', '信任', '怀疑', '告白', '背叛', '和解', '情感'])) return 'relationship'
  if (containsAny(text, ['揭露', '真相', '秘密', '反转', '曝光'])) return 'reveal'
  if (containsAny(text, ['回收', '兑现', '揭底', 'payoff'])) return 'payoff'
  if (containsAny(text, ['休整', '恢复', '疗伤', '余波'])) return 'recovery'
  if (containsAny(text, ['铺垫', '建立', '引入', '设定'])) return 'setup'
  if (containsAny(text, ['转场', '过渡', '抵达', '离开'])) return 'transition'
  if (containsAny(text, ['战斗', '追逐', '逃亡', '搏斗', '突围', '袭击', '行动'])) return 'action'
  if (containsAny(text, ['对话', '谈判', '质问', '争吵', '审问', '坦白'])) return 'dialogue'
  if (containsAny(text, ['调查', '线索', '推理', '搜索', '查找', '侦查', '解谜'])) return 'investigation'
  if (containsAny(text, ['关系', '信任', '怀疑', '告白', '背叛', '和解', '情感'])) return 'relationship'
  if (containsAny(text, ['揭露', '真相', '秘密', '反转', '曝光'])) return 'reveal'
  if (containsAny(text, ['回收', '兑现', '揭底', 'payoff'])) return 'payoff'
  if (containsAny(text, ['休整', '恢复', '疗伤', '余波'])) return 'recovery'
  if (containsAny(text, ['铺垫', '建立', '引入', '设定'])) return 'setup'
  if (containsAny(text, ['转场', '过渡', '抵达', '离开'])) return 'transition'
  return 'custom'
}

function textMentions(text: string, value: string | null | undefined): boolean {
  const target = textValue(value)
  return target.length >= 2 && text.includes(target)
}

function inferPresence(text: string, character: Character): ExpectedPresence {
  if (textMentions(text, character.name)) return 'onstage'
  return character.isMain ? 'onstage' : 'referenced'
}

function inferRoleInChapter(character: Character, taskText: string): CharacterRoleInChapter {
  if (character.isMain && /主角|主人公|protagonist/i.test(character.role)) return 'protagonist'
  if (/反派|敌|对手|antagonist/i.test(character.role) || containsAny(taskText, [`对抗${character.name}`, `${character.name}阻止`])) return 'antagonist'
  if (/盟友|同伴|搭档|ally/i.test(character.role)) return 'ally'
  if (/证人|目击|witness/i.test(character.role)) return 'witness'
  return character.isMain ? 'ally' : 'support'
}

export class ContextNeedPlannerService {
  static buildFromChapterIntent(input: BuildNeedPlanInput): ContextNeedPlan {
    const timestamp = now()
    const storyDirectionText =
      input.storyDirectionPromptText ?? StoryDirectionService.formatForPrompt(input.storyDirectionGuide ?? null, input.targetChapterOrder)
    const taskText = [combinedTaskText(input.chapterTaskDraft), storyDirectionText].map(textValue).filter(Boolean).join('\n')
    const sceneType = inferSceneType(input.chapterTaskDraft, input.continuityBridge)
    const relatedCharacterIds = new Set<ID>()

    for (const item of input.foreshadowing) {
      if (textMentions(taskText, item.title) || textMentions(input.chapterTaskDraft.allowedPayoffs ?? '', item.title)) {
        item.relatedCharacterIds.forEach((id) => relatedCharacterIds.add(id))
      }
    }

    const expectedCharacters = input.characters
      .filter((character) => character.isMain || textMentions(taskText, character.name) || relatedCharacterIds.has(character.id))
      .slice(0, 8)
      .map((character) => {
        const expectedPresence = inferPresence(taskText, character)
        return {
          characterId: character.id,
          roleInChapter: inferRoleInChapter(character, taskText),
          expectedPresence,
          reason: textMentions(taskText, character.name)
            ? '章节任务书直接提到该角色。'
            : relatedCharacterIds.has(character.id)
              ? '本章相关伏笔关联到该角色。'
              : '主要角色，默认需要校验当前戏剧状态。'
        }
      })

    const requiredCharacterCardFields: Record<ID, CharacterCardField[]> = {}
    const requiredStateFactCategories: Record<ID, StateFactCategory[]> = {}
    for (const item of expectedCharacters) {
      const character = input.characters.find((candidate) => candidate.id === item.characterId)
      if (!character) continue
      requiredCharacterCardFields[item.characterId] = ContextNeedPlannerService.inferRequiredCharacterFields(character, input.chapterTaskDraft, sceneType, item.expectedPresence)
      requiredStateFactCategories[item.characterId] = ContextNeedPlannerService.inferRequiredStateCategories(character, input.chapterTaskDraft, sceneType)
    }

    const requiredForeshadowingIds = input.foreshadowing
      .filter((item) => item.status !== 'resolved' && item.status !== 'abandoned')
      .filter((item) =>
        item.treatmentMode === 'payoff' ||
        item.treatmentMode === 'advance' ||
        item.treatmentMode === 'mislead' ||
        textMentions(taskText, item.title) ||
        textMentions(input.chapterTaskDraft.allowedPayoffs ?? '', item.title)
      )
      .map((item) => item.id)

    const forbiddenForeshadowingIds = input.foreshadowing
      .filter((item) => item.treatmentMode === 'hidden' || item.treatmentMode === 'pause' || textMentions(input.chapterTaskDraft.forbiddenPayoffs ?? '', item.title))
      .map((item) => item.id)

    const requiredTimelineEventIds = input.timelineEvents
      .filter((event) => event.chapterOrder === null || event.chapterOrder < input.targetChapterOrder)
      .filter((event) => textMentions(taskText, event.title) || event.participantCharacterIds.some((id) => expectedCharacters.some((character) => character.characterId === id)))
      .slice(-6)
      .map((event) => event.id)

    const requiredWorldbuildingKeys = unique([
      input.storyBible?.powerSystem && containsAny(taskText, ['力量', '规则', '能力', '系统']) ? 'powerSystem' : '',
      input.storyBible?.worldbuilding && containsAny(taskText, ['城市', '世界', '地点', '组织', '规则']) ? 'worldbuilding' : '',
      input.storyBible?.immutableFacts ? 'immutableFacts' : '',
      input.storyBible?.mainConflict && containsAny(taskText, ['主线', '冲突', '敌人', '目标']) ? 'mainConflict' : ''
    ].filter(Boolean))

    const mustCheckContinuity = ContextNeedPlannerService.inferContinuityChecks(input.chapterTaskDraft, sceneType, input.continuityBridge)

    const retrievalPriorities = [
      ...expectedCharacters.flatMap((character) => [
        {
          type: 'character_card' as ContextRetrievalPriorityType,
          id: character.characterId,
          priority: ContextNeedPlannerService.scoreRetrievalPriority({ type: 'character_card', id: character.characterId }, { sceneType, taskText, expectedCharacterIds: expectedCharacters.map((item) => item.characterId), requiredForeshadowingIds }),
          reason: character.reason
        },
        {
          type: 'character_state' as ContextRetrievalPriorityType,
          id: character.characterId,
          priority: ContextNeedPlannerService.scoreRetrievalPriority({ type: 'character_state', id: character.characterId }, { sceneType, taskText, expectedCharacterIds: expectedCharacters.map((item) => item.characterId), requiredForeshadowingIds }),
          reason: '需要核对本章相关的当前状态账本。'
        }
      ]),
      ...requiredForeshadowingIds.map((id) => ({
        type: 'foreshadowing' as ContextRetrievalPriorityType,
        id,
        priority: ContextNeedPlannerService.scoreRetrievalPriority({ type: 'foreshadowing', id }, { sceneType, taskText, expectedCharacterIds: expectedCharacters.map((item) => item.characterId), requiredForeshadowingIds }),
        reason: '伏笔 treatmentMode 或章节任务要求本章处理。'
      })),
      ...requiredTimelineEventIds.map((id) => ({
        type: 'timeline' as ContextRetrievalPriorityType,
        id,
        priority: ContextNeedPlannerService.scoreRetrievalPriority({ type: 'timeline', id }, { sceneType, taskText, expectedCharacterIds: expectedCharacters.map((item) => item.characterId), requiredForeshadowingIds }),
        reason: '与本章出场角色或事件连续性有关。'
      }))
    ]

    const contextNeeds = uniqueByKey(
      [
        contextNeed(
          'previous_chapter_ending',
          'chapterEnding',
          input.previousChapter?.id ?? null,
          input.continuityBridge ? 'must' : 'high',
          input.continuityBridge ? '本章必须直接承接上一章结尾 Bridge。' : '缺少已保存 Bridge，至少需要上一章结尾片段辅助衔接。',
          !input.continuityBridge
        ),
        contextNeed('hard_canon', 'hardCanon', input.project.id, 'must', '硬设定包用于约束不可违背世界规则、角色身份和系统规则。'),
        ...(storyDirectionText
          ? [
              contextNeed(
                'story_direction',
                'storyDirection',
                input.storyDirectionGuide?.id ?? null,
                'medium',
                '中期剧情导向用于选择本章推进方向，但不能覆盖硬状态和伏笔规则。'
              )
            ]
          : []),
        ...expectedCharacters.flatMap((character) => [
          contextNeed(
            'character_card',
            'character',
            character.characterId,
            character.expectedPresence === 'onstage' ? 'high' : 'medium',
            character.reason,
            character.expectedPresence !== 'onstage'
          ),
          contextNeed(
            'character_state',
            'character_state',
            character.characterId,
            character.expectedPresence === 'onstage' ? 'must' : 'high',
            `本章需要核对该角色的状态账本类别：${(requiredStateFactCategories[character.characterId] ?? []).join('、') || 'status'}。`
          )
        ]),
        ...unique(requiredForeshadowingIds).map((id) => {
          const item = input.foreshadowing.find((candidate) => candidate.id === id)
          const score = retrievalPriorities.find((priority) => priority.type === 'foreshadowing' && priority.id === id)?.priority ?? 70
          return contextNeed(
            'foreshadowing',
            'foreshadowing',
            id,
            item?.treatmentMode === 'payoff' || item?.weight === 'payoff' ? 'must' : priorityLevel(score),
            item ? `本章需要按 treatmentMode=${item.treatmentMode} 处理伏笔「${item.title}」。` : '本章任务要求处理该伏笔。'
          )
        }),
        ...unique(requiredTimelineEventIds).map((id) =>
          contextNeed(
            'timeline_anchor',
            'timeline',
            id,
            'high',
            '本章涉及已发生事件或出场角色的时间线锚点，需要防止顺序与因果错位。'
          )
        ),
        ...requiredWorldbuildingKeys.map((key) =>
          contextNeed(
            'world_rule',
            'worldbuilding',
            key,
            key === 'immutableFacts' ? 'must' : 'high',
            `本章任务涉及 ${key}，需要最小硬设定约束。`
          )
        ),
        ...(input.stageSummaries.length
          ? [
              contextNeed(
                'remote_stage_summary',
                'stageSummary',
                null,
                'low',
                '远期阶段摘要只用于压缩旧剧情背景，预算不足时可以优先压缩或省略。',
                true
              )
            ]
          : []),
        ...(input.previousChapter
          ? [contextNeed('recent_chapter_recap', 'recentChapter', input.previousChapter.id, 'medium', '近期章节回顾用于补充 Bridge 未覆盖的差异事实。')]
          : [])
      ],
      (item) => `${item.needType}:${item.sourceId ?? item.sourceHint}`
    )

    return {
      id: newId(),
      projectId: input.project.id,
      targetChapterOrder: input.targetChapterOrder,
      source: input.source ?? 'auto',
      chapterIntent: taskText || `准备第 ${input.targetChapterOrder} 章`,
      expectedSceneType: sceneType,
      expectedCharacters,
      requiredCharacterCardFields,
      requiredStateFactCategories,
      requiredForeshadowingIds: unique(requiredForeshadowingIds),
      forbiddenForeshadowingIds: unique(forbiddenForeshadowingIds),
      requiredTimelineEventIds: unique(requiredTimelineEventIds),
      requiredWorldbuildingKeys,
      mustCheckContinuity,
      retrievalPriorities,
      exclusionRules: unique(forbiddenForeshadowingIds).map((id) => ({
        type: 'foreshadowing',
        id,
        reason: '本章需求计划要求隐藏、暂停或禁止推进该伏笔。'
      })),
      warnings: input.previousChapter ? [] : ['缺少上一章，无法完整规划章节衔接需求。'],
      contextNeeds,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  }

  static inferRequiredCharacterFields(
    _character: Character,
    chapterTaskDraft: Partial<ChapterTask>,
    sceneType: ExpectedSceneType,
    expectedPresence: ExpectedPresence = 'onstage'
  ): CharacterCardField[] {
    if (expectedPresence !== 'onstage') return MINIMAL_FIELDS
    const text = combinedTaskText(chapterTaskDraft)
    let fields: CharacterCardField[]
    if (sceneType === 'relationship' || sceneType === 'dialogue') fields = RELATIONSHIP_FIELDS
    else if (sceneType === 'action') fields = ACTION_FIELDS
    else if (sceneType === 'investigation' || sceneType === 'reveal' || sceneType === 'payoff') fields = REVEAL_FIELDS
    else if (sceneType === 'transition' || sceneType === 'recovery') fields = TRANSITION_FIELDS
    else fields = ['roleFunction', 'surfaceGoal', 'decisionLogic', 'relationshipTension']

    if (containsAny(text, ['秘密', '欺骗', '隐瞒', '真相'])) fields.push('coreFear', 'futureHooks')
    if (containsAny(text, ['资源', '道具', '能力', '权限', '战斗'])) fields.push('abilitiesAndResources', 'weaknessAndCost')
    return unique(fields)
  }

  static inferRequiredStateCategories(
    _character: Character,
    chapterTaskDraft: Partial<ChapterTask>,
    sceneType: ExpectedSceneType
  ): StateFactCategory[] {
    const text = combinedTaskText(chapterTaskDraft)
    const categories: StateFactCategory[] = []
    if (sceneType === 'action') categories.push('physical', 'ability', 'inventory', 'location')
    if (sceneType === 'investigation' || sceneType === 'reveal' || sceneType === 'payoff') categories.push('knowledge', 'secret', 'inventory')
    if (sceneType === 'relationship' || sceneType === 'dialogue') categories.push('relationship', 'mental', 'promise')
    if (sceneType === 'transition') categories.push('location', 'goal')
    if (containsAny(text, ['交易', '购买', '资源', '钱', '筹码'])) categories.push('resource')
    if (containsAny(text, ['开门', '钥匙', '道具', '武器', '物品'])) categories.push('inventory')
    if (containsAny(text, ['移动', '抵达', '追踪', '逃亡', '地点'])) categories.push('location')
    if (containsAny(text, ['受伤', '伤势', '疲惫', '疼痛'])) categories.push('physical')
    if (containsAny(text, ['承诺', '契约', '债务', '誓言'])) categories.push('promise')
    return unique(categories.length ? categories : ['goal', 'status'])
  }

  static scoreRetrievalPriority(
    item: { type: ContextRetrievalPriorityType; id: ID },
    plan: { sceneType: ExpectedSceneType; taskText: string; expectedCharacterIds: ID[]; requiredForeshadowingIds: ID[] }
  ): number {
    let score = 35
    if (item.type === 'character_card' && plan.expectedCharacterIds.includes(item.id)) score += 32
    if (item.type === 'character_state' && plan.expectedCharacterIds.includes(item.id)) score += 38
    if (item.type === 'foreshadowing' && plan.requiredForeshadowingIds.includes(item.id)) score += 42
    if (item.type === 'timeline') score += plan.sceneType === 'transition' || plan.sceneType === 'investigation' ? 28 : 16
    if (item.type === 'story_bible') score += plan.sceneType === 'setup' || plan.sceneType === 'reveal' ? 24 : 12
    if (item.type === 'chapter_ending') score += 30
    return clampPriority(score)
  }

  private static inferContinuityChecks(
    task: Partial<ChapterTask>,
    sceneType: ExpectedSceneType,
    bridge: ChapterContinuityBridge | null
  ): ContinuityCheckCategory[] {
    const text = combinedTaskText(task)
    const checks: ContinuityCheckCategory[] = []
    if (bridge?.lastSceneLocation || sceneType === 'transition' || containsAny(text, ['地点', '抵达', '离开'])) checks.push('location')
    if (bridge?.lastPhysicalState || sceneType === 'action' || containsAny(text, ['受伤', '身体', '疼痛'])) checks.push('injury')
    if (containsAny(text, ['钱', '资源', '交易', '购买'])) checks.push('money')
    if (containsAny(text, ['物品', '道具', '钥匙', '武器'])) checks.push('inventory')
    if (sceneType === 'investigation' || sceneType === 'reveal' || containsAny(text, ['知道', '秘密', '真相'])) checks.push('knowledge')
    if (sceneType === 'relationship' || containsAny(text, ['关系', '信任', '承诺'])) checks.push('relationship')
    if (containsAny(text, ['承诺', '誓言', '约定'])) checks.push('promise')
    if (containsAny(text, ['能力', '系统', '权限', '冷却'])) checks.push('ability')
    checks.push('timeline')
    return unique(checks)
  }
}
