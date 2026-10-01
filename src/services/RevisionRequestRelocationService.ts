import type {
  AppData,
  ID,
  RevisionRequest,
  RevisionRequestType,
  RevisionSession
} from '../shared/types'
import { draftContentHash } from './DraftDiagnosticBindingService'

export type RevisionRequestRelocationStatus =
  | 'current'
  | 'unique'
  | 'missing'
  | 'ambiguous'
  | 'full_chapter'

export interface RevisionRequestRelocationSource {
  projectId: ID
  chapterId: ID | ''
  sourceDraftId: ID | null
  sourceBody: string
}

export interface RevisionRequestRelocationAssessment {
  status: RevisionRequestRelocationStatus
  requiresRelocation: boolean
  originalTargetRange: string
  suggestedTargetRange: string | null
  matchCount: number
}

export interface RelocateRevisionRequestInput {
  projectId: ID
  sourceKind: 'chapter' | 'draft'
  chapterId: ID | ''
  sourceDraftId: ID | null
  requestId: ID
  expectedSourceContentHash: string
  mode: 'selection' | 'full_chapter'
  targetRange: string
  type: RevisionRequestType
  instruction: string
  relocatedRequestId: ID
  createdAt: string
}

function exactMatchCount(source: string, target: string): number {
  let count = 0
  let index = source.indexOf(target)
  while (index !== -1) {
    count += 1
    index = source.indexOf(target, index + target.length)
  }
  return count
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Matches the same exact-or-whitespace-flexible target semantics used by local revision merging. */
export function revisionTargetMatchCount(sourceBody: string, targetRange: string): number {
  const target = targetRange.trim()
  if (!target) return 0
  const exactMatches = exactMatchCount(sourceBody, target)
  if (exactMatches > 0) return exactMatches
  const parts = target.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return 0
  return [...sourceBody.matchAll(new RegExp(parts.map(escapeRegExp).join('\\s+'), 'g'))].length
}

function assertRequestSource(
  request: RevisionRequest,
  session: RevisionSession,
  source: RevisionRequestRelocationSource
): void {
  if (request.sessionId !== session.id) throw new Error('修订要求与来源会话不匹配。')
  if (session.projectId !== source.projectId || session.chapterId !== source.chapterId ||
    session.sourceDraftId !== source.sourceDraftId) {
    throw new Error('修订要求不属于当前项目、章节或草稿。')
  }
}

export function assessRevisionRequestRelocation(
  request: RevisionRequest,
  session: RevisionSession,
  source: RevisionRequestRelocationSource
): RevisionRequestRelocationAssessment {
  assertRequestSource(request, session, source)
  const originalTargetRange = request.targetRange.trim()
  if (!request.sourceDraftContentHash || request.sourceDraftContentHash === draftContentHash(source.sourceBody)) {
    return {
      status: 'current',
      requiresRelocation: false,
      originalTargetRange,
      suggestedTargetRange: null,
      matchCount: 0
    }
  }
  if (!originalTargetRange) {
    return {
      status: 'full_chapter',
      requiresRelocation: true,
      originalTargetRange,
      suggestedTargetRange: null,
      matchCount: 0
    }
  }
  const matchCount = revisionTargetMatchCount(source.sourceBody, originalTargetRange)
  return {
    status: matchCount === 1 ? 'unique' : matchCount === 0 ? 'missing' : 'ambiguous',
    requiresRelocation: true,
    originalTargetRange,
    suggestedTargetRange: matchCount === 1 ? originalTargetRange : null,
    matchCount
  }
}

function resolveCurrentSource(data: AppData, input: RelocateRevisionRequestInput): {
  request: RevisionRequest
  session: RevisionSession
  source: RevisionRequestRelocationSource
} {
  const request = data.revisionRequests.find((item) => item.id === input.requestId)
  const session = request
    ? data.revisionSessions.find((item) => item.id === request.sessionId)
    : null
  if (!request || !session) throw new Error('原修订要求或来源会话已不存在。')

  if (input.sourceKind === 'chapter') {
    const chapter = data.chapters.find((item) => item.id === input.chapterId && item.projectId === input.projectId)
    if (!chapter || input.sourceDraftId !== null) throw new Error('当前章节来源已变化，请重新打开修订要求。')
    const source = { projectId: input.projectId, chapterId: chapter.id, sourceDraftId: null, sourceBody: chapter.body }
    assertRequestSource(request, session, source)
    return { request, session, source }
  }

  const draft = data.generatedChapterDrafts.find(
    (item) => item.id === input.sourceDraftId && item.projectId === input.projectId
  )
  if (!draft || (draft.chapterId ?? '') !== input.chapterId) {
    throw new Error('当前草稿或章节关联已变化，请重新打开修订要求。')
  }
  const source = {
    projectId: input.projectId,
    chapterId: draft.chapterId ?? '',
    sourceDraftId: draft.id,
    sourceBody: draft.body
  }
  assertRequestSource(request, session, source)
  return { request, session, source }
}

export function relocateRevisionRequest(data: AppData, input: RelocateRevisionRequestInput): {
  data: AppData
  request: RevisionRequest
} {
  if (data.revisionRequests.some((item) => item.id === input.relocatedRequestId)) {
    throw new Error('新的修订要求 ID 已存在。')
  }
  const { request, session, source } = resolveCurrentSource(data, input)
  const currentHash = draftContentHash(source.sourceBody)
  if (currentHash !== input.expectedSourceContentHash) {
    throw new Error('正文在确认期间再次变化，请重新定位。')
  }
  const assessment = assessRevisionRequestRelocation(request, session, source)
  if (!assessment.requiresRelocation) throw new Error('这份修订要求已经对应当前正文。')

  const targetRange = input.mode === 'full_chapter' ? '' : input.targetRange.trim()
  if (input.mode === 'selection' && revisionTargetMatchCount(source.sourceBody, targetRange) !== 1) {
    throw new Error('新选区必须在当前正文中唯一出现；请重新选择段落或转为整章修订。')
  }
  const relocated: RevisionRequest = {
    id: input.relocatedRequestId,
    sessionId: session.id,
    type: input.type,
    targetRange,
    instruction: input.instruction,
    sourceEditorialVerdictId: request.sourceEditorialVerdictId,
    sourceEditorialIssueId: request.sourceEditorialIssueId,
    sourceDraftContentHash: currentHash,
    relocatedFromRequestId: request.id,
    createdAt: input.createdAt
  }
  return {
    request: relocated,
    data: {
      ...data,
      revisionSessions: data.revisionSessions.map((item) =>
        item.id === session.id ? { ...item, updatedAt: input.createdAt } : item
      ),
      revisionRequests: [relocated, ...data.revisionRequests]
    }
  }
}
