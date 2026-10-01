import type { CandidateDecisionEffect, CandidateDecisionFieldValue } from '../types/candidateDecision'

const collections = new Set(['chapters', 'chapterContinuityBridges', 'characters', 'characterStateLogs',
  'characterStateFacts', 'characterStateTransactions', 'characterStateChangeCandidates', 'memoryUpdateCandidates',
  'foreshadowings', 'timelineEvents', 'stageSummaries', 'generationRunTraces'])
const immutable = new Set(['id', 'projectId', 'createdAt', 'updatedAt', 'body', 'settings', 'apiKey'])
const unsafe = new Set(['__proto__', 'prototype', 'constructor'])
const creatable = new Set(['chapterContinuityBridges', 'characterStateLogs', 'characterStateFacts',
  'characterStateTransactions', 'foreshadowings', 'timelineEvents', 'stageSummaries'])
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
function jsonValue(value: unknown, depth = 0): boolean {
  if (depth > 32) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => jsonValue(item, depth + 1))
  return record(value) && Object.entries(value).every(([key, item]) => !unsafe.has(key) && jsonValue(item, depth + 1))
}
function isFieldValue(value: unknown): value is CandidateDecisionFieldValue {
  return record(value) && typeof value.exists === 'boolean' &&
    (value.exists ? Object.hasOwn(value, 'value') && jsonValue(value.value) : !Object.hasOwn(value, 'value'))
}

/** Never retain a partial undo journal: missing fields would silently corrupt a compensation. */
export function normalizeCandidateDecisionEffects(input: unknown): CandidateDecisionEffect[] | undefined {
  if (!Array.isArray(input) || !input.length) return undefined
  const seen = new Set<string>()
  for (const item of input) {
    if (!record(item) || typeof item.collection !== 'string' || !collections.has(item.collection) ||
      typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || typeof item.created !== 'boolean' ||
      !Array.isArray(item.fields) || !item.fields.length) return undefined
    if (item.created && !creatable.has(item.collection)) return undefined
    if (item.ownership !== undefined && (!record(item.ownership) || Object.entries(item.ownership)
      .some(([key, value]) => !['characterId', 'chapterId', 'jobId'].includes(key) || typeof value !== 'string' || !value))) return undefined
    const key = `${item.collection}:${item.id}`
    if (seen.has(key)) return undefined
    seen.add(key)
    const paths: string[][] = []
    for (const field of item.fields) {
      if (!record(field) || !Array.isArray(field.path) || !field.path.length || field.path.length > 32 ||
        !field.path.every((part) => typeof part === 'string' && part && !unsafe.has(part)) || immutable.has(field.path[0]) ||
        !isFieldValue(field.before) || !isFieldValue(field.after)) return undefined
      if (item.created && (field.before.exists || !field.after.exists || field.path.length !== 1)) return undefined
      const candidatePath = field.path as string[]
      if (paths.some((path) => path.every((part, index) => candidatePath[index] === part) ||
        candidatePath.every((part, index) => path[index] === part))) return undefined
      paths.push(candidatePath)
    }
  }
  return structuredClone(input) as CandidateDecisionEffect[]
}
