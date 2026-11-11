import { parseWithFallback } from './AIJsonParser'

export function startsWithNumberedProseLabel(text: string): boolean {
  return /^\[\s*\d[^,[\]{}"'\\\r\n]*\]\s*[,，:：;；。!?！？]?\s*[\p{L}“‘]/u.test(text)
}

export function startsWithChapterJsonArray(text: string): boolean {
  // A JSON number must end at a separator. Neither 07:30 nor 7号站台 is such a token.
  return /^\[\s*(?:$|["'{[\]]|(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null)\s*(?=[,\]]|$))/iu.test(text)
    && !startsWithNumberedProseLabel(text)
}

// Find the end of the outer value, ignoring brackets in JSON strings (including escaped quotes).
function containerEnd(text: string, start: number): number {
  const closers: string[] = []
  let quoted = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '\\') i++
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{' || char === '[') closers.push(char === '{' ? '}' : ']')
    else if (char === '}' || char === ']') {
      if (closers.pop() !== char) return -1
      if (!closers.length) return i + 1
    }
  }
  return -1
}

export function isIncompleteChapterEnvelope(raw: string): boolean {
  const text = raw.trim()
  // Free prose and labels such as [Tuesday] are not JSON envelopes.
  const opening = /[\[{]/gu
  let cursor = 0
  let fences = 0
  for (let match = opening.exec(text); match; match = opening.exec(text)) {
    const at = text.slice(match.index)
    if (at[0] === '[' ? !startsWithChapterJsonArray(at) : match.index !== 0 && !/^\{\s*(?:["{}[\]]|$)/u.test(at)) continue
    const outside = text.slice(cursor, match.index)
    if (cursor && /^\s*[,\]}]/u.test(outside)) return true
    fences += outside.match(/`{3}/gu)?.length ?? 0
    const end = containerEnd(text, match.index)
    if (end < 0) return true
    const parsed = parseWithFallback(text.slice(match.index, end))
    if (!parsed.ok || parsed.source !== 'direct') return true
    opening.lastIndex = cursor = end
  }
  const tail = text.slice(cursor)
  if (!cursor && !/`{3}json\b/iu.test(text)) return false
  fences += tail.match(/`{3}/gu)?.length ?? 0
  return fences % 2 !== 0 || /^\s*[,\]}]/u.test(tail)
}

export function getChapterDraftEnvelopeError(rawText: string | undefined): string | null {
  return rawText && isIncompleteChapterEnvelope(rawText)
    ? 'AI 返回的章节正文 JSON 外层结构不完整或格式错误，不能将内部片段作为完整草稿。'
    : null
}
