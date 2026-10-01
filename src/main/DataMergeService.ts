import { normalizeAppData, sanitizeAppDataForPersistence } from '../shared/defaults'
import type {
  AppData,
  DataMergeConflict,
  DataMergeOperation,
  DataMergePreview,
  ID
} from '../shared/types'
import { StorageRevisionConflictError } from '../storage/StorageService'
import {
  backupBeforeMerge,
  backupFileForOverwrite,
  loadDataFileSnapshot,
  saveDataFile
} from './dataMerge/dataFileStorage'
import {
  ALL_ENTITY_COLLECTIONS,
  collectionName,
  DEPENDENT_COLLECTIONS,
  PROJECT_SCOPED_COLLECTIONS
} from './dataMerge/mergeCollections'
import {
  asEntity,
  clone,
  deepEqualEntity,
  equalForMerge,
  getId,
  getProjectId,
  indexById,
  makeImportedId,
  pushConflict,
  pushOperation,
  shouldSkipDuplicateSource,
  summarizeDataFile
} from './dataMerge/mergeEntityUtils'
import {
  createIdRemaps,
  rememberId,
  remapReferencesDeep,
  type AppDataArrayKey,
  type Entity,
  type IdRemaps
} from './dataMerge/referenceRemapping'

export { backupBeforeMerge, backupFileForOverwrite, deepEqualEntity }

type ImportedEntities = WeakSet<object>

function remapImportedEntityReferences(data: AppData, remaps: IdRemaps, importedEntities: ImportedEntities) {
  for (const collection of ALL_ENTITY_COLLECTIONS) {
    const items = getCollection(data, collection).map((item) => {
      if (!item || typeof item !== 'object' || !importedEntities.has(item)) return item
      return remapReferencesDeep(item, remaps)
    })
    setCollection(data, collection, items)
  }
}

function getCollection(data: AppData, collection: AppDataArrayKey): unknown[] {
  return data[collection] as unknown[]
}

function setCollection(data: AppData, collection: AppDataArrayKey, items: unknown[]) {
  ;(data as unknown as Record<AppDataArrayKey, unknown[]>)[collection] = items
}

function hasProjectRemap(remaps: IdRemaps, projectId: ID | null): boolean {
  if (!projectId) return false
  const mapped = remaps.projects?.get(projectId)
  return Boolean(mapped && mapped !== projectId)
}

function mergeProjects(
  sourceData: AppData,
  mergedData: AppData,
  remaps: IdRemaps,
  importedEntities: ImportedEntities,
  operations: DataMergeOperation[],
  conflicts: DataMergeConflict[]
) {
  const targetProjects = indexById(mergedData.projects)
  const seenSource = new Map<string, unknown>()
  for (const sourceProject of sourceData.projects) {
    if (shouldSkipDuplicateSource('projects', sourceProject, seenSource, operations, conflicts)) continue
    const sourceId = sourceProject.id
    const targetProject = targetProjects.get(sourceId)
    if (!targetProject) {
      const copiedProject = clone(sourceProject)
      mergedData.projects.push(copiedProject)
      importedEntities.add(copiedProject)
      rememberId(remaps, 'projects', sourceId, sourceId)
      pushOperation(operations, 'projects', 'add_from_source', sourceProject, '目标文件中不存在该项目，已追加。')
      continue
    }
    if (deepEqualEntity(sourceProject, targetProject)) {
      rememberId(remaps, 'projects', sourceId, sourceId)
      pushOperation(operations, 'projects', 'dedupe_same_id', sourceProject, '同 ID 且内容一致，保留目标文件中的项目。')
      continue
    }
    const newId = makeImportedId(sourceId, 'project')
    const copiedProject = {
      ...clone(sourceProject),
      id: newId,
      name: `${sourceProject.name || '导入项目'}（导入副本）`,
      updatedAt: new Date().toISOString()
    }
    mergedData.projects.push(copiedProject)
    importedEntities.add(copiedProject)
    rememberId(remaps, 'projects', sourceId, newId)
    pushOperation(
      operations,
      'projects',
      'rename_source_id',
      copiedProject,
      '项目 ID 与目标文件冲突且内容不同，已将源项目导入为副本并重映射其关联数据。'
    )
  }
}

function mergeProjectScopedCollection(
  collection: AppDataArrayKey,
  sourceData: AppData,
  mergedData: AppData,
  remaps: IdRemaps,
  importedEntities: ImportedEntities,
  operations: DataMergeOperation[],
  conflicts: DataMergeConflict[]
) {
  const sourceItems = getCollection(sourceData, collection)
  const mergedItems = getCollection(mergedData, collection)
  const targetById = indexById(mergedItems)
  const targetByProjectId = new Map<string, unknown>()
  const seenSource = new Map<string, unknown>()
  for (const item of mergedItems) {
    const projectId = getProjectId(item)
    if (projectId && !getId(item)) targetByProjectId.set(projectId, item)
  }

  for (const sourceItem of sourceItems) {
    if (shouldSkipDuplicateSource(collection, sourceItem, seenSource, operations, conflicts)) continue
    const sourceEntity = asEntity(sourceItem)
    const sourceId = getId(sourceEntity)
    const sourceProjectId = getProjectId(sourceEntity)
    const projectWasRemapped = hasProjectRemap(remaps, sourceProjectId)
    const targetItem = sourceId ? targetById.get(sourceId) : sourceProjectId ? targetByProjectId.get(sourceProjectId) : undefined

    if (targetItem && !projectWasRemapped && equalForMerge(collection, sourceItem, targetItem)) {
      if (sourceId) rememberId(remaps, collection, sourceId, sourceId)
      pushOperation(operations, collection, 'dedupe_same_id', sourceItem, '同 ID 且内容一致，保留目标文件中的记录。')
      continue
    }

    if (targetItem && !projectWasRemapped) {
      pushOperation(operations, collection, 'conflict', sourceItem, '同 ID 或同项目唯一记录内容不同，未自动覆盖目标数据。')
      pushConflict(
        conflicts,
        collection,
        sourceItem,
        targetItem,
        '同 ID 或同项目唯一记录内容不同，保守策略不会静默覆盖目标数据。',
        'unresolved'
      )
      continue
    }

    const remappedEntity = remapReferencesDeep(clone(sourceEntity), remaps) as Entity
    if (sourceId) {
      const needsNewId = projectWasRemapped || targetById.has(sourceId)
      const newId = needsNewId ? makeImportedId(sourceId, String(collection)) : sourceId
      remappedEntity.id = newId
      rememberId(remaps, collection, sourceId, newId)
      pushOperation(
        operations,
        collection,
        needsNewId ? 'rename_source_id' : 'add_from_source',
        remappedEntity,
        needsNewId ? '关联项目被导入为副本，记录 ID 已同步重映射。' : '目标文件中不存在该记录，已追加。'
      )
    } else {
      pushOperation(operations, collection, 'add_from_source', remappedEntity, '目标文件中不存在该项目级记录，已追加。')
    }
    mergedItems.push(remappedEntity)
    importedEntities.add(remappedEntity)
  }
  setCollection(mergedData, collection, mergedItems)
}

function mergeDependentCollection(
  collection: AppDataArrayKey,
  sourceData: AppData,
  mergedData: AppData,
  remaps: IdRemaps,
  importedEntities: ImportedEntities,
  operations: DataMergeOperation[],
  conflicts: DataMergeConflict[]
) {
  const sourceItems = getCollection(sourceData, collection)
  const mergedItems = getCollection(mergedData, collection)
  const targetById = indexById(mergedItems)
  const seenSource = new Map<string, unknown>()

  for (const sourceItem of sourceItems) {
    if (shouldSkipDuplicateSource(collection, sourceItem, seenSource, operations, conflicts)) continue
    const sourceId = getId(sourceItem)
    if (!sourceId) continue
    const targetItem = targetById.get(sourceId)
    if (targetItem && equalForMerge(collection, sourceItem, targetItem)) {
      rememberId(remaps, collection, sourceId, sourceId)
      pushOperation(operations, collection, 'dedupe_same_id', sourceItem, '同 ID 且内容一致，保留目标文件中的记录。')
      continue
    }

    const remappedEntity = remapReferencesDeep(clone(sourceItem), remaps) as Entity
    const referencesWereRemapped = !deepEqualEntity(sourceItem, remappedEntity)
    if (targetItem && !referencesWereRemapped) {
      pushOperation(operations, collection, 'conflict', sourceItem, '同 ID 内容不同且无法判断安全归属，未自动合并。')
      pushConflict(conflicts, collection, sourceItem, targetItem, '同 ID 内容不同且无法安全重映射。', 'unresolved')
      continue
    }
    const newId = targetItem || referencesWereRemapped ? makeImportedId(sourceId, String(collection)) : sourceId
    remappedEntity.id = newId
    rememberId(remaps, collection, sourceId, newId)
    mergedItems.push(remappedEntity)
    importedEntities.add(remappedEntity)
    pushOperation(
      operations,
      collection,
      newId === sourceId ? 'add_from_source' : 'rename_source_id',
      remappedEntity,
      newId === sourceId ? '目标文件中不存在该记录，已追加。' : '上游引用被重映射，记录 ID 已同步重映射。'
    )
  }
  setCollection(mergedData, collection, mergedItems)
}

function findDuplicateIds(data: AppData): string[] {
  const duplicates: string[] = []
  for (const collection of ALL_ENTITY_COLLECTIONS) {
    const seen = new Set<ID>()
    for (const item of getCollection(data, collection)) {
      const id = getId(item)
      if (!id) continue
      if (seen.has(id)) duplicates.push(`${collectionName(collection)}:${id}`)
      seen.add(id)
    }
  }
  return duplicates
}

export function mergeAppData(
  sourceInput: AppData,
  targetInput: AppData,
  paths: { sourcePath: string; targetPath: string }
): { mergedData: AppData; preview: DataMergePreview } {
  const sourceData = normalizeAppData(sourceInput)
  const targetData = normalizeAppData(targetInput)
  const mergedData = normalizeAppData(clone(targetData))
  const operations: DataMergeOperation[] = []
  const conflicts: DataMergeConflict[] = []
  const warnings: string[] = ['合并采用保守追加策略：目标文件为主，源文件不会静默覆盖目标数据。']
  const remaps = createIdRemaps()
  const importedEntities: ImportedEntities = new WeakSet<object>()

  mergeProjects(sourceData, mergedData, remaps, importedEntities, operations, conflicts)
  for (const collection of PROJECT_SCOPED_COLLECTIONS) {
    mergeProjectScopedCollection(collection, sourceData, mergedData, remaps, importedEntities, operations, conflicts)
  }
  for (const collection of DEPENDENT_COLLECTIONS) {
    mergeDependentCollection(collection, sourceData, mergedData, remaps, importedEntities, operations, conflicts)
  }
  // Some payloads embed full entities (for example commit bundles and prompt snapshots),
  // while their target IDs may only be discovered later in the first merge pass.
  remapImportedEntityReferences(mergedData, remaps, importedEntities)
  if (remaps.unresolvedGenericReferences.size > 0) {
    const unresolvedIds = [...remaps.unresolvedGenericReferences]
    warnings.push(
      `源文件跨集合复用了 ID，且存在无法按字段类型判定的引用：${unresolvedIds.slice(0, 5).join('、')}${unresolvedIds.length > 5 ? '…' : ''}`
    )
    conflicts.push({
      collection: '全局引用',
      entityId: unresolvedIds[0],
      reason: '跨集合重复 ID 出现在 affectedIds、sourceId 等混合引用中，自动重映射可能连接到错误实体。',
      resolution: 'unresolved'
    })
  }

  const sanitizedMergedData = sanitizeAppDataForPersistence(mergedData)
  const duplicates = findDuplicateIds(sanitizedMergedData)
  if (duplicates.length > 0) {
    warnings.push(`合并结果检测到重复 ID：${duplicates.slice(0, 5).join('、')}${duplicates.length > 5 ? '…' : ''}`)
    conflicts.push({
      collection: '全局',
      entityId: duplicates[0],
      reason: '合并结果存在重复 ID，已阻止自动写入。',
      resolution: 'unresolved'
    })
  }

  const preview: DataMergePreview = {
    sourcePath: paths.sourcePath,
    targetPath: paths.targetPath,
    sourceSummary: summarizeDataFile(sourceData),
    targetSummary: summarizeDataFile(targetData),
    mergedSummary: summarizeDataFile(sanitizedMergedData),
    operations,
    conflicts,
    warnings,
    canAutoMerge: conflicts.length === 0
  }

  return { mergedData: sanitizedMergedData, preview }
}

export async function createMigrationMergePreview(sourcePath: string, targetPath: string): Promise<DataMergePreview> {
  const sourceSnapshot = await loadDataFileSnapshot(sourcePath)
  const targetSnapshot = await loadDataFileSnapshot(targetPath)
  return mergeAppData(sourceSnapshot.data, targetSnapshot.data, { sourcePath, targetPath }).preview
}

export async function confirmMigrationMerge(
  sourcePath: string,
  targetPath: string,
  expectedSourceRevision?: string
) {
  const sourceSnapshot = await loadDataFileSnapshot(sourcePath)
  if (expectedSourceRevision !== undefined && sourceSnapshot.revision !== expectedSourceRevision) {
    throw new StorageRevisionConflictError()
  }
  const targetSnapshot = await loadDataFileSnapshot(targetPath)
  const { mergedData, preview } = mergeAppData(sourceSnapshot.data, targetSnapshot.data, { sourcePath, targetPath })
  if (!preview.canAutoMerge) {
    throw new Error('合并预览存在未解决冲突，已阻止自动合并。')
  }
  const backups = await backupBeforeMerge(sourcePath, targetPath)
  const latestSourceSnapshot = await loadDataFileSnapshot(sourcePath)
  if (latestSourceSnapshot.revision !== sourceSnapshot.revision) {
    throw new StorageRevisionConflictError()
  }
  const savedSnapshot = await saveDataFile(targetPath, mergedData, targetSnapshot.revision)
  return {
    data: savedSnapshot.data,
    revision: savedSnapshot.revision,
    preview,
    ...backups
  }
}
