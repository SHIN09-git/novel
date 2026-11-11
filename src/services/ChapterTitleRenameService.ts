import { createHash } from 'node:crypto'
import { isTitlePrefixMode } from '../shared/normalizers/chapterTitle'
import type { Chapter, ChapterTitleActor, ChapterTitleCommit, ChapterTitlePreview, ChapterTitleReceipt, ChapterTitleRename, ChapterTitleRow } from '../shared/types'
import { StorageRevisionConflictError } from '../storage/StorageService'
import { stableDecisionJson } from './candidateDecisionPrimitives'

export interface ChapterTitleState {
  projectId: string
  chapters: Pick<Chapter, 'id' | 'order' | 'projectId' | 'title' | 'archivedAt'>[]
  receipts: ChapterTitleReceipt[]
}

export type TitleVersionIndex = Map<string, Set<string>>

const digest = (value: unknown) => createHash('sha256').update(stableDecisionJson(value)).digest('hex')
const prefix = /^\s*第[ \t　]*[0-9０-９零〇一二三四五六七八九十百千万萬亿億两兩壹贰叁肆伍陆柒捌玖拾佰仟]+[ \t　]*章[ \t　]*(?:[：:、.．·\-—][ \t　]*)?/u

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) {
    throw new Error('改名请求含有不支持的字段。')
  }
  return value as Record<string, unknown>
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.includes('\0')) throw new Error('改名缺少有效标识。')
  return value
}

export function parseChapterTitleRename(input: unknown): ChapterTitleRename {
  const raw = object(input, ['projectId', 'operationId', 'prefixMode', 'edits'])
  if (!isTitlePrefixMode(raw.prefixMode) || !Array.isArray(raw.edits) || !raw.edits.length) throw new Error('请选择章节和章号前缀处理方式。')
  const mode = raw.prefixMode
  const seen = new Set<string>()
  const edits = raw.edits.map(item => {
    const edit = object(item, ['chapterId', 'title']), chapterId = id(edit.chapterId)
    if (seen.has(chapterId)) throw new Error('改名列表中不能重复选择同一章。')
    seen.add(chapterId)
    if (edit.title === undefined && mode !== 'manual') return { chapterId }
    if (typeof edit.title !== 'string' || !edit.title.trim() || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(edit.title)) {
      throw new Error('请为所选章节填写非空的单行标题。')
    }
    return { chapterId, title: edit.title.trim() }
  }).sort((a, b) => a.chapterId < b.chapterId ? -1 : 1)
  return { projectId: id(raw.projectId), operationId: id(raw.operationId), prefixMode: mode, edits }
}

function newTitle(old: string, title: string | undefined, mode: ChapterTitleRename['prefixMode']) {
  if (mode === 'manual') return title!
  if (mode === 'keep' && title === undefined) return old
  const stem = (title ?? old).replace(prefix, '').trim()
  const kept = mode === 'keep' ? old.match(prefix)?.[0] ?? '' : ''
  return (kept + stem).trim()
}

export function chapterTitleRows(state: ChapterTitleState, command: ChapterTitleRename): ChapterTitleRow[] {
  if (state.projectId !== command.projectId) throw new Error('改名目标不属于当前项目。')
  const targets = new Map<string, ChapterTitleState['chapters'][number]>()
  const ambiguous = new Set<string>()
  for (const chapter of state.chapters) {
    if (chapter.projectId !== command.projectId) continue
    if (targets.has(chapter.id)) ambiguous.add(chapter.id)
    targets.set(chapter.id, chapter)
  }
  return command.edits.map(edit => {
    const ch = targets.get(edit.chapterId)
    if (!ch || ambiguous.has(ch.id) || ch.archivedAt || !Number.isSafeInteger(ch.order) || ch.order < 1 || typeof ch.title !== 'string') {
      throw new Error('所选正式章节不存在、已归档或不能唯一定位。')
    }
    const title = newTitle(ch.title, edit.title, command.prefixMode)
    if (!title.trim() || /[\r\n\0]/u.test(title)) throw new Error(`第 ${ch.order} 章处理后没有有效标题，请填写新名。`)
    return { chapterId: ch.id, chapterOrder: ch.order, oldTitle: ch.title, newTitle: title }
  }).sort((a, b) => a.chapterOrder - b.chapterOrder || a.chapterId.localeCompare(b.chapterId))
}

export function previewChapterTitleRename(state: ChapterTitleState, input: ChapterTitleRename, storagePath: string,
  revision: string, actor: ChapterTitleActor): ChapterTitlePreview {
  const command = parseChapterTitleRename(input)
  if (state.receipts.some(r => r.operationId === command.operationId)) throw new Error('这次改名已提交。请查看回执或使用新的操作标识。')
  const rows = chapterTitleRows(state, command), authorized = actor.kind === 'user' || Boolean(actor.authorizationGrantId)
  return { projectId: command.projectId, operationId: command.operationId, expectedRevision: revision, rows,
    changedCount: rows.filter(r => r.oldTitle !== r.newTitle).length, authorization: { action: 'manage_chapters', actor, authorized },
    previewHash: authorized ? digest({ type: 'chapter-title-v1', storagePath, revision, command, rows, actor }) : null }
}

/** Called inside one database transaction / JSON file lock. Even a replay must bind the original request. */
export function decideChapterTitleCommit(state: ChapterTitleState, input: ChapterTitleCommit, storagePath: string,
  revision: string, actor: ChapterTitleActor, readVersionIds: () => TitleVersionIndex) {
  const command = parseChapterTitleRename(input.command)
  if (command.projectId !== state.projectId || !input.expectedRevision || !input.expectedPreviewHash ||
    (actor.kind !== 'user' && !actor.authorizationGrantId)) throw new Error('改名需要有效的预览和授权。')
  const commandHash = digest({ command, storagePath, actor })
  const previous = state.receipts.find(r => r.operationId === command.operationId)
  if (previous) {
    if (previous.commandHash !== commandHash || previous.previewHash !== input.expectedPreviewHash ||
      previous.expectedRevision !== input.expectedRevision) throw new Error('操作标识已用于另一份改名预览。')
    return { receipt: previous, replayed: true }
  }
  if (revision !== input.expectedRevision) throw new StorageRevisionConflictError()
  const preview = previewChapterTitleRename(state, command, storagePath, revision, actor)
  if (!preview.previewHash || preview.previewHash !== input.expectedPreviewHash) throw new Error('改名预览已变化，请重新预览标题和权限。')
  if (!preview.changedCount) throw new Error('所选标题没有变化。')
  // Keep the project history ordered even when two batches land in the same millisecond.
  const createdAt = new Date(state.receipts.reduce((ms, r) => Math.max(ms, Date.parse(r.createdAt) + 1), Date.now())).toISOString()
  const versionIds = readVersionIds()
  const receipt: ChapterTitleReceipt = { id: 'chapter-title-' + digest([command.projectId, command.operationId]), schemaVersion: 1,
    projectId: command.projectId, operationId: command.operationId, prefixMode: command.prefixMode, actor, commandHash,
    expectedRevision: revision, previewHash: preview.previewHash, createdAt, rows: preview.rows.map(row => ({
      ...row, priorVersionIds: row.oldTitle === row.newTitle ? [] : [...versionIds.get(row.chapterId) ?? []].sort()
    })) }
  return { receipt, replayed: false }
}
