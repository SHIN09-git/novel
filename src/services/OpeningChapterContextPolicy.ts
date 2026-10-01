import type { Character } from '../shared/types'

export const OPENING_READER_EMOTION_FALLBACK = '从本章任务指定的情绪自然建立基线；不承接不存在的上一章情绪，也不预告后续阶段的压力。'

export function shouldIsolateOpeningLegacyContext(targetChapterOrder: number, hasAuthoritativeTask: boolean): boolean {
  return hasAuthoritativeTask && targetChapterOrder === 1
}

export function isolateOpeningCharacterCards(characters: Character[]): Character[] {
  return characters.map((character) => ({
    ...character,
    role: '',
    surfaceGoal: '',
    deepDesire: '',
    coreFear: '',
    selfDeception: '',
    knownInformation: '',
    unknownInformation: '',
    protagonistRelationship: '',
    emotionalState: '',
    nextActionTendency: '',
    forbiddenWriting: ''
  }))
}
