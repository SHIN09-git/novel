import type { AppData, RevisionVersion } from '../shared/types'
import { invalidateDraftDiagnosticsAfterChange } from './DraftDiagnosticBindingService'
import { assertRevisionSourceMatches } from './RevisionSourceBindingService'

/** Applying to a candidate draft is not a Chapter or RevisionCommit write. */
export function applyRevisionToPendingDraft(
  data: AppData, projectId: string, draftId: string, version: RevisionVersion, timestamp: string
): AppData {
  const draft = data.generatedChapterDrafts.find(item => item.id === draftId && item.projectId === projectId)
  if (!draft || draft.status !== 'draft') throw new Error('只能将修订应用到尚未采纳的草稿。')
  const chapter = draft.chapterId && data.chapters.find(item => item.id === draft.chapterId && item.projectId === projectId)
  assertRevisionSourceMatches(version, draft.body, chapter ? chapter.body : undefined)
  if (!version.body.trim()) throw new Error('修订正文为空。')
  const updated = invalidateDraftDiagnosticsAfterChange(data, draftId, version.body, timestamp)
  return {
    ...updated,
    projects: updated.projects.map(item => item.id === projectId ? { ...item, updatedAt: timestamp } : item),
    revisionSessions: updated.revisionSessions.map(item =>
      item.id === version.sessionId ? { ...item, status: 'completed', updatedAt: timestamp } : item),
    revisionVersions: updated.revisionVersions.map(item =>
      item.id === version.id ? { ...item, body: version.body, status: 'accepted', updatedAt: timestamp } : item)
  }
}
