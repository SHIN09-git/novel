import type { ChapterTitleActor, ChapterTitleReceipt } from '../types/chapterTitle'
import { objectOrEmpty } from './common'

const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
export const isTitlePrefixMode = (v: unknown) => v === 'manual' || v === 'keep' || v === 'strip'

export function normalizeChapterTitleReceipts(value: unknown): ChapterTitleReceipt[] {
  if (!Array.isArray(value)) return []
  const result: ChapterTitleReceipt[] = []
  for (const item of value) {
    const r = objectOrEmpty(item), a = objectOrEmpty(r.actor)
    if (r.schemaVersion !== 1 || !text(r.id) || !text(r.operationId) || !text(r.projectId) ||
      !isTitlePrefixMode(r.prefixMode) || !hash(r.commandHash) || !hash(r.previewHash) || !text(r.expectedRevision) ||
      !text(r.createdAt) || !Number.isFinite(Date.parse(r.createdAt)) || !Array.isArray(r.rows) || !r.rows.length) continue
    const actor: ChapterTitleActor | null = a.kind === 'user' ? { kind: 'user' }
      : a.kind === 'agent' && text(a.authorizationGrantId) ? { kind: 'agent', authorizationGrantId: a.authorizationGrantId } : null
    if (!actor) continue
    const rows: ChapterTitleReceipt['rows'] = []
    for (const item of r.rows) {
      const row = objectOrEmpty(item)
      if (!text(row.chapterId) || typeof row.chapterOrder !== 'number' || !Number.isSafeInteger(row.chapterOrder) ||
        row.chapterOrder < 1 || typeof row.oldTitle !== 'string' || !text(row.newTitle) ||
        !Array.isArray(row.priorVersionIds) || !row.priorVersionIds.every(text)) break
      rows.push({ chapterId: row.chapterId, chapterOrder: row.chapterOrder, oldTitle: row.oldTitle, newTitle: row.newTitle,
        priorVersionIds: [...new Set(row.priorVersionIds)] })
    }
    if (rows.length !== r.rows.length || new Set(rows.map(row => row.chapterId)).size !== rows.length) continue
    result.push({ schemaVersion: 1, id: r.id, projectId: r.projectId, operationId: r.operationId, actor, prefixMode: r.prefixMode,
      createdAt: r.createdAt, expectedRevision: r.expectedRevision, commandHash: r.commandHash, previewHash: r.previewHash, rows })
  }
  return result
}
