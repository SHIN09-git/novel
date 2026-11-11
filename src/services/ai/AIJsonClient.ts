import type { AIResult } from '../../shared/types'
import type { ChatCompletionResult } from '../../shared/ipc/ipcTypes'
import type { UsagePhase } from '../../shared/projectUsage'
import { getChapterDraftEnvelopeError } from '../ChapterDraftEnvelopeService'
import { ensureChapterDraft } from './responseNormalizers/chapter'
import { validateChapterDraftSchema, type AISchemaValidator } from './AISchemaValidator'

export function getRejectedChapterEnvelope(
  response: ChatCompletionResult,
  normalize: (value: unknown) => unknown,
  validate?: AISchemaValidator
): AIResult<never> | null {
  if (normalize !== ensureChapterDraft && validate !== validateChapterDraftSchema) return null
  const error = getChapterDraftEnvelopeError(response.content)
  return error ? {
    ok: false, usedAI: true, data: null, rawText: response.content,
    finishReason: response.finishReason, telemetry: response.telemetry, error, parseError: error
  } : null
}

export interface AIRequestControl {
  phase?: UsagePhase
  runId?: string
  clientCallId?: string
}

export interface AIJsonClient {
  requestJson<T>(
    systemPrompt: string,
    userPrompt: string,
    normalize: (value: unknown) => T,
    fallback: T,
    parseFallback?: (rawText: string) => T | null,
    validate?: AISchemaValidator,
    requestControl?: AIRequestControl
  ): Promise<AIResult<T>>
}
