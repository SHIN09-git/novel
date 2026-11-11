import type { HardCanonLiteralCheck } from '../../shared/types'
import { alternatives, matchSpan, merged, overlaps, quotationSpans, type Span } from './text'

const latinToken = /[\p{Script=Latin}\d][\p{Script=Latin}\p{M}\d]*(?:[-_./'’][\p{Script=Latin}\d][\p{Script=Latin}\p{M}\d]*)*/gu
const latin = /\p{Script=Latin}/u
const wordChar = /[\p{Script=Latin}\p{M}\d_]/u

export function protectionPattern(words: string[]): RegExp {
  // Lookahead also covers overlapping exceptions that start at different offsets.
  return new RegExp('(?=(' + alternatives(words).source + '))', 'gu')
}

function protectedWords(text: string, pattern: RegExp): Span[] {
  return Array.from(text.matchAll(pattern), (m) => ({ start: m.index!, end: m.index! + m[1].length }))
}

export interface LiteralText { body: string; protected: Span[] }

export function literalText(body: string, names: RegExp | undefined, quotes = quotationSpans(body)): LiteralText {
  const spans = names ? [...quotes, ...protectedWords(body, names)] : [...quotes]
  for (const m of body.matchAll(latinToken)) {
    const token = m[0], { start, end } = matchSpan(m)
    if (!latin.test(token)) continue
    const identifier = /[\d_/]|\p{Ll}.*\p{Lu}/u.test(token)
    const named = /(?:型号|代号|编号|人名|品牌|英文名|名叫|名为|名字)[为是叫作：:\s]*$/u.test(body.slice(Math.max(0, start - 16), start)) ||
      /^(?:型|号机|号线|系列)/u.test(body.slice(end, end + 3))
    if (identifier || named) spans.push({ start, end })
  }
  return { body, protected: merged(spans) }
}

// Do not find a banned Latin word inside another word or a hyphenated name.
function insideWord(body: string, start: number, end: number): boolean {
  return (wordChar.test(body[start]!) && (wordChar.test(body[start - 1] ?? '') ||
    (/[-./'’]/u.test(body[start - 1] ?? '') && wordChar.test(body[start - 2] ?? '')))) ||
    (wordChar.test(body[end - 1]!) && (wordChar.test(body[end] ?? '') ||
    (/[-./'’]/u.test(body[end] ?? '') && wordChar.test(body[end + 1] ?? ''))))
}

export function literalCounter(check: HardCanonLiteralCheck): (text: LiteralText, onMatch?: (span: Span) => void) => number {
  const genericLatin = check.mode === 'latin' && check.terms.length === 0
  const pattern = genericLatin ? latinToken : alternatives(check.terms)
  const exceptions = check.exceptions?.length ? protectionPattern(check.exceptions) : undefined
  return (text, onMatch) => {
    const except = exceptions ? merged(protectedWords(text.body, exceptions)) : []
    let count = 0
    for (const m of text.body.matchAll(pattern)) {
      const word = m[0], span = matchSpan(m)
      if (check.mode === 'latin' && !latin.test(word)) continue
      // In broad Latin mode capitals may be names/acronyms. Only an explicitly
      // configured spelling can select one, and registered names/models remain protected.
      if (genericLatin && /\p{Lu}/u.test(word)) continue
      if (insideWord(text.body, span.start, span.end) || overlaps(text.protected, span) || overlaps(except, span)) continue
      count++
      onMatch?.(span)
    }
    return count
  }
}
