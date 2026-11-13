import type { AppDataArrayKey } from '../../shared/appDataCollections'
import { normalizeAppData } from '../../shared/defaults'
import { loadSqliteCollectionsReadonly } from '../../storage/SqliteStorageService'
import { loadResolvedAgentRuntime, resolveAgentRuntimeStoragePath } from '../AgentRuntime'
import { findProjectId, stringArg } from './agentToolArguments'

export async function loadAgentBookProjection(args: Record<string, unknown>, collections: readonly AppDataArrayKey[]) {
  const selector = stringArg(args, 'projectId') ?? stringArg(args, 'project')
  if (!selector) throw new Error('Missing projectId or project.')
  const choice = await resolveAgentRuntimeStoragePath({
    storagePath: stringArg(args, 'storagePath'), userDataPath: stringArg(args, 'userDataPath')
  })
  if (choice.source === 'sqlite') {
    const snapshot = await loadSqliteCollectionsReadonly(choice.storagePath, collections, selector)
    const data = normalizeAppData(snapshot.data)
    return { data, projectId: findProjectId(data, args), storage: { ...choice, revision: snapshot.revision } }
  }
  const { data, ...storage } = await loadResolvedAgentRuntime(choice)
  return { data, projectId: findProjectId(data, args), storage }
}
