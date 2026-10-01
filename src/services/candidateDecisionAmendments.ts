import type {
  AppData,
  CandidateDecisionAmendment,
  CandidateDecisionAmendmentAudit,
  CandidateDecisionAmendmentSnapshot,
  CandidateDecisionSelection,
  CharacterStateChangeCandidate,
  CharacterStateFactValue,
  CharacterStateValueType,
  MemoryUpdateCandidate,
  MemoryUpdatePatch
} from '../shared/types'
import { normalizeCandidateDecisionAmendment } from '../shared/normalizers/candidateDecision'
import { CharacterStateService } from './CharacterStateService'
import { resolveApplicableMemoryPatch } from './MemoryCandidateService'

type Candidate = MemoryUpdateCandidate | CharacterStateChangeCandidate

export class CandidateAmendmentError extends Error {}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function originalMemoryPatch(candidate: MemoryUpdateCandidate): MemoryUpdatePatch {
  const { patch, error } = resolveApplicableMemoryPatch(candidate)
  if (!patch) throw new CandidateAmendmentError(error ?? '候选无法解析。')
  return patch
}

function amendMemoryPatch(base: MemoryUpdatePatch, amendment: Extract<CandidateDecisionAmendment, { kind: 'memory' }>): MemoryUpdatePatch {
  const edit = amendment.patch
  if (base.kind !== edit.kind) throw new CandidateAmendmentError('编辑类型与候选的原补丁类型不一致。')
  if (base.kind === 'chapter_review_update' && edit.kind === base.kind) return {
    ...base,
    ...(edit.summary !== undefined ? { summary: edit.summary } : {}),
    ...(edit.review ? { review: { ...base.review, ...edit.review } } : {}),
    ...(edit.continuityBridgeSuggestion !== undefined
      ? { continuityBridgeSuggestion: edit.continuityBridgeSuggestion } : {}),
    warnings: [...(base.warnings ?? [])]
  }
  if (base.kind === 'character_state_update' && edit.kind === base.kind) return {
    ...base,
    ...(edit.summary !== undefined ? { summary: edit.summary } : {}),
    ...(edit.changeSummary !== undefined ? { changeSummary: edit.changeSummary } : {}),
    ...(edit.newCurrentEmotionalState !== undefined ? { newCurrentEmotionalState: edit.newCurrentEmotionalState } : {}),
    ...(edit.newRelationshipWithProtagonist !== undefined
      ? { newRelationshipWithProtagonist: edit.newRelationshipWithProtagonist } : {}),
    ...(edit.newNextActionTendency !== undefined ? { newNextActionTendency: edit.newNextActionTendency } : {}),
    warnings: [...(base.warnings ?? [])]
  }
  if (base.kind === 'foreshadowing_create' && edit.kind === base.kind) return {
    ...base,
    ...(edit.summary !== undefined ? { summary: edit.summary } : {}),
    ...(edit.candidate ? { candidate: { ...base.candidate, ...edit.candidate } } : {}),
    warnings: [...(base.warnings ?? [])]
  }
  if (base.kind === 'foreshadowing_status_update' && edit.kind === base.kind) return {
    ...base,
    ...(edit.summary !== undefined ? { summary: edit.summary } : {}),
    ...(edit.suggestedStatus !== undefined ? { suggestedStatus: edit.suggestedStatus } : {}),
    ...(edit.recommendedTreatmentMode !== undefined ? { recommendedTreatmentMode: edit.recommendedTreatmentMode } : {}),
    ...(edit.evidenceText !== undefined ? { evidenceText: edit.evidenceText } : {}),
    ...(edit.notes !== undefined ? { notes: edit.notes } : {}),
    warnings: [...(base.warnings ?? [])]
  }
  if (base.kind === 'stage_summary_create' && edit.kind === base.kind) return {
    ...base,
    ...(edit.summary !== undefined ? { summary: edit.summary } : {}),
    ...(edit.stageSummary ? { stageSummary: { ...base.stageSummary, ...edit.stageSummary } } : {}),
    warnings: [...(base.warnings ?? [])]
  }
  if (base.kind === 'timeline_event_create' && edit.kind === base.kind) return {
    ...base,
    ...(edit.summary !== undefined ? { summary: edit.summary } : {}),
    ...(edit.event ? { event: { ...base.event, ...edit.event } } : {}),
    warnings: [...(base.warnings ?? [])]
  }
  throw new CandidateAmendmentError('该记忆候选不支持这种编辑。')
}

function stateFact(data: AppData, candidate: CharacterStateChangeCandidate) {
  const preview = CharacterStateService.previewStateChangeCandidate(candidate, data)
  return { preview, fact: preview.proposed ?? preview.existing ?? null }
}

function stateSnapshot(data: AppData, candidate: CharacterStateChangeCandidate): CandidateDecisionAmendmentSnapshot {
  const { preview, fact } = stateFact(data, candidate)
  return {
    kind: 'character_state',
    label: fact?.label ?? null,
    category: fact?.category ?? null,
    targetValue: preview.nextValue,
    linkedCardFields: fact?.linkedCardFields?.length
      ? [...new Set(fact.linkedCardFields)]
      : fact ? CharacterStateService.getDefaultLinkedCardFieldsForCategory(fact.category) : []
  }
}

function normalizeFinalStateValue(value: CharacterStateFactValue | null,
  valueType: CharacterStateValueType | null): CharacterStateFactValue {
  if (value === null) throw new CandidateAmendmentError('角色状态最终值不能为空。')
  if (valueType === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const numberValue = Number(value)
      if (Number.isFinite(numberValue)) return numberValue
    }
    throw new CandidateAmendmentError('数字状态的最终值必须是有效数字。')
  }
  if (valueType === 'boolean') {
    if (typeof value === 'boolean') return value
    throw new CandidateAmendmentError('布尔状态的最终值必须是 true 或 false。')
  }
  if (valueType === 'list') {
    if (Array.isArray(value)) return [...new Set(value.map((item) => item.trim()).filter(Boolean))]
    if (typeof value === 'string') {
      return [...new Set(value.split(/[,\n，、]/).map((item) => item.trim()).filter(Boolean))]
    }
    throw new CandidateAmendmentError('列表状态的最终值必须是文本列表。')
  }
  if (valueType === 'string' || valueType === 'text') {
    if (typeof value === 'string') return value
    throw new CandidateAmendmentError('文本状态的最终值必须是文本。')
  }
  return value
}

function amendStateCandidate(data: AppData, candidate: CharacterStateChangeCandidate,
  amendment: Extract<CandidateDecisionAmendment, { kind: 'character_state' }>): CharacterStateChangeCandidate {
  if (amendment.label !== undefined && !amendment.label.trim()) {
    throw new CandidateAmendmentError('角色状态标签不能为空。')
  }
  const { preview, fact } = stateFact(data, candidate)
  const editsFact = amendment.label !== undefined || amendment.category !== undefined || amendment.linkedCardFields !== undefined
  if (editsFact && !fact) throw new CandidateAmendmentError('该状态候选没有可编辑的事实标签或类别。')
  const targetValue = Object.hasOwn(amendment, 'targetValue')
    ? normalizeFinalStateValue(amendment.targetValue ?? null, preview.existing?.valueType ?? fact?.valueType ?? null)
    : undefined
  const category = amendment.category ?? fact?.category
  const linkedCardFields = amendment.linkedCardFields !== undefined && category
    ? amendment.linkedCardFields.length
      ? [...new Set(amendment.linkedCardFields)]
      : CharacterStateService.getDefaultLinkedCardFieldsForCategory(category)
    : amendment.linkedCardFields
  const proposedFact = fact ? {
    ...fact,
    ...(amendment.label !== undefined ? { label: amendment.label } : {}),
    ...(amendment.category !== undefined ? { category: amendment.category } : {}),
    ...(linkedCardFields !== undefined ? { linkedCardFields } : {}),
    ...(targetValue !== undefined ? { value: targetValue } : {})
  } : candidate.proposedFact
  const proposedTransaction = targetValue !== undefined && candidate.proposedTransaction
    ? { ...candidate.proposedTransaction, transactionType: 'update' as const, afterValue: targetValue, delta: null }
    : candidate.proposedTransaction
  return {
    ...candidate,
    proposedFact,
    proposedTransaction,
    ...(targetValue !== undefined ? { afterValue: targetValue } : {})
  }
}

function validateProjectCharacterIds(data: AppData, projectId: string, ids: readonly string[]): void {
  for (const id of new Set(ids)) {
    if (!data.characters.some((character) => character.id === id && character.projectId === projectId)) {
      throw new CandidateAmendmentError(`编辑挂接的角色不存在或不属于当前项目：${id}`)
    }
  }
}

function validateMemoryAttachments(data: AppData, candidate: MemoryUpdateCandidate, patch: MemoryUpdatePatch): void {
  if (patch.kind === 'foreshadowing_create') validateProjectCharacterIds(data, candidate.projectId, patch.candidate.relatedCharacterIds)
  if (patch.kind === 'timeline_event_create') validateProjectCharacterIds(data, candidate.projectId, patch.event.participantCharacterIds ?? [])
}

export interface PreparedCandidateDecision {
  selection: CandidateDecisionSelection
  candidate: Candidate
  effectiveCandidate: Candidate
  audit?: CandidateDecisionAmendmentAudit
}

export function applyPreparedCandidateAmendment(data: AppData, prepared: PreparedCandidateDecision,
  timestamp: string): AppData {
  if (!prepared.audit) return data
  if (prepared.selection.kind === 'memory' && 'proposedPatch' in prepared.effectiveCandidate) {
    return {
      ...data,
      memoryUpdateCandidates: data.memoryUpdateCandidates.map((candidate) =>
        candidate.id === prepared.candidate.id && candidate.projectId === prepared.candidate.projectId
          ? { ...prepared.effectiveCandidate as MemoryUpdateCandidate, updatedAt: timestamp }
          : candidate)
    }
  }
  if (prepared.selection.kind !== 'character_state' || 'proposedPatch' in prepared.effectiveCandidate) return data
  const effectiveCandidate = prepared.effectiveCandidate
  const { existing } = CharacterStateService.previewStateChangeCandidate(effectiveCandidate, data)
  const after = prepared.audit.after.kind === 'character_state' ? prepared.audit.after : null
  return {
    ...data,
    characterStateFacts: existing && after
      ? data.characterStateFacts.map((fact) => fact.id === existing.id
        ? { ...fact, label: after.label ?? fact.label, category: after.category ?? fact.category,
            linkedCardFields: [...after.linkedCardFields], updatedAt: timestamp }
        : fact)
      : data.characterStateFacts,
    characterStateChangeCandidates: data.characterStateChangeCandidates.map((candidate) =>
      candidate.id === prepared.candidate.id && candidate.projectId === prepared.candidate.projectId
        ? { ...effectiveCandidate, updatedAt: timestamp }
        : candidate)
  }
}

export function prepareCandidateDecision(data: AppData, selection: CandidateDecisionSelection, candidate: Candidate): PreparedCandidateDecision {
  if (selection.amendment === undefined) return { selection, candidate, effectiveCandidate: candidate }
  if (selection.decision !== 'accept') throw new CandidateAmendmentError('只有接受候选时可以附带编辑。')
  const amendment = normalizeCandidateDecisionAmendment(selection.amendment)
  if (!amendment) throw new CandidateAmendmentError('候选编辑包含未知字段或无效值。')
  if (amendment.kind !== selection.kind) throw new CandidateAmendmentError('候选编辑类型与所选候选不一致。')

  if (selection.kind === 'memory') {
    if (!('proposedPatch' in candidate) || amendment.kind !== 'memory') throw new CandidateAmendmentError('记忆编辑不能用于角色状态候选。')
    const beforePatch = originalMemoryPatch(candidate)
    const afterPatch = amendMemoryPatch(beforePatch, amendment)
    validateMemoryAttachments(data, candidate, afterPatch)
    const before: CandidateDecisionAmendmentSnapshot = { kind: 'memory', patch: beforePatch }
    const after: CandidateDecisionAmendmentSnapshot = { kind: 'memory', patch: afterPatch }
    if (stableJson(before) === stableJson(after)) throw new CandidateAmendmentError('候选编辑没有产生实际变化。')
    const effectiveCandidate = { ...candidate, proposedPatch: afterPatch }
    const normalizedSelection = { ...selection, amendment }
    return { selection: normalizedSelection, candidate, effectiveCandidate,
      audit: { kind: selection.kind, candidateId: selection.candidateId, amendment, before, after } }
  }

  if ('proposedPatch' in candidate || amendment.kind !== 'character_state') {
    throw new CandidateAmendmentError('角色状态编辑不能用于记忆候选。')
  }
  const before = stateSnapshot(data, candidate)
  const effectiveCandidate = amendStateCandidate(data, candidate, amendment)
  const after = stateSnapshot(data, effectiveCandidate)
  if (stableJson(before) === stableJson(after)) throw new CandidateAmendmentError('候选编辑没有产生实际变化。')
  const normalizedSelection = { ...selection, amendment }
  return { selection: normalizedSelection, candidate, effectiveCandidate,
    audit: { kind: selection.kind, candidateId: selection.candidateId, amendment, before, after } }
}
