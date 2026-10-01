import type {
  AppData, CandidateDecisionAmendmentAudit, CandidateDecisionCommand, CandidateDecisionPreview, CandidateDecisionReceipt,
  CandidateDecisionSelection, CandidateDecisionRemovedRecords, CharacterStateChangeCandidate, MemoryUpdateCandidate
} from '../shared/types'
import { redactSensitiveText } from '../shared/errorUtils'
import { normalizeCandidateDecisionAmendment } from '../shared/normalizers/candidateDecision'
import { draftContentHash } from './DraftDiagnosticBindingService'
import { CharacterStateService } from './CharacterStateService'
import { AuthorDecisionPolicyService } from './AuthorDecisionPolicyService'
import { applyMemoryCandidatePatchToData, memoryPatchChapterReference, rejectMemoryCandidateInData, resolveApplicableMemoryPatch } from './MemoryCandidateService'
import {
  applyPreparedCandidateAmendment,
  CandidateAmendmentError,
  prepareCandidateDecision,
  type PreparedCandidateDecision
} from './candidateDecisionAmendments'
import { CandidateDecisionError, stableDecisionJson as stableJson, decisionFingerprint as fingerprint,
  CANDIDATE_DECISION_COLLECTIONS, validateDecisionEnvelope } from './candidateDecisionPrimitives'
import { captureCandidateDecisionEffects } from './candidateDecisionEffects'
import { applyCandidateDecisionUndo } from './CandidateDecisionUndoService'
export { CandidateDecisionError, CANDIDATE_DECISION_COLLECTIONS } from './candidateDecisionPrimitives'
const compact = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 700)

function stateTargetFact(data: AppData, candidate: CharacterStateChangeCandidate) {
  return data.characterStateFacts.find((fact) => candidate.targetFactId
    ? fact.id === candidate.targetFactId
    : fact.projectId === candidate.projectId && fact.characterId === candidate.characterId &&
      fact.key === candidate.proposedFact?.key && fact.status === 'active')
}

function candidateFor(data: AppData, projectId: string, selection: CandidateDecisionSelection) {
  const collection = selection.kind === 'memory' ? data.memoryUpdateCandidates : data.characterStateChangeCandidates
  const candidate = collection.find((item) => item.id === selection.candidateId && item.projectId === projectId)
  if (!candidate) throw new CandidateDecisionError('候选不存在或不属于当前项目。')
  if (candidate.status !== 'pending') throw new CandidateDecisionError('该候选已处理，请刷新待办。', 'CANDIDATE_ALREADY_DECIDED')
  return candidate
}

function memorySummary(candidate: MemoryUpdateCandidate): string {
  const { patch, error } = resolveApplicableMemoryPatch(candidate)
  if (!patch) throw new CandidateDecisionError(error ?? '候选无法解析。')
  if (patch.kind === 'character_state_update') return [patch.changeSummary, patch.newCurrentEmotionalState,
    patch.newRelationshipWithProtagonist, patch.newNextActionTendency].filter(Boolean).join('；')
  if (patch.kind === 'foreshadowing_create') return `${patch.candidate.title}：${patch.candidate.description}`
  if (patch.kind === 'foreshadowing_status_update') return `${patch.summary}；状态改为 ${patch.suggestedStatus}`
  if (patch.kind === 'timeline_event_create') return `${patch.event.title ?? ''}：${patch.event.result ?? ''}`
  if (patch.kind === 'stage_summary_create') return patch.stageSummary.compressedPlotSummary ?? patch.stageSummary.plotProgress ?? patch.summary
  return patch.summary
}

function targetContext(data: AppData, selection: CandidateDecisionSelection, candidate: MemoryUpdateCandidate | CharacterStateChangeCandidate) {
  const job = data.chapterGenerationJobs.find((item) => item.id === candidate.jobId && item.projectId === candidate.projectId)
  const patch = 'proposedPatch' in candidate ? resolveApplicableMemoryPatch(candidate).patch ?? candidate.proposedPatch : null
  const state = 'targetFactId' in candidate ? candidate : null
  const fact = state ? stateTargetFact(data, state) : null
  const { chapterId, chapterOrder } = patch ? memoryPatchChapterReference(patch, job?.targetChapterOrder ?? null)
    : { chapterId: state?.chapterId, chapterOrder: state?.chapterOrder ?? job?.targetChapterOrder }
  const chapter = data.chapters.find((item) => item.projectId === candidate.projectId &&
    !item.archivedAt?.trim() && (chapterId ? item.id === chapterId : item.order === chapterOrder))
  const characterId = state?.characterId ?? (patch && 'characterId' in patch ? patch.characterId : null)
  const character = data.characters.find((item) => item.id === characterId && item.projectId === candidate.projectId)
  const foreshadowing = patch && 'foreshadowingId' in patch
    ? data.foreshadowings.find((item) => item.id === patch.foreshadowingId) : null
  return { selection, candidate, fact, character, foreshadowing,
    chapter: chapter ? { id: chapter.id, updatedAt: chapter.updatedAt, bodyHash: draftContentHash(chapter.body) } : null,
    job: job ? { id: job.id, projectId: job.projectId, targetChapterOrder: job.targetChapterOrder } : null }
}

function validateSelections<T extends CandidateDecisionSelection>(selections: T[]): T[] {
  if (!Array.isArray(selections) || !selections.length || selections.length > 200) {
    throw new CandidateDecisionError('请选择 1 至 200 条候选。')
  }
  const ids = new Set<string>()
  const normalized: T[] = []
  for (const item of selections) {
    if (!item || !['memory', 'character_state'].includes(item.kind) || !['accept', 'reject'].includes(item.decision) ||
      typeof item.candidateId !== 'string' || !item.candidateId) throw new CandidateDecisionError('候选决定参数不完整。')
    const key = `${item.kind}:${item.candidateId}`
    if (ids.has(key)) throw new CandidateDecisionError('同一次决定不能重复包含一个候选。')
    ids.add(key)
    if (item.amendment !== undefined) {
      if (item.decision !== 'accept') throw new CandidateDecisionError('只有接受候选时可以附带编辑。')
      const amendment = normalizeCandidateDecisionAmendment(item.amendment)
      if (!amendment) throw new CandidateDecisionError('候选编辑包含未知字段或无效值。')
      if (amendment.kind !== item.kind) throw new CandidateDecisionError('候选编辑类型与所选候选不一致。')
      normalized.push({ ...item, amendment })
    } else normalized.push({ ...item })
  }
  return normalized
}

function prepare(data: AppData, selection: CandidateDecisionSelection,
  candidate: MemoryUpdateCandidate | CharacterStateChangeCandidate): PreparedCandidateDecision {
  try {
    return prepareCandidateDecision(data, selection, candidate)
  } catch (error) {
    if (error instanceof CandidateAmendmentError) throw new CandidateDecisionError(error.message)
    throw error
  }
}

function describeCandidate(data: AppData, selection: CandidateDecisionSelection,
  candidate: MemoryUpdateCandidate | CharacterStateChangeCandidate) {
  const warnings: string[] = []
  let summary = ''
  let risk: 'low' | 'medium' | 'high' = 'low'
  if ('proposedPatch' in candidate) {
    const patch = candidate.proposedPatch
    warnings.push(...(patch.warnings ?? []))
    summary = selection.decision === 'accept' ? memorySummary(candidate) : patch.summary || '拒绝此记忆更新'
    if (patch.kind === 'foreshadowing_status_update' && ['resolved', 'abandoned'].includes(patch.suggestedStatus)) {
      warnings.push('将回收或放弃这条伏笔。')
    }
    const quality = AuthorDecisionPolicyService.assessMemoryCandidateQuality(candidate, data.qualityGateReports, data)
    const reportWarning = AuthorDecisionPolicyService.riskMessage(quality.report)
    if (reportWarning) warnings.push(`${quality.sourceStatus === 'current_draft' ? '来源正文' : '历史参考'}：${reportWarning}`)
    risk = warnings.length ? 'high' : candidate.confidence < 0.55 ? 'medium' : 'low'
    // Missing provenance is visible context, not evidence of an unsafe change.
    warnings.push(...quality.warnings.filter((warning) => !warnings.includes(warning)))
  } else {
    const fact = candidate.proposedFact
    const target = stateTargetFact(data, candidate)
    const resultingValue = selection.decision === 'accept'
      ? CharacterStateService.previewStateChangeCandidate(candidate, data).nextValue
      : candidate.afterValue ?? fact?.value ?? ''
    summary = `${fact?.label ?? target?.label ?? '角色状态'}：${CharacterStateService.formatFactValue(
      target?.value ?? candidate.beforeValue ?? '')} → ${CharacterStateService.formatFactValue(resultingValue)}`
    risk = candidate.riskLevel ?? 'medium'
    if (risk === 'high') warnings.push('这项角色状态变化被标记为高风险。')
  }
  return { summary, risk, warnings }
}

function higherRisk(left: 'low' | 'medium' | 'high', right: 'low' | 'medium' | 'high') {
  const rank = { low: 0, medium: 1, high: 2 }
  return rank[left] >= rank[right] ? left : right
}

export function previewCandidateDecisions(data: AppData, input: {
  projectId: string; decisions: CandidateDecisionSelection[]
}): CandidateDecisionPreview {
  if (!data.projects.some((project) => project.id === input.projectId)) throw new CandidateDecisionError('项目不存在。')
  const selections = validateSelections(input.decisions).map(({ kind, candidateId, decision, amendment }) =>
    ({ kind, candidateId, decision, ...(amendment ? { amendment } : {}) }))
  const items = selections.map((selection) => {
    const originalCandidate = candidateFor(data, input.projectId, selection)
    const prepared = prepare(data, selection, originalCandidate)
    const candidate = prepared.effectiveCandidate
    const edited = describeCandidate(data, prepared.selection, candidate)
    const original = prepared.audit ? describeCandidate(data, { ...prepared.selection, amendment: undefined }, originalCandidate) : edited
    const warnings = [...original.warnings, ...edited.warnings.filter((warning) => !original.warnings.includes(warning))]
    const risk = higherRisk(original.risk, edited.risk)
    const fingerprintInput = prepared.audit
      ? { context: targetContext(data, prepared.selection, candidate), originalCandidate, amendment: prepared.selection.amendment, risk, warnings }
      : { context: targetContext(data, prepared.selection, candidate), risk, warnings }
    return { ...prepared.selection, expectedFingerprint: fingerprint(fingerprintInput),
      title: selection.kind === 'memory' ? '记忆更新' : '角色状态变化',
      summary: compact(edited.summary), evidence: compact(candidate.evidence || ''), risk, warnings,
      ...(prepared.audit ? { amendmentPreview: { before: prepared.audit.before, after: prepared.audit.after } } : {}) }
  })
  return { projectId: input.projectId, items, requiresConfirmation: items.some((item) => item.decision === 'accept' && item.risk === 'high') }
}

function validateStateTarget(data: AppData, candidate: CharacterStateChangeCandidate) {
  if (!data.characters.some((item) => item.id === candidate.characterId && item.projectId === candidate.projectId)) {
    throw new CandidateDecisionError('角色不存在或不属于当前项目。')
  }
  if (candidate.chapterId && !data.chapters.some((item) => item.id === candidate.chapterId && item.projectId === candidate.projectId)) {
    throw new CandidateDecisionError('来源章节不存在或不属于当前项目。')
  }
  const fact = stateTargetFact(data, candidate)
  if (candidate.targetFactId && !fact) throw new CandidateDecisionError('目标状态事实已不存在，请重新提取或编辑候选。')
  if (fact && (fact.projectId !== candidate.projectId || fact.characterId !== candidate.characterId)) {
    throw new CandidateDecisionError('目标状态事实不属于该角色或项目。')
  }
  if (fact && candidate.beforeValue != null && stableJson(fact.value) !== stableJson(candidate.beforeValue)) {
    throw new CandidateDecisionError('状态账本已改变，与候选的变更前值不一致。', 'CANDIDATE_PREVIEW_STALE')
  }
}

export function candidateDecisionChanges(before: AppData, after: AppData): Partial<AppData> {
  const changes: Partial<AppData> = {}
  for (const key of CANDIDATE_DECISION_COLLECTIONS) {
    if (before[key] === after[key]) continue
    const old = new Map((before[key] as Array<{ id: string }>).map((item) => [item.id, item]))
    const changed = (after[key] as Array<{ id: string }>).filter((item) => old.get(item.id) !== item)
    if (changed.length) Object.assign(changes, { [key]: changed })
  }
  return changes
}

export function candidateDecisionRemovals(before: AppData, after: AppData): CandidateDecisionRemovedRecords[] {
  return CANDIDATE_DECISION_COLLECTIONS.flatMap((collection) => {
    const remaining = new Set((after[collection] as Array<{ id: string }>).map((item) => item.id))
    const ids = (before[collection] as Array<{ id: string }>).filter((item) => !remaining.has(item.id)).map((item) => item.id)
    return ids.length ? [{ collection, ids }] : []
  })
}

export function applyCandidateDecisionChanges(data: AppData, changes: Partial<AppData>, removedRecords: CandidateDecisionRemovedRecords[] = []): AppData {
  const next = { ...data }
  for (const key of CANDIDATE_DECISION_COLLECTIONS) {
    const items = changes[key] as Array<{ id: string }> | undefined
    const removed = new Set(removedRecords.filter((item) => item.collection === key).flatMap((item) => item.ids))
    if (!items?.length && !removed.size) continue
    const replacements = new Map((items ?? []).map((item) => [item.id, item]))
    const merged = (data[key] as Array<{ id: string }>).filter((item) => !removed.has(item.id)).map((item) => {
      const replacement = replacements.get(item.id)
      replacements.delete(item.id)
      return replacement ?? item
    })
    Object.assign(next, { [key]: [...merged, ...replacements.values()] })
  }
  return next
}

export function applyCandidateDecisionCommand(data: AppData, command: CandidateDecisionCommand): {
  data: AppData; receipt: CandidateDecisionReceipt; replayed: boolean
} {
  validateDecisionEnvelope(command)
  if (command.undo !== undefined) return applyCandidateDecisionUndo(data, command)
  const decisions = validateSelections(command.decisions)
  const normalizedCommand: CandidateDecisionCommand = { ...command, decisions }
  const commandFingerprint = fingerprint(normalizedCommand)
  const previous = (data.candidateDecisionReceipts ?? []).find((item) => item.id === command.id)
  if (previous) {
    if (previous.projectId !== command.projectId || previous.commandFingerprint !== commandFingerprint) {
      throw new CandidateDecisionError('同一操作编号不能用于不同决定。', 'CANDIDATE_COMMAND_CONFLICT')
    }
    return { data, receipt: previous, replayed: true }
  }
  const previewSelections = decisions.map(({ kind, candidateId, decision, amendment }) =>
    ({ kind, candidateId, decision, ...(amendment ? { amendment } : {}) }))
  const preview = previewCandidateDecisions(data, { projectId: command.projectId, decisions: previewSelections })
  for (let index = 0; index < preview.items.length; index++) {
    if (preview.items[index].expectedFingerprint !== decisions[index].expectedFingerprint) {
      throw new CandidateDecisionError('候选或关联记录已改变，请重新查看后确认。', 'CANDIDATE_PREVIEW_STALE')
    }
  }
  if (preview.requiresConfirmation && !command.confirmedHighRisk) {
    throw new CandidateDecisionError('请先确认本次高风险变化。', 'CANDIDATE_CONFIRMATION_REQUIRED')
  }
  let next = data
  const amendments: CandidateDecisionAmendmentAudit[] = []
  for (const selection of decisions) {
    const originalCandidate = candidateFor(next, command.projectId, selection)
    const prepared = prepare(next, selection, originalCandidate)
    if (prepared.audit) amendments.push(prepared.audit)
    next = applyPreparedCandidateAmendment(next, prepared, command.decidedAt)
    const candidate = candidateFor(next, command.projectId, selection)
    if ('proposedPatch' in candidate) {
      if (selection.decision === 'reject') next = rejectMemoryCandidateInData(next, candidate, command.decidedAt)
      else {
        const { patch, error } = resolveApplicableMemoryPatch(candidate)
        if (!patch) throw new CandidateDecisionError(error ?? '记忆候选无法应用。')
        const job = next.chapterGenerationJobs.find((item) => item.id === candidate.jobId && item.projectId === command.projectId)
        next = applyMemoryCandidatePatchToData({ current: next, projectId: command.projectId,
          targetChapterOrder: job?.targetChapterOrder ?? null, candidate, patch, timestamp: command.decidedAt })
      }
    } else {
      if (selection.decision === 'accept') validateStateTarget(next, candidate)
      next = selection.decision === 'accept'
        ? CharacterStateService.applyStateChangeCandidate(candidate.id, next)
        : CharacterStateService.rejectStateChangeCandidate(candidate.id, next)
    }
    const decided = selection.kind === 'memory' ? next.memoryUpdateCandidates : next.characterStateChangeCandidates
    if (decided.find((item) => item.id === candidate.id)?.status !== (selection.decision === 'accept' ? 'accepted' : 'rejected')) {
      throw new CandidateDecisionError('候选未能应用，所有变更已取消。')
    }
  }
  next = { ...next, projects: next.projects.map((project) => project.id === command.projectId ? { ...project, updatedAt: command.decidedAt } : project) }
  const changed = candidateDecisionChanges(data, next)
  const receipt: CandidateDecisionReceipt = { id: command.id, projectId: command.projectId,
    actor: { kind: command.actor.kind, ...(command.actor.agentRunId ? { agentRunId: command.actor.agentRunId } : {}) },
    reason: redactSensitiveText(command.reason, [data.settings.apiKey]).slice(0, 1000),
    decidedAt: command.decidedAt, updatedAt: command.decidedAt, schemaVersion: 1, commandFingerprint,
    ...(command.authorizationGrantId ? { authorizationGrantId: command.authorizationGrantId } : {}),
    effects: captureCandidateDecisionEffects(data, next), requiresConfirmation: preview.requiresConfirmation,
    decisions: decisions.map(({ kind, candidateId, decision, expectedFingerprint, amendment }) =>
      ({ kind, candidateId, decision, expectedFingerprint, ...(amendment ? { amendment } : {}) })),
    ...(amendments.length ? { amendments } : {}),
    changedRecords: Object.entries(changed).map(([collection, values]) => ({ collection, ids: (values as Array<{ id: string }>).map((item) => item.id) })) }
  return { data: { ...next, candidateDecisionReceipts: [...(next.candidateDecisionReceipts ?? []), receipt] }, receipt, replayed: false }
}
