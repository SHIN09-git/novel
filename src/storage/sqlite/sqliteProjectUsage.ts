import type { GenerationRunTrace, QualityGateReport } from '../../shared/types'
import { normalizeProjectModelRates } from '../../shared/projectUsagePricing'
import { collectLegacyCalls } from '../../services/projectUsageHistory'
import type { SqliteDatabase } from './sqliteTypes'

/** Project only usage fields. A commit may contain an entire chapter and prompt; do not deserialize those to show a bill. */
export function sqliteUsageHistory(db: SqliteDatabase, id: string) {
  const p = db.prepare("SELECT json_extract(json, '$.modelRates') AS rates FROM entities WHERE collection='projects' AND id=?").get(id)
  if (!p) throw new Error('找不到要统计用量的项目。')
  const jobs = db.prepare("SELECT id,json_extract(json,'$.status') AS status FROM entities WHERE collection='chapterGenerationJobs' AND project_id=?")
    .all(id).map(j => ({ id: String(j.id), status: String(j.status) }))
  const calls = db.prepare(`SELECT project_id AS projectId,job_id AS jobId,json_extract(json,'$.aiCalls') AS payload
    FROM entities WHERE collection='generationRunTraces' AND project_id=?
    UNION ALL SELECT json_extract(json,'$.generationRunTrace.projectId'),json_extract(json,'$.generationRunTrace.jobId'),
    json_extract(json,'$.generationRunTrace.aiCalls') FROM entities WHERE collection IN ('chapterCommitBundles','revisionCommitBundles') AND project_id=?`)
    .all(id, id).filter(r => typeof r.payload === 'string').map(r =>
      ({ projectId: String(r.projectId), jobId: String(r.jobId), aiCalls: JSON.parse(r.payload as string) as GenerationRunTrace['aiCalls'] }))
  const reports = db.prepare(`SELECT project_id AS projectId,job_id AS jobId,json_extract(json,'$.aiTelemetry') AS payload
    FROM entities WHERE collection='qualityGateReports' AND project_id=?
    UNION ALL SELECT json_extract(q.value,'$.projectId'),json_extract(q.value,'$.jobId'),json_extract(q.value,'$.aiTelemetry')
    FROM entities e,json_each(e.json,'$.qualityGateReports') q WHERE e.collection='chapterCommitBundles' AND e.project_id=?`)
    .all(id, id).filter(r => typeof r.payload === 'string').map(r =>
      ({ projectId: String(r.projectId), jobId: String(r.jobId), aiTelemetry: JSON.parse(r.payload as string) as QualityGateReport['aiTelemetry'] }))
  return collectLegacyCalls(id, jobs, normalizeProjectModelRates(typeof p.rates === 'string' ? JSON.parse(p.rates) : []), calls, reports)
}
