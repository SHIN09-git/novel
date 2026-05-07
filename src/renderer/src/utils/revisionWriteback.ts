import type { AppData, Chapter, ChapterVersion, GeneratedChapterDraft, ID, RevisionVersion } from '../../../shared/types'

export type RevisionWritebackSource =
  | { kind: 'chapter'; chapter: Chapter }
  | { kind: 'draft'; draft: GeneratedChapterDraft; linkedChapter: Chapter | null }

export interface RevisionWritebackResult {
  data: AppData
  wroteChapter: boolean
  updatedDraftId: ID | null
  createdChapterVersion: boolean
  message: string
}

export function resolveDraftLinkedChapter(draft: GeneratedChapterDraft | null | undefined, chapters: Chapter[]): Chapter | null {
  if (!draft?.chapterId) return null
  return chapters.find((chapter) => chapter.id === draft.chapterId) ?? null
}

function updateProjectTimestamp(data: AppData, projectId: ID, timestamp: string) {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: timestamp } : project))
}

function acceptRevisionMetadata(data: AppData, version: RevisionVersion, timestamp: string): AppData {
  return {
    ...data,
    revisionSessions: data.revisionSessions.map((session) =>
      session.id === version.sessionId ? { ...session, status: 'completed', updatedAt: timestamp } : session
    ),
    revisionVersions: data.revisionVersions.map((item) =>
      item.id === version.id ? { ...item, body: version.body, status: 'accepted', updatedAt: timestamp } : item
    )
  }
}

function chapterSnapshot(projectId: ID, chapter: Chapter, version: RevisionVersion, timestamp: string): ChapterVersion {
  return {
    id: crypto.randomUUID(),
    projectId,
    chapterId: chapter.id,
    source: 'revision_accept',
    title: chapter.title,
    body: chapter.body,
    note: `接受修订版本前自动保存：${version.title}`,
    createdAt: timestamp
  }
}

export function applyAcceptedRevisionWriteback(
  data: AppData,
  projectId: ID,
  source: RevisionWritebackSource,
  version: RevisionVersion,
  timestamp: string
): RevisionWritebackResult {
  const base = acceptRevisionMetadata(
    {
      ...data,
      projects: updateProjectTimestamp(data, projectId, timestamp)
    },
    version,
    timestamp
  )

  if (source.kind === 'chapter') {
    const snapshot = chapterSnapshot(projectId, source.chapter, version, timestamp)
    return {
      data: {
        ...base,
        chapters: base.chapters.map((chapter) =>
          chapter.id === source.chapter.id ? { ...chapter, body: version.body, updatedAt: timestamp } : chapter
        ),
        chapterVersions: [snapshot, ...base.chapterVersions]
      },
      wroteChapter: true,
      updatedDraftId: null,
      createdChapterVersion: true,
      message: '已接受修订版本，旧正文已保存到章节版本历史。'
    }
  }

  const nextDrafts = base.generatedChapterDrafts.map((draft) =>
    draft.id === source.draft.id
      ? { ...draft, body: version.body, status: 'accepted' as const, updatedAt: timestamp }
      : draft
  )

  if (!source.linkedChapter) {
    return {
      data: {
        ...base,
        generatedChapterDrafts: nextDrafts
      },
      wroteChapter: false,
      updatedDraftId: source.draft.id,
      createdChapterVersion: false,
      message: '已接受修订版本并更新草稿；该草稿尚未关联章节，请先在流水线中接受/创建章节后再写入正文。'
    }
  }

  const snapshot = chapterSnapshot(projectId, source.linkedChapter, version, timestamp)
  return {
    data: {
      ...base,
      generatedChapterDrafts: nextDrafts,
      chapters: base.chapters.map((chapter) =>
        chapter.id === source.linkedChapter?.id ? { ...chapter, body: version.body, updatedAt: timestamp } : chapter
      ),
      chapterVersions: [snapshot, ...base.chapterVersions]
    },
    wroteChapter: true,
    updatedDraftId: source.draft.id,
    createdChapterVersion: true,
    message: '已接受草稿修订版本，同步更新草稿与关联章节，旧章节正文已保存到版本历史。'
  }
}
