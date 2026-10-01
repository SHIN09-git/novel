import type {
  ChapterContinuityBridge,
  ChapterTask,
  Character,
  CharacterCardField,
  CharacterNeedInvolvement,
  CharacterRoleInChapter,
  ContextNeedItem,
  ContextNeedPriority,
  ContextNeedSourceHint,
  ContextRetrievalPriorityType,
  ContinuityCheckCategory,
  ExpectedPresence,
  ExpectedSceneType,
  Foreshadowing,
  HardCanonItem,
  ID,
  StateFactCategory
} from '../../shared/types'

export const RELATIONSHIP_FIELDS: CharacterCardField[] = ['relationshipTension', 'coreFear', 'deepNeed', 'decisionLogic']
export const ACTION_FIELDS: CharacterCardField[] = ['abilitiesAndResources', 'weaknessAndCost', 'decisionLogic', 'surfaceGoal']
export const REVEAL_FIELDS: CharacterCardField[] = ['deepNeed', 'coreFear', 'futureHooks', 'decisionLogic']
export const TRANSITION_FIELDS: CharacterCardField[] = ['surfaceGoal', 'roleFunction', 'futureHooks']
export const MINIMAL_FIELDS: CharacterCardField[] = ['roleFunction']

export function newNeedPlanId(): ID {
  return `need-${crypto.randomUUID()}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function textValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

const NEGATIVE_TASK_MARKERS = ['不得', '不要', '禁止', '不能', '不可', '不应', '避免']

function taskTextFragments(task: Partial<ChapterTask>): string[] {
  return [
    task.goal,
    task.conflict,
    task.suspenseToKeep,
    task.allowedPayoffs,
    task.endingHook,
    task.readerEmotion,
    task.targetWordCount,
    task.styleRequirement
  ]
    .map(textValue)
    .flatMap((value) => value.split(/[。！？；\n，,]+|(?:但是|但|不过|然而)/))
    .map((value) => value.trim())
    .filter(Boolean)
}

export function negativeTaskText(task: Partial<ChapterTask>): string {
  return taskTextFragments(task).filter((fragment) => containsAny(fragment, NEGATIVE_TASK_MARKERS)).join('\n')
}

export function combinedTaskText(task: Partial<ChapterTask>): string {
  return taskTextFragments(task).filter((fragment) => !containsAny(fragment, NEGATIVE_TASK_MARKERS)).join('\n')
}

export function containsAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase()
  return words.some((word) => lower.includes(word.toLowerCase()))
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

export function uniqueByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyOf(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function clampPriority(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function priorityLevel(score: number): ContextNeedPriority {
  if (score >= 86) return 'must'
  if (score >= 70) return 'high'
  if (score >= 45) return 'medium'
  return 'low'
}

export function contextNeed(
  needType: string,
  sourceHint: ContextNeedSourceHint,
  sourceId: ID | null,
  priority: ContextNeedPriority,
  reason: string,
  uncertain = false
): ContextNeedItem {
  let reasonHash = 2166136261
  for (let index = 0; index < reason.length; index += 1) {
    reasonHash ^= reason.charCodeAt(index)
    reasonHash = Math.imul(reasonHash, 16777619)
  }
  return {
    id: `need-item-${needType}-${sourceId ?? sourceHint}-${(reasonHash >>> 0).toString(36)}`,
    needType,
    sourceHint,
    sourceId,
    priority,
    reason,
    uncertain
  }
}

export function priorityRank(priority: ContextNeedPriority): number {
  if (priority === 'must') return 4
  if (priority === 'high') return 3
  if (priority === 'medium') return 2
  return 1
}

export function strongestPriority(priorities: ContextNeedPriority[]): ContextNeedPriority {
  return priorities.reduce((best, current) => (priorityRank(current) > priorityRank(best) ? current : best), 'low')
}

export function stateCategoryPriority(category: StateFactCategory, sceneType: ExpectedSceneType, presence: ExpectedPresence): ContextNeedPriority {
  if (presence !== 'onstage') return category === 'knowledge' || category === 'relationship' ? 'medium' : 'low'
  if (category === 'physical' || category === 'ability' || category === 'inventory' || category === 'location') {
    return sceneType === 'action' || sceneType === 'transition' ? 'must' : 'high'
  }
  if (category === 'resource') return 'must'
  if (category === 'knowledge' || category === 'secret') return sceneType === 'investigation' || sceneType === 'reveal' || sceneType === 'payoff' ? 'must' : 'high'
  if (category === 'relationship' || category === 'mental' || category === 'promise') return sceneType === 'relationship' || sceneType === 'dialogue' ? 'high' : 'medium'
  return 'medium'
}

export function stateCategoryReason(category: StateFactCategory, characterName: string, sceneType: ExpectedSceneType): string {
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
    custom: '自定义状态被本章需求点名，需要人工确认是否进入上下文。'
  }
  return `角色“${characterName}”在 ${sceneType} 场景中需要 ${category} 状态：${labels[category] ?? labels.custom}`
}

export function foreshadowingNeedPriority(item: Foreshadowing, taskTextValue: string, allowedText: string): ContextNeedPriority {
  if (item.treatmentMode === 'payoff' || item.weight === 'payoff') return 'must'
  if (textMentions(allowedText, item.title)) return 'must'
  if (textMentions(taskTextValue, item.title)) return 'high'
  if (item.treatmentMode === 'advance' || item.treatmentMode === 'mislead') return 'high'
  if (item.treatmentMode === 'hint') return item.weight === 'high' ? 'high' : 'medium'
  return 'low'
}

export function foreshadowingNeedReason(item: Foreshadowing, priority: ContextNeedPriority): string {
  const modeText = `treatmentMode=${item.treatmentMode}`
  if (priority === 'must') return `伏笔《${item.title}》需要作为 must 进入本章操作规则，${modeText}，权重 ${item.weight}，避免提前回收或漏掉兑现。`
  if (priority === 'high') return `伏笔《${item.title}》与本章任务或中期导向相关：${modeText}，需要明确允许/禁止行为。`
  return `伏笔《${item.title}》可作为背景提醒，${modeText}，预算紧张时可低优先级处理。`
}

export function timelineNeedReason(event: TimelineEventLike): string {
  return `时间线锚点《${event.title}》与本章角色、任务或因果顺序相关，需要防止事件顺序、已知结果和后续影响错位。`
}

type TimelineEventLike = Pick<import('../../shared/types').TimelineEvent, 'title'>

export function hardCanonMatchesTask(item: HardCanonItem, text: string): boolean {
  return textMentions(text, item.title) || containsAny(text, [item.category, item.content.slice(0, 18)].filter(Boolean))
}

export function hardCanonNeedPriority(item: HardCanonItem, text: string): ContextNeedPriority {
  if (item.category === 'style_boundary') return item.priority === 'must' || item.priority === 'high' ? 'high' : 'medium'
  if (item.priority === 'must') return 'must'
  if (item.priority === 'high' && hardCanonMatchesTask(item, text)) return 'high'
  if (item.category === 'world_rule' || item.category === 'system_rule' || item.category === 'prohibition') return item.priority === 'high' ? 'high' : 'medium'
  return hardCanonMatchesTask(item, text) ? 'medium' : 'low'
}

export function hardCanonNeedReason(item: HardCanonItem, priority: ContextNeedPriority): string {
  if (priority === 'must') return `HardCanon《${item.title}》是不可违背硬设定，必须约束本章正文，防止普通摘要或模型临时发挥覆盖 canon。`
  if (priority === 'high') return `HardCanon《${item.title}》与本章任务/规则风险相关，应优先进入最小硬设定。`
  return `HardCanon《${item.title}》与本章存在弱相关，预算允许时进入；预算不足时可记录为低优先级。`
}

export function inferSceneType(task: Partial<ChapterTask>, continuityBridge: ChapterContinuityBridge | null): ExpectedSceneType {
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
  return 'custom'
}

export function textMentions(text: string, value: string | null | undefined): boolean {
  const target = textValue(value)
  return target.length >= 2 && text.includes(target)
}

export function inferRoleInChapter(character: Character, taskText: string): CharacterRoleInChapter {
  if (containsAny(taskText, [`${character.name}第一人称`, `${character.name}视角`, `以${character.name}为主角`])) return 'protagonist'
  if (character.isMain && /主角|主人公|protagonist/i.test(character.role)) return 'protagonist'
  if (/反派|敌|对手|antagonist/i.test(character.role) || containsAny(taskText, [`对抗${character.name}`, `${character.name}阻止`])) return 'antagonist'
  if (/盟友|同伴|搭档|ally/i.test(character.role)) return 'ally'
  if (/证人|目击|witness/i.test(character.role)) return 'witness'
  return character.isMain ? 'ally' : 'support'
}

export function inferRequiredCharacterFields(
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

export function inferRequiredStateCategories(
  _character: Character,
  chapterTaskDraft: Partial<ChapterTask>,
  sceneType: ExpectedSceneType,
  expectedPresence: ExpectedPresence = 'onstage',
  involvement: CharacterNeedInvolvement = 'present',
  stateCheckRequired = expectedPresence === 'onstage' || involvement === 'must_act'
): StateFactCategory[] {
  const text = combinedTaskText(chapterTaskDraft)
  const categories: StateFactCategory[] = []
  const activeParticipant = expectedPresence === 'onstage' || involvement === 'must_act'
  if (!activeParticipant && !stateCheckRequired) return []
  if (activeParticipant && sceneType === 'action') categories.push('physical', 'ability', 'inventory', 'location')
  if (activeParticipant && (sceneType === 'investigation' || sceneType === 'reveal' || sceneType === 'payoff')) categories.push('knowledge', 'secret', 'inventory')
  if (activeParticipant && (sceneType === 'relationship' || sceneType === 'dialogue')) categories.push('relationship', 'mental', 'promise')
  if (activeParticipant && sceneType === 'transition') categories.push('location', 'goal')
  if (containsAny(text, ['交易', '购买', '资源', '钱', '筹码'])) categories.push('resource')
  if (containsAny(text, ['开门', '钥匙', '道具', '武器', '物品'])) categories.push('inventory')
  if (containsAny(text, ['移动', '抵达', '追踪', '逃亡', '地点'])) categories.push('location')
  if (containsAny(text, ['受伤', '伤势', '疲惫', '疼痛'])) categories.push('physical')
  if (containsAny(text, ['承诺', '契约', '债务', '誓言'])) categories.push('promise')
  if (containsAny(text, ['知道', '得知', '秘密', '真相', '隐瞒'])) categories.push('knowledge', 'secret')
  if (containsAny(text, ['关系', '信任', '怀疑', '背叛', '和解'])) categories.push('relationship', 'mental')
  if (containsAny(text, ['能力', '权限', '冷却', '代价'])) categories.push('ability')
  if (categories.length > 0) return unique(categories)
  return activeParticipant || stateCheckRequired ? ['goal', 'status'] : []
}

export function scoreRetrievalPriority(
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

export function inferContinuityChecks(
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
