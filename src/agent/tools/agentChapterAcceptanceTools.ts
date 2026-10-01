import type { AppData, AgentActionPreview, ChapterAcceptanceReview, ChapterCommitBundle } from '../../shared/types'
import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { buildChapterAcceptanceReview } from '../../services/ChapterAcceptanceReviewService'
import { buildAcceptedDraftCommitBundle, applyChapterCommitBundleToAppData } from '../../services/ChapterCommitBundleService'
import { decisionFingerprint } from '../../services/candidateDecisionPrimitives'
import { AgentDecisionService } from '../AgentDecisionService'
import { saveAgentChapterCommitBundle, saveAgentRuntimeData, type AgentRuntimeData } from '../AgentRuntime'
import { findProjectId, requiredString } from './agentToolArguments'
import type { AgentToolDefinition } from './agentToolTypes'

const prefix = 'chapter-acceptance-v1:'
interface AcceptanceBinding {
  projectId: string
  agentRunId: string
  jobId: string
  draftId: string
  draftHash: string
  chapterOrder: number
  existingChapterHash: string | null
  review: ChapterAcceptanceReview
  reason: string
}

function bind(data: AppData, args: Record<string, unknown>): AcceptanceBinding {
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
  if (args.mode !== 'reviewed' && args.mode !== 'unreviewed') throw new Error('mode 必须为 reviewed 或 unreviewed。')
  const chapter = data.chapters.find((item) => item.projectId === projectId && item.order === job.targetChapterOrder)
  return { projectId, agentRunId: runId, jobId, draftId, draftHash: decisionFingerprint({ title: draft.title, body: draft.body }),
    chapterOrder: job.targetChapterOrder, existingChapterHash: chapter ? decisionFingerprint(chapter) : null,
    review: buildChapterAcceptanceReview(data, draft, args.mode), reason: requiredString(args, 'reason') }
}

function bindingFor(preview: AgentActionPreview): AcceptanceBinding {
  const text = preview.evidence.find((item) => item.startsWith(prefix))
  if (!text) throw new Error('此预览没有绑定当前正文，请重新生成采纳预览。')
  const binding = JSON.parse(text.slice(prefix.length)) as AcceptanceBinding
  if (binding.projectId !== preview.projectId || binding.agentRunId !== preview.agentRunId || binding.jobId !== preview.jobId ||
    !preview.affectedIds.includes(binding.draftId) || preview.reason !== binding.reason) throw new Error('采纳预览来源不一致。')
  return binding
}

function scopeFor(runtime: AgentRuntimeData, binding: AcceptanceBinding) {
  if (!runtime.storagePath) throw new Error('没有可写入的数据源。')
  return { storagePath: runtime.storagePath, projectId: binding.projectId, chapterOrder: binding.chapterOrder,
    actions: binding.review.mode === 'unreviewed' ? ['accept_draft', 'accept_unreviewed_draft'] as const : ['accept_draft'] as const }
}

function output(preview: AgentActionPreview, binding: AcceptanceBinding) {
  return { preview, previewHash: decisionFingerprint(binding), review: binding.review,
    requiredAuthorization: binding.review.mode === 'unreviewed' ? ['accept_draft', 'accept_unreviewed_draft'] : ['accept_draft'] }
}

export async function previewAgentChapterAcceptance(data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData) {
  const projectId = findProjectId(data, args)
  const id = `agent-acceptance-${decisionFingerprint({ projectId, operationId: requiredString(args, 'operationId') })}`
  const prior = data.agentActionPreviews.find((item) => item.id === id)
  if (prior?.status === 'applied') {
    const binding = bindingFor(prior)
    if (binding.agentRunId !== args.agentRunId || binding.jobId !== args.jobId || binding.draftId !== args.draftId ||
      binding.review.mode !== args.mode || binding.reason !== args.reason) throw new Error('同一操作编号不能用于不同采纳决定。')
    return { ...output(prior, binding), replayed: true }
  }
  const binding = bind(data, args)
  if (prior) {
    if (decisionFingerprint(bindingFor(prior)) !== decisionFingerprint(binding)) throw new Error('同一操作编号不能预览不同正文或采纳决定。')
    return { ...output(prior, binding), replayed: true }
  }
  const recommendation = AgentDecisionService.buildAcceptanceRecommendation(data, binding.jobId)
  const timestamp = new Date().toISOString()
  const preview: AgentActionPreview = { id, projectId: binding.projectId, agentRunId: binding.agentRunId, jobId: binding.jobId,
    chapterId: data.generatedChapterDrafts.find((item) => item.id === binding.draftId)?.chapterId ?? null,
    actionType: 'chapter_commit', status: 'pending', summary: `采纳第 ${binding.chapterOrder} 章正文；不自动写入故事状态。`,
    riskLevel: recommendation.riskLevel, diffSummary: [binding.review.mode === 'unreviewed' ? '未完成当前正文审稿。' : '已读取与当前正文匹配的审稿。', ...recommendation.reasons],
    affectedIds: [binding.draftId], requiresHumanApproval: true, recommendation: 'accept', reason: binding.reason,
    evidence: [prefix + JSON.stringify(binding)], createdAt: timestamp, updatedAt: timestamp, schemaVersion: 1 }
  const saved = await saveAgentRuntimeData({ ...data, agentActionPreviews: [...data.agentActionPreviews, preview] }, runtime)
  return { ...output(preview, binding), saved, replayed: false }
}

function withCommitMetadata(data: AppData, preview: AgentActionPreview, bundle: ChapterCommitBundle): AppData {
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

export async function applyAgentChapterAcceptance(data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData) {
  const projectId = findProjectId(data, args)
  const previewId = requiredString(args, 'previewId')
  const preview = data.agentActionPreviews.find((item) => item.id === previewId && item.projectId === projectId)
  if (!preview || preview.actionType !== 'chapter_commit' || preview.status === 'dismissed') throw new Error('采纳预览不存在或已撤销。')
  const binding = bindingFor(preview)
  if (requiredString(args, 'expectedPreviewHash') !== decisionFingerprint(binding)) throw new Error('请核对当前采纳预览。')
  const commitId = `${preview.id}:commit`
  const existing = data.chapterCommitBundles.find((item) => item.commitId === commitId)
  if (existing) {
    if (existing.projectId !== projectId || existing.generatedDraftId !== binding.draftId ||
      existing.jobId !== binding.jobId || existing.actor?.actionPreviewId !== preview.id || existing.acceptedBy !== 'agent' ||
      existing.actor.agentRunId !== binding.agentRunId || decisionFingerprint(existing.acceptanceReview) !== decisionFingerprint(binding.review) ||
      decisionFingerprint({ title: existing.chapter.title, body: existing.chapter.body }) !== binding.draftHash) {
      throw new Error('已有提交与采纳预览不一致。')
    }
    // Recovery completes audit metadata for an already committed chapter. It
    // does not replay the world change or restore an older chapter body.
    if (preview.status !== 'applied') await saveAgentRuntimeData(withCommitMetadata(data, preview, existing), runtime)
    return { commitId, chapterId: existing.chapterId, replayed: true, formalCommit: true }
  }
  const current = bind(data, { projectId, agentRunId: binding.agentRunId, jobId: binding.jobId, draftId: binding.draftId, mode: binding.review.mode, reason: binding.reason })
  if (decisionFingerprint(current) !== decisionFingerprint(binding)) throw new Error('正文、审稿或目标章节已变化，请重新生成采纳预览。')
  return new AgentAuthorizationService(runtime.userDataPath).withAuthorization(scopeFor(runtime, binding), async (grant) => {
    const bundle = buildAcceptedDraftCommitBundle({ appData: data, projectId, draftId: binding.draftId,
      targetChapterOrder: binding.chapterOrder, commitId, chapterId: `${preview.id}:chapter`,
      acceptedAt: new Date().toISOString(), acceptanceMode: binding.review.mode,
      commitNote: `Agent director: ${preview.reason}; grant ${grant.id}.` })
    bundle.acceptedBy = 'agent'
    bundle.actor = { kind: 'agent', agentRunId: binding.agentRunId, actionPreviewId: preview.id, authorizationGrantId: grant.id }
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
      mode: { type: 'string', enum: ['reviewed', 'unreviewed'] }, reason: { type: 'string' } },
    required: ['projectId', 'operationId', 'agentRunId', 'jobId', 'draftId', 'mode', 'reason'] } },
  { name: 'agent.applyChapterAcceptance', riskLevel: 'write_commit',
    description: 'Commit the exact acceptance preview under an active author-issued project grant. Creates a version; does not apply memory candidates. Repeated calls are idempotent.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...common,
      previewId: { type: 'string' }, expectedPreviewHash: { type: 'string' } }, required: ['projectId', 'previewId', 'expectedPreviewHash'] } }
]
