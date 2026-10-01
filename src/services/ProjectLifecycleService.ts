import {
  collectionName,
  DEPENDENT_COLLECTIONS,
  PROJECT_SCOPED_COLLECTIONS,
  type AppDataArrayKey,
  type DependentCollectionKey,
  type ProjectScopedCollectionKey
} from '../shared/appDataCollections'
import type { AppData, ID } from '../shared/types'

type ProjectOwnedRecord = { projectId?: ID | null }

export type ProjectScopedCollections = {
  [K in ProjectScopedCollectionKey]: AppData[K]
} & {
  [K in DependentCollectionKey]: AppData[K]
}

export interface ProjectDeletionSummary {
  projectId: ID
  projectName: string
  counts: Partial<Record<AppDataArrayKey, number>>
  totalRecords: number
  totalRelatedRecords: number
}

function setCollection(
  target: Partial<ProjectScopedCollections> | AppData,
  collection: AppDataArrayKey,
  items: unknown[]
) {
  ;(target as unknown as Record<AppDataArrayKey, unknown[]>)[collection] = items
}

function projectRelationIds(data: AppData, projectId: ID) {
  const jobIds = new Set(
    data.chapterGenerationJobs
      .filter((item) => item.projectId === projectId)
      .map((item) => item.id)
  )
  const revisionSessionIds = new Set(
    data.revisionSessions
      .filter((item) => item.projectId === projectId)
      .map((item) => item.id)
  )
  return { jobIds, revisionSessionIds }
}

function dependentProjectRecords(
  data: AppData,
  projectId: ID
): Pick<ProjectScopedCollections, DependentCollectionKey> {
  const { jobIds, revisionSessionIds } = projectRelationIds(data, projectId)
  return {
    chapterGenerationSteps: data.chapterGenerationSteps.filter((item) => jobIds.has(item.jobId)),
    revisionRequests: data.revisionRequests.filter((item) => revisionSessionIds.has(item.sessionId)),
    revisionVersions: data.revisionVersions.filter((item) => revisionSessionIds.has(item.sessionId))
  }
}

export function selectProjectScopedCollections(
  data: AppData,
  projectId: ID
): ProjectScopedCollections {
  const scoped: Partial<ProjectScopedCollections> = {}
  for (const collection of PROJECT_SCOPED_COLLECTIONS) {
    const items = data[collection] as ProjectOwnedRecord[]
    setCollection(scoped, collection, items.filter((item) => item.projectId === projectId))
  }
  return Object.assign(scoped, dependentProjectRecords(data, projectId)) as ProjectScopedCollections
}

export function markProjectOpened(data: AppData, projectId: ID, openedAt: string): AppData {
  if (!data.projects.some((project) => project.id === projectId)) return data
  return {
    ...data,
    projects: data.projects.map((project) =>
      project.id === projectId ? { ...project, lastOpenedAt: openedAt } : project
    )
  }
}

export function getProjectDeletionSummary(data: AppData, projectId: ID): ProjectDeletionSummary {
  const project = data.projects.find((item) => item.id === projectId)
  const scoped = selectProjectScopedCollections(data, projectId)
  const counts: Partial<Record<AppDataArrayKey, number>> = {
    projects: project ? 1 : 0
  }
  for (const collection of [...PROJECT_SCOPED_COLLECTIONS, ...DEPENDENT_COLLECTIONS]) {
    counts[collection] = scoped[collection].length
  }
  const totalRecords = Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0)
  return {
    projectId,
    projectName: project?.name ?? '未知项目',
    counts,
    totalRecords,
    totalRelatedRecords: Math.max(0, totalRecords - (counts.projects ?? 0))
  }
}

export function formatProjectDeletionImpact(summary: ProjectDeletionSummary): string {
  const preferred: AppDataArrayKey[] = [
    'chapters',
    'characters',
    'foreshadowings',
    'timelineEvents',
    'generatedChapterDrafts',
    'chapterVersions',
    'generationRunTraces'
  ]
  const visible = preferred
    .map((collection) => ({ collection, count: summary.counts[collection] ?? 0 }))
    .filter(({ count }) => count > 0)
  const visibleCount = visible.reduce((sum, item) => sum + item.count, 0)
  const detail = visible.map(({ collection, count }) => `${collectionName(collection)} ${count} 条`).join('、')
  const remaining = Math.max(0, summary.totalRelatedRecords - visibleCount)
  if (!detail) return `关联记录 ${summary.totalRelatedRecords} 条`
  return remaining > 0 ? `${detail}，以及其他关联记录 ${remaining} 条` : detail
}

export function removeProjectFromAppData(data: AppData, projectId: ID): AppData {
  const { jobIds, revisionSessionIds } = projectRelationIds(data, projectId)
  const next: AppData = {
    ...data,
    projects: data.projects.filter((item) => item.id !== projectId),
    chapterGenerationSteps: data.chapterGenerationSteps.filter((item) => !jobIds.has(item.jobId)),
    revisionRequests: data.revisionRequests.filter((item) => !revisionSessionIds.has(item.sessionId)),
    revisionVersions: data.revisionVersions.filter((item) => !revisionSessionIds.has(item.sessionId))
  }
  for (const collection of PROJECT_SCOPED_COLLECTIONS) {
    const items = data[collection] as ProjectOwnedRecord[]
    setCollection(next, collection, items.filter((item) => item.projectId !== projectId))
  }
  return next
}
