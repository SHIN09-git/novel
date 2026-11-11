import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AppData, ChapterCommitBundle, RevisionCommitBundle } from '../shared/types'
import type { StorageWriteResult } from '../shared/ipc/ipcTypes'
import type { CandidateDecisionCommand } from '../shared/types/candidateDecision'
import { applyCandidateDecisionChanges, CandidateDecisionError, previewCandidateDecisions } from '../services/CandidateDecisionService'
import { previewCandidateDecisionUndo } from '../services/CandidateDecisionUndoService'
import { observeFormalChapterWrites } from '../services/ChapterWritebackFailureService'
import type { FormalChapterCommitWriter, StorageService } from '../storage/StorageService'
import { normalizeAppData } from '../shared/defaults'
import { loadJsonSnapshotReadonly } from '../storage/jsonReadonly'
import { JsonStorageService } from '../storage/JsonStorageService'
import { normalizeLibraryData, parseLibraryJsonValue } from '../storage/libraryValidation'
import { createExistingLibraryStorage, loadSqliteSnapshotReadonly } from '../storage/SqliteStorageService'
import { StorageRevisionConflictError } from '../storage/StorageService'
import { libraryStores, writeNewLibrary } from '../main/libraryFiles'
import { AgentAuthorizationService } from '../main/services/AgentAuthorizationService'
import { candidateDecisionChapterOrders } from './agentAuthorizationScope'
import { resolveAgentRuntimeStoragePath, storageSourceForPath, type AgentLibraryChoice, type AgentRuntimeLoadOptions } from './agentLibraryChoice'

export { resolveAgentRuntimeStoragePath, type AgentRuntimeLoadOptions } from './agentLibraryChoice'

export interface AgentRuntimeData {
  data: AppData
  storagePath: string | null
  userDataPath: string
  source: 'sqlite' | 'json' | 'empty'
  revision: string
  namedJsonInput?: true
}

function isLoadedAgentRuntime(
  runtime: AgentRuntimeData | AgentRuntimeLoadOptions
): runtime is AgentRuntimeData {
  return 'source' in runtime && 'revision' in runtime && 'userDataPath' in runtime
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

export async function loadAgentRuntimeData(options: AgentRuntimeLoadOptions = {}): Promise<AgentRuntimeData> {
  const choice = await resolveAgentRuntimeStoragePath(options)
  const runtime = await loadResolvedAgentRuntime(choice)
  if (choice.source === 'json' && options.storagePath && resolve(options.storagePath) === choice.storagePath) {
    runtime.namedJsonInput = true
  }
  return runtime
}

export async function loadResolvedAgentRuntime(choice: AgentLibraryChoice): Promise<AgentRuntimeData> {
  if (choice.source === 'empty') return { ...choice, data: normalizeAppData({}), revision: '0' }
  if (choice.source === 'json') return { ...choice, ...await loadJsonSnapshotReadonly(choice.storagePath) }
  const sqlitePath = choice.storagePath
  return { ...choice, ...await loadSqliteSnapshotReadonly(sqlitePath) }
}

function boundLibrary(runtime: AgentRuntimeData): AgentLibraryChoice {
  const { storagePath, userDataPath, source } = runtime
  if (!storagePath || source === 'empty') throw new Error('没有已打开的书库。请先在桌面选择已有书库。')
  if (source !== storageSourceForPath(storagePath)) throw new Error(`书库路径与已打开的格式不一致：${storagePath}`)
  return { storagePath, userDataPath, source }
}

export async function reloadAgentRuntimeData(runtime: AgentRuntimeData): Promise<AgentRuntimeData> {
  const fresh = await loadResolvedAgentRuntime(boundLibrary(runtime))
  if (runtime.namedJsonInput) fresh.namedJsonInput = true
  return fresh
}

async function openAgentStorage(runtime: AgentRuntimeData | AgentRuntimeLoadOptions) {
  const choice = isLoadedAgentRuntime(runtime) ? boundLibrary(runtime) : await resolveAgentRuntimeStoragePath(runtime)
  if (choice.source === 'empty') throw new Error(`没有可写入的书库：${choice.storagePath}`)
  return createExistingLibraryStorage(choice.storagePath)
}

async function openSnapshotWriter(runtime: AgentRuntimeData | AgentRuntimeLoadOptions): Promise<Pick<StorageService, 'saveIfCurrent' | 'close'>> {
  try {
    return await openAgentStorage(runtime)
  } catch (error) {
    if (!isLoadedAgentRuntime(runtime) || !runtime.namedJsonInput || runtime.source !== 'json' ||
        !runtime.storagePath || storageSourceForPath(runtime.storagePath) !== 'json' || !/^[a-f0-9]{64}$/.test(runtime.revision)) throw error
    // The explicit CLI accepts older snapshots without storyBibles. Only a full
    // save with the digest of the exact input can upgrade one; never call its legacy load().
    const raw = parseLibraryJsonValue(await readFile(runtime.storagePath, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || 'storyBibles' in raw) throw error
    normalizeLibraryData({ ...raw, storyBibles: [] })
    await access(runtime.storagePath, constants.W_OK)
    return new JsonStorageService(runtime.storagePath)
  }
}

export async function saveAgentRuntimeData(data: AppData, runtime: AgentRuntimeData | AgentRuntimeLoadOptions): Promise<{
  storagePath: string
  source: 'sqlite' | 'json'
  revision: string
}> {
  // Legacy programmatic create-only request, never produced by a CLI/MCP read of a missing file.
  if (isLoadedAgentRuntime(runtime) && runtime.source === 'json' && runtime.storagePath &&
      storageSourceForPath(runtime.storagePath) === 'json' && runtime.revision === 'missing') {
    const { storage, snapshot } = await writeNewLibrary(runtime.storagePath, libraryStores, data)
    try {
      const result = { storagePath: storage.getStoragePath(), source: 'json' as const, revision: snapshot.revision }
      adoptRuntimeWriteResult(runtime, result, data)
      return result
    } finally { storage.close?.() }
  }

  const storage = await openSnapshotWriter(runtime)
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

async function saveAgentFormalCommit(
  runtime: AgentRuntimeData | AgentRuntimeLoadOptions,
  write: (storage: FormalChapterCommitWriter, revision?: string) => Promise<StorageWriteResult>
): Promise<StorageWriteResult> {
  const storage = await openAgentStorage(runtime)
  try {
    const result = await write(observeFormalChapterWrites(storage), isLoadedAgentRuntime(runtime) ? runtime.revision : undefined)
    adoptRuntimeWriteResult(runtime, result)
    return result
  } finally {
    storage.close?.()
  }
}

export async function saveAgentChapterCommitBundle(
  bundle: ChapterCommitBundle,
  runtime: AgentRuntimeData | AgentRuntimeLoadOptions
): Promise<StorageWriteResult> {
  return saveAgentFormalCommit(runtime, (storage, revision) => storage.saveChapterCommitBundle(bundle, revision))
}

export async function saveAgentRevisionCommitBundle(
  bundle: RevisionCommitBundle,
  runtime: AgentRuntimeData | AgentRuntimeLoadOptions
): Promise<StorageWriteResult> {
  return saveAgentFormalCommit(runtime, (storage, revision) => storage.saveRevisionCommitBundle(bundle, revision))
}

export async function saveAgentCandidateDecision(
  command: CandidateDecisionCommand,
  runtime: AgentRuntimeData,
  expectedRevision = runtime.revision
) {
  if (command.actor.kind !== 'agent') throw new Error('Agent candidate commands must use the agent actor.')
  const storage = await openAgentStorage(runtime)
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
    storage.close?.()
  }
}
