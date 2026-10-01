import type { ChapterTask, QualityGateIssue } from '../shared/types'
import { chapterTaskLengthRule, type ChapterTaskLengthRule } from './chapterTaskContractLength'
import { evaluateTaskPhraseRules, taskContractWarning } from './chapterTaskContractPhrases'
import { countOccurrences, maskTaskQuotes, visibleCharacterCount } from './chapterTaskContractText'

export interface ChapterTaskContractMeasurements {
  visibleCharacterCount: number
  expectedCharacterRange: [number, number | null] | null
  expectedCharacterRangeSource?: ChapterTaskLengthRule['source']
  firstPersonNarrationCount: number
}

export interface ChapterTaskContractEvaluation {
  /** No detected deterministic violations; this is not a semantic review of every task requirement. */
  pass: boolean
  issues: QualityGateIssue[]
  warnings: QualityGateIssue[]
  retryReason: string | null
  measurements: ChapterTaskContractMeasurements
}

function retryInstructionForIssue(issue: QualityGateIssue, measurements: ChapterTaskContractMeasurements): string {
  if (issue.type === 'chapter_task_length') {
    const [minimum, maximum] = measurements.expectedCharacterRange ?? [0, null]
    const source = measurements.expectedCharacterRangeSource === 'product_length_policy' ? '产品长度策略' : '作者明确篇幅'
    if (measurements.visibleCharacterCount < minimum) return `正文仅 ${measurements.visibleCharacterCount} 个可见字符，低于${source}下限 ${minimum}`
    if (maximum !== null && measurements.visibleCharacterCount > maximum) return `正文有 ${measurements.visibleCharacterCount} 个可见字符，超过${source}上限 ${maximum}`
  }
  return `${issue.description} ${issue.suggestedFix}`.trim()
}

export class ChapterTaskContractService {
  static isOnlyLengthUnderflow(evaluation: ChapterTaskContractEvaluation): boolean {
    const [minimum, maximum] = evaluation.measurements.expectedCharacterRange ?? [0, null]
    const visibleCount = evaluation.measurements.visibleCharacterCount
    return minimum > 0 && visibleCount < minimum && (maximum === null || visibleCount <= maximum) &&
      evaluation.issues.length > 0 && evaluation.issues.every((issue) => issue.type === 'chapter_task_length')
  }

  static isReviewableLengthUnderflow(evaluation: ChapterTaskContractEvaluation): boolean {
    const [minimum, maximum] = evaluation.measurements.expectedCharacterRange ?? [0, null]
    const visibleCount = evaluation.measurements.visibleCharacterCount
    return this.isOnlyLengthUnderflow(evaluation) && visibleCount >= Math.ceil(minimum * 0.9) &&
      (maximum === null || visibleCount <= maximum)
  }

  static isLocallyRepairable(evaluation: ChapterTaskContractEvaluation): boolean {
    const locallyRepairableIssueTypes = new Set([
      'chapter_task_length', 'chapter_task_phrase_count', 'chapter_task_phrase_position',
      'chapter_task_post_phrase_tail', 'chapter_task_style_forbidden_term'
    ])
    return !evaluation.pass && evaluation.issues.length > 0 &&
      evaluation.issues.every((issue) => locallyRepairableIssueTypes.has(issue.type))
  }

  static shouldPreferEarlierLengthUnderflow(input: {
    earlier: { body: string; title?: string }; later: { body: string; title?: string }; chapterTask: ChapterTask
  }): boolean {
    const earlier = this.evaluate({ ...input.earlier, chapterTask: input.chapterTask })
    const later = this.evaluate({ ...input.later, chapterTask: input.chapterTask })
    return this.isOnlyLengthUnderflow(earlier) && this.isOnlyLengthUnderflow(later) &&
      earlier.measurements.visibleCharacterCount > later.measurements.visibleCharacterCount
  }

  static shouldPreferEarlierAfterRetry(input: {
    earlier: { body: string; title?: string }; later: { body: string; title?: string }; chapterTask: ChapterTask
  }): boolean {
    const earlier = this.evaluate({ ...input.earlier, chapterTask: input.chapterTask })
    const later = this.evaluate({ ...input.later, chapterTask: input.chapterTask })
    if (earlier.pass) return true
    if (later.pass) return false
    if (this.isReviewableLengthUnderflow(later) && !this.isOnlyLengthUnderflow(earlier)) return false
    const earlierTypes = new Set(earlier.issues.map((issue) => issue.type))
    const laterTypes = new Set(later.issues.map((issue) => issue.type))
    if ([...laterTypes].some((type) => !earlierTypes.has(type))) return true
    if (laterTypes.size < earlierTypes.size || later.issues.length < earlier.issues.length) return false
    if (this.isOnlyLengthUnderflow(earlier) && this.isOnlyLengthUnderflow(later)) {
      const [minimum, maximum] = earlier.measurements.expectedCharacterRange ?? [0, null]
      const distance = (count: number): number => count < minimum ? minimum - count : maximum !== null && count > maximum ? count - maximum : 0
      return distance(earlier.measurements.visibleCharacterCount) <= distance(later.measurements.visibleCharacterCount)
    }
    return true
  }

  static evaluate(input: { body: string; title?: string; chapterTask?: ChapterTask | null }): ChapterTaskContractEvaluation {
    const body = String(input.body ?? '')
    const title = String(input.title ?? '')
    const task = input.chapterTask ?? null
    const visibleCount = visibleCharacterCount(body)
    const lengthRule = chapterTaskLengthRule(task?.targetWordCount ?? '')
    const range = lengthRule.range
    const { issues, warnings } = task ? evaluateTaskPhraseRules(task, body, title) : { issues: [], warnings: [] }
    if (lengthRule.warning) warnings.push(taskContractWarning(task?.targetWordCount ?? '', lengthRule.warning))
    if (range && (visibleCount < range[0] || range[1] !== null && visibleCount > range[1])) {
      const expected = range[1] === null ? `至少 ${range[0]}` : range[0] === 0 ? `最多 ${range[1]}` : `${range[0]}-${range[1]}`
      const source = lengthRule.source === 'product_length_policy' ? '单一目标的产品长度策略' : '作者明确字数要求'
      issues.unshift({ severity: 'high', type: 'chapter_task_length', description: `正文可见字符数不符合${source}。`,
        evidence: `当前 ${visibleCount}；${source}：${expected}。`,
        suggestedFix: `将完整正文调整到${expected}个可见字符，保留完整收束。` })
    }
    const measurements: ChapterTaskContractMeasurements = {
      visibleCharacterCount: visibleCount, expectedCharacterRange: range, expectedCharacterRangeSource: lengthRule.source,
      firstPersonNarrationCount: countOccurrences(maskTaskQuotes(body), '我')
    }
    return { pass: issues.length === 0, issues, warnings, measurements,
      retryReason: issues.length ? issues.slice(0, 3).map((issue) => retryInstructionForIssue(issue, measurements)).join('；').slice(0, 420) : null }
  }
}
