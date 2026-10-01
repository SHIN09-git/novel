import { randomUUID } from 'node:crypto'
import type {
  AgentDecision,
  AgentRun,
  AgentRunMode,
  AgentSafetyMode,
  AppData,
  ChapterGenerationJob,
  ChapterGenerationStep,
  ChapterGenerationStepType,
  ChapterTask,
  ID,
  PipelineMode
} from '../shared/types'
import { isChapterArchived } from '../services/ChapterLifecycleService'
import { createPipelineAIRunConfig } from '../services/PipelineRunContextService'
import { PipelineRecipeService } from '../services/PipelineRecipeService'

export const AGENT_PIPELINE_STEP_ORDER: ChapterGenerationStepType[] = [
  'context_need_planning',
  'context_budget_selection',
  'build_context',
  'generate_chapter_plan',
  'context_need_planning_from_plan',
  'context_budget_selection_delta',
  'rebuild_context_with_plan',
  'generate_chapter_draft',
  'generate_chapter_review',
  'propose_character_updates',
  'propose_foreshadowing_updates',
  'consistency_review',
  'quality_gate',
  'await_user_confirmation'
]

export interface PrepareAgentChapterRunInput {
  appData: AppData
  projectId: ID
  targetChapterOrder: number
  goal?: string
  chapterTaskSnapshot?: ChapterTask | null
  temperature?: number
  safetyMode?: AgentSafetyMode
  agentRunId?: ID
  targetChapterOrders?: number[]
}

export interface PrepareAgentChapterRunResult {
  appData: AppData
  agentRun: AgentRun
  job: ChapterGenerationJob
  steps: ChapterGenerationStep[]
  warning: string
}

export interface PrepareSequentialChapterRunInput extends PrepareAgentChapterRunInput {
  chapterCount: number
}

function now(): string {
  return new Date().toISOString()
}

function newId(prefix: string): ID {
  return `${prefix}-${randomUUID()}`
}

function upsertById<T extends { id: ID }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id)
  if (index < 0) return [...items, next]
  return items.map((item, itemIndex) => (itemIndex === index ? next : item))
}

function projectExists(appData: AppData, projectId: ID): boolean {
  return appData.projects.some((project) => project.id === projectId)
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value >= 1).map((value) => Math.floor(value)))]
}

function targetOrdersFromInput(input: PrepareAgentChapterRunInput): number[] {
  const explicit = input.targetChapterOrders?.length ? input.targetChapterOrders : [input.targetChapterOrder]
  const normalized = uniqueNumbers(explicit)
  if (!normalized.includes(input.targetChapterOrder)) normalized.unshift(Math.floor(input.targetChapterOrder))
  return uniqueNumbers(normalized).sort((a, b) => a - b)
}

function pipelineModeForSafetyMode(safetyMode: AgentSafetyMode | undefined): PipelineMode {
  if (safetyMode === 'conservative') return 'conservative'
  if (safetyMode === 'experimental') return 'aggressive'
  return 'standard'
}

function createPendingSteps(jobId: ID, timestamp: string): ChapterGenerationStep[] {
  return AGENT_PIPELINE_STEP_ORDER.map((type) => ({
    id: newId(`agent-step-${type}`),
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

export class AgentRunService {
  static validateAgentRun(run: AgentRun): void {
    if (!run.id) throw new Error('AgentRun missing id.')
    if (!run.projectId) throw new Error('AgentRun missing projectId.')
    if (!run.goal.trim()) throw new Error('AgentRun missing goal.')
    if (!run.targetChapterOrders.length) throw new Error('AgentRun missing target chapters.')
  }

  static upsertAgentRunToAppData(appData: AppData, run: AgentRun): AppData {
    this.validateAgentRun(run)
    return {
      ...appData,
      agentRuns: upsertById(appData.agentRuns ?? [], run)
    }
  }

  static recordAgentDecision(appData: AppData, decision: AgentDecision): AppData {
    if (!decision.id) throw new Error('AgentDecision missing id.')
    if (!decision.agentRunId) throw new Error('AgentDecision missing agentRunId.')
    const run = appData.agentRuns.find((item) => item.id === decision.agentRunId)
    if (!run) throw new Error(`AgentRun not found: ${decision.agentRunId}`)
    const nextRun: AgentRun = {
      ...run,
      decisions: upsertById(run.decisions, decision),
      updatedAt: decision.createdAt
    }
    return this.upsertAgentRunToAppData(appData, nextRun)
  }

  static prepareSingleChapterRun(input: PrepareAgentChapterRunInput): PrepareAgentChapterRunResult {
    const timestamp = now()
    const { appData, projectId, targetChapterOrder } = input
    if (!projectExists(appData, projectId)) throw new Error(`Project not found: ${projectId}`)
    if (!Number.isSafeInteger(targetChapterOrder) || targetChapterOrder < 1) {
      throw new Error('Invalid targetChapterOrder.')
    }
    if (input.temperature !== undefined && (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)) {
      throw new Error('temperature must be a number between 0 and 2.')
    }
    if (input.chapterTaskSnapshot && (typeof input.chapterTaskSnapshot.goal !== 'string' || !input.chapterTaskSnapshot.goal.trim())) {
      throw new Error('chapterTaskSnapshot.goal is required.')
    }

    const targetChapterOrders = targetOrdersFromInput(input)
    const mode: AgentRunMode = targetChapterOrders.length > 1 ? 'multi_chapter' : 'single_chapter'
    const existingChapter = appData.chapters.find((chapter) => chapter.projectId === projectId && chapter.order === targetChapterOrder) ?? null
    if (existingChapter && isChapterArchived(existingChapter)) {
      throw new Error(`Chapter ${targetChapterOrder} is archived. Restore it before starting a new production run.`)
    }
    const agentRunId = input.agentRunId ?? newId('agent-run')
    const jobId = newId('agent-job')
    const goal = input.goal?.trim() || (mode === 'multi_chapter'
      ? `Run chapters ${targetChapterOrders[0]}-${targetChapterOrders[targetChapterOrders.length - 1]} through the standard per-chapter workflow.`
      : `Generate chapter ${targetChapterOrder}, then decide after review and quality gate.`)

    const aiRunConfig = createPipelineAIRunConfig(
      input.temperature === undefined ? appData.settings : { ...appData.settings, temperature: input.temperature }
    )
    const pipelineMode = pipelineModeForSafetyMode(input.safetyMode)
    const pipelineRecipe = PipelineRecipeService.resolveRecipe(undefined, pipelineMode)
    const job: ChapterGenerationJob = {
      id: jobId,
      projectId,
      targetChapterOrder,
      chapterTaskSnapshot: input.chapterTaskSnapshot ? { ...input.chapterTaskSnapshot } : null,
      promptContextSnapshotId: null,
      contextSource: 'auto',
      aiRunConfig,
      pipelineMode,
      pipelineRecipeId: pipelineRecipe.id,
      pipelineRecipeVersion: pipelineRecipe.version,
      pipelineRecipe,
      status: 'paused',
      currentStep: 'context_need_planning',
      createdAt: timestamp,
      updatedAt: timestamp,
      errorMessage: ''
    }
    const steps = createPendingSteps(jobId, timestamp)
    const decision: AgentDecision = {
      id: newId('agent-decision'),
      agentRunId,
      projectId,
      chapterId: existingChapter?.id ?? null,
      jobId,
      step: 'prepare_single_chapter_run',
      action: 'run_pipeline',
      reason: 'Agent created a traceable single-chapter production job. The chapter must still pass generation, review, quality gate, and confirmation.',
      evidence: [`projectId=${projectId}`, `targetChapterOrder=${targetChapterOrder}`, `jobId=${jobId}`],
      riskLevel: 'low',
      result: 'pending_human',
      createdAt: timestamp
    }
    const agentRun: AgentRun = {
      id: agentRunId,
      projectId,
      goal,
      mode,
      safetyMode: input.safetyMode ?? 'autonomous',
      targetChapterOrders,
      status: 'paused',
      createdJobIds: [jobId],
      createdDraftIds: [],
      createdCommitIds: [],
      pendingHumanReviewItemIds: [],
      decisions: [decision],
      summary: mode === 'multi_chapter'
        ? `Registered target chapters ${targetChapterOrders.join(', ')}. Only chapter ${targetChapterOrder} is started now.`
        : `Registered chapter ${targetChapterOrder} production job; waiting for the pipeline runner.`,
      warnings: mode === 'multi_chapter'
        ? ['Sequential mode records a target queue, but it still advances one complete chapter workflow at a time.']
        : ['The run is registered and ready for the standard chapter pipeline. Acceptance remains a separate decision.'],
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      schemaVersion: 1
    }

    const nextData: AppData = {
      ...appData,
      agentRuns: upsertById(appData.agentRuns ?? [], agentRun),
      chapterGenerationJobs: upsertById(appData.chapterGenerationJobs, job),
      chapterGenerationSteps: [
        ...appData.chapterGenerationSteps.filter((step) => step.jobId !== jobId),
        ...steps
      ]
    }

    return {
      appData: nextData,
      agentRun,
      job,
      steps,
      warning: agentRun.warnings[0]
    }
  }

  static prepareSequentialChapterRun(input: PrepareSequentialChapterRunInput): PrepareAgentChapterRunResult {
    if (!Number.isSafeInteger(input.chapterCount) || input.chapterCount < 1 || input.chapterCount > 1000) {
      throw new Error('Invalid chapterCount.')
    }
    const count = input.chapterCount
    const targetChapterOrders = Array.from({ length: count }, (_, index) => input.targetChapterOrder + index)
    return this.prepareSingleChapterRun({
      ...input,
      targetChapterOrders
    })
  }
}
