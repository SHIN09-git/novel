export interface JsonParseSuccess<T = unknown> {
  ok: true
  data: T
  rawText: string
  source: 'direct' | 'code_fence' | 'object_slice' | 'array_slice'
}

export interface JsonParseFailure {
  ok: false
  rawText: string
  schemaName: string
  parseError: string
}

export type JsonParseResult<T = unknown> = JsonParseSuccess<T> | JsonParseFailure

export function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1]?.trim() ?? trimmed
}

function sliceBetween(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open)
  const end = text.lastIndexOf(close)
  if (start < 0 || end <= start) return null
  return text.slice(start, end + 1)
}

function parseCandidate<T>(rawText: string, candidate: string, source: JsonParseSuccess['source']): JsonParseSuccess<T> | null {
  try {
    return {
      ok: true,
      data: JSON.parse(candidate) as T,
      rawText,
      source
    }
  } catch {
    return null
  }
}

export function safeParseJson<T = unknown>(text: string, schemaName = 'AI JSON'): JsonParseResult<T> {
  const rawText = typeof text === 'string' ? text : String(text ?? '')
  const trimmed = rawText.trim()

  if (!trimmed) {
    return {
      ok: false,
      rawText,
      schemaName,
      parseError: `${schemaName} 为空，无法解析。`
    }
  }

  const direct = parseCandidate<T>(rawText, trimmed, 'direct')
  if (direct) return direct

  const fenced = stripCodeFences(trimmed)
  if (fenced !== trimmed) {
    const fencedResult = parseCandidate<T>(rawText, fenced, 'code_fence')
    if (fencedResult) return fencedResult
  }

  const objectSlice = sliceBetween(trimmed, '{', '}')
  if (objectSlice) {
    const objectResult = parseCandidate<T>(rawText, objectSlice, 'object_slice')
    if (objectResult) return objectResult
  }

  const arraySlice = sliceBetween(trimmed, '[', ']')
  if (arraySlice) {
    const arrayResult = parseCandidate<T>(rawText, arraySlice, 'array_slice')
    if (arrayResult) return arrayResult
  }

  return {
    ok: false,
    rawText,
    schemaName,
    parseError: `无法从 ${schemaName} 中解析 JSON。`
  }
}

export function parseWithFallback<T = unknown>(text: string, schemaName = 'AI JSON'): JsonParseResult<T> {
  return safeParseJson<T>(text, schemaName)
}

export function normalizeAIError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
