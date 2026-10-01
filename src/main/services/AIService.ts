import { randomUUID } from 'node:crypto'
import type {
  AiCallTelemetry,
  AiTokenUsage,
  ChatCompletionRequest,
  ChatCompletionResult,
  CodexCliStatusResult
} from '../../shared/ipc/ipcTypes'
import type { AiCallProgress, AiCallProgressStage, ApiProvider, AppSettings } from '../../shared/types'
import { describeNetworkError, redactSensitiveText } from '../../shared/errorUtils'
import type { TokenBucketRateLimiter } from '../RateLimiter'
import { retryWithBackoff } from '../utils/retry'
import { AiRequestCancelledError, AiRequestTimeoutError, describeAiRetryError, isRetryableAiError } from '../utils/aiErrors'
import { AIHttpClient } from './AIHttpClient'
import { AiCallProgressStore } from './AiCallProgressStore'
import { parseAiResponse } from './AIResponseParser'
import { CodexCliService } from './CodexCliService'

export interface ValidationResult {
  ok: boolean
  error?: string
}

export interface IAIService {
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult>
  cancelRun(runId: string): boolean
  cancelCall(runId: string, callId: string): boolean
  getCallProgress(query?: { runId?: string; callId?: string }): AiCallProgress | null
  listCallProgress(runId: string): AiCallProgress[]
  getCodexCliStatus(command?: string): Promise<CodexCliStatusResult>
  validateSettings(settings: AppSettings): ValidationResult
  estimateTokens(messages: ChatCompletionRequest['messages']): number
}

export interface AiCredentialReader {
  getApiKey(): Promise<string>
}

export interface AIServiceLogger {
  info(message: string): void
  warn(message: string): void
}

export interface AIServiceOptions {
  httpClient?: AIHttpClient
  codexCliService?: CodexCliService
  logger?: AIServiceLogger
  progressStore?: AiCallProgressStore
}

const consoleLogger: AIServiceLogger = {
  info: (message) => console.info(message),
  warn: (message) => console.warn(message)
}

interface ChatRequestBody {
  model: string
  messages: ChatCompletionRequest['messages']
  temperature: number
  max_tokens: number
  response_format?: { type: 'json_object' }
  thinking?: { type: 'disabled' }
}

interface ChatCompletionAttemptResult {
  result: ChatCompletionResult
  usage?: AiTokenUsage
}

function usesOfficialDeepSeekV4(settings: AppSettings): boolean {
  if (!/^deepseek-(?:flash|v4-(?:flash|flash-vision-exp|pro))$/i.test(settings.modelName.trim())) return false
  try {
    return new URL(settings.baseUrl).hostname.toLowerCase() === 'api.deepseek.com'
  } catch {
    return false
  }
}

function sanitizeAiErrorText(
  text: string,
  apiKey?: string,
  messages: ChatCompletionRequest['messages'] = []
): string {
  return redactSensitiveText(text, [apiKey, ...messages.map((message) => message.content)]).slice(0, 800)
}

function providerUsesApiKey(provider: ApiProvider): boolean {
  return provider === 'openai' || provider === 'compatible'
}

function mergeTokenUsage(...values: Array<AiTokenUsage | undefined>): AiTokenUsage | undefined {
  const keys: Array<keyof AiTokenUsage> = [
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'reasoningTokens',
    'cachedPromptTokens'
  ]
  const merged: AiTokenUsage = {}
  for (const key of keys) {
    const counts = values
      .map((usage) => usage?.[key])
      .filter((count): count is number => typeof count === 'number' && Number.isFinite(count))
    if (counts.length > 0) merged[key] = counts.reduce((sum, count) => sum + count, 0)
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function telemetryResult(
  result: ChatCompletionResult,
  input: {
    provider: ApiProvider
    model: string
    callId: string
    runId?: string
    startedAt: number
    attempts: number
    responseFormatFallback: boolean
    usage?: AiTokenUsage
    terminationCategory?: AiCallTelemetry['terminationCategory']
  }
): ChatCompletionResult {
  const finishReason = result.finishReason?.trim().slice(0, 120) || undefined
  return {
    ...result,
    telemetry: {
      callId: input.callId,
      runId: input.runId,
      provider: input.provider,
      model: input.model.trim().slice(0, 128) || 'unknown',
      durationMs: Math.max(0, Date.now() - input.startedAt),
      attempts: Math.max(0, input.attempts),
      responseFormatFallback: input.responseFormatFallback,
      finishReason,
      usage: input.usage,
      terminationCategory: input.terminationCategory ?? 'none'
    }
  }
}

// Main-process AI transport boundary. The historical AIService export is kept
// for IPC compatibility; new main-process code should treat this as the
// transport service that owns credentials, rate limits, retries, and HTTP.
export class AIService implements IAIService {
  private readonly activeRunControllers = new Map<string, Map<string, AbortController>>()
  private readonly httpClient: AIHttpClient
  private readonly callProgress: AiCallProgressStore
  private logger: AIServiceLogger
  private codexCliService: CodexCliService

  constructor(
    private readonly credentialService: AiCredentialReader,
    private readonly rateLimiters: Partial<Record<ApiProvider, TokenBucketRateLimiter>>,
    options: AIServiceOptions = {}
  ) {
    this.httpClient = options.httpClient ?? new AIHttpClient()
    this.callProgress = options.progressStore ?? new AiCallProgressStore()
    this.logger = options.logger ?? consoleLogger
    this.codexCliService = options.codexCliService ?? new CodexCliService(this.logger)
  }

  setLogger(logger: AIServiceLogger): void {
    this.logger = logger
    this.codexCliService = new CodexCliService(logger)
  }

  validateSettings(settings: AppSettings): ValidationResult {
    if (settings.apiProvider === 'codex_cli') {
      if (!(settings.codexCliPath || 'codex').trim()) return { ok: false, error: 'Codex CLI 路径不能为空。' }
    } else {
      if (!settings.baseUrl.trim()) return { ok: false, error: 'AI Base URL 不能为空。' }
      if (!settings.modelName.trim()) return { ok: false, error: 'AI 模型名称不能为空。' }
    }
    if (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 2) {
      return { ok: false, error: 'AI temperature 必须在 0 到 2 之间。' }
    }
    if (!Number.isFinite(settings.maxTokens) || settings.maxTokens < 1) {
      return { ok: false, error: 'AI max tokens 必须大于 0。' }
    }
    if (!Number.isFinite(settings.requestTimeoutMs) || settings.requestTimeoutMs < 5_000) {
      return { ok: false, error: 'AI 单次调用超时必须至少为 5 秒。' }
    }
    return { ok: true }
  }

  estimateTokens(messages: ChatCompletionRequest['messages']): number {
    const chars = messages.reduce((sum, message) => sum + message.content.length + message.role.length, 0)
    return Math.max(1, Math.ceil(chars / 2))
  }

  cancelRun(runId: string): boolean {
    const controllers = this.activeRunControllers.get(runId)
    if (!controllers?.size) return false
    this.activeRunControllers.delete(runId)
    for (const [callId, controller] of controllers) {
      this.callProgress.update(runId, callId, 'cancelled')
      controller.abort()
    }
    return true
  }

  cancelCall(runId: string, callId: string): boolean {
    const controllers = this.activeRunControllers.get(runId)
    const controller = controllers?.get(callId)
    if (!controllers || !controller) return false
    controllers.delete(callId)
    if (controllers.size === 0) this.activeRunControllers.delete(runId)
    this.callProgress.update(runId, callId, 'cancelled')
    controller.abort()
    return true
  }

  getCallProgress(query: { runId?: string; callId?: string } = {}): AiCallProgress | null {
    return this.callProgress.get(query)
  }

  listCallProgress(runId: string): AiCallProgress[] {
    return this.callProgress.listRun(runId)
  }

  private registerRunCall(runId: string, callId: string, controller: AbortController): void {
    if (!runId) return
    const controllers = this.activeRunControllers.get(runId) ?? new Map<string, AbortController>()
    if (controllers.has(callId)) {
      throw new Error(`AI callId ${callId} is already active in run ${runId}.`)
    }
    controllers.set(callId, controller)
    this.activeRunControllers.set(runId, controllers)
  }

  private unregisterRunCall(runId: string, callId: string, controller: AbortController): void {
    if (!runId) return
    const controllers = this.activeRunControllers.get(runId)
    if (controllers?.get(callId) !== controller) return
    controllers.delete(callId)
    if (controllers.size === 0) this.activeRunControllers.delete(runId)
  }

  getCodexCliStatus(command = 'codex'): Promise<CodexCliStatusResult> {
    return this.codexCliService.getStatus(command)
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const { settings, messages } = request
    const startedAt = Date.now()
    const runId = request.runId?.trim() || ''
    const clientCallId = request.clientCallId?.trim() || ''
    const callId = clientCallId || randomUUID()
    let apiKey = ''
    let attempts = 0
    let responseFormatFallback = false
    let progressStarted = false
    const runController = new AbortController()
    const timeoutMs = Math.max(5_000, settings.requestTimeoutMs || 300_000)
    const deadline = Date.now() + timeoutMs
    const requestedModel = settings.apiProvider === 'codex_cli'
      ? settings.codexCliModel?.trim() || 'cli-default'
      : settings.modelName
    const withTelemetry = (
      result: ChatCompletionResult,
      options: { usage?: AiTokenUsage; terminationCategory?: AiCallTelemetry['terminationCategory'] } = {}
    ) => {
      const stage: AiCallProgressStage = options.terminationCategory === 'cancelled'
          ? 'cancelled'
          : result.ok
            ? 'completed'
            : 'failed'
      if (progressStarted) {
        this.callProgress.update(runId || undefined, callId, stage, { attempt: attempts })
      }
      return telemetryResult(result, {
        provider: settings.apiProvider,
        model: requestedModel,
        callId,
        runId: runId || undefined,
        startedAt,
        attempts,
        responseFormatFallback,
        ...options
      })
    }

    try {
      if (request.clientCallId !== undefined && !clientCallId) {
        throw new Error('AI clientCallId must be a non-empty string.')
      }
      if (clientCallId && !runId) {
        throw new Error('AI clientCallId requires a runId namespace.')
      }
      if (runId.length > 200 || callId.length > 200) {
        throw new Error('AI runId and callId must be no more than 200 characters.')
      }
      this.registerRunCall(runId, callId, runController)
      this.callProgress.start({
        callId,
        runId: runId || undefined,
        provider: settings.apiProvider,
        model: requestedModel,
        startedAt
      })
      progressStarted = true
      const settingsValidation = this.validateSettings(settings)
      if (!settingsValidation.ok) return withTelemetry({ ok: false as const, error: settingsValidation.error })

      apiKey = providerUsesApiKey(settings.apiProvider) ? await this.credentialService.getApiKey() : ''
      if (runController.signal.aborted) throw new AiRequestCancelledError()
      const thinkingMode = usesOfficialDeepSeekV4(settings) ? 'disabled' : 'provider_default'
      this.logger.info(
        `AI request: provider=${settings.apiProvider}, model=${requestedModel}, messages=${messages.length}, thinking=${thinkingMode}`
      )

      if (providerUsesApiKey(settings.apiProvider) && !apiKey.trim()) {
        return withTelemetry({ ok: false as const, error: '未配置 API Key，已跳过远程 AI 调用。' })
      }

      if (settings.apiProvider === 'codex_cli') {
        attempts = 1
        this.callProgress.update(runId || undefined, callId, 'waiting_response', { attempt: attempts })
        const result = await this.codexCliService.chatCompletion({
          command: settings.codexCliPath || 'codex',
          model: settings.codexCliModel || '',
          messages,
          maxTokens: settings.maxTokens,
          signal: runController.signal,
          timeoutMs: Math.max(1_000, deadline - Date.now())
        })
        return withTelemetry(result, {
          terminationCategory: runController.signal.aborted ? 'cancelled' : undefined
        })
      }

      const limiter = providerUsesApiKey(settings.apiProvider) ? this.rateLimiters[settings.apiProvider] : null
      if (limiter) {
        await limiter.acquire()
      }
      if (runController.signal.aborted) throw new AiRequestCancelledError()

      const maxRetries = settings.retryEnabled === false ? 0 : settings.maxRetries
      const attemptResult = await retryWithBackoff(
        async () => {
          attempts += 1
          this.callProgress.update(runId || undefined, callId, 'waiting_response', { attempt: attempts })
          if (runController.signal.aborted) throw new AiRequestCancelledError()
          const remainingMs = deadline - Date.now()
          if (remainingMs <= 0) throw new AiRequestTimeoutError(timeoutMs)
          return this.performChatCompletion(
            settings,
            messages,
            apiKey,
            runController.signal,
            deadline,
            timeoutMs,
            () => {
              responseFormatFallback = true
              this.callProgress.update(runId || undefined, callId, 'format_retry', { attempt: attempts })
            },
            () => this.callProgress.update(
              runId || undefined,
              callId,
              'reading_response',
              { attempt: attempts }
            )
          )
        },
        {
          maxRetries,
          shouldRetry: (error) => Date.now() < deadline && isRetryableAiError(error),
          onRetry: (attempt, error, delayMs) => {
            this.callProgress.update(runId || undefined, callId, 'retry_wait', {
              attempt: attempts,
              retryDelayMs: delayMs
            })
            this.logger.warn(
              `AI request retry scheduled: provider=${settings.apiProvider}, model=${settings.modelName}, attempt=${attempt}, delayMs=${delayMs}, reason=${sanitizeAiErrorText(describeAiRetryError(error), apiKey, messages)}`
            )
          }
        }
      )
      return withTelemetry(attemptResult.result, { usage: attemptResult.usage })
    } catch (error) {
      // Nested compatibility requests receive the remaining deadline. Report
      // the configured run budget instead of a confusing value such as 259s.
      const normalizedError = error instanceof AiRequestTimeoutError
        ? new AiRequestTimeoutError(timeoutMs)
        : error
      const message = describeNetworkError(normalizedError)
      const terminationCategory: AiCallTelemetry['terminationCategory'] =
        normalizedError instanceof AiRequestTimeoutError
          ? 'timeout'
          : normalizedError instanceof AiRequestCancelledError || runController.signal.aborted
            ? 'cancelled'
            : 'none'
      return withTelemetry(
        { ok: false as const, error: `AI 请求失败：${sanitizeAiErrorText(message, apiKey, messages)}` },
        { terminationCategory }
      )
    } finally {
      this.unregisterRunCall(runId, callId, runController)
    }
  }

  private async performChatCompletion(
    settings: AppSettings,
    messages: ChatCompletionRequest['messages'],
    apiKey: string,
    signal: AbortSignal,
    deadline: number,
    totalTimeoutMs: number,
    markResponseFormatFallback: () => void,
    markResponseStarted: () => void
  ): Promise<ChatCompletionAttemptResult> {
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
      response_format: { type: 'json_object' },
      ...(usesOfficialDeepSeekV4(settings) ? { thinking: { type: 'disabled' as const } } : {})
    }
    const { response_format: _responseFormat, ...fallbackBody } = requestBody

    const remaining = () => {
      const value = deadline - Date.now()
      if (value <= 0) throw new AiRequestTimeoutError(totalTimeoutMs)
      return value
    }
    const response = await this.httpClient.postWithFallback(url, requestBody, headers, fallbackBody, {
      signal,
      timeoutMs: remaining(),
      onResponseFormatFallback: markResponseFormatFallback,
      onResponseStarted: markResponseStarted
    })
    const parsed = await parseAiResponse(response)
    if (!parsed.emptyContent || !parsed.canRetryWithoutResponseFormat) {
      return { result: parsed.result, usage: parsed.diagnostics.usage }
    }

    markResponseFormatFallback()
    this.logger.warn(
      `AI returned empty content; retrying without response_format. provider=${settings.apiProvider}, model=${settings.modelName}, finishReason=${parsed.diagnostics.finishReason || 'unknown'}, reasoningCharacters=${parsed.diagnostics.reasoningCharacters}, completionTokens=${parsed.diagnostics.completionTokens ?? 'unknown'}, contentType=${parsed.diagnostics.contentType}`
    )
    const fallbackResponse = await this.httpClient.postWithFallback(url, fallbackBody, headers, undefined, {
      signal,
      timeoutMs: remaining(),
      onResponseStarted: markResponseStarted
    })
    const fallbackParsed = await parseAiResponse(fallbackResponse)
    if (fallbackParsed.emptyContent) {
      this.logger.warn(
        `AI fallback also returned empty content. provider=${settings.apiProvider}, model=${settings.modelName}, finishReason=${fallbackParsed.diagnostics.finishReason || 'unknown'}, reasoningCharacters=${fallbackParsed.diagnostics.reasoningCharacters}, completionTokens=${fallbackParsed.diagnostics.completionTokens ?? 'unknown'}, contentType=${fallbackParsed.diagnostics.contentType}`
      )
    }
    return {
      result: fallbackParsed.result,
      usage: mergeTokenUsage(parsed.diagnostics.usage, fallbackParsed.diagnostics.usage)
    }
  }
}

export { AIService as AITransportService }
