import type { AppData } from '../../shared/types'
import { EMPTY_APP_DATA, normalizeAppData } from '../../shared/defaults'
import { ALL_ENTITY_COLLECTIONS } from '../../shared/appDataCollections'
import type { StorageSnapshot } from '../StorageService'
import { libraryEntityId, normalizeLibraryData, parseLibraryJsonValue } from '../libraryValidation'
import { arrayCollectionKeys, parseJsonObject } from './sqliteEntityMapper'
import { assertLibrarySchema, SETTINGS_ROW_ID } from './sqliteSchema'
import type { AppDataArrayKey, SqliteDatabase } from './sqliteTypes'

// A read projection is not a full AppData snapshot and must never be saved as one.
export function readAppDataCollectionsFromDatabase(
  db: SqliteDatabase, collections: readonly AppDataArrayKey[], projectId?: string
): Partial<AppData> {
  const partial: Partial<AppData> = {}
  if (!collections.length) return partial
  const targets = partial as Record<string, unknown[]>
  for (const key of collections) targets[key] = []
  const placeholders = collections.map(() => '?').join(', ')
  const scope = projectId === undefined ? '' : " AND (project_id = ? OR (collection = 'projects' AND id = ?))"
  const rows = db.prepare(`SELECT collection, json FROM entities WHERE collection IN (${placeholders})${scope} ORDER BY collection, id`)
    .all(...collections, ...(projectId === undefined ? [] : [projectId, projectId]))
  for (const row of rows) {
    if (typeof row.collection !== 'string' || typeof row.json !== 'string') continue
    const target = targets[row.collection]
    if (Array.isArray(target)) target.push(parseJsonObject(row.json, null))
  }
  return partial
}

export function currentRevisionFromDatabase(db: SqliteDatabase): string {
  const value = db.prepare('SELECT value FROM meta WHERE key = ?').get('revision')?.value
  return typeof value === 'string' && value ? value : '0'
}

export function readLibraryHeader(db: SqliteDatabase) {
  assertLibrarySchema(db)
  const version = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get()?.value
  const revision = db.prepare("SELECT value FROM meta WHERE key = 'revision'").get()?.value
  const settings = db.prepare('SELECT id, json FROM app_settings LIMIT 2').all()
  if (typeof version !== 'string' || !/^[1-9]\d*$/.test(version) || typeof revision !== 'string' ||
    !revision.trim() || settings.length !== 1 || settings[0].id !== SETTINGS_ROW_ID || typeof settings[0].json !== 'string') {
    throw new Error('SQLite 书库缺少有效的数据版本、修订号或设置。')
  }
  const value = parseLibraryJsonValue(settings[0].json)
  if (Number(version) > EMPTY_APP_DATA.schemaVersion || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SQLite 书库的数据版本或设置无效。')
  }
  return { schemaVersion: Number(version), settings: value, revision }
}

/** Read under the caller's snapshot transaction; never substitute defaults for damaged rows. */
export function readLibrarySnapshot(db: SqliteDatabase): StorageSnapshot {
  const { schemaVersion, settings, revision } = readLibraryHeader(db)
  const collections = new Map<string, unknown[]>(ALL_ENTITY_COLLECTIONS.map(key => [key, []]))
  const rows = db.prepare('SELECT collection, id, json FROM entities ORDER BY collection, id').iterate()
  for (const row of rows) {
    const target = typeof row.collection === 'string' && collections.get(row.collection)
    if (!target || typeof row.json !== 'string') throw new Error('SQLite 书库包含无法识别的记录。')
    const value = parseLibraryJsonValue(row.json)
    const id = libraryEntityId(row.collection as AppDataArrayKey, value)
    if (id === undefined ? typeof row.id !== 'string' || !/^promptVersions:(0|[1-9]\d*)$/.test(row.id) : row.id !== id) {
      throw new Error(`SQLite 书库中的 ${row.collection} 记录标识不一致。`)
    }
    target.push(value)
  }
  return { revision, data: normalizeLibraryData({ ...Object.fromEntries(collections), schemaVersion, settings }) }
}

export function readAppDataFromDatabase(db: SqliteDatabase): AppData {
  const schemaVersionRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('schemaVersion')
  const settingsRow = db.prepare('SELECT json FROM app_settings WHERE id = ?').get(SETTINGS_ROW_ID)
  const rows = db.prepare('SELECT collection, json FROM entities ORDER BY collection, id').all()
  const partial: Partial<AppData> = {
    schemaVersion: schemaVersionRow && typeof schemaVersionRow.value === 'string'
      ? Number(schemaVersionRow.value) : EMPTY_APP_DATA.schemaVersion,
    settings: settingsRow && typeof settingsRow.json === 'string'
      ? parseJsonObject(settingsRow.json, EMPTY_APP_DATA.settings) : EMPTY_APP_DATA.settings
  }
  for (const key of arrayCollectionKeys()) (partial as Record<string, unknown>)[key] = []
  for (const row of rows) {
    if (typeof row.collection !== 'string' || typeof row.json !== 'string') continue
    const target = (partial as Record<string, unknown>)[row.collection]
    if (Array.isArray(target)) target.push(parseJsonObject(row.json, null))
  }
  return normalizeAppData(partial)
}
