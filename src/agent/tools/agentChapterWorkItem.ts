import type { AgentRun, AppData, ChapterGenerationJob, GeneratedChapterDraft } from '../../shared/types'
import type { AgentGrantAction } from '../../shared/types/agentAuthorization'
import { redactSensitiveText } from '../../shared/errorUtils'
import { hasCurrentChapterFragment } from '../../shared/chapterStepFragment'
import { readChapterProseHandoff } from '../../shared/chapterProseHandoff'
import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { AuthorDecisionPolicyService } from '../../services/AuthorDecisionPolicyService'
import { createBookWritebackIndex } from '../../services/BookWritebackService'
import { hasCompleteChapterReview } from '../../services/ChapterAcceptanceReviewService'
import { ChapterTaskContractService } from '../../services/ChapterTaskContractService'
import { getPipelineRoleForStep } from '../../services/PipelineRunContextService'
import { findActiveChapterByOrder } from '../../services/ChapterLifecycleService'
import { isProjectArchived } from '../../services/ProjectLifecycleService'
import { currentHardCanonAudit } from '../../services/HardCanonPreflight'
import { withCurrentHardCanonAudit } from '../../services/qualityGate/hardCanonQuality'
import { visibleCharacterCount } from '../../services/chapterTaskContractText'
import { readRunWriteback } from '../agentBatchWriteback'
import { readAgentJobExecution } from '../agentJobExecution'
import { currentAgentDraftDecision, latestAgentDraft } from '../agentDraftActions'
import { readAgentContinuityHandoff } from '../agentContinuityHandoff'
import { agentDraftReportRecords, assertAgentDraftContent, collectAgentDraftReview, type AgentDraftReportKind } from '../agentDraftReview'
import { resolveAgentPipelineResumeStep } from '../agentPipelineResume'
import { AGENT_PIPELINE_STEP_ORDER } from '../AgentRunService'
import type { AgentRuntimeData } from '../AgentRuntime'
import { compact } from '../agentReadableText'
import { getAgentChapterTask } from './agentChapterTaskTools'
import { stagedSeamStatus } from '../revision/agentStagedRevisionNeighbors'
import { findProjectId, requiredString } from './agentToolArguments'

function action(tool: string, args: Record<string, unknown>, requiresInput: string[] = []) {
  return { tool, arguments: args, ...(requiresInput.length ? { requiresInput } : {}) }
}

export const workItemResponseSchema = {
  type: 'string', enum: ['work_item'],
  description: 'Return the compact chapter work item instead of the accumulated run history.'
}

export function wantsChapterWorkItem(args: Record<string, unknown>): boolean {
  if (args.responseMode === undefined) return false
  if (args.responseMode !== 'work_item') throw new Error('responseMode must be work_item.')
  return true
}

function summaryText(data: AppData, text: string | null | undefined, max = 240) {
  return text ? compact(redactSensitiveText(text, [data.settings.apiKey]), max) : ''
}

async function authorization(runtime: AgentRuntimeData, projectId: string, chapterOrder: number, actions: AgentGrantAction[]) {
  if (!runtime.storagePath) return 'unavailable' as const
  try {
    const grant = await new AgentAuthorizationService(runtime.userDataPath).findGrant({
      projectId, chapterOrder, actions, storagePath: runtime.storagePath
    })
    return grant ? 'granted' as const : 'required' as const
  } catch {
    // Readable evidence remains available if the author profile cannot be read.
    return 'unavailable' as const
  }
}

async function draftReview(
  runtime: AgentRuntimeData, run: AgentRun, job: ChapterGenerationJob, draft: GeneratedChapterDraft
) {
  const { data } = runtime
  const draftContentHash = assertAgentDraftContent(draft)
  const scoped = { projectId: run.projectId, jobId: job.id, draftId: draft.id, expectedDraftContentHash: draftContentHash }
  const review = collectAgentDraftReview(data, draft)
  const canon = currentHardCanonAudit(data, { projectId: run.projectId, chapterOrder: job.targetChapterOrder,
    chapterId: draft.chapterId, body: draft.body })
  const records = agentDraftReportRecords(review, canon)
  const reports = (Object.keys(records) as AgentDraftReportKind[]).flatMap(kind =>
    records[kind] ? [{ kind, reportId: records[kind].id }] : [])
  const complete = hasCompleteChapterReview(review.quality, review.editorial, Boolean(job.pipelineRecipe))
  const qualityStatus = AuthorDecisionPolicyService.assessQualityGate(review.quality && withCurrentHardCanonAudit(review.quality, canon)).status
  const bookCreative = Boolean(runtime.storagePath && await new AgentAuthorizationService(runtime.userDataPath)
    .requiresReviewedCommits(runtime.storagePath, run.projectId))
  const passingReview = complete && ['passed', 'needs_review'].includes(qualityStatus) &&
    review.editorial?.status !== 'blocked' && !review.quality?.issues.some(issue => issue.type === 'manual_review_required')
  const needsPassingReview = bookCreative && !passingReview
  const canonBlocked = Boolean(canon?.findings.some(finding => finding.severity === 'block'))
  const mode = complete ? 'reviewed' as const : 'unreviewed' as const
  const requiredActions: AgentGrantAction[] = complete ? ['accept_draft'] : ['accept_draft', 'accept_unreviewed_draft']
  const canPreview = !canonBlocked && !needsPassingReview && job.status !== 'running'
  const grant = canPreview ? await authorization(runtime, run.projectId, job.targetChapterOrder, requiredActions) : null
  const editorial = [...(review.editorial?.blockers ?? []), ...(review.editorial?.advisories ?? [])]
  const hardFindings = [...(canon?.findings ?? [])].sort((a, b) => Number(b.severity === 'block') - Number(a.severity === 'block'))
  const findings = [
    ...hardFindings.slice(0, 3).map(item => ({
      kind: 'hard_canon', severity: item.severity, title: item.ruleTitle, excerpt: item.excerpt, sourceId: item.ruleId
    })),
    ...(editorial.length ? editorial.slice(0, 3).map(item => ({
      kind: item.source, severity: item.level, title: item.title, excerpt: item.evidence[0] ?? '', sourceId: item.id
    })) : [
      ...(review.consistency?.issues ?? []).filter(item => item.severity === 'high').slice(0, 3).map(item => ({
        kind: 'consistency', severity: item.severity, title: item.title, excerpt: item.evidence, sourceId: item.id
      })),
      ...(review.quality?.issues ?? []).slice(0, 3).map(item => ({
        kind: 'quality_gate', severity: item.severity, title: item.description, excerpt: item.evidence, sourceId: review.quality?.id
      }))
    ])
  ].slice(0, 3).map(item => ({ ...item, title: summaryText(data, item.title, 120), excerpt: summaryText(data, item.excerpt) }))
  return {
    draft: {
      id: draft.id, draftContentHash, updatedAt: draft.updatedAt,
      ...(draft.actorTag ? { actorTag: summaryText(data, draft.actorTag) } : {}),
      title: summaryText(data, draft.title, 120), wordCount: visibleCharacterCount(draft.body),
      read: action('agent.getDraftText', { draftId: draft.id, expectedDraftContentHash: draftContentHash, detail: 'full' })
    },
    review: {
      complete, qualityStatus,
      score: review.quality?.overallScore ?? null, editorialStatus: review.editorial?.status ?? null,
      summary: summaryText(data, review.editorial?.summary),
      hardCanonStatus: canonBlocked ? 'blocked' : !canon ? 'not_checked' : canon.findings.length ? 'review' : 'passed',
      reports, findings,
      readReport: action('agent.getDraftReviewReport', scoped, ['kind', 'reportId']),
      ...(canonBlocked || needsPassingReview || review.editorial?.status === 'blocked' ?
        { inspectRevision: action('agent.getRevisionSessions', { projectId: run.projectId, draftId: draft.id }) } : {}),
      ...(review.traceId ? { readTrace: action('agent.getFullRunTrace', { traceId: review.traceId, detail: 'full' }) } : {})
    },
    acceptance: {
      state: canonBlocked ? 'hard_canon_blocked' : job.status === 'running' ? 'running' :
        needsPassingReview ? 'needs_passing_review' : grant === 'granted' ? 'available'
        : grant === 'required' ? 'needs_authorization' : 'authorization_unavailable',
      mode, requiredActions, checkedAuthorization: grant,
      ...(passingReview && canPreview && grant === 'granted' ? { settlementTool: 'agent.previewChapterSettlement' } : {}),
      ...(grant === 'granted' && canPreview ? { preview: action('agent.previewChapterAcceptance',
        { ...scoped, agentRunId: run.id, mode, expectedQualityGateReportId: review.quality?.id ?? null,
          expectedEditorialVerdictId: review.editorial?.id ?? null }, ['operationId', 'reason']) } : {})
    }
  }
}

export async function readAgentChapterWorkItem(runtime: AgentRuntimeData, args: Record<string, unknown>) {
  const { data } = runtime
  const projectId = findProjectId(data, args)
  if (data.projects.some(project => project.id === projectId && isProjectArchived(project))) {
    return { projectId, state: 'project_archived' as const, reason: '项目已归档，恢复后可以继续原批次。', nextAction: null }
  }
  const runId = args.agentRunId === undefined ? undefined : requiredString(args, 'agentRunId')
  const runs = data.agentRuns.filter(run => run.projectId === projectId && (runId === undefined || run.id === runId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
  if (runId !== undefined && !runs.length) throw new Error('该 Agent 批次不存在或不属于此项目。')
  if (!runs.length) return { projectId, state: 'no_run' as const, nextAction: action('agent.getNextChapterTarget', { projectId }) }

  const book = createBookWritebackIndex(data, projectId)
  const candidates = runs.map(run => ({ run, ...readRunWriteback(data, run, Infinity, book) }))
  const active = candidates.filter(item => item.pending && item.run.status !== 'completed' && item.run.status !== 'cancelled')
  if (runId === undefined && active.length > 1) {
    return { projectId, state: 'select_run' as const, runs: active.map(item => ({
      agentRunId: item.run.id, chapterOrder: item.pending!.chapterOrder, status: item.run.status
    })), nextAction: action('agent.getChapterWorkItem', { projectId }, ['agentRunId']) }
  }
  const { run, pending, lastReceipt } = active[0] ?? candidates[0]
  const common = { projectId, agentRunId: run.id }
  const range = { from: Math.min(...run.targetChapterOrders), to: Math.max(...run.targetChapterOrders), count: run.targetChapterOrders.length }
  const head = { ...common, runStatus: run.status, range, lastReceipt,
    ...(run.stageNeighbors ? { stagedSeams: stagedSeamStatus(data, run) } : {}) }
  if (!pending) return { ...head, state: 'complete' as const, nextAction: null }

  const chapterOrder = pending.chapterOrder
  if (run.mode === 'book_revision') {
    const current = data.chapters.find(item => item.id === pending.chapterId && item.projectId === projectId && !item.archivedAt)
    return { ...head, chapterOrder, chapterId: pending.chapterId,
      state: current ? 'revise_chapter' as const : 'needs_attention' as const, reason: pending.reason,
      nextAction: current ? action('agent.getRevisionSessions', { projectId, chapterId: current.id }) : null }
  }
  const job = data.chapterGenerationJobs.find(item => item.id === pending.jobId && item.projectId === projectId)
  const prior = chapterOrder > 1 ? findActiveChapterByOrder(data.chapters, projectId, chapterOrder - 1) : null
  const bridge = prior && data.chapterContinuityBridges.filter(item =>
    item.projectId === projectId && item.fromChapterId === prior.id && item.toChapterOrder === chapterOrder)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const chapter = {
    ...head, chapterOrder, previousChapter: prior ? { id: prior.id, order: prior.order,
      carryover: summaryText(data, bridge?.mustContinueFrom || bridge?.immediateNextBeat || prior.endingHook) } : null
  }
  const taskArgs = { projectId, chapterOrder, sourceJobId: job?.id ?? null, sourceSnapshotId: null }
  const { task, editReference, source } = getAgentChapterTask(data, taskArgs)
  const taskRead = action('agent.getChapterTask', taskArgs)
  const continuity = readAgentContinuityHandoff(data, projectId, chapterOrder, task, job?.id, bridge || null)
  const work = {
    ...chapter, ...(continuity ? { continuity } : {}),
    task: { read: taskRead }
  }
  const planningTask = () => ({ ...work.task, goal: summaryText(data, task.goal) })
  const editTask = action('agent.previewChapterTaskEdit', {
    ...common, chapterOrder, sourceJobId: editReference.sourceJobId, sourceSnapshotId: editReference.sourceSnapshotId,
    ...(editReference.sourceUpdatedAt ? { sourceUpdatedAt: editReference.sourceUpdatedAt } : {})
  }, ['operationId', 'reason', 'task', 'budgetMode', 'budgetMaxTokens', 'pipelineMode',
    ...(source.manualSnapshotRequiresRefresh ? ['refreshContext'] : [])])
  if (!job) return { ...work, task: planningTask(), state: 'prepare_task' as const, reason: pending.reason, nextAction: editTask }

  const steps = data.chapterGenerationSteps.filter(item => item.jobId === job.id)
  const draft = latestAgentDraft(data, projectId, job.id)
  const fragment = hasCurrentChapterFragment(steps, job.id, draft)
  const currentDraft = !fragment && draft?.status === 'draft' && draft.body.trim() ? draft : null
  const resumeFrom = resolveAgentPipelineResumeStep(data, job.id)
  const executorState = await readAgentJobExecution(runtime.storagePath, job.id)
  const jobWork = { ...work, job: { id: job.id, status: job.status, step: job.currentStep, resumeFrom, executorState,
    lastCompletedStep: [...AGENT_PIPELINE_STEP_ORDER].reverse().find(type =>
      steps.some(step => step.type === type && step.status === 'completed')) ?? null } }
  const progress = action('agent.getPipelineProgress', { jobId: job.id })
  const resume = action('agent.retryChapterPipeline', { agentRunId: run.id, jobId: job.id, responseMode: 'work_item' })
  const retryOption = resumeFrom && getPipelineRoleForStep(resumeFrom) &&
    steps.some(s => s.type === resumeFrom && s.status === 'failed')
    ? { retryWithSavedRole: action(resume.tool, { ...resume.arguments, refreshModelConfigFromSettings: true }),
        listAvailableChannels: action('agent.listAvailableChannels', {}),
        retryWithChannel: action(resume.tool, { ...resume.arguments, expectedFailedStep: resumeFrom }, ['registryServiceId']) } : {}
  const readDiagnostics = action('agent.getRunDiagnostics', { jobId: job.id, ...(fragment ? { detail: 'full' } : {}) })
  // Older processes did not publish claims. A persisted running job alone
  // cannot establish that those executors have stopped.
  if (executorState === 'active' || (job.status === 'running' && executorState === 'untracked')) {
    return { ...jobWork, ...(currentDraft ? await draftReview(runtime, run, job, currentDraft) : {}),
      state: 'running' as const, ...(executorState === 'untracked' && resumeFrom ? { recoverIfStopped: resume } : {}),
      nextAction: progress }
  }
  if (pending.writebackFailure?.kind === 'revision_commit' || (draft?.status === 'accepted' && !currentDraft && !fragment)) {
    const failure = pending.writebackFailure
    return { ...jobWork, state: 'check_writeback' as const, reason: pending.reason,
      nextAction: failure?.revisionVersionId ? action('agent.getRevisionVersion', { projectId, versionId: failure.revisionVersionId })
        : action('agent.getBookProgress', { projectId, fromChapter: chapterOrder, toChapter: chapterOrder }) }
  }
  if (job.proseMode === 'agent_handoff' && resumeFrom === 'generate_chapter_draft' &&
      readChapterProseHandoff(steps.find(s => s.type === resumeFrom))) {
    return { ...jobWork, state: 'awaiting_prose_draft' as const, ...(job.errorMessage ? { problem: summaryText(data, job.errorMessage, 300) } : {}),
      nextAction: action('agent.getChapterDraftHandoff', { jobId: job.id }) }
  }
  const decision = !fragment && draft ? currentAgentDraftDecision(run, draft) : null
  const directorDecision = decision ? {
    id: decision.id, reason: summaryText(data, decision.reason, 320),
    decision: decision.action === 'reject_draft' ? 'reject' : 'defer'
  } : null
  if (!fragment && draft?.status === 'rejected') {
    return { ...jobWork, state: 'draft_rejected' as const, directorDecision, nextAction: editTask,
      readRejectedDraft: action('agent.getDraftText',
        { draftId: draft.id, expectedDraftContentHash: assertAgentDraftContent(draft), detail: 'full' }) }
  }
  if (currentDraft) {
    const result = await draftReview(runtime, run, job, currentDraft)
    return { ...jobWork, ...result, state: directorDecision?.decision === 'defer' ? 'draft_deferred' as const : 'review_draft' as const,
      ...(directorDecision ? { directorDecision } : {}),
      decide: action('agent.recordDraftDecision', { ...common, draftId: draft.id,
        expectedDraftContentHash: result.draft.draftContentHash }, ['operationId', 'reason', 'decision']),
      ...(job.errorMessage ? { problem: summaryText(data, job.errorMessage, 300) } : {}),
      ...(!result.review.complete && resumeFrom ? { resume, ...retryOption } : {}),
      ...(pending.writebackFailure ? { writeback: { id: pending.writebackFailure.id, reason: pending.reason } } : {}),
      nextAction: result.draft.read }
  }
  if (resumeFrom) return { ...jobWork, state: 'resume_pipeline' as const,
    ...retryOption,
    ...(fragment ? { fragment: readDiagnostics } : {}),
    ...(job.errorMessage ? { problem: summaryText(data, job.errorMessage, 300) } : {}),
    ...(!fragment && !steps.some(step => step.status === 'completed') ? { editTask, task: planningTask() } : {}), nextAction: resume }

  return { ...jobWork, state: 'needs_attention' as const, reason: pending.reason, editTask, nextAction: readDiagnostics }
}
