import type { AppData, Chapter, ChapterGenerationJob, GeneratedChapterDraft, ID } from '../shared/types'
import { activeChapters, nextChapterOrder } from './ChapterLifecycleService'
import { latestQualityReportForDraft } from './DraftDiagnosticBindingService'
import { AuthorDecisionPolicyService } from './AuthorDecisionPolicyService'

export type DirectorDestination = 'pipeline' | 'characters' | 'inbox'
export interface DirectorNextAction {
  kind: 'resume_pipeline' | 'review_draft' | 'review_memory' | 'review_state' | 'create_chapter' | 'open_chapter'
  title: string
  label: string
  reason: string
  chapterOrder?: number
  chapterId?: ID
  jobId?: ID
  destination?: DirectorDestination
}

function recentFirst<T extends { id: ID; updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
}

/** Read-only suggestions. Opening an action never accepts a draft or starts an AI request. */
export function getDirectorDashboard(
  data: AppData,
  projectId: ID,
  capabilities: { navigate?: boolean; openChapter?: boolean } = { navigate: true, openChapter: true }
) {
  const allChapters = (data.chapters ?? []).filter((item) => item.projectId === projectId)
  const chapters = activeChapters(allChapters)
  const recentChapters = recentFirst(chapters).slice(0, 3)
  const activeOrders = new Set(chapters.map((item) => item.order))
  const archivedOnlyOrders = new Set(allChapters.filter((item) => item.archivedAt && !activeOrders.has(item.order)).map((item) => item.order))
  const jobs = recentFirst((data.chapterGenerationJobs ?? []).filter(
    (item) => item.projectId === projectId && !archivedOnlyOrders.has(item.targetChapterOrder)
  ))
  const drafts = recentFirst((data.generatedChapterDrafts ?? []).filter((item) => item.projectId === projectId))
  const latestDraftByJob = new Map<ID, GeneratedChapterDraft>()
  for (const draft of drafts) if (!latestDraftByJob.has(draft.jobId)) latestDraftByJob.set(draft.jobId, draft)
  // An earlier failed attempt is not a new task once a later attempt for that chapter exists.
  const latestJobsByOrder = new Map<number, ChapterGenerationJob>()
  for (const job of [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))) {
    if (!latestJobsByOrder.has(job.targetChapterOrder)) latestJobsByOrder.set(job.targetChapterOrder, job)
  }
  const currentJobs = jobs.filter((job) => latestJobsByOrder.get(job.targetChapterOrder)?.id === job.id)
  const unfinished = [...currentJobs].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running')).find((job) => {
    const draft = latestDraftByJob.get(job.id)
    if (draft?.status === 'accepted' || draft?.status === 'rejected') return false
    if (job.status === 'completed') return false
    return job.status === 'running' || job.status === 'failed' || job.currentStep !== 'await_user_confirmation' || !draft?.body.trim()
  })
  const draftJob = currentJobs.find((job) => {
    const draft = latestDraftByJob.get(job.id)
    return draft?.status === 'draft' && Boolean(draft.body.trim())
  })
  const pendingMemory = (data.memoryUpdateCandidates ?? []).filter((item) => item.projectId === projectId && item.status === 'pending')
  const pendingState = (data.characterStateChangeCandidates ?? []).filter((item) => item.projectId === projectId && item.status === 'pending')
  const nextOrder = nextChapterOrder(allChapters, projectId)
  const recentChapter = recentChapters[0] ?? null
  const jobIds = new Set(jobs.map((job) => job.id))
  const latestDraft = (draftJob ? latestDraftByJob.get(draftJob.id) : null) ?? drafts.find((draft) => jobIds.has(draft.jobId)) ?? null
  const qualityReport = latestDraft ? latestQualityReportForDraft(
    (data.qualityGateReports ?? []).filter((report) => report.projectId === projectId && report.jobId === latestDraft.jobId), latestDraft
  ) : null
  const editorialVerdict = latestDraft
    ? AuthorDecisionPolicyService.latestEditorialVerdictForDraft(data.editorialVerdicts ?? [], latestDraft)
    : null
  const choices: DirectorNextAction[] = []
  if (draftJob && editorialVerdict) {
    choices.push({
      kind: 'review_draft',
      title: `第 ${draftJob.targetChapterOrder} 章 · ${editorialVerdict.status === 'approved' ? '草稿可采纳' : '编辑裁定待处理'}`,
      label: editorialVerdict.status === 'approved'
        ? '接受当前草稿'
        : editorialVerdict.status === 'incomplete'
          ? '补齐当前诊断'
          : editorialVerdict.status === 'blocked'
            ? '修订阻断问题'
            : '审阅编辑建议',
      reason: editorialVerdict.summary,
      chapterOrder: draftJob.targetChapterOrder,
      jobId: draftJob.id,
      destination: 'pipeline'
    })
  }
  if (unfinished) choices.push({
    kind: 'resume_pipeline', title: `第 ${unfinished.targetChapterOrder} 章 · ${unfinished.status === 'running' ? '正在生成' : '继续未完成的生成'}`,
    label: unfinished.status === 'running' ? '查看生成进度' : '继续流水线',
    reason: unfinished.status === 'failed' ? '上次生成停在中途，已完成的步骤仍然保留。' : '这次生成尚未完成，可在流水线中查看任务并接着推进。',
    chapterOrder: unfinished.targetChapterOrder, jobId: unfinished.id, destination: 'pipeline'
  })
  if (draftJob && !editorialVerdict) choices.push({
    kind: 'review_draft', title: `第 ${draftJob.targetChapterOrder} 章 · 草稿待审阅`, label: '审阅最新草稿',
    reason: '正文已经生成，接下来决定采纳、修订，或保留为候选。',
    chapterOrder: draftJob.targetChapterOrder, jobId: draftJob.id, destination: 'pipeline'
  })
  if (pendingMemory.length || pendingState.length) {
    const details = [
      pendingMemory.length ? `${pendingMemory.length} 条记忆` : '',
      pendingState.length ? `${pendingState.length} 条角色状态` : ''
    ].filter(Boolean).join('、')
    choices.push({
      kind: pendingMemory.length ? 'review_memory' : 'review_state',
      title: `${pendingMemory.length + pendingState.length} 条长期变化待确认`,
      label: '打开决策收件箱',
      reason: `${details}候选等待确认；处理候选不会锁住当前草稿。`,
      destination: 'inbox'
    })
  }
  const openChapterAction = (chapter: Chapter): DirectorNextAction => ({
    kind: 'open_chapter', title: `第 ${chapter.order} 章 · ${chapter.title}`, label: chapter.body.trim() ? '打开最近章节' : '继续编辑本章',
    reason: chapter.body.trim() ? '回到最近编辑的正文。' : '这一章已创建，还没有正文。', chapterId: chapter.id, chapterOrder: chapter.order
  })
  if (recentChapter && !recentChapter.body.trim()) choices.push(openChapterAction(recentChapter))
  const hasCreationAlternative = (capabilities.navigate && (unfinished || draftJob)) ||
    (capabilities.openChapter && recentChapter && !recentChapter.body.trim())
  if (!hasCreationAlternative) choices.push({
    kind: 'create_chapter', title: `准备第 ${nextOrder} 章`, label: `创建第 ${nextOrder} 章`, chapterOrder: nextOrder,
    reason: chapters.length ? '开启下一章，把故事接着写下去。' : '从第一章开始，让故事落到纸面。'
  })
  if (recentChapter) choices.push(openChapterAction(recentChapter))
  const seen = new Set<string>()
  const actions = choices.filter((action) => {
    if (action.destination && !capabilities.navigate) return false
    if (action.kind === 'open_chapter' && !capabilities.openChapter) return false
    const key = action.destination ?? `${action.kind}:${action.chapterId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 3)
  return {
    actions, recentChapters, latestDraft, qualityReport, editorialVerdict, nextOrder,
    chapterCount: chapters.length,
    totalWords: chapters.reduce((sum, chapter) => sum + chapter.body.replace(/\s/g, '').length, 0),
    pendingCandidateCount: pendingMemory.length + pendingState.length,
    latestChapterOrder: chapters.reduce((highest, chapter) => Math.max(highest, chapter.order), 0)
  }
}
