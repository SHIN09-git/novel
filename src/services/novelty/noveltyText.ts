import { keywordOccurrences } from './noveltyMatcher'
import { normalizeForMatch } from './noveltyTextCore'

export {
  includesAny,
  nearby,
  normalizeForMatch,
  textList,
  unique
} from './noveltyTextCore'
export {
  keywordOccurrences,
  longestKeywordMatches,
  type KeywordOccurrence
} from './noveltyMatcher'

type NoveltyTextMatchMemo = Map<string, Map<string, boolean>>

let activeAuditMemo: NoveltyTextMatchMemo | null = null

// Audits are synchronous; nested calls get their own memo and restore the caller's.
export function withNoveltyAuditMemo<T>(run: () => T): T {
  const previousMemo = activeAuditMemo
  const memo: NoveltyTextMatchMemo = new Map()
  activeAuditMemo = memo
  try {
    return run()
  } finally {
    activeAuditMemo = previousMemo
    memo.clear()
  }
}

export function textMatches(source: string, term: string): boolean {
  const memo = activeAuditMemo
  if (!memo) return textMatchesUncached(source, term)
  const cached = memo.get(source)?.get(term)
  if (cached !== undefined) return cached
  const result = textMatchesUncached(source, term)
  const terms = memo.get(source) ?? new Map<string, boolean>()
  terms.set(term, result)
  memo.set(source, terms)
  return result
}

function textMatchesUncached(source: string, term: string): boolean {
  const normalizedSource = normalizeForMatch(source)
  const normalizedTerm = normalizeForMatch(term)
  if (!normalizedSource || !normalizedTerm || normalizedTerm.length < 2) return false
  if (normalizedSource === normalizedTerm) return true
  return keywordOccurrences(source, [term], 0).length > 0
}
