import { parseChapterNumbersFromText } from '../../../shared/chapterText'
import { isForeshadowingAvailableAtChapter, shouldRecommendForeshadowing } from '../../../shared/foreshadowingTreatment'
import type { Character, Foreshadowing } from '../../../shared/types'

export function expectedPayoffNearText(text: string, targetChapterOrder: number): boolean {
  const numbers = parseChapterNumbersFromText(text)
  return numbers.some((number) => Math.abs(number - targetChapterOrder) <= 3)
}

export function recommendedForeshadowings(
  items: Foreshadowing[],
  targetChapterOrder: number
): Foreshadowing[] {
  return items.filter((item) =>
    isForeshadowingAvailableAtChapter(item, targetChapterOrder) && shouldRecommendForeshadowing(
      item,
      expectedPayoffNearText(item.expectedPayoff, targetChapterOrder)
    )
  )
}

export function recommendedCharacters(
  characters: Character[],
  foreshadowings: Foreshadowing[]
): Character[] {
  const relatedIds = new Set(foreshadowings.flatMap((item) => item.relatedCharacterIds))
  return characters.filter((character) => character.isMain || relatedIds.has(character.id))
}
