import type {
  BuildPromptResult,
  ChapterContinuityBridge,
  ContinuitySource,
  ContextBudgetProfile,
  ContextSelectionResult,
  PromptBlockOrderItem,
  PromptBuildInput
} from '../shared/types'
import { ContextBudgetManager } from './ContextBudgetManager'
import { formatContinuityBridgeForPrompt, resolveContinuityBridge } from './ContinuityService'
import { TokenEstimator } from './TokenEstimator'
import { StoryDirectionService } from './StoryDirectionService'
import { HardCanonPackService } from './HardCanonPackService'
import { PromptLintService } from './PromptLintService'
import { activeChapters } from './ChapterLifecycleService'
import { dedupeAgainstBridge, formatCompressedChapterRecap, formatStageSummary, formatTimeline, summarizeChapter } from './promptFormatters/chapterFormatters'
import { formatCharacter, formatCharacterNeedSlice, formatCharacterStateLedgerSlice } from './promptFormatters/characterFormatters'
import { formatForeshadowingOperationTable, selectedCharacters, selectedForeshadowings, uniqueById } from './promptFormatters/foreshadowingFormatters'
import { chapterNoveltyPolicyLines, fieldLine, filterPromptLinesByExclusionText, isPlaceholderText, priorityRuleText, promptBlockOrderFromFinalPrompt, renderPromptBlock, styleSampleLimit, truncateText, valueOrEmpty, formatStyleEnvelope, type PromptBlockDraft } from './promptFormatters/promptUtils'
export { inferPromptBlockOrderFromPrompt, parseChapterNumbersFromText } from './promptFormatters/promptUtils'
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
        contextNeedPlan: input.contextNeedPlan ?? null,
        selectionMode: 'explicit'
      }
    )
  }

  static buildResult(input: PromptBuildInput): BuildPromptResult {
    input = { ...input, chapters: activeChapters(input.chapters) }
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

    const task = config.task
    const isOpeningChapter = target === 1
    const styleLimit = input.budgetProfile?.styleSampleMaxChars ?? styleSampleLimit(config.mode)
    const styleSample = bible?.styleSample ? truncateText(bible.styleSample, styleLimit) : ''
    const allowedHardCanonItemIds = contextNeedPlan
      ? (contextNeedPlan.contextNeeds ?? [])
          .filter((need) => need.sourceHint === 'hardCanon' && Boolean(need.sourceId))
          .map((need) => need.sourceId as string)
      : undefined
    const hardCanonPrompt = HardCanonPackService.compressHardCanonPackForPrompt(workingInput.hardCanonPack ?? null, {
      exclusionText: task.forbiddenPayoffs,
      allowedItemIds: allowedHardCanonItemIds,
      isOpeningChapter
    })
    const styleEnvelopeFilter = filterPromptLinesByExclusionText(
      formatStyleEnvelope(project, bible, styleSample, isOpeningChapter),
      task.forbiddenPayoffs
    )
    const styleEnvelopeText = styleEnvelopeFilter.text
    const latestProgress =
      previousChapters
        .slice(-1)
        .map((chapter) => (valueOrEmpty(chapter.summary) ? `截至第 ${chapter.order} 章：${valueOrEmpty(chapter.summary)}` : ''))
        .filter(Boolean)
        .join('\n')
    const dedupedLatestProgress = dedupeAgainstBridge(latestProgress, continuity.bridge)

    const taskText = [
      fieldLine('本章目标：', task.goal),
      fieldLine('本章必须推进的冲突：', task.conflict),
      fieldLine(isOpeningChapter ? '本章信息边界：' : '本章必须保留的悬念：', task.suspenseToKeep),
      fieldLine(isOpeningChapter ? '本章唯一允许出现的信息：' : '本章允许回收的伏笔：', task.allowedPayoffs),
      fieldLine(isOpeningChapter ? '本章禁止调用的既有资料：' : '本章禁止回收的伏笔：', task.forbiddenPayoffs),
      fieldLine(isOpeningChapter ? '本章结尾收束：' : '本章结尾钩子：', task.endingHook),
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

    const characterCardText = characterSelection.length
      ? characterSelection
          .map((character) =>
            contextNeedPlan ? formatCharacterNeedSlice(character, characterStateLogs, contextNeedPlan) : formatCharacter(character, characterStateLogs)
          )
          .join('\n\n')
      : ''
    const rawCharacterStateText = (isOpeningChapter
      ? [
          '【本章任务点名人物】',
          characterCardText
        ]
      : [
          '【角色状态账本切片】',
          formatCharacterStateLedgerSlice(characterSelection, characterStateFacts ?? [], contextNeedPlan, target),
          '【角色卡按需切片】',
          characterCardText
        ])
      .filter(Boolean)
      .join('\n\n')
    const characterStateFilter = filterPromptLinesByExclusionText(rawCharacterStateText, task.forbiddenPayoffs)
    const characterStateText = characterStateFilter.text

    const recentChapterText = recentChapters
      .map((chapter) => {
        const compression = compressionByChapterId.get(chapter.id)
        const recap = compression ? formatCompressedChapterRecap(chapter, compression) : summarizeChapter(chapter, config.mode === 'full')
        return dedupeAgainstBridge(recap, continuity.bridge)
      })
      .filter(Boolean)
      .join('\n\n')

    const storyDirectionGuide = workingInput.storyDirectionGuide ?? null
    // The service also supports standalone rendering, where it owns the heading.
    // Here the surrounding prompt block already owns that heading.
    const storyDirectionText = StoryDirectionService.formatForPrompt(storyDirectionGuide, target).replace(/^##\s+[^\r\n]+\r?\n?/u, '')

    const remoteSummaryText = selectedSummaries.length
      ? selectedSummaries.map(formatStageSummary).join('\n\n')
      : ''
    const timelineText = formatTimeline(timelineEvents, target)
    const legacyForbiddenPolicyFilter = filterPromptLinesByExclusionText(
      [fieldLine('禁用套路：', bible?.bannedTropes), fieldLine('不可违背设定：', bible?.immutableFacts)]
        .filter(Boolean)
        .join('\n'),
      task.forbiddenPayoffs
    )
    const noveltyPolicyLines = chapterNoveltyPolicyLines(isOpeningChapter)
    const forbiddenPolicyText = [
      legacyForbiddenPolicyFilter.text,
      '本章具体禁止回收项以第 3 节任务契约原文为准；本节不重复展开，避免把禁写内容误当作可用素材。',
      isOpeningChapter ? '不得补造任务未提供的既往认知、力量规则或阶段进度；未写入任务契约的旧资料一律视为不可用。' : '不得让已明确的角色认知突然消失；不得无铺垫改变力量体系规则；不得把阶段摘要已经归档的信息重新写成新发现。',
      ...noveltyPolicyLines
    ]
      .filter(Boolean)
      .join('\n')

    const blocks: PromptBlockDraft[] = [
      {
        id: 'priority-rules',
        title: '0. 上下文冲突优先级规则',
        kind: 'priority_rules',
        priority: 0,
        source: 'prompt_builder',
        enabled: true,
        body: priorityRuleText(isOpeningChapter),
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
        body: isOpeningChapter
          ? '你是一名长篇小说作者。请创作本项目第一章。直接从本章任务指定的场景自然开场；不存在上一章，不得伪造前情、未发生动作或需要承接的钩子。优先执行本章任务契约，并维持人物关系、信息边界、章节目标和长篇一致性。'
          : `你是一名长篇小说续写助手。请严格续写《${project.name}》第 ${target} 章。写作时先接住上一章最后一幕，再执行本章任务契约，并优先保证角色硬状态、伏笔 treatmentMode、章节目标和长篇一致性。`,
        reason: isOpeningChapter ? '明确本次是第一章创作任务，并禁止模型伪造不存在的前情。' : '明确本次是章节续写任务，而不是资料整理或世界观扩写。'
      },
      {
        id: 'continuity-bridge',
        title: '2. 上一章结尾衔接 Bridge',
        kind: 'continuity_bridge',
        priority: 2,
        source: continuity.source ?? 'continuity_service',
        sourceIds: continuity.bridge ? [continuity.bridge.id] : [],
        enabled: !isOpeningChapter && config.useContinuityBridge !== false,
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
        id: 'hard-canon-pack',
        title: '4. 不可违背设定 HardCanonPack',
        kind: 'hard_canon',
        priority: 4,
        source: 'hard_canon_packs',
        sourceIds: hardCanonPrompt.includedItemIds,
        enabled: hardCanonPrompt.itemCount > 0,
        body: hardCanonPrompt.body,
        reason: isOpeningChapter
          ? '用户维护的不可违背硬设定，高于普通摘要和模型临时发挥；不得覆盖第一章自然开场、本章任务、角色状态和伏笔规则。'
          : '用户维护的不可违背硬设定，高于普通摘要、旧章节回顾和模型临时发挥；不得静默覆盖上一章衔接、本章任务、角色硬状态和伏笔规则。'
      },
      {
        id: 'character-hard-state',
        title: isOpeningChapter ? '5. 本章任务点名人物' : '5. 当前角色硬状态',
        kind: 'character_state',
        priority: 5,
        source: isOpeningChapter ? 'authoritative_chapter_task' : 'characters_and_state_ledger',
        sourceIds: characterSelection.map((character) => character.id),
        enabled: config.modules.characters,
        body: characterStateText,
        reason: isOpeningChapter
          ? '第一章只提供任务点名人物的最小身份，不承接旧人物状态或后续剧情功能。'
          : '角色位置、伤势、物品、资源、知识、承诺和能力限制必须早于章节回顾进入模型。'
      },
      {
        id: 'foreshadowing-operation-rules',
        title: '6. 本章伏笔操作规则',
        kind: 'foreshadowing_rules',
        priority: 6,
        source: 'foreshadowing_treatment',
        sourceIds: foreshadowingSelection.map((item) => item.id),
        enabled: config.modules.foreshadowing,
        body: formatForeshadowingOperationTable(foreshadowingSelection, config),
        reason: '将 treatmentMode 转译为本章可暗示、可推进、可误导、可回收和禁止提及的操作表。'
      },
      {
        id: 'story-direction-guide',
        title: '7. 中期剧情导向 StoryDirectionGuide',
        kind: 'story_direction',
        priority: 7,
        source: 'story_direction_guides',
        sourceIds: storyDirectionGuide ? [storyDirectionGuide.id] : [],
        enabled: Boolean(storyDirectionGuide),
        body: storyDirectionText,
        reason: '提供未来 5/10 章的软性剧情推进方向；不得覆盖上一章衔接、本章任务、角色硬状态和伏笔规则。'
      },
      {
        id: 'current-progress',
        title: '8. 当前剧情状态',
        kind: 'current_progress',
        priority: 8,
        source: 'chapter_recaps',
        sourceIds: previousChapters.slice(-1).map((chapter) => chapter.id),
        enabled: config.modules.progress,
        body: dedupedLatestProgress,
        reason: '只提供当前位置的剧情状态，不抢占上一章衔接和任务契约。'
      },
      {
        id: 'recent-chapters',
        title: '9. 最近章节详细回顾',
        kind: 'recent_chapters',
        priority: 9,
        source: 'chapters',
        sourceIds: recentChapters.map((chapter) => chapter.id),
        enabled: config.modules.recentChapters,
        body: recentChapterText,
        compressed: recentChapters.some((chapter) => compressionByChapterId.has(chapter.id)),
        reason: '近期章节事实用于承接人物动作和信息差，但不得覆盖角色硬状态和伏笔规则。'
      },
      {
        id: 'remote-compressed-summary',
        title: '10. 远期压缩摘要',
        kind: 'remote_summary',
        priority: 10,
        source: 'stage_summaries',
        sourceIds: selectedSummaries.map((summary) => summary.id),
        enabled: config.modules.stageSummaries,
        body: remoteSummaryText,
        compressed: Boolean(budgetSelection?.compressionRecords.length),
        reason: '远期历史以阶段摘要和压缩摘要形式提供脉络，避免旧章节详细信息挤占预算。'
      },
      {
        id: 'timeline-events',
        title: '11. 时间线事件',
        kind: 'timeline',
        priority: 11,
        source: 'timeline_events',
        sourceIds: timelineEvents.map((event) => event.id),
        enabled: config.modules.timeline && Boolean(timelineText),
        body: timelineText,
        reason: '时间线只作为校验参考，不能覆盖更高优先级的章节任务和角色硬状态。'
      },
      {
        id: 'style-envelope',
        title: '12. 风格要求 StyleEnvelope',
        kind: 'style',
        priority: 12,
        source: 'story_bible_style',
        sourceIds: bible ? [bible.projectId] : [],
        enabled: config.modules.bible && Boolean(styleEnvelopeText),
        body: styleEnvelopeText,
        reason: '风格作为表达滤镜后置，不得压过剧情执行、连续性和硬状态。'
      },
      {
        id: 'forbidden-novelty-policy',
        title: '13. 写作限制与 NoveltyPolicy',
        kind: 'forbidden_and_novelty',
        priority: 13,
        source: 'story_bible_and_task',
        sourceIds: bible ? [bible.projectId] : [],
        enabled: config.modules.forbidden && Boolean(forbiddenPolicyText),
        body: forbiddenPolicyText,
        reason: '集中放置禁止事项和新增设定约束，防止机械降神或记忆污染。'
      },
      {
        id: 'output-format',
        title: '14. 输出格式要求',
        kind: 'output_format',
        priority: 14,
        source: 'prompt_builder',
        enabled: config.modules.outputFormat,
        body: [
          `请直接输出第 ${target} 章正文。`,
          '保留清晰场景推进、人物动作、对话和心理变化。',
          isOpeningChapter
            ? '章节结尾只执行任务契约指定的生活动作与信息边界，不额外强化危险、宿命或网文式钩子。'
            : '章节结尾必须形成任务指定的钩子，但不要用作者说明替代正文。',
          '不要输出大纲、分析、注释或 Markdown 标题，除非用户另行要求。'
        ].join('\n'),
        reason: '最后限定输出形态，避免模型输出分析、任务书或 Markdown 大纲。'
      }
    ]

    const rawPrompt = [`# 第 ${target} 章写作 Prompt`, ...blocks.map(renderPromptBlock)]
      .filter(Boolean)
      .join('\n')
      .trim()
    const promptLintGuard = PromptLintService.guardWritingPrompt(rawPrompt)
    const finalPrompt = promptLintGuard.guardedPrompt
    const promptBlockOrder = promptBlockOrderFromFinalPrompt(blocks, finalPrompt)

    return {
      finalPrompt,
      estimatedTokens: promptLintGuard.result.guardedTokenEstimate,
      promptBlockOrder,
      contextSelectionResult: budgetSelection as ContextSelectionResult | null,
      selectedCharacterIds: config.selectedCharacterIds,
      selectedForeshadowingIds: config.selectedForeshadowingIds,
      foreshadowingTreatmentOverrides: config.foreshadowingTreatmentOverrides ?? {},
      chapterTask: config.task,
      contextNeedPlan,
      storyDirectionGuide,
      hardCanonPrompt,
      continuityBridge: continuity.bridge,
      continuitySource: continuity.source,
      compressionRecords: budgetSelection?.compressionRecords ?? [],
      promptLintResult: promptLintGuard.result,
      warnings: [
        ...(budgetSelection?.warnings ?? []),
        ...(isOpeningChapter ? [] : continuity.warnings),
        ...taskWarnings,
        ...(characterStateFilter.omittedLineCount
          ? [`本章禁止项已从角色卡/状态账本切片隔离 ${characterStateFilter.omittedLineCount} 行（${characterStateFilter.matchedTerms.join('、')}）。`]
          : []),
        ...(styleEnvelopeFilter.omittedLineCount
          ? [`本章禁止项已从风格包络隔离 ${styleEnvelopeFilter.omittedLineCount} 行（${styleEnvelopeFilter.matchedTerms.join('、')}）。`]
          : []),
        ...(legacyForbiddenPolicyFilter.omittedLineCount
          ? [`本章禁止项已从旧版 StoryBible 禁止/硬设定字段隔离 ${legacyForbiddenPolicyFilter.omittedLineCount} 行（${legacyForbiddenPolicyFilter.matchedTerms.join('、')}）。`]
          : []),
        ...hardCanonPrompt.warnings,
        ...promptLintGuard.result.warnings
      ]
    }
  }

  static build(input: PromptBuildInput): string {
    return PromptBuilderService.buildResult(input).finalPrompt
  }
}
