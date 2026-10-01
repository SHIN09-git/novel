import type { CharacterStateChangeSuggestion, CharacterStateSuggestion } from '../../../../shared/types'
import type { ChapterCharacterActionContext } from './chapterAiCandidateActionHandlers'

const loadCandidateActions = () => import('./chapterAiCandidateActionHandlers')

export function useChapterCharacterActions(context: ChapterCharacterActionContext) {
  return {
    applyCharacterSuggestion: async (suggestion: CharacterStateSuggestion) =>
      (await loadCandidateActions()).applyCharacterSuggestion(context, suggestion),
    createStateChangeCandidate: async (suggestion: CharacterStateChangeSuggestion) =>
      (await loadCandidateActions()).createStateChangeCandidate(context, suggestion)
  }
}
