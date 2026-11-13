import type { AgentRun, ID } from '../shared/types'
import { normalizeAppData } from '../shared/defaults'
import { BOOK_PROGRESS_COLLECTIONS } from '../services/BookProgressService'
import { loadSqliteCollectionsReadonly } from '../storage/SqliteStorageService'
import { StorageRevisionConflictError } from '../storage/StorageService'
import { reloadAgentRuntimeData, saveAgentRuntimeData, type AgentRuntimeData } from './AgentRuntime'
import { checkPipelineRunTarget, isMultiChapterRun } from './agentBatchWriteback'

export async function reopenPipelineRuntime(runtime: AgentRuntimeData) {
  return reloadAgentRuntimeData(runtime)
}

export function batchModelRequestGuard(runtime: AgentRuntimeData, run: AgentRun, jobId: ID) {
  if (!isMultiChapterRun(run)) return undefined
  return async () => {
    if (runtime.source === 'sqlite' && runtime.storagePath) {
      // Only this executor advances its private revision, by CAS-saving steps for the current job.
      const head = await loadSqliteCollectionsReadonly(runtime.storagePath, [])
      if (head.revision === runtime.revision) return
      const fresh = await loadSqliteCollectionsReadonly(runtime.storagePath, [...BOOK_PROGRESS_COLLECTIONS, 'agentRuns'], run.projectId)
      checkPipelineRunTarget(normalizeAppData(fresh.data), run.id, jobId)
      throw new StorageRevisionConflictError()
    }
    const fresh = await reopenPipelineRuntime(runtime)
    checkPipelineRunTarget(fresh.data, run.id, jobId)
    // Even a legitimate concurrent edit invalidates the already prepared prompt and the executor's next save.
    if (fresh.revision !== runtime.revision) throw new StorageRevisionConflictError()
  }
}

export const BATCH_EXECUTION_PREFIX = 'agent-batch-execution-'

// Stop only the attempt that lost its checkpoint. Never adopt this fresh revision in the stale executor.
export async function pauseInterruptedBatchAttempt(runtime: AgentRuntimeData, runId: ID, jobId: ID, executionId: ID, reason: string) {
  const lastJob = runtime.data.chapterGenerationJobs.find(job => job.id === jobId)
  if (lastJob?.status !== 'running' || !runtime.data.agentRuns.find(run => run.id === runId)?.decisions.some(d => d.id === executionId)) return
  for (let attempt = 0; ; attempt++) {
    const fresh = await reopenPipelineRuntime(runtime)
    const { data } = fresh
    const run = data.agentRuns.find(r => r.id === runId)
    const job = data.chapterGenerationJobs.find(j => j.id === jobId)
    if (!run || !job || job.status !== 'running' || job.currentStep !== lastJob.currentStep || job.updatedAt !== lastJob.updatedAt) return
    const starts = run.decisions.filter(d => d.id.startsWith(BATCH_EXECUTION_PREFIX))
    if (starts.filter(d => d.jobId === jobId).at(-1)?.id !== executionId) return
    const step = data.chapterGenerationSteps.find(s => s.jobId === jobId && s.type === job.currentStep)
    const lastStep = runtime.data.chapterGenerationSteps.find(s => s.jobId === jobId && s.type === lastJob.currentStep)
    if (step?.id !== lastStep?.id || step?.status !== lastStep?.status || step?.updatedAt !== lastStep?.updatedAt) return
    const updatedAt = new Date().toISOString()
    const next = { ...data,
      chapterGenerationJobs: data.chapterGenerationJobs.map(j => j.id === jobId
        ? { ...j, status: 'paused' as const, errorMessage: reason, updatedAt } : j),
      chapterGenerationSteps: step?.status !== 'running' ? data.chapterGenerationSteps : data.chapterGenerationSteps.map(s =>
        s.id === step.id ? { ...s, status: 'failed' as const, errorMessage: reason, updatedAt } : s),
      agentRuns: starts.at(-1)?.id !== executionId || run.status !== 'running' ? data.agentRuns : data.agentRuns.map(r =>
        r.id === runId ? { ...r, status: 'paused' as const, summary: reason, updatedAt } : r)
    }
    try {
      await saveAgentRuntimeData(next, fresh)
      return
    } catch (error) {
      if (attempt !== 0 || !(error instanceof StorageRevisionConflictError)) throw error
    }
  }
}

// Preserve optional methods on injected providers (their presence selects the pipeline's fallback path).
export function guardModelCalls<T extends object>(
  service: T, check?: () => Promise<void>, methods?: readonly (keyof T)[]
): T {
  if (!check) return service
  return new Proxy(service, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== 'function' || (methods && !methods.includes(key as keyof T))) return value
      return async (...args: unknown[]) => {
        await check()
        return Reflect.apply(value, target, args)
      }
    }
  })
}
