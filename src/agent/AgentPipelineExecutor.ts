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
import { resolvePipelineRoleSettings, resolvePipelineRunSettings } from '../services/PipelineRunContextService'
import { PIPELINE_AI_ROLES } from '../shared/normalizers/pipelineRunConfig'
import { PipelineRecipeService } from '../services/PipelineRecipeService'
import { OPENING_READER_EMOTION_FALLBACK } from '../services/OpeningChapterContextPolicy'
import { AIService as MainAITransportService } from '../main/services/AIService'
import { DiagnosticsService } from '../main/services/DiagnosticsService'
import { TokenBucketRateLimiter } from '../main/RateLimiter'
import { projectData } from '../renderer/src/utils/projectData'
import { runPipelineFromStepEngine } from '../renderer/src/views/generation/pipelineRunnerEngine'
import type { PipelineDiagnosticsAdapter } from '../renderer/src/views/generation/pipelineRunnerTypes'
import { saveAgentRuntimeData, type AgentRuntimeData } from './AgentRuntime'
import { AGENT_PIPELINE_STEP_ORDER, AgentRunService } from './AgentRunService'
import { AgentExecutionControlService } from './AgentExecutionControlService'

export interface ExecuteAgentChapterPipelineInput {
  appData: AppData
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

function preparePipelineExecutionState(
  data: AppData,
  agentRunId: ID,
  jobId: ID,
  fromStep: ChapterGenerationStepType
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
  const resumeDecision: AgentDecision | null = isResume
    ? {
        id: newId('agent-decision'),
        agentRunId,
        projectId: run.projectId,
        chapterId:
          data.chapters.find(
            (chapter) => chapter.projectId === job.projectId && chapter.order === job.targetChapterOrder
          )?.id ?? null,
        jobId,
        step: fromStep,
        action: 'retry_step',
        reason: `Resume the persisted chapter pipeline from ${fromStep}; completed earlier steps remain authoritative.`,
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
        output: '',
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
            decisions: resumeDecision ? [...item.decisions, resumeDecision] : item.decisions,
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
  environmentHasApiKey: boolean
) {
  const needsKey = (settings: AppData['settings']) =>
    settings.apiProvider === 'openai' || settings.apiProvider === 'compatible'
  const withAgentCredentials = (settings: AppData['settings']): AppData['settings'] => ({
    ...settings,
    apiKey: '',
    hasApiKey: needsKey(settings) ? environmentHasApiKey : settings.hasApiKey
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

export function createHeadlessTransport(settings: AppData['settings']): {
  transport: AIChatCompletionTransport
  diagnostics: PipelineDiagnosticsAdapter
  cancelRun: (runId: ID) => boolean
} {
  const environmentApiKey = String(process.env.NOVEL_DIRECTOR_API_KEY ?? '').trim()
  const transportService = new MainAITransportService(
    { getApiKey: async () => environmentApiKey },
    {
      openai: new TokenBucketRateLimiter(60, 1),
      compatible: new TokenBucketRateLimiter(30, 0.5)
    },
    {
      logger: {
        info: (message) => console.error(`[agent-ai] ${message}`),
        warn: (message) => console.error(`[agent-ai:warn] ${message}`)
      }
    }
  )
  const diagnosticsService = new DiagnosticsService(transportService)
  return {
    transport: { chatCompletion: (request) => transportService.chatCompletion(request) },
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
  const initialRun = input.appData.agentRuns.find((item) => item.id === input.agentRunId)
  if (!initialRun) throw new Error(`AgentRun not found: ${input.agentRunId}`)
  const initialJob = input.appData.chapterGenerationJobs.find((item) => item.id === input.jobId)
  if (!initialJob) throw new Error(`Job not found: ${input.jobId}`)
  if (initialRun.projectId !== initialJob.projectId) throw new Error('AgentRun and pipeline job belong to different projects.')
  const project = input.appData.projects.find((item) => item.id === initialJob.projectId)
  if (!project) throw new Error(`Project not found: ${initialJob.projectId}`)
  const fromStep = resolveAgentPipelineResumeStep(input.appData, initialJob.id, input.fromStep, input.pipelineMode)
  if (!fromStep) {
    throw new Error(`Pipeline job ${initialJob.id} has no failed or unfinished step to run.`)
  }
  await AgentExecutionControlService.clearCancellation(input.runtime, initialJob.id)

  const environmentHasApiKey = Boolean(String(process.env.NOVEL_DIRECTOR_API_KEY ?? '').trim())
  const { aiSettings, roleSettings, requiresEnvironmentApiKey } = resolveAgentPipelineAIProfile(
    initialJob.aiRunConfig, input.appData.settings, environmentHasApiKey
  )
  let latestWorking = preparePipelineExecutionState(input.appData, initialRun.id, initialJob.id, fromStep)
  let cancellationObserved = false
  let cancellationPollBusy = false
  let cancellationTimer: ReturnType<typeof setInterval> | null = null
  const persistWorking = async (next: AppData): Promise<AppData> => {
    latestWorking = next
    await saveAgentRuntimeData(next, input.runtime)
    return next
  }
  await persistWorking(latestWorking)
  try {
    if (requiresEnvironmentApiKey && !environmentHasApiKey && !dependencies.workflowAI && !dependencies.transport) {
      throw new Error(
        'Agent Runtime 无法读取桌面安全存储中的 API Key。请设置 NOVEL_DIRECTOR_API_KEY，或在项目设置中使用 Codex CLI / 本地模型后重试。'
      )
    }
    const needsDefaultHeadlessServices = !dependencies.workflowAI || !dependencies.diagnostics
    const headless = needsDefaultHeadlessServices ? createHeadlessTransport(aiSettings) : null
    const workflowAIByRole = new Map<PipelineAIRole, WorkflowAIService>()
    const getRoleSettings = (role: PipelineAIRole) => roleSettings[role]
    const getWorkflowAI = async (role: PipelineAIRole) => {
      if (dependencies.workflowAI) return dependencies.workflowAI
      const existing = workflowAIByRole.get(role)
      if (existing) return existing
      const service = new WorkflowAIService(getRoleSettings(role), {
        runId: initialJob.id,
        transport: dependencies.transport ?? headless?.transport
      })
      workflowAIByRole.set(role, service)
      return service
    }
    const diagnostics = dependencies.diagnostics ?? headless?.diagnostics
    if (!diagnostics) throw new Error('Agent pipeline diagnostics adapter is unavailable.')
    const cancelActiveRun = dependencies.cancelActiveRun ?? headless?.cancelRun ?? (() => false)
    const checkCancellation = async (): Promise<boolean> => {
      const requested = await AgentExecutionControlService.isCancellationRequested(input.runtime, initialJob.id)
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
    const runConfiguration = PipelineRecipeService.resolveRunConfiguration({
      recipe: initialJob.pipelineRecipe,
      recipeId: initialJob.pipelineRecipeId,
      storedMode: initialJob.pipelineMode,
      requestedMode: input.pipelineMode,
      fallbackMode: pipelineModeForRun(initialRun)
    })
    const { pipelineMode, pipelineRecipe } = runConfiguration
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
    const options = {
      targetChapterOrder: initialJob.targetChapterOrder,
      pipelineMode,
      estimatedWordCount: input.estimatedWordCount?.trim() || '3000-5000',
      readerEmotionTarget:
        input.readerEmotionTarget?.trim() ||
        (initialJob.targetChapterOrder === 1
          ? OPENING_READER_EMOTION_FALLBACK
          : '承接上一章情绪，并逐步提升本章核心压力'),
      budgetMode: input.budgetMode ?? input.appData.settings.defaultPromptMode,
      budgetMaxTokens: input.budgetMaxTokens ?? input.appData.settings.defaultTokenBudget
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
    await saveAgentRuntimeData(latestWorking, input.runtime)
  } finally {
    if (cancellationTimer) clearInterval(cancellationTimer)
  }

  let job = latestWorking.chapterGenerationJobs.find((item) => item.id === initialJob.id) ?? initialJob
  const steps = latestWorking.chapterGenerationSteps.filter((step) => step.jobId === job.id)
  const failedStep = steps.find((step) => step.status === 'failed') ?? null
  const cancellationRequest = await AgentExecutionControlService.getCancellationRequest(input.runtime, initialJob.id)
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
  await saveAgentRuntimeData(latestWorking, input.runtime)
  await AgentExecutionControlService.clearCancellation(input.runtime, initialJob.id)
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
