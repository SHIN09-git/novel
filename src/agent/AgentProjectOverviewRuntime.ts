import { normalizeAppData } from '../shared/defaults'
import type { AppData } from '../shared/types'
import { loadSqliteCollectionsReadonly } from '../storage/SqliteStorageService'
import {
  loadResolvedAgentRuntime, resolveAgentRuntimeStoragePath,
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
  const choice = await resolveAgentRuntimeStoragePath(options, 'overview')
  if (choice.source === 'sqlite') {
    const snapshot = await loadSqliteCollectionsReadonly(choice.storagePath, AGENT_PROJECT_OVERVIEW_COLLECTIONS)
    return {
      ...choice, data: pickOverview(normalizeAppData(snapshot.data)), revision: snapshot.revision
    }
  }
  // JSON has no indexed collections. Preserve the legacy reader's parsing, path,
  // revision and empty-directory behavior, but return only the overview shape.
  const runtime = await loadResolvedAgentRuntime(choice)
  return { ...runtime, data: pickOverview(runtime.data) }
}
