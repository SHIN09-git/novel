import type { AppData, ID } from '../../../../shared/types'
import { hasCurrentChapterFragment } from '../../../../shared/chapterStepFragment'

export type BookProgressSource =
  | { kind: 'draft'; draftId: ID; jobId?: ID | null }
  | { kind: 'revision'; versionId: ID; sessionId?: ID; chapterId?: ID }

export interface BookRevisionLocation {
  chapterId: ID | null
  draftId: ID | null
  versionId: ID | null
  requestId?: ID
}

export type BookProgressLocation =
  | { view: 'pipeline'; jobId: ID }
  | { view: 'revision'; source: BookRevisionLocation }

export interface BookProgressNavigation {
  onOpenChapter?: (chapterId: ID) => void
  onOpenSource?: (location: BookProgressLocation) => void
}

export function locateBookProgressSource(data: AppData, projectId: ID, ref: BookProgressSource): BookProgressLocation | null {
  if (ref.kind === 'draft') {
    const draft = data.generatedChapterDrafts.find(d => d.projectId === projectId && d.id === ref.draftId)
    if (!draft || (ref.jobId && ref.jobId !== draft.jobId)) return null
    const job = data.chapterGenerationJobs.find(j => j.projectId === projectId && j.id === draft.jobId)
    // The pipeline displays only the latest draft. Older drafts remain exact sources in the revision studio.
    const latest = job && data.generatedChapterDrafts.filter(d => d.projectId === projectId && d.jobId === job.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))[0]
    if (job && latest?.id === draft.id && !hasCurrentChapterFragment(data.chapterGenerationSteps, job.id, draft)) {
      return { view: 'pipeline', jobId: job.id }
    }
    return { view: 'revision', source: { chapterId: draft.chapterId ?? null, draftId: draft.id, versionId: null } }
  }
  const version = data.revisionVersions.find(v => v.id === ref.versionId && (!ref.sessionId || v.sessionId === ref.sessionId))
  const session = version && data.revisionSessions.find(s => s.id === version.sessionId && s.projectId === projectId)
  if (!version || !session || (session.chapterId && ref.chapterId && session.chapterId !== ref.chapterId)) return null
  const sourceExists = session.sourceDraftId
    ? data.generatedChapterDrafts.some(d => d.projectId === projectId && d.id === session.sourceDraftId)
    : data.chapters.some(c => c.projectId === projectId && c.id === session.chapterId && !c.archivedAt)
  if (!sourceExists) return null
  return { view: 'revision', source: { chapterId: session.chapterId || null, draftId: session.sourceDraftId,
    versionId: version.id, requestId: version.requestId } }
}
