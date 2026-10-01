import type { QuickRewriteDraft } from '../types/quickRewrite'

export function normalizeQuickRewriteDrafts(value: unknown): QuickRewriteDraft[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is QuickRewriteDraft => {
    if (!item || typeof item !== 'object') return false
    const selection = item.selection
    return typeof item.id === 'string' && Boolean(item.id.trim()) && typeof item.projectId === 'string' && Boolean(item.projectId.trim()) &&
      ['chapter', 'reader_edit', 'revision_version'].includes(item.targetKind) &&
      (item.targetKind === 'revision_version' ? typeof item.revisionVersionId === 'string' && Boolean(item.revisionVersionId.trim()) : typeof item.chapterId === 'string' && Boolean(item.chapterId.trim())) &&
      typeof item.sourceBody === 'string' && typeof item.text === 'string' &&
      selection && typeof selection.text === 'string' && selection.text.trim().length > 0 &&
      Number.isInteger(selection.start) && Number.isInteger(selection.end) && selection.start >= 0 &&
      selection.end > selection.start && selection.end <= item.sourceBody.length &&
      item.sourceBody.slice(selection.start, selection.end) === selection.text
  }).map((item) => ({
    id: item.id, projectId: item.projectId, targetKind: item.targetKind,
    chapterId: item.targetKind === 'revision_version' ? null : item.chapterId,
    revisionVersionId: item.targetKind === 'revision_version' ? item.revisionVersionId : null,
    sourceBody: item.sourceBody, selection: { start: item.selection.start, end: item.selection.end, text: item.selection.text }, text: item.text,
    scope: item.scope === 'chapter' ? 'chapter' : 'selection', label: typeof item.label === 'string' ? item.label : '快捷重写',
    usedAI: item.usedAI === true, createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : ''
  }))
}
