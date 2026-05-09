import type {
  AppData,
  Character,
  CharacterCardField,
  CharacterStateChangeCandidate,
  CharacterStateFact,
  CharacterStateFactValue,
  CharacterStateTransaction,
  CharacterStateTransactionType,
  ContextNeedPlan,
  ID,
  StateFactCategory
} from '../shared/types'

function newId(): ID {
  return `state-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function now(): string {
  return new Date().toISOString()
}

function valueToText(value: CharacterStateFactValue | null | undefined): string {
  if (Array.isArray(value)) return value.join('、')
  if (value === null || value === undefined || value === '') return '未记录'
  return String(value)
}

function normalizeList(value: CharacterStateFactValue | null | undefined): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') return value.split(/[,\n，、]/).map((item) => item.trim()).filter(Boolean)
  return []
}

function applyTransactionValue(
  beforeValue: CharacterStateFactValue,
  afterValue: CharacterStateFactValue | null,
  delta: number | null,
  type: CharacterStateTransactionType
): CharacterStateFactValue {
  if (type === 'increment' || type === 'decrement') {
    const before = typeof beforeValue === 'number' ? beforeValue : Number(beforeValue || 0)
    const signedDelta = type === 'decrement' ? -Math.abs(delta ?? 0) : Math.abs(delta ?? 0)
    return before + signedDelta
  }
  if (type === 'add_item') return [...new Set([...normalizeList(beforeValue), ...normalizeList(afterValue)])]
  if (type === 'remove_item') {
    const toRemove = new Set(normalizeList(afterValue))
    return normalizeList(beforeValue).filter((item) => !toRemove.has(item))
  }
  return afterValue ?? beforeValue
}

function factMatchesNeed(fact: CharacterStateFact, plan: ContextNeedPlan | null, targetChapterOrder: number): boolean {
  if (fact.status !== 'active') return false
  if (fact.promptPolicy === 'manual_only') return false
  if (fact.promptPolicy === 'always') return true
  if (!plan) return fact.trackingLevel === 'hard'
  const categories = plan.requiredStateFactCategories[fact.characterId] ?? []
  if (categories.includes(fact.category)) return true
  if (fact.category === 'physical' && plan.mustCheckContinuity.includes('injury')) return true
  if (fact.category === 'location' && plan.mustCheckContinuity.includes('location')) return true
  if (fact.category === 'inventory' && plan.mustCheckContinuity.includes('inventory')) return true
  if (fact.category === 'resource' && plan.mustCheckContinuity.includes('money')) return true
  if ((fact.category === 'knowledge' || fact.category === 'secret') && plan.mustCheckContinuity.includes('knowledge')) return true
  if (fact.category === 'promise' && plan.mustCheckContinuity.includes('promise')) return true
  if (fact.category === 'ability' && plan.mustCheckContinuity.includes('ability')) return true
  return fact.trackingLevel === 'hard' && (fact.sourceChapterOrder ?? 0) <= targetChapterOrder
}

function factSortScore(fact: CharacterStateFact, plan: ContextNeedPlan | null): number {
  let score = 0
  if (fact.promptPolicy === 'always') score += 50
  if (fact.trackingLevel === 'hard') score += 35
  if (fact.trackingLevel === 'soft') score += 15
  if (plan?.requiredStateFactCategories[fact.characterId]?.includes(fact.category)) score += 45
  if (fact.confidence >= 0.8) score += 5
  return score
}

function inferValueType(value: CharacterStateFactValue | null): CharacterStateFact['valueType'] {
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return String(value ?? '').length > 80 ? 'text' : 'string'
}

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

export class CharacterStateService {
  static formatFactValue = valueToText

  static getRelevantCharacterStatesForPrompt(
    characterIds: ID[],
    contextNeedPlan: ContextNeedPlan | null,
    targetChapterOrder: number,
    facts: CharacterStateFact[]
  ): CharacterStateFact[] {
    const characterSet = new Set(characterIds)
    return facts
      .filter((fact) => characterSet.has(fact.characterId))
      .filter((fact) => factMatchesNeed(fact, contextNeedPlan, targetChapterOrder))
      .sort((a, b) => factSortScore(b, contextNeedPlan) - factSortScore(a, contextNeedPlan) || a.label.localeCompare(b.label))
  }

  static createOrUpdateFact(factInput: Partial<CharacterStateFact> & { projectId: ID; characterId: ID; label: string }, appData: AppData): AppData {
    const timestamp = now()
    const existing = factInput.id ? appData.characterStateFacts.find((fact) => fact.id === factInput.id) : null
    const value = factInput.value ?? existing?.value ?? ''
    const fact: CharacterStateFact = {
      id: existing?.id ?? factInput.id ?? newId(),
      projectId: factInput.projectId,
      characterId: factInput.characterId,
      category: factInput.category ?? existing?.category ?? 'custom',
      key: factInput.key ?? existing?.key ?? factInput.label,
      label: factInput.label,
      valueType: factInput.valueType ?? existing?.valueType ?? inferValueType(value),
      value,
      unit: factInput.unit ?? existing?.unit ?? '',
      linkedCardFields: factInput.linkedCardFields ?? existing?.linkedCardFields ?? [],
      trackingLevel: factInput.trackingLevel ?? existing?.trackingLevel ?? 'hard',
      promptPolicy: factInput.promptPolicy ?? existing?.promptPolicy ?? 'when_relevant',
      status: factInput.status ?? existing?.status ?? 'active',
      sourceChapterId: factInput.sourceChapterId ?? existing?.sourceChapterId ?? null,
      sourceChapterOrder: factInput.sourceChapterOrder ?? existing?.sourceChapterOrder ?? null,
      evidence: factInput.evidence ?? existing?.evidence ?? '',
      confidence: factInput.confidence ?? existing?.confidence ?? 1,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    return {
      ...appData,
      characterStateFacts: existing
        ? appData.characterStateFacts.map((item) => (item.id === fact.id ? fact : item))
        : [fact, ...appData.characterStateFacts]
    }
  }

  static applyStateChangeCandidate(candidateId: ID, appData: AppData): AppData {
    const candidate = appData.characterStateChangeCandidates.find((item) => item.id === candidateId)
    if (!candidate || candidate.status !== 'pending') return appData
    const timestamp = now()
    const existing = candidate.targetFactId
      ? appData.characterStateFacts.find((fact) => fact.id === candidate.targetFactId)
      : appData.characterStateFacts.find(
          (fact) =>
            fact.projectId === candidate.projectId &&
            fact.characterId === candidate.characterId &&
            fact.key === candidate.proposedFact?.key &&
            fact.status === 'active'
        )

    const transactionType = candidate.proposedTransaction?.transactionType ?? (candidate.candidateType === 'create_fact' ? 'create' : 'update')
    const nextValue = existing
      ? applyTransactionValue(existing.value, candidate.afterValue, candidate.proposedTransaction?.delta ?? null, transactionType)
      : candidate.proposedFact?.value ?? candidate.afterValue ?? ''
    const proposed = candidate.proposedFact
    const fallbackFact: CharacterStateFact = {
          id: newId(),
          projectId: candidate.projectId,
          characterId: candidate.characterId,
          category: 'custom' as StateFactCategory,
          key: proposed?.key ?? 'state',
          label: candidate.proposedFact?.label ?? '状态事实',
          valueType: inferValueType(nextValue),
          value: nextValue,
          unit: '',
          linkedCardFields: [],
          trackingLevel: 'hard',
          promptPolicy: 'when_relevant',
          status: 'active',
          sourceChapterId: candidate.chapterId,
          sourceChapterOrder: candidate.chapterOrder,
          evidence: candidate.evidence,
          confidence: candidate.confidence,
          createdAt: timestamp,
          updatedAt: timestamp
        }
    const fact: CharacterStateFact = {
      ...(existing ?? proposed ?? fallbackFact),
      value: nextValue,
      status: candidate.candidateType === 'resolve_fact' ? 'resolved' : existing?.status ?? proposed?.status ?? 'active',
      sourceChapterId: candidate.chapterId ?? existing?.sourceChapterId ?? null,
      sourceChapterOrder: candidate.chapterOrder ?? existing?.sourceChapterOrder ?? null,
      evidence: candidate.evidence || existing?.evidence || '',
      confidence: candidate.confidence || existing?.confidence || 0.7,
      updatedAt: timestamp
    }
    const transaction: CharacterStateTransaction = {
      id: newId(),
      projectId: candidate.projectId,
      characterId: candidate.characterId,
      factId: fact.id,
      chapterId: candidate.chapterId,
      chapterOrder: candidate.chapterOrder,
      transactionType,
      beforeValue: existing?.value ?? candidate.beforeValue ?? null,
      afterValue: fact.value,
      delta: candidate.proposedTransaction?.delta ?? null,
      reason: candidate.proposedTransaction?.reason ?? candidate.evidence,
      evidence: candidate.evidence,
      source: candidate.proposedTransaction?.source ?? 'chapter_review',
      status: 'accepted',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    return {
      ...appData,
      characterStateFacts: existing
        ? appData.characterStateFacts.map((item) => (item.id === fact.id ? fact : item))
        : [fact, ...appData.characterStateFacts],
      characterStateTransactions: [transaction, ...appData.characterStateTransactions],
      characterStateChangeCandidates: appData.characterStateChangeCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'accepted', updatedAt: timestamp } : item
      )
    }
  }

  static rejectStateChangeCandidate(candidateId: ID, appData: AppData): AppData {
    const timestamp = now()
    return {
      ...appData,
      characterStateChangeCandidates: appData.characterStateChangeCandidates.map((candidate) =>
        candidate.id === candidateId ? { ...candidate, status: 'rejected', updatedAt: timestamp } : candidate
      )
    }
  }

  static validateCharacterStateInText(chapterText: string, facts: CharacterStateFact[], characters: Character[] = []): StateValidationIssue[] {
    const issues: StateValidationIssue[] = []
    const text = chapterText || ''
    for (const fact of facts.filter((item) => item.status === 'active' && item.trackingLevel === 'hard')) {
      const character = characters.find((item) => item.id === fact.characterId)
      const name = character?.name ?? ''
      const nameMentioned = !name || text.includes(name)
      if (fact.category === 'resource' && typeof fact.value === 'number' && nameMentioned) {
        const spendPattern = /(花费|支付|买下|购买|付了|花了)\s*([0-9]+(?:\.[0-9]+)?)/g
        for (const match of text.matchAll(spendPattern)) {
          const amount = Number(match[2])
          if (Number.isFinite(amount) && amount > fact.value) {
            issues.push({
              type: 'resource_underflow',
              factId: fact.id,
              characterId: fact.characterId,
              description: `${fact.label}不足，正文出现超额支出。`,
              evidence: match[0]
            })
          }
        }
      }
      if (fact.category === 'inventory' && nameMentioned) {
        const ownedItems = normalizeList(fact.value)
        const keyLike = [...text.matchAll(/使用了?([^，。、“”\s]{2,12}(钥匙|地图|剑|枪|药|戒指|令牌|笔记|书))/g)].map((match) => match[1])
        for (const item of keyLike) {
          if (ownedItems.length && !ownedItems.some((owned) => item.includes(owned) || owned.includes(item))) {
            issues.push({
              type: 'missing_inventory',
              factId: fact.id,
              characterId: fact.characterId,
              description: `正文使用了未记录持有的物品：${item}`,
              evidence: item
            })
          }
        }
      }
      if (fact.category === 'knowledge' || fact.category === 'secret') {
        const secrets = normalizeList(fact.value)
        if (secrets.length && nameMentioned && /(说出|道破|意识到|知道|明白)/.test(text)) {
          for (const secret of secrets) {
            if (!text.includes(secret)) {
              issues.push({
                type: 'knowledge_leak',
                factId: fact.id,
                characterId: fact.characterId,
                description: `${name || '角色'}可能知道了未登记的秘密。`,
                evidence: text.slice(0, 120)
              })
              break
            }
          }
        }
      }
      if (fact.category === 'physical' && /痊愈|完全恢复|毫无伤痛|行动自如/.test(text) && !/治疗|休养|药|包扎|解释/.test(text)) {
        issues.push({
          type: 'injury_reset',
          factId: fact.id,
          characterId: fact.characterId,
          description: `${fact.label}可能被无解释重置。`,
          evidence: valueToText(fact.value)
        })
      }
      if (fact.category === 'ability' && /无限|毫无限制|连续使用|反复发动/.test(text) && !/代价|冷却|消耗|痛/.test(text)) {
        issues.push({
          type: 'ability_overuse',
          factId: fact.id,
          characterId: fact.characterId,
          description: `${fact.label}的限制可能被忽略。`,
          evidence: valueToText(fact.value)
        })
      }
    }
    return issues
  }
}
