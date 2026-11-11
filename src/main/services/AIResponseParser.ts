import type { AiTokenUsage, ChatCompletionResult } from '../../shared/ipc/ipcTypes'
import { readTokenUsage } from '../../shared/tokenUsage'
import { isTruncatedFinishReason } from '../../services/ai/responseNormalizers/chapter'
import type { AiUsageReceipts, ReceiptMetadata } from './AiUsageReceipts'

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

function textFromPart(value: unknown, depth = 0, omitPart?: (part: JsonRecord) => boolean): string {
  if (depth > 3 || value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((item) => textFromPart(item, depth + 1, omitPart)).join('')

  const record = asRecord(value)
  if (omitPart?.(record)) return ''
  for (const key of ['text', 'output_text', 'value', 'content']) {
    const text = textFromPart(record[key], depth + 1, omitPart)
    if (text) return text
  }
  return ''
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function publicFinishReason(value: unknown): string {
  const reason = textFromPart(value).trim()
  if (/content[_-]?filter/i.test(reason)) return 'content_filter'
  if (isTruncatedFinishReason(reason) || /^(?:stop|end_turn|stop_sequence|eos|tool_calls|tool_use|function_call|refusal|error|cancelled)$/i.test(reason)) return reason
  return reason ? 'unknown' : ''
}

function normalizedUsage(value: unknown): AiTokenUsage | undefined {
  const usage = asRecord(value)
  const completionDetails = asRecord(usage.completion_tokens_details ?? usage.completionTokensDetails ?? usage.output_tokens_details)
  const promptDetails = asRecord(usage.prompt_tokens_details ?? usage.promptTokensDetails ?? usage.input_tokens_details)
  return readTokenUsage({
    promptTokens: usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens,
    completionTokens: usage.completion_tokens ?? usage.completionTokens ?? usage.output_tokens ?? usage.outputTokens,
    totalTokens: usage.total_tokens ?? usage.totalTokens,
    reasoningTokens: completionDetails.reasoning_tokens ?? completionDetails.reasoningTokens ?? usage.reasoning_output_tokens ?? usage.reasoningTokens,
    cachedPromptTokens: promptDetails.cached_tokens ?? promptDetails.cachedTokens ?? usage.cached_input_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cachedPromptTokens
  })
}

export function readAiResponseMetadata(payload: unknown): ReceiptMetadata {
  const root = asRecord(payload)
  const error = asRecord(root.error)
  return {
    usage: normalizedUsage(root.usage) ?? normalizedUsage(error.usage),
    providerRequestId: root.request_id ?? root.requestId ?? error.request_id ?? error.requestId
  }
}

function emptyResponseError(input: {
  finishReason: string
  reasoningCharacters: number
  refused: boolean
}): string {
  const suffix = input.finishReason ? `（finish_reason=${input.finishReason}）` : ''
  if (input.refused) {
    return `AI 拒绝返回正文${suffix}。请检查模型内容策略，或调整本章任务后重试。`
  }
  if (isTruncatedFinishReason(input.finishReason)) {
    return `AI 推理或输出已耗尽 Max Tokens，但正文为空${suffix}。请提高 Max Tokens、降低目标字数，或切换非推理型模型后重试。`
  }
  if (input.reasoningCharacters > 0) {
    return `AI 只返回了推理内容，没有返回正文${suffix}。请关闭模型思考模式，或切换非推理型模型后重试。`
  }
  return `AI 返回为空${suffix}。系统会尝试关闭 JSON response_format；若仍失败，请检查模型兼容性。`
}

export function parseAiResponsePayload(payload: unknown, metadata = readAiResponseMetadata(payload)): ParsedAiResponse {
  const root = asRecord(payload)
  const choices = Array.isArray(root.choices) ? root.choices : []
  const choice = asRecord(choices[0])
  const message = asRecord(choice.message)
  const rawContent = message.content ?? choice.text
  const finishReason = publicFinishReason(choice.finish_reason ?? choice.finishReason)
  const usage = metadata.usage
  const diagnostics = {
    finishReason,
    reasoningCharacters: textFromPart(message.reasoning_content ?? message.reasoningContent).length,
    refusalCharacters: textFromPart(message.refusal).length,
    completionTokens: usage?.completionTokens ?? null,
    contentType: valueType(rawContent),
    usage
  }
  let refused = diagnostics.refusalCharacters > 0 || /content[_-]?filter|^refusal$/i.test(finishReason)
  // Keep provider-marked private parts out of public text before multipart boundaries are lost.
  const content = textFromPart(rawContent, 0, (part) => {
    if (part.type === 'refusal') {
      refused = true
      diagnostics.refusalCharacters += textFromPart(part.refusal ?? part).length
      return true
    }
    if (typeof part.type === 'string' && /^(?:analysis|reasoning(?:_content|_text)?|(?:redacted_)?thinking)$/i.test(part.type)) {
      diagnostics.reasoningCharacters += textFromPart(part.thinking ?? part.reasoning_content ?? part).length
      return true
    }
    return false
  })

  if (!refused && content.trim()) {
    return {
      result: {
        ok: true,
        content,
        finishReason: finishReason || undefined
      },
      emptyContent: false,
      canRetryWithoutResponseFormat: false,
      diagnostics
    }
  }

  const truncated = isTruncatedFinishReason(finishReason)
  return {
    result: {
      ok: false,
      error: emptyResponseError({ finishReason, reasoningCharacters: diagnostics.reasoningCharacters, refused }),
      finishReason: finishReason || undefined
    },
    emptyContent: true,
    // Removing response_format helps truly silent JSON-mode responses. It does
    // not repair reasoning-only output and can consume the whole remaining
    // timeout while the model produces another long chain of thought.
    canRetryWithoutResponseFormat: diagnostics.reasoningCharacters === 0 && !truncated && !refused,
    diagnostics
  }
}

export async function parseAiResponse(response: Response, receipts?: AiUsageReceipts): Promise<ParsedAiResponse> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    // Native JSON syntax errors can quote the private response body.
    if (error instanceof SyntaxError) throw new Error('AI 服务返回的响应不是有效 JSON。')
    throw error
  }
  const metadata = readAiResponseMetadata(payload)
  const parsed = parseAiResponsePayload(payload, metadata)
  receipts?.observe(metadata, parsed.result.ok ? 'success' : 'failed')
  return parsed
}
