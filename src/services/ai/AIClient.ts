import type { AIResult, AppSettings } from '../../shared/types'
import { normalizeAIError, parseWithFallback } from '../AIJsonParser'
import { fallbackResult, isTruncatedFinishReason } from './AIResponseNormalizer'
import { formatSchemaValidationError, type AISchemaValidator } from './AISchemaValidator'

export class AIClient {
  constructor(private readonly settings?: AppSettings) {}

  private hasApiConfig(): boolean {
    if (!this.settings) return false
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
    if (!this.settings || !this.hasApiConfig()) {
      return fallbackResult(fallback)
    }

    try {
      const response = await window.novelDirector.ai.chatCompletion({
        settings: this.settings,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })

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
          error: 'AI 输出被 max tokens 截断。请提高设置页 Max Tokens，或降低章节预计字数后重试。'
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
            error: 'AI 没有返回严格 JSON，已将原始正文保留为章节草稿。'
          }
        }
        const normalizedError = normalizeAIError(error)
        return {
          ok: false,
          usedAI: true,
          data: null,
          rawText: response.content,
          finishReason: response.finishReason,
          parseError: normalizedError,
          error: normalizedError.startsWith('AI 返回结构不符合') ? normalizedError : '解析失败，可手动复制原始返回。'
        }
      }
    } catch (error) {
      return { ok: false, usedAI: true, data: null, error: normalizeAIError(error) }
    }
  }
}
