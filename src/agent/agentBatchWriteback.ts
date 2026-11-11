import type { AgentRun, AppData, ID } from '../shared/types'
import { createBookWritebackIndex } from '../services/BookWritebackService'

type RunTargets = Pick<AgentRun, 'projectId' | 'targetChapterOrders' | 'createdJobIds'>

export interface PendingRunTarget {
  chapterOrder: number
  jobId: ID | null
  chapterId: ID | null
  draftId: ID | null
  writebackFailure?: AppData['chapterWritebackFailures'][number]
  reason: string
}

export function isMultiChapterRun(run: AgentRun): boolean {
  return run.mode === 'multi_chapter' || run.targetChapterOrders.length > 1
}

export function firstPendingRunTarget(data: AppData, run: RunTargets, beforeOrder = Infinity): PendingRunTarget | null {
  const orders = run.targetChapterOrders.filter((order) => order < beforeOrder).sort((a, b) => a - b)
  if (!orders.length) return null
  const jobs = new Map(data.chapterGenerationJobs.filter((job) => job.projectId === run.projectId).map((job) => [job.id, job]))
  const jobByOrder = new Map<number, ID>()
  // A task edit appends a replacement job. Editing or replaying an older job must not make it current again.
  for (const id of run.createdJobIds) {
    const job = jobs.get(id)
    if (job) jobByOrder.set(job.targetChapterOrder, id)
  }
  const book = createBookWritebackIndex(data, run.projectId)
  for (const chapterOrder of orders) {
    const jobId = jobByOrder.get(chapterOrder)
    if (!jobId) return { chapterOrder, chapterId: null, jobId: null, draftId: null, reason: '本批没有该章的任务记录，请先准备该章任务。' }
    const { confirmed, chapterId, draftId, reason, writebackFailure } = book.verifyJob(jobId)
    if (!confirmed) {
      const draft = draftId || writebackFailure?.kind === 'revision_commit' ? null : data.generatedChapterDrafts
        .filter((item) => item.jobId === jobId && item.projectId === run.projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      return { chapterOrder, chapterId: chapterId ?? draft?.chapterId ?? null, jobId, draftId: draftId ?? draft?.id ?? null,
        reason, ...(writebackFailure ? { writebackFailure } : {}) }
    }
  }
  return null
}

export function describePendingRunTarget(target: PendingRunTarget): string {
  const job = target.jobId ? `，任务 ${target.jobId}` : ''
  const failure = target.writebackFailure
  if (failure?.kind === 'revision_commit') {
    const revision = failure.revisionVersionId ? `修订候选 ${failure.revisionVersionId}`
      : failure.revisionSessionId ? `修订会话 ${failure.revisionSessionId}` : `修订提交 ${failure.commitId}`
    return `请回到第 ${target.chapterOrder} 章的${revision}。${target.reason}`
  }
  const draft = target.draftId ? `，草稿 ${target.draftId}` : ''
  return `请回到第 ${target.chapterOrder} 章${job}${draft}。${target.reason}`
}

export function assertEarlierRunTargetsWritten(data: AppData, run: RunTargets, targetOrder: number): void {
  const pending = firstPendingRunTarget(data, run, targetOrder)
  if (pending) throw new Error(`本批不能推进到第 ${targetOrder} 章。${describePendingRunTarget(pending)}`)
}

export function checkPipelineRunTarget(data: AppData, agentRunId: ID, jobId: ID) {
  const run = data.agentRuns.find((item) => item.id === agentRunId)
  if (!run) throw new Error(`AgentRun not found: ${agentRunId}`)
  const job = data.chapterGenerationJobs.find((item) => item.id === jobId)
  if (!job) throw new Error(`Job not found: ${jobId}`)
  if (run.projectId !== job.projectId || !run.createdJobIds.includes(job.id) || !run.targetChapterOrders.includes(job.targetChapterOrder)) {
    throw new Error('AgentRun and pipeline job are not part of the same production run.')
  }
  if (isMultiChapterRun(run)) assertEarlierRunTargetsWritten(data, run, job.targetChapterOrder)
  return { run, job }
}
