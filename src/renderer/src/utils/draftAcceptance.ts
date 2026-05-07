import type { Chapter, ChapterVersion, ID } from '../../../shared/types'
import { newId } from './format'

export function createChapterVersionBeforeAcceptDraft(
  chapter: Chapter,
  projectId: ID,
  timestamp: string
): ChapterVersion {
  return {
    id: newId(),
    projectId,
    chapterId: chapter.id,
    source: 'before_accept_draft',
    title: chapter.title,
    body: chapter.body,
    note: '接受 AI 草稿覆盖已有章节前自动保存。',
    createdAt: timestamp
  }
}
