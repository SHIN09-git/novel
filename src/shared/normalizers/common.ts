export function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function recordOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function objectOrEmpty(value: unknown): Record<string, unknown> {
  return recordOrEmpty(value)
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function normalizeRecordArray<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  return stringArrayValue(value).filter((item): item is T => allowed.includes(item as T))
}
