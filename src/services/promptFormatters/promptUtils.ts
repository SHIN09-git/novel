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

export { parseChapterNumbersFromText, parseChapterRangesFromText } from '../../shared/chapterText'

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

export function promptExclusionTerms(value: string | undefined): string[] {
  if (!value?.trim()) return []
  return [...new Set(
    value
      .split(/[\r\n,，、;；|:：]+/)
      .map((term) =>
        term
          .trim()
          .replace(/^(?:不得|不要|禁止|不能|不可|不应|避免)\s*(?:提前)?\s*(?:回收|揭示|使用|提及|出现|写出|引用)?\s*/u, '')
          .replace(/[。.!！?？]+$/u, '')
          .trim()
      )
      .filter((term) => term.length >= 2 && term.length <= 80)
  )]
}

export function filterPromptLinesByExclusionText(
  text: string,
  exclusionText: string | undefined
): { text: string; omittedLineCount: number; matchedTerms: string[] } {
  const terms = promptExclusionTerms(exclusionText)
  if (!terms.length || !text.trim()) return { text, omittedLineCount: 0, matchedTerms: [] }
  const matchedTerms = new Set<string>()
  let omittedLineCount = 0
  const lines = text.split('\n').filter((line) => {
    const matched = terms.find((term) => line.includes(term))
    if (!matched) return true
    matchedTerms.add(matched)
    omittedLineCount += 1
    return false
  })
  return { text: lines.join('\n'), omittedLineCount, matchedTerms: [...matchedTerms] }
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

export function promptBlockOrderFromFinalPrompt(
  blocks: PromptBlockDraft[],
  finalPrompt: string
): PromptBlockOrderItem[] {
  const matches = [...finalPrompt.matchAll(/^##\s+(.+)$/gm)]
  const renderedSections = new Map<string, string>()
  matches.forEach((match, index) => {
    const title = match[1].trim()
    const start = match.index ?? 0
    const end = matches[index + 1]?.index ?? finalPrompt.length
    renderedSections.set(title, finalPrompt.slice(start, end).trim())
  })

  return blocks.map((block) => {
    const base = blockToOrderItem(block)
    if (!base.included) return base
    const rendered = renderedSections.get(block.title)
    if (!rendered) {
      return {
        ...base,
        included: false,
        tokenEstimate: 0,
        omittedReason: '运行时 Prompt guard 已移除该区块。'
      }
    }
    return {
      ...base,
      tokenEstimate: TokenEstimator.estimate(rendered),
      omittedReason: null
    }
  })
}

function inferBlockKind(title: string): string {
  if (title.includes('上下文冲突优先级')) return 'priority_rules'
  if (title.includes('写作任务声明')) return 'writing_task'
  if (title.includes('上一章')) return 'continuity_bridge'
  if (title.includes('任务')) return 'chapter_task'
  if (title.includes('角色')) return 'character_state'
  if (title.includes('伏笔')) return 'foreshadowing_rules'
  if (title.includes('剧情导向')) return 'story_direction'
  if (title.includes('当前剧情')) return 'current_progress'
  if (title.includes('近期') || title.includes('最近')) return 'recent_chapters'
  if (title.includes('远期') || title.includes('阶段')) return 'remote_summary'
  if (title.includes('时间线')) return 'timeline'
  if (title.includes('NoveltyPolicy') || title.includes('写作限制') || title.includes('禁止事项')) return 'forbidden_and_novelty'
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

export function formatStyleEnvelope(
  project: PromptBuildInput['project'],
  bible: PromptBuildInput['bible'],
  styleSample: string,
  isOpeningChapter = false
): string {
  return [
    `类型/题材：${valueOrEmpty(project.genre)}`,
    `目标读者：${valueOrEmpty(project.targetReaders)}`,
    `核心爽点/情绪体验：${valueOrEmpty(project.coreAppeal)}`,
    `整体风格：${valueOrEmpty(project.style)}`,
    `叙事基调：${valueOrEmpty(bible?.narrativeTone)}`,
    fieldLine('文风要求：', styleSample),
    isOpeningChapter
      ? '风格只作为表达滤镜，不得覆盖第一章自然开场、本章任务、人物关系和信息边界。'
      : '风格只作为表达滤镜，不得覆盖上一章衔接、本章任务、角色硬状态和伏笔 treatmentMode。'
  ].filter(Boolean).join('\n')
}

export function priorityRuleText(isOpeningChapter = false): string {
  if (isOpeningChapter) {
    return [
      '如果上下文之间存在冲突，必须按以下优先级处理：',
      '1. 第一章自然开场约束（不存在上一章，不得伪造前情）',
      '2. 本章任务契约及其信息边界',
      '3. 本章任务明确点名的人物与当下关系',
      '4. 本章任务明确要求的文风',
      '权威第一章不使用旧章节、阶段摘要、时间线、既有伏笔或中期剧情导向；不得暗示这些资料存在。'
    ].join('\n')
  }

  return [
    '写作任务声明只说明本次产出范围；若事实或指令之间存在冲突，必须按以下优先级处理：',
    '1. 上一章结尾衔接 Bridge',
    '2. 本章任务契约',
    '3. HardCanonPack 不可违背硬设定（如与前两项冲突，必须报告冲突，不得静默覆盖）',
    '4. 角色硬状态账本',
    '5. 伏笔 treatmentMode 操作规则',
    '6. 中期剧情导向 StoryDirectionGuide（只决定推进方向）',
    '7. 近期章节事实',
    '8. 远期压缩摘要',
    '9. 时间线校验参考',
    '10. 风格要求',
    '写作限制与输出要求在末尾统一补充，不得用低优先级内容改写高优先级事实；不得让世界观说明或文风样例覆盖章节承接、角色状态和伏笔规则。'
  ].join('\n')
}

export function chapterNoveltyPolicyLines(isOpeningChapter: boolean): string[] {
  return isOpeningChapter
    ? [
        'NoveltyPolicy：第一章采用封闭式剧情范围；专名、背景、人物关系、剧情事件、线索和机制只能来自任务契约。',
        '可以自然补充不带专名、不承担剧情功能的普通食材、器具、摊贩或路人、环境细节和生活动作，让日常场景完整可感。',
        '不得让这些日常补充承载悬疑信息、后续钩子或便利解法；不得新增任务未授权的专名、背景、规则、机制、组织或关键道具。',
        '若任务明确允许新增内容，也必须自然出现，不能抢占本章生活主线。'
      ]
    : [
        'NoveltyPolicy：不得新增任务未授权的人物、地点、组织、规则、机制或关键道具。',
        '不得为了让角色脱困而临时新增刚好可用的设定；解决危机必须来自已提供规则、已铺垫伏笔、角色已有能力或本章任务明确许可。',
        '任务明确允许的新内容必须带来合理代价、风险或复杂度，不能只提供便利。',
        '不得给未知人物擅自命名；不得将未授权新设定写成已经存在的长期事实。',
        '不得提前解释 hidden / pause 状态伏笔。'
      ]
}
