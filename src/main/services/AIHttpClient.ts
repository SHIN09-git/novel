import { AiHttpError, AiRequestCancelledError, AiRequestTimeoutError } from '../utils/aiErrors'

export interface AIHttpClientOptions {
  timeoutMs?: number
}

export interface AIHttpRequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
  onResponseFormatFallback?: () => void
  onResponseStarted?: () => void
}

export class AIHttpClient {
  constructor(private readonly options: AIHttpClientOptions = {}) {}

  async post(url: string, body: unknown, headers: Record<string, string>, requestOptions: AIHttpRequestOptions = {}): Promise<Response> {
    if (requestOptions.signal?.aborted) throw new AiRequestCancelledError()
    const timeoutMs = Math.max(1_000, requestOptions.timeoutMs ?? this.options.timeoutMs ?? 300_000)
    const controller = new AbortController()
    let timedOut = false
    const abortFromCaller = () => controller.abort()
    requestOptions.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      })
      requestOptions.onResponseStarted?.()
      // Buffer the response while the timeout and caller signal are still
      // active. Returning the original streaming body would clear our timer
      // after headers arrive and could leave response.json() hanging forever.
      const responseBody = await response.arrayBuffer()
      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    } catch (error) {
      if (requestOptions.signal?.aborted) throw new AiRequestCancelledError()
      if (timedOut) throw new AiRequestTimeoutError(timeoutMs)
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

    const errorText = await response.text()
    if (fallbackBody && /response_format|json_object|unsupported/i.test(errorText)) {
      requestOptions.onResponseFormatFallback?.()
      const fallbackResponse = await this.post(url, fallbackBody, headers, { ...requestOptions, timeoutMs: remaining() })
      if (fallbackResponse.ok) return fallbackResponse
      throw new AiHttpError(fallbackResponse.status, await fallbackResponse.text())
    }

    throw new AiHttpError(response.status, errorText)
  }
}
