import type {
  AppData,
  Chapter,
  Character,
  CharacterCardField,
  CharacterStateChangeCandidate,
  CharacterStateFact,
  CharacterStateFactValue,
  CharacterStateLog,
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

export type CharacterStateFactDraft = Partial<CharacterStateFact> & { projectId: ID; characterId: ID; label: string }

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

function uniqueFields(fields: CharacterCardField[]): CharacterCardField[] {
  return [...new Set(fields)]
}

function withDefaultLinkedCardFields(fields: CharacterCardField[] | null | undefined, category: StateFactCategory): CharacterCardField[] {
  return fields && fields.length ? uniqueFields(fields) : CharacterStateService.getDefaultLinkedCardFieldsForCategory(category)
}

function inferLabelFromLog(text: string, category: StateFactCategory): string {
  if (category === 'physical') {
    if (text.includes('右手') && text.includes('结晶')) return '右手结晶化'
    if (text.includes('右臂') && text.includes('灼痛')) return '右臂灼痛'
    if (text.includes('右臂')) return '右臂状态'
    if (text.includes('左臂')) return '左臂状态'
    if (text.includes('结晶')) return '身体结晶化'
    if (text.includes('骨裂')) return '骨裂'
    if (text.includes('出血')) return '出血'
    return '伤势/身体状态'
  }
  if (category === 'inventory') return includesAny(text, ['失去', '丢失']) ? '失去物品' : '持有物品'
  if (category === 'knowledge') return '已知信息'
  if (category === 'location') return '当前位置'
  if (category === 'resource') return '资源/余额'
  if (category === 'promise') return '承诺/债务'
  if (category === 'ability') return '能力限制'
  return '状态事实'
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

  static getDefaultLinkedCardFieldsForCategory(category: StateFactCategory): CharacterCardField[] {
    if (category === 'resource' || category === 'inventory') return ['abilitiesAndResources']
    if (category === 'location' || category === 'goal' || category === 'status') return ['surfaceGoal']
    if (category === 'physical') return ['weaknessAndCost', 'abilitiesAndResources']
    if (category === 'knowledge' || category === 'secret') return ['abilitiesAndResources', 'relationshipTension']
    if (category === 'mental' || category === 'relationship') return ['relationshipTension']
    if (category === 'promise') return ['relationshipTension', 'weaknessAndCost']
    if (category === 'ability') return ['abilitiesAndResources', 'weaknessAndCost']
    return []
  }

  static inferFactDraftFromLog(
    logText: string,
    character: Pick<Character, 'id' | 'projectId'>,
    chapter?: Pick<Chapter, 'id' | 'order'> | null
  ): CharacterStateFactDraft {
    const text = logText.trim()
    let category: StateFactCategory = 'custom'
    if (includesAny(text, ['手臂', '右臂', '左臂', '右手', '左手', '伤', '灼痛', '结晶', '骨裂', '出血', '疲惫'])) category = 'physical'
    else if (includesAny(text, ['持有', '得到', '获得', '失去', '丢失', '钥匙', '地图', '武器'])) category = 'inventory'
    else if (includesAny(text, ['知道', '得知', '发现', '明白', '记起', '秘密'])) category = 'knowledge'
    else if (includesAny(text, ['位置', '到达', '离开', '进入', '抵达'])) category = 'location'
    else if (includesAny(text, ['现金', '钱', '余额', '金币', '花费', '支付', '购买'])) category = 'resource'
    else if (includesAny(text, ['承诺', '答应', '欠', '债', '契约'])) category = 'promise'
    else if (includesAny(text, ['能力', '权限', '冷却', '代价', '无法使用'])) category = 'ability'

    const linkedCardFields = this.getDefaultLinkedCardFieldsForCategory(category)
    return {
      projectId: character.projectId,
      characterId: character.id,
      category,
      key: inferLabelFromLog(text, category),
      label: inferLabelFromLog(text, category),
      valueType: 'text',
      value: text,
      unit: '',
      linkedCardFields,
      trackingLevel: category === 'custom' ? 'note' : 'hard',
      promptPolicy: category === 'custom' ? 'manual_only' : 'when_relevant',
      status: 'active',
      sourceChapterId: chapter?.id ?? null,
      sourceChapterOrder: chapter?.order ?? null,
      evidence: text,
      confidence: category === 'custom' ? 0.5 : 0.85
    }
  }

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

  static createOrUpdateFact(factInput: CharacterStateFactDraft, appData: AppData): AppData {
    const timestamp = now()
    const existing = factInput.id ? appData.characterStateFacts.find((fact) => fact.id === factInput.id) : null
    const value = factInput.value ?? existing?.value ?? ''
    const category = factInput.category ?? existing?.category ?? 'custom'
    const fact: CharacterStateFact = {
      id: existing?.id ?? factInput.id ?? newId(),
      projectId: factInput.projectId,
      characterId: factInput.characterId,
      category,
      key: factInput.key ?? existing?.key ?? factInput.label,
      label: factInput.label,
      valueType: factInput.valueType ?? existing?.valueType ?? inferValueType(value),
      value,
      unit: factInput.unit ?? existing?.unit ?? '',
      linkedCardFields: withDefaultLinkedCardFields(factInput.linkedCardFields ?? existing?.linkedCardFields, category),
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

  static createFactFromLog(log: CharacterStateLog, draft: CharacterStateFactDraft, appData: AppData): AppData {
    const currentLog = appData.characterStateLogs.find((item) => item.id === log.id) ?? log
    if (currentLog.linkedFactId || currentLog.linkedCandidateId) return appData
    const timestamp = now()
    const factId = draft.id ?? newId()
    const nextData = this.createOrUpdateFact(
      {
        ...draft,
        id: factId,
        projectId: log.projectId,
        characterId: log.characterId,
        sourceChapterId: draft.sourceChapterId ?? log.chapterId,
        sourceChapterOrder: draft.sourceChapterOrder ?? log.chapterOrder,
        evidence: draft.evidence || log.note,
        confidence: draft.confidence ?? 1
      },
      appData
    )
    const fact = nextData.characterStateFacts.find((item) => item.id === factId)
    if (!fact) return nextData
    const transaction: CharacterStateTransaction = {
      id: newId(),
      projectId: log.projectId,
      characterId: log.characterId,
      factId,
      chapterId: log.chapterId,
      chapterOrder: log.chapterOrder,
      transactionType: 'create',
      beforeValue: null,
      afterValue: fact.value,
      delta: null,
      reason: log.note,
      evidence: log.note,
      source: 'manual',
      status: 'accepted',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    return {
      ...nextData,
      characterStateTransactions: [transaction, ...nextData.characterStateTransactions],
      characterStateLogs: nextData.characterStateLogs.map((item) =>
        item.id === log.id ? { ...item, linkedFactId: factId, convertedAt: timestamp } : item
      )
    }
  }

  static createCandidateFromLog(log: CharacterStateLog, draft: CharacterStateFactDraft, appData: AppData): AppData {
    const currentLog = appData.characterStateLogs.find((item) => item.id === log.id) ?? log
    if (currentLog.linkedFactId || currentLog.linkedCandidateId) return appData
    const timestamp = now()
    const fact: CharacterStateFact = {
      id: draft.id ?? newId(),
      projectId: log.projectId,
      characterId: log.characterId,
      category: draft.category ?? 'custom',
      key: draft.key ?? draft.label,
      label: draft.label,
      valueType: draft.valueType ?? inferValueType(draft.value ?? ''),
      value: draft.value ?? log.note,
      unit: draft.unit ?? '',
      linkedCardFields: withDefaultLinkedCardFields(draft.linkedCardFields, draft.category ?? 'custom'),
      trackingLevel: draft.trackingLevel ?? 'hard',
      promptPolicy: draft.promptPolicy ?? 'when_relevant',
      status: draft.status ?? 'active',
      sourceChapterId: draft.sourceChapterId ?? log.chapterId,
      sourceChapterOrder: draft.sourceChapterOrder ?? log.chapterOrder,
      evidence: draft.evidence || log.note,
      confidence: draft.confidence ?? 0.8,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const candidateId = newId()
    const candidate: CharacterStateChangeCandidate = {
      id: candidateId,
      projectId: log.projectId,
      characterId: log.characterId,
      chapterId: log.chapterId,
      chapterOrder: log.chapterOrder,
      candidateType: 'create_fact',
      targetFactId: null,
      proposedFact: fact,
      proposedTransaction: null,
      beforeValue: null,
      afterValue: fact.value,
      evidence: log.note,
      confidence: draft.confidence ?? 0.8,
      riskLevel: fact.trackingLevel === 'hard' ? 'medium' : 'low',
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    return {
      ...appData,
      characterStateChangeCandidates: [candidate, ...appData.characterStateChangeCandidates],
      characterStateLogs: appData.characterStateLogs.map((item) =>
        item.id === log.id ? { ...item, linkedCandidateId: candidateId, convertedAt: timestamp } : item
      )
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
    const fallbackCategory = proposed?.category ?? 'custom'
    const fallbackFact: CharacterStateFact = {
          id: newId(),
          projectId: candidate.projectId,
          characterId: candidate.characterId,
          category: fallbackCategory,
          key: proposed?.key ?? 'state',
          label: candidate.proposedFact?.label ?? '状态事实',
          valueType: inferValueType(nextValue),
          value: nextValue,
          unit: '',
          linkedCardFields: withDefaultLinkedCardFields(proposed?.linkedCardFields, fallbackCategory),
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
    const baseFact = existing ?? proposed ?? fallbackFact
    const fact: CharacterStateFact = {
      ...baseFact,
      value: nextValue,
      linkedCardFields: withDefaultLinkedCardFields(baseFact.linkedCardFields, baseFact.category),
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
