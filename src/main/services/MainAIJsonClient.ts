import type { ChatCompletionRequest } from '../../shared/ipc/ipcTypes'
import type { AIResult, AppSettings } from '../../shared/types'
import { normalizeAIError, parseWithFallback } from '../../services/AIJsonParser'
import { fallbackResult, isTruncatedFinishReason } from '../../services/ai/AIResponseNormalizer'
import { formatSchemaValidationError, type AISchemaValidator } from '../../services/ai/AISchemaValidator'
import type { AIJsonClient } from '../../services/ai/AIJsonClient'
import type { IAIService } from './AIService'

export class MainAIJsonClient implements AIJsonClient {
  constructor(
    private readonly settings: AppSettings,
    private readonly aiTransport: IAIService
  ) {}

  private hasApiConfig(): boolean {
    return this.settings.apiProvider === 'local' || this.settings.hasApiKey
  }

  async requestJson<T>(
    systemPrompt: string,
    userPrompt: string,
    normalize: (value: unknown) => T,
    fallback: T,
    parseFallback?: (rawText: string) => T | null,
    validate?: AISchemaValidator
  ): Promise<AIResult<T>> {
    if (!this.hasApiConfig()) return fallbackResult(fallback)

    try {
      const request: ChatCompletionRequest = {
        settings: this.settings,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      }
      const response = await this.aiTransport.chatCompletion(request)
      if (!response.ok || !response.content) {
        return { ok: false, usedAI: true, data: null, error: response.error || 'AI 调用失败。' }
      }
      if (isTruncatedFinishReason(response.finishReason)) {
        return {
          ok: false,
          usedAI: true,
          data: null,
          rawText: response.content,
          finishReason: response.finishReason,
          error: 'AI 输出被 max tokens 截断。请提高 Max Tokens，或降低章节预计字数后重试。'
        }
      }
      try {
        const parsed = parseWithFallback(response.content, 'AI 返回内容')
        if (!parsed.ok) throw new Error(parsed.parseError)
        const validation = validate?.(parsed.data)
        if (validation && !validation.ok) throw new Error(formatSchemaValidationError(validation))
        return {
          ok: true,
          usedAI: true,
          data: normalize(parsed.data),
          rawText: response.content,
          finishReason: response.finishReason
        }
      } catch (error) {
        const fallbackData = parseFallback?.(response.content)
        if (fallbackData) {
          return {
            ok: true,
            usedAI: true,
            data: fallbackData,
            rawText: response.content,
            finishReason: response.finishReason,
            parseError: normalizeAIError(error),
            error: 'AI 没有返回严格 JSON，已使用可恢复解析结果。'
          }
        }
        return {
          ok: false,
          usedAI: true,
          data: null,
          rawText: response.content,
          finishReason: response.finishReason,
          parseError: normalizeAIError(error),
          error: normalizeAIError(error)
        }
      }
    } catch (error) {
      return { ok: false, usedAI: true, data: null, error: normalizeAIError(error) }
    }
  }
}
