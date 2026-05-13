import { getUserFriendlyError } from '../../shared/errorUtils'

export class AiHttpError extends Error {
  readonly status: number
  readonly responseText: string

  constructor(status: number, responseText: string) {
    super(`HTTP ${status} ${responseText}`)
    this.name = 'AiHttpError'
    this.status = status
    this.responseText = responseText
  }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const record = error as Record<string, unknown>
  if (typeof record.code === 'string') return record.code
  const cause = record.cause
  if (cause && typeof cause === 'object') {
    const causeCode = (cause as Record<string, unknown>).code
    if (typeof causeCode === 'string') return causeCode
  }
  return ''
}

function httpStatus(error: unknown): number | null {
  if (error instanceof AiHttpError) return error.status
  if (!error || typeof error !== 'object') return null
  const status = (error as Record<string, unknown>).status
  return typeof status === 'number' ? status : null
}

export function isRetryableAiError(error: unknown): boolean {
  const status = httpStatus(error)
  if (status !== null) {
    if ([400, 401, 403, 413].includes(status)) return false
    return status === 429 || status === 502 || status === 503 || status === 504
  }

  const code = errorCode(error).toUpperCase()
  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code)) return true
  if (['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)) return true

  const message = getUserFriendlyError(error).toLowerCase()
  return /network|fetch failed|timeout|timed out|econnreset|etimedout|enotfound|eai_again|socket hang up|temporar/.test(message)
}

export function describeAiRetryError(error: unknown): string {
  if (error instanceof AiHttpError) return `HTTP ${error.status}`
  const code = errorCode(error)
  if (code) return code
  return getUserFriendlyError(error).slice(0, 120)
}
