import { looksLikeFullChapterRevision } from '../utils/revisionMerge'

export interface RewriteRange { start: number; end: number; text: string }
export type RewriteTargetKey = string | number | null | undefined
export type RewriteResultScope = 'selection' | 'chapter'
export interface AiRewriteCandidate {
  targetKey: RewriteTargetKey
  sourceBody: string
  selection: RewriteRange
  text: string
  label: string
  usedAI: boolean
  scope: RewriteResultScope
  context: string
}

export function validRewriteRange(body: string, range: RewriteRange): boolean {
  return Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 &&
    range.end > range.start && range.end <= body.length && Boolean(range.text.trim()) &&
    body.slice(range.start, range.end) === range.text
}

export function classifyRewriteResult(body: string, range: RewriteRange, text: string): RewriteResultScope {
  if (!validRewriteRange(body, range)) throw new Error('选区已变化，请重新选择。')
  const wholeSelection = !body.slice(0, range.start).trim() && !body.slice(range.end).trim()
  return !wholeSelection && looksLikeFullChapterRevision(body, range.text, text) ? 'chapter' : 'selection'
}

export function findRewriteRange(body: string, selectedText: string): RewriteRange | null {
  if (!selectedText.trim()) return null
  const start = body.indexOf(selectedText)
  if (start < 0 || body.indexOf(selectedText, start + 1) >= 0) return null
  return { start, end: start + selectedText.length, text: selectedText }
}

export function retargetRewriteCandidate(candidate: AiRewriteCandidate, body: string, range: RewriteRange): AiRewriteCandidate {
  if (!validRewriteRange(body, range)) throw new Error('当前选区已变化，候选仍然保留，请重新选择。')
  return { ...candidate, sourceBody: body, selection: { ...range },
    scope: candidate.scope === 'chapter' ? 'chapter' : classifyRewriteResult(body, range, candidate.text) }
}

export function composeRewriteResult(candidate: AiRewriteCandidate, currentBody: string): string {
  if (candidate.sourceBody !== currentBody) throw new Error('原文已变化，候选已保留；请重新定位后再应用。')
  if (!candidate.text.trim()) throw new Error('候选正文为空，请填写后再应用。')
  if (candidate.scope === 'chapter') return candidate.text
  if (!validRewriteRange(currentBody, candidate.selection)) throw new Error('选区已变化，未替换正文。')
  return currentBody.slice(0, candidate.selection.start) + candidate.text + currentBody.slice(candidate.selection.end)
}
