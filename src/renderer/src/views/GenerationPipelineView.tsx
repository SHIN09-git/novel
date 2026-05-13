import { useEffect, useMemo, useState } from 'react'
import type {
  AppData,
  ChapterCommitBundle,
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  ContextBudgetMode,
  ContextNeedPlan,
  ContextSelectionResult,
  ForcedContextBlock,
  GenerationRunBundle,
  GeneratedChapterDraft,
  GenerationRunTrace,
  ID,
  PipelineContextSource,
  PipelineMode,
  Project,
  PromptContextSnapshot,
  QualityGateIssue,
  QualityGateReport,
  RevisionCandidate,
  RevisionCandidateContextSource,
  RevisionRequest,
  RevisionRequestType,
  RevisionSession
} from '../../../shared/types'
import { AIService } from '../../../services/AIService'
import { safeParseJson } from '../../../services/AIJsonParser'
import { buildRunTraceAuthorSummary, upsertRunTraceAuthorSummaryToAppData } from '../../../services/RunTraceAuthorSummaryService'
import { TokenEstimator } from '../../../services/TokenEstimator'
import { useConfirm } from '../components/ConfirmDialog'
import type { PipelineArtifactTab } from '../components/pipeline/PipelineCurrentArtifactPanel'
import { newId, now } from '../utils/format'
import { projectData } from '../utils/projectData'
import { buildPipelineContextFromSelection, createContextBudgetProfile, selectBudgetContext } from '../utils/promptContext'
import { addReaderEmotionPreset, loadReaderEmotionState, rememberReaderEmotionTarget } from '../utils/readerEmotionPresets'
import { appendGenerationRunTraceForcedContextBlocks, appendGenerationRunTraceIds, upsertGenerationRunTraceByJobId } from '../utils/runTrace'
import type { SaveDataInput } from '../utils/saveDataState'
import { buildRunTraceSummary } from './generation/RunTracePanel'
import { GenerationPipelineConsole } from './generation/GenerationPipelineConsole'
import {
  budgetSelectionFromStepOutput,
  consistencyIssueToRevisionType,
  consistencyRevisionInstruction,
  contextFromBuildContextOutput,
  updateProjectTimestamp
} from './generation/generationPipelineHelpers'
import { useDraftAcceptance } from './generation/useDraftAcceptance'
import { useMemoryCandidates } from './generation/useMemoryCandidates'
import { PIPELINE_STEP_LABELS, PIPELINE_STEP_ORDER, usePipelineRunner } from './generation/usePipelineRunner'

interface ProjectProps {
  data: AppData
  project: Project
  saveData: (next: SaveDataInput) => Promise<void>
  saveGenerationRunBundle?: (next: SaveDataInput, bundle: GenerationRunBundle) => Promise<void>
  saveChapterCommitBundle?: (buildCommit: (currentData: AppData) => { next: AppData; bundle: ChapterCommitBundle }) => Promise<void>
  onOpenRevision?: (prefill: { chapterId: ID | null; draftId: ID | null; requestId: ID }) => void
  initialSnapshotId?: ID | null
  onInitialSnapshotConsumed?: () => void
}

export function GenerationPipelineView({
  data,
  project,
  saveData,
  saveGenerationRunBundle,
  saveChapterCommitBundle,
  onOpenRevision,
  initialSnapshotId,
  onInitialSnapshotConsumed
}: ProjectProps) {
  const confirmAction = useConfirm()
  const scoped = projectData(data, project.id)
  const nextChapter = Math.max(0, ...scoped.chapters.map((chapter) => chapter.order)) + 1
  const [targetChapterOrder, setTargetChapterOrder] = useState(nextChapter)
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('standard')
  const [estimatedWordCount, setEstimatedWordCount] = useState('3000-5000')
  const [readerEmotionTarget, setReaderEmotionTarget] = useState(() => {
    const emotionState = loadReaderEmotionState(project.id)
    return emotionState.lastTarget || project.coreAppeal || ''
  })
  const [readerEmotionPresets, setReaderEmotionPresets] = useState(() => loadReaderEmotionState(project.id).presets)
  const [newReaderEmotionPreset, setNewReaderEmotionPreset] = useState('')
  const [budgetMode, setBudgetMode] = useState<ContextBudgetMode>(data.settings.defaultPromptMode)
  const [budgetMaxTokens, setBudgetMaxTokens] = useState(data.settings.defaultTokenBudget)
  const [contextSource, setContextSource] = useState<PipelineContextSource>(initialSnapshotId ? 'prompt_snapshot' : 'auto')
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<ID | null>(initialSnapshotId ?? null)
  const [selectedJobId, setSelectedJobId] = useState<ID | null>(scoped.chapterGenerationJobs[0]?.id ?? null)
  const [activeArtifactTab, setActiveArtifactTab] = useState<PipelineArtifactTab>('steps')
  const aiService = useMemo(() => new AIService(data.settings), [data.settings])

  const snapshots = [...scoped.promptContextSnapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const selectedSnapshot = selectedSnapshotId ? snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? null : null

  useEffect(() => {
    const emotionState = loadReaderEmotionState(project.id)
    setReaderEmotionPresets(emotionState.presets)
    setReaderEmotionTarget(emotionState.lastTarget || project.coreAppeal || '')
    setNewReaderEmotionPreset('')
  }, [project.id, project.coreAppeal])

  useEffect(() => {
    if (!initialSnapshotId) return
    const snapshot = scoped.promptContextSnapshots.find((item) => item.id === initialSnapshotId)
    setContextSource('prompt_snapshot')
    setSelectedSnapshotId(initialSnapshotId)
    if (snapshot) {
      setTargetChapterOrder(snapshot.targetChapterOrder)
      setBudgetMode(snapshot.mode)
      setBudgetMaxTokens(snapshot.budgetProfile.maxTokens)
      if (snapshot.chapterTask.targetWordCount) setEstimatedWordCount(snapshot.chapterTask.targetWordCount)
      if (snapshot.chapterTask.readerEmotion) {
        const nextEmotionState = rememberReaderEmotionTarget(project.id, snapshot.chapterTask.readerEmotion)
        setReaderEmotionTarget(snapshot.chapterTask.readerEmotion)
        setReaderEmotionPresets(nextEmotionState.presets)
      }
    }
    onInitialSnapshotConsumed?.()
  }, [initialSnapshotId, onInitialSnapshotConsumed, project.id, scoped.promptContextSnapshots])

  const jobs = [...scoped.chapterGenerationJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null
  const selectedSteps = selectedJob
    ? data.chapterGenerationSteps
        .filter((step) => step.jobId === selectedJob.id)
        .sort((a, b) => PIPELINE_STEP_ORDER.indexOf(a.type) - PIPELINE_STEP_ORDER.indexOf(b.type))
    : []
  const selectedDrafts = selectedJob ? scoped.generatedChapterDrafts.filter((draft) => draft.jobId === selectedJob.id) : []
  const selectedCandidates = selectedJob ? scoped.memoryUpdateCandidates.filter((candidate) => candidate.jobId === selectedJob.id) : []
  const selectedReports = selectedJob ? scoped.consistencyReviewReports.filter((report) => report.jobId === selectedJob.id) : []
  const selectedQualityReports = selectedJob ? scoped.qualityGateReports.filter((report) => report.jobId === selectedJob.id) : []
  const selectedRevisionCandidates = selectedJob ? scoped.revisionCandidates.filter((candidate) => candidate.jobId === selectedJob.id) : []
  const selectedTrace = selectedJob ? scoped.generationRunTraces.find((trace) => trace.jobId === selectedJob.id) ?? null : null
  const selectedAuthorSummary = selectedTrace
    ? scoped.runTraceAuthorSummaries.find((summary) => summary.traceId === selectedTrace.id) ??
      scoped.runTraceAuthorSummaries.find((summary) => summary.jobId === selectedTrace.jobId) ??
      null
    : null
  const selectedTraceSnapshot = selectedTrace?.promptContextSnapshotId
    ? scoped.promptContextSnapshots.find((snapshot) => snapshot.id === selectedTrace.promptContextSnapshotId) ?? null
    : null
  const consistencyIssueById = useMemo(() => {
    return new Map(selectedReports.flatMap((report) => report.issues.map((issue) => [issue.id, issue] as const)))
  }, [selectedReports])
  const latestDraft = selectedDrafts[0] ?? null
  const latestQualityReport = latestDraft
    ? selectedQualityReports.find((report) => report.draftId === latestDraft.id) ?? selectedQualityReports[0] ?? null
    : selectedQualityReports[0] ?? null
  const traceConsistencyReport = selectedTrace?.consistencyReviewReportId
    ? selectedReports.find((report) => report.id === selectedTrace.consistencyReviewReportId) ?? selectedReports[0] ?? null
    : selectedReports[0] ?? null
  const traceQualityReport = selectedTrace?.qualityGateReportId
    ? selectedQualityReports.find((report) => report.id === selectedTrace.qualityGateReportId) ?? latestQualityReport
    : latestQualityReport
  const traceContinuityBridge = selectedTrace?.continuityBridgeId
    ? scoped.chapterContinuityBridges.find((bridge) => bridge.id === selectedTrace.continuityBridgeId) ?? null
    : null
  const traceRedundancyReport = selectedTrace?.redundancyReportId
    ? scoped.redundancyReports.find((report) => report.id === selectedTrace.redundancyReportId) ?? null
    : null
  const selectedStepsKey = selectedSteps.map((step) => `${step.id}:${step.status}:${step.output.length}`).join('|')

  useEffect(() => {
    if (latestDraft) {
      setActiveArtifactTab('draft')
      return
    }
    if (selectedSteps.some((step) => step.status === 'failed')) {
      setActiveArtifactTab('steps')
      return
    }
    if (selectedSteps.some((step) => step.type === 'generate_chapter_plan' && step.output.trim())) {
      setActiveArtifactTab('plan')
    }
  }, [latestDraft?.id, selectedJob?.id, selectedStepsKey])

  const draftAcceptance = useDraftAcceptance({
    project,
    saveData,
    saveChapterCommitBundle,
    selectedJob,
    targetChapterOrder,
    chapters: scoped.chapters,
    qualityGateReports: scoped.qualityGateReports,
    confirmAction
  })
  const memoryCandidates = useMemoryCandidates({
    project,
    selectedJob,
    qualityGateReports: scoped.qualityGateReports,
    saveData,
    confirmAction
  })

  const {
    pipelineMessage,
    setPipelineMessage,
    isPipelineRunning,
    runPipeline,
    retryStep,
    skipStep
  } = usePipelineRunner({
    data,
    project,
    scoped,
    saveData,
    targetChapterOrder,
    pipelineMode,
    estimatedWordCount,
    readerEmotionTarget,
    budgetMode,
    budgetMaxTokens,
    contextSource,
    selectedSnapshot,
    setSelectedJobId
  })

  function applyReaderEmotionPreset(preset: string) {
    const nextEmotionState = rememberReaderEmotionTarget(project.id, preset)
    setReaderEmotionTarget(preset)
    setReaderEmotionPresets(nextEmotionState.presets)
  }

  function addReaderEmotionPresetFromInput() {
    const value = newReaderEmotionPreset.trim()
    if (!value) {
      setPipelineMessage('请输入要保存的读者情绪预设。')
      return
    }
    const nextEmotionState = addReaderEmotionPreset(project.id, value)
    setReaderEmotionTarget(value)
    setReaderEmotionPresets(nextEmotionState.presets)
    setNewReaderEmotionPreset('')
    setPipelineMessage('已保存读者情绪预设。')
  }

  function startPipeline() {
    if (readerEmotionTarget.trim()) {
      const nextEmotionState = rememberReaderEmotionTarget(project.id, readerEmotionTarget)
      setReaderEmotionPresets(nextEmotionState.presets)
    }
    void runPipeline()
  }

  async function updateConsistencyIssueStatus(
    report: ConsistencyReviewReport,
    issue: ConsistencyReviewIssue,
    status: ConsistencyReviewIssue['status']
  ) {
    await saveData((current) => ({
      ...current,
      consistencyReviewReports: current.consistencyReviewReports.map((item) =>
        item.id === report.id
          ? {
              ...item,
              issues: item.issues.map((current) => (current.id === issue.id ? { ...current, status } : current))
            }
          : item
      )
    }))
  }

  async function startRevisionFromConsistencyIssue(report: ConsistencyReviewReport, issue: ConsistencyReviewIssue) {
    const draft = scoped.generatedChapterDrafts.find((item) => item.jobId === report.jobId) ?? latestDraft
    if (!draft) {
      setPipelineMessage('请先生成章节草稿，再进入修订工作台。')
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
    await saveData((current) => {
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
    setPipelineMessage(targetChapter ? '已创建修订请求，正在进入修订工作台。' : '已创建草稿修订请求。该草稿尚未关联章节，修订接受后不会写入任何已有章节。')
    onOpenRevision?.({ chapterId: targetChapter?.id ?? null, draftId: draft.id, requestId: request.id })
  }

  function resolveRevisionCandidateContext(issue: QualityGateIssue, report: QualityGateReport): {
    context: string
    contextSource: RevisionCandidateContextSource
    contextWarnings: string[]
    compressionRecords?: ContextSelectionResult['compressionRecords']
    forcedBlock: ForcedContextBlock
  } {
    const targetOrder = selectedJob?.targetChapterOrder ?? targetChapterOrder
    const issueText = JSON.stringify(issue, null, 2)
    const forcedBlock: ForcedContextBlock = {
      kind: 'quality_gate_issue',
      sourceId: report.id,
      sourceType: issue.type,
      sourceChapterId: report.chapterId ?? null,
      sourceChapterOrder: targetOrder,
      title: `质量门禁问题：${issue.description || issue.type}`,
      tokenEstimate: TokenEstimator.estimate(issueText)
    }

    const buildContextStep = selectedSteps.find((step) => step.type === 'build_context' && step.status === 'completed' && step.output.trim())
    if (buildContextStep) {
      const context = contextFromBuildContextOutput(buildContextStep.output)
      if (context.trim()) return { context, contextSource: 'reused_current_job_context', contextWarnings: [], forcedBlock }
    }

    if (selectedTraceSnapshot?.finalPrompt?.trim()) {
      return {
        context: selectedTraceSnapshot.finalPrompt,
        contextSource: 'reused_current_job_context',
        contextWarnings: ['当前 job 的 build_context 输出不可用，已复用绑定的 Prompt 快照。'],
        forcedBlock
      }
    }

    const budgetStep = selectedSteps.find((step) => step.type === 'context_budget_selection' && step.status === 'completed' && step.output.trim())
    const parsedBudget = budgetStep ? budgetSelectionFromStepOutput(budgetStep.output) : { profile: null, selection: null }
    const needPlanStep = selectedSteps.find((step) => step.type === 'context_need_planning' && step.status === 'completed' && step.output.trim())
    const parsedNeedPlan = needPlanStep ? safeParseJson<ContextNeedPlan>(needPlanStep.output, 'pipeline context need plan output') : { ok: false, data: null }
    const contextNeedPlan = selectedTraceSnapshot?.contextNeedPlan ?? (parsedNeedPlan.ok ? parsedNeedPlan.data : null)
    const budgetProfile = parsedBudget.profile ?? createContextBudgetProfile(project.id, budgetMode, budgetMaxTokens, '修订候选上下文')
    const budgetSelection =
      parsedBudget.selection ??
      selectBudgetContext(project, data, targetOrder, budgetProfile, {
        chapterTask: {
          goal: `生成第 ${targetOrder} 章草稿`,
          conflict: issue.description,
          suspenseToKeep: '',
          allowedPayoffs: '',
          forbiddenPayoffs: '',
          endingHook: '',
          readerEmotion: readerEmotionTarget,
          targetWordCount: estimatedWordCount,
          styleRequirement: project.style
        },
        contextNeedPlan
      })
    const context = buildPipelineContextFromSelection(project, data, targetOrder, readerEmotionTarget, estimatedWordCount, budgetProfile, budgetSelection, contextNeedPlan)
    return {
      context,
      contextSource: 'rebuilt_from_explicit_selection',
      contextWarnings: parsedBudget.selection ? [] : ['当前 job 缺少可复用上下文，已通过 ContextBudgetManager 重新生成显式 selection。'],
      compressionRecords: budgetSelection.compressionRecords,
      forcedBlock
    }
  }

  async function generateRevisionCandidate(issue: QualityGateIssue, report: QualityGateReport, draft: GeneratedChapterDraft) {
    setPipelineMessage('')
    const revisionContext = resolveRevisionCandidateContext(issue, report)
    const context = revisionContext.context
    void [
      project,
      data,
      selectedJob?.targetChapterOrder ?? targetChapterOrder,
      readerEmotionTarget,
      estimatedWordCount,
      createContextBudgetProfile(project.id, budgetMode, budgetMaxTokens, '修订候选上下文')
    ]
    const result = await aiService.generateRevisionCandidate({ title: draft.title, body: draft.body }, issue, context)
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
      targetIssue: issue.description || issue.type,
      revisionInstruction: result.data.revisionInstruction || issue.suggestedFix,
      revisedText: result.data.revisedText,
      status: 'pending',
      contextSource: revisionContext.contextSource,
      contextWarnings: revisionContext.contextWarnings,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData((current) => {
      const withCandidate = { ...current, revisionCandidates: [candidate, ...current.revisionCandidates] }
      const withForcedBlock = appendGenerationRunTraceForcedContextBlocks(withCandidate, report.jobId, [revisionContext.forcedBlock])
      return revisionContext.compressionRecords?.length
        ? upsertGenerationRunTraceByJobId(withForcedBlock, report.jobId, { compressionRecords: revisionContext.compressionRecords })
        : withForcedBlock
    })
    setPipelineMessage('修订候选已生成，请在下方候选区确认后再应用。')
  }

  async function acceptRevisionCandidate(candidate: RevisionCandidate) {
    if (candidate.status !== 'pending') return
    const timestamp = now()
    await saveData((current) => ({
      ...current,
      generatedChapterDrafts: current.generatedChapterDrafts.map((draft) =>
        draft.id === candidate.draftId && candidate.revisedText.trim()
          ? { ...draft, body: candidate.revisedText, tokenEstimate: TokenEstimator.estimate(candidate.revisedText), updatedAt: timestamp }
          : draft
      ),
      revisionCandidates: current.revisionCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'accepted', updatedAt: timestamp } : item
      )
    }))
  }

  async function rejectRevisionCandidate(candidate: RevisionCandidate) {
    if (candidate.status !== 'pending') return
    await saveData((current) => ({
      ...current,
      revisionCandidates: current.revisionCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'rejected', updatedAt: now() } : item
      )
    }))
  }

  async function copyRunTrace(trace: GenerationRunTrace) {
    await window.novelDirector.clipboard.writeText(JSON.stringify(buildRunTraceSummary(trace, traceConsistencyReport, traceQualityReport), null, 2))
    setPipelineMessage('已复制生成追踪摘要。')
  }

  async function generateAuthorSummary(trace: GenerationRunTrace) {
    await saveData((current) => {
      const summary = buildRunTraceAuthorSummary(current, { traceId: trace.id })
      return upsertRunTraceAuthorSummaryToAppData(current, summary)
    })
    setPipelineMessage('已生成章节诊断摘要。')
  }

  function useAutoContext() {
    setContextSource('auto')
    setSelectedSnapshotId(null)
  }

  function handleSnapshotChange(value: ID | '') {
    setSelectedSnapshotId(value || null)
    const snapshot = snapshots.find((item) => item.id === value)
    if (!snapshot) return
    setTargetChapterOrder(snapshot.targetChapterOrder)
    setBudgetMode(snapshot.mode)
    setBudgetMaxTokens(snapshot.budgetProfile.maxTokens)
    if (snapshot.chapterTask.targetWordCount) setEstimatedWordCount(snapshot.chapterTask.targetWordCount)
    if (snapshot.chapterTask.readerEmotion) {
      const nextEmotionState = rememberReaderEmotionTarget(project.id, snapshot.chapterTask.readerEmotion)
      setReaderEmotionTarget(snapshot.chapterTask.readerEmotion)
      setReaderEmotionPresets(nextEmotionState.presets)
    }
  }

  function firstFailedStep() {
    return selectedSteps.find((step) => step.status === 'failed') ?? null
  }

  function pendingMemoryCandidateCount() {
    return selectedCandidates.filter((candidate) => candidate.status === 'pending').length
  }

  function primaryActionLabel() {
    if (!selectedJob) return '开始生成'
    if (selectedJob.status === 'running' || isPipelineRunning) return '流水线运行中'
    if (selectedJob.status === 'failed' && firstFailedStep()) return '重试失败步骤'
    if (latestQualityReport && !latestQualityReport.pass && latestDraft) return '生成修订候选'
    if (latestQualityReport?.pass && latestDraft && latestDraft.status !== 'accepted') return '接受草稿'
    if (latestDraft && !latestQualityReport) return '查看草稿'
    if (latestDraft?.status === 'accepted' && pendingMemoryCandidateCount() > 0) return '处理记忆候选'
    return selectedJob.status === 'completed' ? '查看结果' : '查看步骤'
  }

  function runPrimaryAction() {
    if (!selectedJob) {
      startPipeline()
      return
    }
    const failed = firstFailedStep()
    if (selectedJob.status === 'failed' && failed) {
      retryStep(selectedJob, failed.type)
      return
    }
    if (latestQualityReport && !latestQualityReport.pass && latestDraft) {
      const issue = latestQualityReport.issues[0]
      if (issue) {
        void generateRevisionCandidate(issue, latestQualityReport, latestDraft)
      } else {
        setActiveArtifactTab('draft')
      }
      return
    }
    if (latestQualityReport?.pass && latestDraft && latestDraft.status !== 'accepted') {
      draftAcceptance.acceptDraft(latestDraft)
      return
    }
    if (latestDraft) {
      setActiveArtifactTab('draft')
      return
    }
    setActiveArtifactTab('steps')
  }

  function linkedConsistencyIssueTitle(issueId: string | undefined) {
    if (!issueId) return null
    return consistencyIssueById.get(issueId)?.title ?? null
  }

  return (
    <div className="generation-view">
      <GenerationPipelineConsole
        selectedJob={selectedJob}
        headerTitle="章节生产流水线"
        headerDescription="把上下文构建、任务书、正文草稿、复盘、记忆候选和一致性审稿串成可见流程。"
        topStatusBar={{
          targetChapterOrder: selectedJob?.targetChapterOrder ?? targetChapterOrder,
          job: selectedJob,
          contextSource,
          snapshot: selectedSnapshot ?? selectedTraceSnapshot,
          qualityReport: latestQualityReport,
          draft: latestDraft,
          isRunning: isPipelineRunning,
          primaryActionLabel: primaryActionLabel(),
          primaryActionDisabled: contextSource === 'prompt_snapshot' && !selectedSnapshot && !selectedJob,
          onPrimaryAction: runPrimaryAction
        }}
        configPanel={{
          targetChapterOrder,
          nextChapter,
          pipelineMode,
          estimatedWordCount,
          readerEmotionTarget,
          readerEmotionPresets,
          newReaderEmotionPreset,
          budgetMode,
          budgetMaxTokens,
          defaultTokenBudget: data.settings.defaultTokenBudget,
          contextSource,
          snapshots,
          selectedSnapshot,
          selectedSnapshotId,
          isRunning: isPipelineRunning,
          onTargetChapterOrderChange: setTargetChapterOrder,
          onPipelineModeChange: setPipelineMode,
          onEstimatedWordCountChange: setEstimatedWordCount,
          onReaderEmotionTargetChange: setReaderEmotionTarget,
          onReaderEmotionPreset: applyReaderEmotionPreset,
          onNewReaderEmotionPresetChange: setNewReaderEmotionPreset,
          onAddReaderEmotionPreset: addReaderEmotionPresetFromInput,
          onBudgetModeChange: setBudgetMode,
          onBudgetMaxTokensChange: setBudgetMaxTokens,
          onContextSourceChange: setContextSource,
          onSnapshotChange: handleSnapshotChange,
          onUseAutoContext: useAutoContext,
          onStart: startPipeline
        }}
        jobList={{
          jobs,
          selectedJobId: selectedJob?.id ?? null,
          labels: PIPELINE_STEP_LABELS,
          onSelectJob: setSelectedJobId
        }}
        currentArtifactPanel={{
          activeTab: activeArtifactTab,
          onActiveTabChange: setActiveArtifactTab,
          job: selectedJob,
          draft: latestDraft,
          steps: selectedSteps,
          labels: PIPELINE_STEP_LABELS,
          onAcceptDraft: draftAcceptance.acceptDraft,
          onRejectDraft: draftAcceptance.rejectDraft,
          onRetryDraft: (job) => retryStep(job, 'generate_chapter_draft'),
          onCopyDraft: (draft) => {
            void window.novelDirector.clipboard.writeText(draft.body).then(() => setPipelineMessage('已复制草稿正文。'))
          },
          onRetryStep: retryStep,
          onSkipStep: skipStep
        }}
        memoryCandidatesPanel={{
          candidates: selectedCandidates,
          scoped,
          onAccept: memoryCandidates.applyCandidate,
          onAcceptAll: memoryCandidates.applyAllPendingCandidates,
          onReject: memoryCandidates.rejectCandidate
        }}
        riskBanner={{
          job: selectedJob,
          draft: latestDraft,
          qualityReport: latestQualityReport,
          consistencyReports: selectedReports,
          memoryCandidates: selectedCandidates,
          snapshot: selectedSnapshot,
          targetChapterOrder,
          pipelineMessage
        }}
        stepRail={{
          job: selectedJob,
          steps: selectedSteps,
          labels: PIPELINE_STEP_LABELS,
          onRetry: retryStep,
          onSkip: skipStep
        }}
        diagnosticsPanel={{
          qualityReport: latestQualityReport,
          consistencyReports: selectedReports,
          revisionCandidates: selectedRevisionCandidates,
          latestDraft,
          linkedConsistencyIssueTitle,
          onGenerateRevisionCandidate: generateRevisionCandidate,
          onAcceptRevisionCandidate: acceptRevisionCandidate,
          onRejectRevisionCandidate: rejectRevisionCandidate,
          onStartRevisionFromConsistencyIssue: startRevisionFromConsistencyIssue,
          onUpdateConsistencyIssueStatus: updateConsistencyIssueStatus
        }}
        tracePanel={{
          trace: selectedTrace,
          snapshot: selectedTraceSnapshot,
          authorSummary: selectedAuthorSummary,
          consistencyReport: traceConsistencyReport,
          qualityReport: traceQualityReport,
          continuityBridge: traceContinuityBridge,
          redundancyReport: traceRedundancyReport,
          onCopy: copyRunTrace,
          onGenerateAuthorSummary: generateAuthorSummary
        }}
      />
    </div>
  )
}
