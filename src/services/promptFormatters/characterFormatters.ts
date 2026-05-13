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

import { CharacterStateService } from '../CharacterStateService'
import { valueOrEmpty } from './promptUtils'

function recentCharacterLogs(characterId: ID, logs: CharacterStateLog[]): CharacterStateLog[] {
  return logs
    .filter((log) => log.characterId === characterId)
    .sort((a, b) => {
      const chapterDelta = (b.chapterOrder ?? -1) - (a.chapterOrder ?? -1)
      if (chapterDelta !== 0) return chapterDelta
      return b.createdAt.localeCompare(a.createdAt)
    })
    .slice(0, 3)
}

export function formatCharacter(character: Character, logs: CharacterStateLog[]): string {
  const lines = [
    `### ${character.name || '未命名角色'}${character.isMain ? '（主要角色）' : ''}`,
    `本章定位：${valueOrEmpty(character.role)}`,
    `当前表层目标：${valueOrEmpty(character.surfaceGoal)}`,
    `当前知道的信息：${valueOrEmpty(character.knownInformation)}`,
    `当前不知道的信息：${valueOrEmpty(character.unknownInformation)}`,
    `当前情绪/关系状态：${[valueOrEmpty(character.emotionalState), valueOrEmpty(character.protagonistRelationship)].filter(Boolean).join('；')}`,
    `本章可行动作或行为倾向：${valueOrEmpty(character.nextActionTendency)}`,
    `禁止写法：${valueOrEmpty(character.forbiddenWriting)}`
  ]

  const recentLogs = recentCharacterLogs(character.id, logs)
  if (recentLogs.length > 0) {
    lines.push(
      '最近状态更新：',
      ...recentLogs.map((log) => `- ${log.chapterOrder ? `第 ${log.chapterOrder} 章` : '未关联章节'}：${log.note}`)
    )
  }

  return lines.join('\n')
}

export function characterFieldLabel(field: CharacterCardField): string {
  const labels: Record<CharacterCardField, string> = {
    roleFunction: '角色定位',
    surfaceGoal: '表层目标',
    deepNeed: '深层需求',
    coreFear: '核心恐惧',
    decisionLogic: '行动逻辑',
    abilitiesAndResources: '能力与资源',
    weaknessAndCost: '弱点与代价',
    relationshipTension: '关系张力',
    futureHooks: '后续钩子'
  }
  return labels[field]
}

export function characterFieldValue(character: Character, field: CharacterCardField): string {
  if (field === 'roleFunction') return character.role
  if (field === 'surfaceGoal') return character.surfaceGoal
  if (field === 'deepNeed') return character.deepDesire
  if (field === 'coreFear') return character.coreFear
  if (field === 'decisionLogic') return [character.nextActionTendency, character.selfDeception].filter(Boolean).join('；')
  if (field === 'abilitiesAndResources') return character.knownInformation
  if (field === 'weaknessAndCost') return [character.coreFear, character.forbiddenWriting].filter(Boolean).join('；')
  if (field === 'relationshipTension') return character.protagonistRelationship
  return character.nextActionTendency
}

export function formatCharacterNeedSlice(character: Character, logs: CharacterStateLog[], plan: ContextNeedPlan): string {
  const expected = plan.expectedCharacters.find((item) => item.characterId === character.id)
  const fields = plan.requiredCharacterCardFields[character.id] ?? []
  const categories = plan.requiredStateFactCategories[character.id] ?? []
  const recentLogs = recentCharacterLogs(character.id, logs)
  const lines = [
    `### ${character.name || '未命名角色'}${character.isMain ? '（主要角色）' : ''}`,
    `本章出场方式：${expected?.expectedPresence ?? 'onstage'}`,
    `本章角色功能：${expected?.roleInChapter ?? 'support'}`,
    `选择原因：${expected?.reason || '本章需求计划要求核对该角色。'}`
  ]

  if (fields.length > 0) {
    lines.push(
      '本章需要关注的角色卡字段：',
      ...fields.map((field) => `- ${characterFieldLabel(field)}：${valueOrEmpty(characterFieldValue(character, field))}`)
    )
  }

  if (categories.length > 0) {
    lines.push('本章状态账本类别：', ...categories.map((category) => `- ${category}`))
  }

  if (recentLogs.length > 0) {
    lines.push(
      '最近状态事实：',
      ...recentLogs.map((log) => `- ${log.chapterOrder ? `第 ${log.chapterOrder} 章` : '未关联章节'}：${log.note}`)
    )
  }

  lines.push(
    '写作约束：',
    `- 不得违背该角色当前状态：${valueOrEmpty(character.emotionalState)}`,
    `- 不得忽略关系状态：${valueOrEmpty(character.protagonistRelationship)}`,
    `- 不得触发禁止写法：${valueOrEmpty(character.forbiddenWriting)}`
  )

  return lines.join('\n')
}

function stateCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    resource: '资源',
    inventory: '持有物品',
    location: '当前位置',
    physical: '身体状态',
    mental: '心理状态',
    knowledge: '已知信息',
    relationship: '关系状态',
    goal: '当前目标',
    promise: '承诺/债务',
    secret: '秘密',
    ability: '能力限制',
    status: '状态',
    custom: '自定义'
  }
  return labels[category] ?? category
}

export function formatStateFact(fact: CharacterStateFact): string {
  const value = CharacterStateService.formatFactValue(fact.value)
  const unit = fact.unit ? ` ${fact.unit}` : ''
  const source = fact.sourceChapterOrder ? `来源：第 ${fact.sourceChapterOrder} 章。` : ''
  const policy = fact.trackingLevel === 'hard' ? '硬状态' : fact.trackingLevel === 'soft' ? '软状态' : '备注'
  return `- ${fact.label}：${value}${unit}。（${[policy, source].filter(Boolean).join('；')}）`
}

export function formatCharacterStateLedgerSlice(
  characters: Character[],
  facts: CharacterStateFact[],
  plan: ContextNeedPlan | null,
  targetChapterOrder: number
): string {
  const characterIds = characters.map((character) => character.id)
  const selectedFacts = CharacterStateService.getRelevantCharacterStatesForPrompt(characterIds, plan, targetChapterOrder, facts)
  if (!selectedFacts.length) return ''
  const names = new Map(characters.map((character) => [character.id, character.name || '未命名角色']))
  const grouped = selectedFacts.reduce<Record<ID, CharacterStateFact[]>>((acc, fact) => {
    acc[fact.characterId] = [...(acc[fact.characterId] ?? []), fact]
    return acc
  }, {})
  return Object.entries(grouped)
    .map(([characterId, items]) => {
      const byCategory = items.reduce<Record<string, CharacterStateFact[]>>((acc, fact) => {
        acc[fact.category] = [...(acc[fact.category] ?? []), fact]
        return acc
      }, {})
      const categoryText = Object.entries(byCategory)
        .map(([category, categoryFacts]) => [`${stateCategoryLabel(category)}：`, ...categoryFacts.map(formatStateFact)].join('\n'))
        .join('\n')
      return [
        `### 角色：${names.get(characterId) ?? '未知角色'}`,
        categoryText,
        '写作约束：',
        '- 不得让角色花费超过当前余额，除非正文交代收入、借款、赊账、偷取或其他合理来源。',
        '- 不得让角色使用未持有物品。',
        '- 不得让角色知道尚未记录为已知的信息或秘密。',
        '- 不得让伤势、能力限制、位置和承诺无解释消失。'
      ].join('\n')
    })
    .join('\n\n')
}
