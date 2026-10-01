import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  AppData,
  ID,
  RevisionRequestType,
  RevisionSession
} from '../../../../shared/types'
import {
  assessRevisionRequestRelocation,
  revisionTargetMatchCount
} from '../../../../services/RevisionRequestRelocationService'

interface RevisionRequestPrefill {
  chapterId: ID | null
  draftId: ID | null
  requestId: ID
}

interface RevisionRequestRelocationStateInput {
  data: AppData
  projectId: ID
  prefill?: RevisionRequestPrefill | null
  onPrefillConsumed?: () => void
  sourceSessions: RevisionSession[]
  chapterId: ID | ''
  sourceDraftId: ID | null
  sourceBody: string
  targetRange: string
  setSourceKind: Dispatch<SetStateAction<'chapter' | 'draft'>>
  setSelectedChapterId: Dispatch<SetStateAction<ID | null>>
  setSelectedDraftId: Dispatch<SetStateAction<ID | null>>
  setRevisionType: Dispatch<SetStateAction<RevisionRequestType>>
  setTargetRange: Dispatch<SetStateAction<string>>
  setInstruction: Dispatch<SetStateAction<string>>
}

export function useRevisionRequestRelocation(input: RevisionRequestRelocationStateInput) {
  const [sourceRequestId, setSourceRequestId] = useState<ID | null>(null)
  const sourceRequest = input.data.revisionRequests.find((request) => {
    if (request.id !== sourceRequestId) return false
    const session = input.sourceSessions.find((item) => item.id === request.sessionId)
    return Boolean(session && session.chapterId === input.chapterId &&
      session.sourceDraftId === input.sourceDraftId)
  }) ?? null
  const sourceRequestSession = sourceRequest
    ? input.sourceSessions.find((session) => session.id === sourceRequest.sessionId) ?? null
    : null
  const assessment = sourceRequest && sourceRequestSession
    ? assessRevisionRequestRelocation(sourceRequest, sourceRequestSession, {
        projectId: input.projectId,
        chapterId: input.chapterId,
        sourceDraftId: input.sourceDraftId,
        sourceBody: input.sourceBody
      })
    : null
  const relocation = assessment?.requiresRelocation
    ? {
        status: assessment.status as 'unique' | 'missing' | 'ambiguous' | 'full_chapter',
        canRelocateSelection: revisionTargetMatchCount(input.sourceBody, input.targetRange) === 1
      }
    : null

  useEffect(() => {
    if (!input.prefill) return
    const request = input.data.revisionRequests.find((item) => item.id === input.prefill?.requestId)
    const session = request
      ? input.data.revisionSessions.find((item) => item.id === request.sessionId)
      : null
    const matchesSource = Boolean(session && session.projectId === input.projectId &&
      session.chapterId === (input.prefill.chapterId ?? '') && session.sourceDraftId === input.prefill.draftId)
    if (request && matchesSource) {
      if (input.prefill.chapterId) input.setSelectedChapterId(input.prefill.chapterId)
      if (input.prefill.draftId) {
        input.setSourceKind('draft')
        input.setSelectedDraftId(input.prefill.draftId)
      } else {
        input.setSourceKind('chapter')
      }
      setSourceRequestId(request.id)
      input.setRevisionType(request.type)
      input.setTargetRange(request.targetRange)
      input.setInstruction(request.instruction)
    }
    input.onPrefillConsumed?.()
  }, [input.prefill, input.data.revisionRequests, input.data.revisionSessions,
    input.projectId, input.onPrefillConsumed])

  return { sourceRequest, relocation, setSourceRequestId }
}
