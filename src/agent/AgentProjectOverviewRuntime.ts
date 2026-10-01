import { existsSync } from 'node:fs'
import { normalizeAppData } from '../shared/defaults'
import type { AppData } from '../shared/types'
import { loadSqliteCollectionsReadonly } from '../storage/SqliteStorageService'
import { resolveSqliteStoragePath } from '../storage/StorageService'
import {
  loadAgentRuntimeData, resolveAgentRuntimeStoragePath,
  type AgentRuntimeData, type AgentRuntimeLoadOptions
} from './AgentRuntime'
import { AGENT_PROJECT_OVERVIEW_COLLECTIONS, type AgentProjectOverviewData } from './agentProjectOverviewData'

export type AgentProjectOverviewRuntime = Omit<AgentRuntimeData, 'data'> & { data: AgentProjectOverviewData }

function pickOverview(data: AppData): AgentProjectOverviewData {
  return Object.fromEntries(AGENT_PROJECT_OVERVIEW_COLLECTIONS.map((key) => [key, data[key]])) as AgentProjectOverviewData
}

// No history cache: every call observes the current database revision. This narrow
// result cannot be used as the AppData input of any write or full-detail tool.
export async function loadAgentProjectOverview(
  options: AgentRuntimeLoadOptions = {}
): Promise<AgentProjectOverviewRuntime> {
  const { storagePath, userDataPath } = await resolveAgentRuntimeStoragePath(options)
  const sqlitePath = resolveSqliteStoragePath(storagePath)
  if (existsSync(sqlitePath)) {
    const snapshot = await loadSqliteCollectionsReadonly(sqlitePath, AGENT_PROJECT_OVERVIEW_COLLECTIONS)
    return {
      data: pickOverview(normalizeAppData(snapshot.data)),
      source: 'sqlite', storagePath: sqlitePath, userDataPath, revision: snapshot.revision
    }
  }
  // JSON has no indexed collections. Preserve the legacy reader's parsing, path,
  // revision and empty-directory behavior, but return only the overview shape.
  const runtime = await loadAgentRuntimeData({ storagePath, userDataPath })
  return { ...runtime, data: pickOverview(runtime.data) }
}
