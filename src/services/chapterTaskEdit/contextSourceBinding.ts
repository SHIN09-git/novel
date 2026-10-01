import type { AppData, ID } from '../../shared/types'
import { activeChapters } from '../ChapterLifecycleService'
import { draftContentHash } from '../DraftDiagnosticBindingService'
import { stableDecisionJson } from '../candidateDecisionPrimitives'

// Candidate inputs to prepareTaskContext's deterministic planning/selection/build steps.
// Bind candidates, not just selected ids: an added or edited record can change selection.
const CONTEXT_COLLECTIONS = [
  'storyBibles', 'characters', 'characterStateLogs', 'characterStateFacts',
  'foreshadowings', 'timelineEvents', 'stageSummaries', 'chapterContinuityBridges', 'hardCanonPacks'
] as const

export function chapterTaskContextSourceSignature(data: AppData, projectId: ID, targetChapterOrder: number): string {
  const project = data.projects.find((item) => item.id === projectId)
  const sources = Object.fromEntries(CONTEXT_COLLECTIONS.map((key) =>
    [key, data[key].filter((item) => item.projectId === projectId)]))
  const input = {
    projectId,
    targetChapterOrder,
    project: project ? {
      id: project.id, name: project.name, genre: project.genre, description: project.description,
      targetReaders: project.targetReaders, coreAppeal: project.coreAppeal, style: project.style
    } : null,
    chapters: activeChapters(data.chapters).filter((item) => item.projectId === projectId && item.order < targetChapterOrder),
    ...sources
  }
  // Preserve array order (selection ties and first-bible/pack lookup depend on it).
  // No settings, credentials, run history or project navigation metadata enter this signature.
  return draftContentHash(stableDecisionJson(input)).replace('draft-v1-', 'task-context-v1-')
}

export function assertChapterTaskContextSourceCurrent(
  data: AppData, projectId: ID, targetChapterOrder: number, expectedSignature: string
): void {
  if (chapterTaskContextSourceSignature(data, projectId, targetChapterOrder) !== expectedSignature) {
    throw new Error('本章上下文资料已变化，本次任务未保存，编辑仍保留。请再次保存任务，以最新资料重新准备上下文。')
  }
}
