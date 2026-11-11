import { existsSync } from 'node:fs'
import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { chapterTitleRows, parseChapterTitleRename, previewChapterTitleRename } from '../../services/ChapterTitleRenameService'
import { JsonStorageService } from '../../storage/JsonStorageService'
import { loadChapterTitlesReadonly, SqliteStorageService } from '../../storage/SqliteStorageService'
import { resolveJsonStoragePath, resolveSqliteStoragePath, StorageRevisionConflictError } from '../../storage/StorageService'
import { resolveAgentRuntimeStoragePath } from '../AgentRuntime'
import { requiredString, stringArg } from './agentToolArguments'
import type { AgentToolCallResult, AgentToolDefinition, JsonSchema } from './agentToolTypes'

const preview = 'agent.previewChapterTitleRename', apply = 'agent.applyChapterTitleRename', history = 'agent.getChapterTitleHistory'
export const isChapterTitleTool = (name: string) => name === preview || name === apply || name === history

export function chapterTitleDefinitions(schema: (properties: JsonSchema, required: string[]) => JsonSchema): AgentToolDefinition[] {
  const str = { type: 'string', minLength: 1 }
  const action = { projectId: str, operationId: str, prefixMode: { enum: ['manual', 'keep', 'strip'] },
    edits: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['chapterId'],
      properties: { chapterId: str, title: { ...str, description: 'Required in manual mode; otherwise omit to transform the existing title.' } } } } }
  return [
    { name: preview, riskLevel: 'write_preview', annotations: { readOnlyHint: true }, inputSchema: schema(action, Object.keys(action)),
      description: 'Read-only preview of one or more official chapter titles. manual uses the entered title, keep preserves the original chapter-number prefix, strip removes it. Returns every chapter order, old/new title, current grant and storage revision. Never calls AI.' },
    { name: apply, riskLevel: 'write_commit', inputSchema: schema({ ...action, expectedRevision: str, expectedPreviewHash: str },
      [...Object.keys(action), 'expectedRevision', 'expectedPreviewHash']),
      description: 'Commit the exact preview (previewHash as expectedPreviewHash) under one current manage_chapters grant covering every chapter. Reuse the operationId and original preview on retry. Title changes and receipt are atomic.' },
    { name: history, riskLevel: 'read', annotations: { readOnlyHint: true },
      inputSchema: schema({ projectId: str, chapterId: str, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['projectId']),
      description: 'Read official title rename receipts, newest first. Filter by chapterId to see just its old and new titles, without reading prose.' }
  ]
}

export async function runChapterTitleTool(name: string, args: Record<string, unknown>): Promise<AgentToolCallResult> {
  const projectId = requiredString(args, 'projectId'), explicit = stringArg(args, 'storagePath')
  const paths = await resolveAgentRuntimeStoragePath({ storagePath: explicit, userDataPath: stringArg(args, 'userDataPath') })
  const sqlite = resolveSqliteStoragePath(paths.storagePath)
  // Never switch an explicitly named file to a sibling book or silently fall back at commit.
  const json = paths.storagePath.toLowerCase().endsWith('.json') || (!explicit && !existsSync(sqlite))
  const storagePath = json ? resolveJsonStoragePath(paths.storagePath) : sqlite
  const { state, revision } = await loadChapterTitlesReadonly(storagePath, projectId)
  const storage = { source: json ? 'json' as const : 'sqlite' as const, storagePath, userDataPath: paths.userDataPath, revision }
  const { storagePath: _path, userDataPath: _profile, ...input } = args
  if (name === history) {
    if (Object.keys(input).some(k => !['projectId', 'chapterId', 'limit', 'offset'].includes(k))) throw new Error('不支持的改名历史查询参数。')
    const chapterId = args.chapterId === undefined ? null : requiredString(args, 'chapterId')
    const limit = args.limit ?? 20, offset = args.offset ?? 0
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('无效的改名历史分页参数。')
    const matches = state.receipts.filter(r => !chapterId || r.rows.some(row => row.chapterId === chapterId && row.oldTitle !== row.newTitle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    return { tool: name, ok: true, storage, data: { projectId, total: matches.length, offset, receipts: matches.slice(offset, offset + limit)
      .map(r => chapterId ? { ...r, rows: r.rows.filter(row => row.chapterId === chapterId) } : r) } }
  }
  const { expectedRevision, expectedPreviewHash, ...fields } = input
  const command = parseChapterTitleRename(name === preview ? input : fields)
  const previous = state.receipts.find(r => r.operationId === command.operationId)
  const authority = new AgentAuthorizationService(paths.userDataPath)
  const scope = () => ({ storagePath, projectId, actions: ['manage_chapters'] as const,
    chapterOrders: (previous?.rows ?? chapterTitleRows(state, command)).map(row => row.chapterOrder) })
  if (name === preview) {
    const grant = await authority.findGrant(scope())
    return { tool: name, ok: true, storage, data: previewChapterTitleRename(state, command, storagePath, revision,
      { kind: 'agent', authorizationGrantId: grant?.id ?? null }) }
  }
  if (typeof expectedRevision !== 'string' || !expectedRevision || typeof expectedPreviewHash !== 'string' || !expectedPreviewHash)
    throw new Error('请提供上次改名预览的 expectedRevision 和 expectedPreviewHash。')
  if (!previous && revision !== expectedRevision) throw new StorageRevisionConflictError()
  const saved = await authority.withAuthorization(scope(), async grant => {
    const store = json ? new JsonStorageService(storagePath) : new SqliteStorageService(storagePath)
    try {
      return await store.renameChapterTitles({ command, expectedRevision, expectedPreviewHash }, { kind: 'agent', authorizationGrantId: grant.id })
    } finally { if ('close' in store) store.close() }
  })
  return { tool: name, ok: true, storage: { ...storage, revision: saved.revision }, data: saved }
}
