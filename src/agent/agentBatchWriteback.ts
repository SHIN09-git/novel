import type { AgentRun, AppData, ID } from '../shared/types'
import { createBookWritebackIndex, type JobWritebackProof } from '../services/BookWritebackService'
import { isChapterArchived } from '../services/ChapterLifecycleService'
import { assertProjectWritable } from '../services/ProjectLifecycleService'

type RunTargets = Pick<AgentRun, 'projectId' | 'targetChapterOrders' | 'createdJobIds'> &
  Partial<Pick<AgentRun, 'id' | 'revisionChapterIds'>>

export interface PendingRunTarget {
  chapterOrder: number
  jobId: ID | null
  chapterId: ID | null
  draftId: ID | null
  writebackFailure?: AppData['chapterWritebackFailures'][number]
  reason: string
}

export type RunWritebackReceipt = Pick<JobWritebackProof, 'chapterId' | 'draftId' | 'versionId' | 'commitId'> & {
  chapterOrder: number
  jobId: ID | null
}

export function isMultiChapterRun(run: AgentRun): boolean {
  return run.mode === 'multi_chapter' || run.targetChapterOrders.length > 1
}

export function readRunWriteback(
  data: AppData,
  run: RunTargets,
  beforeOrder = Infinity,
  book?: ReturnType<typeof createBookWritebackIndex>
): { pending: PendingRunTarget | null; lastReceipt: RunWritebackReceipt | null } {
  if (run.revisionChapterIds?.length) return readRevisionBatchWriteback(data, run, book)
  const orders = run.targetChapterOrders.filter((order) => order < beforeOrder).sort((a, b) => a - b)
  if (!orders.length) return { pending: null, lastReceipt: null }
  const jobs = new Map(data.chapterGenerationJobs.filter((job) => job.projectId === run.projectId).map((job) => [job.id, job]))
  const jobByOrder = new Map<number, ID>()
  // A task edit appends a replacement job. Editing or replaying an older job must not make it current again.
  for (const id of run.createdJobIds) {
    const job = jobs.get(id)
    if (job) jobByOrder.set(job.targetChapterOrder, id)
  }
  const index = book ?? createBookWritebackIndex(data, run.projectId)
  let lastReceipt: RunWritebackReceipt | null = null
  for (const chapterOrder of orders) {
    const jobId = jobByOrder.get(chapterOrder)
    if (!jobId) return { lastReceipt, pending: { chapterOrder, chapterId: null, jobId: null, draftId: null,
      reason: '本批没有该章的任务记录，请先准备该章任务。' } }
    const { confirmed, chapterId, draftId, reason, writebackFailure, versionId, commitId } = index.verifyJob(jobId)
    if (!confirmed) {
      const draft = draftId || writebackFailure?.kind === 'revision_commit' ? null : data.generatedChapterDrafts
        .filter((item) => item.jobId === jobId && item.projectId === run.projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      return { lastReceipt, pending: { chapterOrder, chapterId: chapterId ?? draft?.chapterId ?? null, jobId,
        draftId: draftId ?? draft?.id ?? null, reason, ...(writebackFailure ? { writebackFailure } : {}) } }
    }
    lastReceipt = { chapterOrder, jobId, chapterId, draftId, versionId, commitId }
  }
  return { pending: null, lastReceipt }
}

function readRevisionBatchWriteback(data: AppData, run: RunTargets, book?: ReturnType<typeof createBookWritebackIndex>) {
  const index = book ?? createBookWritebackIndex(data, run.projectId)
  const chapters = new Map(data.chapters.filter(chapter => chapter.projectId === run.projectId).map(chapter => [chapter.id, chapter]))
  const receipts = data.revisionCommitBundles.filter(item => item.projectId === run.projectId &&
    item.actor?.agentRunId === run.id && !!item.qualityGateReportId && !!item.consistencyReviewReportId)
  let lastReceipt: RunWritebackReceipt | null = null
  for (const [offset, id] of (run.revisionChapterIds ?? []).entries()) {
    const chapter = chapters.get(id)
    const chapterOrder = chapter?.order ?? run.targetChapterOrders[offset]
    const head = chapter && !isChapterArchived(chapter) ? index.current(chapter) : null
    const receipt = head ? receipts.find(item => item.chapterId === id && index.descendsFrom(head.versionId, item.newChapterVersionId, id)) : null
    if (!receipt || !head) return { lastReceipt, pending: { chapterOrder, chapterId: id, jobId: null, draftId: null,
      reason: chapter && !isChapterArchived(chapter) ? '本章还没有通过审稿并正式写回的修订。' : '待修订章节已归档或不存在。' } }
    lastReceipt = { chapterId: id, chapterOrder, jobId: null, draftId: null, versionId: receipt.newChapterVersionId,
      commitId: receipt.revisionCommitId }
  }
  return { lastReceipt, pending: null }
}

export function assertRevisionBatchTarget(data: AppData, run: AgentRun, chapterId: ID, phase: 'review_or_commit' | 'prepare' = 'review_or_commit'): void {
  if (run.mode !== 'book_revision') return
  if (run.status === 'cancelled' || !run.revisionChapterIds?.includes(chapterId)) throw new Error('该章节不在可执行的修订批次中。')
  const pending = firstPendingRunTarget(data, run)
  if (phase === 'prepare' && run.stageNeighbors && pending?.chapterId &&
    run.revisionChapterIds.indexOf(chapterId) >= run.revisionChapterIds.indexOf(pending.chapterId)) return
  if (!pending || pending.chapterId !== chapterId) throw new Error(pending
    ? `请先完成第 ${pending.chapterOrder} 章的审稿和修订提交。` : '本批修订已全部提交。')
}

export function firstPendingRunTarget(data: AppData, run: RunTargets, beforeOrder = Infinity): PendingRunTarget | null {
  return readRunWriteback(data, run, beforeOrder).pending
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
  assertProjectWritable(data.projects.find(project => project.id === run.projectId))
  if (run.mode === 'book_revision') throw new Error('修订批次不生成替换章节，请使用当前章的修订与审稿入口。')
  const job = data.chapterGenerationJobs.find((item) => item.id === jobId)
  if (!job) throw new Error(`Job not found: ${jobId}`)
  if (run.projectId !== job.projectId || !run.createdJobIds.includes(job.id) || !run.targetChapterOrders.includes(job.targetChapterOrder)) {
    throw new Error('AgentRun and pipeline job are not part of the same production run.')
  }
  if (isMultiChapterRun(run)) assertEarlierRunTargetsWritten(data, run, job.targetChapterOrder)
  return { run, job }
}
