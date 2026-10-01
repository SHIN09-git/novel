import type { AIResult } from '../../shared/types'
import type { AISchemaValidator } from './AISchemaValidator'

export interface AIRequestControl {
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
