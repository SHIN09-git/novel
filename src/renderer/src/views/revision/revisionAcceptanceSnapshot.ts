import type { AppData, RevisionVersion } from '../../../../shared/types'
import { canAcceptRevisionVersionStatus } from '../../../../shared/revisionVersionPolicy'
import { projectData } from '../../utils/projectData'
import { resolveDraftLinkedChapter } from '../../utils/revisionWriteback'
import type { RevisionStudioActionContext } from './revisionStudioActionTypes'

// Re-resolve both writeback paths against the text and destination the author confirmed.
export function resolveRevisionAcceptanceTarget(
  current: AppData,
  context: RevisionStudioActionContext,
  confirmedVersion: RevisionVersion
) {
  const scoped = projectData(current, context.project.id)
  const currentVersion = scoped.revisionVersions.find((item) => item.id === confirmedVersion.id)
  if (!currentVersion || !canAcceptRevisionVersionStatus(currentVersion.status)) {
    throw new Error('修订版本状态已经变化，请查看最新版本后再接受。')
  }
  if (currentVersion.body !== confirmedVersion.body || currentVersion.sessionId !== confirmedVersion.sessionId ||
    currentVersion.requestId !== confirmedVersion.requestId ||
    currentVersion.sourceContentHash !== confirmedVersion.sourceContentHash ||
    currentVersion.sourceChapterContentHash !== confirmedVersion.sourceChapterContentHash) {
    throw new Error('修订候选在确认期间已变化，请重新对比后接受。')
  }
  const session = scoped.revisionSessions.find((item) => item.id === currentVersion.sessionId)
  const expectedSession = context.activeSessions.find((item) => item.id === confirmedVersion.sessionId)
  if (!session || session.status !== 'active' || (expectedSession &&
    (session.chapterId !== expectedSession.chapterId || session.sourceDraftId !== expectedSession.sourceDraftId))) {
    throw new Error('修订会话或来源已经变化，请重新选择修订版本。')
  }
  const expectedDraft = context.sourceKind === 'draft' ? context.selectedDraft : null
  const currentDraft = expectedDraft ? scoped.generatedChapterDrafts.find((item) => item.id === expectedDraft.id) ?? null : null
  if (context.sourceKind === 'draft' && (!currentDraft || !expectedDraft ||
    currentDraft.chapterId !== expectedDraft.chapterId || currentDraft.jobId !== expectedDraft.jobId ||
    currentDraft.status !== expectedDraft.status || currentDraft.body !== expectedDraft.body ||
    session.sourceDraftId !== currentDraft.id)) {
    throw new Error('草稿正文、状态或关联章节已经变化，请核对最新来源后接受。')
  }
  const expectedChapter = context.sourceKind === 'draft' ? context.linkedDraftChapter : context.selectedChapter
  const targetChapter = context.sourceKind === 'draft'
    ? resolveDraftLinkedChapter(currentDraft, scoped.chapters)
    : scoped.chapters.find((item) => item.id === expectedChapter?.id) ?? null
  if (targetChapter?.id !== expectedChapter?.id || targetChapter?.body !== expectedChapter?.body ||
    (context.sourceKind === 'chapter' && (!targetChapter || session.sourceDraftId || session.chapterId !== targetChapter.id))) {
    throw new Error('目标章节或正文已经变化，请重新对比后接受。')
  }
  return { currentVersion, currentDraft, targetChapter }
}
