import { accessSync, constants, lstatSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { EMPTY_APP_DATA } from '../../shared/defaults'
import type { AppData } from '../../shared/types'
import { assertReservedLibraryFile } from '../libraryFile'
import { ensureSqliteSchema } from './sqliteSchema'
import { readLibrarySnapshot } from './sqliteSnapshot'
import type { StorageSnapshot } from '../StorageService'
import type { SqliteDatabase, SqliteDatabaseConstructor } from './sqliteTypes'

export interface ValidatedSnapshot {
  snapshot: StorageSnapshot
  dataVersion: number
}

export function dataVersion(db: SqliteDatabase): number {
  return Number(db.prepare('PRAGMA data_version').get()?.data_version)
}

export function openExistingSqliteLibrary(Database: SqliteDatabaseConstructor, path: string) {
  const before = statSync(path, { bigint: true })
  if (!before.isFile() || !before.size) throw new Error('文件不是 SQLite 书库。')
  const reader = new Database(path, { readonly: true, fileMustExist: true })
  let db: SqliteDatabase | undefined
  try {
    reader.pragma('query_only = ON')
    const beforeVersion = dataVersion(reader)
    const snapshot = reader.transaction(() => readLibrarySnapshot(reader))()
    accessSync(path, constants.W_OK)
    accessSync(dirname(path), constants.W_OK)
    db = new Database(path, { fileMustExist: true })
    db.pragma('foreign_keys = ON')
    const version = dataVersion(db)
    const after = statSync(path, { bigint: true })
    // Compare data_version only on the same handle. Pin the writer's token before
    // releasing the reader so a concurrent commit cannot slip into the cached snapshot.
    if (before.dev !== after.dev || before.ino !== after.ino || dataVersion(reader) !== beforeVersion) {
      throw new Error('预检期间 SQLite 书库已更改，请重试。')
    }
    return { db, initial: { snapshot, dataVersion: version } }
  } catch (error) { db?.close(); throw error } finally { reader.close() }
}

export function initializeReservedSqliteLibrary(
  Database: SqliteDatabaseConstructor, path: string, persist: (db: SqliteDatabase, data: AppData) => void,
  initialData: AppData = EMPTY_APP_DATA
): SqliteDatabase {
  assertReservedLibraryFile(path)
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (lstatSync(path + suffix, { throwIfNoEntry: false })) {
      throw new Error('新书库位置已有 SQLite 日志文件，请选择其他位置。')
    }
  }
  const db = new Database(path, { fileMustExist: true })
  try {
    db.pragma('foreign_keys = ON')
    db.transaction(() => {
      assertReservedLibraryFile(path)
      if (db.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get()) throw new Error('新建书库的位置已被使用。')
      ensureSqliteSchema(db, new Date().toISOString())
      persist(db, initialData)
    })()
    db.pragma('journal_mode = WAL')
    return db
  } catch (error) { db.close(); throw error }
}
