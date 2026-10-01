import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AppData } from '../../shared/types'
import { EMPTY_APP_DATA, normalizeAppData } from '../../shared/defaults'
import { ensureSqliteSchema } from './sqliteSchema'
import type { SqliteDatabase, SqliteDatabaseConstructor } from './sqliteTypes'

function isSqliteOpenFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return errorCode(error) === 'SQLITE_NOTADB' ||
    /file is not a database|not a database|database disk image is malformed/i.test(message)
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}

function appDataRecoveryScore(data: AppData): number {
  return data.projects.length * 100000 + data.chapters.length * 1000 +
    data.characters.length * 500 + data.foreshadowings.length * 200 +
    data.characterStateFacts.length * 200 + data.stageSummaries.length * 100 +
    data.generationRunTraces.length * 50
}

export function isSqliteEmpty(db: SqliteDatabase): boolean {
  if (db.prepare('SELECT 1 FROM app_settings LIMIT 1').get()) return false
  return !db.prepare('SELECT 1 FROM entities LIMIT 1').get()
}

/** Owns one connection and its retryable, cancellable first-load initialization. */
export class SqliteInitialization {
  private db: SqliteDatabase | null = null
  private opening: Promise<SqliteDatabase> | null = null
  private initializing: Promise<void> | null = null
  private generation = 0
  private recoveredData: AppData | null = null

  constructor(
    private readonly Database: SqliteDatabaseConstructor,
    private readonly storagePath: string,
    private readonly legacyJsonPath: string,
    private readonly persist: (db: SqliteDatabase, data: AppData) => void
  ) {}

  async open(): Promise<SqliteDatabase> {
    if (this.db) return this.db
    const opening = this.opening ??= this.openDatabase(this.generation)
    try {
      const db = await opening
      this.assertCurrent(db)
      return db
    } finally {
      if (this.opening === opening) this.opening = null
    }
  }

  close(): void {
    this.generation++
    this.initializing = null
    this.db?.close()
    this.db = null
    // Keep a pending open registered until it exits, so recovery I/O cannot race a reopen.
  }

  async ensureSnapshot(db: SqliteDatabase): Promise<void> {
    this.assertCurrent(db)
    if (!this.initializing && !isSqliteEmpty(db)) return
    const initializing = this.initializing ??= this.initializeSnapshot(db)
    try {
      await initializing
      this.assertCurrent(db)
    } finally {
      if (this.initializing === initializing) this.initializing = null
    }
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) throw new Error('SQLite storage was closed during initialization.')
  }

  private assertCurrent(db: SqliteDatabase): void {
    if (db !== this.db) throw new Error('SQLite storage was closed during initialization.')
  }

  private async openDatabase(generation: number): Promise<SqliteDatabase> {
    await mkdir(dirname(this.storagePath), { recursive: true })
    this.assertGeneration(generation)
    let db: SqliteDatabase | null = null
    try {
      try {
        db = new this.Database(this.storagePath)
        this.initializeDatabase(db)
      } catch (error) {
        db?.close()
        db = null
        if (!isSqliteOpenFailure(error)) throw error
        if (!await this.recoverInvalidSqliteFile(generation)) throw error
        this.assertGeneration(generation)
        db = new this.Database(this.storagePath)
        this.initializeDatabase(db)
      }
      if (this.recoveredData) {
        this.saveIfEmpty(db, this.recoveredData)
        this.recoveredData = null
      }
      this.db = db
      return db
    } catch (error) {
      db?.close()
      throw error
    }
  }

  private initializeDatabase(db: SqliteDatabase): void {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    ensureSqliteSchema(db, new Date().toISOString())
  }

  private saveIfEmpty(db: SqliteDatabase, data: AppData): void {
    // The emptiness check and write share a transaction; JSON I/O never holds a DB lock.
    db.transaction(() => {
      if (isSqliteEmpty(db)) this.persist(db, data)
    })()
  }

  private async initializeSnapshot(db: SqliteDatabase): Promise<void> {
    const data = await this.migrateLegacyJsonIfPresent(db)
    this.assertCurrent(db)
    this.saveIfEmpty(db, data ?? EMPTY_APP_DATA)
  }

  private async migrateLegacyJsonIfPresent(db: SqliteDatabase): Promise<AppData | null> {
    let raw: string
    try {
      raw = await readFile(this.legacyJsonPath, 'utf-8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null
      throw error
    }
    this.assertCurrent(db)
    if (!isSqliteEmpty(db)) return null
    let parsed: Partial<AppData>
    try {
      parsed = JSON.parse(raw) as Partial<AppData>
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      // Preserve the corrupt-JSON backup convention, but never swallow backup I/O errors.
      await copyFile(this.legacyJsonPath, `${this.legacyJsonPath}.corrupt.${Date.now()}.json`)
      return null
    }
    const data = normalizeAppData(parsed)
    await copyFile(this.legacyJsonPath, `${this.legacyJsonPath}.before-sqlite-migrate.${Date.now()}.json`)
    return data
  }

  private async recoverInvalidSqliteFile(generation: number): Promise<boolean> {
    const legacyData = await this.readJsonAppDataCandidate(this.legacyJsonPath)
    this.assertGeneration(generation)
    const mislabeledData = await this.readJsonAppDataCandidate(this.storagePath)
    this.assertGeneration(generation)
    const recoveredData = legacyData && mislabeledData
      ? appDataRecoveryScore(legacyData) >= appDataRecoveryScore(mislabeledData) ? legacyData : mislabeledData
      : legacyData ?? mislabeledData
    if (!recoveredData) return false

    const backupPath = `${this.storagePath}.invalid-sqlite.${Date.now()}.bak`
    await copyFile(this.storagePath, backupPath)
    this.assertGeneration(generation)
    // Retain the payload if unlink, reopening, schema setup or its first save fails.
    this.recoveredData = recoveredData
    await unlink(this.storagePath)
    this.assertGeneration(generation)
    return true
  }

  private async readJsonAppDataCandidate(path: string): Promise<AppData | null> {
    let raw: string
    try {
      raw = await readFile(path, 'utf-8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null
      throw error
    }
    if (!raw.trimStart().startsWith('{')) return null
    try {
      return normalizeAppData(JSON.parse(raw) as Partial<AppData>)
    } catch (error) {
      if (error instanceof SyntaxError) return null
      throw error
    }
  }
}
