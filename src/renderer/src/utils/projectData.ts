import type { AppData, ID } from '../../../shared/types'

export function projectData(data: AppData, projectId: ID) {
  return {
    bible: data.storyBibles.find((item) => item.projectId === projectId) ?? null,
    chapters: data.chapters.filter((item) => item.projectId === projectId),
    characters: data.characters.filter((item) => item.projectId === projectId),
    characterStateLogs: data.characterStateLogs.filter((item) => item.projectId === projectId),
    foreshadowings: data.foreshadowings.filter((item) => item.projectId === projectId),
    timelineEvents: data.timelineEvents.filter((item) => item.projectId === projectId),
    stageSummaries: data.stageSummaries.filter((item) => item.projectId === projectId),
    promptVersions: data.promptVersions.filter((item) => item.projectId === projectId),
    chapterGenerationJobs: data.chapterGenerationJobs.filter((item) => item.projectId === projectId),
    chapterGenerationSteps: data.chapterGenerationSteps,
    generatedChapterDrafts: data.generatedChapterDrafts.filter((item) => item.projectId === projectId),
    memoryUpdateCandidates: data.memoryUpdateCandidates.filter((item) => item.projectId === projectId),
    consistencyReviewReports: data.consistencyReviewReports.filter((item) => item.projectId === projectId),
    contextBudgetProfiles: data.contextBudgetProfiles.filter((item) => item.projectId === projectId),
    qualityGateReports: data.qualityGateReports.filter((item) => item.projectId === projectId),
    revisionCandidates: data.revisionCandidates.filter((item) => item.projectId === projectId)
  }
}
