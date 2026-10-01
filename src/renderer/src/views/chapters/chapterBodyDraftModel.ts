export type ChapterBodySaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

export type ChapterBodySyncDecision = 'unchanged' | 'acknowledge-save' | 'adopt-external' | 'conflict'

export interface ChapterBodySyncInput {
  incomingBody: string
  baseBody: string
  draftBody: string
  dirty: boolean
}

export function decideChapterBodySync({
  incomingBody,
  baseBody,
  draftBody,
  dirty
}: ChapterBodySyncInput): ChapterBodySyncDecision {
  if (incomingBody === draftBody) return dirty ? 'acknowledge-save' : 'unchanged'
  if (!dirty) return 'adopt-external'
  if (incomingBody === baseBody) return 'unchanged'
  return 'conflict'
}

export const CHAPTER_BODY_SAVE_LABELS: Record<ChapterBodySaveStatus, string> = {
  saved: '正文已保存',
  dirty: '有未保存修改',
  saving: '正在保存',
  error: '保存失败',
  conflict: '检测到外部更新'
}
