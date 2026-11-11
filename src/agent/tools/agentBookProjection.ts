import { existsSync } from 'node:fs'
import type { AppDataArrayKey } from '../../shared/appDataCollections'
import { normalizeAppData } from '../../shared/defaults'
import { loadSqliteCollectionsReadonly } from '../../storage/SqliteStorageService'
import { loadJsonSnapshotReadonly } from '../../storage/jsonReadonly'
import { resolveSqliteStoragePath } from '../../storage/StorageService'
import { loadAgentRuntimeData, resolveAgentRuntimeStoragePath } from '../AgentRuntime'
import { findProjectId, stringArg } from './agentToolArguments'

export async function loadAgentBookProjection(args: Record<string, unknown>, collections: readonly AppDataArrayKey[]) {
  const selector = stringArg(args, 'projectId') ?? stringArg(args, 'project')
  if (!selector) throw new Error('Missing projectId or project.')
  const explicit = stringArg(args, 'storagePath')
  const paths = await resolveAgentRuntimeStoragePath({ storagePath: explicit, userDataPath: stringArg(args, 'userDataPath') })
  if (explicit && /\.(?:json|db|sqlite)$/i.test(explicit) && !existsSync(paths.storagePath)) {
    throw new Error('Project database not found. 请检查指定的书库路径。')
  }
  if (paths.storagePath.toLowerCase().endsWith('.json') && (explicit || existsSync(paths.storagePath))) {
    const { data, revision } = await loadJsonSnapshotReadonly(paths.storagePath)
    return { data, projectId: findProjectId(data, args), storage: { source: 'json' as const, ...paths, revision } }
  }
  const sqlitePath = resolveSqliteStoragePath(paths.storagePath)
  if (existsSync(sqlitePath)) {
    const snapshot = await loadSqliteCollectionsReadonly(sqlitePath, collections, selector)
    const data = normalizeAppData(snapshot.data)
    return { data, projectId: findProjectId(data, args), storage: { source: 'sqlite' as const, storagePath: sqlitePath,
      userDataPath: paths.userDataPath, revision: snapshot.revision } }
  }
  const { data, ...storage } = await loadAgentRuntimeData(paths)
  return { data, projectId: findProjectId(data, args), storage }
}
