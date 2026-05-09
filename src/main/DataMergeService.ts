import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { normalizeAppData, sanitizeAppDataForPersistence } from '../shared/defaults'
import type {
  AppData,
  DataFileSummary,
  DataMergeConflict,
  DataMergeOperation,
  DataMergePreview,
  ID
} from '../shared/types'
import { JsonStorageService } from '../storage/JsonStorageService'

type AppDataArrayKey = {
  [K in keyof AppData]: AppData[K] extends Array<unknown> ? K : never
}[keyof AppData]

type Entity = Record<string, unknown>
type IdMap = Map<ID, ID>
type IdRemaps = Partial<Record<AppDataArrayKey, IdMap>> & { any: IdMap }

const PROJECT_SCOPED_COLLECTIONS: AppDataArrayKey[] = [
  'storyBibles',
  'chapters',
  'characters',
  'characterStateLogs',
  'characterStateFacts',
  'characterStateTransactions',
  'characterStateChangeCandidates',
  'foreshadowings',
  'timelineEvents',
  'stageSummaries',
  'promptVersions',
  'promptContextSnapshots',
  'chapterContinuityBridges',
  'chapterGenerationJobs',
  'generatedChapterDrafts',
  'memoryUpdateCandidates',
  'consistencyReviewReports',
  'contextBudgetProfiles',
  'qualityGateReports',
  'generationRunTraces',
  'redundancyReports',
  'revisionCandidates',
  'revisionSessions',
  'chapterVersions'
]

const DEPENDENT_COLLECTIONS: AppDataArrayKey[] = ['chapterGenerationSteps', 'revisionRequests', 'revisionVersions']

const ALL_ENTITY_COLLECTIONS: AppDataArrayKey[] = [
  'projects',
  ...PROJECT_SCOPED_COLLECTIONS,
  ...DEPENDENT_COLLECTIONS
]

const COLLECTION_LABELS: Record<string, string> = {
  projects: '项目',
  storyBibles: '小说圣经',
  chapters: '章节',
  characters: '角色',
  characterStateLogs: '角色状态日志',
  foreshadowings: '伏笔',
  timelineEvents: '时间线事件',
  stageSummaries: '阶段摘要',
  promptVersions: 'Prompt 版本',
  promptContextSnapshots: '上下文快照',
  chapterContinuityBridges: '章节衔接',
  chapterGenerationJobs: '生产流水线任务',
  chapterGenerationSteps: '生产流水线步骤',
  generatedChapterDrafts: '章节草稿',
  memoryUpdateCandidates: '记忆更新候选',
  consistencyReviewReports: '一致性报告',
  contextBudgetProfiles: '上下文预算',
  qualityGateReports: '质量门禁报告',
  generationRunTraces: '生成追踪',
  redundancyReports: '冗余报告',
  revisionCandidates: '修订候选',
  revisionSessions: '修订会话',
  revisionRequests: '修订请求',
  revisionVersions: '修订版本',
  chapterVersions: '章节历史版本'
}

let generatedIdCounter = 0

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function asEntity(value: unknown): Entity {
  return value && typeof value === 'object' ? (value as Entity) : {}
}

function getId(value: unknown): ID | null {
  const id = asEntity(value).id
  return typeof id === 'string' && id ? id : null
}

function getProjectId(value: unknown): ID | null {
  const projectId = asEntity(value).projectId
  return typeof projectId === 'string' && projectId ? projectId : null
}

function getTitle(value: unknown): string | undefined {
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

function makeImportedId(oldId: ID, collection: string): ID {
  generatedIdCounter += 1
  return `${oldId}-import-${Date.now().toString(36)}-${collection}-${generatedIdCounter}`
}

function getRemap(remaps: IdRemaps, collection: AppDataArrayKey): IdMap {
  remaps[collection] ??= new Map<ID, ID>()
  return remaps[collection] as IdMap
}

function rememberId(remaps: IdRemaps, collection: AppDataArrayKey, oldId: ID, newId: ID) {
  getRemap(remaps, collection).set(oldId, newId)
  remaps.any.set(oldId, newId)
}

function remapId(remaps: IdRemaps, id: unknown, collection?: AppDataArrayKey): unknown {
  if (typeof id !== 'string') return id
  if (collection && remaps[collection]?.has(id)) return remaps[collection]?.get(id)
  return remaps.any.get(id) ?? id
}

function isIdKey(key: string): boolean {
  return key === 'id' || key.endsWith('Id')
}

function isIdsKey(key: string): boolean {
  return key.endsWith('Ids')
}

function remapReferencesDeep(value: unknown, remaps: IdRemaps, key = ''): unknown {
  if (Array.isArray(value)) {
    if (isIdsKey(key)) return value.map((entry) => remapId(remaps, entry))
    return value.map((entry) => remapReferencesDeep(entry, remaps))
  }
  if (!value || typeof value !== 'object') {
    return isIdKey(key) ? remapId(remaps, value) : value
  }
  return Object.entries(value as Entity).reduce<Entity>((acc, [entryKey, entryValue]) => {
    if (entryKey === 'id') {
      acc[entryKey] = entryValue
    } else if (entryKey === 'projectId') {
      acc[entryKey] = remapId(remaps, entryValue, 'projects')
    } else if (isIdKey(entryKey)) {
      acc[entryKey] = remapId(remaps, entryValue)
    } else if (isIdsKey(entryKey) && Array.isArray(entryValue)) {
      acc[entryKey] = entryValue.map((entry) => remapId(remaps, entry))
    } else {
      acc[entryKey] = remapReferencesDeep(entryValue, remaps, entryKey)
    }
    return acc
  }, {})
}

function summarizeDataFile(data: AppData): DataFileSummary {
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

function collectionName(collection: AppDataArrayKey): string {
  return COLLECTION_LABELS[collection] ?? String(collection)
}

function indexById(items: unknown[]): Map<ID, unknown> {
  const map = new Map<ID, unknown>()
  for (const item of items) {
    const id = getId(item)
    if (id) map.set(id, item)
  }
  return map
}

function pushOperation(
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

function pushConflict(
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
  operations: DataMergeOperation[]
) {
  const targetProjects = indexById(mergedData.projects)
  for (const sourceProject of sourceData.projects) {
    const sourceId = sourceProject.id
    const targetProject = targetProjects.get(sourceId)
    if (!targetProject) {
      mergedData.projects.push(clone(sourceProject))
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
  operations: DataMergeOperation[],
  conflicts: DataMergeConflict[]
) {
  const sourceItems = getCollection(sourceData, collection)
  const mergedItems = getCollection(mergedData, collection)
  const targetById = indexById(mergedItems)
  const targetByProjectId = new Map<string, unknown>()
  for (const item of mergedItems) {
    const projectId = getProjectId(item)
    if (projectId && !getId(item)) targetByProjectId.set(projectId, item)
  }

  for (const sourceItem of sourceItems) {
    const sourceEntity = asEntity(sourceItem)
    const sourceId = getId(sourceEntity)
    const sourceProjectId = getProjectId(sourceEntity)
    const projectWasRemapped = hasProjectRemap(remaps, sourceProjectId)
    const targetItem = sourceId ? targetById.get(sourceId) : sourceProjectId ? targetByProjectId.get(sourceProjectId) : undefined

    if (targetItem && !projectWasRemapped && deepEqualEntity(sourceItem, targetItem)) {
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
  }
  setCollection(mergedData, collection, mergedItems)
}

function mergeDependentCollection(
  collection: AppDataArrayKey,
  sourceData: AppData,
  mergedData: AppData,
  remaps: IdRemaps,
  operations: DataMergeOperation[],
  conflicts: DataMergeConflict[]
) {
  const sourceItems = getCollection(sourceData, collection)
  const mergedItems = getCollection(mergedData, collection)
  const targetById = indexById(mergedItems)

  for (const sourceItem of sourceItems) {
    const sourceId = getId(sourceItem)
    if (!sourceId) continue
    const targetItem = targetById.get(sourceId)
    if (targetItem && deepEqualEntity(sourceItem, targetItem)) {
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
  const remaps: IdRemaps = { any: new Map<ID, ID>() }

  mergeProjects(sourceData, mergedData, remaps, operations)
  for (const collection of PROJECT_SCOPED_COLLECTIONS) {
    mergeProjectScopedCollection(collection, sourceData, mergedData, remaps, operations, conflicts)
  }
  for (const collection of DEPENDENT_COLLECTIONS) {
    mergeDependentCollection(collection, sourceData, mergedData, remaps, operations, conflicts)
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

async function loadDataFile(path: string): Promise<AppData> {
  const raw = await readFile(path, 'utf-8')
  const parsed = JSON.parse(raw) as AppData
  return normalizeAppData(parsed)
}

export async function createMigrationMergePreview(sourcePath: string, targetPath: string): Promise<DataMergePreview> {
  const sourceData = await loadDataFile(sourcePath)
  const targetData = await loadDataFile(targetPath)
  return mergeAppData(sourceData, targetData, { sourcePath, targetPath }).preview
}

function timestampForFile(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
}

async function assertFileExists(path: string) {
  const fileStat = await stat(path)
  if (!fileStat.isFile()) throw new Error(`路径不是数据文件：${path}`)
}

export async function backupFileForOverwrite(path: string): Promise<string> {
  await assertFileExists(path)
  const backupPath = `${path}.target.before-overwrite.${timestampForFile()}.json.bak`
  await mkdir(dirname(backupPath), { recursive: true })
  await copyFile(path, backupPath)
  return backupPath
}

export async function backupBeforeMerge(
  sourcePath: string,
  targetPath: string
): Promise<{ sourceBackupPath: string; targetBackupPath: string }> {
  await assertFileExists(sourcePath)
  await assertFileExists(targetPath)
  const stamp = timestampForFile()
  const sourceBackupPath = `${sourcePath}.source.before-merge.${stamp}.json.bak`
  const targetBackupPath = `${targetPath}.target.before-merge.${stamp}.json.bak`
  await mkdir(dirname(sourceBackupPath), { recursive: true })
  await mkdir(dirname(targetBackupPath), { recursive: true })
  await copyFile(sourcePath, sourceBackupPath)
  await copyFile(targetPath, targetBackupPath)
  return { sourceBackupPath, targetBackupPath }
}

export async function confirmMigrationMerge(sourcePath: string, targetPath: string) {
  const sourceData = await loadDataFile(sourcePath)
  const targetData = await loadDataFile(targetPath)
  const { mergedData, preview } = mergeAppData(sourceData, targetData, { sourcePath, targetPath })
  if (!preview.canAutoMerge) {
    throw new Error('合并预览存在未解决冲突，已阻止自动合并。')
  }
  const backups = await backupBeforeMerge(sourcePath, targetPath)
  const storage = new JsonStorageService(targetPath)
  await storage.save(mergedData)
  const savedData = await storage.load()
  return {
    data: savedData,
    preview,
    ...backups
  }
}
