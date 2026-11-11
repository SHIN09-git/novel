import { AiHttpError, AiRequestCancelledError, AiRequestTimeoutError } from '../utils/aiErrors'
import { AiTransportFailure } from '../utils/connectionDiagnosis'
import { readAiResponseMetadata } from './AIResponseParser'
import type { AiUsageReceipts } from './AiUsageReceipts'

export interface AIHttpClientOptions {
  timeoutMs?: number
  fetch?: (url: string, options: RequestInit) => Promise<Response>
  transport?: 'node-fetch' | 'electron-net' | 'custom-fetch'
  beforeRequest?: () => Promise<void>
}

export interface AIHttpRequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
  onResponseFormatFallback?: () => void
  onResponseStarted?: () => void
  receipts?: AiUsageReceipts
}

async function readErrorBody(response: Response, receipts?: AiUsageReceipts): Promise<string> {
  const text = await response.text()
  if (receipts) {
    try { receipts.observe(readAiResponseMetadata(JSON.parse(text))) } catch { /* Not a JSON error envelope. */ }
  }
  return text
}

export class AIHttpClient {
  constructor(private readonly options: AIHttpClientOptions = {}) {}

  get transport(): NonNullable<AIHttpClientOptions['transport']> {
    return this.options.transport ?? (this.options.fetch ? 'custom-fetch' : 'node-fetch')
  }

  async post(url: string, body: unknown, headers: Record<string, string>, requestOptions: AIHttpRequestOptions = {}): Promise<Response> {
    if (requestOptions.signal?.aborted) throw new AiRequestCancelledError()
    const timeoutMs = Math.max(1_000, requestOptions.timeoutMs ?? this.options.timeoutMs ?? 300_000)
    const controller = new AbortController()
    let timedOut = false
    let dispatched = false
    let receivedHeaders = false
    const abortFromCaller = () => controller.abort()
    requestOptions.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      const send = this.options.fetch ?? fetch
      const target = new URL(url)
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
        throw new Error('AI Base URL 必须使用 HTTP 或 HTTPS，且不能包含登录凭据。')
      }
      // Validate headers and serialize locally before counting a dispatch.
      const init: RequestInit = {
        method: 'POST',
        headers: new Headers(headers),
        credentials: 'omit',
        redirect: 'error',
        body: JSON.stringify(body),
        signal: controller.signal
      }
      if (this.options.beforeRequest) await this.options.beforeRequest()
      if (requestOptions.signal?.aborted) throw new AiRequestCancelledError()
      if (timedOut) throw new AiRequestTimeoutError(timeoutMs)
      requestOptions.receipts?.start(target.origin)
      dispatched = true
      const response = await send(url, init)
      receivedHeaders = true
      requestOptions.receipts?.observe({ providerRequestId: response.headers.get('x-request-id') ??
        response.headers.get('request-id') ?? response.headers.get('x-ms-request-id') })
      requestOptions.onResponseStarted?.()
      // Buffer the response while the timeout and caller signal are still
      // active. Returning the original streaming body would clear our timer
      // after headers arrive and could leave response.json() hanging forever.
      const responseBody = await response.arrayBuffer()
      return new Response([204, 205, 304].includes(response.status) ? null : responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    } catch (error) {
      if (requestOptions.signal?.aborted) {
        if (dispatched) requestOptions.receipts?.observe({}, 'cancelled')
        throw new AiRequestCancelledError()
      }
      if (timedOut) throw new AiRequestTimeoutError(timeoutMs, receivedHeaders ? 'reading' : 'total')
      if (dispatched) throw new AiTransportFailure(error, receivedHeaders ? 'reading' : 'waiting_headers')
      throw error
    } finally {
      clearTimeout(timeout)
      requestOptions.signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  async postWithFallback(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    fallbackBody?: unknown,
    requestOptions: AIHttpRequestOptions = {}
  ): Promise<Response> {
    const deadline = Date.now() + Math.max(1_000, requestOptions.timeoutMs ?? this.options.timeoutMs ?? 300_000)
    const remaining = () => Math.max(1, deadline - Date.now())
    const response = await this.post(url, body, headers, { ...requestOptions, timeoutMs: remaining() })
    if (response.ok) return response

    const errorText = await readErrorBody(response, requestOptions.receipts)
    if ([400, 422].includes(response.status) && fallbackBody && /response_format|json_object|unsupported/i.test(errorText)) {
      requestOptions.onResponseFormatFallback?.()
      const fallbackResponse = await this.post(url, fallbackBody, headers, { ...requestOptions, timeoutMs: remaining() })
      if (fallbackResponse.ok) return fallbackResponse
      throw new AiHttpError(fallbackResponse.status, await readErrorBody(fallbackResponse, requestOptions.receipts))
    }

    throw new AiHttpError(response.status, errorText)
  }
}
