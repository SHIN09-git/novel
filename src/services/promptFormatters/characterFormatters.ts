import type { Character, CharacterCardField, CharacterStateFact, CharacterStateLog, Chapter, ID, ContextNeedPlan } from '../../shared/types'

import { CharacterStateService } from '../CharacterStateService'
import { characterFieldValue } from '../characterState/cardFields'
import { writingCardAtChapter } from '../characterState/writingCard'
export { characterFieldValue } from '../characterState/cardFields'
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

export function formatWritingCards(characters: Character[], facts: CharacterStateFact[], logs: CharacterStateLog[],
  plan: ContextNeedPlan | null, target: number, chapters: Chapter[], completeSourceIndex: boolean) {
  const byId = new Map(chapters.map(ch => [ch.id, ch]))
  const historicalProjects = new Set(chapters.filter(ch => !ch.archivedAt?.trim() && ch.body?.trim() && ch.order >= target).map(ch => ch.projectId))
  const ids = new Set(characters.map(c => c.id))
  const byCharacter = new Map<ID, CharacterStateLog[]>()
  const byFactOwner = new Map<ID, CharacterStateFact[]>()
  for (const fact of facts) {
    const list = byFactOwner.get(fact.characterId)
    if (list) list.push(fact)
    else byFactOwner.set(fact.characterId, [fact])
  }
  for (const log of logs) {
    if (!ids.has(log.characterId)) continue
    const ch = log.chapterId ? byId.get(log.chapterId) : undefined
    const order = ch?.order ?? log.chapterOrder
    if (ch?.archivedAt?.trim() || (ch && ch.projectId !== log.projectId) || (completeSourceIndex && log.chapterId && !ch) ||
      (order ?? 0) > target || (!order && historicalProjects.has(log.projectId))) continue
    const row = { ...log, chapterOrder: ch?.order ?? log.chapterOrder }
    const list = byCharacter.get(log.characterId)
    if (list) list.push(row)
    else byCharacter.set(log.characterId, [row])
  }
  const cardWarnings = new Set<string>()
  const text = characters.map(c => {
    const { card, cleanLog, warnings } = writingCardAtChapter(c, byFactOwner.get(c.id) ?? [], target, historicalProjects.has(c.projectId))
    const recent = (byCharacter.get(c.id) ?? []).filter(l => l.projectId === c.projectId).flatMap(log => {
      const note = cleanLog(log.note)
      return note ? [{ ...log, note }] : []
    })
    for (const w of warnings) cardWarnings.add(w)
    return plan ? formatCharacterNeedSlice(card, recent, plan) : formatCharacter(card, recent)
  }).join('\n\n')
  return { text, cardWarnings }
}

export function formatCharacter(character: Character, logs: CharacterStateLog[]): string {
  const lines = [
    `### ${character.name || '未命名角色'}${character.isMain ? '（主要角色）' : ''}`,
    `本章定位：${characterFieldValue(character, 'roleFunction')}`,
    `当前表层目标：${valueOrEmpty(character.surfaceGoal)}`,
    `当前知道的信息：${valueOrEmpty(character.knownInformation)}`,
    `当前不知道的信息：${valueOrEmpty(character.unknownInformation)}`,
    character.abilitiesAndResources?.trim() ? `能力与资源：${characterFieldValue(character, 'abilitiesAndResources')}` : '',
    character.weaknessAndCost?.trim() ? `弱点与代价：${characterFieldValue(character, 'weaknessAndCost')}` : '',
    `当前情绪/关系状态：${[valueOrEmpty(character.emotionalState), characterFieldValue(character, 'relationshipTension')].filter(Boolean).join('；')}`,
    `本章可行动作或行为倾向：${characterFieldValue(character, 'decisionLogic')}`,
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

  const fieldLines = fields
    .map((field) => {
      const value = valueOrEmpty(characterFieldValue(character, field))
      return value ? `- ${characterFieldLabel(field)}：${value}` : ''
    })
    .filter(Boolean)
  if (fieldLines.length > 0) {
    lines.push(
      '本章需要关注的角色卡字段：',
      ...fieldLines
    )
  }

  if (categories.length > 0) {
    lines.push('本章状态账本类别：', ...categories.map((category) => `- ${category}`))
  }

  if (recentLogs.length > 0) {
    lines.push(
      '近期历史日志：',
      ...recentLogs.map((log) => `- ${log.chapterOrder ? `第 ${log.chapterOrder} 章` : '未关联章节'}：${log.note}`)
    )
  }

  const writingConstraints = [
    valueOrEmpty(character.emotionalState) ? `- 不得违背该角色当前状态：${valueOrEmpty(character.emotionalState)}` : '',
    characterFieldValue(character, 'relationshipTension') ? `- 不得忽略关系状态：${characterFieldValue(character, 'relationshipTension')}` : '',
    valueOrEmpty(character.forbiddenWriting) ? `- 不得触发禁止写法：${valueOrEmpty(character.forbiddenWriting)}` : ''
  ].filter(Boolean)
  if (writingConstraints.length > 0) lines.push('写作约束：', ...writingConstraints)

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
  const source = fact.sourceChapterOrder ? `来源：第 ${fact.sourceChapterOrder} 章。` :
    fact.currentAsOfChapter ? '当前手工状态，未注明生效章。' : ''
  const policy = fact.trackingLevel === 'hard' ? '硬状态' : fact.trackingLevel === 'soft' ? '软状态' : '备注'
  return `- ${fact.label}：${value}${unit}。（${[policy, source].filter(Boolean).join('；')}）`
}

export function formatCharacterStateLedgerSlice(
  characters: Character[],
  selectedFacts: CharacterStateFact[]
): string {
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
