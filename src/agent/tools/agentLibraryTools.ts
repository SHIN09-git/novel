import { existsSync } from 'node:fs'
import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { parseProjectTextPatch, planProjectEdit, PROJECT_TEXT_FIELDS, type ProjectEdit } from '../../services/LibraryProjectService'
import { normalizeAppData } from '../../shared/defaults'
import { loadSqliteCollectionsReadonly } from '../../storage/SqliteStorageService'
import { resolveSqliteStoragePath } from '../../storage/StorageService'
import { loadAgentRuntimeData, resolveAgentRuntimeStoragePath, saveAgentRuntimeData } from '../AgentRuntime'
import { findProjectId, requiredString, stringArg } from './agentToolArguments'
import { redactCandidateValue } from './agentCandidateDecisionOutput'
import type { AppData } from '../../shared/types'
import type { AgentToolCallResult, AgentToolDefinition, JsonSchema } from './agentToolTypes'

const authTool = 'agent.getLibraryAuthorization', historyTool = 'agent.getLibraryActionHistory'
const previewTool = 'agent.previewProjectAction', applyTool = 'agent.applyProjectAction'
const libraryTools = new Set([authTool, historyTool, previewTool, applyTool])
const str = { type: 'string', minLength: 1 }
const storageArgs = { storagePath: str, userDataPath: str }
const scopeArgs = { projectId: str, project: str }
const actionArgs = { ...scopeArgs, action: { enum: ['update', 'archive', 'restore', 'revert'] }, operationId: str, reason: str,
  patch: { type: 'object', additionalProperties: false, minProperties: 1,
    properties: Object.fromEntries(PROJECT_TEXT_FIELDS.map(field => [field, { type: 'string' }])) },
  restoreOperationId: str }
const historyArgs = { ...scopeArgs, limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0 } }

function schema(properties: JsonSchema, required: string[] = []): JsonSchema {
  return { type: 'object', additionalProperties: false, properties: { ...storageArgs, ...properties }, required }
}

const requiredActionArgs = ['action', 'operationId', 'reason']
export const AGENT_LIBRARY_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  { name: authTool, riskLevel: 'read', annotations: { readOnlyHint: true },
    description: 'Check whether the desktop author granted library management for the current data file. Cannot grant or revoke.', inputSchema: schema({}) },
  { name: historyTool, riskLevel: 'read', annotations: { readOnlyHint: true },
    description: 'List signed-off Agent project creation, metadata edits, archives and restores across the library. Read one exact receipt with agent.getWorldActionReceipt.',
    inputSchema: schema(historyArgs) },
  { name: previewTool, riskLevel: 'read', annotations: { readOnlyHint: true },
    description: 'Preview an update to project metadata, an archive, a restore, or a revert of a previous project action. Archives retain all manuscript, versions and runs. Read-only and never uses AI.',
    inputSchema: schema(actionArgs, requiredActionArgs) },
  { name: applyTool, riskLevel: 'write_commit',
    description: 'Apply the exact project preview under active library rights. Use patch for update; use restoreOperationId for revert. The project and before/after receipt are saved atomically.',
    inputSchema: schema({ ...actionArgs, expectedFingerprint: str }, [...requiredActionArgs, 'expectedFingerprint']) }
]

function checkFields(args: Record<string, unknown>, fields: JsonSchema) {
  if (Object.keys(args).some(key => !Object.hasOwn(storageArgs, key) && !Object.hasOwn(fields, key))) {
    throw new Error('书库管理请求含有不支持的字段。')
  }
}

function projectEdit(data: AppData, args: Record<string, unknown>): ProjectEdit {
  const common = { projectId: findProjectId(data, args), operationId: requiredString(args, 'operationId'), reason: requiredString(args, 'reason') }
  if (args.action === 'update' && args.restoreOperationId === undefined) {
    return { ...common, action: 'update', patch: parseProjectTextPatch(args.patch) }
  }
  if (args.action === 'revert' && args.patch === undefined) {
    return { ...common, action: 'revert', restoreOperationId: requiredString(args, 'restoreOperationId') }
  }
  if ((args.action === 'archive' || args.action === 'restore') && args.restoreOperationId === undefined && args.patch === undefined) {
    return { ...common, action: args.action }
  }
  throw new Error('请按项目操作提供相应的资料或原操作编号。')
}

function readHistory(data: AppData, args: Record<string, unknown>) {
  const limit = args.limit ?? 20, offset = args.offset ?? 0
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('无效的书库历史分页参数。')
  const projectId = args.projectId !== undefined || args.project !== undefined ? findProjectId(data, args) : null
  const names = new Map(data.projects.map(project => [project.id, project.name]))
  const records = data.worldManagementReceipts.filter(item => item.entity === 'project' && (!projectId || item.projectId === projectId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  return { total: records.length, offset, nextOffset: offset + limit < records.length ? offset + limit : null,
    receipts: records.slice(offset, offset + limit).map(item => ({
      projectId: item.projectId, projectName: names.get(item.projectId) ?? item.after.name, operationId: item.operationId,
      action: item.action, reason: item.source.reason.slice(0, 240), createdAt: item.createdAt,
      restoredFromOperationId: item.source.restoredFromOperationId,
      read: { tool: 'agent.getWorldActionReceipt', arguments: { projectId: item.projectId, operationId: item.operationId, detail: 'full',
        ...(args.storagePath ? { storagePath: args.storagePath } : {}), ...(args.userDataPath ? { userDataPath: args.userDataPath } : {}) } }
    })) }
}

async function loadLibrary(args: Record<string, unknown>, name: string) {
  const options = { storagePath: stringArg(args, 'storagePath'), userDataPath: stringArg(args, 'userDataPath') }
  if (name !== applyTool) {
    const paths = await resolveAgentRuntimeStoragePath(options)
    const sqlite = resolveSqliteStoragePath(paths.storagePath)
    if (existsSync(sqlite)) {
      const result = await loadSqliteCollectionsReadonly(sqlite, name === authTool ? [] : ['projects', 'worldManagementReceipts'])
      return { data: normalizeAppData(result.data), ...paths, storagePath: sqlite, source: 'sqlite' as const, revision: result.revision }
    }
  }
  return loadAgentRuntimeData(options)
}

export async function handleAgentLibraryTool(name: string, args: Record<string, unknown>): Promise<AgentToolCallResult | null> {
  if (!libraryTools.has(name)) return null
  checkFields(args, name === authTool ? {} : name === historyTool ? historyArgs
    : name === applyTool ? { ...actionArgs, expectedFingerprint: str } : actionArgs)
  const runtime = await loadLibrary(args, name)
  const { data, storagePath, userDataPath } = runtime
  if (!storagePath) throw new Error('没有当前书库。')
  const authority = new AgentAuthorizationService(userDataPath)
  const output = (value: unknown) => ({ tool: name, ok: true as const,
    storage: { storagePath, userDataPath, source: runtime.source, revision: runtime.revision }, data: redactCandidateValue(value, data) })
  if (name === authTool) {
    const grant = await authority.getLibraryAuthorization(storagePath)
    return output({ active: Boolean(grant), grantId: grant?.id ?? null, grantedAt: grant?.createdAt ?? null })
  }
  if (name === historyTool) return output(readHistory(data, args))
  const command = projectEdit(data, args)
  if (name === previewTool) {
    const { receipt, replayed } = planProjectEdit(data, command, new Date().toISOString())
    return output({ fingerprint: receipt.previewFingerprint, before: receipt.before, after: receipt.after,
      replayed, authorized: Boolean(await authority.getLibraryAuthorization(storagePath)) })
  }
  const result = await authority.withLibraryAuthorization(storagePath, async grant => {
    const { next, receipt, replayed } = planProjectEdit(data, command, new Date().toISOString())
    if (requiredString(args, 'expectedFingerprint') !== receipt.previewFingerprint) throw new Error('项目资料有变化，请重新预览。')
    if (replayed) return { receipt, replayed: true }
    const authorizedReceipt = { ...receipt, authorizationGrantId: grant.id }
    const saved = await saveAgentRuntimeData({ ...data, projects: data.projects.map(book => book.id === next.id ? next : book),
      worldManagementReceipts: [...data.worldManagementReceipts, authorizedReceipt] }, runtime)
    return { receipt: authorizedReceipt, replayed: false, saved }
  })
  return output(result)
}
