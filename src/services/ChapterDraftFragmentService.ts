import type { AIResult, ChapterDraftResult } from '../shared/types'
import { parseWithFallback } from './AIJsonParser'
import { startsWithChapterJsonArray } from './ChapterDraftEnvelopeService'
import { isTruncatedFinishReason } from './ai/responseNormalizers/chapter'

interface IncompleteChapterFragment extends ChapterDraftResult {
  kind: 'incomplete_chapter_fragment'
  finishReason: string
}

const bodyFields = new Set(['body', 'chapterBody', 'chapterText', 'content', 'text', 'draft', 'markdown'])
const draftLabel = /^(?:title|chapterTitle|body|chapterBody|chapterText|content|text|draft|markdown|标题|章节标题|正文|章节正文)$/i
const planLabel = /^(?:(?:本章|章节|写作|剧情|故事)?(?:任务书|大纲|提纲)|本章目标|(?:本章)?必须推进的冲突|世界规则|人物心理|主线推进|角色节拍|结尾钩子|读者情绪|预计字数|chapter\s*(?:plan|task|outline|goal)|outline|beat sheet)$/i
const reasoningLabel = /^(?:分析|思路|(?:思考|推理)(?:过程|内容|步骤)?|reasoning(?:[_ ]?content)?|analysis|thinking(?: process)?|chain of thought|refusal|content[_ -]?filter)$/i

function hasWireMarkup(text: string): boolean {
  return /(?:^|\n)[ \t]*[{}]|\{\s*"|["'][\w-]+["']\s*[:：]|`{3}|~{3}/u.test(text)
    || /<\/?(?:think(?:ing)?|reasoning|analysis|refusal)\b|<\|(?:channel|message|im_start|im_end)\|>/i.test(text)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\p{Cs}]/u.test(text)
}

function isReadableProse(text: string): boolean {
  if (!/\p{L}/u.test(text) || hasWireMarkup(text)) return false
  if (/^(?:true|false|null|undefined|string|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/iu.test(text.trim())) return false
  // Check field and section labels, not vocabulary in sentences or list formatting itself.
  return !text.split(/\r\n?|\n/u).some((line) => {
    const start = line.trim().replace(/^(?:#{1,6}|[-*+]|\d+[.)、])\s+/u, '')
    if (startsWithChapterJsonArray(start) || /^[\]},]/u.test(start)) return true
    const label = start.split(/[:：=】\]]/u, 1)[0].replace(/^[*`"'【[]+|[*`"'\s]+$/gu, '')
    return label.split(/\s*[,，、]\s*/u).every((field) => draftLabel.test(field))
      || planLabel.test(label) || reasoningLabel.test(label)
      || (/^[a-z]+(?:[A-Z]\w*|(?:_[a-z]+)+)$/u.test(label) && /^\S+\s*[:=]/u.test(start))
  })
}

function readJsonDraft(text: string, fallbackTitle: string): ChapterDraftResult | null {
  // Only the enclosing object may be unfinished. Never invent a closing quote or decode a partial escape.
  const source = text.startsWith('{') && /"\s*,?$/u.test(text) ? text.replace(/,$/u, '') + '}' : text
  const parsed = parseWithFallback(source)
  // The general AI parser also accepts slices embedded in other output; those have no trustworthy role here.
  if (!parsed.ok || parsed.source !== 'direct') return null
  const value = parsed.data
  if (typeof value === 'string') return { title: fallbackTitle, body: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  let title: string | undefined
  let body: string | undefined
  for (const [key, field] of Object.entries(value)) {
    if (typeof field !== 'string') return null
    if ((key === 'title' || key === 'chapterTitle') && title === undefined) title = field
    else if (bodyFields.has(key) && body === undefined) body = field
    else return null
  }
  if (body === undefined || (title && (hasWireMarkup(title) || /[\r\n]/u.test(title.trim())))) return null
  return { title: title?.trim() || fallbackTitle, body }
}

export function getTruncatedDraftFragment(
  result: AIResult<ChapterDraftResult>,
  fallbackTitle: string
): IncompleteChapterFragment | null {
  if (!result.usedAI || typeof result.rawText !== 'string') return null
  const { terminationCategory, finishReason: telemetryReason } = result.telemetry ?? {}
  if (terminationCategory && terminationCategory !== 'none') return null
  const reasons = [result.finishReason?.trim(), telemetryReason?.trim()].filter((r): r is string => Boolean(r))
  if (!reasons.length || !reasons.every(isTruncatedFinishReason)) return null

  const raw = result.rawText
  const fence = /^`{3}(json|text|md|markdown)?[ \t]*\r?\n([\s\S]*?)\r?\n`{3}$/iu.exec(raw.trim())
  const body = fence?.[2] ?? raw
  const text = body.trim()
  const title = fallbackTitle.trim() || '未命名章节'
  // A quoted line followed by narration is plaintext, not a broken JSON string.
  const quotedNarration = /^"[^"\\\r\n]*"[\s,，]*\p{L}/u.test(text)
  const draft = fence?.[1]?.toLowerCase() === 'json' || text.startsWith('{') || startsWithChapterJsonArray(text)
    || (text.startsWith('"') && !quotedNarration)
    ? readJsonDraft(text, title)
    : { title, body }
  if (!draft || !isReadableProse(draft.body)) return null
  return { kind: 'incomplete_chapter_fragment', title: draft.title, body: draft.body, finishReason: reasons[0] }
}
