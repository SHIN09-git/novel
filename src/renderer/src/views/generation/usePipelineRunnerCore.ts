import { useCallback, useRef, useState } from 'react'
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
  PipelineAIRole,
  Project,
  PromptContextSnapshot,
  StoryDirectionGuide
} from '../../../../shared/types'
import { newId, now } from '../../utils/format'
import { getNovelDirectorAiApi } from '../../platform/novelDirectorBridge'
import { releasePipelineRunLock, tryAcquirePipelineRunLock } from '../../utils/pipelineRunLock'
import { createPipelineAIRunConfig, resolvePipelineRoleSettings, resolvePipelineRunSettings } from '../../../../services/PipelineRunContextService'
import { PipelineRecipeService } from '../../../../services/PipelineRecipeService'
import type { SaveDataHandler, SaveDataInput } from '../../utils/saveDataState'
import { normalizePipelineOptions, parseOutput } from './pipelineRuntimeBasics'
import { PIPELINE_STEP_LABELS, PIPELINE_STEP_ORDER, canSkipPipelineStep } from './pipelineStepDefinitions'

export { PIPELINE_STEP_LABELS, PIPELINE_STEP_ORDER } from './pipelineStepDefinitions'
type GenerationRunBundleServiceModule = typeof import('../../../../services/GenerationRunBundleService')

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
  saveData: SaveDataHandler
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
  const getAiService = useCallback(async (settings: AppData['settings'], runId: ID) => {
    const { AIService } = await import('../../../../services/AIService'); return new AIService(settings, { runId })
  }, [])

  function makeInitialSteps(jobId: ID): ChapterGenerationStep[] {
    const timestamp = now()
    return PIPELINE_STEP_ORDER.map((type) => ({ id: newId(), jobId, type, status: 'pending', inputSnapshot: '', output: '', errorMessage: '', createdAt: timestamp, updatedAt: timestamp }))
  }

  function mergePipelineWorking(
    current: AppData,
    working: AppData,
    bundleService: GenerationRunBundleServiceModule,
    jobId?: ID
  ): AppData {
    const next = jobId
      ? bundleService.applyGenerationRunBundleToAppData(current, bundleService.buildGenerationRunBundle(working, jobId))
      : current
    return {
      ...next,
      contextBudgetProfiles: bundleService.appendMissingGenerationRunRelatedItems(next.contextBudgetProfiles, working.contextBudgetProfiles),
      contextNeedPlans: bundleService.appendMissingGenerationRunRelatedItems(next.contextNeedPlans, working.contextNeedPlans),
      characterStateChangeCandidates: bundleService.appendMissingGenerationRunRelatedItems(
        next.characterStateChangeCandidates,
        working.characterStateChangeCandidates
      ),
      redundancyReports: bundleService.appendMissingGenerationRunRelatedItems(next.redundancyReports, working.redundancyReports)
    }
  }

  async function persistWorking(next: AppData, jobId?: ID): Promise<AppData> {
    const bundleService = await import('../../../../services/GenerationRunBundleService')
    if (jobId && saveGenerationRunBundle) {
      const bundle = bundleService.buildGenerationRunBundle(next, jobId)
      await saveGenerationRunBundle((current) => mergePipelineWorking(current, next, bundleService, jobId), bundle)
    } else {
      const saved = await saveData((current) => mergePipelineWorking(current, next, bundleService, jobId))
      if (!saved.ok) throw new Error(saved.errorMessage)
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

  async function runPipeline(runOptions: { targetChapterOrder?: number; forceAutoContext?: boolean } = {}) {
    const runTargetChapterOrder = runOptions.targetChapterOrder ?? targetChapterOrder
    const runContextSource = runOptions.forceAutoContext ? 'auto' : contextSource
    const runSnapshot = runOptions.forceAutoContext ? null : selectedSnapshot
    setPipelineMessage('')
    if (!tryAcquirePipelineRunLock(pipelineRunLockRef)) {
      setPipelineMessage('流水线正在运行，请等待当前任务结束后再启动。')
      return
    }
    setIsPipelineRunning(true)
    try {
    if (runContextSource === 'prompt_snapshot' && !runSnapshot) {
      setPipelineMessage('请先选择一个 Prompt 构建器上下文快照，或切换为自动构建上下文。')
      return
    }
    if (runContextSource === 'prompt_snapshot' && runSnapshot && runSnapshot.targetChapterOrder !== runTargetChapterOrder) {
      setPipelineMessage(`提示：快照目标是第 ${runSnapshot.targetChapterOrder} 章，当前流水线目标是第 ${runTargetChapterOrder} 章；将按流水线目标继续，但请确认上下文是否合适。`)
    }
    const timestamp = now()
    const pipelineRecipe = PipelineRecipeService.resolveRecipe(undefined, pipelineMode)
    const job: ChapterGenerationJob = {
      id: newId(),
      projectId: project.id,
      targetChapterOrder: runTargetChapterOrder,
      promptContextSnapshotId: runContextSource === 'prompt_snapshot' ? runSnapshot?.id ?? null : null,
      contextSource: runContextSource,
      aiRunConfig: createPipelineAIRunConfig(data.settings),
      pipelineMode,
      pipelineRecipeId: pipelineRecipe.id,
      pipelineRecipeVersion: pipelineRecipe.version,
      pipelineRecipe,
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
      targetChapterOrder: runTargetChapterOrder,
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
    setPipelineMessage('')
    const currentStep = data.chapterGenerationSteps.find((item) => item.id === step.id && item.jobId === job.id)
    if (!currentStep || currentStep.status !== 'failed') {
      setPipelineMessage('只有失败的可选步骤可以跳过。')
      return
    }
    if (!canSkipPipelineStep(currentStep.type)) {
      setPipelineMessage(`${PIPELINE_STEP_LABELS[currentStep.type]} 是生成链路必需步骤，不能跳过；请重试或修正输入。`)
      return
    }
    const recipeDecision = PipelineRecipeService.resolveStepExecution(
      job.pipelineRecipe ?? job.pipelineRecipeId ?? job.pipelineMode,
      currentStep.type,
      'none',
      job.pipelineMode ?? pipelineMode
    )
    if (recipeDecision.required) {
      setPipelineMessage(`${PIPELINE_STEP_LABELS[currentStep.type]} 在当前流水线配方中是必需步骤，不能跳过；请重试或修正输入。`)
      return
    }
    if (!tryAcquirePipelineRunLock(pipelineRunLockRef)) {
      setPipelineMessage('流水线正在运行，请等待当前任务结束后再操作。')
      return
    }
    setIsPipelineRunning(true)
    try {
      const stepIndex = PIPELINE_STEP_ORDER.indexOf(currentStep.type)
      const nextStepType = PIPELINE_STEP_ORDER[stepIndex + 1]
      if (!nextStepType) throw new Error('没有可继续执行的后续步骤。')
      const fallbackOptions = { targetChapterOrder: job.targetChapterOrder, pipelineMode, estimatedWordCount, readerEmotionTarget, budgetMode, budgetMaxTokens }
      const options = normalizePipelineOptions(parseOutput(currentStep.inputSnapshot, fallbackOptions), fallbackOptions)
      const working = updateStepInData(
        data,
        currentStep.id,
        {
          status: 'skipped',
          output: JSON.stringify({
            kind: 'pipeline_manual_step_skipped',
            stepType: currentStep.type,
            reason: '用户确认跳过失败的可选步骤。'
          }),
          errorMessage: ''
        },
        { currentStep: nextStepType, status: 'running', errorMessage: '' }
      )
      await persistWorking(working, job.id)
      setPipelineMessage(`已跳过${PIPELINE_STEP_LABELS[currentStep.type]}，继续执行${PIPELINE_STEP_LABELS[nextStepType]}。`)
      await runPipelineFromStep(working, job.id, nextStepType, options)
    } catch (error) {
      setPipelineMessage(error instanceof Error ? error.message : String(error))
    } finally {
      releasePipelineRunLock(pipelineRunLockRef)
      setIsPipelineRunning(false)
    }
  }

  async function retryStep(job: ChapterGenerationJob, stepType: ChapterGenerationStepType) {
    setPipelineMessage('')
    if (!tryAcquirePipelineRunLock(pipelineRunLockRef)) {
      setPipelineMessage('流水线正在运行，请等待当前任务结束后再重试。')
      return
    }
    setIsPipelineRunning(true)
    try {
      const firstStep = data.chapterGenerationSteps.find((step) => step.jobId === job.id && step.type === stepType)
      if (!firstStep) return
      const fallbackOptions = { targetChapterOrder: job.targetChapterOrder, pipelineMode, estimatedWordCount, readerEmotionTarget, budgetMode, budgetMaxTokens }
      const options = normalizePipelineOptions(parseOutput(firstStep.inputSnapshot, fallbackOptions), fallbackOptions)
      await runPipelineFromStep(data, job.id, stepType, options)
    } catch (error) {
      setPipelineMessage(error instanceof Error ? error.message : String(error))
    } finally {
      releasePipelineRunLock(pipelineRunLockRef)
      setIsPipelineRunning(false)
    }
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
    const { runPipelineFromStepEngine } = await import('./pipelineRunnerEngine')
    const pipelineJob = initialData.chapterGenerationJobs.find((item) => item.id === jobId)
    const aiSettings = resolvePipelineRunSettings(pipelineJob?.aiRunConfig, data.settings)
    const roleSettings = (role: PipelineAIRole) => resolvePipelineRoleSettings(pipelineJob?.aiRunConfig, data.settings, role)
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
      getAiService: (role) => getAiService(roleSettings(role), jobId),
      getAiSettings: roleSettings,
      aiSettings,
      runId: jobId,
      persistWorking,
      updateStepInData
    })
  }

  async function cancelPipeline(job: ChapterGenerationJob) {
    try {
      const result = await getNovelDirectorAiApi().cancelRun(job.id)
      setPipelineMessage(result.cancelled ? '已发送取消请求，正在保存最后成功步骤。' : '当前没有可取消的 AI 请求。')
    } catch (error) {
      setPipelineMessage(`取消失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    pipelineMessage,
    setPipelineMessage,
    isPipelineRunning,
    runPipeline,
    retryStep,
    skipStep,
    cancelPipeline
  }
}
