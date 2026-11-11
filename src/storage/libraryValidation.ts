import { ALL_ENTITY_COLLECTIONS, PROJECT_SCOPED_COLLECTIONS, type AppDataArrayKey } from '../shared/appDataCollections'
import { EMPTY_APP_DATA, normalizeAppData } from '../shared/defaults'
import type { AppData } from '../shared/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim()
}

const projectScoped = new Set<AppDataArrayKey>(PROJECT_SCOPED_COLLECTIONS)

export function libraryEntityId(collection: AppDataArrayKey, entity: unknown): string | undefined {
  if (isRecord(entity) && (!projectScoped.has(collection) || nonemptyString(entity.projectId))) {
    if (nonemptyString(entity.id)) return entity.id
    if (collection === 'storyBibles' && nonemptyString(entity.projectId)) return entity.projectId
    // The old snapshot writer deliberately keyed id-less prompt versions by collection position.
    if (collection === 'promptVersions' && entity.id === undefined) return undefined
  }
  throw new Error(`书库中的 ${collection} 记录缺少有效标识。`)
}

export function parseLibraryJsonValue(text: string): unknown {
  try { return JSON.parse(text) } catch { throw new Error('书库含有无法解析的 JSON。') }
}

export function decodeLibraryText(bytes: Uint8Array): string {
  // Accept a Windows UTF-8 BOM, but never replace corrupted prose bytes with U+FFFD.
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('书库 JSON 不是有效的 UTF-8 文本。') }
}

export function normalizeImportedLibrary(input: unknown, strategy: 'merge' | 'replace'): AppData {
  // Older project-only exports can be merged, but cannot stand in for an entire library.
  if (strategy === 'merge' && isRecord(input) &&
      ALL_ENTITY_COLLECTIONS.some(key => Array.isArray(input[key]) && input[key].length > 0)) {
    return normalizeLibraryData({ ...EMPTY_APP_DATA, ...input })
  }
  return normalizeLibraryData(input)
}

// Every released JSON format has this core. Later collections can legitimately be absent.
export function normalizeLibraryData(
  input: unknown, normalize: (data: AppData) => AppData = normalizeAppData
): AppData {
  if (!isRecord(input) || !isRecord(input.settings) || !Array.isArray(input.projects) ||
    !Array.isArray(input.chapters) || !Array.isArray(input.storyBibles)) {
    throw new Error('文件不是完整的 Novel Director 书库。')
  }
  if (typeof input.schemaVersion !== 'number' || !Number.isInteger(input.schemaVersion) ||
    input.schemaVersion < 1 || input.schemaVersion > EMPTY_APP_DATA.schemaVersion) {
    throw new Error('书库的数据版本不受支持。')
  }
  for (const key of ALL_ENTITY_COLLECTIONS) {
    if (!Object.hasOwn(input, key)) continue
    const records = input[key]
    if (!Array.isArray(records)) throw new Error(`书库中的 ${key} 不是数组。`)
    const ids = new Set<string>()
    for (const [index, record] of records.entries()) {
      const id = libraryEntityId(key, record) ?? `${key}:${index}`
      if (ids.has(id)) throw new Error(`书库中的 ${key} 含有重复标识。`)
      ids.add(id)
    }
  }
  const data = normalize(input as unknown as AppData)
  for (const key of ALL_ENTITY_COLLECTIONS) {
    const records = input[key]
    if (Array.isArray(records) && data[key].length < records.length) {
      throw new Error(`书库中的 ${key} 含有无法读取的记录。`)
    }
  }
  return data
}
