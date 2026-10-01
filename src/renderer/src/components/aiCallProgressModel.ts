export const AI_CALL_PROGRESS_STAGES = [
  'waiting_response',
  'reading_response',
  'retry_wait',
  'format_retry',
  'completed',
  'failed',
  'cancelled'
] as const

export type AiCallProgressStage = typeof AI_CALL_PROGRESS_STAGES[number]

export interface AiCallProgressSnapshot {
  callId: string
  runId: string | null
  stage: AiCallProgressStage
  elapsedMs: number
  attempt: number
  retryDelayMs: number | null
  provider: string | null
  model: string
  startedAt: string | null
  lastActivityAt: string | null
}

export interface AiCallProgressCopy {
  label: string
  detail: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isStage(value: unknown): value is AiCallProgressStage {
  return typeof value === 'string' && AI_CALL_PROGRESS_STAGES.includes(value as AiCallProgressStage)
}

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function readOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Converts the preload response into the renderer's narrow display contract. */
export function parseAiCallProgressSnapshot(value: unknown): AiCallProgressSnapshot | null {
  if (!isRecord(value) || !isStage(value.stage)) return null

  const elapsedMs = readNonNegativeNumber(value.elapsedMs)
  const attempt = readNonNegativeNumber(value.attempt)
  const callId = readOptionalText(value.callId)
  const model = readOptionalText(value.model)
  if (elapsedMs === null || attempt === null || !Number.isInteger(attempt) || !callId || !model) return null

  return {
    callId,
    runId: readOptionalText(value.runId),
    stage: value.stage,
    elapsedMs,
    attempt,
    retryDelayMs: readNonNegativeNumber(value.retryDelayMs),
    provider: readOptionalText(value.provider),
    model,
    startedAt: readOptionalText(value.startedAt),
    lastActivityAt: readOptionalText(value.lastActivityAt)
  }
}

export function isAiCallProgressInScope(
  progress: AiCallProgressSnapshot,
  scope: { runId?: string | null; callId?: string | null }
) {
  return (!scope.runId || progress.runId === scope.runId) && (!scope.callId || progress.callId === scope.callId)
}

export function isTerminalAiCallProgressStage(stage: AiCallProgressStage) {
  return stage === 'completed' || stage === 'failed' || stage === 'cancelled'
}

/** A run can contain several calls; only an earlier terminal call is stale for a newer pipeline step. */
export function isAiCallProgressCurrentForStartedAt(progress: AiCallProgressSnapshot, currentStartedAt?: string | null) {
  if (!isTerminalAiCallProgressStage(progress.stage)) return true
  const progressStartedAt = progress.startedAt ? Date.parse(progress.startedAt) : Number.NaN
  const currentStartedAtMs = currentStartedAt ? Date.parse(currentStartedAt) : Number.NaN
  return !Number.isFinite(progressStartedAt) || !Number.isFinite(currentStartedAtMs) || progressStartedAt >= currentStartedAtMs
}

export function formatAiCallElapsed(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function formatAiCallRetryDelay(delayMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(delayMs / 1000))
  return totalSeconds >= 60
    ? `${Math.floor(totalSeconds / 60)} 分 ${totalSeconds % 60} 秒`
    : `${totalSeconds} 秒`
}

export function getAiCallProgressCopy(progress: AiCallProgressSnapshot | null): AiCallProgressCopy {
  if (!progress) {
    return { label: '调用状态暂不可用', detail: '仍在计时，等待服务提供状态。' }
  }

  switch (progress.stage) {
    case 'waiting_response':
      return { label: '等待模型响应', detail: '请求已发送，正在等待模型响应。' }
    case 'reading_response':
      return { label: '读取模型响应', detail: '正在读取模型返回内容。' }
    case 'retry_wait':
      return {
        label: '等待重试',
        detail: progress.retryDelayMs === null
          ? '正在等待下一次重试。'
          : `${progress.attempt > 0 ? `第 ${progress.attempt} 次尝试未完成，` : ''}${formatAiCallRetryDelay(progress.retryDelayMs)}后重试。`
      }
    case 'format_retry':
      return {
        label: '重新整理响应',
        detail: progress.attempt > 0
          ? `正在按格式要求重新处理返回内容（第 ${progress.attempt} 次尝试）。`
          : '正在按格式要求重新处理返回内容。'
      }
    case 'completed':
      return { label: '调用完成', detail: '模型响应已处理完成。' }
    case 'failed':
      return { label: '调用失败', detail: '本次模型调用未能完成。' }
    case 'cancelled':
      return { label: '已取消', detail: '本次模型调用已取消。' }
  }
}

export function getAiCallModelLabel(progress: AiCallProgressSnapshot | null) {
  if (!progress) return null
  return progress.provider ? `${progress.provider} / ${progress.model}` : progress.model
}
