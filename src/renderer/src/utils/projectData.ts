import type { AppData, ID } from '../../../shared/types'
import { activeChapters, archivedChapters } from '../../../services/ChapterLifecycleService'
import { selectProjectScopedCollections } from '../../../services/ProjectLifecycleService'

export function projectData(data: AppData, projectId: ID) {
  const scoped = selectProjectScopedCollections(data, projectId)
  const allChapters = scoped.chapters

  return {
    bible: scoped.storyBibles[0] ?? null,
    chapters: activeChapters(allChapters),
    archivedChapters: archivedChapters(allChapters),
    allChapters,
    characters: scoped.characters,
    characterStateLogs: scoped.characterStateLogs,
    characterStateFacts: scoped.characterStateFacts,
    characterStateTransactions: scoped.characterStateTransactions,
    characterStateChangeCandidates: scoped.characterStateChangeCandidates,
    foreshadowings: scoped.foreshadowings,
    timelineEvents: scoped.timelineEvents,
    stageSummaries: scoped.stageSummaries,
    promptVersions: scoped.promptVersions,
    promptContextSnapshots: scoped.promptContextSnapshots,
    storyDirectionGuides: scoped.storyDirectionGuides,
    hardCanonPacks: scoped.hardCanonPacks,
    contextNeedPlans: scoped.contextNeedPlans,
    chapterContinuityBridges: scoped.chapterContinuityBridges,
    chapterGenerationJobs: scoped.chapterGenerationJobs,
    chapterGenerationSteps: scoped.chapterGenerationSteps,
    generatedChapterDrafts: scoped.generatedChapterDrafts,
    memoryUpdateCandidates: scoped.memoryUpdateCandidates,
    consistencyReviewReports: scoped.consistencyReviewReports,
    contextBudgetProfiles: scoped.contextBudgetProfiles,
    qualityGateReports: scoped.qualityGateReports,
    generationRunTraces: scoped.generationRunTraces,
    runTraceAuthorSummaries: scoped.runTraceAuthorSummaries,
    redundancyReports: scoped.redundancyReports,
    revisionCandidates: scoped.revisionCandidates,
    revisionSessions: scoped.revisionSessions,
    revisionRequests: scoped.revisionRequests,
    revisionVersions: scoped.revisionVersions,
    chapterVersions: scoped.chapterVersions,
    chapterCommitBundles: scoped.chapterCommitBundles,
    revisionCommitBundles: scoped.revisionCommitBundles,
    agentRuns: scoped.agentRuns,
    agentActionPreviews: scoped.agentActionPreviews
  }
}
