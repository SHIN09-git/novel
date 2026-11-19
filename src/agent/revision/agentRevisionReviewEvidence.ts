import type { AppData, Chapter, RevisionVersion } from '../../shared/types'
import { qualityGateEffectivelyPassed } from '../../shared/qualityGatePolicy'
import { draftContentHash } from '../../services/DraftDiagnosticBindingService'
import { currentHardCanonAudit } from '../../services/HardCanonPreflight'
import { characterStatesForProjectAtChapter } from '../../services/characterState/stateAsOf'
import { buildRevisionAiContext } from '../../renderer/src/views/revision/revisionAiContext'
import { projectData } from '../../renderer/src/utils/projectData'
import { noveltyReferenceContext } from '../../renderer/src/views/generation/pipelineUtils'
import { revisionFingerprint } from './agentRevisionModel'

export function revisionReviewBasis(data: AppData, chapter: Chapter, version: RevisionVersion) {
  const project = data.projects.find(item => item.id === chapter.projectId)!
  const scoped = projectData(data, chapter.projectId)
  const refs = noveltyReferenceContext(data, chapter.projectId)
  const characterStateFacts = characterStatesForProjectAtChapter(data, chapter.projectId, chapter.order)
  const adjacent = scoped.chapters.filter(item => Math.abs(item.order - chapter.order) === 1 ||
    scoped.chapterContinuityBridges.some(bridge => bridge.fromChapterId === chapter.id && bridge.toChapterOrder === item.order))
  const context = [
    '核查正式章节的候选修订：以原稿、前后衔接与现行设定为依据。指出修订新引入的断裂，不要要求重写无关章。',
    buildRevisionAiContext({ ...scoped, project, selectedChapter: chapter, selectedDraft: null, redundancyReports: [] }),
    scoped.bible?.worldbuilding ? `世界设定：${scoped.bible.worldbuilding}` : '',
    scoped.bible?.powerSystem ? `规则体系：${scoped.bible.powerSystem}` : '',
    ...adjacent.map(item => `邻章第 ${item.order} 章《${item.title}》：${item.order < chapter.order ? item.body.slice(-550) : item.body.slice(0, 550)}`),
    `修订前的正式正文：\n${chapter.body}`
  ].filter(Boolean).join('\n\n')
  const canon = currentHardCanonAudit(data, {
    projectId: chapter.projectId, chapterId: chapter.id, chapterOrder: chapter.order, body: version.body
  })
  const contextHash = revisionFingerprint({ context, refs, characterStateFacts,
    hardCanonRules: scoped.hardCanonPacks.flatMap(pack => pack.items.filter(item => item.status === 'active')
      .map(item => [item.id, item.title, item.content, item.check])) })
  return { context, refs, characterStateFacts, canon, contextHash, project, characters: scoped.characters }
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
    binding.contextHash !== revisionReviewBasis(data, chapter, version).contextHash) {
    throw new Error('修订缺少与当前版本和上下文匹配的审稿报告。请用 agent.reviewRevisionVersion 重审并核对报告。')
  }
  if (!qualityGateEffectivelyPassed(report)) throw new Error('本次修订未通过质量门禁，请改稿并重审。')
  return { qualityGateReportId: report.id, consistencyReviewReportId: consistency.id }
}
