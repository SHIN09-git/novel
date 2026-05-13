import type {
  Character,
  CharacterCardField,
  CharacterStateFact,
  CharacterStateLog,
  Chapter,
  ChapterContinuityBridge,
  Foreshadowing,
  ForeshadowingTreatmentMode,
  ID,
  ContextCompressionRecord,
  ContextNeedPlan,
  PromptBlockOrderItem,
  PromptBuildInput,
  PromptConfig,
  PromptMode,
  StageSummary,
  TimelineEvent
} from '../../shared/types'
import { TokenEstimator } from '../TokenEstimator'

const PLACEHOLDER_PATTERNS = [
  /待补充/i,
  /暂无/i,
  /未填写/i,
  /未设置/i,
  /暂无与本章需求匹配/i,
  /无匹配/i,
  /无内容/i,
  /无相关/i,
  /无记录/i
]

const AUDIT_LINE_PATTERNS = [
  /^风险[:：]/,
  /^审稿[:：]/,
  /^审计[:：]/,
  /^建议[:：]/,
  /^复盘建议[:：]/,
  /建议后续章节/,
  /正文可能提前/,
  /超出允许范围/,
  /可能提前泄露/,
  /生成质量评价/,
  /历史风险/
]

const MAX_PROMPT_FORESHADOWINGS = 10

const FORESHADOWING_WEIGHT_PRIORITY: Record<Foreshadowing['weight'], number> = {
  payoff: 4,
  high: 3,
  medium: 2,
  low: 1
}

const FORESHADOWING_STATUS_PRIORITY: Record<Foreshadowing['status'], number> = {
  partial: 4,
  unresolved: 3,
  resolved: 1,
  abandoned: 0
}

const FORESHADOWING_TREATMENT_PRIORITY: Record<ForeshadowingTreatmentMode, number> = {
  payoff: 5,
  advance: 4,
  mislead: 3,
  hint: 2,
  pause: 1,
  hidden: 0
}

export function isPlaceholderText(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const text = String(value).trim()
  if (!text) return true
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))
}

export function valueOrEmpty(value: string | number | null | undefined): string {
  if (isPlaceholderText(value)) return ''
  return String(value).trim()
}

export function fieldLine(label: string, value: unknown): string {
  const text = valueOrEmpty(value as string | number | null | undefined)
  return text ? `${label}${text}` : ''
}

export function cleanPromptBody(raw: string): string {
  const lines = raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (isPlaceholderText(trimmed)) return false
      if (
        /[:：]\s*$/.test(trimmed) &&
        !/(规则|约束|字段|类别|更新|处理|状态|以下优先级处理)[:：]\s*$/.test(trimmed)
      ) {
        return false
      }
      if (/^[-*]\s*[:：]?\s*$/.test(trimmed)) return false
      if (AUDIT_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) return false
      return true
    })

  const compacted: string[] = []
  for (const line of lines) {
    if (!line.trim() && !compacted[compacted.length - 1]?.trim()) continue
    compacted.push(line)
  }
  return compacted.join('\n').trim()
}

export function section(title: string, enabled: boolean, body: string): string {
  if (!enabled) return ''
  const cleaned = cleanPromptBody(body)
  if (!cleaned) return ''
  return `## ${title}\n${cleaned}\n`
}

export interface PromptBlockDraft {
  id: string
  title: string
  kind: string
  priority: number
  source: string
  sourceIds?: ID[]
  enabled: boolean
  body: string
  compressed?: boolean
  forced?: boolean
  omittedReason?: string | null
  reason: string
}

export function renderPromptBlock(block: PromptBlockDraft): string {
  return section(block.title, block.enabled, block.body)
}

export function blockToOrderItem(block: PromptBlockDraft): PromptBlockOrderItem {
  const rendered = renderPromptBlock(block)
  const included = Boolean(rendered)
  return {
    id: block.id,
    title: block.title,
    kind: block.kind,
    priority: block.priority,
    tokenEstimate: included ? TokenEstimator.estimate(rendered) : 0,
    source: block.source,
    sourceIds: block.sourceIds ?? [],
    included,
    compressed: block.compressed ?? false,
    forced: block.forced ?? false,
    omittedReason: included ? null : block.omittedReason ?? '模块关闭或无可用内容。',
    reason: block.reason
  }
}

function inferBlockKind(title: string): string {
  if (title.includes('上一章')) return 'continuity_bridge'
  if (title.includes('任务')) return 'chapter_task'
  if (title.includes('角色')) return 'character_state'
  if (title.includes('伏笔')) return 'foreshadowing_rules'
  if (title.includes('近期') || title.includes('最近')) return 'recent_chapters'
  if (title.includes('远期') || title.includes('阶段')) return 'remote_summary'
  if (title.includes('设定') || title.includes('Canon')) return 'hard_canon'
  if (title.includes('风格')) return 'style'
  if (title.includes('输出')) return 'output_format'
  return 'prompt_section'
}

export function inferPromptBlockOrderFromPrompt(finalPrompt: string, source = 'prompt_context_snapshot'): PromptBlockOrderItem[] {
  const matches = [...finalPrompt.matchAll(/^##\s+(.+)$/gm)]
  if (!matches.length) {
    return [
      {
        id: 'snapshot-final-prompt',
        title: 'Prompt 快照全文',
        kind: 'prompt_snapshot',
        priority: 1,
        tokenEstimate: TokenEstimator.estimate(finalPrompt),
        source,
        sourceIds: [],
        included: Boolean(finalPrompt.trim()),
        compressed: false,
        forced: false,
        omittedReason: null,
        reason: '旧版或手动编辑快照缺少结构化 section，只能按全文记录。'
      }
    ]
  }

  return matches.map((match, index) => {
    const title = match[1].trim()
    const start = match.index ?? 0
    const end = matches[index + 1]?.index ?? finalPrompt.length
    const text = finalPrompt.slice(start, end)
    return {
      id: `snapshot-block-${index + 1}`,
      title,
      kind: inferBlockKind(title),
      priority: index + 1,
      tokenEstimate: TokenEstimator.estimate(text),
      source,
      sourceIds: [],
      included: true,
      compressed: title.includes('压缩'),
      forced: title.includes('上一章结尾衔接'),
      omittedReason: null,
      reason: '从已保存最终 Prompt 的 section 标题推断。'
    }
  })
}

export function truncateText(text: string, limit: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit)}\n（文风样例已截断，避免长期上下文膨胀。）`
}

export function styleSampleLimit(mode: PromptMode): number {
  if (mode === 'light') return 600
  if (mode === 'full') return 2000
  return 1200
}

export function formatHardCanonPack(project: PromptBuildInput['project'], bible: PromptBuildInput['bible']): string {
  if (!bible) return '尚未填写小说圣经；不得因此临时发明重大设定。'
  return [
    `项目：${project.name}`,
    `项目简介：${valueOrEmpty(project.description)}`,
    `力量体系/规则体系底线：${valueOrEmpty(bible.powerSystem)}`,
    `重要不可违背设定：${valueOrEmpty(bible.immutableFacts)}`,
    `主角核心欲望：${valueOrEmpty(bible.protagonistDesire)}`,
    `主角核心恐惧：${valueOrEmpty(bible.protagonistFear)}`,
    `主线冲突：${valueOrEmpty(bible.mainConflict)}`,
    `禁用套路：${valueOrEmpty(bible.bannedTropes)}`,
    '禁止新增机制：不得为了让角色脱困而临时新增未铺垫救命规则、系统权限、管理员层级或核心世界观机制。'
  ].join('\n')
}

export function formatStyleEnvelope(project: PromptBuildInput['project'], bible: PromptBuildInput['bible'], styleSample: string): string {
  return [
    `类型/题材：${valueOrEmpty(project.genre)}`,
    `目标读者：${valueOrEmpty(project.targetReaders)}`,
    `核心爽点/情绪体验：${valueOrEmpty(project.coreAppeal)}`,
    `整体风格：${valueOrEmpty(project.style)}`,
    `叙事基调：${valueOrEmpty(bible?.narrativeTone)}`,
    `文风要求：${styleSample || '待补充'}`,
    '风格只作为表达滤镜，不得覆盖上一章衔接、本章任务、角色硬状态和伏笔 treatmentMode。'
  ].join('\n')
}

export function priorityRuleText(): string {
  return [
    '如果上下文之间存在冲突，必须按以下优先级处理：',
    '1. 上一章结尾衔接 Bridge',
    '2. 本章任务契约',
    '3. 角色硬状态账本',
    '4. 伏笔 treatmentMode 操作规则',
    '5. 近期章节事实',
    '6. 远期压缩摘要',
    '7. 最小硬设定',
    '8. 风格要求',
    '不得用低优先级内容改写高优先级事实；不得让世界观说明或文风样例覆盖章节承接、角色状态和伏笔规则。'
  ].join('\n')
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}

function parseChineseNumber(input: string): number | null {
  const text = input.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text)

  if (!/[十百千万]/.test(text)) {
    let value = 0
    for (const char of text) {
      const digit = CHINESE_DIGITS[char]
      if (digit === undefined) return null
      value = value * 10 + digit
    }
    return value
  }

  let total = 0
  let section = 0
  let number = 0
  const unitMap: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }

  for (const char of text) {
    const digit = CHINESE_DIGITS[char]
    if (digit !== undefined) {
      number = digit
      continue
    }

    const unit = unitMap[char]
    if (!unit) return null
    if (unit === 10000) {
      section = (section + number) * unit
      total += section
      section = 0
    } else {
      section += (number || 1) * unit
    }
    number = 0
  }

  return total + section + number
}

function numberPattern(): string {
  return String.raw`(?:\d+|[零〇一二两三四五六七八九十百千万]+)`
}

function normalizeChapterNumber(value: string): number | null {
  return parseChineseNumber(value.replace(/^第/, '').replace(/章$/, ''))
}

export function parseChapterRangesFromText(text: string): Array<{ start: number; end: number }> {
  const pattern = numberPattern()
  const ranges: Array<{ start: number; end: number }> = []
  const rangeRegex = new RegExp(`第?(${pattern})\\s*(?:-|—|~|到|至)\\s*第?(${pattern})\\s*章?`, 'g')
  for (const match of text.matchAll(rangeRegex)) {
    const start = normalizeChapterNumber(match[1])
    const end = normalizeChapterNumber(match[2])
    if (start !== null && end !== null) {
      ranges.push({ start: Math.min(start, end), end: Math.max(start, end) })
    }
  }
  return ranges
}

export function parseChapterNumbersFromText(text: string): number[] {
  const pattern = numberPattern()
  const numbers = new Set<number>()
  const chapterRegex = new RegExp(`第?(${pattern})\\s*章`, 'g')
  for (const match of text.matchAll(chapterRegex)) {
    const value = normalizeChapterNumber(match[1])
    if (value !== null) numbers.add(value)
  }

  for (const range of parseChapterRangesFromText(text)) {
    numbers.add(range.start)
    numbers.add(range.end)
  }

  return [...numbers].sort((a, b) => a - b)
}
