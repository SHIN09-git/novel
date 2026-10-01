import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppData, ChapterGenerationStepType, ID } from '../shared/types'
import { AGENT_PIPELINE_STEP_ORDER } from './AgentRunService'
import type { AgentRuntimeData } from './AgentRuntime'

interface AgentCancellationRequest {
  jobId: ID
  requestedAt: string
  reason: string
}

export interface AgentPipelineProgress {
  jobId: ID
  agentRunId: ID | null
  projectId: ID
  targetChapterOrder: number
  jobStatus: AppData['chapterGenerationJobs'][number]['status']
  agentRunStatus: AppData['agentRuns'][number]['status'] | null
  currentStep: ChapterGenerationStepType | null
  currentStepStatus: AppData['chapterGenerationSteps'][number]['status'] | null
  currentStepStartedAt: string | null
  currentStepElapsedMs: number | null
  completedStepCount: number
  failedStepCount: number
  skippedStepCount: number
  totalStepCount: number
  progressPercent: number
  recoverableFromStep: ChapterGenerationStepType | null
  cancellationRequested: boolean
  cancellationRequestedAt: string | null
  cancellationReason: string | null
  lastUpdatedAt: string
}

function markerName(jobId: ID): string {
  return `${createHash('sha256').update(jobId).digest('hex')}.cancel.json`
}

function controlDirectory(runtime: Pick<AgentRuntimeData, 'userDataPath'>): string {
  return join(runtime.userDataPath, '.agent-runtime-control')
}

function markerPath(runtime: Pick<AgentRuntimeData, 'userDataPath'>, jobId: ID): string {
  return join(controlDirectory(runtime), markerName(jobId))
}

async function readCancellationRequest(
  runtime: Pick<AgentRuntimeData, 'userDataPath'>,
  jobId: ID
): Promise<AgentCancellationRequest | null> {
  try {
    const parsed = JSON.parse(await readFile(markerPath(runtime, jobId), 'utf8')) as Partial<AgentCancellationRequest>
    if (parsed.jobId !== jobId || typeof parsed.requestedAt !== 'string') return null
    return {
      jobId,
      requestedAt: parsed.requestedAt,
      reason: typeof parsed.reason === 'string' ? parsed.reason : ''
    }
  } catch {
    return null
  }
}

function recoverableStep(data: AppData, jobId: ID): ChapterGenerationStepType | null {
  const steps = data.chapterGenerationSteps.filter((step) => step.jobId === jobId)
  for (const status of ['failed', 'running', 'pending'] as const) {
    const next = AGENT_PIPELINE_STEP_ORDER.find((type) =>
      steps.some((step) => step.type === type && step.status === status)
    )
    if (next) return next
  }
  return null
}

export class AgentExecutionControlService {
  static async requestCancellation(
    runtime: Pick<AgentRuntimeData, 'userDataPath'>,
    jobId: ID,
    reason = ''
  ): Promise<AgentCancellationRequest> {
    const request: AgentCancellationRequest = {
      jobId,
      requestedAt: new Date().toISOString(),
      reason: reason.trim().slice(0, 500)
    }
    await mkdir(controlDirectory(runtime), { recursive: true })
    await writeFile(markerPath(runtime, jobId), `${JSON.stringify(request)}\n`, 'utf8')
    return request
  }

  static async getCancellationRequest(
    runtime: Pick<AgentRuntimeData, 'userDataPath'>,
    jobId: ID
  ): Promise<AgentCancellationRequest | null> {
    return readCancellationRequest(runtime, jobId)
  }

  static async isCancellationRequested(
    runtime: Pick<AgentRuntimeData, 'userDataPath'>,
    jobId: ID
  ): Promise<boolean> {
    return Boolean(await readCancellationRequest(runtime, jobId))
  }

  static async clearCancellation(
    runtime: Pick<AgentRuntimeData, 'userDataPath'>,
    jobId: ID
  ): Promise<void> {
    await rm(markerPath(runtime, jobId), { force: true })
  }

  static async getProgress(
    data: AppData,
    runtime: Pick<AgentRuntimeData, 'userDataPath'>,
    jobId: ID,
    nowMs = Date.now()
  ): Promise<AgentPipelineProgress> {
    const job = data.chapterGenerationJobs.find((item) => item.id === jobId)
    if (!job) throw new Error(`Pipeline job not found: ${jobId}`)
    const steps = data.chapterGenerationSteps.filter((step) => step.jobId === jobId)
    const run = data.agentRuns.find((item) => item.createdJobIds.includes(jobId)) ?? null
    const current =
      steps.find((step) => step.type === job.currentStep) ??
      steps.find((step) => step.status === 'running') ??
      null
    const cancellation = await readCancellationRequest(runtime, jobId)
    const completedStepCount = steps.filter((step) => step.status === 'completed').length
    const skippedStepCount = steps.filter((step) => step.status === 'skipped').length
    const finishedStepCount = completedStepCount + skippedStepCount
    const startedAt = current?.status === 'running' ? current.updatedAt : null
    const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN
    return {
      jobId,
      agentRunId: run?.id ?? null,
      projectId: job.projectId,
      targetChapterOrder: job.targetChapterOrder,
      jobStatus: job.status,
      agentRunStatus: run?.status ?? null,
      currentStep: job.currentStep,
      currentStepStatus: current?.status ?? null,
      currentStepStartedAt: startedAt,
      currentStepElapsedMs: Number.isFinite(startedMs) ? Math.max(0, nowMs - startedMs) : null,
      completedStepCount,
      failedStepCount: steps.filter((step) => step.status === 'failed').length,
      skippedStepCount,
      totalStepCount: steps.length,
      progressPercent: steps.length ? Math.round((finishedStepCount / steps.length) * 100) : 0,
      recoverableFromStep: recoverableStep(data, jobId),
      cancellationRequested: Boolean(cancellation),
      cancellationRequestedAt: cancellation?.requestedAt ?? null,
      cancellationReason: cancellation?.reason || null,
      lastUpdatedAt: job.updatedAt
    }
  }
}
