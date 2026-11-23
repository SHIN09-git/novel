import type { AppData, AgentActionPreview, ChapterAcceptanceReview, ChapterCommitBundle } from '../../shared/types'
import type { AgentGrantAction } from '../../shared/types/agentAuthorization'
import { normalizeManualChapterTitle } from '../../shared/normalizers/chapterTitle'
import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { buildChapterAcceptanceReview } from '../../services/ChapterAcceptanceReviewService'
import { buildAcceptedDraftCommitBundle, applyChapterCommitBundleToAppData } from '../../services/ChapterCommitBundleService'
import { decisionFingerprint } from '../../services/candidateDecisionPrimitives'
import { AgentDecisionService } from '../AgentDecisionService'
import { firstPendingRunTarget } from '../agentBatchWriteback'
import { AgentDraftReviewError, assertAgentDraftContent } from '../agentDraftReview'
import { saveAgentChapterCommitBundle, saveAgentRuntimeData, type AgentRuntimeData } from '../AgentRuntime'
import { findProjectId, requiredString } from './agentToolArguments'
import type { AgentToolDefinition } from './agentToolTypes'

const prefix = 'chapter-acceptance-v1:'
export interface AcceptanceBinding {
  projectId: string
  agentRunId: string
  jobId: string
  draftId: string
  draftHash: string
  finalTitle?: string
  chapterOrder: number
  existingChapterHash: string | null
  review: ChapterAcceptanceReview
  reason: string
}

function assertExpectedReports(args: Record<string, unknown>, review: ChapterAcceptanceReview) {
  if ((args.expectedQualityGateReportId !== undefined && args.expectedQualityGateReportId !== review.qualityGateReportId) ||
    (args.expectedEditorialVerdictId !== undefined && args.expectedEditorialVerdictId !== review.editorialVerdictId)) {
    throw new AgentDraftReviewError('DRAFT_REPORT_CHANGED', '当前正文的审稿结论已变化。请刷新工作单后重新决定。')
  }
}

export function bindChapterAcceptance(data: AppData, args: Record<string, unknown>): AcceptanceBinding {
  const projectId = findProjectId(data, args)
  const runId = requiredString(args, 'agentRunId')
  const jobId = requiredString(args, 'jobId')
  const run = data.agentRuns.find((item) => item.id === runId && item.projectId === projectId)
  const job = data.chapterGenerationJobs.find((item) => item.id === jobId && item.projectId === projectId)
  if (!run || !job || !run.createdJobIds.includes(jobId)) throw new Error('批次和任务不属于同一项目。')
  if (job.status === 'running') throw new Error('生成仍在运行，请完成或停止后再采纳。')
  const draftId = requiredString(args, 'draftId')
  const draft = data.generatedChapterDrafts.find((item) => item.id === draftId && item.jobId === jobId && item.projectId === projectId)
  if (!draft || draft.status !== 'draft') throw new Error('草稿不存在或已处理。')
  if (args.expectedDraftContentHash !== undefined) {
    assertAgentDraftContent(draft, requiredString(args, 'expectedDraftContentHash'))
  }
  if (args.mode !== 'reviewed' && args.mode !== 'unreviewed') throw new Error('mode 必须为 reviewed 或 unreviewed。')
  const chapter = data.chapters.find((item) => item.projectId === projectId && item.order === job.targetChapterOrder)
  const review = buildChapterAcceptanceReview(data, draft, args.mode)
  assertExpectedReports(args, review)
  return { projectId, agentRunId: runId, jobId, draftId, draftHash: decisionFingerprint({ title: draft.title, body: draft.body }),
    ...(args.finalTitle !== undefined ? { finalTitle: normalizeManualChapterTitle(args.finalTitle) } : {}),
    chapterOrder: job.targetChapterOrder, existingChapterHash: chapter ? decisionFingerprint(chapter) : null,
    review, reason: requiredString(args, 'reason') }
}

function bindingFor(preview: AgentActionPreview): AcceptanceBinding {
  const text = preview.evidence.find((item) => item.startsWith(prefix))
  if (!text) throw new Error('此预览没有绑定当前正文，请重新生成采纳预览。')
  const binding = JSON.parse(text.slice(prefix.length)) as AcceptanceBinding
  if (binding.projectId !== preview.projectId || binding.agentRunId !== preview.agentRunId || binding.jobId !== preview.jobId ||
    !preview.affectedIds.includes(binding.draftId) || preview.reason !== binding.reason) throw new Error('采纳预览来源不一致。')
  return binding
}

export function acceptanceGrantActions(binding: AcceptanceBinding): AgentGrantAction[] {
  const actions: AgentGrantAction[] = ['accept_draft']
  if (binding.review.mode === 'unreviewed') actions.push('accept_unreviewed_draft')
  if (binding.finalTitle !== undefined) actions.push('manage_chapters')
  return actions
}

function scopeFor(runtime: AgentRuntimeData, binding: AcceptanceBinding) {
  if (!runtime.storagePath) throw new Error('没有可写入的数据源。')
  return { storagePath: runtime.storagePath, projectId: binding.projectId, chapterOrder: binding.chapterOrder,
    actions: acceptanceGrantActions(binding) }
}

export function assertBookCreativeAcceptance(data: AppData, binding: AcceptanceBinding) {
  const report = data.qualityGateReports.find(item => item.id === binding.review.qualityGateReportId && item.projectId === binding.projectId)
  if (binding.review.mode !== 'reviewed' || !['passed', 'needs_review'].includes(binding.review.qualityStatus) ||
    binding.review.editorialStatus === 'blocked' || report?.issues.some(issue => issue.type === 'manual_review_required')) {
    throw new Error('使用全库管理权或全书创作权时，每章必须完成审稿并通过质量门禁后才能提交。请先修订或重审当前草稿。')
  }
  const run = data.agentRuns.find(item => item.projectId === binding.projectId && item.id === binding.agentRunId)!
  if (firstPendingRunTarget(data, run)?.jobId !== binding.jobId) {
    throw new Error('请先提交本批第一个待完成章节，或重新读取当前任务。')
  }
}

function previewHash(preview: AgentActionPreview, binding: AcceptanceBinding) {
  // Preserve the hash of already-issued previews with no title override.
  return decisionFingerprint(binding.finalTitle === undefined ? binding : { previewId: preview.id, binding })
}

function output(preview: AgentActionPreview, binding: AcceptanceBinding) {
  return { preview, previewHash: previewHash(preview, binding), review: binding.review,
    ...(binding.finalTitle !== undefined ? { finalTitle: binding.finalTitle } : {}),
    requiredAuthorization: acceptanceGrantActions(binding) }
}

function checkCommittedBundle(bundle: ChapterCommitBundle, preview: AgentActionPreview, binding: AcceptanceBinding) {
  if (bundle.projectId !== binding.projectId || bundle.generatedDraftId !== binding.draftId || bundle.jobId !== binding.jobId ||
    bundle.actor?.actionPreviewId !== preview.id || bundle.acceptedBy !== 'agent' || bundle.actor.agentRunId !== binding.agentRunId ||
    decisionFingerprint(bundle.acceptanceReview) !== decisionFingerprint(binding.review) || bundle.finalTitle !== binding.finalTitle) {
    throw new Error('已有提交与采纳预览不一致。')
  }
  // Without a title override the released receipt binds the official chapter itself.
  if (binding.finalTitle === undefined) {
    if (decisionFingerprint({ title: bundle.chapter.title, body: bundle.chapter.body }) !== binding.draftHash) {
      throw new Error('已有提交与采纳预览不一致。')
    }
    return
  }
  const source = bundle.generatedDraft
  if (!source || source.id !== binding.draftId || decisionFingerprint({ title: source.title, body: source.body }) !== binding.draftHash ||
    bundle.chapter.title !== binding.finalTitle || bundle.chapterVersion?.title !== binding.finalTitle ||
    bundle.chapter.body !== source.body || bundle.chapterVersion.body !== source.body) {
    throw new Error('已有提交与采纳预览不一致。')
  }
}

export async function previewAgentChapterAcceptance(data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData) {
  const projectId = findProjectId(data, args)
  const id = `agent-acceptance-${decisionFingerprint({ projectId, operationId: requiredString(args, 'operationId') })}`
  const prior = data.agentActionPreviews.find((item) => item.id === id)
  if (prior?.status === 'dismissed') throw new Error('采纳预览已撤销，请使用新的操作编号。')
  const existing = prior && data.chapterCommitBundles.find(item => item.commitId === `${prior.id}:commit`)
  if (prior?.status === 'applied' && !existing) throw new Error('采纳预览已提交但缺少提交记录。')
  if (prior && existing) {
    const binding = bindingFor(prior)
    checkCommittedBundle(existing, prior, binding)
    if (args.expectedDraftContentHash !== undefined &&
      requiredString(args, 'expectedDraftContentHash') !== binding.review.draftContentHash) {
      throw new AgentDraftReviewError('DRAFT_VERSION_CHANGED', '已有提交不对应指定正文版本。')
    }
    assertExpectedReports(args, binding.review)
    if (binding.agentRunId !== requiredString(args, 'agentRunId') || binding.jobId !== requiredString(args, 'jobId') ||
      binding.draftId !== requiredString(args, 'draftId') || binding.review.mode !== args.mode || binding.reason !== requiredString(args, 'reason') ||
      binding.finalTitle !== (args.finalTitle === undefined ? undefined : normalizeManualChapterTitle(args.finalTitle))) {
      throw new Error('同一操作编号不能用于不同采纳决定。')
    }
    return { ...output(prior, binding), replayed: true }
  }
  const binding = bindChapterAcceptance(data, args)
  if (runtime.storagePath && await new AgentAuthorizationService(runtime.userDataPath)
    .requiresReviewedCommits(runtime.storagePath, projectId)) assertBookCreativeAcceptance(data, binding)
  if (prior) {
    if (decisionFingerprint(bindingFor(prior)) !== decisionFingerprint(binding)) throw new Error('同一操作编号不能预览不同正文或采纳决定。')
    return { ...output(prior, binding), replayed: true }
  }
  const recommendation = AgentDecisionService.buildAcceptanceRecommendation(data, binding.jobId, binding.draftId)
  const timestamp = new Date().toISOString()
  const preview: AgentActionPreview = { id, projectId: binding.projectId, agentRunId: binding.agentRunId, jobId: binding.jobId,
    chapterId: data.generatedChapterDrafts.find((item) => item.id === binding.draftId)?.chapterId ?? null,
    actionType: 'chapter_commit', status: 'pending', summary: `采纳第 ${binding.chapterOrder} 章正文；不自动写入故事状态。`,
    riskLevel: recommendation.riskLevel, diffSummary: [binding.review.mode === 'unreviewed' ? '未完成当前正文审稿。' : '已读取与当前正文匹配的审稿。',
      ...(binding.finalTitle !== undefined ? [`正式章节标题：${binding.finalTitle}（保留草稿原题）。`] : []), ...recommendation.reasons],
    affectedIds: [binding.draftId], requiresHumanApproval: true, recommendation: 'accept', reason: binding.reason,
    evidence: [prefix + JSON.stringify(binding)], createdAt: timestamp, updatedAt: timestamp, schemaVersion: 1 }
  const saved = await saveAgentRuntimeData({ ...data, agentActionPreviews: [...data.agentActionPreviews, preview] }, runtime)
  return { ...output(preview, binding), saved, replayed: false }
}

export function withCommitMetadata(data: AppData, preview: AgentActionPreview, bundle: ChapterCommitBundle): AppData {
  const run = data.agentRuns.find((item) => item.id === preview.agentRunId && item.projectId === preview.projectId)
  if (!run) throw new Error('采纳对应的批次已不存在。')
  const committed = applyChapterCommitBundleToAppData(data, bundle)
  const decisionId = `${preview.id}:applied`
  return { ...committed,
    agentActionPreviews: committed.agentActionPreviews.map((item) => item.id === preview.id ? { ...item, status: 'applied', updatedAt: bundle.acceptedAt } : item),
    agentRuns: committed.agentRuns.map((item) => item.id === run.id ? { ...item,
      createdCommitIds: [...new Set([...item.createdCommitIds, bundle.commitId])],
      pendingHumanReviewItemIds: item.pendingHumanReviewItemIds.filter((id) => id !== preview.id),
      updatedAt: item.updatedAt > bundle.acceptedAt ? item.updatedAt : bundle.acceptedAt,
      decisions: [...item.decisions.filter((decision) => decision.id !== decisionId), {
        id: decisionId, agentRunId: run.id, projectId: run.projectId, chapterId: bundle.chapterId, jobId: bundle.jobId,
        step: 'apply_chapter_acceptance', action: 'accept_draft', reason: preview.reason,
        evidence: [`commitId=${bundle.commitId}`, `authorizationGrantId=${bundle.actor?.authorizationGrantId}`, `mode=${bundle.acceptanceReview?.mode}`],
        riskLevel: preview.riskLevel, result: 'applied', createdAt: bundle.acceptedAt
      }]
    } : item) }
}

/** Build from a current binding after checking its grant. Persistence belongs to the caller. */
export function buildBoundChapterCommit(data: AppData, binding: AcceptanceBinding, preview: AgentActionPreview,
  grantId: string, acceptedAt: string): ChapterCommitBundle {
  if (!grantId || preview.projectId !== binding.projectId || preview.agentRunId !== binding.agentRunId || preview.jobId !== binding.jobId) {
    throw new Error('采纳提交缺少授权，或预览与来源任务不匹配。')
  }
  const bundle = buildAcceptedDraftCommitBundle({ appData: data, projectId: binding.projectId, draftId: binding.draftId,
    targetChapterOrder: binding.chapterOrder, commitId: `${preview.id}:commit`, chapterId: `${preview.id}:chapter`,
    acceptedAt, acceptanceMode: binding.review.mode, reviewedLengthOverflowNotice: binding.review.lengthOverflowNotice,
    commitNote: `Agent director: ${binding.reason}; grant ${grantId}.` })
  if (binding.finalTitle !== undefined) {
    bundle.finalTitle = binding.finalTitle
    bundle.chapter.title = binding.finalTitle
    bundle.chapterVersion.title = binding.finalTitle
  }
  bundle.acceptedBy = 'agent'
  bundle.actor = { kind: 'agent', agentRunId: binding.agentRunId, actionPreviewId: preview.id, authorizationGrantId: grantId }
  return bundle
}

export async function applyAgentChapterAcceptance(data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData) {
  const projectId = findProjectId(data, args)
  const previewId = requiredString(args, 'previewId')
  const preview = data.agentActionPreviews.find((item) => item.id === previewId && item.projectId === projectId)
  if (!preview || preview.actionType !== 'chapter_commit' || preview.status === 'dismissed') throw new Error('采纳预览不存在或已撤销。')
  const binding = bindingFor(preview)
  if (requiredString(args, 'expectedPreviewHash') !== previewHash(preview, binding) ||
    (args.finalTitle !== undefined && normalizeManualChapterTitle(args.finalTitle) !== binding.finalTitle)) {
    throw new Error('请核对当前采纳预览。')
  }
  const commitId = `${preview.id}:commit`
  const existing = data.chapterCommitBundles.find((item) => item.commitId === commitId)
  if (existing) {
    checkCommittedBundle(existing, preview, binding)
    // Recovery completes audit metadata for an already committed chapter. It
    // does not replay the world change or restore an older chapter body.
    if (preview.status !== 'applied') await saveAgentRuntimeData(withCommitMetadata(data, preview, existing), runtime)
    return { commitId, chapterId: existing.chapterId, replayed: true, formalCommit: true }
  }
  if (preview.status === 'applied') throw new Error('采纳预览已提交但缺少提交记录。')
  const current = bindChapterAcceptance(data, { projectId, agentRunId: binding.agentRunId, jobId: binding.jobId, draftId: binding.draftId,
    mode: binding.review.mode, reason: binding.reason, finalTitle: binding.finalTitle })
  if (decisionFingerprint(current) !== decisionFingerprint(binding)) throw new Error('正文、审稿或目标章节已变化，请重新生成采纳预览。')
  return new AgentAuthorizationService(runtime.userDataPath).withAuthorization(scopeFor(runtime, binding), async (grant, reviewedCommitsRequired) => {
    if (reviewedCommitsRequired) assertBookCreativeAcceptance(data, current)
    const bundle = buildBoundChapterCommit(data, current, preview, grant.id, new Date().toISOString())
    const next = withCommitMetadata(data, preview, bundle)
    const commitSave = await saveAgentChapterCommitBundle(bundle, runtime)
    runtime.data = applyChapterCommitBundleToAppData(data, bundle)
    const metadataSave = await saveAgentRuntimeData(next, runtime)
    return { commitId, chapterId: bundle.chapterId, review: bundle.acceptanceReview, authorizationGrantId: grant.id,
      commitSave, metadataSave, replayed: false, formalCommit: true }
  })
}

const common = { storagePath: { type: 'string' }, userDataPath: { type: 'string' }, projectId: { type: 'string' } }
export const AGENT_CHAPTER_ACCEPTANCE_DEFINITIONS: AgentToolDefinition[] = [
  { name: 'agent.previewChapterAcceptance', riskLevel: 'write_preview',
    description: 'Bind an explicit director acceptance decision to the exact current draft, reports and target chapter. Preview only. Acceptance may disagree with a review without claiming it passed.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...common,
      operationId: { type: 'string' }, agentRunId: { type: 'string' }, jobId: { type: 'string' }, draftId: { type: 'string' },
      mode: { type: 'string', enum: ['reviewed', 'unreviewed'] }, reason: { type: 'string' },
      finalTitle: { type: 'string', description: 'Optional official single-line title. Preserves the reviewed draft title; requires manage_chapters in the same grant.' },
      expectedDraftContentHash: { type: 'string', description: 'Pin the draft body that was read in the work item.' },
      expectedQualityGateReportId: { type: ['string', 'null'] },
      expectedEditorialVerdictId: { type: ['string', 'null'] } },
    required: ['projectId', 'operationId', 'agentRunId', 'jobId', 'draftId', 'mode', 'reason'] } },
  { name: 'agent.applyChapterAcceptance', riskLevel: 'write_commit',
    description: 'Commit the exact acceptance preview under an active author-issued project grant. Creates a version; does not apply memory candidates. Repeated calls are idempotent.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...common,
      previewId: { type: 'string' }, expectedPreviewHash: { type: 'string' },
      finalTitle: { type: 'string', description: 'Optional assertion of the title already bound by preview; cannot introduce or override it.' },
      responseMode: { type: 'string', enum: ['work_item'], description: 'Include the next chapter work item after the commit.' }
    }, required: ['projectId', 'previewId', 'expectedPreviewHash'] } }
]
