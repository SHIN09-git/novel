import type { SqliteDatabase } from './sqliteTypes'

const aliases = {
  chapterCommitBundles: "json_extract(json, '$.commitId')",
  revisionCommitBundles: "json_extract(json, '$.revisionCommitId')"
} as const
type Collection = keyof typeof aliases

// Normal writers require id === commitId. Only imported noncanonical keys need an index entry.
function predicate(key: Collection) { return `collection = '${key}' AND id <> ${aliases[key]}` }

export function ensureReceiptIndexes(db: SqliteDatabase) {
  for (const key of Object.keys(aliases) as Collection[]) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_alias_${key} ON entities(${aliases[key]}) WHERE ${predicate(key)}`)
  }
}

export function receiptKeys(db: SqliteDatabase, key: Collection, id: string) {
  const rows = db.prepare(`SELECT id FROM entities WHERE ${predicate(key)} AND ${aliases[key]} = ?`).all(id)
  return [id, ...rows.map(row => String(row.id))]
}
