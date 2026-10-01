import type { Character, CharacterStateFact, ID } from '../../shared/types'
import { normalizeStateList, stateValueToText } from './stateValue'

export interface StateValidationIssue {
  type:
    | 'resource_underflow'
    | 'missing_inventory'
    | 'injury_reset'
    | 'knowledge_leak'
    | 'ability_overuse'
    | 'location_jump'
    | 'promise_ignored'
    | 'state_conflict'
  factId: ID
  characterId: ID
  description: string
  evidence: string
}

function sentenceAround(text: string, index: number, radius = 100): string {
  const startBoundary = Math.max(text.lastIndexOf('。', index), text.lastIndexOf('\n', index), index - radius)
  const nextPeriod = text.indexOf('。', index)
  const nextLine = text.indexOf('\n', index)
  const candidates = [nextPeriod, nextLine, index + radius].filter((value) => value >= index)
  return text.slice(Math.max(0, startBoundary + 1), Math.min(text.length, Math.min(...candidates) + 1))
}

function appliesToCharacter(sentence: string, character: Character | undefined, characterCount: number): boolean {
  return !character?.name || characterCount === 1 || sentence.includes(character.name)
}

function normalizedFactValue(fact: CharacterStateFact): string {
  return JSON.stringify(fact.value)
}

function unknownKnowledgePhrases(character: Character | undefined, facts: CharacterStateFact[]): Array<{ factId: ID; phrase: string }> {
  const entries: Array<{ factId: ID; phrase: string }> = []
  const unknown = character?.unknownInformation?.trim()
  if (unknown) entries.push({ factId: facts[0]?.id ?? character!.id, phrase: unknown })
  for (const fact of facts.filter((item) => item.category === 'knowledge' || item.category === 'secret')) {
    const value = stateValueToText(fact.value)
    if (/(不知道|未知|未得知|不知情|尚未知道)/.test(`${fact.label} ${value} ${fact.evidence}`)) {
      entries.push({ factId: fact.id, phrase: `${fact.label} ${value}` })
    }
  }
  return entries
    .map((entry) => ({ ...entry, phrase: entry.phrase.replace(/^(当前)?(不知道|未知|未得知|不知情|尚未知道)[：:，,\s]*/, '').replace(/[。；;]+$/, '').trim() }))
    .filter((entry) => entry.phrase.length >= 4)
}

function phraseAppears(text: string, phrase: string): boolean {
  if (text.includes(phrase)) return true
  const tokens = phrase.split(/[，,。；;、\s]+/).filter((item) => item.length >= 3)
  return tokens.length > 0 && tokens.some((token) => text.includes(token))
}

export function validateCharacterStateInText(
  chapterText: string,
  facts: CharacterStateFact[],
  characters: Character[] = []
): StateValidationIssue[] {
  const issues: StateValidationIssue[] = []
  const text = chapterText || ''
  const hardFacts = facts.filter((item) => item.status === 'active' && item.trackingLevel === 'hard')
  const characterIds = [...new Set(hardFacts.map((fact) => fact.characterId))]

  for (const characterId of characterIds) {
    const characterFacts = hardFacts.filter((fact) => fact.characterId === characterId)
    const character = characters.find((item) => item.id === characterId)
    const byStateKey = new Map<string, CharacterStateFact[]>()
    for (const fact of characterFacts) {
      const key = `${fact.category}:${fact.key}`
      byStateKey.set(key, [...(byStateKey.get(key) ?? []), fact])
    }
    for (const duplicateFacts of byStateKey.values()) {
      if (new Set(duplicateFacts.map(normalizedFactValue)).size <= 1) continue
      issues.push({
        type: 'state_conflict',
        factId: duplicateFacts[0].id,
        characterId,
        description: `${character?.name ?? '角色'}存在互相冲突的活动状态事实。`,
        evidence: duplicateFacts.map((fact) => `${fact.label}=${stateValueToText(fact.value)}`).join('；')
      })
    }

    const cashFact = characterFacts.find(
      (fact) => fact.category === 'resource' && typeof fact.value === 'number' && /(现金|余额|金币|cash|money)/i.test(`${fact.key} ${fact.label}`)
    ) ?? characterFacts.find((fact) => fact.category === 'resource' && typeof fact.value === 'number')
    if (cashFact && typeof cashFact.value === 'number') {
      for (const match of text.matchAll(/(花费|支付|买下|购买|付了|花了)\s*([0-9]+(?:\.[0-9]+)?)/g)) {
        const sentence = sentenceAround(text, match.index ?? 0)
        if (!appliesToCharacter(sentence, character, characterIds.length)) continue
        const amount = Number(match[2])
        if (Number.isFinite(amount) && amount > cashFact.value && !/收入|借|赊|偷|抢|预支/.test(sentence)) {
          issues.push({
            type: 'resource_underflow',
            factId: cashFact.id,
            characterId,
            description: `${cashFact.label}不足，正文出现超额支出。`,
            evidence: match[0]
          })
        }
      }
    }

    const inventoryFacts = characterFacts.filter((fact) => fact.category === 'inventory')
    const ownedItems = [...new Set(inventoryFacts.flatMap((fact) => normalizeStateList(fact.value)))]
    if (inventoryFacts.length) {
      for (const match of text.matchAll(/使用了?([^，。、“”\s]{2,12}(钥匙|地图|剑|枪|药|戒指|令牌|笔记|书))/g)) {
        const sentence = sentenceAround(text, match.index ?? 0)
        if (!appliesToCharacter(sentence, character, characterIds.length)) continue
        const item = match[1]
        if (!ownedItems.some((owned) => item.includes(owned) || owned.includes(item))) {
          issues.push({
            type: 'missing_inventory',
            factId: inventoryFacts[0].id,
            characterId,
            description: `正文使用了未记录持有的物品：${item}`,
            evidence: item
          })
        }
      }
    }

    for (const unknown of unknownKnowledgePhrases(character, characterFacts)) {
      if (!phraseAppears(text, unknown.phrase)) continue
      const index = Math.max(0, text.indexOf(unknown.phrase.split(/[，,。；;、\s]+/).find((item) => item.length >= 3) ?? unknown.phrase))
      const sentence = sentenceAround(text, index, 140)
      if (!appliesToCharacter(sentence, character, characterIds.length) || !/(知道|明白|意识到|说出|道破|确认|认出)/.test(sentence)) continue
      issues.push({
        type: 'knowledge_leak',
        factId: unknown.factId,
        characterId,
        description: `${character?.name ?? '角色'}可能知道了状态记录中明确标注为未知的信息。`,
        evidence: sentence
      })
    }

    const characterMentioned = !character?.name || text.includes(character.name)
    for (const fact of characterFacts) {
      if (!characterMentioned) continue
      if (fact.category === 'physical' && /痊愈|完全恢复|毫无伤痛|行动自如/.test(text) && !/治疗|休养|药|包扎|解释/.test(text)) {
        issues.push({ type: 'injury_reset', factId: fact.id, characterId, description: `${fact.label}可能被无解释重置。`, evidence: stateValueToText(fact.value) })
      }
      if (fact.category === 'ability' && /无限|毫无限制|连续使用|反复发动/.test(text) && !/代价|冷却|消耗|痛/.test(text)) {
        issues.push({ type: 'ability_overuse', factId: fact.id, characterId, description: `${fact.label}的限制可能被忽略。`, evidence: stateValueToText(fact.value) })
      }
      if (fact.category === 'location' && /(突然出现在|转眼已在|下一秒出现在)/.test(text) && !/赶到|步行|乘|沿着|穿过|传送/.test(text)) {
        issues.push({ type: 'location_jump', factId: fact.id, characterId, description: `${character?.name ?? '角色'}的位置变化缺少路径或机制说明。`, evidence: stateValueToText(fact.value) })
      }
      if (fact.category === 'promise' && /(忘了|不再理会|拒绝履行|违背|抛下承诺)/.test(text) && !/原因|被迫|代价|解释/.test(text)) {
        issues.push({ type: 'promise_ignored', factId: fact.id, characterId, description: `${fact.label}可能被正文无解释忽略。`, evidence: stateValueToText(fact.value) })
      }
    }
  }
  return issues
}
