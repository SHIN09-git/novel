import type { AppData, Chapter, Character, CharacterCardField, CharacterStateFact, CharacterStateLog, ContextNeedPlan, ID, StateFactCategory } from '../shared/types'
import { inferFactDraftFromLog } from './characterState/logInference'
import {
  applyStateChangeCandidate,
  createCandidateFromLog,
  createFactFromLog,
  createOrUpdateFact,
  previewStateChangeCandidate,
  rejectStateChangeCandidate
} from './characterState/stateMutations'
import { getRelevantCharacterStatesForPrompt } from './characterState/stateSelection'
import { defaultLinkedCardFields, stateValueToText, type CharacterStateFactDraft } from './characterState/stateValue'
import { validateCharacterStateInText, type StateValidationIssue } from './characterState/stateValidation'

export type { CharacterStateFactDraft } from './characterState/stateValue'
export type { StateValidationIssue } from './characterState/stateValidation'

export class CharacterStateService {
  static formatFactValue = stateValueToText
  static previewStateChangeCandidate = previewStateChangeCandidate

  static getDefaultLinkedCardFieldsForCategory(category: StateFactCategory): CharacterCardField[] {
    return defaultLinkedCardFields(category)
  }

  static inferFactDraftFromLog(
    logText: string,
    character: Pick<Character, 'id' | 'projectId'>,
    chapter?: Pick<Chapter, 'id' | 'order'> | null
  ): CharacterStateFactDraft {
    return inferFactDraftFromLog(logText, character, chapter)
  }

  static getRelevantCharacterStatesForPrompt(
    characterIds: ID[],
    contextNeedPlan: ContextNeedPlan | null,
    targetChapterOrder: number,
    facts: CharacterStateFact[]
  ): CharacterStateFact[] {
    return getRelevantCharacterStatesForPrompt(characterIds, contextNeedPlan, targetChapterOrder, facts)
  }

  static createOrUpdateFact(factInput: CharacterStateFactDraft, appData: AppData): AppData {
    return createOrUpdateFact(factInput, appData)
  }

  static createFactFromLog(log: CharacterStateLog, draft: CharacterStateFactDraft, appData: AppData): AppData {
    return createFactFromLog(log, draft, appData)
  }

  static createCandidateFromLog(log: CharacterStateLog, draft: CharacterStateFactDraft, appData: AppData): AppData {
    return createCandidateFromLog(log, draft, appData)
  }

  static applyStateChangeCandidate(candidateId: ID, appData: AppData): AppData {
    return applyStateChangeCandidate(candidateId, appData)
  }

  static rejectStateChangeCandidate(candidateId: ID, appData: AppData): AppData {
    return rejectStateChangeCandidate(candidateId, appData)
  }

  static validateCharacterStateInText(
    chapterText: string,
    facts: CharacterStateFact[],
    characters: Character[] = []
  ): StateValidationIssue[] {
    return validateCharacterStateInText(chapterText, facts, characters)
  }
}
