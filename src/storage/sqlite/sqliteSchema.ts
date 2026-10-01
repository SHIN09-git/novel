import type { SqliteDatabase } from './sqliteTypes'

export const SQLITE_SCHEMA_VERSION = 1
export const SETTINGS_ROW_ID = 'default'

function assertStaticSql(sql: string, context: string): void {
  // SAFETY: schema SQL is static and contains no user input. Dynamic values use prepared statements.
  if (sql.includes('${') || sql.includes('`${')) {
    throw new Error(`${context}: SQL schema text must not interpolate runtime values.`)
  }
}

export function ensureSqliteSchema(db: SqliteDatabase, appliedAt: string): void {
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
  ).run(SQLITE_SCHEMA_VERSION, appliedAt)
}
