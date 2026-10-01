import type { AppData } from '../../shared/types'
import { EMPTY_APP_DATA, normalizeAppData } from '../../shared/defaults'
import { arrayCollectionKeys, parseJsonObject } from './sqliteEntityMapper'
import { SETTINGS_ROW_ID } from './sqliteSchema'
import type { AppDataArrayKey, SqliteDatabase } from './sqliteTypes'

// A read projection is not a full AppData snapshot and must never be saved as one.
export function readAppDataCollectionsFromDatabase(
  db: SqliteDatabase, collections: readonly AppDataArrayKey[]
): Partial<AppData> {
  const partial: Partial<AppData> = {}
  if (!collections.length) return partial
  const targets = partial as Record<string, unknown[]>
  for (const key of collections) targets[key] = []
  const placeholders = collections.map(() => '?').join(', ')
  const rows = db.prepare(`SELECT collection, json FROM entities WHERE collection IN (${placeholders}) ORDER BY collection, id`)
    .all(...collections)
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
