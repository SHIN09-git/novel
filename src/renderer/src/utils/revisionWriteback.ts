import type { AppData, Chapter, ChapterVersion, GeneratedChapterDraft, ID, RevisionVersion } from '../../../shared/types'
import { invalidateDraftDiagnosticsAfterChange } from '../../../services/DraftDiagnosticBindingService'
import { assertRevisionSourceMatches } from '../../../services/RevisionSourceBindingService'

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
  assertRevisionSourceMatches(version, source.kind === 'draft' ? source.draft.body : source.chapter.body,
    source.kind === 'draft' ? source.linkedChapter?.body : source.chapter.body)
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

  const invalidated = invalidateDraftDiagnosticsAfterChange(base, source.draft.id, version.body, timestamp)
  const nextDrafts = invalidated.generatedChapterDrafts.map((draft) =>
    draft.id === source.draft.id && draft.projectId === projectId
      ? { ...draft, body: version.body, status: source.linkedChapter ? 'accepted' as const : 'draft' as const, updatedAt: timestamp }
      : draft
  )

  if (!source.linkedChapter) {
    return {
      data: {
        ...invalidated,
        generatedChapterDrafts: nextDrafts
      },
      wroteChapter: false,
      updatedDraftId: source.draft.id,
      createdChapterVersion: false,
      message: '修订已应用到草稿，尚未正式采纳为章节。请返回流水线重新审稿后接受。'
    }
  }

  const snapshot = chapterSnapshot(projectId, source.linkedChapter, version, timestamp)
  return {
    data: {
      ...invalidated,
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
