import type { AppData, CandidateDecisionCommand, CandidateDecisionReceipt, CandidateDecisionUndoPreview } from '../shared/types'
import { redactSensitiveText } from '../shared/errorUtils'
import { normalizeCandidateDecisionEffects } from '../shared/normalizers/candidateDecisionHistory'
import { addedCurrentFields, captureCandidateDecisionEffects, equalField, fieldValue, restoreField,
  traceMembershipRestore, undoEffectAction } from './candidateDecisionEffects'
import { CandidateDecisionError, decisionFingerprint, decisionRecords, validateDecisionEnvelope } from './candidateDecisionPrimitives'
import { laterDecisionTouches, liveUndoDependencies } from './candidateDecisionUndoChecks'

export function previewCandidateDecisionUndo(data: AppData, input: { projectId: string; receiptId: string }): CandidateDecisionUndoPreview {
  const receipt = data.candidateDecisionReceipts?.find((item) => item.id === input.receiptId && item.projectId === input.projectId)
  if (!receipt || !data.projects.some((item) => item.id === input.projectId)) throw new CandidateDecisionError('该项目中没有这次决定。')
  const reverted = data.candidateDecisionReceipts.find((item) => item.projectId === input.projectId && item.undoesReceiptId === receipt.id)
  const preview: CandidateDecisionUndoPreview = { ...input, status: 'ready', expectedFingerprint: '', items: [], warnings: [],
    requiresConfirmation: receipt.requiresConfirmation ?? receipt.decisions.some((item) => item.decision === 'accept'),
    canRestoreConflicts: false }
  if (reverted) return { ...preview, status: 'already_undone', undoReceiptId: reverted.id, warnings: ['这次决定已撤销，不会重复执行。'] }
  const effects = normalizeCandidateDecisionEffects(receipt.effects)
  if (receipt.operation === 'undo' || !effects) return { ...preview, status: 'unavailable',
    warnings: [receipt.operation === 'undo' ? '这是撤销记录。需要重新采纳时，请处理恢复为待确认的候选。' : '旧决定未保存完整的变更前值，不能自动还原。可查看原建议并手动修正相应记录。'] }
  let unavailable = false
  let hasConflict = false
  for (const effect of effects) {
    const matches = decisionRecords(data, effect.collection).filter((item) => item.id === effect.id)
    const current = matches[0]
    const action = undoEffectAction(effect)
    const ownershipChanged = current && Object.entries(effect.ownership ?? {}).some(([key, value]) => current[key] !== value)
    if (matches.length > 1 || current && current.projectId !== input.projectId || ownershipChanged || !current && !effect.created) {
      unavailable = true
      preview.warnings.push(`“${effect.title}”已不存在或所属记录发生变化，请先核对该记录。`)
      continue
    }
    const fields = [...effect.fields, ...(current ? addedCurrentFields(effect, current) : [])].map((field) => {
      const value = fieldValue(current, field.path)
      const merged = traceMembershipRestore(effect, field, value)
      const later = !merged && laterDecisionTouches(data, receipt, effect, field.path)
      const conflicted = action !== 'retain_history' && Boolean(current) && !merged &&
        (later || !equalField(value, field.after) && !equalField(value, field.before))
      if (conflicted) hasConflict = true
      return { ...field, current: value, conflicted }
    })
    preview.items.push({ collection: effect.collection, id: effect.id, title: effect.title, action, fields })
  }
  const dependencies = liveUndoDependencies(data, effects)
  if (dependencies.length) { unavailable = true; preview.warnings.push(...dependencies) }
  if (hasConflict) preview.warnings.push('部分字段在此后被修改或由另一决定更新。核对差异后，可以明确恢复原值；其他字段不会改动。')
  preview.status = unavailable ? 'unavailable' : hasConflict ? 'conflict' : 'ready'
  preview.canRestoreConflicts = hasConflict && !unavailable
  preview.expectedFingerprint = decisionFingerprint({ receipt, items: preview.items, dependencies, unavailable })
  return preview
}

function appendCompensatingTransactions(before: AppData, after: AppData, receipt: CandidateDecisionReceipt, command: CandidateDecisionCommand): AppData {
  const transactions = receipt.effects?.filter((effect) => effect.collection === 'characterStateFacts').flatMap((effect) => {
    const previous = before.characterStateFacts.find((item) => item.id === effect.id && item.projectId === command.projectId)
    const fact = after.characterStateFacts.find((item) => item.id === effect.id && item.projectId === command.projectId)
    if (!fact || !previous) return []
    return [{ id: crypto.randomUUID(), projectId: command.projectId, characterId: fact.characterId, factId: fact.id,
      chapterId: fact.sourceChapterId, chapterOrder: fact.sourceChapterOrder,
      transactionType: effect.created ? 'invalidate' as const : 'update' as const,
      beforeValue: previous.value, afterValue: fact.value,
      delta: typeof fact.value === 'number' && typeof previous.value === 'number' ? fact.value - previous.value : null,
      reason: `撤销候选决定 ${receipt.id}；补偿记录 ${command.id}`, evidence: '', source: 'manual' as const,
      status: 'accepted' as const, createdAt: command.decidedAt, updatedAt: command.decidedAt }]
  }) ?? []
  return transactions.length ? { ...after, characterStateTransactions: [...after.characterStateTransactions, ...transactions] } : after
}

export function applyCandidateDecisionUndo(data: AppData, command: CandidateDecisionCommand): {
  data: AppData; receipt: CandidateDecisionReceipt; replayed: boolean
} {
  validateDecisionEnvelope(command)
  const undo = command.undo
  if (!undo || typeof undo.receiptId !== 'string' || !undo.receiptId || typeof undo.expectedFingerprint !== 'string' ||
    !undo.expectedFingerprint || !Array.isArray(command.decisions) || command.decisions.length ||
    undo.restoreChangedFields !== undefined && typeof undo.restoreChangedFields !== 'boolean') {
    throw new CandidateDecisionError('撤销决定参数不完整，请重新查看变更预览。')
  }
  const fingerprint = decisionFingerprint(command)
  const previous = data.candidateDecisionReceipts.find((item) => item.id === command.id)
  if (previous) {
    if (previous.projectId !== command.projectId || previous.commandFingerprint !== fingerprint) throw new CandidateDecisionError('同一操作编号不能用于不同决定。', 'CANDIDATE_COMMAND_CONFLICT')
    return { data, receipt: previous, replayed: true }
  }
  const preview = previewCandidateDecisionUndo(data, { projectId: command.projectId, receiptId: undo.receiptId })
  if (preview.status === 'already_undone') return { data,
    receipt: data.candidateDecisionReceipts.find((item) => item.id === preview.undoReceiptId)!, replayed: true }
  if (preview.status === 'unavailable') throw new CandidateDecisionError(preview.warnings.join('\n'), 'CANDIDATE_UNDO_UNAVAILABLE')
  if (preview.expectedFingerprint !== undo.expectedFingerprint) throw new CandidateDecisionError('相关字段已变化，请重新查看撤销预览。', 'CANDIDATE_PREVIEW_STALE')
  if (preview.status === 'conflict' && !undo.restoreChangedFields) throw new CandidateDecisionError('请核对差异，并明确是否恢复后来改动的字段。', 'CANDIDATE_UNDO_CONFLICT')
  if (preview.requiresConfirmation && !command.confirmedHighRisk) throw new CandidateDecisionError('请先确认撤销这次高风险决定。', 'CANDIDATE_CONFIRMATION_REQUIRED')
  const original = data.candidateDecisionReceipts.find((item) => item.id === undo.receiptId && item.projectId === command.projectId)!
  let next = { ...data }
  for (const item of preview.items) {
    if (item.action === 'retain_history') continue
    const effect = original.effects!.find((entry) => entry.collection === item.collection && entry.id === item.id)!
    const records = decisionRecords(next, item.collection)
    const changed = records.flatMap((record) => {
      if (record.id !== item.id) return [record]
      if (item.action === 'remove_created') return []
      const updated = structuredClone(record)
      if (item.action === 'deactivate_created') updated.status = 'inactive'
      else for (const field of item.fields) {
        restoreField(updated, field.path, traceMembershipRestore(effect, field, field.current) ?? field.before)
      }
      if (Object.hasOwn(record, 'updatedAt')) updated.updatedAt = command.decidedAt
      return [updated]
    })
    Object.assign(next, { [item.collection]: changed })
  }
  next = appendCompensatingTransactions(data, next, original, command)
  next.projects = data.projects.map((item) => item.id === command.projectId ? { ...item, updatedAt: command.decidedAt } : item)
  const effects = captureCandidateDecisionEffects(data, next)
  const removed = preview.items.filter((item) => item.action === 'remove_created')
  const receipt: CandidateDecisionReceipt = { id: command.id, projectId: command.projectId, actor: { ...command.actor },
    reason: redactSensitiveText(command.reason, [data.settings.apiKey]).slice(0, 1000), decidedAt: command.decidedAt, updatedAt: command.decidedAt,
    schemaVersion: 1, commandFingerprint: fingerprint, decisions: [], operation: 'undo', undoesReceiptId: original.id,
    ...(command.authorizationGrantId ? { authorizationGrantId: command.authorizationGrantId } : {}),
    requiresConfirmation: preview.requiresConfirmation, effects,
    changedRecords: [...effects, ...removed].map((effect) => ({ collection: effect.collection, ids: [effect.id] })) }
  return { data: { ...next, candidateDecisionReceipts: [...data.candidateDecisionReceipts, receipt] }, receipt, replayed: false }
}
