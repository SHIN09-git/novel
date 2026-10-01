import type { AppData, CandidateDecisionCommand, CandidateDecisionUndoPreview } from '../../shared/types'
import { previewCandidateDecisionUndo } from '../../services/CandidateDecisionUndoService'
import { saveAgentCandidateDecision, type AgentRuntimeData } from '../AgentRuntime'
import { candidateDecisionText, candidateReceiptForDisplay, redactCandidateValue } from './agentCandidateDecisionOutput'
import { findProjectId, readOptions, requiredPositiveInteger, requiredString } from './agentToolArguments'

const common = ['storagePath', 'userDataPath', 'projectId', 'project']
const reading = ['detail', 'maxChars']
function checkFields(args: Record<string, unknown>, allowed: string[]) {
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new Error(`Unsupported candidate undo fields: ${unknown.join(', ')}.`)
}

function authorization(preview: CandidateDecisionUndoPreview) {
  return {
    agentCanUndo: !preview.requiresConfirmation && (preview.status === 'ready' ||
      (preview.status === 'conflict' && preview.canRestoreConflicts)),
    authorization: preview.requiresConfirmation ? 'human_required' : 'no_high_risk_acceptance'
  }
}

export function getAgentCandidateDecisionHistory(data: AppData, args: Record<string, unknown>) {
  checkFields(args, [...common, ...reading, 'receiptId', 'limit', 'offset'])
  readOptions(args)
  const projectId = findProjectId(data, args)
  const receiptId = args.receiptId === undefined ? undefined : requiredString(args, 'receiptId')
  const limit = args.limit === undefined ? 20 : requiredPositiveInteger(args, 'limit', 100)
  const offset = args.offset ?? 0
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer.')
  const receipts = data.candidateDecisionReceipts.filter((receipt) => receipt.projectId === projectId && (!receiptId || receipt.id === receiptId))
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt) || b.id.localeCompare(a.id))
  return {
    projectId, total: receipts.length, offset, nextOffset: offset + limit < receipts.length ? offset + limit : null,
    receipts: receipts.slice(offset, offset + limit).map((receipt) => {
      const preview = previewCandidateDecisionUndo(data, { projectId, receiptId: receipt.id })
      return { ...candidateReceiptForDisplay(receipt, data, args), undoStatus: preview.status, ...authorization(preview) }
    })
  }
}

export function previewAgentCandidateDecisionUndo(data: AppData, args: Record<string, unknown>) {
  checkFields(args, [...common, ...reading, 'receiptId'])
  const preview = previewCandidateDecisionUndo(data, { projectId: findProjectId(data, args), receiptId: requiredString(args, 'receiptId') })
  const full = readOptions(args).detail === 'full'
  return redactCandidateValue({
    ...preview, ...authorization(preview), warnings: preview.warnings.map((warning) => candidateDecisionText(warning, data, args)),
    items: preview.items.map(({ fields, ...item }) => ({ ...item, title: candidateDecisionText(item.title, data, args),
      fieldCount: fields.length, conflictCount: fields.filter((field) => field.conflicted).length,
      ...(full ? { fields } : {}) }))
  }, data)
}

export async function undoAgentCandidateDecision(data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData) {
  checkFields(args, [...common, ...reading, 'operationId', 'receiptId', 'expectedFingerprint', 'expectedRevision',
    'agentRunId', 'reason', 'decidedAt', 'confirm', 'restoreChangedFields'])
  readOptions(args)
  if (args.confirm !== true) throw new Error('confirm=true must acknowledge the exact undo preview; it does not grant human authorization.')
  if (args.restoreChangedFields !== undefined && typeof args.restoreChangedFields !== 'boolean') throw new Error('restoreChangedFields must be a boolean.')
  const projectId = findProjectId(data, args)
  const id = requiredString(args, 'operationId')
  const receipt = data.candidateDecisionReceipts.find((item) => item.id === id)
  const agentRunId = args.agentRunId === undefined ? undefined : requiredString(args, 'agentRunId')
  const decidedAt = args.decidedAt === undefined ? receipt?.decidedAt ?? new Date().toISOString() : requiredString(args, 'decidedAt')
  if (!Number.isFinite(Date.parse(decidedAt))) throw new Error('decidedAt must be a valid timestamp.')
  const command: CandidateDecisionCommand = {
    id, projectId, actor: { kind: 'agent', ...(agentRunId ? { agentRunId } : {}) },
    reason: requiredString(args, 'reason'), decidedAt, schemaVersion: 1, decisions: [],
    undo: { receiptId: requiredString(args, 'receiptId'), expectedFingerprint: requiredString(args, 'expectedFingerprint'),
      ...(args.restoreChangedFields === undefined ? {} : { restoreChangedFields: args.restoreChangedFields as boolean }) }
  }
  const expectedRevision = args.expectedRevision === undefined ? runtime.revision : requiredString(args, 'expectedRevision')
  const result = await saveAgentCandidateDecision(command, runtime, expectedRevision).catch((error: unknown) => {
    if (error instanceof Error) {
      error.message = redactCandidateValue(error.message, runtime.data)
      throw error
    }
    throw new Error(redactCandidateValue(String(error), runtime.data))
  })
  const { receipt: savedReceipt, changes: _changes, removedRecords, ...saved } = result
  return { receipt: candidateReceiptForDisplay(savedReceipt, runtime.data, args), ...saved,
    removedRecords: redactCandidateValue(removedRecords, runtime.data) }
}
