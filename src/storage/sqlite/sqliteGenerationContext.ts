import type { AppData } from '../../shared/types'
import type { GenerationRunBundleValidationContext } from '../../services/GenerationRunBundleService'
import { normalizeAppData } from '../../shared/defaults'
import { asRecord, parseJsonObject } from './sqliteEntityMapper'
import type { SqliteDatabase } from './sqliteTypes'

const validationCollections = [
  'generatedChapterDrafts',
  'consistencyReviewReports',
  'qualityGateReports',
  'editorialVerdicts'
] as const

type ValidationCollection = typeof validationCollections[number]

interface EntityJsonRow {
  collection: ValidationCollection
  json: string
}

/**
 * Reads only persisted records which can satisfy GenerationRunBundle run-trace
 * references. Current writers populate entities.job_id; NULL rows are parsed
 * as a narrowly scoped compatibility path for legacy payloads without it.
 */
export function readGenerationBundleValidationContext(
  db: SqliteDatabase,
  jobId: string
): GenerationRunBundleValidationContext {
  const rows = db.prepare(
    `SELECT collection, json
     FROM entities
     WHERE collection IN (?, ?, ?, ?)
       AND (job_id = ? OR job_id IS NULL)
     ORDER BY collection, id`
  ).all(...validationCollections, jobId) as unknown as EntityJsonRow[]

  const partial: Partial<AppData> = {
    generatedChapterDrafts: [],
    consistencyReviewReports: [],
    qualityGateReports: [],
    editorialVerdicts: []
  }

  for (const row of rows) {
    if (!validationCollections.includes(row.collection) || typeof row.json !== 'string') continue
    const value = parseJsonObject(row.json, null)
    if (asRecord(value).jobId !== jobId) continue
    const values = partial[row.collection] as unknown[]
    values.push(value)
  }

  const normalized = normalizeAppData(partial)
  return {
    generatedChapterDrafts: normalized.generatedChapterDrafts,
    consistencyReviewReports: normalized.consistencyReviewReports,
    qualityGateReports: normalized.qualityGateReports,
    editorialVerdicts: normalized.editorialVerdicts
  }
}
