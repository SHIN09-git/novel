export interface Span { start: number; end: number }

export function alternatives(words: readonly string[]): RegExp {
  const ordered = [...new Set(words)].filter(Boolean).sort().sort((a, b) => b.length - a.length)
  return new RegExp(ordered.map((w) => w.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&')).join('|') || '(?!)', 'gu')
}

export function matchSpan(m: RegExpMatchArray): Span {
  return { start: m.index!, end: m.index! + m[0].length }
}

export function merged(spans: Span[]): Span[] {
  const out: Span[] = []
  for (const span of spans.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = out.at(-1)
    if (last && last.end >= span.start) last.end = Math.max(last.end, span.end)
    else out.push({ ...span })
  }
  return out
}

/** Binary search on sorted, disjoint ranges; positions always index the original string. */
export function overlaps(ranges: readonly Span[], { start, end }: Span): boolean {
  let lo = 0, hi = ranges.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (ranges[mid].end <= start) lo = mid + 1
    else hi = mid
  }
  return lo < ranges.length && ranges[lo].start < end
}

const quotes: Record<string, string> = { '“': '”', '‘': '’', '「': '」', '『': '』', '《': '》', '〈': '〉', '"': '"', "'": "'" }
const wordChar = /[\p{Script=Latin}\p{M}\d]/u

export function quotationSpans(text: string): Span[] {
  const spans: Span[] = []
  const stack: string[] = []
  let open = 0
  for (const m of text.matchAll(/["'‘’“”「」『』《》〈〉]/gu)) {
    const at = m.index!, ch = m[0]
    if ((ch === "'" || ch === '’') && wordChar.test(text[at - 1] ?? '') && wordChar.test(text[at + 1] ?? '')) continue
    if (ch === stack.at(-1)) {
      stack.pop()
      if (!stack.length) spans.push({ start: open, end: at + 1 })
    } else if (quotes[ch]) {
      if (!stack.length) open = at
      stack.push(quotes[ch])
    }
  }
  if (stack.length) spans.push({ start: open, end: text.length })
  // Dialogue introduced by a speaker and a colon need not have quotation marks.
  for (const m of text.matchAll(/(?:说(?:道)?|问(?:道)?|答(?:道)?|喊(?:道)?|转述|道)[：:][ \t　]*(?:\r\n?|\n)?[ \t　]*/gu)) {
    const start = m.index! + m[0].length
    const utterance = /[^。！？!?\r\n“‘「『"']+/uy
    utterance.lastIndex = start
    const speech = utterance.exec(text)
    if (speech) spans.push({ start, end: start + speech[0].length })
  }
  return merged(spans)
}

export interface Clause extends Span { text: string; uncertain: boolean; previous: string }

const pastFrame = /(?:回忆(?:起|中|里)?|回想起?|忆起|记忆中|闪回|梦(?:中|里|见|到)|当年|那一年|那年|那时候|那时|[多几数半一两二三四五六七八九十百千\d]+年前|小时候|从前|昔日|往昔)/
const presentFrame = /^(?:回到(?:眼前|现实|现在)|回过神|眼下|此刻|现在|如今|回忆结束|梦醒)/
const reported = /(?:听说|据说|传说|传闻|传言|据传|据称|转述|声称|谎称|提到|听闻|听人说|听.{1,8}说|说过|曾经|记得|假设|假如|如果|要是|倘若|万一|也许|或许|仿佛|好像|似乎|可能|是否|难道|莫非|据.{1,8}(?:说|称)|说(?:道)?[：:]|问(?:道)?[：:])/

export function clauses(text: string, quotations: Span[]): Clause[] {
  const out: Clause[] = []
  let past = false
  // Quotes may run over paragraphs; a flashback may run over sentences. Only an
  // explicit return to the present ends that frame. A report/question scopes its sentence.
  for (const sentence of text.matchAll(/[^。！？!?；;\r\n]+[。！？!?；;]*/gu)) {
    let indirect = /[？?]|[，,](?:那|这)?(?:只|仅|全)?是(?:传闻|传言|猜测|假设|谣言|回忆|旧梦)/u.test(sentence[0])
    let previous = ''
    for (const m of sentence[0].matchAll(/[^，,。！？!?；;：:“”‘’「」『』《》〈〉"']+/gu)) {
      const clause = m[0].trim()
      if (!clause) continue
      const start = sentence.index! + m.index! + m[0].indexOf(clause)
      const span = { start, end: start + clause.length }
      const quoted = overlaps(quotations, span)
      const followedByColon = /^[：:]/.test(text.slice(span.end, span.end + 1))
      if (!quoted) {
        if (presentFrame.test(clause)) { past = false; indirect = false }
        if (pastFrame.test(clause)) past = true
        if (reported.test(clause) || /(?:说(?:道)?|回忆道|声称|告诉我|提起|写道|坦言)$/.test(clause) ||
            (followedByColon && /(?:道|问|喊|答)$/.test(clause))) indirect = true
      }
      out.push({ ...span, text: clause, previous, uncertain: quoted || past || indirect })
      previous = clause
    }
  }
  return out
}
