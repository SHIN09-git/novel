import type { AppData, ID, RevisionSession } from '../../../../shared/types'
import { draftContentHash } from '../../../../services/DraftDiagnosticBindingService'

export interface RevisionSourceSnapshot {
  projectId: ID
  chapterId: ID | ''
  sourceDraftId: ID | null
  sourceContentHash: string
  sourceChapterContentHash?: string
}

export interface RevisionSessionSelection {
  session: RevisionSession
  reusedSession: boolean
}

export interface RevisionResponseSessionResolution {
  session: RevisionSession
  appendSession: boolean
  notice: string
}

export function findReusableRevisionSession(sessions: RevisionSession[]): RevisionSession | null {
  return sessions
    .filter((session) => session.status === 'active')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
}

export function createRevisionSourceSnapshot(input: {
  projectId: ID
  chapterId: ID | null | undefined
  sourceDraftId: ID | null
  sourceBody: string
  sourceChapterBody?: string
}): RevisionSourceSnapshot {
  return {
    projectId: input.projectId,
    chapterId: input.chapterId ?? '',
    sourceDraftId: input.sourceDraftId,
    sourceContentHash: draftContentHash(input.sourceBody),
    ...(input.sourceChapterBody !== undefined
      ? { sourceChapterContentHash: draftContentHash(input.sourceChapterBody) }
      : {})
  }
}

export function revisionSessionMatchesSource(
  session: RevisionSession,
  source: RevisionSourceSnapshot
): boolean {
  return session.projectId === source.projectId &&
    session.chapterId === source.chapterId &&
    session.sourceDraftId === source.sourceDraftId
}

function createSession(
  source: RevisionSourceSnapshot,
  timestamp: string,
  id: ID
): RevisionSession {
  return {
    id,
    projectId: source.projectId,
    chapterId: source.chapterId,
    sourceDraftId: source.sourceDraftId,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function selectRevisionSession(
  sessions: RevisionSession[],
  source: RevisionSourceSnapshot,
  timestamp: string,
  createId: () => ID
): RevisionSessionSelection {
  const existing = findReusableRevisionSession(
    sessions.filter((session) => revisionSessionMatchesSource(session, source))
  )
  return existing
    ? { session: existing, reusedSession: true }
    : { session: createSession(source, timestamp, createId()), reusedSession: false }
}

function sourceChangedSinceRequest(
  current: AppData,
  sourceKind: 'chapter' | 'draft',
  source: RevisionSourceSnapshot
): boolean {
  if (sourceKind === 'chapter') {
    const chapter = current.chapters.find(
      (item) => item.id === source.chapterId && item.projectId === source.projectId
    )
    return !chapter || draftContentHash(chapter.body) !== source.sourceContentHash
  }

  const draft = current.generatedChapterDrafts.find(
    (item) => item.id === source.sourceDraftId && item.projectId === source.projectId
  )
  if (!draft || draftContentHash(draft.body) !== source.sourceContentHash) return true
  if ((draft.chapterId ?? '') !== source.chapterId) return true
  if (source.sourceChapterContentHash === undefined) return false
  const chapter = current.chapters.find(
    (item) => item.id === source.chapterId && item.projectId === source.projectId
  )
  return !chapter || draftContentHash(chapter.body) !== source.sourceChapterContentHash
}

export function resolveRevisionResponseSession(input: {
  current: AppData
  sourceKind: 'chapter' | 'draft'
  source: RevisionSourceSnapshot
  requestedSession: RevisionSession
  reusedSession: boolean
  timestamp: string
  createId: () => ID
}): RevisionResponseSessionResolution {
  const currentSession = input.current.revisionSessions.find(
    (session) => session.id === input.requestedSession.id
  )
  const terminalSession = currentSession && currentSession.status !== 'active'
  const sessionAssociationChanged = Boolean(
    currentSession && !revisionSessionMatchesSource(currentSession, input.source)
  )
  const missingReusedSession = input.reusedSession && !currentSession
  const sourceChanged = sourceChangedSinceRequest(input.current, input.sourceKind, input.source)
  const needsNewSession = Boolean(
    terminalSession || sessionAssociationChanged || missingReusedSession || sourceChanged
  )
  const session = needsNewSession
    ? createSession(input.source, input.timestamp, input.createId())
    : input.requestedSession
  const notices: string[] = []
  if (terminalSession) {
    notices.push('原修订会话在生成期间已结束；模型结果已保存在新的修订会话中，原会话保持不变。')
  } else if (sessionAssociationChanged || missingReusedSession) {
    notices.push('原修订会话的项目或来源关联在生成期间已变化；模型结果已保存在新的修订会话中。')
  }
  if (sourceChanged) {
    notices.push('原文或章节关联也已变化；该版本仅供对照，请基于最新原文重新生成后再接受。')
  }
  return {
    session,
    appendSession: !input.current.revisionSessions.some((item) => item.id === session.id),
    notice: notices.join('\n')
  }
}
