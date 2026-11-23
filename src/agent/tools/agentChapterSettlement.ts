import { createHash } from 'node:crypto'
import { normalizeManualChapterTitle } from '../../shared/normalizers/chapterTitle'
import type { AgentActionPreview, AppData, CandidateDecisionSelection } from '../../shared/types'
import type { AgentGrantAction } from '../../shared/types/agentAuthorization'
import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { readCandidateDraftSource } from '../../services/CandidateDraftSource'
import { previewCandidateDecisions } from '../../services/CandidateDecisionService'
import { stableDecisionJson } from '../../services/candidateDecisionPrimitives'
import { memoryPatchChapterReference, resolveApplicableMemoryPatch } from '../../services/MemoryCandidateService'
import { applyCandidateDecisionForStorage } from '../../storage/JsonStorageService'
import { saveAgentRuntimeData, type AgentRuntimeData } from '../AgentRuntime'
import { requireAgentPendingDraft } from '../agentDraftActions'
import { requiredString } from './agentToolArguments'
import { selections } from './agentCandidateDecisionTools'
import { redactCandidateValue } from './agentCandidateDecisionOutput'
import { acceptanceGrantActions, assertBookCreativeAcceptance, bindChapterAcceptance,
  buildBoundChapterCommit, withCommitMetadata } from './agentChapterAcceptanceTools'

const digest = (value: unknown) => createHash('sha256').update(stableDecisionJson(value)).digest('hex')
const previewFields = ['projectId', 'agentRunId', 'jobId', 'draftId', 'operationId', 'reason', 'finalTitle',
  'expectedDraftContentHash', 'expectedQualityGateReportId', 'expectedEditorialVerdictId', 'decisions', 'mode']
function checkFields(args: Record<string, unknown>, fields: string[]) {
  const unknown = Object.keys(args).filter(k => ![...fields, 'storagePath', 'userDataPath'].includes(k))
  if (unknown.length) throw new Error('不支持的章节结算参数：' + unknown.join(', '))
}
function parseRequest(args: Record<string, unknown>) {
  checkFields(args, previewFields)
  if (args.mode !== undefined && args.mode !== 'reviewed') throw new Error('章节结算只接受已审稿章节。')
  return { projectId: requiredString(args, 'projectId'), agentRunId: requiredString(args, 'agentRunId'),
    jobId: requiredString(args, 'jobId'), draftId: requiredString(args, 'draftId'), operationId: requiredString(args, 'operationId'),
    reason: requiredString(args, 'reason'), ...(args.finalTitle !== undefined ? { finalTitle: normalizeManualChapterTitle(args.finalTitle) } : {}),
    ...Object.fromEntries(['expectedDraftContentHash', 'expectedQualityGateReportId', 'expectedEditorialVerdictId']
      .filter(k => args[k] !== undefined).map(k => [k, args[k]])),
    decisions: Array.isArray(args.decisions) && !args.decisions.length ? [] : selections(args, false) }
}
type Request = ReturnType<typeof parseRequest>
type Seal = { request: Request; previewHash: string }

function checkTargets(data: AppData, request: Request, order: number, chapterId: string) {
  for (const row of request.decisions) {
    const list = row.kind === 'memory' ? data.memoryUpdateCandidates : data.characterStateChangeCandidates
    const item = list.find(c => c.id === row.candidateId && c.projectId === request.projectId)
    if (!item || item.jobId !== request.jobId) throw new Error('只能结算本项目、本任务的候选。')
    const source = readCandidateDraftSource(data, item)
    if (source.status !== 'current_draft' || source.draft?.id !== request.draftId) throw new Error('候选未绑定当前正文，请从收件箱单独核对。')
    if (row.decision === 'reject') continue
    const sameChapter = (id?: string | null, n?: number | null) => {
      if ((id != null && id !== chapterId) || (n != null && n !== order)) throw new Error('跨章候选不能随本章结算，请单独预览。')
    }
    if ('proposedPatch' in item) {
      const { patch, error } = resolveApplicableMemoryPatch(item)
      if (!patch) throw new Error(error || '无法读取候选目标。')
      const target = memoryPatchChapterReference(patch, order)
      sameChapter(target.chapterId, target.chapterOrder)
      if (patch.kind === 'chapter_review_update') sameChapter(item.targetId)
      if (patch.kind === 'timeline_event_create') sameChapter(patch.event.chapterId, patch.event.chapterOrder)
      if (patch.kind === 'foreshadowing_create') sameChapter(null, patch.candidate.firstChapterOrder)
      if (patch.kind === 'foreshadowing_status_update') sameChapter(null, patch.actualPayoffChapter)
      if (patch.kind === 'stage_summary_create') {
        sameChapter(null, patch.stageSummary.chapterStart)
        sameChapter(null, patch.stageSummary.chapterEnd)
      }
    } else sameChapter(item.chapterId, item.chapterOrder)
  }
}

const candidatePreview = (data: AppData, projectId: string, decisions: CandidateDecisionSelection[]) =>
  decisions.length ? previewCandidateDecisions(data, { projectId, decisions }) : { projectId, items: [], requiresConfirmation: false }

function projectSettlement(data: AppData, request: Request, preview: AgentActionPreview, at: string, grantId: string) {
  const binding = bindChapterAcceptance(data, { ...request, mode: 'reviewed' })
  assertBookCreativeAcceptance(data, binding)
  const bundle = buildBoundChapterCommit(data, binding, preview, grantId, at)
  checkTargets(data, request, binding.chapterOrder, bundle.chapterId)
  const before = candidatePreview(data, request.projectId, request.decisions)
  const next = withCommitMetadata(data, preview, bundle)
  const after = candidatePreview(next, request.projectId, request.decisions)
  // Acceptance legitimately changes chapter.updatedAt and current_draft -> current_chapter.
  // Seal the real before-state fingerprints AND what the author will decide after acceptance.
  const effective = after.items.map(({ expectedFingerprint: _fp, ...item }) => item)
  const reportEvidence = [bundle.qualityGateReports, bundle.consistencyReviewReports,
    data.editorialVerdicts.find(v => v.id === binding.review.editorialVerdictId)]
  const previewHash = digest([request, binding, before.items.map(i => i.expectedFingerprint), effective, reportEvidence])
  return { bundle, binding, previewHash, after }
}

function receipt(data: AppData, preview: AgentActionPreview, request: Request) {
  const commit = data.chapterCommitBundles.find(c => c.commitId === preview.id + ':commit' && c.projectId === preview.projectId &&
    c.generatedDraftId === request.draftId && c.actor?.actionPreviewId === preview.id)
  const receiptId = request.decisions.length ? preview.id + ':decisions' : null
  if (!commit || (receiptId && !data.candidateDecisionReceipts.some(r => r.id === receiptId && r.projectId === preview.projectId)))
    throw new Error('结算记录不完整，未重复写入。')
  return { commitId: commit.commitId, chapterId: commit.chapterId, candidateReceiptId: receiptId, formalCommit: true,
    authorizationGrantId: commit.actor?.authorizationGrantId }
}

export async function previewChapterSettlement(data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData) {
  const request = parseRequest(args)
  if (digest(request) !== digest(redactCandidateValue(request, data))) throw new Error('结算说明或候选内容中包含敏感凭据，请移除后再预览。')
  const id = 'agent-settlement-' + digest([request.projectId, request.operationId])
  const prior = data.agentActionPreviews.find(p => p.id === id)
  const previous = prior && readSeal(prior)
  if (previous && digest(request) !== digest(previous.request)) throw new Error('同一操作编号不能用于不同结算。')
  if (prior?.status === 'applied' && previous) return { previewId: id, previewHash: previous.previewHash, ...receipt(data, prior, request), replayed: true }
  await requireAgentPendingDraft(runtime, request.projectId, request.agentRunId, request.draftId)
  const at = new Date().toISOString()
  const preview: AgentActionPreview = prior ?? { id, projectId: request.projectId, jobId: request.jobId, agentRunId: request.agentRunId,
    chapterId: null, actionType: 'chapter_settlement', status: 'pending', summary: '采纳审稿后的章节，处理明确选中的候选。',
    riskLevel: 'medium', diffSummary: [], affectedIds: [request.draftId, ...request.decisions.map(d => d.candidateId)],
    requiresHumanApproval: true, recommendation: 'accept', reason: request.reason, evidence: [], createdAt: at, updatedAt: at, schemaVersion: 1 }
  const result = projectSettlement(data, request, preview, preview.createdAt, 'preview-only')
  if (previous && previous.previewHash !== result.previewHash) throw new Error('结算依据已变，请使用新的操作编号重新预览。')
  if (!prior) {
    preview.evidence = [JSON.stringify({ request, previewHash: result.previewHash } satisfies Seal)]
    preview.chapterId = result.bundle.chapterId
    preview.riskLevel = result.after.requiresConfirmation ? 'high' : 'medium'
    await saveAgentRuntimeData({ ...data, agentActionPreviews: [...data.agentActionPreviews, preview] }, runtime)
  }
  return { previewId: id, previewHash: result.previewHash, chapterOrder: result.binding.chapterOrder,
    finalTitle: result.bundle.chapter.title, review: result.binding.review, candidatePreview: redactCandidateValue(result.after, data), replayed: Boolean(prior) }
}

function readSeal(preview: AgentActionPreview): Seal {
  if (preview.actionType !== 'chapter_settlement' || !['pending', 'applied'].includes(preview.status)) throw new Error('结算预览无效。')
  const stored = JSON.parse(preview.evidence[0]) as Seal
  const seal = { request: parseRequest(stored.request), previewHash: stored.previewHash }
  if (seal.request.projectId !== preview.projectId || seal.request.agentRunId !== preview.agentRunId || seal.request.jobId !== preview.jobId ||
    seal.request.reason !== preview.reason ||
    preview.id !== 'agent-settlement-' + digest([preview.projectId, seal.request.operationId])) throw new Error('结算预览来源不一致。')
  return seal
}

export async function applyChapterSettlement(data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData) {
  checkFields(args, ['projectId', 'previewId', 'expectedPreviewHash', 'responseMode'])
  const projectId = requiredString(args, 'projectId'), id = requiredString(args, 'previewId')
  const preview = data.agentActionPreviews.find(p => p.projectId === projectId && p.id === id)
  if (!preview || !runtime.storagePath) throw new Error('找不到章节结算预览。')
  const { request, previewHash } = readSeal(preview)
  if (requiredString(args, 'expectedPreviewHash') !== previewHash) throw new Error('结算指纹不匹配，请核对预览。')
  if (preview.status === 'applied') return { ...receipt(data, preview, request), replayed: true }
  await requireAgentPendingDraft(runtime, projectId, request.agentRunId, request.draftId)
  const at = new Date().toISOString()
  const probe = projectSettlement(data, request, preview, at, 'preview-only')
  if (probe.previewHash !== previewHash) throw new Error('正文、目标章节、审稿或候选已变化，请重新预览。')
  const authority = new AgentAuthorizationService(runtime.userDataPath)
  const actions: AgentGrantAction[] = [...acceptanceGrantActions(probe.binding)]
  if (probe.after.requiresConfirmation || (request.decisions.length && await authority.requiresReviewedCommits(runtime.storagePath, projectId)))
    actions.push('accept_high_risk_candidates')
  return authority.withAuthorization({ projectId, storagePath: runtime.storagePath, chapterOrder: probe.binding.chapterOrder, actions }, async (grant, reviewed) => {
    if (reviewed && request.decisions.length && grant.purpose !== 'library_manager' && !grant.actions.includes('accept_high_risk_candidates'))
      throw new Error('当前授权不覆盖候选决定。')
    // Both domain kernels run against one input snapshot. No intermediate state reaches storage.
    const bundle = buildBoundChapterCommit(data, probe.binding, preview, grant.id, at)
    let next = withCommitMetadata(data, preview, bundle)
    if (request.decisions.length) {
      const decided = applyCandidateDecisionForStorage(next, { projectId, id: id + ':decisions', schemaVersion: 1,
        decisions: probe.after.items.map(({ kind, candidateId, decision, amendment, expectedFingerprint }) =>
          ({ kind, candidateId, decision, ...(amendment ? { amendment } : {}), expectedFingerprint })),
        actor: { kind: 'agent', agentRunId: request.agentRunId }, decidedAt: at, reason: request.reason,
        authorizationGrantId: grant.id, confirmedHighRisk: probe.after.requiresConfirmation })
      if (decided.replayed) throw new Error('结算候选回执编号已占用。')
      next = decided.data
    }
    const result = receipt(next, preview, request)
    const saved = await saveAgentRuntimeData(next, runtime)
    return { ...result, saved, replayed: false }
  })
}
