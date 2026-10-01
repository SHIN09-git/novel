import type { AppData, EditorialVerdictIssue, RevisionRequest, RevisionRequestType, RevisionSession } from '../shared/types'
import { AuthorDecisionPolicyService } from './AuthorDecisionPolicyService'
import { draftContentHash } from './DraftDiagnosticBindingService'

function revisionType(issue: EditorialVerdictIssue): RevisionRequestType {
  if (issue.source === 'novelty_audit') return 'fix_worldbuilding'
  if (/foreshadowing/.test(issue.code)) return 'fix_foreshadowing'
  if (/knowledge/.test(issue.code)) return 'fix_character_knowledge'
  if (/redundan|repeat/.test(issue.code)) return 'reduce_redundancy'
  if (/ooc|motivation/.test(issue.code)) return 'fix_ooc'
  return 'fix_continuity'
}

/** Reuse the existing revision workspace; opening a request makes no AI call. */
export function buildEditorialRevisionRequest(data: AppData, input: {
  projectId: string; verdictId: string; issueId: string; expectedDraftHash: string;
  sessionId: string; requestId: string; createdAt: string
}): { data: AppData; session: RevisionSession; request: RevisionRequest } {
  const verdict = data.editorialVerdicts.find((item) => item.id === input.verdictId && item.projectId === input.projectId)
  const draft = verdict ? data.generatedChapterDrafts.find((item) => item.id === verdict.draftId && item.projectId === input.projectId && item.jobId === verdict.jobId) : null
  if (!verdict || !draft || draftContentHash(draft.body) !== input.expectedDraftHash ||
    AuthorDecisionPolicyService.latestEditorialVerdictForDraft(data.editorialVerdicts, draft)?.id !== verdict.id) {
    throw new Error('正文或编辑结论已变化，请从当前结论重新选择修订问题。')
  }
  const issue = [...verdict.blockers, ...verdict.advisories].find((item) => item.id === input.issueId)
  if (!issue || issue.source === 'diagnostic_binding') throw new Error('该项需要重新审稿，不是正文修订问题。')
  const previous = data.revisionRequests.find((item) => item.sourceEditorialVerdictId === verdict.id &&
    item.sourceEditorialIssueId === issue.id && item.sourceDraftContentHash === input.expectedDraftHash &&
    data.revisionSessions.some((session) => session.id === item.sessionId && session.projectId === input.projectId &&
      session.sourceDraftId === draft.id && session.status === 'active'))
  if (previous) return { data, request: previous, session: data.revisionSessions.find((item) => item.id === previous.sessionId)! }

  const targetRange = issue.evidence.map((text) => text.trim()).find((text) =>
    text.length >= 4 && draft.body.indexOf(text) >= 0 && draft.body.indexOf(text) === draft.body.lastIndexOf(text)) ?? ''
  const session: RevisionSession = { id: input.sessionId, projectId: input.projectId, chapterId: draft.chapterId ?? '',
    sourceDraftId: draft.id, status: 'active', createdAt: input.createdAt, updatedAt: input.createdAt }
  const request: RevisionRequest = { id: input.requestId, sessionId: session.id, type: revisionType(issue), targetRange,
    instruction: [`修订目标：${issue.title}`, issue.recommendation,
      targetRange ? '只调整选中片段，保留无关剧情、角色状态和既有伏笔边界。'
        : '证据无法唯一定位。请先选择需要修改的段落，或明确选择整章修订。',
      !targetRange && issue.evidence.length ? `参考证据：${issue.evidence.join('；')}` : ''].filter(Boolean).join('\n'),
    sourceEditorialVerdictId: verdict.id, sourceEditorialIssueId: issue.id, sourceDraftContentHash: input.expectedDraftHash,
    createdAt: input.createdAt }
  return { session, request, data: { ...data, revisionSessions: [session, ...data.revisionSessions],
    revisionRequests: [request, ...data.revisionRequests] } }
}
