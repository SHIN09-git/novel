import { amountRange, maskTaskQuotes, nonBindingTaskContext, TASK_CHARACTER_UNIT, TASK_NUMBER, taskNumber } from './chapterTaskContractText'

export interface ChapterTaskLengthRule {
  range: [number, number | null] | null
  source: 'author' | 'product_length_policy' | 'none'
  warning?: string
}

// Compatibility policy for a single target, not an inferred author-provided minimum.
const SINGLE_TARGET_MINIMUM_RATIO = 0.8

export function chapterTaskLengthRule(input: string): ChapterTaskLengthRule {
  const value = maskTaskQuotes(input).replace(/(?<=\d),(?=\d{3}(?:\D|$))/gu, '').trim()
  const ranges: Array<[number, number | null]> = []
  const consumed: Array<[number, number]> = []
  const rangePattern = new RegExp(`(${TASK_NUMBER})\\s*(?:${TASK_CHARACTER_UNIT})?\\s*[-~～—–至到]\\s*(${TASK_NUMBER})\\s*(?:${TASK_CHARACTER_UNIT})?`, 'gu')
  for (const match of value.matchAll(rangePattern)) {
    if (nonBindingTaskContext(value.slice(0, match.index))) continue
    const suffix = value.slice(match.index + match[0].length).trim()
    if (suffix && !/^[，,。；;]|^(?:之间|范围)/u.test(suffix)) continue
    let minimum = taskNumber(match[1])
    const maximum = taskNumber(match[2])
    if (/^\d+(?:\.\d+)?$/u.test(match[1]) && /[千万]$/u.test(match[2])) minimum *= match[2].endsWith('万') ? 10000 : 1000
    if (Number.isInteger(minimum) && Number.isInteger(maximum) && minimum >= 0 && maximum >= minimum) {
      ranges.push([minimum, maximum])
      consumed.push([match.index, match.index + match[0].length])
    }
  }
  const scalarPattern = new RegExp(`(至少|最少|不少于|不得少于|不低于|最多|至多|不超过|不得超过|不能超过|恰好|正好|严格|必须为)?\\s*(${TASK_NUMBER})\\s*(${TASK_CHARACTER_UNIT})?\\s*(以内|以下|以上|左右|上下)?`, 'gu')
  let target: number | undefined
  for (const match of value.matchAll(scalarPattern)) {
    const index = match.index
    const prefix = value.slice(0, index).replace(/\s/gu, '')
    const explicitTargetFrame = /^(?:(?:正文)?(?:目标(?:字数|篇幅)?|字数目标|篇幅目标)(?:为|是|[:：])?|(?:正文)?(?:字数|篇幅)(?:为|是|[:：])?|(?:正文)?(?:约|大约)|(?:正文)?控制在)$/u.test(prefix)
    if (consumed.some(([start, end]) => index >= start && index < end) ||
      nonBindingTaskContext(value.slice(0, index)) && !explicitTargetFrame) continue
    const bare = match[0].trim() === value
    if (!match[3] && !bare) continue
    const amount = taskNumber(match[2])
    if (!Number.isInteger(amount) || amount < 0) continue
    if (match[1] || /以内|以下|以上/u.test(match[4] ?? '')) ranges.push(amountRange(`${match[1] ?? ''}${match[4] ?? ''}`, amount))
    else if ((bare || explicitTargetFrame || /左右|上下/u.test(match[4] ?? '')) && amount > 0) target = amount
  }
  if (ranges.length) {
    const minimum = Math.max(...ranges.map(([min]) => min))
    const maxima = ranges.flatMap(([, max]) => max === null ? [] : [max])
    const maximum = maxima.length ? Math.min(...maxima) : null
    return { range: [minimum, maximum], source: 'author',
      ...(maximum !== null && minimum > maximum ? { warning: '作者给出的篇幅上下限互相冲突，请核对任务；本地检查不会放宽任一边界。' } : {}) }
  }
  const approximate = new RegExp(`^(?:约|大约)\\s*(${TASK_NUMBER})\\s*(?:${TASK_CHARACTER_UNIT})?(?:左右|上下)?$`, 'u').exec(value)
  if (approximate) target = taskNumber(approximate[1])
  if (target && Number.isInteger(target)) {
    const minimum = Math.max(1, Math.round(target * SINGLE_TARGET_MINIMUM_RATIO))
    return { range: [minimum, null], source: 'product_length_policy',
      warning: `单一目标为 ${target} 字；沿用产品长度策略，以目标的 80%（${minimum} 个可见字符）检测明显不足，不代表作者给定了这个下限。` }
  }
  return { range: null, source: 'none', ...(input.trim() ? { warning: '该篇幅说明未识别为确定的字数条件，请核对原要求；没有据此设置自动重试门槛。' } : {}) }
}
