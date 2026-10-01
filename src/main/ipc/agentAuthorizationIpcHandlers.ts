import { app, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc/ipcChannels'
import type {
  AgentAuthorizationGrantRequest,
  AgentAuthorizationGrantResult,
  AgentAuthorizationListRequest,
  AgentAuthorizationListResult,
  AgentAuthorizationRevokeRequest,
  AgentAuthorizationRevokeResult
} from '../../shared/ipc/ipcTypes'
import {
  AGENT_AUTHORIZATION_ACTIONS,
  type AgentAuthorizationAction
} from '../../shared/types/agentAuthorization'
import { AgentAuthorizationService } from '../services/AgentAuthorizationService'
import { safeIpcHandler } from './safeIpcHandler'
import type { StorageDataOperationContext } from './storageDataOperations'

function projectIdFrom(value: unknown): string {
  if (!value || typeof value !== 'object' || typeof (value as { projectId?: unknown }).projectId !== 'string') {
    throw invalidAuthorizationInput('projectId 不能为空。')
  }
  const projectId = (value as { projectId: string }).projectId.trim()
  if (!projectId) throw invalidAuthorizationInput('projectId 不能为空。')
  return projectId
}

function invalidAuthorizationInput(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'AGENT_AUTHORIZATION_INVALID_INPUT' })
}

function rejectUnknownFields(value: unknown, allowedFields: readonly string[], requestName: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidAuthorizationInput(`${requestName}必须是对象。`)
  const allowed = new Set(allowedFields)
  const unknown = Object.keys(value).filter((field) => !allowed.has(field))
  if (unknown.length) throw invalidAuthorizationInput(`${requestName}包含不支持的字段：${unknown.join('、')}。`)
}

async function trustedProjectSource(context: StorageDataOperationContext, projectId: string): Promise<string> {
  const storage = context.getStorage()
  const data = await storage.load()
  if (!data.projects.some((project) => project.id === projectId)) throw new Error('项目不存在，不能管理项目授权。')
  return storage.getStoragePath()
}

function validActions(value: unknown): AgentAuthorizationAction[] {
  if (!Array.isArray(value) || value.length === 0) throw invalidAuthorizationInput('至少选择一项 Agent 权限。')
  const allowed = new Set<string>(AGENT_AUTHORIZATION_ACTIONS)
  if (value.some((action) => typeof action !== 'string' || !allowed.has(action))) throw invalidAuthorizationInput('包含不支持的 Agent 权限。')
  if (new Set(value).size !== value.length) throw invalidAuthorizationInput('Agent 权限不能重复。')
  return [...value] as AgentAuthorizationAction[]
}

function validChapter(value: unknown): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw invalidAuthorizationInput('章节范围必须是正整数或全部章节。')
  return value as number
}

function validRange(start: unknown, end: unknown): { chapterStart: number | null; chapterEnd: number | null } {
  const chapterStart = validChapter(start)
  const chapterEnd = validChapter(end)
  if (chapterStart !== null && chapterEnd !== null && chapterStart > chapterEnd) throw invalidAuthorizationInput('章节范围的起始章不能大于结束章。')
  return { chapterStart, chapterEnd }
}

export function registerAgentAuthorizationIpcHandlers(
  context: StorageDataOperationContext,
  service = new AgentAuthorizationService(app.getPath('userData'))
): void {
  ipcMain.handle(
    IPC_CHANNELS.AGENT_AUTHORIZATION_LIST,
    safeIpcHandler(async (_event, request: AgentAuthorizationListRequest): Promise<AgentAuthorizationListResult> => {
      rejectUnknownFields(request, ['projectId'], '授权列表请求')
      const projectId = projectIdFrom(request)
      const storagePath = await trustedProjectSource(context, projectId)
      return service.list(storagePath, projectId)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.AGENT_AUTHORIZATION_GRANT,
    safeIpcHandler(async (_event, request: AgentAuthorizationGrantRequest): Promise<AgentAuthorizationGrantResult> => {
      rejectUnknownFields(request, ['projectId', 'actions', 'chapterStart', 'chapterEnd'], '授权授予请求')
      const projectId = projectIdFrom(request)
      const storagePath = await trustedProjectSource(context, projectId)
      const { chapterStart, chapterEnd } = validRange(request.chapterStart, request.chapterEnd)
      return service.grant({
        storagePath,
        projectId,
        actions: validActions(request.actions),
        chapterStart,
        chapterEnd
      })
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.AGENT_AUTHORIZATION_REVOKE,
    safeIpcHandler(async (_event, request: AgentAuthorizationRevokeRequest): Promise<AgentAuthorizationRevokeResult> => {
      rejectUnknownFields(request, ['projectId', 'grantId'], '授权撤回请求')
      const projectId = projectIdFrom(request)
      if (typeof request.grantId !== 'string' || !request.grantId.trim()) throw invalidAuthorizationInput('grantId 不能为空。')
      const storagePath = await trustedProjectSource(context, projectId)
      return service.revoke(request.grantId, storagePath, projectId)
    })
  )
}
