import type {
  PromptBlockOrderItem,
  PromptCompositionAlert,
  PromptCompositionBlockMetric,
  PromptCompositionCategory,
  PromptCompositionMetrics
} from '../shared/types'
import { TokenEstimator } from './TokenEstimator'

export type {
  PromptCompositionAlert,
  PromptCompositionBlockMetric,
  PromptCompositionCategory,
  PromptCompositionMetrics
} from '../shared/types'

interface PromptSectionRange {
  id: string
  start: number
  end: number
}

interface LocatedText {
  normalized: string
  blockId: string
  constraint: boolean
  reviewTone: boolean
}

interface ComparableConstraint extends LocatedText {
  grams: Set<string>
}

const CATEGORY_KEYS: PromptCompositionCategory[] = [
  'positive_task',
  'factual_context',
  'constraints',
  'review_tone',
  'other'
]

const REVIEW_TONE_PATTERN = /审稿|审计|质量门禁|质量评价|一致性检查|诊断|风险报告|review|audit|quality gate|diagnos/i
const CONSTRAINT_PATTERN = /^(?:[-*•]\s*)?(?:不得|不要|禁止|不能|不可|不应|避免|必须|仅可|只能|请勿|严禁|must not|do not|never|should not|avoid)/i
const CONSTRAINT_WORD_PATTERN = /不得|不要|禁止|不能|不可|不应|避免|必须|仅可|只能|请勿|严禁|must not|do not|never|should not|avoid/i
const MAX_ALERTS_PER_KIND = 16
const MAX_CONSTRAINTS_TO_COMPARE = 160

function emptyCategoryRecord(): Record<PromptCompositionCategory, number> {
  return {
    positive_task: 0,
    factual_context: 0,
    constraints: 0,
    review_tone: 0,
    other: 0
  }
}

function normalizeForComparison(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s`~!！?？。；;，,:：、"“”‘’'「」『』（）()【】\[\]<>《》…—–\-_/\\|]+/g, '')
    .trim()
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function classifyBlock(block: PromptBlockOrderItem): PromptCompositionCategory {
  const haystack = `${block.kind} ${block.title} ${block.source}`.toLocaleLowerCase()
  if (REVIEW_TONE_PATTERN.test(haystack)) return 'review_tone'
  if (/writing_task|chapter_task|story_direction|任务|导向|goal|conflict|hook/.test(haystack)) return 'positive_task'
  if (/priority|forbidden|novelty|output|style|constraint|禁止|限制|格式|风格|约束/.test(haystack)) return 'constraints'
  if (/bridge|continuity|character|state|foreshadow|progress|recent|summary|timeline|canon|chapter|context|角色|状态|伏笔|回顾|时间|设定/.test(haystack)) {
    return 'factual_context'
  }
  return 'other'
}

function sectionRanges(finalPrompt: string, blocks: PromptBlockOrderItem[]): PromptSectionRange[] {
  const matches = [...finalPrompt.matchAll(/^##\s+(.+?)\s*$/gm)]
  const includedBlocks = blocks.filter((block) => block.included)
  if (!matches.length) {
    return includedBlocks.length === 1 ? [{ id: includedBlocks[0].id, start: 0, end: finalPrompt.length }] : []
  }

  const blocksByTitle = new Map<string, PromptBlockOrderItem[]>()
  for (const block of includedBlocks) {
    const title = block.title.trim()
    blocksByTitle.set(title, [...(blocksByTitle.get(title) ?? []), block])
  }

  return matches.flatMap((match, index) => {
    const title = match[1]?.trim() ?? ''
    const candidates = blocksByTitle.get(title) ?? []
    const block = candidates.shift()
    if (candidates.length) blocksByTitle.set(title, candidates)
    else blocksByTitle.delete(title)
    if (!block || match.index === undefined) return []
    return [{ id: block.id, start: match.index, end: matches[index + 1]?.index ?? finalPrompt.length }]
  })
}

function sectionTokenEstimate(finalPrompt: string, block: PromptBlockOrderItem, ranges: PromptSectionRange[]): number {
  const range = ranges.find((item) => item.id === block.id)
  if (range) return TokenEstimator.estimate(finalPrompt.slice(range.start, range.end))
  return 0
}

function blockIdAt(index: number, ranges: PromptSectionRange[]): string {
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const range = ranges[middle]
    if (index < range.start) high = middle - 1
    else if (index >= range.end) low = middle + 1
    else return range.id
  }
  return ''
}

function collectTextUnits(finalPrompt: string, ranges: PromptSectionRange[]): LocatedText[] {
  const units: LocatedText[] = []
  const linePattern = /[^\n]+/g
  for (const lineMatch of finalPrompt.matchAll(linePattern)) {
    const rawLine = lineMatch[0]
    const lineStart = lineMatch.index ?? 0
    if (/^##\s+/.test(rawLine.trim())) continue
    const sentencePattern = /[^。！？!?；;\n]+[。！？!?；;]?/g
    for (const sentenceMatch of rawLine.matchAll(sentencePattern)) {
      const text = sentenceMatch[0].replace(/^\s*[-*•]\s*/, '').trim()
      const start = lineStart + (sentenceMatch.index ?? 0)
      const normalized = normalizeForComparison(text)
      if (normalized.length < 8) continue
      units.push({
        normalized,
        blockId: blockIdAt(start, ranges),
        constraint: isConstraint(text),
        reviewTone: REVIEW_TONE_PATTERN.test(text)
      })
    }
  }
  return units
}

function isConstraint(text: string): boolean {
  return CONSTRAINT_PATTERN.test(text.trim()) || CONSTRAINT_WORD_PATTERN.test(text)
}

function characterNgrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value])
  const grams = new Set<string>()
  for (let index = 0; index < value.length - 1; index += 1) grams.add(value.slice(index, index + 2))
  return grams
}

function similarity(left: ComparableConstraint, right: ComparableConstraint): number {
  const leftText = left.normalized
  const rightText = right.normalized
  if (!leftText || !rightText) return 0
  if (leftText.includes(rightText) || rightText.includes(leftText)) {
    return Math.min(leftText.length, rightText.length) / Math.max(leftText.length, rightText.length)
  }
  const smaller = left.grams.size <= right.grams.size ? left.grams : right.grams
  const larger = smaller === left.grams ? right.grams : left.grams
  let intersection = 0
  for (const gram of smaller) if (larger.has(gram)) intersection += 1
  const unionSize = left.grams.size + right.grams.size - intersection
  return unionSize ? intersection / unionSize : 0
}

function reconcileBlockTokens(blocks: PromptCompositionBlockMetric[], total: number): PromptCompositionBlockMetric[] {
  const attributed = blocks.reduce((sum, block) => sum + block.tokenEstimate, 0)
  if (attributed <= total || attributed === 0) return blocks
  let overflow = attributed - total
  const next = blocks.map((block) => ({ ...block }))
  for (const block of [...next].sort((left, right) => right.tokenEstimate - left.tokenEstimate)) {
    if (overflow <= 0) break
    const reduction = Math.min(block.tokenEstimate, overflow)
    block.tokenEstimate -= reduction
    overflow -= reduction
  }
  return next
}

function alertDescriptor(kind: PromptCompositionAlert['kind'], normalizedValues: string[]): Pick<PromptCompositionAlert, 'sample' | 'fingerprints'> {
  const fingerprints = normalizedValues.map(fingerprint)
  const label = kind === 'repeated_sentence' ? '重复句' : '相似禁令'
  return {
    sample: `${label}指纹 ${fingerprints.join(' / ')}`,
    fingerprints
  }
}

function buildRepeatedSentenceAlerts(units: LocatedText[]): PromptCompositionAlert[] {
  const groups = new Map<string, LocatedText[]>()
  for (const unit of units) {
    const normalized = unit.normalized
    if (normalized.length < 8) continue
    const group = groups.get(normalized) ?? []
    group.push(unit)
    groups.set(normalized, group)
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .slice(0, MAX_ALERTS_PER_KIND)
    .map((group) => ({
      kind: 'repeated_sentence',
      severity: 'warning',
      ...alertDescriptor('repeated_sentence', [group[0].normalized]),
      relatedBlockIds: [...new Set(group.map((item) => item.blockId).filter(Boolean))],
      occurrences: group.length,
      reason: '规范化后相同的句子在最终 Prompt 中重复出现，可能增加输入成本并削弱指令层次。'
    }))
}

function buildSimilarConstraintAlerts(units: LocatedText[]): PromptCompositionAlert[] {
  const constraints: ComparableConstraint[] = units
    .filter((unit) => unit.constraint)
    .slice(0, MAX_CONSTRAINTS_TO_COMPARE)
    .map((unit) => ({ ...unit, grams: characterNgrams(unit.normalized) }))
  const alerts: PromptCompositionAlert[] = []
  for (let leftIndex = 0; leftIndex < constraints.length; leftIndex += 1) {
    const left = constraints[leftIndex]
    if (left.normalized.length < 10) continue
    for (let rightIndex = leftIndex + 1; rightIndex < constraints.length; rightIndex += 1) {
      const right = constraints[rightIndex]
      if (right.normalized.length < 10 || left.normalized === right.normalized) continue
      const score = similarity(left, right)
      // Chinese near-duplicate constraints often insert function words such as "没有" or "的".
      // A moderate threshold catches those rewrites without treating short generic lines as duplicates.
      if (score < 0.45) continue
      alerts.push({
        kind: 'similar_constraint',
        severity: 'warning',
        ...alertDescriptor('similar_constraint', [left.normalized, right.normalized]),
        relatedBlockIds: [...new Set([left.blockId, right.blockId].filter(Boolean))],
        similarity: Math.round(score * 1000) / 1000,
        reason: '两条禁令语义表面高度相似，建议合并为一条更明确的写作约束。'
      })
      if (alerts.length >= MAX_ALERTS_PER_KIND) return alerts
    }
  }
  return alerts
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0
}

export function calculatePromptCompositionMetrics(
  finalPrompt: string,
  promptBlockOrder: PromptBlockOrderItem[],
  knownTotalTokenEstimate?: number
): PromptCompositionMetrics {
  const prompt = finalPrompt ?? ''
  const blocks = Array.isArray(promptBlockOrder) ? promptBlockOrder : []
  const totalTokenEstimate =
    typeof knownTotalTokenEstimate === 'number' && Number.isFinite(knownTotalTokenEstimate)
      ? Math.max(0, knownTotalTokenEstimate)
      : TokenEstimator.estimate(prompt)
  const ranges = sectionRanges(prompt, blocks)
  const rawBlockMetrics: PromptCompositionBlockMetric[] = blocks.map((block) => {
    const tokenEstimate = block.included ? sectionTokenEstimate(prompt, block, ranges) : 0
    const category = classifyBlock(block)
    return {
      id: block.id,
      tokenEstimate,
      tokenSharePercent: 0,
      category
    }
  })
  const blockMetrics = reconcileBlockTokens(rawBlockMetrics, totalTokenEstimate).map((block) => ({
    ...block,
    tokenSharePercent: percent(block.tokenEstimate, totalTokenEstimate)
  }))
  const categoryTokenEstimates = emptyCategoryRecord()
  for (const block of blockMetrics) categoryTokenEstimates[block.category] += block.tokenEstimate
  const attributedTokenEstimate = blockMetrics.reduce((sum, block) => sum + block.tokenEstimate, 0)
  const units = collectTextUnits(prompt, ranges)
  const repeatedSentences = buildRepeatedSentenceAlerts(units)
  const similarConstraints = buildSimilarConstraintAlerts(units)
  const reviewToneLineCount = units.filter((unit) => unit.reviewTone).length
  const constraintLineCount = units.filter((unit) => unit.constraint).length
  const categoryShares = Object.fromEntries(
    CATEGORY_KEYS.map((key) => [key, percent(categoryTokenEstimates[key], totalTokenEstimate)])
  ) as Record<PromptCompositionCategory, number>

  return {
    totalTokenEstimate,
    attributedTokenEstimate,
    unattributedTokenEstimate: Math.max(0, totalTokenEstimate - attributedTokenEstimate),
    categoryTokenEstimates,
    categoryShares,
    blockMetrics,
    repeatedSentences,
    similarConstraints,
    alerts: [...repeatedSentences, ...similarConstraints],
    constraintLineCount,
    reviewToneLineCount,
    summary: `总计约 ${totalTokenEstimate} token；已归因 ${attributedTokenEstimate} token；发现重复句 ${repeatedSentences.length} 组、相似禁令 ${similarConstraints.length} 组。`
  }
}

export const PromptCompositionMetricsService = {
  calculate: calculatePromptCompositionMetrics
}
