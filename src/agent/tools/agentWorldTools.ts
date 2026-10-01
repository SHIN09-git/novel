import type { AppData, ID } from '../../shared/types'
import { WorldManagementService, type WorldManagedEntity, type WorldManagementCommand, type WorldManagementResult } from '../../services/WorldManagementService'
import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { redactSensitiveText } from '../../shared/errorUtils'
import type { AgentRuntimeData } from '../AgentRuntime'
import { loadAgentRuntimeData, saveAgentRuntimeData } from '../AgentRuntime'
import { findProjectId, readOptions, requiredString, stringArg } from './agentToolArguments'
import type { AgentToolHandlerResult } from './agentToolTypes'

const entities = new Set<WorldManagedEntity>([
  'character', 'character_state', 'foreshadowing', 'timeline_event', 'hard_canon', 'story_direction'
])
const common = ['storagePath', 'userDataPath', 'projectId', 'project']

function fields(args: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new Error(`Unsupported world tool fields: ${unknown.join(', ')}.`)
}

function entity(args: Record<string, unknown>): WorldManagedEntity {
  const value = requiredString(args, 'entity') as WorldManagedEntity
  if (!entities.has(value)) throw new Error(`Unsupported world entity: ${value}`)
  return value
}

function pagination(args: Record<string, unknown>): { limit: number; offset: number } {
  const limit = args.limit === undefined ? 20 : args.limit
  const offset = args.offset === undefined ? 0 : args.offset
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer between 1 and 100.')
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer.')
  return { limit, offset }
}

const stableTextKeys = new Set([
  'id', 'projectId', 'operationId', 'agentRunId', 'authorizationGrantId', 'fingerprint', 'expectedFingerprint',
  'commandFingerprint', 'previewFingerprint', 'entity', 'action', 'status', 'kind', 'sourceType', 'category',
  'priority', 'valueType', 'trackingLevel', 'promptPolicy', 'schemaVersion', 'createdAt', 'updatedAt', 'recordedAt'
])

function isStableText(key: string): boolean {
  return stableTextKeys.has(key) || /(?:^|[A-Z])ids?$/i.test(key)
}

function presentWorldValue(
  value: unknown,
  key: string,
  maxChars: number,
  secrets: Array<string | undefined | null>,
  path = key,
  truncatedFields: string[] = []
): unknown {
  if (typeof value === 'string') {
    const redacted = redactSensitiveText(value, secrets)
    if (isStableText(key) || redacted.length <= maxChars) return redacted
    truncatedFields.push(path)
    return `${redacted.slice(0, maxChars).trim()}...`
  }
  if (Array.isArray(value)) return value.map((item, index) => presentWorldValue(item, key, maxChars, secrets, `${path}[${index}]`, truncatedFields))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) =>
    [childKey, presentWorldValue(child, childKey, maxChars, secrets, `${path}.${childKey}`, truncatedFields)]
  ))
}

function worldOutput(
  value: unknown,
  data: AppData,
  maxChars: number,
  root = 'record'
): { value: unknown; truncatedFields: string[] } {
  const truncatedFields: string[] = []
  return {
    value: presentWorldValue(value, root, maxChars, [data.settings.apiKey], root, truncatedFields),
    truncatedFields
  }
}

function presentWorldActionResult(result: WorldManagementResult['result'], data: AppData): WorldManagementResult['result'] {
  // Keep the persisted receipt and its fingerprints raw; only redact display snapshots.
  const before = result.before === null ? null : worldOutput(result.before, data, Number.MAX_SAFE_INTEGER, 'before').value
  const after = worldOutput(result.after, data, Number.MAX_SAFE_INTEGER, 'after').value
  return { ...result, before, after }
}

function command(data: AppData, args: Record<string, unknown>, requireFingerprint: boolean): WorldManagementCommand {
  fields(args, [...common, 'entity', 'action', 'operationId', 'id', 'patch', 'source', 'expectedFingerprint'])
  const action = requiredString(args, 'action')
  if (!['create', 'update', 'set_status', 'archive'].includes(action)) throw new Error(`Unsupported world action: ${action}`)
  const source = args.source
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('source must be an explicit agent_director object.')
  const patch = args.patch === undefined ? {} : args.patch
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('patch must be an object.')
  const expectedFingerprint = stringArg(args, 'expectedFingerprint')
  if (requireFingerprint && !expectedFingerprint) throw new Error('expectedFingerprint from preview is required.')
  return {
    projectId: findProjectId(data, args), entity: entity(args), action: action as WorldManagementCommand['action'],
    operationId: requiredString(args, 'operationId'), ...(stringArg(args, 'id') ? { id: stringArg(args, 'id') as ID } : {}),
    patch: patch as Record<string, unknown>, source: source as WorldManagementCommand['source'], ...(expectedFingerprint ? { expectedFingerprint } : {})
  }
}

export function getAgentWorldRecords(data: AppData, args: Record<string, unknown>): unknown {
  fields(args, [...common, 'entity', 'detail', 'maxChars', 'limit', 'offset', 'includeArchived'])
  const options = readOptions(args)
  const { limit, offset } = pagination(args)
  if (args.includeArchived !== undefined && typeof args.includeArchived !== 'boolean') throw new Error('includeArchived must be a boolean.')
  const records = WorldManagementService.list(data, findProjectId(data, args), entity(args), args.includeArchived === true)
  const full = options.detail === 'full'
  const maxChars = options.maxChars ?? (full ? Number.MAX_SAFE_INTEGER : 320)
  const page = records.slice(offset, offset + limit).map((record) => worldOutput(record, data, maxChars))
  return {
    projectId: findProjectId(data, args), entity: entity(args), total: records.length, offset,
    nextOffset: offset + limit < records.length ? offset + limit : null,
    records: page.map((item) => item.value),
    truncated: page.some((item) => item.truncatedFields.length > 0),
    truncatedFields: page.flatMap((item) => item.truncatedFields),
    ...(full ? {} : { fullRead: { tool: 'agent.getWorldRecord', detail: 'full', requiredArguments: ['projectId', 'entity', 'id'] } })
  }
}

export function getAgentWorldRecord(data: AppData, args: Record<string, unknown>): unknown {
  fields(args, [...common, 'entity', 'id', 'detail', 'maxChars'])
  const options = readOptions(args)
  const item = WorldManagementService.get(data, findProjectId(data, args), entity(args), requiredString(args, 'id'))
  const output = worldOutput(item, data, options.maxChars ?? (options.detail === 'full' ? Number.MAX_SAFE_INTEGER : 320))
  return {
    projectId: findProjectId(data, args), entity: entity(args), record: output.value,
    truncated: output.truncatedFields.length > 0, truncatedFields: output.truncatedFields,
    ...(options.detail === 'full' ? {} : { fullRead: { tool: 'agent.getWorldRecord', detail: 'full', requiredArguments: ['projectId', 'entity', 'id'] } })
  }
}

export function getAgentWorldActionReceipt(data: AppData, args: Record<string, unknown>): unknown {
  fields(args, [...common, 'operationId', 'detail', 'maxChars'])
  const options = readOptions(args)
  const projectId = findProjectId(data, args)
  const operationId = requiredString(args, 'operationId')
  const receipt = WorldManagementService.getReceipt(data, projectId, operationId)
  const output = worldOutput(receipt, data, options.maxChars ?? (options.detail === 'full' ? Number.MAX_SAFE_INTEGER : 320), 'receipt')
  return {
    projectId, operationId, receipt: output.value,
    truncated: output.truncatedFields.length > 0, truncatedFields: output.truncatedFields,
    ...(options.detail === 'full' ? {} : { fullRead: { tool: 'agent.getWorldActionReceipt', detail: 'full', requiredArguments: ['projectId', 'operationId'] } })
  }
}

export function getAgentWorldActionHistory(data: AppData, args: Record<string, unknown>): unknown {
  fields(args, [...common, 'detail', 'maxChars', 'limit', 'offset'])
  const options = readOptions(args)
  const { limit, offset } = pagination(args)
  const projectId = findProjectId(data, args)
  const receipts = WorldManagementService.listReceipts(data, projectId)
  const maxChars = options.maxChars ?? (options.detail === 'full' ? Number.MAX_SAFE_INTEGER : 320)
  const page = receipts.slice(offset, offset + limit).map((receipt) => worldOutput(receipt, data, maxChars, 'receipt'))
  return {
    projectId, total: receipts.length, offset,
    nextOffset: offset + limit < receipts.length ? offset + limit : null,
    receipts: page.map((item) => item.value),
    truncated: page.some((item) => item.truncatedFields.length > 0),
    truncatedFields: page.flatMap((item) => item.truncatedFields),
    ...(options.detail === 'full' ? {} : { fullRead: { tool: 'agent.getWorldActionReceipt', detail: 'full', requiredArguments: ['projectId', 'operationId'] } })
  }
}

export function previewAgentWorldAction(data: AppData, args: Record<string, unknown>): unknown {
  const worldCommand = command(data, args, false)
  return presentWorldActionResult(WorldManagementService.preview(data, worldCommand), data)
}

export async function applyAgentWorldAction(
  data: AppData,
  args: Record<string, unknown>,
  runtime: AgentRuntimeData
): Promise<unknown> {
  const worldCommand = command(data, args, true)
  const storagePath = runtime.storagePath
  if (!storagePath) throw new Error('No writable Agent runtime storage path is available.')
  return new AgentAuthorizationService(runtime.userDataPath).withAuthorization({
    storagePath, projectId: worldCommand.projectId, actions: ['edit_world']
  }, async (grant) => {
    // The authorization lock covers a fresh snapshot, its validation, and the short CAS save.
    const current = await loadAgentRuntimeData({ storagePath, userDataPath: runtime.userDataPath })
    const currentCommand = {
      ...worldCommand,
      projectId: findProjectId(current.data, { projectId: worldCommand.projectId })
    }
    WorldManagementService.preview(current.data, currentCommand)
    const applied = WorldManagementService.apply(current.data, currentCommand, { authorizationGrantId: grant.id })
    if (applied.result.replayed) {
      Object.assign(runtime, current)
      return { ...presentWorldActionResult(applied.result, current.data), saved: null }
    }
    const saved = await saveAgentRuntimeData(applied.data, current)
    Object.assign(runtime, current)
    return { ...presentWorldActionResult(applied.result, current.data), saved }
  })
}

export async function handleAgentWorldWriteTool(
  name: string,
  args: Record<string, unknown>,
  data: AppData,
  runtime: AgentRuntimeData
): Promise<AgentToolHandlerResult> {
  if (name !== 'agent.applyWorldAction') return { handled: false }
  return { handled: true, payload: await applyAgentWorldAction(data, args, runtime) }
}

export function handleAgentWorldReadTool(name: string, args: Record<string, unknown>, data: AppData): AgentToolHandlerResult {
  if (name === 'agent.getWorldRecords') return { handled: true, payload: getAgentWorldRecords(data, args) }
  if (name === 'agent.getWorldRecord') return { handled: true, payload: getAgentWorldRecord(data, args) }
  if (name === 'agent.getWorldActionReceipt') return { handled: true, payload: getAgentWorldActionReceipt(data, args) }
  if (name === 'agent.getWorldActionHistory') return { handled: true, payload: getAgentWorldActionHistory(data, args) }
  if (name === 'agent.previewWorldAction') return { handled: true, payload: previewAgentWorldAction(data, args) }
  return { handled: false }
}
