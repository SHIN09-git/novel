import type {
  ChapterTask,
  Character,
  CharacterCardField,
  CharacterNeedInvolvement,
  ContextNeedItem,
  ContextNeedPlan,
  ContextRetrievalPriorityType,
  ContinuityCheckCategory,
  ExpectedPresence,
  ExpectedSceneType,
  ID,
  StateFactCategory
} from '../shared/types'
import { isForeshadowingAvailableAtChapter } from '../shared/foreshadowingTreatment'
import { StoryDirectionService } from './StoryDirectionService'
import { buildCharacterNeedPlanSlice } from './contextNeedPlanner/characterNeeds'
import type { BuildNeedPlanInput } from './contextNeedPlanner/types'
import {
  combinedTaskText,
  containsAny,
  contextNeed,
  foreshadowingNeedPriority,
  foreshadowingNeedReason,
  hardCanonMatchesTask,
  hardCanonNeedPriority,
  hardCanonNeedReason,
  inferContinuityChecks,
  inferRequiredCharacterFields as inferRequiredCharacterFieldsFromRules,
  inferRequiredStateCategories as inferRequiredStateCategoriesFromRules,
  inferSceneType,
  negativeTaskText,
  newNeedPlanId,
  nowIso,
  priorityLevel,
  scoreRetrievalPriority as scoreRetrievalPriorityFromRules,
  textMentions,
  textValue,
  timelineNeedReason,
  unique,
  uniqueByKey
} from './contextNeedPlanner/rules'

export class ContextNeedPlannerService {
  static buildFromChapterIntent(input: BuildNeedPlanInput): ContextNeedPlan {
    const timestamp = nowIso()
    const isolateOpeningLegacyContext = Boolean(input.isolateOpeningLegacyContext && input.targetChapterOrder === 1)
    const availableTimelineEvents = isolateOpeningLegacyContext ? [] : input.timelineEvents
    const availableStageSummaries = isolateOpeningLegacyContext ? [] : input.stageSummaries
    const availableForeshadowings = isolateOpeningLegacyContext
      ? []
      : input.foreshadowing.filter((item) => isForeshadowingAvailableAtChapter(item, input.targetChapterOrder))
    const availableHardCanonItems = isolateOpeningLegacyContext ? [] : (input.hardCanonItems ?? [])
    const taskOnlyText = combinedTaskText(input.chapterTaskDraft)
    const freeformNegativeText = negativeTaskText(input.chapterTaskDraft)
    const forbiddenText = [textValue(input.chapterTaskDraft.forbiddenPayoffs), freeformNegativeText].filter(Boolean).join('\n')
    const storyDirectionText = isolateOpeningLegacyContext
      ? ''
      : input.storyDirectionPromptText ?? StoryDirectionService.formatForPrompt(input.storyDirectionGuide ?? null, input.targetChapterOrder)
    const continuityBridge = isolateOpeningLegacyContext ? null : input.continuityBridge
    const continuityCharacterText = continuityBridge
      ? [
          continuityBridge.lastUnresolvedAction,
          continuityBridge.lastDialogueOrThought,
          continuityBridge.immediateNextBeat,
          continuityBridge.openMicroTensions
        ]
          .map(textValue)
          .filter(Boolean)
          .join('\n')
      : ''
    const positiveCharacterText = [taskOnlyText, storyDirectionText, continuityCharacterText].filter(Boolean).join('\n')
    const positivelyRequiredCharacterIds = new Set(
      input.characters.filter((item) => textMentions(positiveCharacterText, item.name)).map((item) => item.id)
    )
    const excludedCharacterIds = new Set(
      input.characters
        .filter((item) => textMentions(forbiddenText, item.name) && !positivelyRequiredCharacterIds.has(item.id))
        .map((item) => item.id)
    )
    const forbidsAllForeshadowing = /(?:不|禁)(?:止)?(?:调用|使用|推进|回收|出现|写入|提及)?任何(?:现有|案件)?伏笔|任何(?:现有|案件)?伏笔(?:均|都)?不得/u.test(forbiddenText)
    const forbiddenForeshadowingIds = availableForeshadowings
      .filter((item) => forbidsAllForeshadowing || item.treatmentMode === 'hidden' || item.treatmentMode === 'pause' || textMentions(forbiddenText, item.title))
      .map((item) => item.id)
    const forbiddenForeshadowingIdSet = new Set(forbiddenForeshadowingIds)
    const taskText = [taskOnlyText, storyDirectionText].map(textValue).filter(Boolean).join('\n')
    const storyDirectionBeat = input.storyDirectionGuide
      ? StoryDirectionService.getBeatForChapter(input.storyDirectionGuide, input.targetChapterOrder)
      : null
    const sceneType = inferSceneType(input.chapterTaskDraft, continuityBridge)
    const relatedCharacterIds = new Set<ID>()

    for (const item of availableForeshadowings) {
      if (!forbiddenForeshadowingIdSet.has(item.id) && (textMentions(taskText, item.title) || textMentions(input.chapterTaskDraft.allowedPayoffs ?? '', item.title))) {
        item.relatedCharacterIds.filter((id) => !excludedCharacterIds.has(id)).forEach((id) => relatedCharacterIds.add(id))
      }
    }

    const characterNeedSlice = buildCharacterNeedPlanSlice({
      characters: input.characters.filter((item) =>
        !excludedCharacterIds.has(item.id) && (!isolateOpeningLegacyContext || positivelyRequiredCharacterIds.has(item.id))
      ),
      taskText: taskOnlyText,
      storyDirectionText,
      continuityBridge,
      relatedCharacterIds,
      limit: 8,
      chapterTaskDraft: input.chapterTaskDraft,
      sceneType,
      characterStateFacts: input.characterStateFacts
    })
    const expectedCharacters = characterNeedSlice.expectedCharacters
    const requiredCharacterCardFields = characterNeedSlice.requiredCharacterCardFields
    const requiredStateFactCategories = isolateOpeningLegacyContext ? {} : characterNeedSlice.requiredStateFactCategories

    const requiredForeshadowingIds = availableForeshadowings
      .filter((item) => item.status !== 'resolved' && item.status !== 'abandoned')
      .filter((item) => !forbiddenForeshadowingIdSet.has(item.id))
      .filter((item) =>
        item.treatmentMode === 'payoff' ||
        item.treatmentMode === 'advance' ||
        item.treatmentMode === 'mislead' ||
        textMentions(taskText, item.title) ||
        textMentions(input.chapterTaskDraft.allowedPayoffs ?? '', item.title)
      )
      .map((item) => item.id)

    const timelineRelevantCharacterIds = new Set(characterNeedSlice.timelineRelevantCharacterIds)
    const requiredTimelineEventIds = availableTimelineEvents
      .filter((event) => event.chapterOrder === null || event.chapterOrder < input.targetChapterOrder)
      .filter((event) => textMentions(taskText, event.title) || event.participantCharacterIds.some((id) => timelineRelevantCharacterIds.has(id)))
      .slice(-6)
      .map((event) => event.id)

    const requiredWorldbuildingKeys = unique([
      input.storyBible?.powerSystem && containsAny(taskText, ['力量', '规则', '能力', '系统']) ? 'powerSystem' : '',
      input.storyBible?.worldbuilding && containsAny(taskText, ['城市', '世界', '地点', '组织', '规则']) ? 'worldbuilding' : '',
      input.storyBible?.immutableFacts ? 'immutableFacts' : '',
      input.storyBible?.mainConflict && containsAny(taskText, ['主线', '冲突', '敌人', '目标']) ? 'mainConflict' : ''
    ].filter(Boolean))

    const mustCheckContinuity = inferContinuityChecks(input.chapterTaskDraft, sceneType, continuityBridge)

    const retrievalPriorities = [
      ...characterNeedSlice.retrievalPriorities.filter((priority) => !isolateOpeningLegacyContext || priority.type !== 'character_state'),
      ...requiredForeshadowingIds.map((id) => ({
        type: 'foreshadowing' as ContextRetrievalPriorityType,
        id,
        priority: scoreRetrievalPriorityFromRules({ type: 'foreshadowing', id }, { sceneType, taskText, expectedCharacterIds: expectedCharacters.map((item) => item.characterId), requiredForeshadowingIds }),
        reason: '伏笔 treatmentMode 或章节任务要求本章处理。'
      })),
      ...requiredTimelineEventIds.map((id) => ({
        type: 'timeline' as ContextRetrievalPriorityType,
        id,
        priority: scoreRetrievalPriorityFromRules({ type: 'timeline', id }, { sceneType, taskText, expectedCharacterIds: expectedCharacters.map((item) => item.characterId), requiredForeshadowingIds }),
        reason: '与本章出场角色或事件连续性有关。'
      }))
    ]

    const hardCanonNeeds = availableHardCanonItems
      .filter((item) => item.status === 'active')
      .filter(
        (item) =>
          input.targetChapterOrder > 1 ||
          item.category === 'style_boundary' ||
          hardCanonMatchesTask(item, taskOnlyText)
      )
      .map((item) => {
        const priority = hardCanonNeedPriority(item, taskText)
        return contextNeed(
          'hard_canon',
          'hardCanon',
          item.id,
          priority,
          hardCanonNeedReason(item, priority),
          priority === 'low'
        )
      })
      .filter((need) => need.priority !== 'low')

    const storyDirectionNeeds = storyDirectionText
      ? [
          contextNeed(
            'story_direction',
            'storyDirection',
            input.storyDirectionGuide?.id ?? null,
            storyDirectionBeat ? 'high' : 'medium',
            storyDirectionBeat
              ? `中期剧情导向包含第 ${input.targetChapterOrder} 章节拍，应用于本章推进方向与章节任务补强。`
              : '中期剧情导向提供本章软性推进方向；未命中精确章节节拍，按中优先级使用。',
            !storyDirectionBeat
          )
        ]
      : []

    const contextNeeds = uniqueByKey(
      [
        ...(input.targetChapterOrder > 1
          ? [
              contextNeed(
                'previous_chapter_ending',
                'chapterEnding',
                input.previousChapter?.id ?? null,
                input.continuityBridge ? 'must' : 'high',
                input.continuityBridge ? '本章必须直接承接上一章结尾 Bridge。' : '缺少已保存 Bridge，至少需要上一章结尾片段辅助衔接。',
                !input.continuityBridge
              )
            ]
          : []),
        ...(storyDirectionText
          ? [
              contextNeed(
                'story_direction',
                'storyDirection',
                input.storyDirectionGuide?.id ?? null,
                'medium',
                '中期剧情导向用于选择本章推进方向，但不能覆盖硬状态和伏笔规则。'
              )
            ]
          : []),
        ...characterNeedSlice.contextNeeds.filter((need) => !isolateOpeningLegacyContext || need.sourceHint !== 'character_state'),
        ...unique(requiredForeshadowingIds).map((id) => {
          const item = input.foreshadowing.find((candidate) => candidate.id === id)
          const score = retrievalPriorities.find((priority) => priority.type === 'foreshadowing' && priority.id === id)?.priority ?? 70
          return contextNeed(
            'foreshadowing',
            'foreshadowing',
            id,
            item?.treatmentMode === 'payoff' || item?.weight === 'payoff' ? 'must' : priorityLevel(score),
            item ? `本章需要按 treatmentMode=${item.treatmentMode} 处理伏笔「${item.title}」。` : '本章任务要求处理该伏笔。'
          )
        }),
        ...unique(requiredTimelineEventIds).map((id) =>
          contextNeed(
            'timeline_anchor',
            'timeline',
            id,
            'high',
            '本章涉及已发生事件或出场角色的时间线锚点，需要防止顺序与因果错位。'
          )
        ),
        ...requiredWorldbuildingKeys.map((key) =>
          contextNeed(
            'world_rule',
            'worldbuilding',
            key,
            key === 'immutableFacts' ? 'must' : 'high',
            `本章任务涉及 ${key}，需要最小硬设定约束。`
          )
        ),
        ...(availableStageSummaries.length
          ? [
              contextNeed(
                'remote_stage_summary',
                'stageSummary',
                null,
                'low',
                '远期阶段摘要只用于压缩旧剧情背景，预算不足时可以优先压缩或省略。',
                true
              )
            ]
          : []),
        ...(input.previousChapter
          ? [contextNeed('recent_chapter_recap', 'recentChapter', input.previousChapter.id, 'medium', '近期章节回顾用于补充 Bridge 未覆盖的差异事实。')]
          : [])
      ],
      (item) => `${item.needType}:${item.sourceId ?? item.sourceHint}`
    )

    const strengthenedContextNeeds: ContextNeedItem[] = contextNeeds.map((need): ContextNeedItem => {
      if (need.needType === 'foreshadowing' && need.sourceId) {
        const item = availableForeshadowings.find((candidate) => candidate.id === need.sourceId)
        if (!item) return need
        const priority = foreshadowingNeedPriority(item, taskText, textValue(input.chapterTaskDraft.allowedPayoffs))
        return {
          ...need,
          priority,
          reason: foreshadowingNeedReason(item, priority)
        }
      }
      if (need.needType === 'timeline_anchor' && need.sourceId) {
        const event = availableTimelineEvents.find((candidate) => candidate.id === need.sourceId)
        if (!event) return need
        return {
          ...need,
          priority: 'high',
          reason: timelineNeedReason(event)
        }
      }
      return need
    })

    const prioritizedContextNeeds = uniqueByKey(
      [...hardCanonNeeds, ...storyDirectionNeeds, ...strengthenedContextNeeds],
      (item) => `${item.needType}:${item.sourceId ?? item.sourceHint}`
    )

    return {
      id: newNeedPlanId(),
      projectId: input.project.id,
      targetChapterOrder: input.targetChapterOrder,
      source: input.source ?? 'auto',
      chapterIntent: taskText || `准备第 ${input.targetChapterOrder} 章`,
      expectedSceneType: sceneType,
      expectedCharacters,
      requiredCharacterCardFields,
      requiredStateFactCategories,
      requiredForeshadowingIds: unique(requiredForeshadowingIds),
      forbiddenForeshadowingIds: unique(forbiddenForeshadowingIds),
      requiredTimelineEventIds: unique(requiredTimelineEventIds),
      requiredWorldbuildingKeys,
      mustCheckContinuity,
      retrievalPriorities,
      exclusionRules: [
        ...unique(forbiddenForeshadowingIds).map((id) => ({ type: 'foreshadowing', id, reason: '本章需求计划要求隐藏、暂停或禁止推进该伏笔。', source: 'planner' as const })),
        ...[...excludedCharacterIds].map((id) => ({ type: 'character', id, reason: '章节任务的否定约束禁止本章正向检索该角色。', source: 'planner' as const }))
      ],
      warnings: [
        ...(input.previousChapter || input.targetChapterOrder <= 1 ? [] : ['缺少上一章，无法完整规划章节衔接需求。']),
        ...(freeformNegativeText ? ['章节目标或冲突等自由文本含否定约束，已从正向检索中剥离；建议改填 forbiddenPayoffs 以获得更稳定的约束。'] : []),
        ...(!isolateOpeningLegacyContext && input.foreshadowing.some((item) => !isForeshadowingAvailableAtChapter(item, input.targetChapterOrder) && (textMentions(taskText, item.title) || textMentions(input.chapterTaskDraft.allowedPayoffs ?? '', item.title))) ? ['任务或剧情导向点名了尚未到首次出现章节的伏笔，已按章节门禁跳过。'] : [])
      ],
      contextNeeds: prioritizedContextNeeds,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  }

  static inferRequiredCharacterFields(
    character: Character,
    chapterTaskDraft: Partial<ChapterTask>,
    sceneType: ExpectedSceneType,
    expectedPresence: ExpectedPresence = 'onstage'
  ): CharacterCardField[] {
    return inferRequiredCharacterFieldsFromRules(character, chapterTaskDraft, sceneType, expectedPresence)
  }

  static inferRequiredStateCategories(
    character: Character,
    chapterTaskDraft: Partial<ChapterTask>,
    sceneType: ExpectedSceneType,
    expectedPresence: ExpectedPresence = 'onstage',
    involvement: CharacterNeedInvolvement = 'present',
    stateCheckRequired = expectedPresence === 'onstage' || involvement === 'must_act'
  ): StateFactCategory[] {
    return inferRequiredStateCategoriesFromRules(
      character,
      chapterTaskDraft,
      sceneType,
      expectedPresence,
      involvement,
      stateCheckRequired
    )
  }

  static scoreRetrievalPriority(
    item: { type: ContextRetrievalPriorityType; id: ID },
    plan: { sceneType: ExpectedSceneType; taskText: string; expectedCharacterIds: ID[]; requiredForeshadowingIds: ID[] }
  ): number {
    return scoreRetrievalPriorityFromRules(item, plan)
  }

}
