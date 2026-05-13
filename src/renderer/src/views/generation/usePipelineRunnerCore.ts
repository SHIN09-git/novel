import { useMemo, useRef, useState } from 'react'
import type {
  AppData,
  ChapterDraftResult,
  ChapterGenerationJob,
  ChapterGenerationStep,
  ChapterGenerationStepType,
  ChapterTask,
  ChapterPlan,
  ConsistencyReviewReport,
  ContextBudgetMode,
  ContextBudgetProfile,
  ContextNeedPlan,
  ContextSelectionResult,
  ContextSelectionTrace,
  ForcedContextBlock,
  GenerationRunBundle,
  PlanContextGapAnalysisResult,
  PromptBlockOrderItem,
  GeneratedChapterDraft,
  CharacterStateChangeCandidate,
  CharacterStateFact,
  CharacterStateTransaction,
  ID,
  MemoryUpdateCandidate,
  NoveltyAuditResult,
  PipelineContextSource,
  PipelineMode,
  Project,
  PromptContextSnapshot,
  StoryDirectionGuide
} from '../../../../shared/types'
import { safeParseJson } from '../../../../services/AIJsonParser'
import { AIService } from '../../../../services/AIService'
import { ContextBudgetManager } from '../../../../services/ContextBudgetManager'
import { ContextNeedPlannerService } from '../../../../services/ContextNeedPlannerService'
import { CharacterStateService } from '../../../../services/CharacterStateService'
import { QualityGateService } from '../../../../services/QualityGateService'
import { TokenEstimator } from '../../../../services/TokenEstimator'
import { inferPromptBlockOrderFromPrompt } from '../../../../services/PromptBuilderService'
import { formatContinuityBridgeForPrompt, resolveContinuityBridge } from '../../../../services/ContinuityService'
import { analyzeRedundancy } from '../../../../services/RedundancyService'
import { NoveltyDetector } from '../../../../services/NoveltyDetector'
import { PlanContextGapAnalyzerService } from '../../../../services/PlanContextGapAnalyzerService'
import { StoryDirectionService } from '../../../../services/StoryDirectionService'
import {
  appendMissingGenerationRunRelatedItems,
  applyGenerationRunBundleToAppData,
  buildGenerationRunBundle
} from '../../../../services/GenerationRunBundleService'
import { newId, now } from '../../utils/format'
import { createContextBudgetProfile, selectBudgetContext, buildPipelineContextResultFromSelection } from '../../utils/promptContext'
import { releasePipelineRunLock, tryAcquirePipelineRunLock } from '../../utils/pipelineRunLock'
import { buildForeshadowingTreatmentModes, estimateForcedContextTokens, upsertGenerationRunTrace } from '../../utils/runTrace'
import type { SaveDataInput } from '../../utils/saveDataState'
import { runPipelineFromStepEngine } from './pipelineRunnerEngine'
import {
  PIPELINE_STEP_LABELS,
  PIPELINE_STEP_ORDER,
  diffIds,
  enrichContextSelectionTrace,
  normalizePipelineOptions,
  noveltyAdjustedConfidence,
  noveltyWarnings,
  parseOutput,
  pipelineChapterTask,
  pipelineContextFromStepOutput,
  serializeOutput,
  summarizeSnapshot,
  uniqueIds,
  validateGeneratedChapterDraft
} from './pipelineUtils'

export { PIPELINE_STEP_LABELS, PIPELINE_STEP_ORDER } from './pipelineUtils'

// Trace enrichment lives in pipelineUtils; keep these block type anchors here for
// source-based regression checks: blockType: 'character_state_fact', blockType: 'hard_canon'.
// Step order anchor for source-based checks:
// 'generate_chapter_plan' -> 'context_need_planning_from_plan' -> 'context_budget_selection_delta' -> 'rebuild_context_with_plan' -> 'generate_chapter_draft'.
interface UsePipelineRunnerArgs {
  data: AppData
  project: Project
  scoped: {
    bible: AppData['storyBibles'][number] | null
    chapters: AppData['chapters']
    characters: AppData['characters']
    characterStateLogs: AppData['characterStateLogs']
    characterStateFacts: AppData['characterStateFacts']
    foreshadowings: AppData['foreshadowings']
    timelineEvents: AppData['timelineEvents']
    stageSummaries: AppData['stageSummaries']
  }
  saveData: (next: SaveDataInput) => Promise<void>
  saveGenerationRunBundle?: (next: SaveDataInput, bundle: GenerationRunBundle) => Promise<void>
  targetChapterOrder: number
  pipelineMode: PipelineMode
  estimatedWordCount: string
  readerEmotionTarget: string
  budgetMode: ContextBudgetMode
  budgetMaxTokens: number
  contextSource: PipelineContextSource
  selectedSnapshot: PromptContextSnapshot | null
  setSelectedJobId: (id: ID) => void
}

export function usePipelineRunner({
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
  setSelectedJobId
}: UsePipelineRunnerArgs) {
  const [pipelineMessage, setPipelineMessage] = useState('')
  const pipelineRunLockRef = useRef(false)
  const [isPipelineRunning, setIsPipelineRunning] = useState(false)
  const aiService = useMemo(() => new AIService(data.settings), [data.settings])

  function makeInitialSteps(jobId: ID): ChapterGenerationStep[] {
    const timestamp = now()
    return PIPELINE_STEP_ORDER.map((type) => ({
      id: newId(),
      jobId,
      type,
      status: 'pending',
      inputSnapshot: '',
      output: '',
      errorMessage: '',
      createdAt: timestamp,
      updatedAt: timestamp
    }))
  }

  function mergePipelineWorking(current: AppData, working: AppData, jobId?: ID): AppData {
    const next = jobId ? applyGenerationRunBundleToAppData(current, buildGenerationRunBundle(working, jobId)) : current
    return {
      ...next,
      contextBudgetProfiles: appendMissingGenerationRunRelatedItems(next.contextBudgetProfiles, working.contextBudgetProfiles),
      contextNeedPlans: appendMissingGenerationRunRelatedItems(next.contextNeedPlans, working.contextNeedPlans),
      characterStateChangeCandidates: appendMissingGenerationRunRelatedItems(
        next.characterStateChangeCandidates,
        working.characterStateChangeCandidates
      ),
      redundancyReports: appendMissingGenerationRunRelatedItems(next.redundancyReports, working.redundancyReports)
    }
  }

  async function persistWorking(next: AppData, jobId?: ID, statusMessage?: string): Promise<AppData> {
    if (jobId && saveGenerationRunBundle) {
      const bundle = buildGenerationRunBundle(next, jobId)
      await saveGenerationRunBundle((current) => mergePipelineWorking(current, next, jobId), bundle)
    } else {
      await saveData((current) => mergePipelineWorking(current, next, jobId))
    }
    if (statusMessage) {
      // saveData owns the visible status; this keeps the call sites readable.
      void statusMessage
    }
    return next
  }

  function updateStepInData(
    working: AppData,
    stepId: ID,
    patch: Partial<ChapterGenerationStep>,
    jobPatch: Partial<ChapterGenerationJob> = {}
  ): AppData {
    const timestamp = now()
    const step = working.chapterGenerationSteps.find((item) => item.id === stepId)
    return {
      ...working,
      chapterGenerationSteps: working.chapterGenerationSteps.map((item) =>
        item.id === stepId ? { ...item, ...patch, updatedAt: timestamp } : item
      ),
      chapterGenerationJobs: working.chapterGenerationJobs.map((job) =>
        step && job.id === step.jobId ? { ...job, ...jobPatch, updatedAt: timestamp } : job
      )
    }
  }

  async function runPipeline() {
    setPipelineMessage('')
    if (!tryAcquirePipelineRunLock(pipelineRunLockRef)) {
      setPipelineMessage('流水线正在运行，请等待当前任务结束后再启动。')
      return
    }
    setIsPipelineRunning(true)
    try {
    if (contextSource === 'prompt_snapshot' && !selectedSnapshot) {
      setPipelineMessage('请先选择一个 Prompt 构建器上下文快照，或切换为自动构建上下文。')
      return
    }
    if (contextSource === 'prompt_snapshot' && selectedSnapshot && selectedSnapshot.targetChapterOrder !== targetChapterOrder) {
      setPipelineMessage(`提示：快照目标是第 ${selectedSnapshot.targetChapterOrder} 章，当前流水线目标是第 ${targetChapterOrder} 章；将按流水线目标继续，但请确认上下文是否合适。`)
    }
    const timestamp = now()
    const job: ChapterGenerationJob = {
      id: newId(),
      projectId: project.id,
      targetChapterOrder,
      promptContextSnapshotId: contextSource === 'prompt_snapshot' ? selectedSnapshot?.id ?? null : null,
      contextSource,
      status: 'running',
      currentStep: 'context_need_planning',
      createdAt: timestamp,
      updatedAt: timestamp,
      errorMessage: ''
    }
    const steps = makeInitialSteps(job.id)
    let working: AppData = {
      ...data,
      chapterGenerationJobs: [job, ...data.chapterGenerationJobs],
      chapterGenerationSteps: [...data.chapterGenerationSteps, ...steps]
    }
    await persistWorking(working, job.id)
    setSelectedJobId(job.id)
    await runPipelineFromStep(working, job.id, 'context_need_planning', {
      targetChapterOrder,
      pipelineMode,
      estimatedWordCount,
      readerEmotionTarget,
      budgetMode,
      budgetMaxTokens
    })
    } catch (error) {
      setPipelineMessage(error instanceof Error ? error.message : String(error))
    } finally {
      releasePipelineRunLock(pipelineRunLockRef)
      setIsPipelineRunning(false)
    }
  }

  async function skipStep(job: ChapterGenerationJob, step: ChapterGenerationStep) {
    await saveData((current) =>
      updateStepInData(current, step.id, { status: 'skipped', errorMessage: '' }, { currentStep: step.type, status: job.status })
    )
  }

  async function retryStep(job: ChapterGenerationJob, stepType: ChapterGenerationStepType) {
    setPipelineMessage('')
    const firstStep = data.chapterGenerationSteps.find((step) => step.jobId === job.id && step.type === stepType)
    if (!firstStep) return
    const fallbackOptions = { targetChapterOrder: job.targetChapterOrder, pipelineMode, estimatedWordCount, readerEmotionTarget, budgetMode, budgetMaxTokens }
    const options = normalizePipelineOptions(parseOutput(firstStep.inputSnapshot, fallbackOptions), fallbackOptions)
    await runPipelineFromStep(data, job.id, stepType, options)
  }

  async function runPipelineFromStep(
    initialData: AppData,
    jobId: ID,
    fromStep: ChapterGenerationStepType,
    inputOptions: {
      targetChapterOrder: number
      pipelineMode: PipelineMode
      estimatedWordCount: string
      readerEmotionTarget: string
      budgetMode: ContextBudgetMode
      budgetMaxTokens: number
    }
  ) {
    return runPipelineFromStepEngine(initialData, jobId, fromStep, inputOptions, {
      data,
      project,
      scoped,
      targetChapterOrder,
      pipelineMode,
      estimatedWordCount,
      readerEmotionTarget,
      budgetMode,
      budgetMaxTokens,
      aiService,
      persistWorking,
      updateStepInData
    })
  }

  return {
    pipelineMessage,
    setPipelineMessage,
    isPipelineRunning,
    runPipeline,
    retryStep,
    skipStep
  }
}
