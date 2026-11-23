import type { AgentRun, AppData, Chapter, QualityGateReport } from '../../shared/types'
import { draftContentHash } from '../../services/DraftDiagnosticBindingService'
import { revisionAudit, revisionFingerprint } from './agentRevisionModel'

type Neighbor = NonNullable<NonNullable<QualityGateReport['revisionReview']>['stagedNeighbors']>[number]
export const seamSize = 550
const candidateOperations = new Set(['create_manual_revision_version', 'generate_revision_version', 'edit_revision_version'])

export function stagedOpening(data: AppData, run: AgentRun | undefined, chapter: Chapter) {
  if (run?.mode !== 'book_revision' || !run.stageNeighbors || run.projectId !== chapter.projectId ||
    chapter.archivedAt || !run.revisionChapterIds?.includes(chapter.id)) return null
  const baseHash = draftContentHash(chapter.body)
  // Decisions are appended in commit order, including when two versions share a timestamp.
  for (let i = run.decisions.length - 1; i >= 0; i--) {
    const d = run.decisions[i]
    if (d.chapterId !== chapter.id || !candidateOperations.has(d.step)) continue
    const a = revisionAudit(d.evidence)
    if (a.actor.agentRunId !== run.id || a.source.projectId !== run.projectId || a.source.chapterId !== chapter.id ||
      a.source.sourceDraftId || a.source.sourceContentHash !== baseHash) continue
    const v = data.revisionVersions.find(v => v.id === a.versionId && v.sessionId === a.sessionId)
    if (!v || !['draft', 'pending'].includes(v.status) || v.sourceChapterContentHash !== baseHash ||
      v.requestId !== a.requestId || revisionFingerprint(v) !== a.versionHash) continue
    if (!data.revisionSessions.some(s => s.id === v.sessionId && s.projectId === run.projectId &&
      s.chapterId === chapter.id && !s.sourceDraftId && s.status === 'active')) continue
    const opening = v.body.slice(0, seamSize)
    const ref: Neighbor = { chapterId: chapter.id, chapterOrder: chapter.order, versionId: v.id, openingHash: revisionFingerprint(opening) }
    return { opening, ref }
  }
  return null
}

/** Track only seams that an actually committed chapter relied on, not rejected reviews. */
export function stagedSeamStatus(data: AppData, run: AgentRun) {
  if (!run.stageNeighbors) return []
  const reports = new Map(data.qualityGateReports.filter(r => r.projectId === run.projectId &&
    r.revisionReview?.agentRunId === run.id).map(r => [r.id, r]))
  return data.revisionCommitBundles.filter(b => b.projectId === run.projectId && b.actor?.agentRunId === run.id)
    .flatMap(b => (reports.get(b.qualityGateReportId ?? '')?.revisionReview?.stagedNeighbors ?? []).flatMap(ref => {
      const ch = data.chapters.find(c => c.projectId === run.projectId && c.id === ref.chapterId && !c.archivedAt)
      if (ch?.order === ref.chapterOrder && revisionFingerprint(ch.body.slice(0, seamSize)) === ref.openingHash) return []
      const stillStaged = ch?.order === ref.chapterOrder && stagedOpening(data, run, ch)?.ref.openingHash === ref.openingHash
      return [{ reviewedChapterId: b.chapterId, ...ref, status: stillStaged ? 'awaiting_commit' : 'needs_recheck',
        read: { tool: 'agent.getRevisionReview', arguments: { projectId: run.projectId, agentRunId: run.id,
          versionId: b.revisionVersionId, reportId: b.qualityGateReportId, detail: 'full' } },
        reason: stillStaged ? '前章引用的邻章开头尚未正式提交。' : '邻章没有按审稿时的开头落稿，请复核两章衔接。' }]
    }))
}
