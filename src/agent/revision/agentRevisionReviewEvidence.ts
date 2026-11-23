import type { AppData, Chapter, RevisionVersion } from '../../shared/types'
import { qualityGateEffectivelyPassed } from '../../shared/qualityGatePolicy'
import { draftContentHash } from '../../services/DraftDiagnosticBindingService'
import { currentHardCanonAudit } from '../../services/HardCanonPreflight'
import { characterStatesForProjectAtChapter } from '../../services/characterState/stateAsOf'
import { buildRevisionAiContext } from '../../renderer/src/views/revision/revisionAiContext'
import { projectData } from '../../renderer/src/utils/projectData'
import { noveltyReferenceContext } from '../../renderer/src/views/generation/pipelineUtils'
import { revisionFingerprint } from './agentRevisionModel'
import { seamSize, stagedOpening } from './agentStagedRevisionNeighbors'
import { surgicalErrata } from './surgicalErrata'

export function revisionReviewBasis(data: AppData, chapter: Chapter, version: RevisionVersion, runId?: string, mode?: 'surgical_errata') {
  const project = data.projects.find(item => item.id === chapter.projectId)!
  const scoped = projectData(data, chapter.projectId)
  const refs = noveltyReferenceContext(data, chapter.projectId)
  const characterStateFacts = characterStatesForProjectAtChapter(data, chapter.projectId, chapter.order)
  const adjacent = scoped.chapters.filter(item => Math.abs(item.order - chapter.order) === 1 ||
    scoped.chapterContinuityBridges.some(bridge => bridge.fromChapterId === chapter.id && bridge.toChapterOrder === item.order))
  const run = data.agentRuns.find(r => r.id === runId && r.projectId === chapter.projectId)
  const delta = mode && surgicalErrata(chapter.body, version.body)
  const neighbors = adjacent.map(item => {
    const staged = item.order === chapter.order + 1 ? stagedOpening(data, run, item) : null
    const label = `邻章第 ${item.order} 章《${item.title}》`
    return { staged, text: staged ? `${label}（同批待审候选，未提交，仅用于两章衔接，不是已发生的事实）：${staged.opening}`
      : `${label}：${item.order < chapter.order ? item.body.slice(-seamSize) : item.body.slice(0, seamSize)}` }
  })
  const stagedNeighbors = neighbors.flatMap(n => n.staged ? [n.staged.ref] : [])
  const base = [
    '核查正式章节的候选修订：以原稿、前后衔接与现行设定为依据。指出修订新引入的断裂，不要要求重写无关章。',
    buildRevisionAiContext({ ...scoped, chapters: delta ? scoped.chapters.filter(c => c.id !== chapter.id) : scoped.chapters,
      project, selectedChapter: chapter, selectedDraft: null, redundancyReports: [] }),
    scoped.bible?.worldbuilding ? `世界设定：${scoped.bible.worldbuilding}` : '',
    scoped.bible?.powerSystem ? `规则体系：${scoped.bible.powerSystem}` : '',
  ].filter(Boolean)
  const original = `修订前的正式正文：\n${chapter.body}`
  const context = [...base, ...neighbors.map(n => n.text), original].join('\n\n')
  const canonContext = stagedNeighbors.length ? [...base, ...neighbors.filter(n => !n.staged).map(n => n.text), original].join('\n\n') : context
  const canon = currentHardCanonAudit(data, {
    projectId: chapter.projectId, chapterId: chapter.id, chapterOrder: chapter.order, body: version.body
  })
  const contextHash = revisionFingerprint({ context, refs, characterStateFacts,
    ...(mode ? { mode } : {}), ...(stagedNeighbors.length ? { stagedNeighbors } : {}),
    hardCanonRules: scoped.hardCanonPacks.flatMap(pack => pack.items.filter(item => item.status === 'active')
      .map(item => [item.id, item.title, item.content, item.check])) })
  return { context, canonContext, refs, characterStateFacts, canon, contextHash, project, characters: scoped.characters, stagedNeighbors, delta }
}

export function latestRevisionReview(data: AppData, agentRunId: string, chapter: Chapter, version: RevisionVersion) {
  return data.qualityGateReports.filter(item => item.projectId === chapter.projectId && item.chapterId === chapter.id &&
    item.revisionReview?.agentRunId === agentRunId && item.revisionReview.revisionVersionId === version.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] ?? null
}

export function requirePassingRevisionReview(
  data: AppData, agentRunId: string, chapter: Chapter, version: RevisionVersion, expectedReportId: string | undefined
) {
  const report = latestRevisionReview(data, agentRunId, chapter, version)
  const binding = report?.revisionReview
  const consistency = binding && data.consistencyReviewReports.find(item => item.id === binding.consistencyReviewReportId &&
    item.jobId === report!.jobId && item.projectId === chapter.projectId && item.chapterId === chapter.id &&
    item.draftContentHash === report!.draftContentHash)
  if (!report || !binding || !consistency || report.id !== expectedReportId ||
    report.draftContentHash !== draftContentHash(version.body) || binding.versionHash !== revisionFingerprint(version) ||
    binding.contextHash !== revisionReviewBasis(data, chapter, version, agentRunId, binding.mode).contextHash) {
    throw new Error('修订缺少与当前版本和上下文匹配的审稿报告。请用 agent.reviewRevisionVersion 重审并核对报告。')
  }
  if (!qualityGateEffectivelyPassed(report)) throw new Error('本次修订未通过质量门禁，请改稿并重审。')
  return { qualityGateReportId: report.id, consistencyReviewReportId: consistency.id }
}
