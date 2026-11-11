import type { UsageHistory } from '../services/projectUsageHistory'
import { projectUsageHistory } from '../services/projectUsageHistory'
import { buildProjectUsageReport } from '../services/ProjectUsageService'
import { readProjectUsageAttempts } from './projectUsageJournal'
import { loadJsonSnapshotReadonly } from './jsonReadonly'
import { loadSqliteUsageHistoryReadonly, SqliteStorageService } from './SqliteStorageService'
import type { StorageService } from './StorageService'

export async function reportFromHistory(path: string, history: UsageHistory) {
  const {rows, invalidRecords} = await readProjectUsageAttempts(path, history.projectId)
  return buildProjectUsageReport(history, rows, invalidRecords)
}

export async function readProjectUsage(storage: StorageService, projectId: string) {
  const path = storage.getStoragePath()
  const history = storage instanceof SqliteStorageService ? loadSqliteUsageHistoryReadonly(path, projectId).history :
    projectUsageHistory((await loadJsonSnapshotReadonly(path)).data, projectId)
  return reportFromHistory(path, history)
}
