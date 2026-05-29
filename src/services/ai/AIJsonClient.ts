import type { AIResult } from '../../shared/types'
import type { AISchemaValidator } from './AISchemaValidator'

export interface AIJsonClient {
  requestJson<T>(
    systemPrompt: string,
    userPrompt: string,
    normalize: (value: unknown) => T,
    fallback: T,
    parseFallback?: (rawText: string) => T | null,
    validate?: AISchemaValidator
  ): Promise<AIResult<T>>
}
