import type {
  Character,
  CharacterCardField,
  CharacterStateFact,
  CharacterStateLog,
  Chapter,
  ChapterContinuityBridge,
  Foreshadowing,
  ForeshadowingTreatmentMode,
  ID,
  ContextCompressionRecord,
  ContextNeedPlan,
  PromptBlockOrderItem,
  PromptBuildInput,
  PromptConfig,
  PromptMode,
  StageSummary,
  TimelineEvent
} from '../../shared/types'

import { effectiveTreatmentMode, shouldRecommendForeshadowing, treatmentLabel, treatmentPromptRules } from '../../shared/foreshadowingTreatment'
import { fieldLine, parseChapterNumbersFromText, parseChapterRangesFromText, valueOrEmpty } from './promptUtils'

const MAX_PROMPT_FORESHADOWINGS = 10

const FORESHADOWING_WEIGHT_PRIORITY: Record<Foreshadowing['weight'], number> = {
  payoff: 4,
  high: 3,
  medium: 2,
  low: 1
}

const FORESHADOWING_STATUS_PRIORITY: Record<Foreshadowing['status'], number> = {
  partial: 4,
  unresolved: 3,
  resolved: 1,
  abandoned: 0
}

const FORESHADOWING_TREATMENT_PRIORITY: Record<ForeshadowingTreatmentMode, number> = {
  payoff: 5,
  advance: 4,
  mislead: 3,
  hint: 2,
  pause: 1,
  hidden: 0
}

export function formatForeshadowing(item: Foreshadowing, overrides?: PromptConfig['foreshadowingTreatmentOverrides']): string {
  const treatmentMode = effectiveTreatmentMode(item, overrides)
  const statusLabel = {
    unresolved: '未回收',
    partial: '部分推进',
    resolved: '已回收',
    abandoned: '废弃'
  }[item.status]

  const weightLabel = {
    low: '低',
    medium: '中',
    high: '高',
    payoff: '回收'
  }[item.weight]

  return [
    `### 【${item.title || '未命名伏笔'}】`,
    `状态：${statusLabel}`,
    `权重：${weightLabel}`,
    `当前处理方式：${treatmentLabel(treatmentMode)}`,
    `首次出现：第 ${valueOrEmpty(item.firstChapterOrder)} 章`,
    `预计回收：${valueOrEmpty(item.expectedPayoff)}`,
    `回收方式：${valueOrEmpty(item.payoffMethod)}`,
    `关联主线：${valueOrEmpty(item.relatedMainPlot)}`,
    `注意事项：${valueOrEmpty(item.notes)}`,
    '本章使用规则：',
    ...treatmentPromptRules(treatmentMode).map((rule) => `- ${rule}`)
  ].join('\n')
}

export function foreshadowingStatusLabel(status: Foreshadowing['status']): string {
  return {
    unresolved: '未回收',
    partial: '部分推进',
    resolved: '已回收',
    abandoned: '废弃'
  }[status]
}

export function foreshadowingWeightLabel(weight: Foreshadowing['weight']): string {
  return {
    low: '低',
    medium: '中',
    high: '高',
    payoff: '回收'
  }[weight]
}

export function treatmentGroupTitle(mode: ReturnType<typeof effectiveTreatmentMode>): string {
  if (mode === 'hint') return '允许暗示 hint'
  if (mode === 'advance') return '允许推进 advance'
  if (mode === 'mislead') return '允许误导 mislead'
  if (mode === 'payoff') return '允许回收 payoff'
  return '禁止提及 hidden / pause'
}

export function treatmentGroupInstruction(mode: ReturnType<typeof effectiveTreatmentMode>): string[] {
  if (mode === 'hint') return ['只能轻微暗示。', '不得解释来源。', '不得让角色直接说破。', '不得回收。']
  if (mode === 'advance') return ['可以出现新线索或增加压力。', '不得揭示最终真相。', '不得完成 payoff。']
  if (mode === 'mislead') return ['可以制造错误理解。', '不得改变事实真相。', '不得让误导变成真实设定。']
  if (mode === 'payoff') return ['可以揭示并兑现。', '必须对应已有铺垫。', '回收后要影响人物选择或剧情结果。']
  return ['默认不得主动出现。', '不得借角色对白说破。', '不得推进、解释、回收或变成新设定。']
}

function compareForeshadowingForPrompt(
  a: Foreshadowing,
  b: Foreshadowing,
  overrides?: Record<ID, ForeshadowingTreatmentMode>
): number {
  const statusDelta = FORESHADOWING_STATUS_PRIORITY[b.status] - FORESHADOWING_STATUS_PRIORITY[a.status]
  if (statusDelta !== 0) return statusDelta
  const weightDelta = FORESHADOWING_WEIGHT_PRIORITY[b.weight] - FORESHADOWING_WEIGHT_PRIORITY[a.weight]
  if (weightDelta !== 0) return weightDelta
  const treatmentDelta =
    FORESHADOWING_TREATMENT_PRIORITY[effectiveTreatmentMode(b, overrides)] -
    FORESHADOWING_TREATMENT_PRIORITY[effectiveTreatmentMode(a, overrides)]
  if (treatmentDelta !== 0) return treatmentDelta
  const orderDelta = (a.firstChapterOrder ?? Number.MAX_SAFE_INTEGER) - (b.firstChapterOrder ?? Number.MAX_SAFE_INTEGER)
  if (orderDelta !== 0) return orderDelta
  return a.title.localeCompare(b.title, 'zh-Hans-CN')
}

function limitForeshadowingsForPrompt(
  items: Foreshadowing[],
  overrides?: Record<ID, ForeshadowingTreatmentMode>
): Foreshadowing[] {
  return [...items].sort((a, b) => compareForeshadowingForPrompt(a, b, overrides)).slice(0, MAX_PROMPT_FORESHADOWINGS)
}

export function formatForeshadowingOperationTable(items: Foreshadowing[], config: PromptConfig): string {
  if (!items.length) return ''
  const grouped = items.reduce<Record<string, Foreshadowing[]>>((acc, item) => {
    const mode = effectiveTreatmentMode(item, config.foreshadowingTreatmentOverrides)
    const key = mode === 'hidden' || mode === 'pause' ? 'blocked' : mode
    acc[key] = [...(acc[key] ?? []), item]
    return acc
  }, {})
  const order: Array<'hint' | 'advance' | 'mislead' | 'payoff' | 'blocked'> = ['hint', 'advance', 'mislead', 'payoff', 'blocked']
  return order
    .filter((key) => grouped[key]?.length)
    .map((key) => {
      const mode = key === 'blocked' ? 'hidden' : key
      const header = [
        `### ${treatmentGroupTitle(mode)}`,
        '组内规则：',
        ...treatmentGroupInstruction(mode).map((rule) => `- ${rule}`)
      ].join('\n')
      const entries = [...grouped[key]]
        .sort((a, b) => compareForeshadowingForPrompt(a, b, config.foreshadowingTreatmentOverrides))
        .map((item) => {
          const actualMode = effectiveTreatmentMode(item, config.foreshadowingTreatmentOverrides)
          const isOverride = Boolean(config.foreshadowingTreatmentOverrides?.[item.id])
          const isBlocked = actualMode === 'hidden' || actualMode === 'pause'
          return [
            `- 【${item.title || '未命名伏笔'}】`,
            `  - 状态：${foreshadowingStatusLabel(item.status)}；权重：${foreshadowingWeightLabel(item.weight)}；处理方式：${treatmentLabel(actualMode)}${isOverride ? '（本章 override / 手动强选）' : ''}`,
            valueOrEmpty(item.firstChapterOrder) ? `  - 首次出现：第 ${valueOrEmpty(item.firstChapterOrder)} 章` : '',
            fieldLine('  - 预计回收方向：', item.expectedPayoff),
            fieldLine('  - 回收方式：', item.payoffMethod),
            fieldLine('  - 关联主线：', item.relatedMainPlot),
            isBlocked && isOverride ? '  - 本章限制：虽被手动强选，但仍应保持暂停/隐藏，不主动推进、不解释、不回收。' : '',
            fieldLine('  - 注意事项：', item.notes)
          ]
            .filter(Boolean)
            .join('\n')
        })
        .join('\n')
      return `${header}\n${entries}`
    })
    .join('\n\n')
}

function expectedPayoffNear(item: Foreshadowing, targetChapterOrder: number): boolean {
  const ranges = parseChapterRangesFromText(item.expectedPayoff)
  if (ranges.some((range) => targetChapterOrder >= range.start - 3 && targetChapterOrder <= range.end + 3)) {
    return true
  }

  const numbers = parseChapterNumbersFromText(item.expectedPayoff)
  return numbers.some((num) => Math.abs(num - targetChapterOrder) <= 3)
}

export function uniqueById<T extends { id: ID }>(items: T[]): T[] {
  const seen = new Set<ID>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function automaticForeshadowings(items: Foreshadowing[], targetChapterOrder: number): Foreshadowing[] {
  return items.filter((item) => shouldRecommendForeshadowing(item, expectedPayoffNear(item, targetChapterOrder)))
}

export function selectedForeshadowings(items: Foreshadowing[], targetChapterOrder: number, config: PromptConfig): Foreshadowing[] {
  void targetChapterOrder
  if (!config.modules.foreshadowing) return []
  const selectedIds = new Set(config.selectedForeshadowingIds)
  return limitForeshadowingsForPrompt(
    items.filter((item) => selectedIds.has(item.id)),
    config.foreshadowingTreatmentOverrides
  )
}

function automaticCharacters(characters: Character[], foreshadowings: Foreshadowing[]): Character[] {
  const relatedIds = new Set(foreshadowings.flatMap((item) => item.relatedCharacterIds))
  return characters.filter((character) => character.isMain || relatedIds.has(character.id))
}

export function selectedCharacters(characters: Character[], foreshadowings: Foreshadowing[], config: PromptConfig): Character[] {
  void foreshadowings
  if (!config.modules.characters) return []
  const selectedIds = new Set(config.selectedCharacterIds)
  return characters.filter((character) => selectedIds.has(character.id))
}
