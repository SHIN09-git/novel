import type { ChatCompletionRequest, ChatCompletionResult } from '../../shared/ipc/ipcTypes'
import type { ApiProvider, AppSettings } from '../../shared/types'
import { describeNetworkError, redactSensitiveText } from '../../shared/errorUtils'
import { LogService } from '../LogService'
import type { TokenBucketRateLimiter } from '../RateLimiter'
import type { SecureCredentialService } from '../SecureCredentialService'
import { retryWithBackoff } from '../utils/retry'
import { AIHttpClient } from './AIHttpClient'
import { describeAiRetryError, isRetryableAiError } from './aiErrors'

export interface ValidationResult {
  ok: boolean
  error?: string
}

export interface IAIService {
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult>
  validateSettings(settings: AppSettings): ValidationResult
  estimateTokens(messages: ChatCompletionRequest['messages']): number
}

interface ChatRequestBody {
  model: string
  messages: ChatCompletionRequest['messages']
  temperature: number
  max_tokens: number
  response_format?: { type: 'json_object' }
}

function sanitizeAiErrorText(text: string, apiKey?: string): string {
  return redactSensitiveText(text, [apiKey]).slice(0, 800)
}

async function parseAiResponseContent(response: Response): Promise<ChatCompletionResult> {
  const payload = (await response.json()) as {
    choices?: Array<{ finish_reason?: string; finishReason?: string; message?: { content?: string } }>
  }
  const choice = payload.choices?.[0]
  const content = choice?.message?.content
  if (!content) return { ok: false as const, error: 'AI 返回为空。' }
  return { ok: true as const, content, finishReason: choice?.finish_reason ?? choice?.finishReason }
}

// Main-process AI transport boundary. The historical AIService export is kept
// for IPC compatibility; new main-process code should treat this as the
// transport service that owns credentials, rate limits, retries, and HTTP.
export class AIService implements IAIService {
  constructor(
    private readonly credentialService: SecureCredentialService,
    private readonly rateLimiters: Partial<Record<ApiProvider, TokenBucketRateLimiter>>,
    private readonly httpClient = new AIHttpClient()
  ) {}

  validateSettings(settings: AppSettings): ValidationResult {
    if (!settings.baseUrl.trim()) return { ok: false, error: 'AI Base URL 不能为空。' }
    if (!settings.modelName.trim()) return { ok: false, error: 'AI 模型名称不能为空。' }
    if (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 2) {
      return { ok: false, error: 'AI temperature 必须在 0 到 2 之间。' }
    }
    if (!Number.isFinite(settings.maxTokens) || settings.maxTokens < 1) {
      return { ok: false, error: 'AI max tokens 必须大于 0。' }
    }
    return { ok: true }
  }

  estimateTokens(messages: ChatCompletionRequest['messages']): number {
    const chars = messages.reduce((sum, message) => sum + message.content.length + message.role.length, 0)
    return Math.max(1, Math.ceil(chars / 2))
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const { settings, messages } = request
    let apiKey = ''

    try {
      const settingsValidation = this.validateSettings(settings)
      if (!settingsValidation.ok) return { ok: false as const, error: settingsValidation.error }

      apiKey = settings.apiProvider === 'local' ? '' : await this.credentialService.getApiKey()
      LogService.info(`AI request: provider=${settings.apiProvider}, model=${settings.modelName}, messages=${messages.length}`)

      if (settings.apiProvider !== 'local' && !apiKey.trim()) {
        return { ok: false as const, error: '未配置 API Key，已跳过远程 AI 调用。' }
      }

      const limiter = settings.apiProvider === 'local' ? null : this.rateLimiters[settings.apiProvider]
      if (limiter) {
        await limiter.acquire()
      }

      const maxRetries = settings.retryEnabled === false ? 0 : settings.maxRetries
      return await retryWithBackoff(
        () => this.performChatCompletion(settings, messages, apiKey),
        {
          maxRetries,
          shouldRetry: isRetryableAiError,
          onRetry: (attempt, error, delayMs) => {
            LogService.warn(
              `AI request retry scheduled: provider=${settings.apiProvider}, model=${settings.modelName}, attempt=${attempt}, delayMs=${delayMs}, reason=${sanitizeAiErrorText(describeAiRetryError(error), apiKey)}`
            )
          }
        }
      )
    } catch (error) {
      const message = describeNetworkError(error)
      return { ok: false as const, error: `AI 请求失败：${sanitizeAiErrorText(message, apiKey)}` }
    }
  }

  private async performChatCompletion(
    settings: AppSettings,
    messages: ChatCompletionRequest['messages'],
    apiKey: string
  ): Promise<ChatCompletionResult> {
    const url = `${settings.baseUrl}/chat/completions`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (apiKey.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`
    }

    const requestBody: ChatRequestBody = {
      model: settings.modelName,
      messages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      response_format: { type: 'json_object' }
    }
    const { response_format: _responseFormat, ...fallbackBody } = requestBody

    const response = await this.httpClient.postWithFallback(url, requestBody, headers, fallbackBody)
    return parseAiResponseContent(response)
  }
}

export { AIService as AITransportService }
