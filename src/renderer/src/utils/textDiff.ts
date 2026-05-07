export type TextDiffSegmentType = 'equal' | 'insert' | 'delete' | 'replace'

export interface TextDiffSegment {
  type: TextDiffSegmentType
  originalText?: string
  revisedText?: string
  text?: string
}

export interface TextDiffResult {
  segments: TextDiffSegment[]
  stats: {
    insertedChars: number
    deletedChars: number
    replacedChars: number
    unchangedChars: number
    changeRatio: number
  }
}

const MAX_DP_CELLS = 120_000

function splitReadableBlocks(text: string): string[] {
  if (!text) return []
  return text.match(/[^\n]+(?:\n+|$)|\n+/g) ?? [text]
}

function countChars(text: string): number {
  return text.replace(/\s/g, '').length
}

function buildStats(segments: TextDiffSegment[]): TextDiffResult['stats'] {
  let insertedChars = 0
  let deletedChars = 0
  let replacedChars = 0
  let unchangedChars = 0

  for (const segment of segments) {
    if (segment.type === 'equal') unchangedChars += countChars(segment.text ?? '')
    if (segment.type === 'insert') insertedChars += countChars(segment.revisedText ?? segment.text ?? '')
    if (segment.type === 'delete') deletedChars += countChars(segment.originalText ?? segment.text ?? '')
    if (segment.type === 'replace') {
      const originalChars = countChars(segment.originalText ?? '')
      const revisedChars = countChars(segment.revisedText ?? '')
      replacedChars += Math.max(originalChars, revisedChars)
    }
  }

  const total = unchangedChars + insertedChars + deletedChars + replacedChars
  return {
    insertedChars,
    deletedChars,
    replacedChars,
    unchangedChars,
    changeRatio: total > 0 ? (insertedChars + deletedChars + replacedChars) / total : 0
  }
}

function compactSegments(segments: TextDiffSegment[]): TextDiffSegment[] {
  const compacted: TextDiffSegment[] = []
  for (const segment of segments) {
    const previous = compacted[compacted.length - 1]
    if (!previous || previous.type !== segment.type || segment.type === 'replace') {
      compacted.push({ ...segment })
      continue
    }
    if (segment.type === 'equal') previous.text = `${previous.text ?? ''}${segment.text ?? ''}`
    if (segment.type === 'insert') previous.revisedText = `${previous.revisedText ?? ''}${segment.revisedText ?? segment.text ?? ''}`
    if (segment.type === 'delete') previous.originalText = `${previous.originalText ?? ''}${segment.originalText ?? segment.text ?? ''}`
  }

  const merged: TextDiffSegment[] = []
  for (let index = 0; index < compacted.length; index += 1) {
    const current = compacted[index]
    const next = compacted[index + 1]
    if (current.type === 'delete' && next?.type === 'insert') {
      merged.push({
        type: 'replace',
        originalText: current.originalText ?? current.text ?? '',
        revisedText: next.revisedText ?? next.text ?? ''
      })
      index += 1
    } else {
      merged.push(current)
    }
  }
  return merged.filter((segment) => {
    if (segment.type === 'equal') return Boolean(segment.text)
    if (segment.type === 'insert') return Boolean(segment.revisedText || segment.text)
    if (segment.type === 'delete') return Boolean(segment.originalText || segment.text)
    return Boolean(segment.originalText || segment.revisedText)
  })
}

function indexFallbackDiff(originalBlocks: string[], revisedBlocks: string[]): TextDiffSegment[] {
  const segments: TextDiffSegment[] = []
  const maxLength = Math.max(originalBlocks.length, revisedBlocks.length)
  for (let index = 0; index < maxLength; index += 1) {
    const original = originalBlocks[index]
    const revised = revisedBlocks[index]
    if (original === revised) {
      segments.push({ type: 'equal', text: original })
    } else if (typeof original === 'undefined') {
      segments.push({ type: 'insert', revisedText: revised })
    } else if (typeof revised === 'undefined') {
      segments.push({ type: 'delete', originalText: original })
    } else {
      segments.push({ type: 'replace', originalText: original, revisedText: revised })
    }
  }
  return compactSegments(segments)
}

function lcsDiff(originalBlocks: string[], revisedBlocks: string[]): TextDiffSegment[] {
  const rows = originalBlocks.length
  const cols = revisedBlocks.length
  const table = Array.from({ length: rows + 1 }, () => new Uint16Array(cols + 1))

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      table[row][col] =
        originalBlocks[row] === revisedBlocks[col]
          ? table[row + 1][col + 1] + 1
          : Math.max(table[row + 1][col], table[row][col + 1])
    }
  }

  const segments: TextDiffSegment[] = []
  let row = 0
  let col = 0
  while (row < rows && col < cols) {
    if (originalBlocks[row] === revisedBlocks[col]) {
      segments.push({ type: 'equal', text: originalBlocks[row] })
      row += 1
      col += 1
    } else if (table[row + 1][col] >= table[row][col + 1]) {
      segments.push({ type: 'delete', originalText: originalBlocks[row] })
      row += 1
    } else {
      segments.push({ type: 'insert', revisedText: revisedBlocks[col] })
      col += 1
    }
  }
  while (row < rows) {
    segments.push({ type: 'delete', originalText: originalBlocks[row] })
    row += 1
  }
  while (col < cols) {
    segments.push({ type: 'insert', revisedText: revisedBlocks[col] })
    col += 1
  }
  return compactSegments(segments)
}

export function createTextDiff(originalText: string, revisedText: string): TextDiffResult {
  if (originalText === revisedText) {
    const segments: TextDiffSegment[] = originalText ? [{ type: 'equal', text: originalText }] : []
    return { segments, stats: buildStats(segments) }
  }

  const originalBlocks = splitReadableBlocks(originalText)
  const revisedBlocks = splitReadableBlocks(revisedText)
  const shouldUseFallback =
    originalBlocks.length * revisedBlocks.length > MAX_DP_CELLS ||
    originalText.length + revisedText.length > 80_000
  const segments = shouldUseFallback ? indexFallbackDiff(originalBlocks, revisedBlocks) : lcsDiff(originalBlocks, revisedBlocks)
  return { segments, stats: buildStats(segments) }
}
