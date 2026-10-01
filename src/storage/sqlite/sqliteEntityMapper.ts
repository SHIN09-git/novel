import { ALL_ENTITY_COLLECTIONS } from '../../shared/appDataCollections'
import type {
  AppDataArrayKey,
  SqliteEntityEntry,
  SqliteValue
} from './sqliteTypes'

export function arrayCollectionKeys(): AppDataArrayKey[] {
  return [...ALL_ENTITY_COLLECTIONS]
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function stringField(entity: Record<string, unknown>, key: string): string | null {
  const value = entity[key]
  return typeof value === 'string' && value.trim() ? value : null
}

export function numberField(entity: Record<string, unknown>, key: string): number | null {
  const value = entity[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function getEntityId(collection: AppDataArrayKey, entity: unknown, index: number): string {
  const record = asRecord(entity)
  const id = stringField(record, 'id')
  if (id) return id
  if (collection === 'storyBibles') {
    const projectId = stringField(record, 'projectId')
    if (projectId) return projectId
  }
  return `${collection}:${index}`
}

export function getTitle(entity: Record<string, unknown>): string | null {
  return stringField(entity, 'title')
    ?? stringField(entity, 'name')
    ?? stringField(entity, 'note')
    ?? stringField(entity, 'source')
}

export function parseJsonObject<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export function entityInsertValues(
  entry: SqliteEntityEntry,
  index: number,
  updatedAt: string
): SqliteValue[] {
  const entity = asRecord(entry.value)
  return [
    entry.collection,
    getEntityId(entry.collection, entry.value, index),
    stringField(entity, 'projectId'),
    stringField(entity, 'chapterId')
      ?? stringField(entity, 'targetChapterId')
      ?? stringField(entity, 'fromChapterId'),
    stringField(entity, 'jobId') ?? entry.indexJobId ?? null,
    stringField(entity, 'characterId'),
    numberField(entity, 'chapterOrder')
      ?? numberField(entity, 'targetChapterOrder')
      ?? numberField(entity, 'order'),
    getTitle(entity),
    stringField(entity, 'updatedAt') ?? stringField(entity, 'createdAt') ?? updatedAt,
    JSON.stringify(entry.value)
  ]
}
