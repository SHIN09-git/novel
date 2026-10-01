import { randomUUID } from 'node:crypto'
import type {
  AppData,
  DataFileSummary,
  DataMergeConflict,
  DataMergeOperation,
  ID
} from '../../shared/types'
import { collectionName } from './mergeCollections'
import type { AppDataArrayKey, Entity } from './referenceRemapping'

export function clone<T>(value: T): T {
  return structuredClone(value)
}

export function asEntity(value: unknown): Entity {
  return value && typeof value === 'object' ? (value as Entity) : {}
}

export function getId(value: unknown): ID | null {
  const id = asEntity(value).id
  return typeof id === 'string' && id ? id : null
}

export function getProjectId(value: unknown): ID | null {
  const projectId = asEntity(value).projectId
  return typeof projectId === 'string' && projectId ? projectId : null
}

export function getTitle(value: unknown): string | undefined {
  const entity = asEntity(value)
  const title = entity.title ?? entity.name ?? entity.note ?? entity.source
  if (typeof title === 'string' && title.trim()) return title
  if (typeof entity.order === 'number') return `第 ${entity.order} 章`
  return getId(value) ?? undefined
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortDeep((value as Record<string, unknown>)[key])
      return acc
    }, {})
}

export function deepEqualEntity(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b))
}

function isGeneratedEmptyHardCanonPack(value: unknown): boolean {
  const entity = asEntity(value)
  const id = getId(entity)
  const projectId = getProjectId(entity)
  return (
    Boolean(id && projectId && id === `hard-canon-pack-${projectId}`) &&
    Array.isArray(entity.items) &&
    entity.items.length === 0 &&
    (entity.sourceType === undefined || entity.sourceType === null)
  )
}

export function equalForMerge(
  collection: AppDataArrayKey,
  source: unknown,
  target: unknown
): boolean {
  if (deepEqualEntity(source, target)) return true
  if (collection !== 'hardCanonPacks') return false
  if (!isGeneratedEmptyHardCanonPack(source) || !isGeneratedEmptyHardCanonPack(target)) return false
  const sourceComparable = { ...asEntity(source), createdAt: null, updatedAt: null }
  const targetComparable = { ...asEntity(target), createdAt: null, updatedAt: null }
  return deepEqualEntity(sourceComparable, targetComparable)
}

export function makeImportedId(oldId: ID, collection: string): ID {
  return `${oldId}-import-${collection}-${randomUUID()}`
}

export function summarizeDataFile(data: AppData): DataFileSummary {
  const updatedAt =
    data.projects
      .map((project) => project.updatedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null
  return {
    projectCount: data.projects.length,
    chapterCount: data.chapters.length,
    characterCount: data.characters.length,
    foreshadowingCount: data.foreshadowings.length,
    memoryCandidateCount: data.memoryUpdateCandidates.length,
    promptVersionCount: data.promptVersions.length,
    pipelineJobCount: data.chapterGenerationJobs.length,
    updatedAt
  }
}

export function indexById(items: unknown[]): Map<ID, unknown> {
  const map = new Map<ID, unknown>()
  for (const item of items) {
    const id = getId(item)
    if (id) map.set(id, item)
  }
  return map
}

export function pushOperation(
  operations: DataMergeOperation[],
  collection: AppDataArrayKey,
  action: DataMergeOperation['action'],
  entity: unknown,
  reason: string
) {
  operations.push({
    collection: collectionName(collection),
    action,
    entityId: getId(entity) ?? getProjectId(entity) ?? undefined,
    entityTitle: getTitle(entity),
    reason
  })
}

export function pushConflict(
  conflicts: DataMergeConflict[],
  collection: AppDataArrayKey,
  source: unknown,
  target: unknown,
  reason: string,
  resolution: DataMergeConflict['resolution']
) {
  conflicts.push({
    collection: collectionName(collection),
    entityId: getId(source) ?? getProjectId(source) ?? 'unknown',
    sourceTitle: getTitle(source),
    targetTitle: getTitle(target),
    reason,
    resolution
  })
}

export function shouldSkipDuplicateSource(
  collection: AppDataArrayKey,
  source: unknown,
  seen: Map<string, unknown>,
  operations: DataMergeOperation[],
  conflicts: DataMergeConflict[]
): boolean {
  const sourceId = getId(source)
  const sourceProjectId = getProjectId(source)
  const identity = sourceId ? `id:${sourceId}` : sourceProjectId ? `project:${sourceProjectId}` : null
  if (!identity) return false

  const previous = seen.get(identity)
  if (!previous) {
    seen.set(identity, source)
    return false
  }

  if (equalForMerge(collection, source, previous)) {
    pushOperation(operations, collection, 'dedupe_same_id', source, '源文件内存在重复记录，内容一致，已只导入一份。')
    return true
  }

  pushOperation(operations, collection, 'conflict', source, '源文件内存在相同标识但内容不同的记录，无法安全判断应导入哪一份。')
  pushConflict(
    conflicts,
    collection,
    source,
    previous,
    '源文件自身包含相同 ID（或同项目唯一记录）但内容不同的数据。',
    'unresolved'
  )
  return true
}
