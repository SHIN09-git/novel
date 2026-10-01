import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { AppData, ChapterCommitBundle, RevisionCommitBundle } from '../shared/types'
import type { StorageWriteResult } from '../shared/ipc/ipcTypes'
import type { CandidateDecisionCommand } from '../shared/types/candidateDecision'
import { applyCandidateDecisionChanges, CandidateDecisionError, previewCandidateDecisions } from '../services/CandidateDecisionService'
import { previewCandidateDecisionUndo } from '../services/CandidateDecisionUndoService'
import { normalizeAppData } from '../shared/defaults'
import { JsonStorageService } from '../storage/JsonStorageService'
import { createStorageService, loadSqliteSnapshotReadonly } from '../storage/SqliteStorageService'
import { JSON_DATA_FILE_NAME, SQLITE_DATA_FILE_NAME, resolveJsonStoragePath, resolveSqliteStoragePath, StorageRevisionConflictError } from '../storage/StorageService'
import { AgentAuthorizationService } from '../main/services/AgentAuthorizationService'
import { candidateDecisionChapterOrders } from './agentAuthorizationScope'

export interface AgentRuntimeLoadOptions {
  storagePath?: string
  userDataPath?: string
}

export interface AgentRuntimeData {
  data: AppData
  storagePath: string | null
  userDataPath: string
  source: 'sqlite' | 'json' | 'empty'
  revision: string
}

function isLoadedAgentRuntime(
  runtime: AgentRuntimeData | AgentRuntimeLoadOptions
): runtime is AgentRuntimeData {
  return 'source' in runtime && 'revision' in runtime && 'userDataPath' in runtime
}

function storageSourceForPath(storagePath: string): 'sqlite' | 'json' {
  return storagePath.toLowerCase().endsWith('.json') ? 'json' : 'sqlite'
}

function adoptRuntimeWriteResult(
  runtime: AgentRuntimeData | AgentRuntimeLoadOptions,
  result: Pick<StorageWriteResult, 'storagePath' | 'revision'>,
  data?: AppData
): void {
  if (!isLoadedAgentRuntime(runtime)) return
  runtime.storagePath = result.storagePath
  runtime.source = storageSourceForPath(result.storagePath)
  runtime.revision = result.revision
  if (data) runtime.data = data
}

function defaultUserDataPath(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Novel Director')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Novel Director')
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Novel Director')
}

async function readConfiguredStoragePath(userDataPath: string): Promise<string | null> {
  try {
    const config = JSON.parse(await readFile(join(userDataPath, 'app-config.json'), 'utf-8')) as { storagePath?: unknown }
    return typeof config.storagePath === 'string' && config.storagePath.trim() ? config.storagePath : null
  } catch {
    return null
  }
}

export async function resolveAgentRuntimeStoragePath(options: AgentRuntimeLoadOptions = {}): Promise<{
  storagePath: string
  userDataPath: string
}> {
  const userDataPath = resolve(options.userDataPath ?? defaultUserDataPath())
  const configuredPath = options.storagePath ?? (await readConfiguredStoragePath(userDataPath))
  const storagePath = configuredPath ? resolve(configuredPath) : join(userDataPath, SQLITE_DATA_FILE_NAME)
  return { storagePath, userDataPath }
}

export async function loadAgentRuntimeData(options: AgentRuntimeLoadOptions = {}): Promise<AgentRuntimeData> {
  const { storagePath, userDataPath } = await resolveAgentRuntimeStoragePath(options)
  const sqlitePath = resolveSqliteStoragePath(storagePath)
  const jsonPath = resolveJsonStoragePath(storagePath)

  if (existsSync(sqlitePath)) {
    const snapshot = await loadSqliteSnapshotReadonly(sqlitePath)
    return {
      data: snapshot.data,
      storagePath: sqlitePath,
      userDataPath,
      source: 'sqlite',
      revision: snapshot.revision
    }
  }

  const siblingJsonPath = existsSync(jsonPath) ? jsonPath : join(dirname(sqlitePath), JSON_DATA_FILE_NAME)
  if (existsSync(siblingJsonPath)) {
    const raw = await readFile(siblingJsonPath, 'utf-8')
    const snapshot = {
      data: normalizeAppData(JSON.parse(raw) as Partial<AppData>),
      revision: createHash('sha256').update(raw).digest('hex')
    }
    return {
      data: snapshot.data,
      storagePath: siblingJsonPath,
      userDataPath,
      source: 'json',
      revision: snapshot.revision
    }
  }

  return {
    data: normalizeAppData({}),
    storagePath,
    userDataPath,
    source: 'empty',
    revision: storagePath.toLowerCase().endsWith('.json') ? 'missing' : '0'
  }
}

export async function saveAgentRuntimeData(data: AppData, runtime: AgentRuntimeData | AgentRuntimeLoadOptions): Promise<{
  storagePath: string
  source: 'sqlite' | 'json'
  revision: string
}> {
  const resolved = isLoadedAgentRuntime(runtime)
    ? {
        storagePath: runtime.storagePath ?? (await resolveAgentRuntimeStoragePath({ userDataPath: runtime.userDataPath })).storagePath,
        userDataPath: runtime.userDataPath,
        source: runtime.source
      }
    : {
        ...(await resolveAgentRuntimeStoragePath(runtime)),
        source: 'sqlite' as const
      }

  const rawPath = resolved.storagePath
  const isJson = resolved.source === 'json' || rawPath.toLowerCase().endsWith('.json')
  if (isJson) {
    const jsonPath = resolveJsonStoragePath(rawPath)
    const result = await new JsonStorageService(jsonPath).saveIfCurrent(
      data,
      isLoadedAgentRuntime(runtime) ? runtime.revision : undefined
    )
    adoptRuntimeWriteResult(runtime, result, data)
    return { storagePath: result.storagePath, source: 'json', revision: result.revision }
  }

  const sqlitePath = resolveSqliteStoragePath(rawPath)
  const storage = createStorageService(sqlitePath)
  try {
    const result = await storage.saveIfCurrent(
      data,
      isLoadedAgentRuntime(runtime) ? runtime.revision : undefined
    )
    adoptRuntimeWriteResult(runtime, result, data)
    return {
      storagePath: result.storagePath,
      source: storageSourceForPath(result.storagePath),
      revision: result.revision
    }
  } finally {
    storage.close?.()
  }
}

async function resolveAgentRuntimeSaveTarget(runtime: AgentRuntimeData | AgentRuntimeLoadOptions): Promise<{
  storagePath: string
  userDataPath: string
  source: 'sqlite' | 'json' | 'empty'
}> {
  if (isLoadedAgentRuntime(runtime)) {
    return {
      storagePath: runtime.storagePath ?? (await resolveAgentRuntimeStoragePath({ userDataPath: runtime.userDataPath })).storagePath,
      userDataPath: runtime.userDataPath,
      source: runtime.source
    }
  }
  return {
    ...(await resolveAgentRuntimeStoragePath(runtime)),
    source: 'sqlite'
  }
}

export async function saveAgentChapterCommitBundle(
  bundle: ChapterCommitBundle,
  runtime: AgentRuntimeData | AgentRuntimeLoadOptions
): Promise<StorageWriteResult> {
  const resolved = await resolveAgentRuntimeSaveTarget(runtime)
  const isJson = resolved.source === 'json' || resolved.storagePath.toLowerCase().endsWith('.json')
  if (isJson) {
    const result = await new JsonStorageService(resolveJsonStoragePath(resolved.storagePath)).saveChapterCommitBundle(
      bundle,
      isLoadedAgentRuntime(runtime) ? runtime.revision : undefined
    )
    adoptRuntimeWriteResult(runtime, result)
    return result
  }
  const storage = createStorageService(resolveSqliteStoragePath(resolved.storagePath))
  try {
    const result = await storage.saveChapterCommitBundle(
      bundle,
      isLoadedAgentRuntime(runtime) ? runtime.revision : undefined
    )
    adoptRuntimeWriteResult(runtime, result)
    return result
  } finally {
    storage.close?.()
  }
}

export async function saveAgentRevisionCommitBundle(
  bundle: RevisionCommitBundle,
  runtime: AgentRuntimeData | AgentRuntimeLoadOptions
): Promise<StorageWriteResult> {
  const resolved = await resolveAgentRuntimeSaveTarget(runtime)
  const isJson = resolved.source === 'json' || resolved.storagePath.toLowerCase().endsWith('.json')
  if (isJson) {
    const result = await new JsonStorageService(resolveJsonStoragePath(resolved.storagePath)).saveRevisionCommitBundle(
      bundle,
      isLoadedAgentRuntime(runtime) ? runtime.revision : undefined
    )
    adoptRuntimeWriteResult(runtime, result)
    return result
  }
  const storage = createStorageService(resolveSqliteStoragePath(resolved.storagePath))
  try {
    const result = await storage.saveRevisionCommitBundle(
      bundle,
      isLoadedAgentRuntime(runtime) ? runtime.revision : undefined
    )
    adoptRuntimeWriteResult(runtime, result)
    return result
  } finally {
    storage.close?.()
  }
}

export async function saveAgentCandidateDecision(
  command: CandidateDecisionCommand,
  runtime: AgentRuntimeData,
  expectedRevision = runtime.revision
) {
  if (command.actor.kind !== 'agent') throw new Error('Agent candidate commands must use the agent actor.')
  const resolved = await resolveAgentRuntimeSaveTarget(runtime)
  const isJson = resolved.source === 'json' || resolved.storagePath.toLowerCase().endsWith('.json')
  const storage = isJson
    ? new JsonStorageService(resolveJsonStoragePath(resolved.storagePath))
    : createStorageService(resolveSqliteStoragePath(resolved.storagePath))
  try {
    const current = await storage.loadSnapshot()
    const previous = current.data.candidateDecisionReceipts.find((receipt) => receipt.id === command.id)
    let requiresGrant = false
    if (!previous) {
      // Assess the current storage snapshot; CAS pins it to the short write.
      if (expectedRevision !== runtime.revision || expectedRevision !== current.revision) throw new StorageRevisionConflictError()
      if (command.actor.agentRunId && !current.data.agentRuns.some((run) => run.id === command.actor.agentRunId && run.projectId === command.projectId)) {
        throw new Error(`AgentRun does not belong to project: ${command.actor.agentRunId}`)
      }
      const preview = command.undo
        ? previewCandidateDecisionUndo(current.data, { projectId: command.projectId, receiptId: command.undo.receiptId })
        : previewCandidateDecisions(current.data, command)
      const undoAlreadyApplied = command.undo && 'status' in preview && preview.status === 'already_undone'
      if (preview.requiresConfirmation && !undoAlreadyApplied) {
        requiresGrant = true
      }
    }
    const write = (authorizedCommand: CandidateDecisionCommand) => storage.executeCandidateDecision(authorizedCommand, expectedRevision)
    // The authority lock also serializes revocation with this one short commit.
    // It is never held while a provider generates or reviews prose.
    const result = requiresGrant
      ? await new AgentAuthorizationService(runtime.userDataPath).withAuthorization({
          storagePath: storage.getStoragePath(), projectId: command.projectId,
          chapterOrders: candidateDecisionChapterOrders(current.data, command),
          actions: ['accept_high_risk_candidates']
        }, (grant) => write({ ...command, confirmedHighRisk: true, authorizationGrantId: grant.id })).catch((error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'AGENT_AUTHORIZATION_REQUIRED') {
            throw new CandidateDecisionError('High-risk candidate acceptance or undo requires a trusted human path or an active project grant; client confirmation flags cannot authorize it.', 'AGENT_CANDIDATE_AUTHORIZATION_REQUIRED')
          }
          throw error
        })
      : await write(previous?.authorizationGrantId
          ? { ...command, confirmedHighRisk: true, authorizationGrantId: previous.authorizationGrantId }
          : command)
    if (result.replayed) {
      // A replay returns no deltas but may observe a newer revision. Pair that
      // revision with current data, never authorize a later save of stale data.
      const snapshot = await storage.loadSnapshot()
      adoptRuntimeWriteResult(runtime, { storagePath: result.storagePath, revision: snapshot.revision }, snapshot.data)
    } else {
      adoptRuntimeWriteResult(runtime, result, applyCandidateDecisionChanges(current.data, result.changes, result.removedRecords))
    }
    return result
  } finally {
    if ('close' in storage) storage.close?.()
  }
}
