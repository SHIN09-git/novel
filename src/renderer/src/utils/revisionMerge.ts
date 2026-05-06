export class LocalRevisionMergeError extends Error {
  constructor(
    message: string,
    readonly code: 'empty_target' | 'target_not_found' | 'target_not_unique'
  ) {
    super(message)
    this.name = 'LocalRevisionMergeError'
  }
}

function countExactMatches(source: string, target: string): number[] {
  const positions: number[] = []
  let index = source.indexOf(target)
  while (index !== -1) {
    positions.push(index)
    index = source.indexOf(target, index + target.length)
  }
  return positions
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function whitespaceFlexiblePattern(target: string): RegExp | null {
  const parts = target.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  return new RegExp(parts.map(escapeRegExp).join('\\s+'), 'g')
}

function replaceAt(source: string, start: number, length: number, replacement: string): string {
  return `${source.slice(0, start)}${replacement}${source.slice(start + length)}`
}

function normalizeForComparison(value: string): string {
  return value.replace(/\s+/g, '')
}

function findUniqueTargetMatch(sourceBody: string, targetRange: string): { start: number; length: number } | null {
  const target = targetRange.trim()
  const exactMatches = countExactMatches(sourceBody, target)
  if (exactMatches.length === 1) {
    return { start: exactMatches[0], length: target.length }
  }

  const flexiblePattern = whitespaceFlexiblePattern(target)
  if (!flexiblePattern) return null
  const flexibleMatches = [...sourceBody.matchAll(flexiblePattern)]
  if (flexibleMatches.length !== 1) return null
  return { start: flexibleMatches[0].index ?? 0, length: flexibleMatches[0][0].length }
}

export function looksLikeFullChapterRevision(fullChapterText: string, targetRange: string, revisedText: string): boolean {
  const full = normalizeForComparison(fullChapterText)
  const target = normalizeForComparison(targetRange)
  const revised = normalizeForComparison(revisedText)
  if (!full || !target || !revised) return false

  if (revised.length > full.length * 0.9) return true
  if (revised.length < Math.max(target.length * 2, full.length * 0.45)) return false

  const match = findUniqueTargetMatch(fullChapterText, targetRange)
  if (!match) return false

  const before = normalizeForComparison(fullChapterText.slice(0, match.start)).slice(-80)
  const after = normalizeForComparison(fullChapterText.slice(match.start + match.length)).slice(0, 80)
  const beforeNeedle = before.slice(-24)
  const afterNeedle = after.slice(0, 24)

  return Boolean(
    (beforeNeedle.length >= 12 && revised.includes(beforeNeedle)) ||
      (afterNeedle.length >= 12 && revised.includes(afterNeedle))
  )
}

export function mergeLocalRevisionSafely(sourceBody: string, targetRange: string, revisedText: string): string {
  const target = targetRange.trim()
  if (!target) {
    throw new LocalRevisionMergeError('局部修订目标为空。', 'empty_target')
  }

  const exactMatches = countExactMatches(sourceBody, target)
  if (exactMatches.length === 1) {
    return replaceAt(sourceBody, exactMatches[0], target.length, revisedText)
  }
  if (exactMatches.length > 1) {
    throw new LocalRevisionMergeError('局部修订目标在原文中出现多次。', 'target_not_unique')
  }

  const flexiblePattern = whitespaceFlexiblePattern(target)
  if (!flexiblePattern) {
    throw new LocalRevisionMergeError('局部修订目标未能在原文中匹配。', 'target_not_found')
  }

  const flexibleMatches = [...sourceBody.matchAll(flexiblePattern)]
  if (flexibleMatches.length === 1) {
    const match = flexibleMatches[0]
    return replaceAt(sourceBody, match.index ?? 0, match[0].length, revisedText)
  }
  if (flexibleMatches.length > 1) {
    throw new LocalRevisionMergeError('局部修订目标在原文中出现多次。', 'target_not_unique')
  }

  throw new LocalRevisionMergeError('局部修订目标未能在原文中匹配。', 'target_not_found')
}
