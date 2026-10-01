import type {
  AppData,
  CharacterStateChangeCandidate,
  CharacterStateFact,
  CharacterStateLog,
  CharacterStateTransaction
} from '../../shared/types'
import {
  applyStateTransactionValue,
  inferStateValueType,
  newStateId,
  stateTimestamp,
  type CharacterStateFactDraft,
  withDefaultLinkedCardFields
} from './stateValue'

function assertFactOwnership(existing: CharacterStateFact, projectId: string, characterId: string): void {
  if (existing.projectId !== projectId || existing.characterId !== characterId) {
    throw new Error('状态事实归属与当前项目或角色不一致，已拒绝写入。')
  }
}

function currentConvertibleLog(log: CharacterStateLog, appData: AppData): CharacterStateLog | null {
  const current = appData.characterStateLogs.find((item) => item.id === log.id)
  if (!current) return null
  if (current.projectId !== log.projectId || current.characterId !== log.characterId) return null
  if (current.linkedFactId || current.linkedCandidateId) return null
  return current
}

export function createOrUpdateFact(factInput: CharacterStateFactDraft, appData: AppData): AppData {
  const timestamp = stateTimestamp()
  const existing = factInput.id ? appData.characterStateFacts.find((fact) => fact.id === factInput.id) : null
  if (existing) assertFactOwnership(existing, factInput.projectId, factInput.characterId)
  const value = factInput.value ?? existing?.value ?? ''
  const category = factInput.category ?? existing?.category ?? 'custom'
  const fact: CharacterStateFact = {
    id: existing?.id ?? factInput.id ?? newStateId(),
    projectId: factInput.projectId,
    characterId: factInput.characterId,
    category,
    key: factInput.key ?? existing?.key ?? factInput.label,
    label: factInput.label,
    valueType: factInput.valueType ?? existing?.valueType ?? inferStateValueType(value),
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

export function createFactFromLog(log: CharacterStateLog, draft: CharacterStateFactDraft, appData: AppData): AppData {
  const currentLog = currentConvertibleLog(log, appData)
  if (!currentLog) return appData
  const timestamp = stateTimestamp()
  const factId = draft.id ?? newStateId()
  const nextData = createOrUpdateFact(
    {
      ...draft,
      id: factId,
      projectId: currentLog.projectId,
      characterId: currentLog.characterId,
      sourceChapterId: draft.sourceChapterId ?? currentLog.chapterId,
      sourceChapterOrder: draft.sourceChapterOrder ?? currentLog.chapterOrder,
      evidence: draft.evidence || currentLog.note,
      confidence: draft.confidence ?? 1
    },
    appData
  )
  const fact = nextData.characterStateFacts.find((item) => item.id === factId)
  if (!fact) return nextData
  const transaction: CharacterStateTransaction = {
    id: newStateId(),
    projectId: currentLog.projectId,
    characterId: currentLog.characterId,
    factId,
    chapterId: currentLog.chapterId,
    chapterOrder: currentLog.chapterOrder,
    transactionType: 'create',
    beforeValue: null,
    afterValue: fact.value,
    delta: null,
    reason: currentLog.note,
    evidence: currentLog.note,
    source: 'manual',
    status: 'accepted',
    createdAt: timestamp,
    updatedAt: timestamp
  }
  return {
    ...nextData,
    characterStateTransactions: [transaction, ...nextData.characterStateTransactions],
    characterStateLogs: nextData.characterStateLogs.map((item) =>
      item.id === currentLog.id ? { ...item, linkedFactId: factId, convertedAt: timestamp } : item
    )
  }
}

export function createCandidateFromLog(log: CharacterStateLog, draft: CharacterStateFactDraft, appData: AppData): AppData {
  const currentLog = currentConvertibleLog(log, appData)
  if (!currentLog) return appData
  const timestamp = stateTimestamp()
  const category = draft.category ?? 'custom'
  const fact: CharacterStateFact = {
    id: draft.id ?? newStateId(),
    projectId: currentLog.projectId,
    characterId: currentLog.characterId,
    category,
    key: draft.key ?? draft.label,
    label: draft.label,
    valueType: draft.valueType ?? inferStateValueType(draft.value ?? ''),
    value: draft.value ?? currentLog.note,
    unit: draft.unit ?? '',
    linkedCardFields: withDefaultLinkedCardFields(draft.linkedCardFields, category),
    trackingLevel: draft.trackingLevel ?? 'hard',
    promptPolicy: draft.promptPolicy ?? 'when_relevant',
    status: draft.status ?? 'active',
    sourceChapterId: draft.sourceChapterId ?? currentLog.chapterId,
    sourceChapterOrder: draft.sourceChapterOrder ?? currentLog.chapterOrder,
    evidence: draft.evidence || currentLog.note,
    confidence: draft.confidence ?? 0.8,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const candidateId = newStateId()
  const candidate: CharacterStateChangeCandidate = {
    id: candidateId,
    projectId: currentLog.projectId,
    characterId: currentLog.characterId,
    chapterId: currentLog.chapterId,
    chapterOrder: currentLog.chapterOrder,
    candidateType: 'create_fact',
    targetFactId: null,
    proposedFact: fact,
    proposedTransaction: null,
    beforeValue: null,
    afterValue: fact.value,
    evidence: currentLog.note,
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
      item.id === currentLog.id ? { ...item, linkedCandidateId: candidateId, convertedAt: timestamp } : item
    )
  }
}

function proposedFactForCandidate(candidate: CharacterStateChangeCandidate): CharacterStateFact | null {
  const proposed = candidate.proposedFact
  if (!proposed) return null
  if (proposed.projectId !== candidate.projectId || proposed.characterId !== candidate.characterId) {
    throw new Error('状态候选内的事实归属与候选不一致，已拒绝接受。')
  }
  return proposed
}

// Preview and persistence share both target resolution and transaction arithmetic.
export function previewStateChangeCandidate(candidate: CharacterStateChangeCandidate, appData: AppData) {
  const proposed = proposedFactForCandidate(candidate)
  const target = candidate.targetFactId ? appData.characterStateFacts.find((fact) => fact.id === candidate.targetFactId) : null
  if (target) assertFactOwnership(target, candidate.projectId, candidate.characterId)
  if (candidate.targetFactId && !target && !proposed) {
    throw new Error('状态候选引用的目标事实不存在，无法安全接受。')
  }
  const existing =
    target ??
    appData.characterStateFacts.find(
      (fact) =>
        fact.projectId === candidate.projectId &&
        fact.characterId === candidate.characterId &&
        fact.key === proposed?.key &&
        fact.status === 'active'
    )
  const proposedIdCollision = proposed ? appData.characterStateFacts.find((fact) => fact.id === proposed.id) : null
  const retiredByUndo = proposedIdCollision?.status === 'inactive' && (appData.candidateDecisionReceipts ?? []).some((receipt) =>
    receipt.projectId === candidate.projectId && receipt.decisions.some((decision) => decision.kind === 'character_state' && decision.candidateId === candidate.id) &&
    receipt.effects?.some((effect) => effect.created && effect.collection === 'characterStateFacts' && effect.id === proposedIdCollision.id) &&
    appData.candidateDecisionReceipts.some((undo) => undo.projectId === candidate.projectId && undo.undoesReceiptId === receipt.id))
  if (proposedIdCollision && proposedIdCollision.id !== existing?.id && !retiredByUndo) {
    assertFactOwnership(proposedIdCollision, candidate.projectId, candidate.characterId)
    throw new Error('状态候选 proposedFact.id 已被其他事实占用，无法安全接受。')
  }

  const transactionType = candidate.proposedTransaction?.transactionType ?? (candidate.candidateType === 'create_fact' ? 'create' : 'update')
  const nextValue = existing
    ? applyStateTransactionValue(existing.value, candidate.afterValue, candidate.proposedTransaction?.delta ?? null, transactionType)
    : proposed?.value ?? candidate.afterValue ?? ''
  return { proposed, existing, transactionType, nextValue, retiredByUndo }
}

export function applyStateChangeCandidate(candidateId: string, appData: AppData): AppData {
  const candidate = appData.characterStateChangeCandidates.find((item) => item.id === candidateId)
  if (!candidate || candidate.status !== 'pending') return appData
  const timestamp = stateTimestamp()
  const { proposed, existing, transactionType, nextValue, retiredByUndo } = previewStateChangeCandidate(candidate, appData)
  const fallbackCategory = proposed?.category ?? 'custom'
  const fallbackFact: CharacterStateFact = {
    id: newStateId(),
    projectId: candidate.projectId,
    characterId: candidate.characterId,
    category: fallbackCategory,
    key: proposed?.key ?? 'state',
    label: proposed?.label ?? '状态事实',
    valueType: inferStateValueType(nextValue),
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
    id: existing?.id ?? (retiredByUndo ? fallbackFact.id : baseFact.id?.trim() || fallbackFact.id),
    projectId: candidate.projectId,
    characterId: candidate.characterId,
    value: nextValue,
    linkedCardFields: withDefaultLinkedCardFields(baseFact.linkedCardFields, baseFact.category),
    status: candidate.candidateType === 'resolve_fact' ? 'resolved' : existing?.status ?? proposed?.status ?? 'active',
    sourceChapterId: candidate.chapterId ?? existing?.sourceChapterId ?? null,
    sourceChapterOrder: candidate.chapterOrder ?? existing?.sourceChapterOrder ?? null,
    evidence: candidate.evidence || existing?.evidence || '',
    confidence: candidate.confidence ?? existing?.confidence ?? 0.7,
    updatedAt: timestamp
  }
  const transaction: CharacterStateTransaction = {
    id: newStateId(),
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

export function rejectStateChangeCandidate(candidateId: string, appData: AppData): AppData {
  const candidate = appData.characterStateChangeCandidates.find((item) => item.id === candidateId)
  if (!candidate || candidate.status !== 'pending') return appData
  const timestamp = stateTimestamp()
  return {
    ...appData,
    characterStateChangeCandidates: appData.characterStateChangeCandidates.map((item) =>
      item.id === candidateId ? { ...item, status: 'rejected', updatedAt: timestamp } : item
    )
  }
}
