import type { ChapterTask, QualityGateIssue } from '../shared/types'
import { amountRange, countOccurrences, maskTaskQuotes, nonBindingTaskContext, TASK_CHARACTER_UNIT, TASK_NUMBER,
  taskClauses, taskNumber, taskQuotes, visibleCharacterCount } from './chapterTaskContractText'

type PhraseScope = 'body' | 'full' | 'title'
type PhraseRule = { phrase: string; scope: PhraseScope } & (
  { kind: 'count' | 'tail'; range: [number, number | null] } |
  { kind: 'position'; minimum: boolean; ratio: number } |
  { kind: 'forbidden' }
)

export function taskContractWarning(source: string, explanation = '该要求涉及语义或未识别的约束形式，本地检查不能确认是否满足。'): QualityGateIssue {
  return { severity: 'low', type: 'chapter_task_manual_check', description: explanation,
    evidence: source.replace(/\s+/gu, ' ').trim().slice(0, 240),
    suggestedFix: '保留原任务要求，由作者或语义审稿核对；不因这条建议自动重写正文。' }
}

function phraseScope(context: string): PhraseScope {
  if (/标题(?:中|内)/u.test(context)) return 'title'
  return /全文/u.test(context) ? 'full' : 'body'
}

function compilePhraseRules(task: ChapterTask): { rules: PhraseRule[]; warnings: QualityGateIssue[] } {
  const rules: PhraseRule[] = []
  const warnings: QualityGateIssue[] = []
  for (const [field, value] of Object.entries(task)) {
    if (field === 'targetWordCount' || typeof value !== 'string') continue
    let priorPhrases: string[] = []
    for (const clause of taskClauses(value)) {
      const quotes = taskQuotes(clause).filter((item) => item.phrase.trim())
      const masked = maskTaskQuotes(clause)
      let remaining = masked
      const noteHandled = (text: string) => { remaining = remaining.replace(text, ' ') }
      const parseSuffix = (phrase: string, suffix: string, prefix: string, scope: PhraseScope) => {
        const count = new RegExp(`(只|仅|恰好|正好|至少|最少|最多|至多)?\\s*(?:出现|使用)(?:次数)?\\s*(不得超过|不能超过|不超过|不得少于|不少于|至少|最多|至多|恰好|正好|为)?\\s*(${TASK_NUMBER})\\s*次`, 'gu')
        for (const match of suffix.matchAll(count)) {
          if (nonBindingTaskContext(`${prefix}${suffix.slice(0, match.index)}`)) continue
          const amount = taskNumber(match[3])
          if (!Number.isInteger(amount) || amount < 0) continue
          rules.push({ kind: 'count', phrase, scope, range: amountRange(`${match[1] ?? ''}${match[2] ?? ''}`, amount) })
          noteHandled(match[0])
        }
        const position = /(不得早于|不能早于|不早于|不得晚于|不能晚于|不晚于)\s*(?:正文)?\s*(\d+(?:\.\d+)?)\s*[%％]/gu
        for (const match of suffix.matchAll(position)) {
          if (nonBindingTaskContext(`${prefix}${suffix.slice(0, match.index)}`)) continue
          const ratio = Number(match[2]) / 100
          if (ratio < 0 || ratio > 1) continue
          rules.push({ kind: 'position', phrase, scope: 'body', minimum: match[1].includes('早'), ratio })
          noteHandled(match[0])
        }
        const tail = new RegExp(`(?:出现)?(?:之后|以后|后)\\s*[，,]?\\s*(?:(?:正文|尾部|收尾)(?:长度)?\\s*)?(最多(?:保留|留)?|至多(?:保留|留)?|不得超过|不超过|至少(?:保留|留)?|不少于|恰好(?:保留|留)?|只(?:能)?(?:保留|留)|仅(?:保留|留))\\s*(${TASK_NUMBER})\\s*${TASK_CHARACTER_UNIT}`, 'gu')
        for (const match of suffix.matchAll(tail)) {
          if (nonBindingTaskContext(`${prefix}${suffix.slice(0, match.index)}`)) continue
          const amount = taskNumber(match[2])
          if (!Number.isInteger(amount) || amount < 0) continue
          rules.push({ kind: 'tail', phrase, scope: 'body', range: amountRange(match[1], amount) })
          noteHandled(match[0])
        }
        const forbid = /^\s*(?:(?:在)?(?:正文|全文|标题)(?:中|内)?\s*)?(?:(?:不得|禁止|不许|不要)(?:出现|使用)|禁用)/gu
        for (const match of suffix.matchAll(forbid)) {
          if (nonBindingTaskContext(`${prefix}${suffix.slice(0, match.index)}`)) continue
          // A numerical upper/lower count is handled above, not mistaken for a total ban.
          if (/\s*(?:次数)?\s*(?:\d|[零一二两三四五六七八九十])/u.test(suffix.slice(match.index + match[0].length, match.index + match[0].length + 8))) continue
          rules.push({ kind: 'forbidden', phrase, scope })
          noteHandled(match[0])
        }
      }
      for (let index = 0; index < quotes.length; index += 1) {
        const quote = quotes[index]
        const prefix = masked.slice(0, quote.start)
        const suffix = masked.slice(quote.end, quotes[index + 1]?.start ?? masked.length)
        const scope = phraseScope(`${prefix.slice(quotes[index - 1]?.end ?? 0)}${suffix}`)
        parseSuffix(quote.phrase, suffix, prefix, scope)
        const ban = /(?:禁止使用|不得使用|不许使用|不要使用|禁止出现|不得出现|不写|不用|禁用)(?:词语|短语|字样|词)?\s*[：:、，,\s]*$/u.exec(prefix)
        if (ban && !nonBindingTaskContext(prefix.slice(0, ban.index))) {
          rules.push({ kind: 'forbidden', phrase: quote.phrase, scope })
          noteHandled(ban[0])
        }
      }
      // A referential numeric tail can bind only to one unambiguous earlier quoted phrase in this field.
      if (!quotes.length && priorPhrases.length === 1 && /^\s*(?:该|此|上述)?(?:标题|短语)/u.test(masked)) {
        parseSuffix(priorPhrases[0], masked, '', 'body')
      }
      const list = /(?:(?:禁用|禁止|不得使用)(?:词语|短语|词)|禁止使用(?:词语|短语|词))\s*[：:]?\s*([^。；;\r\n]+)/gu
      for (const match of masked.matchAll(list)) {
        if (nonBindingTaskContext(masked.slice(0, match.index))) continue
        const terms = match[1].split(/[、，,|/]/u).map((term) => term.trim()).filter(Boolean)
        if (!terms.length || terms.some((term) => /\s/u.test(term))) continue
        for (const phrase of terms) rules.push({ kind: 'forbidden', phrase, scope: phraseScope(masked) })
        noteHandled(match[0])
      }
      if (/(?:不|禁|只|仅|始终|一直|视角|人称|必须|保持|至少|最多|次数|字数|[%％])/u.test(remaining) && !nonBindingTaskContext(remaining)) {
        warnings.push(taskContractWarning(clause))
      }
      if (quotes.length) priorPhrases = [...new Set([...priorPhrases, ...quotes.map((quote) => quote.phrase)])]
    }
  }
  return { rules, warnings }
}

const rangeDescription = ([minimum, maximum]: [number, number | null]) => maximum === null
  ? `至少 ${minimum}` : minimum === maximum ? `恰好 ${minimum}` : minimum === 0 ? `最多 ${maximum}` : `${minimum}-${maximum}`
const outsideRange = (value: number, [minimum, maximum]: [number, number | null]) => value < minimum || maximum !== null && value > maximum

export function evaluateTaskPhraseRules(task: ChapterTask, body: string, title: string) {
  const { rules, warnings } = compilePhraseRules(task)
  const issues: QualityGateIssue[] = []
  const visibleCount = visibleCharacterCount(body)
  const addIssue = (type: string, description: string, evidence: string, suggestedFix: string) => {
    if (!issues.some((issue) => issue.type === type && issue.evidence === evidence)) issues.push({ severity: 'high', type, description, evidence, suggestedFix })
  }
  for (const rule of rules) {
    const text = rule.scope === 'full' ? `${title}\n${body}` : rule.scope === 'title' ? title : body
    const count = countOccurrences(text, rule.phrase)
    const label = rule.scope === 'full' ? '全文（含标题）' : rule.scope === 'title' ? '标题' : '正文'
    if (rule.kind === 'count' && outsideRange(count, rule.range)) {
      addIssue('chapter_task_phrase_count', '字面短语出现次数不符合作者明确要求。',
        `“${rule.phrase}”在${label}出现 ${count} 次；要求${rangeDescription(rule.range)}次。`,
        `将“${rule.phrase}”在${label}的出现次数调整为${rangeDescription(rule.range)}次。`)
    }
    if (rule.kind === 'forbidden' && count) {
      addIssue('chapter_task_style_forbidden_term', '作者明确禁用的字面词语或短语出现在文本中。',
        `“${rule.phrase}”在${label}出现 ${count} 次。`, `删除或改写${label}中的禁用短语“${rule.phrase}”；字面禁令同样适用于否定句与对白。`)
    }
    const index = body.indexOf(rule.phrase)
    if (rule.kind === 'position') {
      const ratio = index < 0 || !visibleCount ? null : visibleCharacterCount(body.slice(0, index)) / visibleCount
      if (ratio === null || (rule.minimum ? ratio + 1e-9 < rule.ratio : ratio - 1e-9 > rule.ratio)) {
        const bound = `不得${rule.minimum ? '早' : '晚'}于正文 ${Math.round(rule.ratio * 10000) / 100}%`
        addIssue('chapter_task_phrase_position', '字面短语首次出现位置不符合作者明确要求。',
          ratio === null ? `正文未找到“${rule.phrase}”；${bound}。` : `“${rule.phrase}”位于 ${Math.round(ratio * 10000) / 100}%；${bound}。`,
          `调整“${rule.phrase}”在正文中的首次出现位置，${bound}。`)
      }
    }
    if (rule.kind === 'tail') {
      const trailing = index < 0 ? null : visibleCharacterCount(body.slice(index + rule.phrase.length))
      if (trailing === null || outsideRange(trailing, rule.range)) addIssue('chapter_task_post_phrase_tail', '短语后的正文长度不符合作者明确数值要求。',
        trailing === null ? `正文未找到“${rule.phrase}”。` : `“${rule.phrase}”之后有 ${trailing} 个可见字符；要求${rangeDescription(rule.range)}。`,
        `保留“${rule.phrase}”，将其后的正文调整为${rangeDescription(rule.range)}个可见字符。`)
    }
  }
  return { issues, warnings }
}
