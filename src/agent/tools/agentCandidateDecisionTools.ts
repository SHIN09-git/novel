import type { AppData } from '../../shared/types'
import type { CandidateDecisionAmendment, CandidateDecisionCommand, CandidateDecisionItem, CandidateDecisionPreviewItem, CandidateDecisionReceipt, CandidateDecisionSelection } from '../../shared/types/candidateDecision'
import { previewCandidateDecisions } from '../../services/CandidateDecisionService'
import { listDecisionInboxGroups } from '../../services/DecisionInboxService'
import type { AgentRuntimeData } from '../AgentRuntime'
import { saveAgentCandidateDecision } from '../AgentRuntime'
import { compact } from '../agentReadableText'
import { redactSensitiveText } from '../../shared/errorUtils'
import { normalizeCandidateDecisionAmendment } from '../../shared/normalizers/candidateDecision'
import { candidateReceiptForDisplay, redactCandidateValue } from './agentCandidateDecisionOutput'
import { findProjectId, hasApproval, readOptions, requiredPositiveInteger, requiredString } from './agentToolArguments'

const commonFields = ['storagePath', 'userDataPath', 'projectId', 'project']
const readFields = ['detail', 'maxChars']
const stageSummaryLegacyFields = new Set([
  'coveredChapterRange', 'plotProgress', 'characterRelations', 'secrets',
  'foreshadowingPlanted', 'foreshadowingResolved', 'unresolvedQuestions', 'nextStageDirection'
])

function checkFields(args: Record<string, unknown>, fields: string[]): void {
  const allowed = new Set(fields)
  const unknown = Object.keys(args).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`Unsupported candidate decision fields: ${unknown.join(', ')}.`)
}

function validateAgentAmendment(amendment: CandidateDecisionAmendment): void {
  if (amendment.kind !== 'memory' || amendment.patch.kind !== 'stage_summary_create' || !amendment.patch.stageSummary) return
  const legacy = Object.keys(amendment.patch.stageSummary).filter((field) => stageSummaryLegacyFields.has(field))
  if (legacy.length) throw new Error(`StageSummary legacy fields cannot be amended: ${legacy.join(', ')}.`)
}

function selections(args: Record<string, unknown>, apply: true): CandidateDecisionItem[]
function selections(args: Record<string, unknown>, apply: false): CandidateDecisionSelection[]
function selections(args: Record<string, unknown>, apply: boolean): CandidateDecisionSelection[] {
  if (!Array.isArray(args.decisions) || !args.decisions.length || args.decisions.length > 100) {
    throw new Error('decisions must contain between 1 and 100 items.')
  }
  return args.decisions.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each decision must be an object.')
    const item = value as Record<string, unknown>
    checkFields(item, ['kind', 'candidateId', 'decision', 'amendment', ...(apply ? ['expectedFingerprint'] : [])])
    if (item.kind !== 'memory' && item.kind !== 'character_state') throw new Error('kind must be memory or character_state.')
    if (item.decision !== 'accept' && item.decision !== 'reject') throw new Error('decision must be accept or reject.')
    const amendment = item.amendment === undefined ? undefined : normalizeCandidateDecisionAmendment(item.amendment)
    if (item.amendment !== undefined && !amendment) throw new Error('amendment contains unsupported fields or invalid values.')
    if (amendment) validateAgentAmendment(amendment)
    if (amendment && item.decision !== 'accept') throw new Error('Only accepted candidates may include an amendment.')
    if (amendment && amendment.kind !== item.kind) throw new Error('amendment kind must match decision kind.')
    return {
      kind: item.kind,
      candidateId: requiredString(item, 'candidateId'),
      decision: item.decision,
      ...(amendment ? { amendment } : {}),
      ...(apply ? { expectedFingerprint: requiredString(item, 'expectedFingerprint') } : {})
    }
  })
}

function textReader(data: AppData, args: Record<string, unknown>): (value: string) => string {
  const options = readOptions(args)
  return (value) => {
    const safe = redactSensitiveText(value, [data.settings.apiKey])
    return options.detail === 'full'
      ? (options.maxChars ? safe.slice(0, options.maxChars) : safe)
      : compact(safe, Math.min(options.maxChars ?? 320, 320))
  }
}

interface TransformResult<T> {
  value: T
  redacted: boolean
}

// Only string values change; object keys, scalar types and array structure stay intact.
function transformStrings<T>(value: T, transform: (value: string, key: string) => TransformResult<string>, key = ''): TransformResult<T> {
  if (typeof value === 'string') {
    const result = transform(value, key)
    return { ...result, value: result.value as T }
  }
  if (Array.isArray(value)) {
    let redacted = false
    const next = value.map((item) => {
      const transformed = transformStrings(item, transform, key)
      redacted = redacted || transformed.redacted
      return transformed.value
    })
    return { value: next as T, redacted }
  }
  if (value && typeof value === 'object') {
    let redacted = false
    const entries = Object.entries(value).map(([childKey, item]) => {
      const transformed = transformStrings(item, transform, childKey)
      redacted = redacted || transformed.redacted
      return [childKey, transformed.value]
    })
    return { value: Object.fromEntries(entries) as T, redacted }
  }
  return { value, redacted: false }
}

function redactStructuredValue<T>(value: T, secrets: Array<string | undefined | null>): TransformResult<T> {
  return transformStrings(value, (original) => {
    const safe = redactSensitiveText(original, secrets)
    return { value: safe, redacted: safe !== original }
  })
}

function isStableSnapshotField(key: string): boolean {
  const normalized = key.toLowerCase()
  return normalized.endsWith('id') || normalized.endsWith('ids') || [
    'kind', 'schemaversion', 'status', 'category', 'type', 'candidatetype', 'valuetype',
    'trackinglevel', 'promptpolicy', 'source', 'transactiontype', 'decision', 'suggestedweight',
    'recommendedtreatmentmode', 'suggestedstatus', 'changetype', 'linkedcardfields',
    'createdat', 'updatedat', 'decidedat'
  ].includes(normalized)
}

function snapshotForDisplay<T>(
  value: T,
  text: (value: string) => string,
  secrets: Array<string | undefined | null>
): TransformResult<T> {
  return transformStrings(value, (original, key) => {
    const safe = redactSensitiveText(original, secrets)
    return { value: isStableSnapshotField(key) ? safe : text(safe), redacted: safe !== original }
  })
}

function previewItemForOutput(
  item: CandidateDecisionPreviewItem,
  text: (value: string) => string,
  secrets: Array<string | undefined | null>
): { item: CandidateDecisionPreviewItem & { amendmentRedacted?: boolean }; redacted: boolean } {
  let redacted = false
  const next: CandidateDecisionPreviewItem & { amendmentRedacted?: boolean } = { ...item }
  if (item.amendment) {
    const amendment = redactStructuredValue(item.amendment, secrets)
    next.amendment = amendment.value
    redacted = redacted || amendment.redacted
  }
  if (item.amendmentPreview) {
    const amendmentPreview = snapshotForDisplay(item.amendmentPreview, text, secrets)
    next.amendmentPreview = amendmentPreview.value
    redacted = redacted || amendmentPreview.redacted
  }
  if (redacted) next.amendmentRedacted = true
  return { item: next, redacted }
}

function receiptForOutput(
  receipt: CandidateDecisionReceipt,
  text: (value: string) => string,
  secrets: Array<string | undefined | null>
): { receipt: CandidateDecisionReceipt; redacted: boolean } {
  let redacted = false
  const decisions = receipt.decisions.map((decision) => {
    if (!decision.amendment) return decision
    const amendment = redactStructuredValue(decision.amendment, secrets)
    redacted = redacted || amendment.redacted
    return { ...decision, amendment: amendment.value }
  })
  const amendments = receipt.amendments?.map((audit) => {
    const amendment = redactStructuredValue(audit.amendment, secrets)
    const before = snapshotForDisplay(audit.before, text, secrets)
    const after = snapshotForDisplay(audit.after, text, secrets)
    redacted = redacted || amendment.redacted || before.redacted || after.redacted
    return {
      ...audit,
      amendment: amendment.value,
      before: before.value,
      after: after.value
    }
  })
  const reason = redactStructuredValue(receipt.reason, secrets)
  return {
    receipt: { ...receipt, reason: reason.value, decisions, ...(amendments ? { amendments } : {}) },
    redacted: redacted || reason.redacted
  }
}

export function getAgentDecisionInbox(data: AppData, args: Record<string, unknown>): unknown {
  checkFields(args, [...commonFields, ...readFields, 'chapterOrder', 'limit', 'offset'])
  const projectId = findProjectId(data, args)
  const text = textReader(data, args)
  const limit = args.limit === undefined ? 20 : requiredPositiveInteger(args, 'limit', 100)
  const offset = args.offset === undefined ? 0 : args.offset
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer.')
  const groups = listDecisionInboxGroups({
    projectId,
    memoryCandidates: data.memoryUpdateCandidates,
    characterStateChangeCandidates: data.characterStateChangeCandidates,
    jobs: data.chapterGenerationJobs
  }, { chapterOrder: args.chapterOrder === undefined ? undefined : requiredPositiveInteger(args, 'chapterOrder') })
  const full = readOptions(args).detail === 'full'
  return {
    projectId,
    total: groups.length,
    offset,
    nextOffset: offset + limit < groups.length ? offset + limit : null,
    groups: groups.slice(offset, offset + limit).map((group) => ({
      ...group,
      title: text(group.title),
      evidence: group.evidence.map(text),
      riskReasons: group.riskReasons.map(text),
      factCertaintyReason: text(group.factCertaintyReason),
      impactSummary: text(group.impactSummary),
      candidates: full ? group.candidates.map((candidate) => ({ ...candidate, evidence: text(candidate.evidence) })) : undefined
    }))
  }
}

export function previewAgentCandidateDecisions(data: AppData, args: Record<string, unknown>): unknown {
  checkFields(args, [...commonFields, ...readFields, 'decisions'])
  const text = textReader(data, args)
  const secrets = [data.settings.apiKey]
  const preview = previewCandidateDecisions(data, {
    projectId: findProjectId(data, args),
    decisions: selections(args, false)
  })
  let amendmentRedacted = false
  const items = preview.items.map((item) => {
    const output = previewItemForOutput(item, text, secrets)
    amendmentRedacted = amendmentRedacted || output.redacted
    return {
      ...output.item,
      title: text(item.title),
      summary: text(item.summary),
      evidence: text(item.evidence),
      warnings: item.warnings.map(text)
    }
  })
  return {
    ...preview,
    agentCanApply: !preview.requiresConfirmation,
    authorization: preview.requiresConfirmation ? 'human_required' : 'no_high_risk_acceptance',
    ...(amendmentRedacted ? { amendmentRedacted: true } : {}),
    items
  }
}

export async function applyAgentCandidateDecisions(data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData): Promise<unknown> {
  checkFields(args, [...commonFields, 'operationId', 'decisions', 'reason', 'decidedAt', 'agentRunId', 'expectedRevision', 'confirmedHighRisk', 'confirm', 'approvalToken'])
  for (const key of ['confirmedHighRisk', 'confirm']) {
    if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new Error(`${key} must be a boolean.`)
  }
  const projectId = findProjectId(data, args)
  const operationId = requiredString(args, 'operationId')
  const agentRunId = args.agentRunId === undefined ? undefined : requiredString(args, 'agentRunId')
  const receipt = data.candidateDecisionReceipts?.find((item) => item.id === operationId)
  if (!receipt && agentRunId && !data.agentRuns.some((run) => run.id === agentRunId && run.projectId === projectId)) {
    throw new Error(`AgentRun does not belong to project: ${agentRunId}`)
  }
  // Receipt time is reused only when omitted; a caller-supplied change must reach
  // the kernel's command fingerprint check, not silently become a replay.
  const decidedAt = args.decidedAt === undefined
    ? receipt?.decidedAt ?? new Date().toISOString()
    : requiredString(args, 'decidedAt')
  if (!Number.isFinite(Date.parse(decidedAt))) throw new Error('decidedAt must be a valid timestamp.')
  const command: CandidateDecisionCommand = {
    id: operationId,
    projectId,
    actor: { kind: 'agent', ...(agentRunId ? { agentRunId } : {}) },
    reason: requiredString(args, 'reason'),
    decidedAt,
    schemaVersion: 1,
    decisions: selections(args, true),
    confirmedHighRisk: args.confirmedHighRisk === true || hasApproval(args)
  }
  if (args.expectedRevision !== undefined) requiredString(args, 'expectedRevision')
  const expectedRevision = args.expectedRevision === undefined ? runtime.revision : args.expectedRevision as string
  const result = await saveAgentCandidateDecision(command, runtime, expectedRevision)
  const { receipt: savedReceipt, replayed, changes: _changes, ...saved } = result
  const output = receiptForOutput(savedReceipt, textReader(data, args), [data.settings.apiKey])
  const receiptOutput = { ...output.receipt, effects: candidateReceiptForDisplay(savedReceipt, data, args).effects }
  return { receipt: redactCandidateValue(receiptOutput, data), replayed, saved, ...(output.redacted ? { amendmentRedacted: true } : {}) }
}
