import { entityInsertValues } from './sqliteEntityMapper'
import type { AppDataArrayKey, SqliteDatabase, SqliteEntityEntry } from './sqliteTypes'

/** Full AppData semantics, differential physical writes. Called inside the caller's revision-checked transaction. */
export function writeSqliteSnapshotEntities(db: SqliteDatabase, entries: SqliteEntityEntry[], updatedAt: string): void {
  const existingIds = db.prepare('SELECT collection, id FROM entities').all()
  const statement = db.prepare(`
    INSERT INTO entities (
      collection, id, project_id, chapter_id, job_id, character_id,
      chapter_order, title, updated_at, json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(collection, id) DO UPDATE SET
      project_id = excluded.project_id, chapter_id = excluded.chapter_id,
      job_id = excluded.job_id, character_id = excluded.character_id,
      chapter_order = excluded.chapter_order, title = excluded.title,
      updated_at = excluded.updated_at, json = excluded.json
    WHERE entities.json IS NOT excluded.json
      OR entities.project_id IS NOT excluded.project_id
      OR entities.chapter_id IS NOT excluded.chapter_id
      OR entities.job_id IS NOT excluded.job_id
      OR entities.character_id IS NOT excluded.character_id
      OR entities.chapter_order IS NOT excluded.chapter_order
      OR entities.title IS NOT excluded.title
  `)
  const incomingIds = new Map<string, Set<string>>()
  const indexes = new Map<AppDataArrayKey, number>()
  for (const entry of entries) {
    const index = indexes.get(entry.collection) ?? 0
    const values = entityInsertValues(entry, index, updatedAt)
    const id = String(values[1])
    const ids = incomingIds.get(entry.collection) ?? new Set<string>()
    // The old INSERT-only snapshot rejected duplicate IDs; an UPSERT must not silently choose a winner.
    if (ids.has(id)) throw new Error(`Duplicate entity in snapshot: ${entry.collection}/${id}`)
    ids.add(id)
    incomingIds.set(entry.collection, ids)
    indexes.set(entry.collection, index + 1)
    statement.run(...values)
  }
  const remove = db.prepare('DELETE FROM entities WHERE collection = ? AND id = ?')
  for (const row of existingIds) {
    const collection = String(row.collection), id = String(row.id)
    if (!incomingIds.get(collection)?.has(id)) remove.run(collection, id)
  }
}
