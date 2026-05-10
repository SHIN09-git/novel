import type {
  Character,
  CharacterCardField,
  CharacterStateFact,
  CharacterStateLog,
  Chapter,
  ChapterContinuityBridge,
  ContinuitySource,
  Foreshadowing,
  ID,
  ContextBudgetProfile,
  ContextCompressionRecord,
  ContextSelectionResult,
  ContextNeedPlan,
  BuildPromptResult,
  PromptBlockOrderItem,
  PromptBuildInput,
  PromptConfig,
  PromptModuleSelection,
  PromptMode,
  StageSummary,
  TimelineEvent
} from '../shared/types'
import {
  effectiveTreatmentMode,
  shouldRecommendForeshadowing,
  treatmentLabel,
  treatmentPromptRules
} from '../shared/foreshadowingTreatment'
import { ContextBudgetManager } from './ContextBudgetManager'
import { formatContinuityBridgeForPrompt, resolveContinuityBridge } from './ContinuityService'
import { TokenEstimator } from './TokenEstimator'
import { CharacterStateService } from './CharacterStateService'
import { StoryDirectionService } from './StoryDirectionService'

const PLACEHOLDER_PATTERNS = [
  /待补充/i,
  /暂无/i,
  /未填写/i,
  /未设置/i,
  /暂无与本章需求匹配/i,
  /寰呰/i,
  /鏆傛棤/i,
  /鏈懡鍚/i,
  /鏈/i
]

const AUDIT_LINE_PATTERNS = [
  /^风险[:：]/,
  /^审稿[:：]/,
  /建议后续章节/,
  /正文可能提前/,
  /超出允许范围/,
  /^椋庨櫓[:：]?/,
  /^瀹＄[:：]?/,
  /寤鸿鍚庣画/,
  /姝ｆ枃鍙兘/,
  /瓒呭嚭鍏佽鑼冨洿/
]

function isPlaceholderText(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const text = String(value).trim()
  if (!text) return true
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))
}

function valueOrEmpty(value: string | number | null | undefined): string {
  if (isPlaceholderText(value)) return ''
  return String(value).trim()
}

function fieldLine(label: string, value: unknown): string {
  const text = valueOrEmpty(value as string | number | null | undefined)
  return text ? `${label}${text}` : ''
}

function cleanPromptBody(raw: string): string {
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

function section(title: string, enabled: boolean, body: string): string {
  if (!enabled) return ''
  const cleaned = cleanPromptBody(body)
  if (!cleaned) return ''
  return `## ${title}\n${cleaned}\n`
}

interface PromptBlockDraft {
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

function renderPromptBlock(block: PromptBlockDraft): string {
  return section(block.title, block.enabled, block.body)
}

function blockToOrderItem(block: PromptBlockDraft): PromptBlockOrderItem {
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

function truncateText(text: string, limit: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit)}\n（文风样例已截断，避免长期上下文膨胀。）`
}

function styleSampleLimit(mode: PromptMode): number {
  if (mode === 'light') return 600
  if (mode === 'full') return 2000
  return 1200
}

function summarizeChapter(chapter: Chapter, includeBody: boolean): string {
  const lines = [
    `### 第 ${chapter.order} 章：${chapter.title || '未命名'}`,
    `剧情摘要：${valueOrEmpty(chapter.summary)}`,
    `新增信息：${valueOrEmpty(chapter.newInformation)}`,
    `角色变化：${valueOrEmpty(chapter.characterChanges)}`,
    `新增伏笔：${valueOrEmpty(chapter.newForeshadowing)}`,
    `已回收伏笔：${valueOrEmpty(chapter.resolvedForeshadowing)}`,
    `结尾钩子：${valueOrEmpty(chapter.endingHook)}`
  ]

  if (includeBody && chapter.body.trim()) {
    lines.push(`正文摘录：\n${chapter.body.trim().slice(0, 1200)}`)
  }

  return lines.join('\n')
}

function normalizeDedupText(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[，。！？；：、,.!?;:"'“”‘’（）()【】\[\]《》<>]/g, '')
    .toLowerCase()
}

function bridgeDedupFacts(bridge: ChapterContinuityBridge | null): string[] {
  if (!bridge) return []
  return [
    bridge.lastSceneLocation,
    bridge.lastPhysicalState,
    bridge.lastEmotionalState,
    bridge.lastUnresolvedAction,
    bridge.lastDialogueOrThought,
    bridge.immediateNextBeat,
    bridge.mustContinueFrom,
    bridge.mustNotReset,
    bridge.openMicroTensions
  ]
    .map(valueOrEmpty)
    .map(normalizeDedupText)
    .filter((text) => text.length >= 8)
}

function dedupeAgainstBridge(text: string, bridge: ChapterContinuityBridge | null): string {
  const bridgeFacts = bridgeDedupFacts(bridge)
  if (!bridgeFacts.length) return cleanPromptBody(text)
  const seen = new Set<string>()
  return cleanPromptBody(
    text
      .split('\n')
      .filter((line) => {
        const normalized = normalizeDedupText(line)
        if (!normalized) return true
        if (seen.has(normalized)) return false
        seen.add(normalized)
        if (normalized.length < 8) return true
        return !bridgeFacts.some((fact) => normalized.includes(fact) || fact.includes(normalized))
      })
      .join('\n')
  )
}

function formatCompressedChapterRecap(chapter: Chapter, record: ContextCompressionRecord): string {
  if (record.replacementKind === 'dropped') return ''
  const replacementText = record.replacementText?.trim()
  if (!replacementText) return ''
  const sourceLabel = {
    stage_summary: '阶段摘要',
    chapter_one_line_summary: '章节一句话摘要',
    summary_excerpt: '章节摘要摘录',
    dropped: '已裁掉'
  }[record.replacementKind]
  return [
    `### 第 ${chapter.order} 章：${chapter.title || '未命名'}（详细回顾已压缩）`,
    `替换方式：${sourceLabel}`,
    `压缩原因：${record.reason}`,
    `节省估算：约 ${record.savedTokenEstimate} token`,
    replacementText
  ].join('\n')
}

function formatStageSummary(summary: StageSummary): string {
  return [
    `### 第 ${summary.chapterStart}-${summary.chapterEnd} 章阶段摘要`,
    `阶段剧情进展：${valueOrEmpty(summary.plotProgress)}`,
    `主要角色关系变化：${valueOrEmpty(summary.characterRelations)}`,
    `关键秘密/信息差：${valueOrEmpty(summary.secrets)}`,
    `已埋伏笔：${valueOrEmpty(summary.foreshadowingPlanted)}`,
    `已回收伏笔：${valueOrEmpty(summary.foreshadowingResolved)}`,
    `当前未解决问题：${valueOrEmpty(summary.unresolvedQuestions)}`,
    `下一阶段推荐推进方向：${valueOrEmpty(summary.nextStageDirection)}`
  ].join('\n')
}

function recentCharacterLogs(characterId: ID, logs: CharacterStateLog[]): CharacterStateLog[] {
  return logs
    .filter((log) => log.characterId === characterId)
    .sort((a, b) => {
      const chapterDelta = (b.chapterOrder ?? -1) - (a.chapterOrder ?? -1)
      if (chapterDelta !== 0) return chapterDelta
      return b.createdAt.localeCompare(a.createdAt)
    })
    .slice(0, 3)
}

function formatCharacter(character: Character, logs: CharacterStateLog[]): string {
  const lines = [
    `### ${character.name || '未命名角色'}${character.isMain ? '（主要角色）' : ''}`,
    `本章定位：${valueOrEmpty(character.role)}`,
    `当前表层目标：${valueOrEmpty(character.surfaceGoal)}`,
    `当前知道的信息：${valueOrEmpty(character.knownInformation)}`,
    `当前不知道的信息：${valueOrEmpty(character.unknownInformation)}`,
    `当前情绪/关系状态：${[valueOrEmpty(character.emotionalState), valueOrEmpty(character.protagonistRelationship)].filter(Boolean).join('；')}`,
    `本章可行动作或行为倾向：${valueOrEmpty(character.nextActionTendency)}`,
    `禁止写法：${valueOrEmpty(character.forbiddenWriting)}`
  ]

  const recentLogs = recentCharacterLogs(character.id, logs)
  if (recentLogs.length > 0) {
    lines.push(
      '最近状态更新：',
      ...recentLogs.map((log) => `- ${log.chapterOrder ? `第 ${log.chapterOrder} 章` : '未关联章节'}：${log.note}`)
    )
  }

  return lines.join('\n')
}

function characterFieldLabel(field: CharacterCardField): string {
  const labels: Record<CharacterCardField, string> = {
    roleFunction: '角色定位',
    surfaceGoal: '表层目标',
    deepNeed: '深层需求',
    coreFear: '核心恐惧',
    decisionLogic: '行动逻辑',
    abilitiesAndResources: '能力与资源',
    weaknessAndCost: '弱点与代价',
    relationshipTension: '关系张力',
    futureHooks: '后续钩子'
  }
  return labels[field]
}

function characterFieldValue(character: Character, field: CharacterCardField): string {
  if (field === 'roleFunction') return character.role
  if (field === 'surfaceGoal') return character.surfaceGoal
  if (field === 'deepNeed') return character.deepDesire
  if (field === 'coreFear') return character.coreFear
  if (field === 'decisionLogic') return [character.nextActionTendency, character.selfDeception].filter(Boolean).join('；')
  if (field === 'abilitiesAndResources') return character.knownInformation
  if (field === 'weaknessAndCost') return [character.coreFear, character.forbiddenWriting].filter(Boolean).join('；')
  if (field === 'relationshipTension') return character.protagonistRelationship
  return character.nextActionTendency
}

function formatCharacterNeedSlice(character: Character, logs: CharacterStateLog[], plan: ContextNeedPlan): string {
  const expected = plan.expectedCharacters.find((item) => item.characterId === character.id)
  const fields = plan.requiredCharacterCardFields[character.id] ?? []
  const categories = plan.requiredStateFactCategories[character.id] ?? []
  const recentLogs = recentCharacterLogs(character.id, logs)
  const lines = [
    `### ${character.name || '未命名角色'}${character.isMain ? '（主要角色）' : ''}`,
    `本章出场方式：${expected?.expectedPresence ?? 'onstage'}`,
    `本章角色功能：${expected?.roleInChapter ?? 'support'}`,
    `选择原因：${expected?.reason || '本章需求计划要求核对该角色。'}`
  ]

  if (fields.length > 0) {
    lines.push(
      '本章需要关注的角色卡字段：',
      ...fields.map((field) => `- ${characterFieldLabel(field)}：${valueOrEmpty(characterFieldValue(character, field))}`)
    )
  }

  if (categories.length > 0) {
    lines.push('本章状态账本类别：', ...categories.map((category) => `- ${category}`))
  }

  if (recentLogs.length > 0) {
    lines.push(
      '最近状态事实：',
      ...recentLogs.map((log) => `- ${log.chapterOrder ? `第 ${log.chapterOrder} 章` : '未关联章节'}：${log.note}`)
    )
  }

  lines.push(
    '写作约束：',
    `- 不得违背该角色当前状态：${valueOrEmpty(character.emotionalState)}`,
    `- 不得忽略关系状态：${valueOrEmpty(character.protagonistRelationship)}`,
    `- 不得触发禁止写法：${valueOrEmpty(character.forbiddenWriting)}`
  )

  return lines.join('\n')
}

function stateCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    resource: '资源',
    inventory: '持有物品',
    location: '当前位置',
    physical: '身体状态',
    mental: '心理状态',
    knowledge: '已知信息',
    relationship: '关系状态',
    goal: '当前目标',
    promise: '承诺/债务',
    secret: '秘密',
    ability: '能力限制',
    status: '状态',
    custom: '自定义'
  }
  return labels[category] ?? category
}

function formatStateFact(fact: CharacterStateFact): string {
  const value = CharacterStateService.formatFactValue(fact.value)
  const unit = fact.unit ? ` ${fact.unit}` : ''
  const source = fact.sourceChapterOrder ? `来源：第 ${fact.sourceChapterOrder} 章。` : ''
  const policy = fact.trackingLevel === 'hard' ? '硬状态' : fact.trackingLevel === 'soft' ? '软状态' : '备注'
  return `- ${fact.label}：${value}${unit}。（${[policy, source].filter(Boolean).join('；')}）`
}

function formatCharacterStateLedgerSlice(
  characters: Character[],
  facts: CharacterStateFact[],
  plan: ContextNeedPlan | null,
  targetChapterOrder: number
): string {
  const characterIds = characters.map((character) => character.id)
  const selectedFacts = CharacterStateService.getRelevantCharacterStatesForPrompt(characterIds, plan, targetChapterOrder, facts)
  if (!selectedFacts.length) return ''
  const names = new Map(characters.map((character) => [character.id, character.name || '未命名角色']))
  const grouped = selectedFacts.reduce<Record<ID, CharacterStateFact[]>>((acc, fact) => {
    acc[fact.characterId] = [...(acc[fact.characterId] ?? []), fact]
    return acc
  }, {})
  return Object.entries(grouped)
    .map(([characterId, items]) => {
      const byCategory = items.reduce<Record<string, CharacterStateFact[]>>((acc, fact) => {
        acc[fact.category] = [...(acc[fact.category] ?? []), fact]
        return acc
      }, {})
      const categoryText = Object.entries(byCategory)
        .map(([category, categoryFacts]) => [`${stateCategoryLabel(category)}：`, ...categoryFacts.map(formatStateFact)].join('\n'))
        .join('\n')
      return [
        `### 角色：${names.get(characterId) ?? '未知角色'}`,
        categoryText,
        '写作约束：',
        '- 不得让角色花费超过当前余额，除非正文交代收入、借款、赊账、偷取或其他合理来源。',
        '- 不得让角色使用未持有物品。',
        '- 不得让角色知道尚未记录为已知的信息或秘密。',
        '- 不得让伤势、能力限制、位置和承诺无解释消失。'
      ].join('\n')
    })
    .join('\n\n')
}

function formatForeshadowing(item: Foreshadowing, overrides?: PromptConfig['foreshadowingTreatmentOverrides']): string {
  const treatmentMode = effectiveTreatmentMode(item, overrides)
  const statusLabel = {
    unresolved: '未回收',
    partial: '部分推进',
    resolved: '已回收',
    abandoned: '废弃'
  }[item.status]

  const weightLabel = {
    low: '低',
    medium: '中',
    high: '高',
    payoff: '回收'
  }[item.weight]

  return [
    `### 【${item.title || '未命名伏笔'}】`,
    `状态：${statusLabel}`,
    `权重：${weightLabel}`,
    `当前处理方式：${treatmentLabel(treatmentMode)}`,
    `首次出现：第 ${valueOrEmpty(item.firstChapterOrder)} 章`,
    `预计回收：${valueOrEmpty(item.expectedPayoff)}`,
    `回收方式：${valueOrEmpty(item.payoffMethod)}`,
    `关联主线：${valueOrEmpty(item.relatedMainPlot)}`,
    `注意事项：${valueOrEmpty(item.notes)}`,
    '本章使用规则：',
    ...treatmentPromptRules(treatmentMode).map((rule) => `- ${rule}`)
  ].join('\n')
}

function foreshadowingStatusLabel(status: Foreshadowing['status']): string {
  return {
    unresolved: '未回收',
    partial: '部分推进',
    resolved: '已回收',
    abandoned: '废弃'
  }[status]
}

function foreshadowingWeightLabel(weight: Foreshadowing['weight']): string {
  return {
    low: '低',
    medium: '中',
    high: '高',
    payoff: '回收'
  }[weight]
}

function treatmentGroupTitle(mode: ReturnType<typeof effectiveTreatmentMode>): string {
  if (mode === 'hint') return '允许暗示 hint'
  if (mode === 'advance') return '允许推进 advance'
  if (mode === 'mislead') return '允许误导 mislead'
  if (mode === 'payoff') return '允许回收 payoff'
  return '禁止提及 hidden / pause'
}

function treatmentGroupInstruction(mode: ReturnType<typeof effectiveTreatmentMode>): string[] {
  if (mode === 'hint') return ['只能轻微暗示。', '不得解释来源。', '不得让角色直接说破。', '不得回收。']
  if (mode === 'advance') return ['可以出现新线索或增加压力。', '不得揭示最终真相。', '不得完成 payoff。']
  if (mode === 'mislead') return ['可以制造错误理解。', '不得改变事实真相。', '不得让误导变成真实设定。']
  if (mode === 'payoff') return ['可以揭示并兑现。', '必须对应已有铺垫。', '回收后要影响人物选择或剧情结果。']
  return ['默认不得主动出现。', '不得借角色对白说破。', '不得推进、解释、回收或变成新设定。']
}

function formatForeshadowingOperationTable(items: Foreshadowing[], config: PromptConfig): string {
  if (!items.length) return ''
  const grouped = items.reduce<Record<string, Foreshadowing[]>>((acc, item) => {
    const mode = effectiveTreatmentMode(item, config.foreshadowingTreatmentOverrides)
    const key = mode === 'hidden' || mode === 'pause' ? 'blocked' : mode
    acc[key] = [...(acc[key] ?? []), item]
    return acc
  }, {})
  const order: Array<'hint' | 'advance' | 'mislead' | 'payoff' | 'blocked'> = ['hint', 'advance', 'mislead', 'payoff', 'blocked']
  return order
    .filter((key) => grouped[key]?.length)
    .map((key) => {
      const mode = key === 'blocked' ? 'hidden' : key
      const header = [
        `### ${treatmentGroupTitle(mode)}`,
        '组内规则：',
        ...treatmentGroupInstruction(mode).map((rule) => `- ${rule}`)
      ].join('\n')
      const entries = grouped[key]
        .map((item) => {
          const actualMode = effectiveTreatmentMode(item, config.foreshadowingTreatmentOverrides)
          const isOverride = Boolean(config.foreshadowingTreatmentOverrides?.[item.id])
          const isBlocked = actualMode === 'hidden' || actualMode === 'pause'
          return [
            `- 【${item.title || '未命名伏笔'}】`,
            `  - 状态：${foreshadowingStatusLabel(item.status)}；权重：${foreshadowingWeightLabel(item.weight)}；处理方式：${treatmentLabel(actualMode)}${isOverride ? '（本章 override / 手动强选）' : ''}`,
            valueOrEmpty(item.firstChapterOrder) ? `  - 首次出现：第 ${valueOrEmpty(item.firstChapterOrder)} 章` : '',
            fieldLine('  - 预计回收方向：', item.expectedPayoff),
            fieldLine('  - 回收方式：', item.payoffMethod),
            fieldLine('  - 关联主线：', item.relatedMainPlot),
            isBlocked && isOverride ? '  - 本章限制：虽被手动强选，但仍应保持暂停/隐藏，不主动推进、不解释、不回收。' : '',
            fieldLine('  - 注意事项：', item.notes)
          ]
            .filter(Boolean)
            .join('\n')
        })
        .join('\n')
      return `${header}\n${entries}`
    })
    .join('\n\n')
}

function formatHardCanonPack(project: PromptBuildInput['project'], bible: PromptBuildInput['bible']): string {
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

function formatStyleEnvelope(project: PromptBuildInput['project'], bible: PromptBuildInput['bible'], styleSample: string): string {
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

function priorityRuleText(): string {
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

function parseChapterRangesFromText(text: string): Array<{ start: number; end: number }> {
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

function expectedPayoffNear(item: Foreshadowing, targetChapterOrder: number): boolean {
  const ranges = parseChapterRangesFromText(item.expectedPayoff)
  if (ranges.some((range) => targetChapterOrder >= range.start - 3 && targetChapterOrder <= range.end + 3)) {
    return true
  }

  const numbers = parseChapterNumbersFromText(item.expectedPayoff)
  return numbers.some((num) => Math.abs(num - targetChapterOrder) <= 3)
}

function uniqueById<T extends { id: ID }>(items: T[]): T[] {
  const seen = new Set<ID>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function automaticForeshadowings(items: Foreshadowing[], targetChapterOrder: number): Foreshadowing[] {
  return items.filter((item) => shouldRecommendForeshadowing(item, expectedPayoffNear(item, targetChapterOrder)))
}

function selectedForeshadowings(items: Foreshadowing[], targetChapterOrder: number, config: PromptConfig): Foreshadowing[] {
  void targetChapterOrder
  if (!config.modules.foreshadowing) return []
  const selectedIds = new Set(config.selectedForeshadowingIds)
  return items.filter((item) => selectedIds.has(item.id))
}

function automaticCharacters(characters: Character[], foreshadowings: Foreshadowing[]): Character[] {
  const relatedIds = new Set(foreshadowings.flatMap((item) => item.relatedCharacterIds))
  return characters.filter((character) => character.isMain || relatedIds.has(character.id))
}

function selectedCharacters(characters: Character[], foreshadowings: Foreshadowing[], config: PromptConfig): Character[] {
  void foreshadowings
  if (!config.modules.characters) return []
  const selectedIds = new Set(config.selectedCharacterIds)
  return characters.filter((character) => selectedIds.has(character.id))
}

function formatTimeline(events: TimelineEvent[], targetChapterOrder: number): string {
  return events
    .filter((event) => event.chapterOrder === null || event.chapterOrder <= targetChapterOrder)
    .sort((a, b) => a.narrativeOrder - b.narrativeOrder)
    .map((event) =>
      [
        `### ${event.narrativeOrder}. ${event.title || '未命名事件'}`,
        `所属章节：${valueOrEmpty(event.chapterOrder)}`,
        `故事内时间：${valueOrEmpty(event.storyTime)}`,
        `事件结果：${valueOrEmpty(event.result)}`,
        `后续影响：${valueOrEmpty(event.downstreamImpact)}`
      ].join('\n')
    )
    .join('\n\n')
}

export class PromptBuilderService {
  static selectBudgetContext(input: PromptBuildInput, budgetProfile: ContextBudgetProfile) {
    return ContextBudgetManager.selectContext(
      {
        project: input.project,
        bible: input.bible,
        chapters: input.chapters,
        characters: input.characters,
        foreshadowings: input.foreshadowings,
        timelineEvents: input.timelineEvents,
        stageSummaries: input.stageSummaries
      },
      input.config.targetChapterOrder,
      budgetProfile,
      {
        characterIds: input.config.selectedCharacterIds,
        foreshadowingIds: input.config.selectedForeshadowingIds,
        chapterTask: input.config.task,
        foreshadowingTreatmentOverrides: input.config.foreshadowingTreatmentOverrides,
        contextNeedPlan: input.contextNeedPlan ?? null
      }
    )
  }

  static buildResult(input: PromptBuildInput): BuildPromptResult {
    let workingInput = input
    const budgetSelection =
      input.explicitContextSelection ?? (input.budgetProfile ? PromptBuilderService.selectBudgetContext(input, input.budgetProfile) : null)
    const selectionIsExplicit = Boolean(input.explicitContextSelection)

    if (budgetSelection) {
      const selectedCharacterIds = selectionIsExplicit
        ? new Set(budgetSelection.selectedCharacterIds)
        : new Set([...budgetSelection.selectedCharacterIds, ...input.config.selectedCharacterIds])
      const selectedForeshadowingIds = selectionIsExplicit
        ? new Set(budgetSelection.selectedForeshadowingIds)
        : new Set([...budgetSelection.selectedForeshadowingIds, ...input.config.selectedForeshadowingIds])
      workingInput = {
        ...input,
        chapters: input.chapters.filter((chapter) => budgetSelection.selectedChapterIds.includes(chapter.id)),
        characters: input.characters.filter((character) => selectedCharacterIds.has(character.id)),
        foreshadowings: input.foreshadowings.filter((item) => selectedForeshadowingIds.has(item.id)),
        timelineEvents: input.timelineEvents.filter((event) => budgetSelection.selectedTimelineEventIds.includes(event.id)),
        stageSummaries: input.stageSummaries.filter((summary) => budgetSelection.selectedStageSummaryIds.includes(summary.id)),
        config: {
          ...input.config,
          selectedCharacterIds: [...selectedCharacterIds],
          selectedForeshadowingIds: [...selectedForeshadowingIds]
        }
      }
    }

    const { project, bible, chapters, characters, characterStateLogs, characterStateFacts, foreshadowings, timelineEvents, stageSummaries, config } =
      workingInput
    const target = config.targetChapterOrder
    const sortedChapters = [...chapters].sort((a, b) => a.order - b.order)
    const previousChapters = sortedChapters.filter((chapter) => chapter.order < target)
    const continuity = config.useContinuityBridge === false
      ? { bridge: null as ChapterContinuityBridge | null, source: null as ContinuitySource | null, warnings: [] as string[] }
      : resolveContinuityBridge({
          projectId: project.id,
          chapters: input.chapters,
          bridges: input.chapterContinuityBridges ?? [],
          targetChapterOrder: target
        })
    const recentChapters = selectionIsExplicit ? previousChapters : previousChapters.slice(config.mode === 'light' ? -2 : -3)
    const compressionByChapterId = new Map((budgetSelection?.compressionRecords ?? []).map((record) => [record.originalChapterId, record]))
    const summaries = [...stageSummaries]
      .filter((summary) => summary.chapterEnd < target)
      .sort((a, b) => a.chapterStart - b.chapterStart)
    const selectedSummaries = selectionIsExplicit ? summaries : config.mode === 'full' ? summaries : summaries.slice(-2)
    const foreshadowingSelection = selectedForeshadowings(foreshadowings, target, config)
    const characterSelection = uniqueById(selectedCharacters(characters, foreshadowingSelection, config))
    const contextNeedPlan = workingInput.contextNeedPlan ?? null

    const styleLimit = input.budgetProfile?.styleSampleMaxChars ?? styleSampleLimit(config.mode)
    const styleSample = bible?.styleSample ? truncateText(bible.styleSample, styleLimit) : ''
    const hardCanonText = formatHardCanonPack(project, bible)
    const styleEnvelopeText = formatStyleEnvelope(project, bible, styleSample)

    const latestProgress =
      previousChapters
        .slice(-1)
        .map((chapter) => (valueOrEmpty(chapter.summary) ? `截至第 ${chapter.order} 章：${valueOrEmpty(chapter.summary)}` : ''))
        .filter(Boolean)
        .join('\n')
    const dedupedLatestProgress = dedupeAgainstBridge(latestProgress, continuity.bridge)

    const task = config.task
    const taskText = [
      fieldLine('本章目标：', task.goal),
      fieldLine('本章必须推进的冲突：', task.conflict),
      fieldLine('本章必须保留的悬念：', task.suspenseToKeep),
      fieldLine('本章允许回收的伏笔：', task.allowedPayoffs),
      fieldLine('本章禁止回收的伏笔：', task.forbiddenPayoffs),
      fieldLine('本章结尾钩子：', task.endingHook),
      fieldLine('本章读者应该产生的情绪：', task.readerEmotion),
      fieldLine('本章预计字数：', task.targetWordCount),
      fieldLine('文风要求：', task.styleRequirement)
    ]
      .filter(Boolean)
      .join('\n')
    const taskWarnings = [
      ['本章目标', task.goal],
      ['本章必须推进的冲突', task.conflict],
      ['本章结尾钩子', task.endingHook],
      ['本章读者应该产生的情绪', task.readerEmotion]
    ]
      .filter(([, value]) => isPlaceholderText(value))
      .map(([label]) => `章节任务字段缺失：${label}`)

    const characterStateText = [
      '【角色状态账本切片】',
      formatCharacterStateLedgerSlice(characterSelection, characterStateFacts ?? [], contextNeedPlan, target),
      '【角色卡按需切片】',
      characterSelection.length
        ? characterSelection
            .map((character) =>
              contextNeedPlan ? formatCharacterNeedSlice(character, characterStateLogs, contextNeedPlan) : formatCharacter(character, characterStateLogs)
            )
            .join('\n\n')
        : ''
    ]
      .filter(Boolean)
      .join('\n\n')

    const recentChapterText = recentChapters
      .map((chapter) => {
        const compression = compressionByChapterId.get(chapter.id)
        const recap = compression ? formatCompressedChapterRecap(chapter, compression) : summarizeChapter(chapter, config.mode === 'full')
        return dedupeAgainstBridge(recap, continuity.bridge)
      })
      .filter(Boolean)
      .join('\n\n')

    const storyDirectionGuide = workingInput.storyDirectionGuide ?? null
    const storyDirectionText = StoryDirectionService.formatForPrompt(storyDirectionGuide, target)

    const remoteSummaryText = selectedSummaries.length
      ? selectedSummaries.map(formatStageSummary).join('\n\n')
      : ''

    const blocks: PromptBlockDraft[] = [
      {
        id: 'priority-rules',
        title: '0. 上下文冲突优先级规则',
        kind: 'priority_rules',
        priority: 0,
        source: 'prompt_builder',
        enabled: true,
        body: priorityRuleText(),
        reason: '先声明上下文权威顺序，防止低优先级设定或风格覆盖章节执行。'
      },
      {
        id: 'writing-task',
        title: '1. 写作任务声明',
        kind: 'writing_task',
        priority: 1,
        source: 'project',
        sourceIds: [project.id],
        enabled: true,
        body: `你是一名长篇小说续写助手。请严格续写《${project.name}》第 ${target} 章。写作时先接住上一章最后一幕，再执行本章任务契约，并优先保证角色硬状态、伏笔 treatmentMode、章节目标和长篇一致性。`,
        reason: '明确本次是章节续写任务，而不是资料整理或世界观扩写。'
      },
      {
        id: 'continuity-bridge',
        title: '2. 上一章结尾衔接 Bridge',
        kind: 'continuity_bridge',
        priority: 2,
        source: continuity.source ?? 'continuity_service',
        sourceIds: continuity.bridge ? [continuity.bridge.id] : [],
        enabled: config.useContinuityBridge !== false,
        body: formatContinuityBridgeForPrompt(continuity.bridge, config.continuityInstructions),
        forced: Boolean(continuity.bridge),
        reason: '正文开头必须直接承接上一章最后一幕，防止章节像重新启动。'
      },
      {
        id: 'chapter-task-contract',
        title: '3. 本章任务契约',
        kind: 'chapter_task',
        priority: 3,
        source: 'prompt_config',
        enabled: config.modules.chapterTask,
        body: taskText,
        reason: '本章目标、冲突、悬念、结尾钩子和情绪目标是正文执行契约。'
      },
      {
        id: 'character-hard-state',
        title: '4. 当前角色硬状态',
        kind: 'character_state',
        priority: 4,
        source: 'characters_and_state_ledger',
        sourceIds: characterSelection.map((character) => character.id),
        enabled: config.modules.characters,
        body: characterStateText,
        reason: '角色位置、伤势、物品、资源、知识、承诺和能力限制必须早于章节回顾进入模型。'
      },
      {
        id: 'foreshadowing-operation-rules',
        title: '5. 本章伏笔操作规则',
        kind: 'foreshadowing_rules',
        priority: 5,
        source: 'foreshadowing_treatment',
        sourceIds: foreshadowingSelection.map((item) => item.id),
        enabled: config.modules.foreshadowing,
        body: formatForeshadowingOperationTable(foreshadowingSelection, config),
        reason: '将 treatmentMode 转译为本章可暗示、可推进、可误导、可回收和禁止提及的操作表。'
      },
      {
        id: 'story-direction-guide',
        title: '6. 中期剧情导向 StoryDirectionGuide',
        kind: 'story_direction',
        priority: 6,
        source: 'story_direction_guides',
        sourceIds: storyDirectionGuide ? [storyDirectionGuide.id] : [],
        enabled: Boolean(storyDirectionGuide),
        body: storyDirectionText,
        reason: '提供未来 5/10 章的软性剧情推进方向；不得覆盖上一章衔接、本章任务、角色硬状态和伏笔规则。'
      },
      {
        id: 'current-progress',
        title: '6. 当前剧情状态',
        kind: 'current_progress',
        priority: 6,
        source: 'chapter_recaps',
        sourceIds: previousChapters.slice(-1).map((chapter) => chapter.id),
        enabled: config.modules.progress,
        body: dedupedLatestProgress,
        reason: '只提供当前位置的剧情状态，不抢占上一章衔接和任务契约。'
      },
      {
        id: 'recent-chapters',
        title: '7. 最近章节详细回顾',
        kind: 'recent_chapters',
        priority: 7,
        source: 'chapters',
        sourceIds: recentChapters.map((chapter) => chapter.id),
        enabled: config.modules.recentChapters,
        body: recentChapterText,
        compressed: recentChapters.some((chapter) => compressionByChapterId.has(chapter.id)),
        reason: '近期章节事实用于承接人物动作和信息差，但不得覆盖角色硬状态和伏笔规则。'
      },
      {
        id: 'remote-compressed-summary',
        title: '8. 远期压缩摘要',
        kind: 'remote_summary',
        priority: 8,
        source: 'stage_summaries',
        sourceIds: selectedSummaries.map((summary) => summary.id),
        enabled: config.modules.stageSummaries,
        body: remoteSummaryText,
        compressed: Boolean(budgetSelection?.compressionRecords.length),
        reason: '远期历史以阶段摘要和压缩摘要形式提供脉络，避免旧章节详细信息挤占预算。'
      },
      {
        id: 'timeline-events',
        title: '9. 时间线事件',
        kind: 'timeline',
        priority: 9,
        source: 'timeline_events',
        sourceIds: timelineEvents.map((event) => event.id),
        enabled: config.modules.timeline,
        body: formatTimeline(timelineEvents, target) || '暂无时间线事件。',
        reason: '时间线只作为校验参考，不能覆盖更高优先级的章节任务和角色硬状态。'
      },
      {
        id: 'hard-canon-pack',
        title: '10. 最小硬设定 HardCanonPack',
        kind: 'hard_canon',
        priority: 10,
        source: 'story_bible',
        sourceIds: bible ? [bible.projectId] : [],
        enabled: config.modules.bible,
        body: hardCanonText,
        reason: '只保留不可违背规则和本章强相关硬设定，避免大段世界观置顶诱导重复解释。'
      },
      {
        id: 'style-envelope',
        title: '11. 风格要求 StyleEnvelope',
        kind: 'style',
        priority: 11,
        source: 'story_bible_style',
        sourceIds: bible ? [bible.projectId] : [],
        enabled: config.modules.bible,
        body: styleEnvelopeText,
        reason: '风格作为表达滤镜后置，不得压过剧情执行、连续性和硬状态。'
      },
      {
        id: 'forbidden-novelty-policy',
        title: '12. 禁止事项与 NoveltyPolicy',
        kind: 'forbidden_and_novelty',
        priority: 12,
        source: 'story_bible_and_task',
        sourceIds: bible ? [bible.projectId] : [],
        enabled: config.modules.forbidden,
        body: [
          fieldLine('禁用套路：', bible?.bannedTropes),
          fieldLine('不可违背设定：', bible?.immutableFacts),
          fieldLine('禁止提前回收：', task.forbiddenPayoffs),
          '不得让已明确的角色认知突然消失；不得无铺垫改变力量体系规则；不得把阶段摘要已经归档的信息重新写成新发现。',
          'NoveltyPolicy：不得新增未铺垫救命规则、临时系统权限、新管理员层级、新核心机制或给未知人物随意命名，除非本章任务明确允许。',
          '不得为了让主角脱困而临时新增刚好可用的规则；解决危机必须来自已提供规则、已铺垫伏笔、角色已有能力或本章任务明确允许的机制。',
          '新规则如果出现，必须带来代价或更大风险，不能只提供便利；不得把“系统面板补充条款”当作无代价救命工具。',
          '副本规则不得在没有公告、记录、前文线索或任务书许可的情况下突然展开；新管理员 / 新组织层级出现时，必须有前文信号或任务书许可。',
          '不得新增未授权命名角色；不得给未知人物擅自命名，除非任务书允许或正文解释系统识别来源。',
          '不得提前解释 hidden / pause 状态伏笔；不得将未授权新设定写成已经存在的长期事实。'
        ].join('\n'),
        reason: '集中放置禁止事项和新增设定约束，防止机械降神或记忆污染。'
      },
      {
        id: 'output-format',
        title: '13. 输出格式要求',
        kind: 'output_format',
        priority: 13,
        source: 'prompt_builder',
        enabled: config.modules.outputFormat,
        body: [
          `请直接输出第 ${target} 章正文。`,
          '保留清晰场景推进、人物动作、对话和心理变化。',
          '章节结尾必须形成钩子，但不要用作者说明替代正文。',
          '不得新增无铺垫救命规则、临时权限、新管理员、新组织层级或新核心机制；所有新规则必须来自已有线索、本章任务许可，并带来代价或更大风险。',
          '不要输出大纲、分析、注释或 Markdown 标题，除非用户另行要求。'
        ].join('\n'),
        reason: '最后限定输出形态，避免模型输出分析、任务书或 Markdown 大纲。'
      }
    ]

    const finalPrompt = [`# 第 ${target} 章写作 Prompt`, ...blocks.map(renderPromptBlock)]
      .filter(Boolean)
      .join('\n')
      .trim()
    const promptBlockOrder = blocks.map(blockToOrderItem)

    return {
      finalPrompt,
      estimatedTokens: TokenEstimator.estimate(finalPrompt),
      promptBlockOrder,
      contextSelectionResult: budgetSelection as ContextSelectionResult | null,
      selectedCharacterIds: config.selectedCharacterIds,
      selectedForeshadowingIds: config.selectedForeshadowingIds,
      foreshadowingTreatmentOverrides: config.foreshadowingTreatmentOverrides ?? {},
      chapterTask: config.task,
      contextNeedPlan,
      storyDirectionGuide,
      continuityBridge: continuity.bridge,
      continuitySource: continuity.source,
      compressionRecords: budgetSelection?.compressionRecords ?? [],
      warnings: [...(budgetSelection?.warnings ?? []), ...continuity.warnings, ...taskWarnings]
    }
  }

  static build(input: PromptBuildInput): string {
    return PromptBuilderService.buildResult(input).finalPrompt
  }
}
