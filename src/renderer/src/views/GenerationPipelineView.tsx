import { useEffect, useState } from 'react'
import type {
  AppData,
  CandidateDecisionCommand,
  ChapterCommitBundle,
  ChapterGenerationJob,
  ChapterGenerationStep,
  ChapterGenerationStepType,
  GenerationRunBundle,
  ID,
  Project
} from '../../../shared/types'
import { getEditorialVerdictForDraft } from '../../../services/EditorialVerdictService'
import { hasCompleteChapterReview } from '../../../services/ChapterAcceptanceReviewService'
import { useConfirm } from '../components/ConfirmDialog'
import { PipelineTaskEditor } from '../components/pipeline/PipelineTaskEditor'
import type { PipelineArtifactTab } from '../components/pipeline/PipelineCurrentArtifactPanel'
import { useProjectData } from '../hooks/useProjectData'
import { getNovelDirectorClipboardApi } from '../platform/novelDirectorBridge'
import type { SaveDataHandler, SaveDataInput } from '../utils/saveDataState'
import { GenerationPipelineConsole } from './generation/GenerationPipelineConsole'
import { usePipelineConfigState } from './generation/usePipelineConfigState'
import { useDraftAcceptance } from './generation/useDraftAcceptance'
import { useMemoryCandidates } from './generation/useMemoryCandidates'
import { canSkipPipelineStep, PIPELINE_STEP_LABELS, usePipelineRunner } from './generation/usePipelineRunner'
import { usePipelinePrimaryAction } from './generation/usePipelinePrimaryAction'
import { usePipelineRevisionActions } from './generation/usePipelineRevisionActions'
import { useSelectedPipelineJob } from './generation/useSelectedPipelineJob'
import { usePipelineTraceActions } from './generation/usePipelineTraceActions'
import { useChapterTaskEditing } from './generation/useChapterTaskEditing'

interface ProjectProps {
  data: AppData
  project: Project
  saveData: SaveDataHandler
  executeCandidateDecision?: (command: CandidateDecisionCommand) => Promise<void>
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
  executeCandidateDecision,
  saveGenerationRunBundle,
  saveChapterCommitBundle,
  onOpenRevision,
  initialSnapshotId,
  onInitialSnapshotConsumed
}: ProjectProps) {
  const confirmAction = useConfirm()
  const scoped = useProjectData(data, project.id)
  const [activeArtifactTab, setActiveArtifactTab] = useState<PipelineArtifactTab>('steps')
  const [preparingNewTask, setPreparingNewTask] = useState(Boolean(initialSnapshotId))
  const [taskDirty, setTaskDirty] = useState(false)
  const pipelineConfig = usePipelineConfigState({
    project,
    settings: data.settings,
    scoped,
    initialSnapshotId,
    onInitialSnapshotConsumed
  })
  const {
    nextChapter,
    targetChapterOrder,
    setTargetChapterOrder,
    pipelineMode,
    setPipelineMode,
    estimatedWordCount,
    setEstimatedWordCount,
    readerEmotionTarget,
    setReaderEmotionTarget,
    readerEmotionPresets,
    newReaderEmotionPreset,
    setNewReaderEmotionPreset,
    budgetMode,
    setBudgetMode,
    budgetMaxTokens,
    setBudgetMaxTokens,
    contextSource,
    setContextSource,
    selectedSnapshotId,
    selectedSnapshot,
    snapshots,
    selectedJobId,
    setSelectedJobId,
    rememberCurrentReaderEmotionTarget,
    applyReaderEmotionPreset,
    addReaderEmotionPresetFromInput,
    useAutoContext,
    handleSnapshotChange
  } = pipelineConfig

  const {
    jobs,
    selectedJob,
    selectedSteps,
    selectedCandidates,
    selectedReports,
    selectedRevisionCandidates,
    selectedTrace,
    selectedAuthorSummary,
    selectedTraceSnapshot,
    consistencyIssueById,
    latestDraft,
    latestQualityReport,
    traceConsistencyReport,
    traceQualityReport,
    traceContinuityBridge,
    traceRedundancyReport,
    selectedStepsKey
  } = useSelectedPipelineJob(scoped, selectedJobId, preparingNewTask)
  const editorialVerdict = latestDraft ? getEditorialVerdictForDraft(data, latestDraft.id) : null
  const acceptanceVerdicts = selectedJob?.pipelineRecipe || editorialVerdict ? data.editorialVerdicts : undefined
  const incompleteReview = !hasCompleteChapterReview(latestQualityReport, editorialVerdict, Boolean(acceptanceVerdicts))
  const draftAcceptanceReview = latestDraft ? scoped.chapterCommitBundles.find((commit) =>
    commit.generatedDraftId === latestDraft.id && commit.jobId === latestDraft.jobId)?.acceptanceReview : undefined

  useEffect(() => {
    if (initialSnapshotId) { setPreparingNewTask(true); setActiveArtifactTab('plan') }
  }, [initialSnapshotId])

  useEffect(() => {
    if (latestDraft) {
      setActiveArtifactTab('draft')
      return
    }
    if (selectedSteps.some((step) => step.status === 'failed')) {
      setActiveArtifactTab('steps')
      return
    }
    if (selectedJob?.taskEdit || selectedSteps.some((step) => step.type === 'generate_chapter_plan' && step.output.trim())) {
      setActiveArtifactTab('plan')
    }
  }, [latestDraft?.id, selectedJob?.id, selectedStepsKey])

  const {
    pipelineMessage,
    setPipelineMessage,
    isPipelineRunning,
    runPipeline,
    retryStep,
    skipStep,
    cancelPipeline
  } = usePipelineRunner({
    data,
    project,
    scoped,
    saveData,
    saveGenerationRunBundle,
    targetChapterOrder,
    pipelineMode,
    estimatedWordCount,
    readerEmotionTarget,
    budgetMode,
    budgetMaxTokens,
    contextSource,
    selectedSnapshot,
    setSelectedJobId: selectPreparedJob
  })

  function selectPreparedJob(id: ID) {
    setPreparingNewTask(false)
    setTaskDirty(false)
    setSelectedJobId(id)
  }

  const taskEditor = useChapterTaskEditing({
    data, project, selectedJob, targetChapterOrder, estimatedWordCount, readerEmotionTarget,
    budgetMode, budgetMaxTokens, pipelineMode, isRunning: isPipelineRunning, saveData, saveGenerationRunBundle,
    selectedSnapshot: contextSource === 'prompt_snapshot' ? selectedSnapshot : null,
    selectJob: (id) => { selectPreparedJob(id); setTargetChapterOrder(selectedJob?.targetChapterOrder ?? targetChapterOrder); useAutoContext(); setActiveArtifactTab('plan') },
    onGenerate: (job) => { void retryTaskStep(job, job.taskEdit!.resumeStep) },
    confirmSnapshotRefresh: () => confirmAction({ title: '另建章节任务', message: '手动快照不会被改写。保存后将根据新任务和当前资料另建上下文，原快照和旧草稿仍可查看。', confirmLabel: '另建任务' })
  })

  async function selectTaskSource(id: ID | null) {
    if (taskEditor.busy) return
    if (taskDirty && !await confirmAction({ title: '保留当前任务？', message: '任务还有未保存修改。切换后将放弃这些输入，已保存任务和正文不受影响。', confirmLabel: '放弃修改并切换', cancelLabel: '继续编辑' })) return
    setTaskDirty(false)
    setPreparingNewTask(id === null)
    if (id !== null) setSelectedJobId(id)
    setActiveArtifactTab('plan')
  }

  function taskReadyToRun() {
    if (!taskDirty && !taskEditor.busy) return true
    setPipelineMessage('请先保存任务，或重置未保存更改。')
    setActiveArtifactTab('plan')
    return false
  }

  async function retryTaskStep(job: ChapterGenerationJob, step: ChapterGenerationStepType) {
    if (taskReadyToRun()) await retryStep(job, step)
  }

  async function skipTaskStep(job: ChapterGenerationJob, step: ChapterGenerationStep) {
    if (taskReadyToRun()) await skipStep(job, step)
  }

  const draftAcceptance = useDraftAcceptance({
    project,
    saveData,
    saveChapterCommitBundle,
    selectedJob,
    targetChapterOrder,
    chapters: scoped.chapters,
    qualityGateReports: scoped.qualityGateReports,
    editorialVerdicts: acceptanceVerdicts,
    confirmAction,
    setPipelineMessage
  })
  const memoryCandidates = useMemoryCandidates({
    data,
    executeCandidateDecision,
    project,
    selectedJob,
    qualityGateReports: latestQualityReport ? [latestQualityReport] : [],
    saveData,
    confirmAction,
    setPipelineMessage
  })

  const revisionActions = usePipelineRevisionActions({
    data,
    project,
    scoped,
    selectedJob,
    selectedSteps,
    selectedTraceSnapshot,
    latestDraft,
    targetChapterOrder,
    readerEmotionTarget,
    estimatedWordCount,
    budgetMode,
    budgetMaxTokens,
    saveData,
    setPipelineMessage,
    onOpenRevision
  })
  const traceActions = usePipelineTraceActions({
    consistencyReport: traceConsistencyReport,
    qualityReport: traceQualityReport,
    saveData,
    setPipelineMessage
  })

  function startPipeline() {
    if (!taskReadyToRun()) return
    if (contextSource === 'auto' && selectedJob?.contextSource === 'auto' && selectedJob.status === 'idle' && selectedJob.taskEdit && selectedJob.targetChapterOrder === targetChapterOrder) {
      void retryStep(selectedJob, selectedJob.taskEdit.resumeStep)
      return
    }
    rememberCurrentReaderEmotionTarget()
    void runPipeline()
  }

  function startNextChapter() {
    if (!taskReadyToRun()) return
    const nextOrder = Math.max(nextChapter, (selectedJob?.targetChapterOrder ?? targetChapterOrder) + 1)
    setTargetChapterOrder(nextOrder)
    useAutoContext()
    rememberCurrentReaderEmotionTarget()
    setPipelineMessage(`第 ${selectedJob?.targetChapterOrder ?? targetChapterOrder} 章已完成，正在开始生成第 ${nextOrder} 章。`)
    void runPipeline({ targetChapterOrder: nextOrder, forceAutoContext: true })
  }

  const primaryAction = usePipelinePrimaryAction({
    selectedJob,
    selectedSteps,
    latestDraft,
    latestQualityReport,
    isPipelineRunning,
    onStartPipeline: startPipeline,
    onStartNextChapter: startNextChapter,
    onRetryStep: retryTaskStep,
    onAcceptDraft: draftAcceptance.acceptDraft,
    onActiveArtifactTabChange: setActiveArtifactTab
  })

  function linkedConsistencyIssueTitle(issueId: string | undefined) {
    if (!issueId) return null
    return consistencyIssueById.get(issueId)?.title ?? null
  }

  return (
    <div className="generation-view">
      <GenerationPipelineConsole
        taskEditor={<PipelineTaskEditor key={`${project.id}:${selectedJob?.id ?? `new-${targetChapterOrder}`}`} {...taskEditor} onDirtyChange={setTaskDirty} />}
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
          primaryActionLabel: primaryAction.primaryActionLabel,
          primaryActionDisabled: taskDirty || taskEditor.busy || (contextSource === 'prompt_snapshot' && !selectedSnapshot && !selectedJob),
          onPrimaryAction: () => { if (taskReadyToRun()) primaryAction.runPrimaryAction() }
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
          onTargetChapterOrderChange: (order) => { setTargetChapterOrder(order); setPreparingNewTask(true); setActiveArtifactTab('plan') },
          onPipelineModeChange: setPipelineMode,
          onEstimatedWordCountChange: setEstimatedWordCount,
          onReaderEmotionTargetChange: setReaderEmotionTarget,
          onReaderEmotionPreset: applyReaderEmotionPreset,
          onNewReaderEmotionPresetChange: setNewReaderEmotionPreset,
          onAddReaderEmotionPreset: () => setPipelineMessage(addReaderEmotionPresetFromInput()),
          onBudgetModeChange: setBudgetMode,
          onBudgetMaxTokensChange: setBudgetMaxTokens,
          onContextSourceChange: (source) => { setContextSource(source); setPreparingNewTask(true); setActiveArtifactTab('plan') },
          onSnapshotChange: (id) => { handleSnapshotChange(id); setPreparingNewTask(true); setActiveArtifactTab('plan') },
          onUseAutoContext: () => { useAutoContext(); setPreparingNewTask(true); setActiveArtifactTab('plan') },
          onStart: startPipeline,
          onEditNewTask: () => { void selectTaskSource(null) },
          startDisabled: taskDirty || taskEditor.busy,
          taskEditingLocked: taskDirty || taskEditor.busy
        }}
        jobList={{
          jobs,
          selectedJobId: selectedJob?.id ?? null,
          labels: PIPELINE_STEP_LABELS,
          onSelectJob: (id) => { void selectTaskSource(id) }
        }}
        currentArtifactPanel={{
          activeTab: activeArtifactTab,
          onActiveTabChange: setActiveArtifactTab,
          job: selectedJob,
          isRunning: isPipelineRunning,
          draft: latestDraft,
          steps: selectedSteps,
          labels: PIPELINE_STEP_LABELS,
          onAcceptDraft: draftAcceptance.acceptDraft,
          onAcceptUnreviewedDraft: incompleteReview ? draftAcceptance.acceptDraftUnreviewed : undefined,
          acceptanceReview: draftAcceptanceReview,
          onRejectDraft: draftAcceptance.rejectDraft,
          onRetryDraft: (job) => retryTaskStep(job, 'generate_chapter_draft'),
          onCopyDraft: (draft) => {
            void getNovelDirectorClipboardApi().writeText(draft.body).then(() => setPipelineMessage('已复制草稿正文。'))
          },
          onOpenDraftRevision: onOpenRevision ? revisionActions.startDraftRevision : undefined,
          onRetryStep: retryTaskStep,
          onSkipStep: skipTaskStep,
          canSkipStep: canSkipPipelineStep
        }}
        memoryCandidatesPanel={{
          candidates: selectedCandidates,
          scoped,
          onAccept: memoryCandidates.applyCandidate,
          onAcceptAll: memoryCandidates.applyAllPendingCandidates,
          onReject: memoryCandidates.rejectCandidate,
          disabled: isPipelineRunning
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
          isRunning: isPipelineRunning,
          canSkipFailedStep: Boolean(selectedSteps.find((step) => step.status === 'failed' && canSkipPipelineStep(step.type))),
          onRetry: retryTaskStep,
          onSkip: skipTaskStep,
          onCancel: cancelPipeline
        }}
        diagnosticsPanel={{
          editorialVerdict,
          qualityReport: latestQualityReport,
          consistencyReports: selectedReports,
          revisionCandidates: selectedRevisionCandidates,
          latestDraft,
          chapterCommitBundles: scoped.chapterCommitBundles,
          linkedConsistencyIssueTitle,
          onGenerateRevisionCandidate: revisionActions.generateRevisionCandidate,
          onAcceptRevisionCandidate: revisionActions.acceptRevisionCandidate,
          onRejectRevisionCandidate: revisionActions.rejectRevisionCandidate,
          onStartRevisionFromConsistencyIssue: revisionActions.startRevisionFromConsistencyIssue,
          onStartRevisionFromEditorialIssue: onOpenRevision ? revisionActions.startRevisionFromEditorialIssue : undefined,
          onUpdateConsistencyIssueStatus: revisionActions.updateConsistencyIssueStatus
        }}
        tracePanel={{
          trace: selectedTrace,
          snapshot: selectedTraceSnapshot,
          authorSummary: selectedAuthorSummary,
          consistencyReport: traceConsistencyReport,
          qualityReport: traceQualityReport,
          continuityBridge: traceContinuityBridge,
          redundancyReport: traceRedundancyReport,
          onCopy: traceActions.copyRunTrace,
          onGenerateAuthorSummary: traceActions.generateAuthorSummary
        }}
      />
    </div>
  )
}
