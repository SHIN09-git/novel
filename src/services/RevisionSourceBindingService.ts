import type { Chapter, GeneratedChapterDraft, RevisionSession, RevisionVersion } from '../shared/types'
import { draftContentHash } from './DraftDiagnosticBindingService'

export function assertRevisionSourceMatches(
  version: RevisionVersion,
  sourceBody: string,
  chapterBody?: string
): void {
  if (version.sourceContentHash !== undefined && version.sourceContentHash !== draftContentHash(sourceBody)) {
    throw new Error('修订所依据的正文已变化（sourceContentHash 不匹配），请基于当前正文重新生成修订，避免覆盖新编辑。')
  }
  if (version.sourceChapterContentHash !== undefined &&
    (chapterBody === undefined || version.sourceChapterContentHash !== draftContentHash(chapterBody))) {
    throw new Error('修订所关联的章节已变化或不存在（sourceChapterContentHash 不匹配），请重新确认目标章节并生成修订。')
  }
}

// Resolve the source from persisted records, never from the submitted replacement.
export function assertRevisionSourceRecordsMatch(
  version: RevisionVersion,
  session: RevisionSession,
  chapter: Chapter,
  drafts: readonly GeneratedChapterDraft[]
): void {
  const sourceDraft = session.sourceDraftId
    ? drafts.find((draft) => draft.id === session.sourceDraftId && draft.projectId === chapter.projectId)
    : undefined
  if (version.sourceContentHash !== undefined && session.sourceDraftId && !sourceDraft) {
    throw new Error(`RevisionVersion ${version.id} references a missing source draft.`)
  }
  if (sourceDraft?.chapterId && sourceDraft.chapterId !== chapter.id) {
    throw new Error(`RevisionVersion ${version.id} source draft belongs to another chapter.`)
  }
  assertRevisionSourceMatches(version, sourceDraft?.body ?? chapter.body, chapter.body)
}
