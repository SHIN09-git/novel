import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { bookReferenceEdit, editStoryBible, STAGE_SUMMARY_FIELDS, STORY_BIBLE_FIELDS, type BookReferenceChange } from '../../services/BookReferenceEditService'
import { decisionFingerprint } from '../../services/candidateDecisionPrimitives'
import { PROJECT_TEXT_FIELDS as projectFields } from '../../services/LibraryProjectService'
import { assertProjectWritable } from '../../services/ProjectLifecycleService'
import { createEmptyHardCanonPack } from '../../shared/defaults'
import { redactSensitiveText } from '../../shared/errorUtils'
import type { Project, WorldManagementReceipt } from '../../shared/types'
import { saveAgentRuntimeData, type AgentRuntimeData } from '../AgentRuntime'
import { findProjectId, requiredString } from './agentToolArguments'
import type { AgentToolDefinition, AgentToolHandlerResult, JsonSchema } from './agentToolTypes'

const text = { type: 'string' }
const identifier = { type: 'string', minLength: 1 }
const storage = { storagePath: identifier, userDataPath: identifier }
const projectScope = { projectId: identifier, project: identifier }
const editProperties = {
  ...projectScope, operationId: identifier, reason: identifier,
  entity: { enum: ['story_bible', 'stage_summary'] }, summaryId: identifier, restoreOperationId: identifier,
  patch: { type: 'object', description: 'Partial saved reference fields; do not supply patch when restoring a previous operation.',
    'x-editable-fields': { story_bible: STORY_BIBLE_FIELDS, stage_summary: STAGE_SUMMARY_FIELDS } }
}
function schema(properties: JsonSchema, required: string[] = [], extra: JsonSchema = {}): JsonSchema {
  return { type: 'object', additionalProperties: false, properties: { ...storage, ...properties }, required, ...extra }
}

export const AGENT_BOOK_CREATIVE_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  { name: 'agent.listBookCreationSlots', riskLevel: 'read', annotations: { readOnlyHint: true },
    description: 'List unused one-book reservations authorized in the desktop book list. Does not grant access or create a book.', inputSchema: schema({}) },
  { name: 'agent.createProject', riskLevel: 'write_commit',
    description: 'Open a new book with library management rights (omit projectId), or use a one-book reservation. The author grant continues to cover the created book. Reuse operationId to replay.',
    inputSchema: schema({ projectId: identifier, operationId: identifier, reason: identifier, name: identifier,
      ...Object.fromEntries(projectFields.slice(1).map(field => [field, text])),
      storyBible: { type: 'object', properties: Object.fromEntries(STORY_BIBLE_FIELDS.map(field => [field, text])), additionalProperties: false }
    }, ['operationId', 'reason', 'name']) },
  { name: 'agent.previewBookReferenceEdit', riskLevel: 'read', annotations: { readOnlyHint: true },
    description: 'Preview a Story Bible update, stage-summary create/update or inverse of a recorded edit. For restore pass restoreOperationId instead of entity/patch; later edits are never replaced implicitly.',
    inputSchema: schema(editProperties, ['operationId', 'reason'], {
      oneOf: [{ required: ['entity', 'patch'], not: { required: ['restoreOperationId'] } },
        { required: ['restoreOperationId'], not: { anyOf: [{ required: ['entity'] }, { required: ['patch'] }, { required: ['summaryId'] }] } }]
    }) },
  { name: 'agent.applyBookReferenceEdit', riskLevel: 'write_commit',
    description: 'Apply an exact Book Reference preview under the author grant. Writes the saved text and its before/after receipt together; no model call.',
    inputSchema: schema({ ...editProperties, expectedFingerprint: identifier }, ['operationId', 'reason', 'expectedFingerprint']) }
]

function checkFields(args: Record<string, unknown>, properties: JsonSchema) {
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(storage, key) && !Object.hasOwn(properties, key)) throw new Error(`不支持的创作参数：${key}。`)
  }
}

function authority(runtime: AgentRuntimeData) {
  if (!runtime.storagePath) throw new Error('没有可写入的书库。')
  return { service: new AgentAuthorizationService(runtime.userDataPath), storagePath: runtime.storagePath }
}

function cleanOutput<T>(value: T, apiKey: string): T {
  if (typeof value === 'string') return redactSensitiveText(value, [apiKey]) as T
  if (Array.isArray(value)) return value.map(item => cleanOutput(item, apiKey)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanOutput(item, apiKey)])) as T
  }
  return value
}

export async function listAgentBookCreationSlots(runtime: AgentRuntimeData, args: Record<string, unknown>) {
  checkFields(args, {})
  const { service, storagePath } = authority(runtime)
  const slots = await service.listBookCreationGrants(storagePath)
  return { slots: slots.filter(slot => slot.status === 'active' && !runtime.data.projects.some(book => book.id === slot.projectId))
    .map(slot => ({ projectId: slot.projectId, grantedAt: slot.createdAt })) }
}

async function createAgentProject(runtime: AgentRuntimeData, args: Record<string, unknown>) {
  checkFields(args, { ...Object.fromEntries(projectFields.map(field => [field, text])), projectId: identifier, operationId: identifier, reason: identifier, storyBible: {} })
  const operationId = requiredString(args, 'operationId')
  const reason = requiredString(args, 'reason')
  const fields = Object.fromEntries(projectFields.map(key => {
    if (args[key] !== undefined && typeof args[key] !== 'string') throw new Error(`${key} 必须是文本。`)
    return [key, key === 'name' ? requiredString(args, 'name') : args[key] ?? '']
  })) as Pick<Project, typeof projectFields[number]>
  const { data } = runtime
  const { service, storagePath } = authority(runtime)
  const slots = await service.listBookCreationGrants(storagePath)
  const active = slots.filter(slot => slot.status === 'active')
  const existingReceipt = data.worldManagementReceipts.find(item => item.entity === 'project' && item.operationId === operationId &&
    active.some(slot => slot.projectId === item.projectId))
  const pending = active.filter(slot => !data.projects.some(book => book.id === slot.projectId))
  const library = args.projectId === undefined && !existingReceipt && await service.getLibraryAuthorization(storagePath)
  if (library && runtime.source === 'empty' && !storagePath.toLowerCase().endsWith('.json')) {
    throw new Error('授权对应的 SQLite 书库未找到，请先在桌面重新打开书库。')
  }
  const projectId = args.projectId === undefined ? existingReceipt?.projectId ??
    (library ? `agent-library-book-${decisionFingerprint(operationId)}` : pending.length === 1 ? pending[0].projectId : null)
    : requiredString(args, 'projectId')
  if (!projectId) throw new Error(pending.length > 1 ? '有多个开书授权，请先读取开书名额并指定 projectId。' : '没有可用的开书授权，请在项目列表授权 Agent 开书。')
  const commandFingerprint = decisionFingerprint({ projectId, operationId, reason, fields, storyBible: args.storyBible })
  const persist = async (grant: { id: string }) => {
    const id = `agent-project-${decisionFingerprint([projectId, operationId])}`
    const prior = data.worldManagementReceipts.find(item => item.id === id)
    if (prior) {
      if (prior.commandFingerprint !== commandFingerprint) throw new Error('已用此操作编号开书，内容不一致。')
      if (!data.projects.some(book => book.id === projectId)) throw new Error('原项目已经不存在。')
      return { projectId, receiptId: prior.id, replayed: true }
    }
    if (data.projects.some(book => book.id === projectId)) throw new Error(library ? '该项目编号已存在。' : '该开书名额已使用。')
    const now = new Date().toISOString()
    const project: Project = { ...fields, id: projectId, createdAt: now, updatedAt: now, lastOpenedAt: null }
    const storyBible = editStoryBible(null, projectId, args.storyBible === undefined ? {} : args.storyBible, now)
    const receipt: WorldManagementReceipt = { id, projectId, operationId, entity: 'project', action: 'create', targetId: projectId,
      source: { kind: 'agent_director', reason }, commandFingerprint, previewFingerprint: commandFingerprint,
      authorizationGrantId: grant.id, before: null, after: { ...project }, createdAt: now, schemaVersion: 1 }
    const saved = await saveAgentRuntimeData({ ...data, projects: [...data.projects, project],
      storyBibles: [...data.storyBibles, storyBible], hardCanonPacks: [...data.hardCanonPacks, createEmptyHardCanonPack(projectId)],
      worldManagementReceipts: [...data.worldManagementReceipts, receipt] }, runtime)
    return { projectId, receiptId: receipt.id, authorizationGrantId: grant.id, replayed: false, saved }
  }
  return library ? service.withLibraryAuthorization(storagePath, persist)
    : service.withAuthorization({ storagePath, projectId, actions: ['edit_world'], purpose: 'book_creation' }, persist)
}

function referenceCommand(runtime: AgentRuntimeData, args: Record<string, unknown>): BookReferenceChange {
  const common = { projectId: findProjectId(runtime.data, args), operationId: requiredString(args, 'operationId'),
    reason: requiredString(args, 'reason') }
  if (args.restoreOperationId !== undefined) {
    if (args.entity !== undefined || args.patch !== undefined || args.summaryId !== undefined) throw new Error('回退资料时只需给出原操作编号。')
    return { ...common, restoreOperationId: requiredString(args, 'restoreOperationId') }
  }
  const { entity, patch } = args
  if (entity !== 'story_bible' && entity !== 'stage_summary') throw new Error('请指定小说圣经或阶段摘要。')
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('patch 必须是对象。')
  if (entity === 'story_bible' && args.summaryId !== undefined) throw new Error('小说圣经不使用摘要编号。')
  return { ...common, entity, patch: patch as Record<string, unknown>,
    ...(args.summaryId === undefined ? {} : { summaryId: requiredString(args, 'summaryId') }) }
}

export function previewAgentBookReferenceEdit(runtime: AgentRuntimeData, args: Record<string, unknown>) {
  checkFields(args, editProperties)
  const { before, after, fingerprint, receipt, replayed } = bookReferenceEdit(runtime.data, referenceCommand(runtime, args), new Date().toISOString())
  return cleanOutput({ before, after, fingerprint, entity: receipt.entity, targetId: receipt.targetId, replayed }, runtime.data.settings.apiKey)
}

async function applyAgentBookReferenceEdit(runtime: AgentRuntimeData, args: Record<string, unknown>) {
  checkFields(args, { ...editProperties, expectedFingerprint: identifier })
  const command = referenceCommand(runtime, args)
  const { service, storagePath } = authority(runtime)
  return service.withAuthorization({ storagePath, projectId: command.projectId, actions: ['edit_world'] }, async grant => {
    assertProjectWritable(runtime.data.projects.find(project => project.id === command.projectId))
    const result = bookReferenceEdit(runtime.data, command, new Date().toISOString())
    if (requiredString(args, 'expectedFingerprint') !== result.fingerprint) throw new Error('资料已变化，请重新预览。')
    if (result.replayed) return { receipt: cleanOutput(result.receipt, runtime.data.settings.apiKey), replayed: true }
    const receipt = { ...result.receipt, authorizationGrantId: grant.id }
    const saved = await saveAgentRuntimeData({ ...result.data,
      worldManagementReceipts: [...result.data.worldManagementReceipts, receipt] }, runtime)
    return { receipt: cleanOutput(receipt, runtime.data.settings.apiKey), replayed: false, saved }
  })
}

export async function handleAgentBookCreativeWrite(
  name: string, args: Record<string, unknown>, runtime: AgentRuntimeData
): Promise<AgentToolHandlerResult> {
  if (name === 'agent.createProject') return { handled: true, payload: await createAgentProject(runtime, args) }
  if (name === 'agent.applyBookReferenceEdit') return { handled: true, payload: await applyAgentBookReferenceEdit(runtime, args) }
  return { handled: false }
}
