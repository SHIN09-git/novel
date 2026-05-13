import { AiHttpError } from './aiErrors'

export interface AIHttpClientOptions {
  timeoutMs?: number
}

export class AIHttpClient {
  constructor(private readonly options: AIHttpClientOptions = {}) {}

  async post(url: string, body: unknown, headers: Record<string, string>): Promise<Response> {
    const timeoutMs = Math.max(1_000, this.options.timeoutMs ?? 120_000)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  async postWithFallback(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    fallbackBody?: unknown
  ): Promise<Response> {
    const response = await this.post(url, body, headers)
    if (response.ok) return response

    const errorText = await response.text()
    if (fallbackBody && /response_format|json_object|unsupported/i.test(errorText)) {
      const fallbackResponse = await this.post(url, fallbackBody, headers)
      if (fallbackResponse.ok) return fallbackResponse
      throw new AiHttpError(fallbackResponse.status, await fallbackResponse.text())
    }

    throw new AiHttpError(response.status, errorText)
  }
}
