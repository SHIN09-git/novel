import { nearby, normalizeForMatch, unique } from './noveltyTextCore'

export interface KeywordOccurrence {
  keyword: string
  index: number
  sentence: string
  evidenceExcerpt: string
  /** Original UTF-16 offsets; optional additions preserve the previous API surface. */
  matchEnd?: number
  sentenceStart?: number
  sentenceEnd?: number
}

interface TrieNode {
  children: Map<string, TrieNode>
  keywords: string[]
}

interface NormalizedText {
  value: string
  originalStarts: number[]
  originalEnds: number[]
}

interface SentenceRange {
  start: number
  end: number
}

type SegmenterLike = {
  segment(input: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }>
}

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
) => SegmenterLike

const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter
let chineseWordSegmenter: SegmenterLike | null | undefined
const trieCache = new Map<string, TrieNode>()
const MAX_TRIE_CACHE_ENTRIES = 64
const MAX_UNIQUE_SENTENCES_PER_KEYWORD = 256
const HAN_PATTERN = /\p{Script=Han}/u
const ASCII_WORD_PATTERN = /[A-Za-z0-9_]/
const ALLOWED_CHINESE_SUFFIXES = new Set(['权', '制', '规则', '机制', '条款', '权限', '身份', '范围', '系统', '协议', '层级', '等级'])

function normalizeWithOffsets(value: string): NormalizedText {
  let normalized = ''
  const originalStarts: number[] = []
  const originalEnds: number[] = []
  for (let offset = 0; offset < value.length;) {
    const codePoint = value.codePointAt(offset)
    const sourceCharacter = String.fromCodePoint(codePoint ?? value.charCodeAt(offset))
    const mapped = sourceCharacter.normalize('NFKC').toLowerCase()
    const end = offset + sourceCharacter.length
    normalized += mapped
    for (let index = 0; index < mapped.length; index += 1) {
      originalStarts.push(offset)
      originalEnds.push(end)
    }
    offset = end
  }
  return { value: normalized, originalStarts, originalEnds }
}

function trieForKeywords(keywords: string[]): TrieNode {
  const normalizedKeywords = unique(keywords.map((keyword) => keyword.trim()).filter(Boolean))
    .map((keyword) => ({ keyword, normalized: keyword.normalize('NFKC').toLowerCase() }))
    .filter((entry) => entry.normalized)
    .sort((left, right) => left.normalized.localeCompare(right.normalized))
  const cacheKey = normalizedKeywords.map((entry) => `${entry.normalized}:${entry.keyword}`).join('\u0000')
  const cached = trieCache.get(cacheKey)
  if (cached) return cached

  const root: TrieNode = { children: new Map(), keywords: [] }
  for (const entry of normalizedKeywords) {
    let node = root
    for (const character of entry.normalized) {
      let child = node.children.get(character)
      if (!child) {
        child = { children: new Map(), keywords: [] }
        node.children.set(character, child)
      }
      node = child
    }
    node.keywords.push(entry.keyword)
  }
  trieCache.set(cacheKey, root)
  if (trieCache.size > MAX_TRIE_CACHE_ENTRIES) {
    const oldestKey = trieCache.keys().next().value
    if (oldestKey) trieCache.delete(oldestKey)
  }
  return root
}

function chineseBoundaries(text: string): Set<number> | null {
  if (chineseWordSegmenter === undefined) {
    chineseWordSegmenter = Segmenter ? new Segmenter('zh-CN', { granularity: 'word' }) : null
  }
  if (!chineseWordSegmenter) return null
  const boundaries = new Set<number>([0, text.length])
  for (const segment of chineseWordSegmenter.segment(text)) {
    boundaries.add(segment.index)
    boundaries.add(segment.index + segment.segment.length)
  }
  return boundaries
}

function nextBoundary(boundaries: Set<number>, from: number, textLength: number): number {
  for (let index = from + 1; index <= textLength; index += 1) {
    if (boundaries.has(index)) return index
  }
  return textLength
}

function validChineseBoundary(text: string, start: number, end: number, boundaries: Set<number> | null): boolean {
  // Node and Electron ship Intl.Segmenter. The fallback retains legacy matching
  // rather than silently disabling audits on an unusual JS runtime.
  if (!boundaries) return true
  if (!boundaries.has(start)) return false
  if (boundaries.has(end)) return true
  const suffixEnd = nextBoundary(boundaries, end, text.length)
  return ALLOWED_CHINESE_SUFFIXES.has(text.slice(end, suffixEnd))
}

function validAsciiBoundary(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : ''
  const after = end < text.length ? text[end] : ''
  return (!before || !ASCII_WORD_PATTERN.test(before)) && (!after || !ASCII_WORD_PATTERN.test(after))
}

function hasValidBoundary(text: string, keyword: string, start: number, end: number, boundaries: Set<number> | null): boolean {
  const hasHan = HAN_PATTERN.test(keyword)
  const hasAsciiWord = /[A-Za-z0-9_]/.test(keyword)
  if (hasHan && !validChineseBoundary(text, start, end, boundaries)) return false
  if (hasAsciiWord && !validAsciiBoundary(text, start, end)) return false
  return true
}

function sentenceRanges(text: string): SentenceRange[] {
  const ranges: SentenceRange[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (!/[。！？!?\n]/.test(text[index])) continue
    ranges.push({ start, end: index + 1 })
    start = index + 1
  }
  if (start < text.length || !ranges.length) ranges.push({ start, end: text.length })
  return ranges
}

function sentenceRangeAt(ranges: SentenceRange[], index: number): SentenceRange {
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const range = ranges[middle]
    if (index < range.start) high = middle - 1
    else if (index >= range.end) low = middle + 1
    else return range
  }
  return ranges[Math.max(0, Math.min(ranges.length - 1, low))]
}

export function keywordOccurrences(text: string, keywords: string[], radius = 130): KeywordOccurrence[] {
  if (!text || !keywords.length) return []
  const normalizedText = normalizeWithOffsets(text)
  const trie = trieForKeywords(keywords)
  const boundaries = chineseBoundaries(text)
  const candidates: Array<{ keyword: string; index: number; end: number }> = []

  // One bounded dictionary scan replaces one full-text scan per keyword.
  for (let normalizedStart = 0; normalizedStart < normalizedText.value.length; normalizedStart += 1) {
    let node = trie
    for (let cursor = normalizedStart; cursor < normalizedText.value.length; cursor += 1) {
      const child = node.children.get(normalizedText.value[cursor])
      if (!child) break
      node = child
      if (!node.keywords.length) continue
      const originalStart = normalizedText.originalStarts[normalizedStart]
      const originalEnd = normalizedText.originalEnds[cursor]
      for (const keyword of node.keywords) {
        if (hasValidBoundary(text, keyword, originalStart, originalEnd, boundaries)) {
          candidates.push({ keyword, index: originalStart, end: originalEnd })
        }
      }
    }
  }

  const accepted: Array<{ keyword: string; index: number; end: number }> = []
  let occupiedUntil = -1
  for (const candidate of candidates.sort((left, right) => left.index - right.index || (right.end - right.index) - (left.end - left.index))) {
    if (candidate.index < occupiedUntil) continue
    accepted.push(candidate)
    occupiedUntil = candidate.end
  }

  const ranges = sentenceRanges(text)
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  const occurrences: KeywordOccurrence[] = []
  for (const candidate of accepted) {
    const range = sentenceRangeAt(ranges, candidate.index)
    const rawSentence = text.slice(range.start, range.end)
    const leadingWhitespace = rawSentence.length - rawSentence.trimStart().length
    const trailingWhitespace = rawSentence.length - rawSentence.trimEnd().length
    const sentenceStart = range.start + leadingWhitespace
    const sentenceEnd = Math.max(sentenceStart, range.end - trailingWhitespace)
    const sentence = text.slice(sentenceStart, sentenceEnd)
    const identity = `${candidate.keyword}\u0000${normalizeForMatch(sentence)}`
    if (seen.has(identity)) continue
    const count = counts.get(candidate.keyword) ?? 0
    if (count >= MAX_UNIQUE_SENTENCES_PER_KEYWORD) continue
    seen.add(identity)
    counts.set(candidate.keyword, count + 1)
    occurrences.push({
      keyword: candidate.keyword,
      index: candidate.index,
      matchEnd: candidate.end,
      sentenceStart,
      sentenceEnd,
      sentence,
      evidenceExcerpt: radius > 0 ? nearby(text, candidate.index, radius) : sentence
    })
  }
  return occurrences
}

export function longestKeywordMatches(text: string, keywords: string[]): string[] {
  return unique(keywordOccurrences(text, keywords, 0).map((occurrence) => occurrence.keyword))
    .sort((left, right) => right.length - left.length)
}
