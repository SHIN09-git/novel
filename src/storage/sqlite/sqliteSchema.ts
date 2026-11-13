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

const coreTables = {
  meta: { pk: ['key'], fields: ['value'] },
  app_settings: { pk: ['id'], fields: ['json', 'updated_at'] },
  entities: { pk: ['collection', 'id'], fields: [
    'project_id', 'chapter_id', 'job_id', 'character_id', 'chapter_order', 'title', 'updated_at', 'json'
  ] },
  schema_migrations: { pk: ['version'], fields: ['applied_at'] }
}

export function assertLibrarySchema(db: SqliteDatabase): void {
  const table = db.prepare("SELECT type FROM pragma_table_list WHERE schema = 'main' AND name = ? COLLATE NOCASE")
  const columns = db.prepare('SELECT lower(name) AS name, pk, hidden, "notnull" AS required, dflt_value FROM pragma_table_xinfo(?)')
  for (const [name, { pk, fields }] of Object.entries(coreTables)) {
    const required = [...pk, ...fields]
    const actual = columns.all(name)
    const hasCore = required.every(key => actual.some(row => row.name === key && row.pk === pk.indexOf(key) + 1 && !row.hidden))
    const blocksInsert = actual.some(row => !required.includes(String(row.name)) &&
      (row.pk || (!row.hidden && row.required && row.dflt_value === null)))
    if (table.get(name)?.type !== 'table' || !hasCore || blocksInsert) {
      throw new Error(`SQLite 书库缺少兼容的表结构：${name}。`)
    }
  }
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version LIMIT 2').all()
  if (versions.length !== 1 || versions[0].version !== SQLITE_SCHEMA_VERSION) {
    throw new Error('SQLite 书库的结构版本不受支持。')
  }
}
