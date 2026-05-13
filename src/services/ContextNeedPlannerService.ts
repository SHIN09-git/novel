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
  HardCanonItem,
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
  hardCanonItems?: HardCanonItem[]
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

function priorityRank(priority: ContextNeedPriority): number {
  if (priority === 'must') return 4
  if (priority === 'high') return 3
  if (priority === 'medium') return 2
  return 1
}

function strongestPriority(priorities: ContextNeedPriority[]): ContextNeedPriority {
  return priorities.reduce((best, current) => (priorityRank(current) > priorityRank(best) ? current : best), 'low')
}

function stateCategoryPriority(category: StateFactCategory, sceneType: ExpectedSceneType, presence: ExpectedPresence): ContextNeedPriority {
  if (presence !== 'onstage') return category === 'knowledge' || category === 'relationship' ? 'medium' : 'low'
  if (category === 'physical' || category === 'ability' || category === 'inventory' || category === 'location') {
    return sceneType === 'action' || sceneType === 'transition' ? 'must' : 'high'
  }
  if (category === 'resource') return 'must'
  if (category === 'knowledge' || category === 'secret') return sceneType === 'investigation' || sceneType === 'reveal' || sceneType === 'payoff' ? 'must' : 'high'
  if (category === 'relationship' || category === 'mental' || category === 'promise') return sceneType === 'relationship' || sceneType === 'dialogue' ? 'high' : 'medium'
  return 'medium'
}

function stateCategoryReason(category: StateFactCategory, characterName: string, sceneType: ExpectedSceneType): string {
  const labels: Record<string, string> = {
    resource: '资源/金钱会影响本章行动成本，缺失时容易出现无来源消费或资源透支。',
    inventory: '持有物品会影响本章可用解法，缺失时容易使用未持有道具。',
    location: '当前位置会影响场景衔接，缺失时容易发生无解释跳转。',
    physical: '身体/伤势会影响行动能力，缺失时容易让伤势无解释消失。',
    mental: '心理状态会影响对话和决策，缺失时容易出现情绪断裂。',
    knowledge: '已知信息会限制角色能说什么、判断什么，缺失时容易知识泄露。',
    relationship: '关系状态会影响互动张力，缺失时容易让关系突然重置。',
    goal: '当前目标会约束本章行动方向，缺失时容易偏离章节任务。',
    promise: '承诺/债务会影响选择代价，缺失时容易被正文忽略。',
    secret: '秘密信息会限制揭露节奏，缺失时容易提前说破。',
    ability: '能力限制会约束解法，缺失时容易出现无代价开挂。',
    status: '当前状态会约束角色连续性，缺失时容易重置。',
    custom: '自定义状态被本章需求点名，需人工确认是否进入上下文。'
  }
  return `角色“${characterName}”在 ${sceneType} 场景中需要 ${category} 状态：${labels[category] ?? labels.custom}`
}

function foreshadowingNeedPriority(item: Foreshadowing, taskTextValue: string, allowedText: string): ContextNeedPriority {
  if (item.treatmentMode === 'payoff' || item.weight === 'payoff') return 'must'
  if (textMentions(allowedText, item.title)) return 'must'
  if (textMentions(taskTextValue, item.title)) return 'high'
  if (item.treatmentMode === 'advance' || item.treatmentMode === 'mislead') return 'high'
  if (item.treatmentMode === 'hint') return item.weight === 'high' ? 'high' : 'medium'
  return 'low'
}

function foreshadowingNeedReason(item: Foreshadowing, priority: ContextNeedPriority): string {
  const modeText = `treatmentMode=${item.treatmentMode}`
  if (priority === 'must') return `伏笔《${item.title}》需要作为 must 进入本章操作规则：${modeText}，权重=${item.weight}，避免提前回收或漏掉兑现。`
  if (priority === 'high') return `伏笔《${item.title}》与本章任务或中期导向相关：${modeText}，需要明确允许/禁止行为。`
  return `伏笔《${item.title}》可作为背景提醒：${modeText}，预算紧张时可低优先级处理。`
}

function timelineNeedReason(event: TimelineEvent): string {
  return `时间线锚点《${event.title}》与本章角色、任务或因果顺序相关，需要防止事件顺序、已知结果和后续影响错位。`
}

function hardCanonMatchesTask(item: HardCanonItem, text: string): boolean {
  return textMentions(text, item.title) || containsAny(text, [item.category, item.content.slice(0, 18)].filter(Boolean))
}

function hardCanonNeedPriority(item: HardCanonItem, text: string): ContextNeedPriority {
  if (item.priority === 'must') return 'must'
  if (item.priority === 'high' && hardCanonMatchesTask(item, text)) return 'high'
  if (item.category === 'world_rule' || item.category === 'system_rule' || item.category === 'prohibition') return item.priority === 'high' ? 'high' : 'medium'
  return hardCanonMatchesTask(item, text) ? 'medium' : 'low'
}

function hardCanonNeedReason(item: HardCanonItem, priority: ContextNeedPriority): string {
  if (priority === 'must') return `HardCanon《${item.title}》是不可违背硬设定，必须约束本章正文，防止普通摘要或模型临时发挥覆盖 canon。`
  if (priority === 'high') return `HardCanon《${item.title}》与本章任务/规则风险相关，应优先进入最小硬设定。`
  return `HardCanon《${item.title}》与本章存在弱相关，预算允许时进入；预算不足时可记录为低优先级。`
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
    const taskOnlyText = combinedTaskText(input.chapterTaskDraft)
    const storyDirectionText =
      input.storyDirectionPromptText ?? StoryDirectionService.formatForPrompt(input.storyDirectionGuide ?? null, input.targetChapterOrder)
    const taskText = [taskOnlyText, storyDirectionText].map(textValue).filter(Boolean).join('\n')
    const storyDirectionBeat = input.storyDirectionGuide
      ? StoryDirectionService.getBeatForChapter(input.storyDirectionGuide, input.targetChapterOrder)
      : null
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
      .map((item) => {
        const character = input.characters.find((candidate) => candidate.id === item.characterId)
        if (!character) return item
        if (textMentions(taskOnlyText, character.name)) {
          return {
            ...item,
            reason: '章节任务契约直接点名该角色，需要调用本章角色切片与状态账本。'
          }
        }
        if (textMentions(storyDirectionText, character.name)) {
          return {
            ...item,
            reason: '中期剧情导向提到该角色，需要作为本章推进方向的候选角色。'
          }
        }
        if (relatedCharacterIds.has(character.id)) {
          return {
            ...item,
            reason: '本章相关伏笔关联到该角色，需要防止伏笔推进时角色状态缺失。'
          }
        }
        return {
          ...item,
          reason: '主要角色默认进入低噪声校验范围，避免核心角色行为断裂。'
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

    for (const fact of input.characterStateFacts) {
      if (fact.status !== 'active') continue
      const expected = expectedCharacters.find((character) => character.characterId === fact.characterId)
      if (!expected) continue
      if (fact.trackingLevel !== 'hard' && fact.promptPolicy !== 'always') continue
      requiredStateFactCategories[fact.characterId] = unique([
        ...(requiredStateFactCategories[fact.characterId] ?? []),
        fact.category
      ])
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

    const hardCanonNeeds = (input.hardCanonItems ?? [])
      .filter((item) => item.status === 'active')
      .map((item) => {
        const priority = hardCanonNeedPriority(item, taskText)
        return contextNeed(
          'hard_canon',
          'hardCanon',
          item.id,
          priority,
          hardCanonNeedReason(item, priority),
          priority === 'low'
        )
      })
      .filter((need) => need.priority !== 'low')

    const storyDirectionNeeds = storyDirectionText
      ? [
          contextNeed(
            'story_direction',
            'storyDirection',
            input.storyDirectionGuide?.id ?? null,
            storyDirectionBeat ? 'high' : 'medium',
            storyDirectionBeat
              ? `中期剧情导向包含第 ${input.targetChapterOrder} 章节拍，应用于本章推进方向与章节任务补强。`
              : '中期剧情导向提供本章软性推进方向；未命中精确章节节拍，按中优先级使用。',
            !storyDirectionBeat
          )
        ]
      : []

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

    const strengthenedContextNeeds: ContextNeedItem[] = contextNeeds.map((need): ContextNeedItem => {
      if (need.needType === 'character_state' && need.sourceId) {
        const expected = expectedCharacters.find((character) => character.characterId === need.sourceId)
        const categories = requiredStateFactCategories[need.sourceId] ?? []
        const priority = strongestPriority(
          categories.map((category) => stateCategoryPriority(category, sceneType, expected?.expectedPresence ?? 'referenced'))
        )
        const reasons = categories.map((category) => stateCategoryReason(category, input.characters.find((character) => character.id === need.sourceId)?.name ?? '角色', sceneType))
        return {
          ...need,
          priority,
          uncertain: expected?.expectedPresence !== 'onstage',
          reason: `本章需要核对该角色状态账本类别：${categories.join('、') || 'status'}。${reasons.join('；') || expected?.reason || need.reason}`
        }
      }
      if (need.needType === 'foreshadowing' && need.sourceId) {
        const item = input.foreshadowing.find((candidate) => candidate.id === need.sourceId)
        if (!item) return need
        const priority = foreshadowingNeedPriority(item, taskText, textValue(input.chapterTaskDraft.allowedPayoffs))
        return {
          ...need,
          priority,
          reason: foreshadowingNeedReason(item, priority)
        }
      }
      if (need.needType === 'timeline_anchor' && need.sourceId) {
        const event = input.timelineEvents.find((candidate) => candidate.id === need.sourceId)
        if (!event) return need
        return {
          ...need,
          priority: 'high',
          reason: timelineNeedReason(event)
        }
      }
      return need
    })

    const prioritizedContextNeeds = uniqueByKey(
      [...hardCanonNeeds, ...storyDirectionNeeds, ...strengthenedContextNeeds],
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
      contextNeeds: prioritizedContextNeeds,
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
