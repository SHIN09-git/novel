import type {
  Character,
  CharacterStateLog,
  Chapter,
  ChapterContinuityBridge,
  ContinuitySource,
  Foreshadowing,
  ID,
  ContextBudgetProfile,
  ContextSelectionResult,
  BuildPromptResult,
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

function valueOrEmpty(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '待补充'
  return String(value)
}

function section(title: string, enabled: boolean, body: string): string {
  if (!enabled) return ''
  return `## ${title}\n${body.trim() || '待补充'}\n`
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
    `结尾钩子：${valueOrEmpty(chapter.endingHook)}`,
    `风险提醒：${valueOrEmpty(chapter.riskWarnings)}`
  ]

  if (includeBody && chapter.body.trim()) {
    lines.push(`正文摘录：\n${chapter.body.trim().slice(0, 1200)}`)
  }

  return lines.join('\n')
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
    `角色定位：${valueOrEmpty(character.role)}`,
    `表层目标：${valueOrEmpty(character.surfaceGoal)}`,
    `深层欲望：${valueOrEmpty(character.deepDesire)}`,
    `核心恐惧：${valueOrEmpty(character.coreFear)}`,
    `自我欺骗：${valueOrEmpty(character.selfDeception)}`,
    `当前知道的信息：${valueOrEmpty(character.knownInformation)}`,
    `当前不知道的信息：${valueOrEmpty(character.unknownInformation)}`,
    `与主角关系状态：${valueOrEmpty(character.protagonistRelationship)}`,
    `当前情绪状态：${valueOrEmpty(character.emotionalState)}`,
    `下一阶段行为倾向：${valueOrEmpty(character.nextActionTendency)}`,
    `禁止写法：${valueOrEmpty(character.forbiddenWriting)}`,
    `最近一次变化章节：${valueOrEmpty(character.lastChangedChapter)}`
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
        foreshadowingIds: input.config.selectedForeshadowingIds
      }
    )
  }

  static buildResult(input: PromptBuildInput): BuildPromptResult {
    let workingInput = input
    const budgetSelection = input.budgetProfile ? PromptBuilderService.selectBudgetContext(input, input.budgetProfile) : null

    if (budgetSelection) {
      const selectedCharacterIds = new Set([...budgetSelection.selectedCharacterIds, ...input.config.selectedCharacterIds])
      const selectedForeshadowingIds = new Set([...budgetSelection.selectedForeshadowingIds, ...input.config.selectedForeshadowingIds])
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

    const { project, bible, chapters, characters, characterStateLogs, foreshadowings, timelineEvents, stageSummaries, config } =
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
    const recentChapters = previousChapters.slice(config.mode === 'light' ? -2 : -3)
    const summaries = [...stageSummaries]
      .filter((summary) => summary.chapterEnd < target)
      .sort((a, b) => a.chapterStart - b.chapterStart)
    const selectedSummaries = config.mode === 'full' ? summaries : summaries.slice(-2)
    const foreshadowingSelection = selectedForeshadowings(foreshadowings, target, config)
    const characterSelection = uniqueById(selectedCharacters(characters, foreshadowingSelection, config))

    const styleLimit = input.budgetProfile?.styleSampleMaxChars ?? styleSampleLimit(config.mode)
    const styleSample = bible?.styleSample ? truncateText(bible.styleSample, styleLimit) : ''
    const bibleText = bible
      ? [
          `项目名：${project.name}`,
          `项目简介：${valueOrEmpty(project.description)}`,
          `类型/题材：${valueOrEmpty(project.genre)}`,
          `目标读者：${valueOrEmpty(project.targetReaders)}`,
          `核心爽点/情绪体验：${valueOrEmpty(project.coreAppeal)}`,
          `整体风格：${valueOrEmpty(project.style)}`,
          `世界观基础设定：${valueOrEmpty(bible.worldbuilding)}`,
          `故事核心命题：${valueOrEmpty(bible.corePremise)}`,
          `主角核心欲望：${valueOrEmpty(bible.protagonistDesire)}`,
          `主角核心恐惧：${valueOrEmpty(bible.protagonistFear)}`,
          `主线冲突：${valueOrEmpty(bible.mainConflict)}`,
          `力量体系/规则体系：${valueOrEmpty(bible.powerSystem)}`,
          `叙事基调：${valueOrEmpty(bible.narrativeTone)}`,
          `文风样例：${styleSample || '待补充'}`,
          `重要不可违背设定：${valueOrEmpty(bible.immutableFacts)}`
        ].join('\n')
      : '尚未填写小说圣经。'

    const latestProgress =
      previousChapters
        .slice(-1)
        .map((chapter) => `截至第 ${chapter.order} 章：${chapter.summary || '待补充最近章节摘要。'}`)
        .join('\n') || '暂无最近章节摘要，请先填写章节复盘。'

    const task = config.task
    const taskText = [
      `本章目标：${valueOrEmpty(task.goal)}`,
      `本章必须推进的冲突：${valueOrEmpty(task.conflict)}`,
      `本章必须保留的悬念：${valueOrEmpty(task.suspenseToKeep)}`,
      `本章允许回收的伏笔：${valueOrEmpty(task.allowedPayoffs)}`,
      `本章禁止回收的伏笔：${valueOrEmpty(task.forbiddenPayoffs)}`,
      `本章结尾钩子：${valueOrEmpty(task.endingHook)}`,
      `本章读者应该产生的情绪：${valueOrEmpty(task.readerEmotion)}`,
      `本章预计字数：${valueOrEmpty(task.targetWordCount)}`,
      `文风要求：${valueOrEmpty(task.styleRequirement)}`
    ].join('\n')

    const finalPrompt = [
      `# 第 ${target} 章写作 Prompt`,
      section(
        'A. 写作任务声明',
        true,
        `你是一名长篇小说续写助手。请基于以下经过筛选的长期设定、阶段摘要、角色当前状态和本章任务书，续写《${project.name}》第 ${target} 章。优先保证长篇一致性、角色状态连续、伏笔不漂移、章节目标清晰。`
      ),
      section('B. 全书核心设定摘要', config.modules.bible, bibleText),
      section('C. 当前剧情进度摘要', config.modules.progress, latestProgress),
      section(
        'C1. 上一章结尾衔接',
        config.useContinuityBridge !== false,
        formatContinuityBridgeForPrompt(continuity.bridge, config.continuityInstructions)
      ),
      section(
        'C2. 阶段摘要档案',
        config.modules.stageSummaries,
        selectedSummaries.length
          ? selectedSummaries.map(formatStageSummary).join('\n\n')
          : '暂无阶段摘要档案。标准模式默认保留最近 2 个阶段摘要，完整模式保留全部阶段摘要。'
      ),
      section(
        'D. 最近 1-3 章详细回顾',
        config.modules.recentChapters,
        recentChapters.map((chapter) => summarizeChapter(chapter, config.mode === 'full')).join('\n\n')
      ),
      section(
        'E. 主要角色当前状态',
        config.modules.characters,
        characterSelection.length
          ? characterSelection.map((character) => formatCharacter(character, characterStateLogs)).join('\n\n')
          : '暂无主要角色或本章相关角色。'
      ),
      section(
        'F. 当前相关伏笔',
        config.modules.foreshadowing,
        foreshadowingSelection.length
          ? foreshadowingSelection.map((item) => formatForeshadowing(item, config.foreshadowingTreatmentOverrides)).join('\n\n')
          : '暂无需要进入本章 prompt 的未回收中/高权重伏笔。'
      ),
      section('G. 当前章节任务书', config.modules.chapterTask, taskText),
      section(
        'H. 本章禁止事项',
        config.modules.forbidden,
        [
          `禁用套路：${bible?.bannedTropes || '待补充'}`,
          `不可违背设定：${bible?.immutableFacts || '待补充'}`,
          `禁止提前回收：${task.forbiddenPayoffs || '待补充'}`,
          '不得让已明确的角色认知突然消失；不得无铺垫改变力量体系规则；不得把阶段摘要已经归档的信息重新写成新发现。'
        ].join('\n')
      ),
      section(
        'I. 输出格式要求',
        config.modules.outputFormat,
        [
          `请直接输出第 ${target} 章正文。`,
          '保留清晰场景推进、人物动作、对话和心理变化。',
          '章节结尾必须形成钩子，但不要用作者说明替代正文。',
          '不要输出大纲、分析、注释或 Markdown 标题，除非用户另行要求。'
        ].join('\n')
      ),
      section('附加：时间线校验', config.modules.timeline, formatTimeline(timelineEvents, target) || '暂无时间线事件。')
    ]
      .filter(Boolean)
      .join('\n')
      .trim()

    return {
      finalPrompt,
      estimatedTokens: TokenEstimator.estimate(finalPrompt),
      contextSelectionResult: budgetSelection as ContextSelectionResult | null,
      selectedCharacterIds: config.selectedCharacterIds,
      selectedForeshadowingIds: config.selectedForeshadowingIds,
      foreshadowingTreatmentOverrides: config.foreshadowingTreatmentOverrides ?? {},
      chapterTask: config.task,
      continuityBridge: continuity.bridge,
      continuitySource: continuity.source,
      warnings: [...(budgetSelection?.warnings ?? []), ...continuity.warnings]
    }
  }

  static build(input: PromptBuildInput): string {
    return PromptBuilderService.buildResult(input).finalPrompt
  }
}
