import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, resolve } from 'node:path'
import type { AppData, CandidateDecisionCommand, Character, CharacterCardReviewCommand, ChapterCommitBundle, ChapterWritebackFailure, GenerationRunBundle, RevisionCommitBundle } from '../shared/types'
import type { CandidateDecisionWriteResult, CharacterCardReviewWriteResult, StorageWriteResult } from '../shared/ipc/ipcTypes'
import { normalizeAppData, sanitizeAppDataForPersistence } from '../shared/defaults'
import { normalizeChapterWritebackFailure } from '../shared/normalizers/chapterWritebackFailures'
import { applyCharacterCardReview, CHARACTER_CARD_REVIEW_COLLECTIONS } from '../services/characterState/cardReview'
import { applyChapterCommitBundleToAppData } from '../services/ChapterCommitBundleService'
import { validateGenerationRunBundle, type GenerationRunBundleValidationContext } from '../services/GenerationRunBundleService'
import { applyRevisionCommitBundleToAppData } from '../services/RevisionCommitBundleService'
import { JsonStorageService } from './JsonStorageService'
import { normalizeLibraryData } from './libraryValidation'
import { readSqliteChapterTitles, readJsonChapterTitles, sqliteTitleVersionIds } from './chapterTitleState'
import { decideChapterTitleCommit } from '../services/ChapterTitleRenameService'
import type { ChapterTitleActor, ChapterTitleCommit } from '../shared/types/chapterTitle'
import type { ChapterTitleWriteResult } from '../shared/ipc/ipcTypes'
import {
  StorageRevisionConflictError,
  resolveJsonStoragePath,
  resolveSqliteStoragePath,
  type StorageService,
  type StorageSnapshot
} from './StorageService'
import {
  chapterCommitEntityEntries,
  generationBundleEntityEntries,
  revisionCommitEntityEntries
} from './sqlite/sqliteBundleEntries'
import {
  arrayCollectionKeys,
  entityInsertValues
} from './sqlite/sqliteEntityMapper'
import { currentRevisionFromDatabase, readAppDataFromDatabase, readAppDataCollectionsFromDatabase, readLibrarySnapshot } from './sqlite/sqliteSnapshot'
import { writeSqliteSnapshotEntities } from './sqlite/sqliteSnapshotWriter'
import { readGenerationBundleValidationContext } from './sqlite/sqliteGenerationContext'
import { readChapterCommitContext, readRevisionCommitContext } from './sqlite/sqliteCommitContext'
import { ensureReceiptIndexes } from './sqlite/sqliteReceiptAliases'
import { executeSqliteCandidateDecision } from './sqlite/sqliteCandidateDecisions'
import { SETTINGS_ROW_ID } from './sqlite/sqliteSchema'
import { sqliteUsageHistory } from './sqlite/sqliteProjectUsage'
import { SqliteInitialization } from './sqlite/sqliteInitialization'
import type {
  AppDataArrayKey,
  SqliteDatabase,
  SqliteDatabaseConstructor,
  SqliteEntityEntry
} from './sqlite/sqliteTypes'

const require = createRequire(import.meta.url)
let cachedDatabaseConstructor: SqliteDatabaseConstructor | null = null

function loadBetterSqlite3(): SqliteDatabaseConstructor {
  // P0 SQLite backend: the native dependency stays in the main process only.
  // P1/P2 can add finer-grained entity APIs and full-text search after this backend stabilizes.
  if (cachedDatabaseConstructor) return cachedDatabaseConstructor
  const Database = require('better-sqlite3') as SqliteDatabaseConstructor
  const probe = new Database(':memory:')
  probe.close()
  cachedDatabaseConstructor = Database
  return cachedDatabaseConstructor
}

function nowIso(): string { return new Date().toISOString() }

export function checkSqliteBindingAvailable(): void { loadBetterSqlite3() }

/**
 * Agent read tools must not initialize schemas, change WAL mode, or create files.
 * This path opens an existing SQLite database in native read-only mode.
 */
function readSqliteReadonly<T>(storagePath: string, read: (db: SqliteDatabase) => T): T {
  const Database = loadBetterSqlite3()
  const resolvedPath = resolveSqliteStoragePath(storagePath)
  const db = new Database(resolvedPath, { readonly: true, fileMustExist: true })
  try {
    db.pragma('query_only = ON')
    // Keep the payload and revision in one snapshot even when another process saves.
    return db.transaction(() => read(db))()
  } finally {
    db.close()
  }
}

export async function loadSqliteSnapshotReadonly(storagePath: string): Promise<StorageSnapshot> {
  return readSqliteReadonly(storagePath, (db) => ({
    data: readAppDataFromDatabase(db), revision: currentRevisionFromDatabase(db)
  }))
}

export async function loadChapterTitlesReadonly(storagePath: string, projectId: string) {
  if (storagePath.toLowerCase().endsWith('.json')) {
    const { state, revision } = await readJsonChapterTitles(storagePath, projectId)
    return { state, revision }
  }
  return readSqliteReadonly(storagePath, db => readSqliteChapterTitles(db, projectId))
}

export function loadSqliteUsageHistoryReadonly(storagePath: string, projectId: string) {
  return readSqliteReadonly(storagePath, db => ({ history: sqliteUsageHistory(db, projectId), revision: currentRevisionFromDatabase(db) }))
}

export async function loadSqliteCollectionsReadonly(
  storagePath: string, collections: readonly AppDataArrayKey[], projectSelector?: string
): Promise<{ data: Partial<AppData>; revision: string }> {
  return readSqliteReadonly(storagePath, (db) => {
    let projectId: string | undefined
    if (projectSelector !== undefined) {
      const row = db.prepare("SELECT id FROM entities WHERE collection = 'projects' AND (id = ? OR title = ?) ORDER BY (id = ?) DESC, id LIMIT 1")
        .get(projectSelector, projectSelector, projectSelector)
      if (typeof row?.id !== 'string') throw new Error(`Project not found: ${projectSelector}`)
      projectId = row.id
    }
    return { data: readAppDataCollectionsFromDatabase(db, collections, projectId), revision: currentRevisionFromDatabase(db) }
  })
}

export class SqliteStorageService implements StorageService {
  private readonly initialization: SqliteInitialization
  private readonly storagePath: string
  private readonly strict: boolean

  constructor(storagePath: string, options: { legacyJsonPath?: string; mode?: 'existing' | 'new'; initialData?: AppData } = {}) {
    const Database = loadBetterSqlite3()
    this.strict = options.mode !== undefined
    this.storagePath = this.strict ? resolve(storagePath) : resolveSqliteStoragePath(storagePath)
    this.initialization = new SqliteInitialization(
      Database, this.storagePath, options.legacyJsonPath ?? resolveJsonStoragePath(storagePath),
      (db, data) => this.saveSnapshot(db, data), options.mode, options.initialData
    )
  }

  getStoragePath(): string {
    return this.storagePath
  }

  async load(): Promise<AppData> {
    return (await this.loadSnapshot()).data
  }

  async loadSnapshot(): Promise<StorageSnapshot> {
    const db = await this.open()

    const readTransaction = db.transaction(() => {
      const revision = this.currentRevision(db)
      if (this.strict) return this.initialization.takeInitialSnapshot(db, revision) ?? readLibrarySnapshot(db)
      return { data: readAppDataFromDatabase(db), revision }
    })
    return readTransaction()
  }

  async save(data: AppData): Promise<void> {
    await this.saveIfCurrent(data)
  }

  async touchProject(projectId: string, expectedRevision: string): Promise<StorageWriteResult> {
    if (!expectedRevision) throw new StorageRevisionConflictError()
    const db = await this.open()
    return db.transaction((): StorageWriteResult => {
      const updatedAt = nowIso()
      // Compare and update in the first write statement, including across Agent connections.
      const { changes } = db.prepare(`UPDATE entities SET json = json_set(json, '$.lastOpenedAt', ?)
        WHERE collection = 'projects' AND id = ? AND (SELECT value FROM meta WHERE key = 'revision') = ?`)
        .run(updatedAt, projectId, expectedRevision) as { changes: number }
      if (!changes) {
        this.assertExpectedRevision(db, expectedRevision)
        throw new Error('项目不存在。')
      }
      const revision = `${updatedAt}-${randomUUID()}`
      this.writeRevisionMeta(db, revision, updatedAt)
      return { ok: true, storagePath: this.storagePath, revision, updatedAt, savedCollections: ['projects'] }
    })()
  }

  async backupTo(targetPath: string): Promise<void> {
    const db = await this.open()
    await mkdir(dirname(targetPath), { recursive: true })
    await db.backup(targetPath)
  }

  async saveIfCurrent(data: AppData, expectedRevision?: string): Promise<StorageWriteResult> {
    // An explicit full snapshot replaces data; incremental writes initialize through open().
    const db = await this.initialization.open()
    return this.saveSnapshot(db, data, expectedRevision)
  }

  private saveSnapshot(db: SqliteDatabase, data: AppData, expectedRevision?: string): StorageWriteResult {
    const normalized = this.strict ? normalizeLibraryData(data, sanitizeAppDataForPersistence) : sanitizeAppDataForPersistence(data)
    const collections = arrayCollectionKeys()
    const updatedAt = nowIso()
    const revision = `${updatedAt}-${randomUUID()}`
    const entries = collections.flatMap((collection) =>
      (normalized[collection] as unknown[]).map((value) => ({ collection, value }))
    )

    const writeTransaction = db.transaction((nextData: AppData) => {
      this.assertExpectedRevision(db, expectedRevision)
      db.prepare('DELETE FROM app_settings WHERE id <> ?').run(SETTINGS_ROW_ID)

      db.prepare(
        `INSERT INTO app_settings (id, json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
         WHERE app_settings.json IS NOT excluded.json`
      ).run(SETTINGS_ROW_ID, JSON.stringify(nextData.settings), updatedAt)

      db.prepare(
        `INSERT OR REPLACE INTO meta (key, value)
         VALUES (?, ?)`
      ).run('schemaVersion', String(nextData.schemaVersion))
      this.writeRevisionMeta(db, revision, updatedAt)
      // Keep full-save deletion/import semantics without rewriting unchanged history and prose.
      writeSqliteSnapshotEntities(db, entries, updatedAt)
      ensureReceiptIndexes(db)
    })

    writeTransaction(normalized)
    return {
      ok: true,
      storagePath: this.storagePath,
      revision,
      updatedAt,
      savedCollections: ['app_settings', ...collections]
    }
  }

  async saveGenerationRunBundle(bundle: GenerationRunBundle, expectedRevision?: string): Promise<StorageWriteResult> {
    return this.saveEntityBundle<GenerationRunBundleValidationContext>(expectedRevision, (existing) => {
      validateGenerationRunBundle(bundle, existing)
      return generationBundleEntityEntries(bundle)
    }, (db) => readGenerationBundleValidationContext(db, bundle.jobId))
  }

  async saveChapterCommitBundle(bundle: ChapterCommitBundle, expectedRevision?: string, onWriteStarted?: () => void): Promise<StorageWriteResult> {
    return this.saveEntityBundle<AppData>(expectedRevision, (existing) => {
      const nextData = applyChapterCommitBundleToAppData(existing, bundle)
      return nextData === existing ? [] : chapterCommitEntityEntries(bundle, nextData)
    }, (db) => this.readChapterCommitContext(db, bundle, this.strict), onWriteStarted)
  }

  async saveRevisionCommitBundle(bundle: RevisionCommitBundle, expectedRevision?: string, onWriteStarted?: () => void): Promise<StorageWriteResult> {
    return this.saveEntityBundle<AppData>(expectedRevision, (existing) => {
      const nextData = applyRevisionCommitBundleToAppData(existing, bundle)
      return nextData === existing ? [] : revisionCommitEntityEntries(bundle, nextData)
    }, (db) => this.readRevisionCommitContext(db, bundle, this.strict), onWriteStarted)
  }

  async recordChapterWritebackFailureIfUncommitted(row: ChapterWritebackFailure): Promise<void> {
    const failure = normalizeChapterWritebackFailure(row)
    if (!failure) return
    const db = await this.open()
    const receiptCollection = failure.kind === 'chapter_commit' ? 'chapterCommitBundles' : 'revisionCommitBundles'
    const updatedAt = nowIso()
    db.transaction(() => {
      // Check absence as part of the INSERT, after rollback and serialized with competing writers.
      const result = db.prepare(`INSERT INTO entities (
        collection, id, project_id, chapter_id, job_id, character_id, chapter_order, title, updated_at, json
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM entities WHERE collection = 'projects' AND id = ?)
          AND NOT EXISTS (SELECT 1 FROM entities WHERE (collection, id) IN (
            (?, ?), ('chapterVersions', ?), ('chapterWritebackFailures', ?)
          ))`).run(...entityInsertValues({ collection: 'chapterWritebackFailures', value: failure }, 0, updatedAt),
          failure.projectId, receiptCollection, failure.commitId, failure.versionId, failure.id) as { changes: number }
      if (result.changes) this.writeRevisionMeta(db, `${updatedAt}-${randomUUID()}`, updatedAt)
    })()
  }

  async executeCandidateDecision(command: CandidateDecisionCommand, expectedRevision?: string): Promise<CandidateDecisionWriteResult> {
    return executeSqliteCandidateDecision(await this.open(), this.storagePath, command, expectedRevision)
  }

  async reviewCharacterCard(command: CharacterCardReviewCommand, expectedRevision: string): Promise<CharacterCardReviewWriteResult> {
    if (!expectedRevision) throw new StorageRevisionConflictError()
    let character!: Character
    const saved = await this.saveEntityBundle(expectedRevision, (data: AppData) => {
      character = applyCharacterCardReview(data, command, nowIso())
      return [{ collection: 'characters', value: character }]
    }, db => normalizeAppData(readAppDataCollectionsFromDatabase(db, CHARACTER_CARD_REVIEW_COLLECTIONS, command.projectId)))
    return { ...saved, character }
  }

  async renameChapterTitles(commit: ChapterTitleCommit, actor: ChapterTitleActor): Promise<ChapterTitleWriteResult> {
    const db = await this.open()
    return db.transaction((): ChapterTitleWriteResult => {
      const snapshot = readSqliteChapterTitles(db, commit.command.projectId)
      const { receipt, replayed } = decideChapterTitleCommit(snapshot.state, commit, this.storagePath, snapshot.revision, actor,
        () => sqliteTitleVersionIds(db, snapshot.state.projectId))
      let revision = snapshot.revision
      if (!replayed) {
        const update = db.prepare(`UPDATE entities SET title = ?, updated_at = ?,
          json = json_set(json, '$.title', ?, '$.updatedAt', ?)
          WHERE collection = 'chapters' AND project_id = ? AND id = ? AND chapter_order = ?
            AND json_extract(json, '$.title') = ?`)
        for (const row of receipt.rows) {
          if (row.oldTitle === row.newTitle) continue
          const { changes } = update.run(row.newTitle, receipt.createdAt, row.newTitle, receipt.createdAt,
            receipt.projectId, row.chapterId, row.chapterOrder, row.oldTitle) as { changes: number }
          if (changes !== 1) throw new StorageRevisionConflictError()
        }
        this.writeEntityEntries(db, [{ collection: 'chapterTitleReceipts', value: receipt }], receipt.createdAt, false)
        revision = `${receipt.createdAt}-${randomUUID()}`
        this.writeRevisionMeta(db, revision, receipt.createdAt)
      }
      return { ok: true, storagePath: this.storagePath, revision, updatedAt: receipt.createdAt,
        savedCollections: replayed ? [] : ['chapters', 'chapterTitleReceipts'], receipt, replayed }
    })()
  }

  private async saveEntityBundle<TContext>(
    expectedRevision: string | undefined,
    buildEntries: (existing: TContext) => SqliteEntityEntry[],
    readExisting: (db: SqliteDatabase) => TContext,
    onWriteStarted?: () => void
  ): Promise<StorageWriteResult> {
    const db = await this.open()
    const updatedAt = nowIso()
    const revision = `${updatedAt}-${randomUUID()}`
    let persistedRevision = revision
    let entries: SqliteEntityEntry[] = []

    const writeTransaction = db.transaction(() => {
      this.assertExpectedRevision(db, expectedRevision)
      const existing = readExisting(db)
      entries = buildEntries(existing)
      if (entries.length === 0) {
        persistedRevision = this.currentRevision(db)
        return
      }
      onWriteStarted?.()
      this.writeEntityEntries(db, entries, updatedAt, true)
      this.writeRevisionMeta(db, revision, updatedAt)
    })

    writeTransaction()
    return {
      ok: true,
      storagePath: this.storagePath,
      revision: persistedRevision,
      updatedAt,
      savedCollections: [...new Set(entries.map((entry) => entry.collection))]
    }
  }

  private writeEntityEntries(
    db: SqliteDatabase,
    entries: SqliteEntityEntry[],
    updatedAt: string,
    replace: boolean
  ): void {
    if (entries[0]?.collection === 'chapterCommitBundles' || entries[0]?.collection === 'revisionCommitBundles') {
      ensureReceiptIndexes(db)
    }
    const insertSql = replace
      ? `INSERT OR REPLACE INTO entities (
          collection, id, project_id, chapter_id, job_id, character_id,
          chapter_order, title, updated_at, json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      : `INSERT INTO entities (
          collection, id, project_id, chapter_id, job_id, character_id,
          chapter_order, title, updated_at, json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    const statement = db.prepare(insertSql)
    const collectionIndexes = new Map<AppDataArrayKey, number>()

    for (const entry of entries) {
      const index = collectionIndexes.get(entry.collection) ?? 0
      statement.run(...entityInsertValues(entry, index, updatedAt))
      collectionIndexes.set(entry.collection, index + 1)
    }
  }

  private writeRevisionMeta(db: SqliteDatabase, revision: string, updatedAt: string): void {
    const upsertMeta = db.prepare(
      `INSERT OR REPLACE INTO meta (key, value)
       VALUES (?, ?)`
    )
    upsertMeta.run('revision', revision)
    upsertMeta.run('updatedAt', updatedAt)
  }

  private currentRevision(db: SqliteDatabase): string { return currentRevisionFromDatabase(db) }

  private assertExpectedRevision(db: SqliteDatabase, expectedRevision?: string): void {
    if (expectedRevision !== undefined && this.currentRevision(db) !== expectedRevision) {
      throw new StorageRevisionConflictError()
    }
  }

  close(): void {
    this.initialization.close()
  }

  private async open(): Promise<SqliteDatabase> {
    const db = await this.initialization.open()
    await this.initialization.ensureSnapshot(db)
    return db
  }

  private readonly readChapterCommitContext = readChapterCommitContext
  private readonly readRevisionCommitContext = readRevisionCommitContext
}

function libraryStorage(filePath: string, mode: 'existing' | 'new', initialData?: AppData): StorageService {
  const path = resolve(filePath)
  switch (extname(path).toLowerCase()) {
    case '.json': return new JsonStorageService(path, mode, initialData)
    case '.sqlite':
    case '.db': return new SqliteStorageService(path, { mode, initialData })
    default: throw new Error('书库文件扩展名必须是 .sqlite、.db 或 .json。')
  }
}

export function createExistingLibraryStorage(filePath: string): StorageService {
  return libraryStorage(filePath, 'existing')
}

/** The caller owns an exclusively reserved (wx), zero-byte file at this exact path. */
export function createNewLibraryStorage(filePath: string, initialData?: AppData): StorageService {
  return libraryStorage(filePath, 'new', initialData)
}

/** Legacy Agent/migration compatibility. Desktop library selection must use the explicit factories above. */
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
