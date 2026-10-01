import type { AppData, CandidateDecisionEffect, CandidateDecisionFieldChange, CandidateDecisionFieldValue } from '../shared/types'
import { CANDIDATE_DECISION_COLLECTIONS, decisionRecords, stableDecisionJson, type DecisionRecord } from './candidateDecisionPrimitives'

const ignoredKeys = new Set(['id', 'projectId', 'createdAt', 'updatedAt'])
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const copyValue = (value: unknown): unknown => value === undefined ? undefined : structuredClone(value)

export function fieldValue(record: unknown, path: string[]): CandidateDecisionFieldValue {
  let value = record
  for (const key of path) {
    if (!isObject(value) || !Object.hasOwn(value, key) || value[key] === undefined) return { exists: false }
    value = value[key]
  }
  return { exists: true, value: copyValue(value) }
}

export const equalField = (a: CandidateDecisionFieldValue, b: CandidateDecisionFieldValue) => stableDecisionJson(a) === stableDecisionJson(b)

function fieldsChanged(before: unknown, after: unknown, path: string[] = []): CandidateDecisionFieldChange[] {
  const fields: CandidateDecisionFieldChange[] = []
  const keys = new Set([...Object.keys(isObject(before) ? before : {}), ...Object.keys(isObject(after) ? after : {})])
  for (const key of keys) {
    if (unsafeKeys.has(key) || (!path.length && ignoredKeys.has(key))) continue
    const oldValue = fieldValue(before, [key])
    const newValue = fieldValue(after, [key])
    if (equalField(oldValue, newValue)) continue
    if (isObject(oldValue.value) && isObject(newValue.value)) {
      fields.push(...fieldsChanged(oldValue.value, newValue.value, [...path, key]))
    } else fields.push({ path: [...path, key], before: oldValue, after: newValue })
  }
  return fields
}

export function captureCandidateDecisionEffects(before: AppData, after: AppData): CandidateDecisionEffect[] {
  return CANDIDATE_DECISION_COLLECTIONS.flatMap((collection) => {
    if (collection === 'projects' || collection === 'candidateDecisionReceipts') return []
    const old = new Map(decisionRecords(before, collection).map((item) => [item.id, item]))
    return decisionRecords(after, collection).flatMap((record) => {
      const previous = old.get(record.id)
      if (previous === record) return []
      const fields = fieldsChanged(previous, record)
      if (!fields.length) return []
      const ownership = Object.fromEntries(['characterId', 'chapterId', 'jobId']
        .filter((key) => typeof record[key] === 'string' && record[key]).map((key) => [key, record[key]]))
      return [{ collection, id: record.id, title: String(record.label ?? record.title ?? record.name ?? record.key ?? collection),
        created: !previous, ...(Object.keys(ownership).length ? { ownership } : {}), fields }]
    })
  })
}

export function restoreField(record: DecisionRecord, path: string[], before: CandidateDecisionFieldValue): void {
  let target: Record<string, unknown> = record
  for (const key of path.slice(0, -1)) {
    if (!isObject(target[key])) target[key] = {}
    target = target[key] as Record<string, unknown>
  }
  const key = path[path.length - 1]
  if (before.exists) target[key] = copyValue(before.value)
  else delete target[key]
}

export function undoEffectAction(effect: CandidateDecisionEffect) {
  if (effect.created && ['characterStateTransactions', 'characterStateLogs'].includes(effect.collection)) return 'retain_history' as const
  if (effect.created && effect.collection === 'characterStateFacts') return 'deactivate_created' as const
  return effect.created ? 'remove_created' as const : 'restore_fields' as const
}

export function traceMembershipRestore(effect: CandidateDecisionEffect, field: CandidateDecisionFieldChange,
  current: CandidateDecisionFieldValue): CandidateDecisionFieldValue | null {
  if (effect.collection !== 'generationRunTraces' || field.path.length !== 1 ||
    !['acceptedMemoryCandidateIds', 'rejectedMemoryCandidateIds'].includes(field.path[0]) || !Array.isArray(current.value)) return null
  const before = Array.isArray(field.before.value) ? field.before.value : []
  const after = Array.isArray(field.after.value) ? field.after.value : []
  const added = new Set(after.filter((id) => !before.includes(id)))
  const removed = before.filter((id) => !after.includes(id))
  return { exists: true, value: [...new Set([...current.value.filter((id) => !added.has(id)), ...removed])] }
}

export function addedCurrentFields(effect: CandidateDecisionEffect, current: DecisionRecord): CandidateDecisionFieldChange[] {
  if (!effect.created) return []
  const known = new Set(effect.fields.map((field) => field.path[0]))
  return Object.keys(current).filter((key) => !known.has(key) && !ignoredKeys.has(key) && !unsafeKeys.has(key))
    .map((key) => ({ path: [key], before: { exists: false }, after: { exists: false } }))
}
