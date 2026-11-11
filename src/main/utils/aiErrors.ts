import { aiNetworkFailure, readQuotaCode } from './connectionDiagnosis'

export class AiHttpError extends Error {
  readonly status: number
  readonly quotaCode?: string

  constructor(status: number, responseText: string) {
    super(`HTTP ${status}`)
    this.name = 'AiHttpError'
    this.status = status
    this.quotaCode = readQuotaCode(status, responseText)
  }
}

export class AiRequestCancelledError extends Error {
  readonly code = 'AI_REQUEST_CANCELLED'

  constructor() {
    super('用户已取消 AI 请求。可从最后成功步骤继续重试。')
    this.name = 'AiRequestCancelledError'
  }
}

export class AiRequestTimeoutError extends Error {
  readonly code = 'AI_REQUEST_TIMEOUT'

  constructor(readonly timeoutMs: number, readonly phase: 'reading' | 'total' = 'total') {
    super(`AI 请求超过 ${Math.ceil(timeoutMs / 1000)} 秒硬超时，已自动终止。可切换模型或从当前步骤重试。`)
    this.name = 'AiRequestTimeoutError'
  }
}

function httpStatus(error: unknown): number | null {
  if (error instanceof AiHttpError) return error.status
  if (!error || typeof error !== 'object') return null
  const status = (error as Record<string, unknown>).status
  return typeof status === 'number' ? status : null
}

export function isRetryableAiError(error: unknown): boolean {
  if (error instanceof AiRequestCancelledError) return false
  if (error instanceof AiRequestTimeoutError) return true
  const status = httpStatus(error)
  if (status !== null) {
    if ([400, 401, 403, 413].includes(status)) return false
    if (error instanceof AiHttpError && error.quotaCode) return false
    return status === 429 || status === 502 || status === 503 || status === 504
  }

  const failure = aiNetworkFailure(error)
  if (!failure) return false
  if (failure.kind === 'read_failure' && !failure.code) return false
  if (failure.kind === 'connect_timeout' || failure.kind === 'read_timeout' || !failure.code) return true
  return [
    'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_SOCKET',
    'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_REFUSED', 'ERR_TIMED_OUT',
    'ERR_NAME_NOT_RESOLVED', 'ERR_NAME_RESOLUTION_FAILED', 'ERR_DNS_TIMED_OUT'
  ].includes(failure.code)
}

export function describeAiRetryError(error: unknown): string {
  if (error instanceof AiRequestCancelledError) return error.code
  if (error instanceof AiRequestTimeoutError) return `${error.code}:${error.timeoutMs}`
  const status = httpStatus(error)
  if (status !== null) return `HTTP ${status}`
  return aiNetworkFailure(error)?.code ?? '网络请求失败'
}
