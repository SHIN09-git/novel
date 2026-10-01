import type {
  ForeshadowingCandidate,
  ForeshadowingStatus,
  ForeshadowingStatusChangeSuggestion
} from '../../../../shared/types'
import type { ChapterForeshadowingActionContext } from './chapterAiCandidateActionHandlers'

const loadCandidateActions = () => import('./chapterAiCandidateActionHandlers')

export function useChapterForeshadowingActions(context: ChapterForeshadowingActionContext) {
  return {
    applyForeshadowingCandidate: async (
      candidate: ForeshadowingCandidate,
      status: ForeshadowingStatus = 'unresolved'
    ) => (await loadCandidateActions()).applyForeshadowingCandidate(context, candidate, status),
    applyStatusChange: async (change: ForeshadowingStatusChangeSuggestion) =>
      (await loadCandidateActions()).applyForeshadowingStatusChange(context, change)
  }
}
