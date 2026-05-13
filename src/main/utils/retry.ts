import { LogService } from '../LogService'

export interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  shouldRetry?: (error: unknown) => boolean
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeRetries(value: number | undefined): number {
  if (!Number.isFinite(value)) return 3
  return Math.max(0, Math.min(10, Math.floor(value ?? 3)))
}

function backoffDelay(attempt: number, initialDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, initialDelayMs * 2 ** Math.max(0, attempt - 1))
  const jitter = 0.75 + Math.random() * 0.5
  return Math.min(maxDelayMs, Math.max(0, Math.round(exponential * jitter)))
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = normalizeRetries(options.maxRetries)
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? 1000)
  const maxDelayMs = Math.max(initialDelayMs, options.maxDelayMs ?? 32_000)
  const shouldRetry = options.shouldRetry ?? (() => true)

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      const retryAttempt = attempt + 1
      if (attempt >= maxRetries || !shouldRetry(error)) throw error

      const waitMs = backoffDelay(retryAttempt, initialDelayMs, maxDelayMs)
      if (options.onRetry) {
        options.onRetry(retryAttempt, error, waitMs)
      } else {
        LogService.warn(`Retrying operation after transient failure. attempt=${retryAttempt}, delayMs=${waitMs}`)
      }
      await delay(waitMs)
    }
  }

  throw new Error('Retry loop exhausted unexpectedly.')
}
