import type { HardCanonItem } from '../shared/types'
import { normalizeHardCanonCheck } from '../shared/normalizers/hardCanonCheck'

export interface HardCanonDuplicates {
  exact: HardCanonItem | null
  possible: HardCanonItem[]
}

const setOf = (values?: string[]) => [...new Set(values)].sort()

function scope(item: HardCanonItem): string {
  const check = normalizeHardCanonCheck(item.check)
  const bounds = check && [check.enforcement, check.fromChapter ?? 1, check.toChapter]
  const condition = !check ? null : check.kind === 'literal'
    ? [check.kind, check.mode, setOf(check.terms), setOf(check.exceptions),
        check.maxPerChapter ?? (check.maxPerBook === undefined ? 0 : null), check.maxPerBook, bounds]
    : [check.kind, check.actor, check.characterId, setOf(check.aliases), setOf(check.actions),
        check.side, setOf(check.objects), check.state, check.effect, bounds]
  return JSON.stringify([item.projectId, item.category, setOf(item.relatedCharacterIds),
    setOf(item.relatedForeshadowingIds), setOf(item.relatedTimelineEventIds), condition])
}

// Numbering, punctuation and paraphrases are ONLY folded for suggestions.
// In particular, never remove digits from a literal term or a numeric limit.
function comparable(text: string): string {
  return text.normalize('NFKC').trim()
    .replace(/^(?:[【[(]?\s*(?:规则|条款|设定|hard\s*canon|HC|R|#)\s*[-_#]?\s*[\d一二三四五六七八九十]+[】\])：:、.．\s-]*|第[\d一二三四五六七八九十]+条[：:、.．\s-]*|[（(]?[\d一二三四五六七八九十]+[)）.、：:\s-]+)/iu, '')
    .replace(/(?:不可以|不能|不准|不许|不得|严禁|禁止)/gu, '禁')
    .replace(/不可/gu, '禁').replace(/(?:可以|准许|许可|允许)/gu, '许')
    .replace(/(?:务必|必须)/gu, '须').replace(/[\p{P}\s]/gu, '')
}

function pairs(text: string): Set<string> {
  const chars = Array.from(text)
  return new Set(chars.slice(1).map((ch, i) => chars[i] + ch))
}

function similar(left: string, right: string): boolean {
  if (!left || !right) return false
  if (left === right) return true
  if (Math.min(left.length, right.length) < 4) return false
  const a = pairs(left), b = pairs(right)
  let shared = 0
  for (const pair of a) if (b.has(pair)) shared++
  return 2 * shared / (a.size + b.size) >= 0.6
}

export function compareHardCanonItems(items: HardCanonItem[], candidate: HardCanonItem): HardCanonDuplicates {
  const result: HardCanonDuplicates = { exact: null, possible: [] }
  const key = scope(candidate)
  const title = candidate.title.trim(), content = candidate.content.trim()
  const body = comparable(content), heading = comparable(title)
  const prior = items.find((item) => item.id === candidate.id)
  // Editing the metadata of an already duplicated legacy record must still
  // target that record, without merging it or preventing explicit retirement.
  const unchanged = prior && prior.title.trim() === title && prior.content.trim() === content && scope(prior) === key
  for (const item of items) {
    if (item.id === candidate.id || scope(item) !== key) continue
    if (item.title.trim() === title && item.content.trim() === content) {
      if (!unchanged) result.exact ??= item
      continue
    }
    const other = comparable(item.content)
    if ((body.includes('禁') && !other.includes('禁') && other.includes('许')) ||
        (other.includes('禁') && !body.includes('禁') && body.includes('许'))) continue
    if (candidate.check || similar(body, other) || (heading && heading === comparable(item.title))) {
      result.possible.push(item)
    }
  }
  return result
}
