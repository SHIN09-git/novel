import { randomUUID } from 'node:crypto'
import type {
  AgentDecision,
  AgentRun,
  AppData,
  ChapterGenerationJob,
  ChapterGenerationStep,
  ChapterGenerationStepType,
  ContextBudgetMode,
  ID,
  PipelineAIRole,
  PipelineMode
} from '../shared/types'
import { AIService as WorkflowAIService } from '../services/AIService'
import type { AIChatCompletionTransport } from '../services/ai/AITransport'
import { readChapterStepFragment } from '../shared/chapterStepFragment'
import { getPipelineRoleForStep, resolvePipelineRoleSettings, resolvePipelineRunSettings } from '../services/PipelineRunContextService'
import { PIPELINE_AI_ROLES } from '../shared/normalizers/pipelineRunConfig'
import { PipelineRecipeService } from '../services/PipelineRecipeService'
import { OPENING_READER_EMOTION_FALLBACK } from '../services/OpeningChapterContextPolicy'
import { AIService as MainAITransportService } from '../main/services/AIService'
import { AIHttpClient } from '../main/services/AIHttpClient'
import { appendProjectUsageAttempts } from '../storage/projectUsageJournal'
import { CodexCliService } from '../main/services/CodexCliService'
import { agentApiKey, apiEndpoint, backupKeyAfterRejection, readApiRegistry, type ApiRegistry } from '../main/services/ApiRegistry'
import { DiagnosticsService } from '../main/services/DiagnosticsService'
import { TokenBucketRateLimiter } from '../main/RateLimiter'
import { projectData } from '../renderer/src/utils/projectData'
import { runPipelineFromStepEngine } from '../renderer/src/views/generation/pipelineRunnerEngine'
import { parseOutput, type PipelineRuntimeOptions } from '../renderer/src/views/generation/pipelineRuntimeBasics'
import type { PipelineDiagnosticsAdapter } from '../renderer/src/views/generation/pipelineRunnerTypes'
import { saveAgentRuntimeData, type AgentRuntimeData } from './AgentRuntime'
import { AGENT_PIPELINE_STEP_ORDER, AgentRunService } from './AgentRunService'
import { AgentExecutionControlService } from './AgentExecutionControlService'
import { checkPipelineRunTarget, describePendingRunTarget, firstPendingRunTarget, isMultiChapterRun } from './agentBatchWriteback'
import { BATCH_EXECUTION_PREFIX, batchModelRequestGuard, guardModelCalls, pauseInterruptedBatchAttempt, reopenPipelineRuntime } from './agentPipelineWritebackGuard'
import { StorageRevisionConflictError } from '../storage/StorageService'

export interface ExecuteAgentChapterPipelineInput {
  /** Older callers pass a snapshot here. Execution always reopens the persisted run. */
  appData?: AppData
  runtime: AgentRuntimeData
  agentRunId: ID
  jobId: ID
  pipelineMode?: PipelineMode
  estimatedWordCount?: string
  readerEmotionTarget?: string
  budgetMode?: ContextBudgetMode
  budgetMaxTokens?: number
  fromStep?: ChapterGenerationStepType
}

export interface AgentPipelineExecutorDependencies {
  workflowAI?: WorkflowAIService
  transport?: AIChatCompletionTransport
  diagnostics?: PipelineDiagnosticsAdapter
  cancelActiveRun?: (runId: ID) => boolean
  cancellationPollIntervalMs?: number
}

export interface ExecuteAgentChapterPipelineResult {
  appData: AppData
  agentRun: AgentRun
  job: ChapterGenerationJob
  draftIds: ID[]
  completedStepCount: number
  failedStep: ChapterGenerationStep | null
  startedFromStep: ChapterGenerationStepType
}

function now(): string {
  return new Date().toISOString()
}

function newId(prefix: string): ID {
  return `${prefix}-${randomUUID()}`
}

export function resolveAgentPipelineResumeStep(
  data: AppData,
  jobId: ID,
  requestedStep?: ChapterGenerationStepType,
  requestedMode?: PipelineMode
): ChapterGenerationStepType | null {
  const steps = data.chapterGenerationSteps.filter((step) => step.jobId === jobId)
  if (requestedStep) {
    return steps.some((step) => step.type === requestedStep) ? requestedStep : null
  }
  const job = data.chapterGenerationJobs.find((item) => item.id === jobId)
  const recipe = job
    ? PipelineRecipeService.resolveRecipe(
        requestedMode
          ? undefined
          : job.pipelineRecipe ?? job.pipelineRecipeId ?? job.pipelineMode,
        requestedMode ?? job.pipelineMode ?? 'standard'
      )
    : null
  const executableSteps = recipe
    ? new Set(PipelineRecipeService.resolveExecutionPlan(recipe, requestedMode ?? job?.pipelineMode ?? 'standard').steps
        .filter((decision) => decision.run)
        .map((decision) => decision.type))
    : null
  for (const status of ['failed', 'running', 'pending'] as const) {
    const next = AGENT_PIPELINE_STEP_ORDER.find((type) =>
      executableSteps?.has(type) !== false && steps.some((step) => step.type === type && step.status === status)
    )
    if (next) return next
  }
  return null
}

function outputForRestart(step: ChapterGenerationStep, fromStep: ChapterGenerationStepType): string {
  if (step.type !== 'generate_chapter_draft') return ''
  if (fromStep === step.type && (step.status === 'running' || step.status === 'failed' || step.status === 'pending')) {
    return step.output
  }
  // Restarting upstream invalidates reuse, but keep the readable fragment until there is a replacement.
  // The read-only projection deliberately excludes any repair source tied to the old inputs.
  const fragment = readChapterStepFragment(step)
  return fragment ? JSON.stringify(fragment) : ''
}

function preparePipelineExecutionState(
  data: AppData,
  agentRunId: ID,
  jobId: ID,
  fromStep: ChapterGenerationStepType,
  executionId?: ID
): AppData {
  const timestamp = now()
  const startIndex = AGENT_PIPELINE_STEP_ORDER.indexOf(fromStep)
  if (startIndex < 0) throw new Error(`Unsupported pipeline step: ${fromStep}`)
  const run = data.agentRuns.find((item) => item.id === agentRunId)
  if (!run) throw new Error(`AgentRun not found: ${agentRunId}`)
  const job = data.chapterGenerationJobs.find((item) => item.id === jobId)
  if (!job) throw new Error(`Job not found: ${jobId}`)
  const jobSteps = data.chapterGenerationSteps.filter((step) => step.jobId === jobId)
  const isResume =
    run.status === 'failed' ||
    job.status === 'failed' ||
    jobSteps.some((step) => step.status === 'failed' || step.status === 'running') ||
    jobSteps.some((step) => step.status === 'completed')
  const startDecision: AgentDecision | null = isResume || executionId
    ? {
        id: executionId ?? newId('agent-decision'),
        agentRunId,
        projectId: run.projectId,
        chapterId:
          data.chapters.find(
            (chapter) => chapter.projectId === job.projectId && chapter.order === job.targetChapterOrder
          )?.id ?? null,
        jobId,
        step: fromStep,
        action: isResume ? 'retry_step' : 'run_pipeline',
        reason: isResume ? `Resume the persisted chapter pipeline from ${fromStep}; completed earlier steps remain authoritative.`
          : `Start the registered chapter pipeline from ${fromStep}.`,
        evidence: [`jobId=${jobId}`, `fromStep=${fromStep}`],
        riskLevel: 'low',
        result: 'applied',
        createdAt: timestamp
      }
    : null

  return {
    ...data,
    chapterGenerationSteps: data.chapterGenerationSteps.map((step) => {
      if (step.jobId !== jobId) return step
      const stepIndex = AGENT_PIPELINE_STEP_ORDER.indexOf(step.type)
      if (stepIndex < startIndex) return step
      return {
        ...step,
        status: 'pending',
        output: outputForRestart(step, fromStep),
        errorMessage: '',
        updatedAt: timestamp
      }
    }),
    chapterGenerationJobs: data.chapterGenerationJobs.map((item) =>
      item.id === jobId
        ? {
            ...item,
            status: 'running',
            currentStep: fromStep,
            errorMessage: '',
            updatedAt: timestamp
          }
        : item
    ),
    agentRuns: data.agentRuns.map((item) =>
      item.id === agentRunId
        ? {
            ...item,
            status: 'running',
            decisions: startDecision ? [...item.decisions, startDecision] : item.decisions,
            summary: `Chapter ${job.targetChapterOrder} pipeline is running from ${fromStep}.`,
            updatedAt: timestamp,
            completedAt: null
          }
        : item
    )
  }
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

function pipelineModeForRun(run: AgentRun): PipelineMode {
  if (run.safetyMode === 'conservative') return 'conservative'
  if (run.safetyMode === 'experimental') return 'aggressive'
  return 'standard'
}

export function resolveAgentPipelineAIProfile(
  config: ChapterGenerationJob['aiRunConfig'],
  fallback: AppData['settings'],
  environmentHasApiKey: boolean | ((baseUrl: string) => boolean)
) {
  const needsKey = (settings: AppData['settings']) =>
    settings.apiProvider === 'openai' || settings.apiProvider === 'compatible'
  const withAgentCredentials = (settings: AppData['settings']): AppData['settings'] => ({
    ...settings,
    apiKey: '',
    hasApiKey: needsKey(settings)
      ? (typeof environmentHasApiKey === 'boolean' ? environmentHasApiKey : environmentHasApiKey(settings.baseUrl))
      : settings.hasApiKey
  })
  const aiSettings = withAgentCredentials(resolvePipelineRunSettings(config, fallback))
  const roleSettings = {} as Record<PipelineAIRole, AppData['settings']>
  for (const role of PIPELINE_AI_ROLES) {
    roleSettings[role] = withAgentCredentials(resolvePipelineRoleSettings(config, fallback, role))
  }
  return {
    aiSettings,
    roleSettings,
    requiresEnvironmentApiKey: PIPELINE_AI_ROLES.some((role) => needsKey(roleSettings[role]))
  }
}

export function createHeadlessTransport(settings: AppData['settings'], registry: ApiRegistry, storagePath: string | null, beforeRequest?: () => Promise<void>): {
  transport: AIChatCompletionTransport
  diagnostics: PipelineDiagnosticsAdapter
  cancelRun: (runId: ID) => boolean
} {
  const logger = {
    info: (message: string) => console.error(`[agent-ai] ${message}`),
    warn: (message: string) => console.error(`[agent-ai:warn] ${message}`)
  }
  const transportService = new MainAITransportService(
    { getApiKey: async (baseUrl) => agentApiKey(registry, baseUrl, settings.baseUrl),
      getBackupApiKey: async (baseUrl, rejected) => backupKeyAfterRejection(registry, baseUrl, rejected),
      isManagedEndpoint: async (baseUrl) => registry.has(apiEndpoint(baseUrl)) },
    {
      openai: new TokenBucketRateLimiter(60, 1),
      compatible: new TokenBucketRateLimiter(30, 0.5)
    },
    {
      logger,
      usageJournal: { getStoragePath: () => storagePath, append: appendProjectUsageAttempts },
      ...(beforeRequest ? {
        // Includes retries with another format or key, and diagnostics sent through the same main transport.
        httpClient: new AIHttpClient({ beforeRequest, transport: 'node-fetch' }),
        codexCliService: guardModelCalls(new CodexCliService(logger), beforeRequest, ['chatCompletion'])
      } : {})
    }
  )
  const diagnosticsService = new DiagnosticsService(transportService)
  return {
    transport: {
      chatCompletion: (request) => transportService.chatCompletion(request),
      isManagedEndpoint: (baseUrl) => transportService.isManagedEndpoint(baseUrl)
    },
    diagnostics: {
      analyzeRedundancy: (request) => diagnosticsService.analyzeRedundancy(request),
      auditNovelty: (request) => diagnosticsService.auditNovelty(request),
      evaluateQualityGate: (request) => diagnosticsService.evaluateQualityGate(request)
    },
    cancelRun: (runId) => transportService.cancelRun(runId)
  }
}

function finishAgentRun(
  data: AppData,
  agentRunId: ID,
  job: ChapterGenerationJob,
  draftIds: ID[],
  failedStep: ChapterGenerationStep | null,
  cancelled: boolean
): AppData {
  const run = data.agentRuns.find((item) => item.id === agentRunId)
  if (!run) throw new Error(`AgentRun not found: ${agentRunId}`)
  const timestamp = now()
  const decision: AgentDecision = {
    id: newId('agent-decision'),
    agentRunId,
    projectId: run.projectId,
    chapterId: null,
    jobId: job.id,
    step: failedStep?.type ?? 'await_user_confirmation',
    action: cancelled ? 'cancel_run' : failedStep ? 'retry_step' : 'pause_for_human',
    reason: cancelled
      ? `Agent cancellation stopped the standard chapter pipeline at ${failedStep?.type ?? job.currentStep ?? 'unknown'}. Completed earlier steps remain persisted.`
      : failedStep
      ? `Standard chapter pipeline stopped at ${failedStep.type}: ${failedStep.errorMessage}`
      : 'Standard chapter pipeline completed and is waiting for the same review/acceptance decision as the desktop workflow.',
    evidence: [
      `jobId=${job.id}`,
      `targetChapterOrder=${job.targetChapterOrder}`,
      ...draftIds.map((id) => `draftId=${id}`)
    ],
    riskLevel: cancelled ? 'low' : failedStep ? 'high' : 'low',
    result: cancelled ? 'applied' : failedStep ? 'failed' : 'pending_human',
    createdAt: timestamp
  }
  const nextRun: AgentRun = {
    ...run,
    status: cancelled ? 'cancelled' : failedStep ? 'failed' : 'paused',
    createdDraftIds: [...new Set([...run.createdDraftIds, ...draftIds])],
    decisions: [...run.decisions.filter((item) => item.id !== decision.id), decision],
    summary: cancelled
      ? `Chapter ${job.targetChapterOrder} was cancelled at ${failedStep?.type ?? job.currentStep ?? 'unknown'}. It can resume from the persisted step.`
      : failedStep
      ? `Chapter ${job.targetChapterOrder} stopped at ${failedStep.type}. The last successful step is persisted and can be retried.`
      : `Chapter ${job.targetChapterOrder} completed generation, review, diagnostics, and quality gate; awaiting acceptance decision.`,
    warnings: cancelled
      ? [...new Set([...run.warnings, 'The Agent run was cancelled by an explicit control request.'])]
      : failedStep
      ? [...new Set([...run.warnings, failedStep.errorMessage])]
      : run.warnings.filter((warning) => !warning.includes('full AI pipeline') && !warning.includes('仅登记')),
    updatedAt: timestamp,
    completedAt: null
  }
  return AgentRunService.upsertAgentRunToAppData(data, nextRun)
}

export async function executeAgentChapterPipeline(
  input: ExecuteAgentChapterPipelineInput,
  dependencies: AgentPipelineExecutorDependencies = {}
): Promise<ExecuteAgentChapterPipelineResult> {
  const runtime = await reopenPipelineRuntime(input.runtime)
  const { run, job } = checkPipelineRunTarget(runtime.data, input.agentRunId, input.jobId)
  const executionId = isMultiChapterRun(run) ? BATCH_EXECUTION_PREFIX + randomUUID() : undefined
  try {
    const result = await executeLoadedPipeline(input, dependencies, runtime, run, job, executionId)
    Object.assign(input.runtime, runtime)
    return result
  } catch (error) {
    if (executionId) {
      const reason = error instanceof Error ? error.message : String(error)
      try {
        await pauseInterruptedBatchAttempt(runtime, run.id, job.id, executionId, reason)
      } catch (pauseError) {
        throw new Error(`${reason} 本次任务的暂停状态未能保存：${pauseError instanceof Error ? pauseError.message : String(pauseError)}`, { cause: error })
      }
    }
    throw error
  }
}

async function executeLoadedPipeline(
  input: ExecuteAgentChapterPipelineInput, dependencies: AgentPipelineExecutorDependencies,
  runtime: AgentRuntimeData, initialRun: AgentRun, initialJob: ChapterGenerationJob, executionId?: ID
): Promise<ExecuteAgentChapterPipelineResult> {
  const data = runtime.data
  const beforeRequest = batchModelRequestGuard(runtime, initialRun, initialJob.id)
  const project = data.projects.find((item) => item.id === initialJob.projectId)
  if (!project) throw new Error(`Project not found: ${initialJob.projectId}`)
  const fromStep = resolveAgentPipelineResumeStep(data, initialJob.id, input.fromStep, input.pipelineMode)
  if (!fromStep) {
    const pending = isMultiChapterRun(initialRun) && firstPendingRunTarget(data, initialRun, initialJob.targetChapterOrder + 1)
    if (pending) throw new Error(`本章没有待执行的生成步骤。${describePendingRunTarget(pending)}`)
    throw new Error(`Pipeline job ${initialJob.id} has no failed or unfinished step to run.`)
  }
  await AgentExecutionControlService.clearCancellation(runtime, initialJob.id)

  let latestWorking = preparePipelineExecutionState(data, initialRun.id, initialJob.id, fromStep, executionId)
  let cancellationObserved = false
  let cancellationPollBusy = false
  let cancellationTimer: ReturnType<typeof setInterval> | null = null
  const persistWorking = async (next: AppData): Promise<AppData> => {
    try {
      await saveAgentRuntimeData(next, runtime)
    } catch (error) {
      // Report the earlier chapter if a writeback failure arrived while this step was running.
      if (error instanceof StorageRevisionConflictError) await beforeRequest?.()
      throw error
    }
    latestWorking = next
    return next
  }
  await persistWorking(latestWorking)
  try {
    const defaultSettings = resolvePipelineRunSettings(initialJob.aiRunConfig, data.settings)
    const usesRemoteRoles = resolveAgentPipelineAIProfile(initialJob.aiRunConfig, data.settings, false).requiresEnvironmentApiKey
    const registry = usesRemoteRoles ? await readApiRegistry() : new Map()
    const { aiSettings, roleSettings } = resolveAgentPipelineAIProfile(initialJob.aiRunConfig, data.settings,
      (baseUrl) => Boolean(agentApiKey(registry, baseUrl, defaultSettings.baseUrl)))
    const { pipelineMode, pipelineRecipe } = PipelineRecipeService.resolveRunConfiguration({
      recipe: initialJob.pipelineRecipe, recipeId: initialJob.pipelineRecipeId, storedMode: initialJob.pipelineMode,
      requestedMode: input.pipelineMode, fallbackMode: pipelineModeForRun(initialRun)
    })
    const requireRoleKey = (role: PipelineAIRole) => {
      const settings = roleSettings[role]
      if ((settings.apiProvider === 'compatible' || settings.apiProvider === 'openai') && !settings.hasApiKey) {
        const variable = registry.get(apiEndpoint(settings.baseUrl))?.keyEnv ?? 'NOVEL_DIRECTOR_API_KEY'
        throw new Error(`工作环节 ${role} 缺少对应的 API Key（${variable}）。外部流程按共享清单取密钥。`)
      }
    }
    if (!dependencies.workflowAI && !dependencies.transport) {
      const start = AGENT_PIPELINE_STEP_ORDER.indexOf(fromStep)
      for (const step of PipelineRecipeService.resolveExecutionPlan(pipelineRecipe, pipelineMode).steps) {
        const role = getPipelineRoleForStep(step.type)
        if (!step.run || !role || AGENT_PIPELINE_STEP_ORDER.indexOf(step.type) < start) continue
        // The draft handler checks the persisted checkpoint before it asks for the prose service.
        if (step.type === 'generate_chapter_draft' && fromStep === step.type) continue
        requireRoleKey(role)
      }
    }
    const needsDefaultHeadlessServices = !dependencies.workflowAI || !dependencies.diagnostics
    const headless = needsDefaultHeadlessServices ? createHeadlessTransport(aiSettings, registry, runtime.storagePath, beforeRequest) : null
    const workflowAI = dependencies.workflowAI && guardModelCalls(dependencies.workflowAI, beforeRequest)
    const transport = dependencies.transport
      ? guardModelCalls(dependencies.transport, beforeRequest, ['chatCompletion']) : headless?.transport
    const workflowAIByRole = new Map<PipelineAIRole, WorkflowAIService>()
    const getRoleSettings = (role: PipelineAIRole) => roleSettings[role]
    const getWorkflowAI = async (role: PipelineAIRole) => {
      if (workflowAI) return workflowAI
      if (role === 'prose' && !dependencies.transport) requireRoleKey(role)
      const existing = workflowAIByRole.get(role)
      if (existing) return existing
      const service = new WorkflowAIService(getRoleSettings(role), {
        projectId: initialJob.projectId,
        runId: initialJob.id,
        transport
      })
      workflowAIByRole.set(role, service)
      return service
    }
    const diagnostics = dependencies.diagnostics
      ? guardModelCalls(dependencies.diagnostics, beforeRequest, ['evaluateQualityGate']) : headless?.diagnostics
    if (!diagnostics) throw new Error('Agent pipeline diagnostics adapter is unavailable.')
    const cancelActiveRun = dependencies.cancelActiveRun ?? headless?.cancelRun ?? (() => false)
    const checkCancellation = async (): Promise<boolean> => {
      const requested = await AgentExecutionControlService.isCancellationRequested(runtime, initialJob.id)
      if (requested) {
        cancellationObserved = true
        cancelActiveRun(initialJob.id)
      }
      return requested
    }
    cancellationTimer = setInterval(() => {
      if (cancellationPollBusy) return
      cancellationPollBusy = true
      void checkCancellation().finally(() => {
        cancellationPollBusy = false
      })
    }, Math.max(50, dependencies.cancellationPollIntervalMs ?? 250))
    latestWorking = {
      ...latestWorking,
      chapterGenerationJobs: latestWorking.chapterGenerationJobs.map((job) =>
        job.id === initialJob.id
          ? {
              ...job,
              pipelineMode,
              pipelineRecipeId: pipelineRecipe.id,
              pipelineRecipeVersion: pipelineRecipe.version,
              pipelineRecipe
            }
          : job
      )
    }
    await persistWorking(latestWorking)
    const scoped = projectData(latestWorking, project.id)
    const previousStep = data.chapterGenerationSteps.find((step) => step.jobId === initialJob.id && step.type === fromStep)
    const savedOptions = parseOutput<Partial<PipelineRuntimeOptions> | null>(previousStep?.inputSnapshot ?? '', null)
    const options = {
      targetChapterOrder: initialJob.targetChapterOrder,
      pipelineMode,
      estimatedWordCount: input.estimatedWordCount?.trim() || savedOptions?.estimatedWordCount || '3000-5000',
      readerEmotionTarget:
        input.readerEmotionTarget?.trim() || savedOptions?.readerEmotionTarget ||
        (initialJob.targetChapterOrder === 1
          ? OPENING_READER_EMOTION_FALLBACK
          : '承接上一章情绪，并逐步提升本章核心压力'),
      budgetMode: input.budgetMode ?? savedOptions?.budgetMode ?? data.settings.defaultPromptMode,
      budgetMaxTokens: input.budgetMaxTokens ?? savedOptions?.budgetMaxTokens ?? data.settings.defaultTokenBudget
    }
    latestWorking = await runPipelineFromStepEngine(
      latestWorking,
      initialJob.id,
      fromStep,
      options,
      {
        data: latestWorking,
        project,
        scoped,
        ...options,
        getAiService: getWorkflowAI,
        getAiSettings: getRoleSettings,
        aiSettings,
        runId: initialJob.id,
        diagnostics,
        shouldCancel: checkCancellation,
        persistWorking,
        updateStepInData
      }
    )
  } catch (error) {
    if (beforeRequest) await beforeRequest()
    const message = error instanceof Error ? error.message : String(error)
    const failedStep = latestWorking.chapterGenerationSteps.find(
      (step) => step.jobId === initialJob.id && (step.status === 'running' || step.status === 'pending')
    )
    latestWorking = failedStep
      ? updateStepInData(
          latestWorking,
          failedStep.id,
          { status: 'failed', errorMessage: message },
          { status: 'failed', currentStep: failedStep.type, errorMessage: message }
        )
      : {
          ...latestWorking,
          chapterGenerationJobs: latestWorking.chapterGenerationJobs.map((job) =>
            job.id === initialJob.id ? { ...job, status: 'failed', errorMessage: message, updatedAt: now() } : job
          )
        }
    await persistWorking(latestWorking)
  } finally {
    if (cancellationTimer) clearInterval(cancellationTimer)
  }

  let job = latestWorking.chapterGenerationJobs.find((item) => item.id === initialJob.id) ?? initialJob
  const steps = latestWorking.chapterGenerationSteps.filter((step) => step.jobId === job.id)
  const failedStep = steps.find((step) => step.status === 'failed') ?? null
  const cancellationRequest = await AgentExecutionControlService.getCancellationRequest(runtime, initialJob.id)
  const cancelled = Boolean(failedStep && (cancellationObserved || cancellationRequest))
  if (cancelled) {
    latestWorking = {
      ...latestWorking,
      chapterGenerationJobs: latestWorking.chapterGenerationJobs.map((item) =>
        item.id === job.id
          ? { ...item, status: 'paused', errorMessage: 'Agent pipeline cancelled by request.', updatedAt: now() }
          : item
      )
    }
    job = latestWorking.chapterGenerationJobs.find((item) => item.id === initialJob.id) ?? job
  }
  const draftIds = latestWorking.generatedChapterDrafts.filter((draft) => draft.jobId === job.id).map((draft) => draft.id)
  latestWorking = finishAgentRun(latestWorking, input.agentRunId, job, draftIds, failedStep, cancelled)
  await persistWorking(latestWorking)
  await AgentExecutionControlService.clearCancellation(runtime, initialJob.id)
  const agentRun = latestWorking.agentRuns.find((item) => item.id === input.agentRunId)
  if (!agentRun) throw new Error(`AgentRun not found after execution: ${input.agentRunId}`)
  return {
    appData: latestWorking,
    agentRun,
    job: latestWorking.chapterGenerationJobs.find((item) => item.id === job.id) ?? job,
    draftIds,
    completedStepCount: steps.filter((step) => step.status === 'completed').length,
    failedStep,
    startedFromStep: fromStep
  }
}
