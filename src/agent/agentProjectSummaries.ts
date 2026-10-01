import type { AppData, ID } from '../shared/types'
import { activeChapters, archivedChapters, nextChapterOrder } from '../services/ChapterLifecycleService'
import type { AgentProjectOverviewData } from './agentProjectOverviewData'
import {
  byChapterOrderDesc,
  byUpdatedAtDesc,
  findProject,
  latestJobForProject,
  pendingReviewForProject,
  summarizeJob
} from './agentSummaryHelpers'
import { compact } from './agentReadableText'
import type {
  AgentArchivedChapterList,
  AgentProjectDigest,
  AgentProjectListItem
} from './agentReadableSummaryTypes'

export function listProjects(data: AgentProjectOverviewData): AgentProjectListItem[] {
  return [...data.projects]
    .sort(byUpdatedAtDesc)
    .map((project) => {
      const projectChapters = data.chapters.filter((chapter) => chapter.projectId === project.id)
      const chapters = activeChapters(projectChapters)
      const latestChapter = [...chapters].sort(byChapterOrderDesc)[0] ?? null
      const pendingReview = pendingReviewForProject(data, project.id)
      const projectForeshadowings = data.foreshadowings.filter((item) => item.projectId === project.id)
      return {
        id: project.id,
        name: project.name,
        genre: project.genre,
        chapterCount: chapters.length,
        archivedChapterCount: archivedChapters(projectChapters).length,
        characterCount: data.characters.filter((character) => character.projectId === project.id).length,
        foreshadowingCount: projectForeshadowings.length,
        activeForeshadowingCount: projectForeshadowings.filter(
          (item) => !['resolved', 'abandoned'].includes(item.status)
        ).length,
        pendingReviewCount: pendingReview.memoryCandidates + pendingReview.characterStateCandidates,
        latestChapterOrder: latestChapter?.order ?? null,
        latestChapterTitle: latestChapter?.title ?? null,
        updatedAt: project.updatedAt
      }
    })
}

export function getProjectDigest(data: AgentProjectOverviewData, projectId: ID): AgentProjectDigest {
  const project = findProject(data, projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  const projectChapters = data.chapters.filter((chapter) => chapter.projectId === projectId)
  const chapters = activeChapters(projectChapters).sort(byChapterOrderDesc)
  const latestGenerationJob = latestJobForProject(data, projectId)
  const hardCanonPack = data.hardCanonPacks.find((pack) => pack.projectId === projectId) ?? null
  const activeStoryDirection = [...data.storyDirectionGuides]
    .filter((guide) => guide.projectId === projectId && guide.status === 'active')
    .sort(byUpdatedAtDesc)[0] ?? null

  return {
    project: {
      id: project.id,
      name: project.name,
      genre: project.genre,
      description: compact(project.description, 300),
      updatedAt: project.updatedAt
    },
    nextChapterOrder: nextChapterOrder(data.chapters, projectId),
    counts: {
      chapters: chapters.length,
      archivedChapters: archivedChapters(projectChapters).length,
      characters: data.characters.filter((character) => character.projectId === projectId).length,
      characterStateFacts: data.characterStateFacts.filter(
        (fact) => fact.projectId === projectId && fact.status === 'active'
      ).length,
      activeForeshadowings: data.foreshadowings.filter(
        (item) => item.projectId === projectId && !['resolved', 'abandoned'].includes(item.status)
      ).length,
      timelineEvents: data.timelineEvents.filter((event) => event.projectId === projectId).length,
      stageSummaries: data.stageSummaries.filter((summary) => summary.projectId === projectId).length,
      hardCanonItems: hardCanonPack?.items.filter((item) => item.status === 'active').length ?? 0,
      storyDirectionGuides: data.storyDirectionGuides.filter((guide) => guide.projectId === projectId).length
    },
    latestChapters: chapters.slice(0, 5).map((chapter) => ({
      id: chapter.id,
      order: chapter.order,
      title: chapter.title,
      updatedAt: chapter.updatedAt,
      bodyCharCount: chapter.body.length,
      summary: compact(chapter.summary),
      endingHook: compact(chapter.endingHook)
    })),
    activeStoryDirection: activeStoryDirection
      ? {
          id: activeStoryDirection.id,
          title: activeStoryDirection.title,
          horizon: activeStoryDirection.horizonChapters,
          range: `${activeStoryDirection.startChapterOrder}-${activeStoryDirection.endChapterOrder}`
        }
      : null,
    latestGenerationJob: summarizeJob(latestGenerationJob),
    pendingReview: pendingReviewForProject(data, projectId)
  }
}

export function getNextChapterTarget(
  data: AgentProjectOverviewData,
  projectId: ID
): { projectId: ID; nextChapterOrder: number; reason: string } {
  const project = findProject(data, projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  const nextOrder = nextChapterOrder(data.chapters, projectId)
  return {
    projectId,
    nextChapterOrder: nextOrder,
    reason:
      nextOrder > 1
        ? `Highest allocated chapter order is ${nextOrder - 1}; archived orders are not reused.`
        : 'No chapter orders have been allocated.'
  }
}

export function getArchivedChapters(data: AppData, projectId: ID): AgentArchivedChapterList {
  const project = findProject(data, projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  return {
    projectId,
    chapters: archivedChapters(data.chapters.filter((chapter) => chapter.projectId === projectId))
      .sort(byChapterOrderDesc)
      .map((chapter) => ({
        id: chapter.id,
        order: chapter.order,
        title: chapter.title,
        archivedAt: chapter.archivedAt ?? '',
        bodyCharCount: chapter.body.length,
        versionCount: data.chapterVersions.filter((version) => version.chapterId === chapter.id).length
      }))
  }
}
