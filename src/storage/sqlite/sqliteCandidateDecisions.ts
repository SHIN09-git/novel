import { randomUUID } from 'node:crypto'
import type { CandidateDecisionCommand } from '../../shared/types'
import type { CandidateDecisionWriteResult } from '../../shared/ipc/ipcTypes'
import {
  candidateDecisionChanges, candidateDecisionRemovals,
  CANDIDATE_DECISION_COLLECTIONS
} from '../../services/CandidateDecisionService'
import { StorageRevisionConflictError } from '../StorageService'
import { applyCandidateDecisionForStorage } from '../JsonStorageService'
import { entityInsertValues } from './sqliteEntityMapper'
import { currentRevisionFromDatabase, readAppDataFromDatabase } from './sqliteSnapshot'
import type { AppDataArrayKey, SqliteDatabase } from './sqliteTypes'

// One short transaction per explicit decision. Receipts and effects commit together.
export function executeSqliteCandidateDecision(db: SqliteDatabase, storagePath: string,
  command: CandidateDecisionCommand, expectedRevision?: string): CandidateDecisionWriteResult {
  return db.transaction(() => {
    const data = readAppDataFromDatabase(db)
    const currentRevision = currentRevisionFromDatabase(db)
    const hasReceipt = data.candidateDecisionReceipts.some((item) => item.id === command.id)
    if (!hasReceipt && expectedRevision !== undefined && currentRevision !== expectedRevision) throw new StorageRevisionConflictError()
    const result = applyCandidateDecisionForStorage(data, command)
    if (result.replayed) return { ok: true as const, storagePath, revision: currentRevision, updatedAt: result.receipt.updatedAt,
      receipt: result.receipt, changes: {}, removedRecords: [], replayed: true, savedCollections: [] }
    const changes = candidateDecisionChanges(data, result.data)
    const removedRecords = candidateDecisionRemovals(data, result.data)
    const deleteStatement = db.prepare('DELETE FROM entities WHERE collection = ? AND id = ?')
    for (const { collection, ids } of removedRecords) {
      const key = CANDIDATE_DECISION_COLLECTIONS.find((item) => item === collection)
      if (!key) throw new Error('Candidate decision cannot remove records from this collection.')
      const before = new Map((data[key] as Array<{ id: string; projectId?: string }>).map((item) => [item.id, item]))
      const afterIds = new Set((result.data[key] as Array<{ id: string }>).map((item) => item.id))
      for (const id of ids) {
        const record = before.get(id)
        if (!record || afterIds.has(id) || (key === 'projects' ? id : record.projectId) !== command.projectId) {
          throw new Error('Candidate decision removal does not match the current project snapshot.')
        }
        deleteStatement.run(collection, id)
      }
    }
    const statement = db.prepare(`INSERT OR REPLACE INTO entities (
      collection, id, project_id, chapter_id, job_id, character_id, chapter_order, title, updated_at, json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const [collection, values] of Object.entries(changes)) {
      for (const value of values as unknown[]) statement.run(...entityInsertValues({ collection: collection as AppDataArrayKey, value }, 0, command.decidedAt))
    }
    const revision = `${new Date().toISOString()}-${randomUUID()}`
    const meta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    meta.run('revision', revision)
    meta.run('updatedAt', command.decidedAt)
    return { ok: true as const, storagePath, revision, updatedAt: command.decidedAt, receipt: result.receipt,
      changes, removedRecords, replayed: false,
      savedCollections: [...new Set([...Object.keys(changes), ...removedRecords.map((item) => item.collection)])] }
  })()
}
