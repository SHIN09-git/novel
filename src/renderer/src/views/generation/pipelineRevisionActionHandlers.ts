import type {
  AppData,
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  ContextBudgetMode,
  GeneratedChapterDraft,
  ID,
  Project,
  PromptContextSnapshot,
  QualityGateIssue,
  QualityGateReport,
  RevisionCandidate,
  RevisionRequest,
  RevisionSession
} from '../../../../shared/types'
import { TokenEstimator } from '../../../../services/TokenEstimator'
import { consistencyReportMatchesDraft, draftContentHash, invalidateDraftDiagnosticsAfterChange, qualityReportMatchesDraft } from '../../../../services/DraftDiagnosticBindingService'
import { resolvePipelineRoleSettings } from '../../../../services/PipelineRunContextService'
import { newId, now } from '../../utils/format'
import { projectData } from '../../utils/projectData'
import {
  appendGenerationRunTraceForcedContextBlocks,
  appendGenerationRunTraceIds,
  upsertGenerationRunTraceByJobId
} from '../../utils/runTrace'
import type { SaveDataHandler } from '../../utils/saveDataState'
import { consistencyIssueToRevisionType, consistencyRevisionInstruction } from './generationPipelineHelpers'

type ProjectDataSnapshot = ReturnType<typeof projectData>

export interface PipelineRevisionActionContext {
  data: AppData
  project: Project
  scoped: ProjectDataSnapshot
  selectedJob: AppData['chapterGenerationJobs'][number] | null
  selectedSteps: AppData['chapterGenerationSteps'][number][]
  selectedTraceSnapshot: PromptContextSnapshot | null
  latestDraft: GeneratedChapterDraft | null
  targetChapterOrder: number
  readerEmotionTarget: string
  estimatedWordCount: string
  budgetMode: ContextBudgetMode
  budgetMaxTokens: number
  saveData: SaveDataHandler
  setPipelineMessage: (message: string) => void
  onOpenRevision?: (prefill: { chapterId: ID | null; draftId: ID | null; requestId: ID }) => void
}

export async function updateConsistencyIssueStatus(
  context: PipelineRevisionActionContext,
  report: ConsistencyReviewReport,
  issue: ConsistencyReviewIssue,
  status: ConsistencyReviewIssue['status']
) {
  await context.saveData((current) => ({
    ...current,
    consistencyReviewReports: current.consistencyReviewReports.map((item) =>
      item.id === report.id
        ? {
            ...item,
            issues: item.issues.map((currentIssue) => (currentIssue.id === issue.id ? { ...currentIssue, status } : currentIssue))
          }
        : item
    )
  }))
}

export async function startRevisionFromConsistencyIssue(
  context: PipelineRevisionActionContext,
  report: ConsistencyReviewReport,
  issue: ConsistencyReviewIssue
) {
  const { scoped, project, saveData, setPipelineMessage, onOpenRevision } = context
  const draft = scoped.generatedChapterDrafts.find((item) => consistencyReportMatchesDraft(report, item))
  if (!draft) {
    setPipelineMessage('该报告不再对应当前正文，请从最新诊断重新选择修订问题。')
    return
  }
  const targetChapter = draft.chapterId ? scoped.chapters.find((chapter) => chapter.id === draft.chapterId) ?? null : null
  const timestamp = now()
  const session: RevisionSession = {
    id: newId(),
    projectId: project.id,
    chapterId: targetChapter?.id ?? '',
    sourceDraftId: draft.id,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const request: RevisionRequest = {
    id: newId(),
    sessionId: session.id,
    type: consistencyIssueToRevisionType(issue),
    targetRange: issue.evidence,
    instruction: `${consistencyRevisionInstruction(issue)}\n\n约束：只修复该一致性问题，不得擅自改动无关剧情，不得引入新设定，不得破坏角色状态和伏笔 treatmentMode。`,
    createdAt: timestamp
  }
  const saved = await saveData((current) => {
    const currentDraft = current.generatedChapterDrafts.find((item) => item.id === draft.id && item.projectId === project.id)
    if (!currentDraft || !consistencyReportMatchesDraft(report, currentDraft)) throw new Error('正文已变化，请重新审稿后修订。')
    const nextData: AppData = {
      ...current,
      revisionSessions: [session, ...current.revisionSessions],
      revisionRequests: [request, ...current.revisionRequests],
      consistencyReviewReports: current.consistencyReviewReports.map((item) =>
        item.id === report.id
          ? {
              ...item,
              issues: item.issues.map((currentIssue) =>
                currentIssue.id === issue.id ? { ...currentIssue, status: 'converted_to_revision' } : currentIssue
              )
            }
          : item
      )
    }
    return appendGenerationRunTraceIds(nextData, report.jobId, 'revisionSessionIds', [session.id])
  })
  if (!saved.ok) {
    setPipelineMessage(`修订请求保存失败：${saved.errorMessage}`)
    return
  }
  setPipelineMessage(targetChapter ? '已创建修订请求，正在进入修订工作台。' : '已创建草稿修订请求。该草稿尚未关联章节，修订接受后不会写入任何已有章节。')
  onOpenRevision?.({ chapterId: targetChapter?.id ?? null, draftId: draft.id, requestId: request.id })
}

export async function startDraftRevision(context: PipelineRevisionActionContext, draft: GeneratedChapterDraft) {
  const { scoped, project, saveData, setPipelineMessage, onOpenRevision } = context
  if (!onOpenRevision) return
  const targetChapter = draft.chapterId ? scoped.chapters.find((chapter) => chapter.id === draft.chapterId) ?? null : null
  const timestamp = now()
  const session: RevisionSession = {
    id: newId(),
    projectId: project.id,
    chapterId: targetChapter?.id ?? '',
    sourceDraftId: draft.id,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const request: RevisionRequest = {
    id: newId(),
    sessionId: session.id,
    type: 'custom',
    targetRange: '',
    instruction: '审阅并修订当前草稿。保留已发生事实、角色硬状态和伏笔 treatmentMode；不得引入未授权新设定。',
    createdAt: timestamp
  }
  const saved = await saveData((current) => {
    const next = {
      ...current,
      revisionSessions: [session, ...current.revisionSessions],
      revisionRequests: [request, ...current.revisionRequests]
    }
    return appendGenerationRunTraceIds(next, draft.jobId, 'revisionSessionIds', [session.id])
  })
  if (!saved.ok) {
    setPipelineMessage(`修订请求保存失败：${saved.errorMessage}`)
    return
  }
  setPipelineMessage(targetChapter ? '已创建章节修订会话。' : '已创建草稿修订会话；接受修订前仍需确认写入目标章节。')
  onOpenRevision({ chapterId: targetChapter?.id ?? null, draftId: draft.id, requestId: request.id })
}

export async function generateRevisionCandidate(
  context: PipelineRevisionActionContext,
  issue: QualityGateIssue,
  report: QualityGateReport,
  draft: GeneratedChapterDraft
) {
  const {
    project,
    data,
    selectedJob,
    selectedSteps,
    selectedTraceSnapshot,
    targetChapterOrder,
    readerEmotionTarget,
    estimatedWordCount,
    budgetMode,
    budgetMaxTokens,
    saveData,
    setPipelineMessage
  } = context
  setPipelineMessage('')
  if (!qualityReportMatchesDraft(report, draft) || draft.projectId !== project.id) {
    setPipelineMessage('该质量报告不再对应当前正文，请先重新审稿。')
    return
  }
  const { resolveRevisionCandidateContext } = await import('./revisionCandidateContext')
  const revisionContext = resolveRevisionCandidateContext({
    project,
    data,
    selectedJob,
    selectedSteps,
    selectedTraceSnapshot,
    targetChapterOrder,
    readerEmotionTarget,
    estimatedWordCount,
    budgetMode,
    budgetMaxTokens,
    issue,
    report
  })
  const { AIService } = await import('../../../../services/AIService')
  const sourceJob = data.chapterGenerationJobs.find((item) => item.id === draft.jobId) ?? selectedJob
  const runSettings = resolvePipelineRoleSettings(sourceJob?.aiRunConfig, data.settings, 'revision')
  const aiService = new AIService(runSettings, { runId: sourceJob?.id ?? draft.jobId })
  const result = await aiService.generateRevisionCandidate({ title: draft.title, body: draft.body }, issue, revisionContext.context)
  if (!result.data) {
    setPipelineMessage(result.error || result.parseError || '修订候选生成失败')
    return
  }
  const timestamp = now()
  const candidate: RevisionCandidate = {
    id: newId(),
    projectId: project.id,
    jobId: draft.jobId,
    draftId: draft.id,
    sourceReportId: report.id,
    sourceDraftContentHash: draftContentHash(draft.body),
    targetIssue: issue.description || issue.type,
    revisionInstruction: result.data.revisionInstruction || issue.suggestedFix,
    revisedText: result.data.revisedText,
    status: 'pending',
    contextSource: revisionContext.contextSource,
    contextWarnings: revisionContext.contextWarnings,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const saved = await saveData((current) => {
    const withCandidate = { ...current, revisionCandidates: [candidate, ...current.revisionCandidates] }
    const withForcedBlock = appendGenerationRunTraceForcedContextBlocks(withCandidate, report.jobId, [revisionContext.forcedBlock])
    return revisionContext.compressionRecords?.length
      ? upsertGenerationRunTraceByJobId(withForcedBlock, report.jobId, { compressionRecords: revisionContext.compressionRecords })
      : withForcedBlock
  })
  if (!saved.ok) {
    setPipelineMessage(`修订候选保存失败：${saved.errorMessage}`)
    return
  }
  setPipelineMessage('修订候选已生成，请在下方候选区确认后再应用。')
}

export async function acceptRevisionCandidate(context: PipelineRevisionActionContext, candidate: RevisionCandidate) {
  if (candidate.status !== 'pending') return
  const timestamp = now()
  const saved = await context.saveData((current) => {
    const persistedCandidate = current.revisionCandidates.find((item) => item.id === candidate.id && item.projectId === context.project.id)
    if (!persistedCandidate) throw new Error('找不到当前项目的修订候选，请刷新后重试。')
    if (persistedCandidate.status !== 'pending') throw new Error('该修订候选已经处理，请查看最新草稿。')
    if (!persistedCandidate.revisedText.trim()) throw new Error('修订候选正文为空，无法应用。')
    const draft = current.generatedChapterDrafts.find((item) => item.id === persistedCandidate.draftId &&
      item.projectId === context.project.id && item.jobId === persistedCandidate.jobId)
    const sourceReport = current.qualityGateReports.find((item) => item.id === persistedCandidate.sourceReportId)
    const matchesSource = draft?.status === 'draft' && (persistedCandidate.sourceDraftContentHash
      ? persistedCandidate.sourceDraftContentHash === draftContentHash(draft.body)
      : sourceReport && qualityReportMatchesDraft(sourceReport, draft))
    if (!matchesSource) throw new Error('原草稿已经变化，这份修订候选不能覆盖新正文。请重新生成修订。')
    const invalidated = invalidateDraftDiagnosticsAfterChange(
      current,
      persistedCandidate.draftId,
      persistedCandidate.revisedText,
      timestamp
    )
    return {
      ...invalidated,
      generatedChapterDrafts: invalidated.generatedChapterDrafts.map((draft) =>
        draft.id === persistedCandidate.draftId && persistedCandidate.revisedText.trim()
          ? {
              ...draft,
              tokenEstimate: TokenEstimator.estimate(persistedCandidate.revisedText),
              updatedAt: timestamp
            }
          : draft
      ),
      revisionCandidates: invalidated.revisionCandidates.map((item) =>
        item.id === persistedCandidate.id ? { ...item, status: 'accepted', updatedAt: timestamp } : item
      )
    }
  })
  context.setPipelineMessage(saved.ok ? '修订已应用到草稿，请重新审稿后采纳。' : `应用修订失败：${saved.errorMessage}`)
}

export async function rejectRevisionCandidate(context: PipelineRevisionActionContext, candidate: RevisionCandidate) {
  if (candidate.status !== 'pending') return
  const saved = await context.saveData((current) => {
    const persistedCandidate = current.revisionCandidates.find((item) => item.id === candidate.id && item.projectId === context.project.id)
    if (!persistedCandidate || persistedCandidate.status !== 'pending') return current
    return {
      ...current,
      revisionCandidates: current.revisionCandidates.map((item) =>
        item.id === persistedCandidate.id ? { ...item, status: 'rejected', updatedAt: now() } : item
      )
    }
  })
  if (!saved.ok) context.setPipelineMessage(`拒绝修订失败：${saved.errorMessage}`)
}
