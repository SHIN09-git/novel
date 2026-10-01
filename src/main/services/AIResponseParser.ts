import type { AiTokenUsage, ChatCompletionResult } from '../../shared/ipc/ipcTypes'

type JsonRecord = Record<string, unknown>

export interface ParsedAiResponse {
  result: ChatCompletionResult
  emptyContent: boolean
  canRetryWithoutResponseFormat: boolean
  diagnostics: {
    finishReason: string
    reasoningCharacters: number
    refusalCharacters: number
    completionTokens: number | null
    contentType: string
    usage?: AiTokenUsage
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function textFromPart(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((item) => textFromPart(item, depth + 1)).join('')

  const record = asRecord(value)
  for (const key of ['text', 'output_text', 'value', 'content']) {
    const text = textFromPart(record[key], depth + 1)
    if (text) return text
  }
  return ''
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function finiteTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function normalizedUsage(value: unknown): AiTokenUsage | undefined {
  const usage = asRecord(value)
  const completionDetails = asRecord(usage.completion_tokens_details ?? usage.completionTokensDetails)
  const promptDetails = asRecord(usage.prompt_tokens_details ?? usage.promptTokensDetails)
  const normalized: AiTokenUsage = {
    promptTokens: finiteTokenCount(usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens),
    completionTokens: finiteTokenCount(
      usage.completion_tokens ?? usage.completionTokens ?? usage.output_tokens ?? usage.outputTokens
    ),
    totalTokens: finiteTokenCount(usage.total_tokens ?? usage.totalTokens),
    reasoningTokens: finiteTokenCount(completionDetails.reasoning_tokens ?? completionDetails.reasoningTokens),
    cachedPromptTokens: finiteTokenCount(promptDetails.cached_tokens ?? promptDetails.cachedTokens)
  }
  return Object.values(normalized).some((item) => item !== undefined) ? normalized : undefined
}

function emptyResponseError(input: {
  finishReason: string
  reasoningCharacters: number
  refusal: string
}): string {
  const suffix = input.finishReason ? `（finish_reason=${input.finishReason}）` : ''
  if (input.refusal) {
    return `AI 拒绝返回正文${suffix}。请检查模型内容策略，或调整本章任务后重试。`
  }
  if (/length|max[_-]?tokens|token_limit/i.test(input.finishReason)) {
    return `AI 推理或输出已耗尽 Max Tokens，但正文为空${suffix}。请提高 Max Tokens、降低目标字数，或切换非推理型模型后重试。`
  }
  if (input.reasoningCharacters > 0) {
    return `AI 只返回了推理内容，没有返回正文${suffix}。请关闭模型思考模式，或切换非推理型模型后重试。`
  }
  return `AI 返回为空${suffix}。系统会尝试关闭 JSON response_format；若仍失败，请检查模型兼容性。`
}

export function parseAiResponsePayload(payload: unknown): ParsedAiResponse {
  const root = asRecord(payload)
  const choices = Array.isArray(root.choices) ? root.choices : []
  const choice = asRecord(choices[0])
  const message = asRecord(choice.message)
  const rawContent = message.content ?? choice.text
  const content = textFromPart(rawContent)
  const finishReason = textFromPart(choice.finish_reason ?? choice.finishReason).trim()
  const reasoningContent = textFromPart(message.reasoning_content ?? message.reasoningContent)
  const refusal = textFromPart(message.refusal)
  const usage = normalizedUsage(root.usage)
  const completionTokens = usage?.completionTokens ?? null
  const trimmedContent = content.trim()

  if (trimmedContent) {
    return {
      result: {
        ok: true,
        content,
        finishReason: finishReason || undefined
      },
      emptyContent: false,
      canRetryWithoutResponseFormat: false,
      diagnostics: {
        finishReason,
        reasoningCharacters: reasoningContent.length,
        refusalCharacters: refusal.length,
        completionTokens,
        contentType: valueType(rawContent),
        usage
      }
    }
  }

  const truncated = /length|max[_-]?tokens|token_limit/i.test(finishReason)
  return {
    result: {
      ok: false,
      error: emptyResponseError({
        finishReason,
        reasoningCharacters: reasoningContent.length,
        refusal
      }),
      finishReason: finishReason || undefined
    },
    emptyContent: true,
    // Removing response_format helps truly silent JSON-mode responses. It does
    // not repair reasoning-only output and can consume the whole remaining
    // timeout while the model produces another long chain of thought.
    canRetryWithoutResponseFormat:
      reasoningContent.length === 0 && !truncated && !refusal && !/content[_-]?filter/i.test(finishReason),
    diagnostics: {
      finishReason,
      reasoningCharacters: reasoningContent.length,
      refusalCharacters: refusal.length,
      completionTokens,
      contentType: valueType(rawContent),
      usage
    }
  }
}

export async function parseAiResponse(response: Response): Promise<ParsedAiResponse> {
  return parseAiResponsePayload(await response.json())
}
