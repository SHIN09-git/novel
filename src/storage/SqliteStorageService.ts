import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { AppData, ChapterCommitBundle, GenerationRunBundle, RevisionCommitBundle } from '../shared/types'
import type { StorageWriteResult } from '../shared/ipc/ipcTypes'
import { EMPTY_APP_DATA, normalizeAppData, sanitizeAppDataForPersistence } from '../shared/defaults'
import { applyChapterCommitBundleToAppData, validateChapterCommitBundle } from '../services/ChapterCommitBundleService'
import { validateGenerationRunBundle } from '../services/GenerationRunBundleService'
import { applyRevisionCommitBundleToAppData, validateRevisionCommitBundle } from '../services/RevisionCommitBundleService'
import { JsonStorageService } from './JsonStorageService'
import {
  resolveJsonStoragePath,
  resolveSqliteStoragePath,
  type StorageService
} from './StorageService'

type SqliteValue = string | number | null

interface SqliteStatement {
  run(...values: SqliteValue[]): unknown
  get(...values: SqliteValue[]): Record<string, unknown> | undefined
  all(...values: SqliteValue[]): Array<Record<string, unknown>>
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  pragma(sql: string): unknown
  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void
  close(): void
}

type SqliteDatabaseConstructor = new (path: string) => SqliteDatabase

type AppDataArrayKey = {
  [K in keyof AppData]: AppData[K] extends Array<unknown> ? K : never
}[keyof AppData]

const SQLITE_SCHEMA_VERSION = 1
const SETTINGS_ROW_ID = 'default'
const require = createRequire(import.meta.url)

function loadBetterSqlite3(): SqliteDatabaseConstructor {
  // P0 SQLite backend: the native dependency stays in the main process only.
  // P1/P2 can add finer-grained entity APIs and full-text search after this backend stabilizes.
  const Database = require('better-sqlite3') as SqliteDatabaseConstructor
  const probe = new Database(':memory:')
  probe.close()
  return Database
}

function nowIso(): string {
  return new Date().toISOString()
}

function assertStaticSql(sql: string, context: string): void {
  // SAFETY: SQLite schema SQL in this file is static and contains no user input.
  // All dynamic values must continue to go through prepared statements with placeholders.
  if (sql.includes('${') || sql.includes('`${')) {
    throw new Error(`${context}: SQL schema text must not interpolate runtime values.`)
  }
}

function arrayCollectionKeys(): AppDataArrayKey[] {
  return Object.keys(EMPTY_APP_DATA).filter((key) =>
    Array.isArray(EMPTY_APP_DATA[key as keyof AppData])
  ) as AppDataArrayKey[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringField(entity: Record<string, unknown>, key: string): string | null {
  const value = entity[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function numberField(entity: Record<string, unknown>, key: string): number | null {
  const value = entity[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getEntityId(collection: AppDataArrayKey, entity: unknown, index: number): string {
  const record = asRecord(entity)
  const id = stringField(record, 'id')
  if (id) return id
  if (collection === 'storyBibles') {
    const projectId = stringField(record, 'projectId')
    if (projectId) return projectId
  }
  return `${collection}:${index}`
}

function getTitle(entity: Record<string, unknown>): string | null {
  return stringField(entity, 'title') ?? stringField(entity, 'name') ?? stringField(entity, 'note') ?? stringField(entity, 'source')
}

function parseJsonObject<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function isSqliteOpenFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : ''
  return (
    code === 'SQLITE_NOTADB' ||
    /file is not a database|not a database|database disk image is malformed/i.test(message)
  )
}

function appDataRecoveryScore(data: AppData): number {
  return (
    data.projects.length * 100000 +
    data.chapters.length * 1000 +
    data.characters.length * 500 +
    data.foreshadowings.length * 200 +
    data.characterStateFacts.length * 200 +
    data.stageSummaries.length * 100 +
    data.generationRunTraces.length * 50
  )
}

function chooseRecoveryData(legacyData: AppData | null, mislabeledData: AppData | null): AppData | null {
  if (legacyData && mislabeledData) {
    return appDataRecoveryScore(legacyData) >= appDataRecoveryScore(mislabeledData)
      ? legacyData
      : mislabeledData
  }
  return legacyData ?? mislabeledData
}

function bundleEntityEntries(bundle: GenerationRunBundle): Array<{ collection: AppDataArrayKey; value: unknown }> {
  return [
    { collection: 'chapterGenerationJobs', value: bundle.job },
    ...bundle.steps.map((value) => ({ collection: 'chapterGenerationSteps' as const, value })),
    ...(bundle.promptContextSnapshot ? [{ collection: 'promptContextSnapshots' as const, value: bundle.promptContextSnapshot }] : []),
    ...bundle.generatedDrafts.map((value) => ({ collection: 'generatedChapterDrafts' as const, value })),
    ...bundle.qualityGateReports.map((value) => ({ collection: 'qualityGateReports' as const, value })),
    ...bundle.consistencyReviewReports.map((value) => ({ collection: 'consistencyReviewReports' as const, value })),
    ...bundle.memoryUpdateCandidates.map((value) => ({ collection: 'memoryUpdateCandidates' as const, value })),
    ...bundle.characterStateChangeCandidates.map((value) => ({ collection: 'characterStateChangeCandidates' as const, value })),
    ...bundle.redundancyReports.map((value) => ({ collection: 'redundancyReports' as const, value })),
    ...(bundle.runTrace ? [{ collection: 'generationRunTraces' as const, value: bundle.runTrace }] : [])
  ]
}

function chapterCommitEntityEntries(bundle: ChapterCommitBundle, nextData: AppData): Array<{ collection: AppDataArrayKey; value: unknown }> {
  const entries: Array<{ collection: AppDataArrayKey; value: unknown }> = [
    { collection: 'chapterCommitBundles', value: bundle },
    { collection: 'chapters', value: bundle.chapter }
  ]

  if (bundle.chapterVersion) entries.push({ collection: 'chapterVersions', value: bundle.chapterVersion })

  const draft = bundle.generatedDraft ?? nextData.generatedChapterDrafts.find((item) => item.id === bundle.generatedDraftId)
  if (draft) entries.push({ collection: 'generatedChapterDrafts', value: draft })

  for (const report of bundle.qualityGateReports ?? []) entries.push({ collection: 'qualityGateReports', value: report })
  for (const report of bundle.consistencyReviewReports ?? []) entries.push({ collection: 'consistencyReviewReports', value: report })
  for (const report of bundle.redundancyReports ?? []) entries.push({ collection: 'redundancyReports', value: report })
  for (const candidate of bundle.acceptedMemoryUpdateCandidates ?? []) entries.push({ collection: 'memoryUpdateCandidates', value: candidate })
  for (const candidate of bundle.acceptedCharacterStateChangeCandidates ?? []) entries.push({ collection: 'characterStateChangeCandidates', value: candidate })
  for (const fact of bundle.appliedCharacterStateFacts ?? []) entries.push({ collection: 'characterStateFacts', value: fact })
  for (const foreshadowing of bundle.appliedForeshadowingUpdates ?? []) entries.push({ collection: 'foreshadowings', value: foreshadowing })
  for (const event of bundle.appliedTimelineEvents ?? []) entries.push({ collection: 'timelineEvents', value: event })
  if (bundle.generationRunTrace) entries.push({ collection: 'generationRunTraces', value: bundle.generationRunTrace })

  return entries
}

function revisionCommitEntityEntries(bundle: RevisionCommitBundle, nextData: AppData): Array<{ collection: AppDataArrayKey; value: unknown }> {
  const entries: Array<{ collection: AppDataArrayKey; value: unknown }> = [
    { collection: 'revisionCommitBundles', value: bundle },
    { collection: 'chapters', value: bundle.chapter },
    { collection: 'chapterVersions', value: bundle.chapterVersion }
  ]

  if (bundle.generatedDraft) entries.push({ collection: 'generatedChapterDrafts', value: bundle.generatedDraft })

  const revisionSession =
    bundle.revisionSession ?? nextData.revisionSessions.find((item) => item.id === bundle.revisionSessionId)
  const revisionVersion =
    bundle.revisionVersion ?? nextData.revisionVersions.find((item) => item.id === bundle.revisionVersionId)
  const generationRunTrace =
    bundle.generationRunTrace ?? nextData.generationRunTraces.find((item) => item.id === bundle.linkedGenerationRunTraceId)

  if (revisionSession) entries.push({ collection: 'revisionSessions', value: revisionSession })
  if (revisionVersion) entries.push({ collection: 'revisionVersions', value: revisionVersion })
  if (generationRunTrace) entries.push({ collection: 'generationRunTraces', value: generationRunTrace })

  return entries
}

export class SqliteStorageService implements StorageService {
  private readonly Database: SqliteDatabaseConstructor
  private db: SqliteDatabase | null = null
  private readonly storagePath: string
  private readonly legacyJsonPath: string

  constructor(storagePath: string, options: { legacyJsonPath?: string } = {}) {
    this.Database = loadBetterSqlite3()
    this.storagePath = resolveSqliteStoragePath(storagePath)
    this.legacyJsonPath = options.legacyJsonPath ?? resolveJsonStoragePath(storagePath)
  }

  getStoragePath(): string {
    return this.storagePath
  }

  async load(): Promise<AppData> {
    const db = await this.open()
    if (this.isEmpty(db)) {
      const migrated = await this.migrateLegacyJsonIfPresent()
      if (migrated) return migrated

      await this.save(EMPTY_APP_DATA)
      return EMPTY_APP_DATA
    }

    return this.readAppData(db)
  }

  async save(data: AppData): Promise<void> {
    const db = await this.open()
    const normalized = sanitizeAppDataForPersistence(data)
    const collections = arrayCollectionKeys()
    const updatedAt = nowIso()

    const writeTransaction = db.transaction((nextData: AppData) => {
      db.prepare('DELETE FROM app_settings').run()
      db.prepare('DELETE FROM entities').run()

      db.prepare(
        `INSERT INTO app_settings (id, json, updated_at)
         VALUES (?, ?, ?)`
      ).run(SETTINGS_ROW_ID, JSON.stringify(nextData.settings), updatedAt)

      db.prepare(
        `INSERT OR REPLACE INTO meta (key, value)
         VALUES (?, ?)`
      ).run('schemaVersion', String(nextData.schemaVersion))

      const insertEntity = db.prepare(
        `INSERT INTO entities (
          collection, id, project_id, chapter_id, job_id, character_id,
          chapter_order, title, updated_at, json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )

      for (const collection of collections) {
        const values = nextData[collection] as unknown[]
        values.forEach((value, index) => {
          const entity = asRecord(value)
          insertEntity.run(
            collection,
            getEntityId(collection, value, index),
            stringField(entity, 'projectId'),
            stringField(entity, 'chapterId') ?? stringField(entity, 'targetChapterId') ?? stringField(entity, 'fromChapterId'),
            stringField(entity, 'jobId'),
            stringField(entity, 'characterId'),
            numberField(entity, 'chapterOrder') ?? numberField(entity, 'targetChapterOrder') ?? numberField(entity, 'order'),
            getTitle(entity),
            stringField(entity, 'updatedAt') ?? stringField(entity, 'createdAt') ?? updatedAt,
            JSON.stringify(value)
          )
        })
      }
    })

    writeTransaction(normalized)
  }

  async saveGenerationRunBundle(bundle: GenerationRunBundle): Promise<StorageWriteResult> {
    const db = await this.open()
    const existing = this.isEmpty(db) ? EMPTY_APP_DATA : this.readAppData(db)
    validateGenerationRunBundle(bundle, existing)
    const updatedAt = nowIso()
    const revision = `${Date.now()}`
    const entries = bundleEntityEntries(bundle)

    const writeTransaction = db.transaction((nextEntries: Array<{ collection: AppDataArrayKey; value: unknown }>) => {
      const upsertEntity = db.prepare(
        `INSERT OR REPLACE INTO entities (
          collection, id, project_id, chapter_id, job_id, character_id,
          chapter_order, title, updated_at, json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )

      for (const entry of nextEntries) {
        const entity = asRecord(entry.value)
        upsertEntity.run(
          entry.collection,
          getEntityId(entry.collection, entry.value, 0),
          stringField(entity, 'projectId'),
          stringField(entity, 'chapterId') ?? stringField(entity, 'targetChapterId') ?? stringField(entity, 'fromChapterId'),
          stringField(entity, 'jobId') ?? (entry.collection === 'redundancyReports' ? bundle.jobId : null),
          stringField(entity, 'characterId'),
          numberField(entity, 'chapterOrder') ?? numberField(entity, 'targetChapterOrder') ?? numberField(entity, 'order'),
          getTitle(entity),
          stringField(entity, 'updatedAt') ?? stringField(entity, 'createdAt') ?? updatedAt,
          JSON.stringify(entry.value)
        )
      }

      db.prepare(
        `INSERT OR REPLACE INTO meta (key, value)
         VALUES (?, ?)`
      ).run('revision', revision)
      db.prepare(
        `INSERT OR REPLACE INTO meta (key, value)
         VALUES (?, ?)`
      ).run('updatedAt', updatedAt)
    })

    writeTransaction(entries)

    return {
      ok: true,
      storagePath: this.storagePath,
      revision,
      updatedAt,
      savedCollections: [...new Set(entries.map((entry) => entry.collection))]
    }
  }

  async saveChapterCommitBundle(bundle: ChapterCommitBundle): Promise<StorageWriteResult> {
    const db = await this.open()
    const existing = this.isEmpty(db) ? EMPTY_APP_DATA : this.readAppData(db)
    validateChapterCommitBundle(bundle, existing)
    const nextData = applyChapterCommitBundleToAppData(existing, bundle)
    const entries = chapterCommitEntityEntries(bundle, nextData)
    const updatedAt = nowIso()
    const revision = `${Date.now()}`

    const writeTransaction = db.transaction((nextEntries: Array<{ collection: AppDataArrayKey; value: unknown }>) => {
      const upsertEntity = db.prepare(
        `INSERT OR REPLACE INTO entities (
          collection, id, project_id, chapter_id, job_id, character_id,
          chapter_order, title, updated_at, json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )

      for (const entry of nextEntries) {
        const entity = asRecord(entry.value)
        upsertEntity.run(
          entry.collection,
          getEntityId(entry.collection, entry.value, 0),
          stringField(entity, 'projectId'),
          stringField(entity, 'chapterId') ?? stringField(entity, 'targetChapterId') ?? stringField(entity, 'fromChapterId'),
          stringField(entity, 'jobId') ?? (entry.collection === 'chapterCommitBundles' ? bundle.jobId ?? null : null),
          stringField(entity, 'characterId'),
          numberField(entity, 'chapterOrder') ?? numberField(entity, 'targetChapterOrder') ?? numberField(entity, 'order'),
          getTitle(entity),
          stringField(entity, 'updatedAt') ?? stringField(entity, 'createdAt') ?? updatedAt,
          JSON.stringify(entry.value)
        )
      }

      db.prepare(
        `INSERT OR REPLACE INTO meta (key, value)
         VALUES (?, ?)`
      ).run('revision', revision)
      db.prepare(
        `INSERT OR REPLACE INTO meta (key, value)
         VALUES (?, ?)`
      ).run('updatedAt', updatedAt)
    })

    writeTransaction(entries)

    return {
      ok: true,
      storagePath: this.storagePath,
      revision,
      updatedAt,
      savedCollections: [...new Set(entries.map((entry) => entry.collection))]
    }
  }

  async saveRevisionCommitBundle(bundle: RevisionCommitBundle): Promise<StorageWriteResult> {
    const db = await this.open()
    const existing = this.isEmpty(db) ? EMPTY_APP_DATA : this.readAppData(db)
    validateRevisionCommitBundle(bundle, existing)
    const nextData = applyRevisionCommitBundleToAppData(existing, bundle)
    const entries = revisionCommitEntityEntries(bundle, nextData)
    const updatedAt = nowIso()
    const revision = `${Date.now()}`

    const writeTransaction = db.transaction((nextEntries: Array<{ collection: AppDataArrayKey; value: unknown }>) => {
      const upsertEntity = db.prepare(
        `INSERT OR REPLACE INTO entities (
          collection, id, project_id, chapter_id, job_id, character_id,
          chapter_order, title, updated_at, json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )

      for (const entry of nextEntries) {
        const entity = asRecord(entry.value)
        upsertEntity.run(
          entry.collection,
          getEntityId(entry.collection, entry.value, 0),
          stringField(entity, 'projectId'),
          stringField(entity, 'chapterId') ?? stringField(entity, 'targetChapterId') ?? stringField(entity, 'fromChapterId'),
          stringField(entity, 'jobId'),
          stringField(entity, 'characterId'),
          numberField(entity, 'chapterOrder') ?? numberField(entity, 'targetChapterOrder') ?? numberField(entity, 'order'),
          getTitle(entity),
          stringField(entity, 'updatedAt') ?? stringField(entity, 'createdAt') ?? updatedAt,
          JSON.stringify(entry.value)
        )
      }

      db.prepare(
        `INSERT OR REPLACE INTO meta (key, value)
         VALUES (?, ?)`
      ).run('revision', revision)
      db.prepare(
        `INSERT OR REPLACE INTO meta (key, value)
         VALUES (?, ?)`
      ).run('updatedAt', updatedAt)
    })

    writeTransaction(entries)

    return {
      ok: true,
      storagePath: this.storagePath,
      revision,
      updatedAt,
      savedCollections: [...new Set(entries.map((entry) => entry.collection))]
    }
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  private async open(): Promise<SqliteDatabase> {
    if (this.db) return this.db
    await mkdir(dirname(this.storagePath), { recursive: true })

    let db: SqliteDatabase | null = null
    try {
      db = new this.Database(this.storagePath)
      this.initializeDatabase(db)
      this.db = db
      return this.db
    } catch (error) {
      db?.close()
      if (!isSqliteOpenFailure(error)) throw error

      const recoveredData = await this.recoverInvalidSqliteFile()
      if (!recoveredData) throw error

      const recoveredDb = new this.Database(this.storagePath)
      this.initializeDatabase(recoveredDb)
      this.db = recoveredDb
      await this.save(recoveredData)
      return this.db
    }
  }

  private initializeDatabase(db: SqliteDatabase): void {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    this.ensureSchema(db)
  }

  private async recoverInvalidSqliteFile(): Promise<AppData | null> {
    // P0 safety net: older builds could leave a JSON payload at a .sqlite path.
    // Prefer the adjacent legacy JSON when it contains more data, then preserve the
    // invalid sqlite file before creating a real SQLite database in its place.
    const legacyData = await this.readJsonAppDataCandidate(this.legacyJsonPath)
    const mislabeledData = await this.readJsonAppDataCandidate(this.storagePath)
    const recoveredData = chooseRecoveryData(legacyData, mislabeledData)
    if (!recoveredData) return null

    const backupPath = `${this.storagePath}.invalid-sqlite.${Date.now()}.bak`
    await copyFile(this.storagePath, backupPath)
    await unlink(this.storagePath)
    return recoveredData
  }

  private async readJsonAppDataCandidate(path: string): Promise<AppData | null> {
    if (!existsSync(path)) return null
    try {
      const raw = await readFile(path, 'utf-8')
      const trimmed = raw.trimStart()
      if (!trimmed.startsWith('{')) return null
      return normalizeAppData(JSON.parse(raw) as Partial<AppData>)
    } catch {
      return null
    }
  }

  private ensureSchema(db: SqliteDatabase): void {
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS entities (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        project_id TEXT,
        chapter_id TEXT,
        job_id TEXT,
        character_id TEXT,
        chapter_order INTEGER,
        title TEXT,
        updated_at TEXT,
        json TEXT NOT NULL,
        PRIMARY KEY(collection, id)
      );

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entities_collection_project
        ON entities(collection, project_id);
      CREATE INDEX IF NOT EXISTS idx_entities_collection_chapter_order
        ON entities(collection, chapter_order);
      CREATE INDEX IF NOT EXISTS idx_entities_collection_updated_at
        ON entities(collection, updated_at);
      CREATE INDEX IF NOT EXISTS idx_entities_job
        ON entities(collection, job_id);
      CREATE INDEX IF NOT EXISTS idx_entities_character
        ON entities(collection, character_id);
    `
    assertStaticSql(schemaSql, 'SqliteStorageService.ensureSchema')
    db.exec(schemaSql)

    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at)
       VALUES (?, ?)`
    ).run(SQLITE_SCHEMA_VERSION, nowIso())
  }

  private isEmpty(db: SqliteDatabase): boolean {
    const settings = db.prepare('SELECT COUNT(*) AS count FROM app_settings').get()?.count
    const entities = db.prepare('SELECT COUNT(*) AS count FROM entities').get()?.count
    return Number(settings ?? 0) === 0 && Number(entities ?? 0) === 0
  }

  private readAppData(db: SqliteDatabase): AppData {
    const schemaVersionRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('schemaVersion')
    const settingsRow = db.prepare('SELECT json FROM app_settings WHERE id = ?').get(SETTINGS_ROW_ID)
    const rows = db.prepare('SELECT collection, json FROM entities ORDER BY collection, id').all()
    const partial: Partial<AppData> = {
      schemaVersion: schemaVersionRow && typeof schemaVersionRow.value === 'string'
        ? Number(schemaVersionRow.value)
        : EMPTY_APP_DATA.schemaVersion,
      settings: settingsRow && typeof settingsRow.json === 'string'
        ? parseJsonObject(settingsRow.json, EMPTY_APP_DATA.settings)
        : EMPTY_APP_DATA.settings
    }

    for (const key of arrayCollectionKeys()) {
      ;(partial as Record<string, unknown>)[key] = []
    }

    for (const row of rows) {
      if (typeof row.collection !== 'string' || typeof row.json !== 'string') continue
      const target = (partial as Record<string, unknown>)[row.collection]
      if (!Array.isArray(target)) continue
      target.push(parseJsonObject(row.json, null))
    }

    return normalizeAppData(partial)
  }

  private async migrateLegacyJsonIfPresent(): Promise<AppData | null> {
    if (!existsSync(this.legacyJsonPath)) return null

    try {
      const raw = await readFile(this.legacyJsonPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppData>
      const data = normalizeAppData(parsed)
      await this.save(data)
      await copyFile(this.legacyJsonPath, `${this.legacyJsonPath}.before-sqlite-migrate.${Date.now()}.json`)
      return sanitizeAppDataForPersistence(data)
    } catch {
      // Preserve JsonStorageService's legacy corrupt-backup behavior without importing bad data into SQLite.
      await new JsonStorageService(this.legacyJsonPath).load()
      return null
    }
  }
}

export function createStorageService(storagePath: string): StorageService {
  try {
    return new SqliteStorageService(storagePath)
  } catch (error) {
    console.warn(
      `SQLite storage backend is unavailable. Falling back to JSON storage. ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return new JsonStorageService(resolveJsonStoragePath(storagePath))
  }
}
