import { AIClient } from './AIClient'
import type {
  AIResult,
  Character,
  CharacterStateSuggestion,
  Chapter,
  ChapterReviewDraft,
  Foreshadowing,
  ForeshadowingExtractionResult,
  NextChapterSuggestions,
  StageSummary
} from '../../shared/types'
import { REVIEW_SYSTEM_PROMPT } from './AIPromptTemplates'
import { ensureChapterReview, ensureCharacterSuggestions, ensureForeshadowingExtraction, ensureNextSuggestions } from './AIResponseNormalizer'
import {
  validateChapterReviewSchema,
  validateCharacterSuggestionsSchema,
  validateForeshadowingExtractionSchema,
  validateNextSuggestionsSchema
} from './AISchemaValidator'

export class ChapterReviewAI {
  constructor(private readonly client: AIClient) {}

  async generateChapterReview(chapterText: string, context: string): Promise<AIResult<ChapterReviewDraft>> {
    const fallback: ChapterReviewDraft = {
      summary: '本章剧情摘要：\n- ',
      newInformation: '本章新增信息：\n- ',
      characterChanges: '本章角色变化：\n- ',
      newForeshadowing: '本章新增伏笔：\n- ',
      resolvedForeshadowing: '本章已回收伏笔：\n- ',
      endingHook: '本章结尾钩子：\n- ',
      riskWarnings: '本章风险提醒：\n- ',
      continuityBridgeSuggestion: {
        lastSceneLocation: '',
        lastPhysicalState: '',
        lastEmotionalState: '',
        lastUnresolvedAction: '',
        lastDialogueOrThought: '',
        immediateNextBeat: '',
        mustContinueFrom: '',
        mustNotReset: '',
        openMicroTensions: ''
      },
      characterStateChangeSuggestions: []
    }
    const userPrompt = [
      '请阅读章节正文与上下文，输出严格 JSON。',
      '{"summary":"","newInformation":"","characterChanges":"","newForeshadowing":"","resolvedForeshadowing":"","endingHook":"","riskWarnings":"","continuityBridgeSuggestion":{"lastSceneLocation":"","lastPhysicalState":"","lastEmotionalState":"","lastUnresolvedAction":"","lastDialogueOrThought":"","immediateNextBeat":"","mustContinueFrom":"","mustNotReset":"","openMicroTensions":""},"characterStateChangeSuggestions":[{"characterId":"","category":"resource","key":"","label":"","changeType":"transaction","beforeValue":null,"afterValue":null,"delta":null,"evidence":"","confidence":0.5,"riskLevel":"medium","suggestedTransactionType":"update","linkedCardFields":["abilitiesAndResources"]}]}',
      'continuityBridgeSuggestion 是下一章衔接建议：只提取上一章结尾时的位置、身体状态、情绪状态、未完成动作、最后一句话/念头、下一章第一拍、必须承接内容、禁止重置项和开放小张力。',
      'characterStateChangeSuggestions 只提取会导致硬伤的角色状态变化：现金、物品、位置、伤势、已知秘密、承诺、能力限制。不要提取一次性情绪。',
      '',
      `上下文：\n${context || '暂无'}`,
      '',
      `章节正文：\n${chapterText || '暂无正文'}`
    ].join('\n')

    return this.client.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureChapterReview, fallback, undefined, validateChapterReviewSchema)
  }

  async generateStageSummary(chapters: Chapter[]): Promise<Omit<StageSummary, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>> {
    const sorted = [...chapters].sort((a, b) => a.order - b.order)
    const chapterStart = sorted[0]?.order ?? 1
    const chapterEnd = sorted[sorted.length - 1]?.order ?? chapterStart
    const summaries = sorted
      .map((chapter) => `第 ${chapter.order} 章《${chapter.title || '未命名'}》：${chapter.summary || '待补充摘要'}`)
      .join('\n')

    return {
      chapterStart,
      chapterEnd,
      plotProgress: `根据所选章节整理阶段剧情进展：\n${summaries}`,
      characterRelations: '主要角色关系变化：\n- ',
      secrets: '关键秘密/信息差：\n- ',
      foreshadowingPlanted: '已埋伏笔：\n- ',
      foreshadowingResolved: '已回收伏笔：\n- ',
      unresolvedQuestions: '当前未解决问题：\n- ',
      nextStageDirection: '下一阶段推荐推进方向：\n- '
    }
  }

  async updateCharacterStates(
    chapterText: string,
    characters: Character[],
    context: string
  ): Promise<AIResult<CharacterStateSuggestion[]>> {
    const characterIds = new Set(characters.map((character) => character.id))
    const fallback: CharacterStateSuggestion[] = characters.slice(0, 3).map((character) => ({
      characterId: character.id,
      changeSummary: '请根据本章正文补充该角色是否发生长期状态变化。',
      newCurrentEmotionalState: character.emotionalState,
      newRelationshipWithProtagonist: character.protagonistRelationship,
      newNextActionTendency: character.nextActionTendency,
      relatedChapterId: null,
      confidence: 0
    }))
    const userPrompt = [
      '请从章节正文中提取角色当前戏剧状态变化，只输出确有长期影响的变化。',
      '输出严格 JSON：{"suggestions":[{"characterId":"","changeSummary":"","newCurrentEmotionalState":"","newRelationshipWithProtagonist":"","newNextActionTendency":"","relatedChapterId":null,"confidence":0.0}]}',
      '',
      `可选角色：\n${characters.map((character) => `${character.id} | ${character.name} | ${character.role}`).join('\n')}`,
      '',
      `上下文：\n${context || '暂无'}`,
      '',
      `章节正文：\n${chapterText || '暂无正文'}`
    ].join('\n')

    return this.client.requestJson(
      REVIEW_SYSTEM_PROMPT,
      userPrompt,
      (value) => ensureCharacterSuggestions(value, characterIds),
      fallback,
      undefined,
      validateCharacterSuggestionsSchema
    )
  }

  async extractForeshadowing(
    chapterText: string,
    existingForeshadowing: Foreshadowing[],
    context: string,
    characters: Character[] = []
  ): Promise<AIResult<ForeshadowingExtractionResult>> {
    const foreshadowingIds = new Set(existingForeshadowing.map((item) => item.id))
    const characterIds = new Set(characters.map((character) => character.id))
    const fallback: ForeshadowingExtractionResult = {
      newForeshadowingCandidates: [
        {
          title: '待确认新伏笔',
          description: '请从正文中补充是否存在对后续有影响的新伏笔。',
          firstChapterOrder: null,
          suggestedWeight: 'medium',
          recommendedTreatmentMode: 'hint',
          expectedPayoff: '',
          relatedCharacterIds: [],
          notes: ''
        }
      ],
      advancedForeshadowingIds: [],
      resolvedForeshadowingIds: [],
      abandonedForeshadowingCandidates: [],
      statusChanges: []
    }
    const userPrompt = [
      '请从章节正文中提取伏笔信息。只记录会影响未来剧情的信息。',
      '输出严格 JSON：{"newForeshadowingCandidates":[],"advancedForeshadowingIds":[],"resolvedForeshadowingIds":[],"abandonedForeshadowingCandidates":[],"statusChanges":[{"foreshadowingId":"","suggestedStatus":"partial","recommendedTreatmentMode":"advance","evidenceText":"","notes":"","confidence":0.0}]}',
      'newForeshadowingCandidates 和 abandonedForeshadowingCandidates 的字段为：title, description, firstChapterOrder, suggestedWeight(low|medium|high|payoff), recommendedTreatmentMode(hidden|hint|advance|mislead|pause|payoff), expectedPayoff, relatedCharacterIds, notes。AI 只能提出 recommendedTreatmentMode 候选，不得假定已经写入伏笔账本。',
      '如果正文疑似提前回收了本应仅暗示、推进、暂停或隐藏的伏笔，请在 statusChanges.notes 中写明风险，不要直接改变伏笔账本。',
      '',
      `已有伏笔：\n${existingForeshadowing.map((item) => `${item.id} | ${item.title} | ${item.status} | ${item.weight} | ${item.description}`).join('\n') || '暂无'}`,
      '',
      `可选角色：\n${characters.map((character) => `${character.id} | ${character.name}`).join('\n') || '暂无'}`,
      '',
      `上下文：\n${context || '暂无'}`,
      '',
      `章节正文：\n${chapterText || '暂无正文'}`
    ].join('\n')

    return this.client.requestJson(
      REVIEW_SYSTEM_PROMPT,
      userPrompt,
      (value) => ensureForeshadowingExtraction(value, foreshadowingIds, characterIds),
      fallback,
      undefined,
      validateForeshadowingExtractionSchema
    )
  }

  async generateNextChapterSuggestions(chapter: Chapter, projectContext: string): Promise<AIResult<NextChapterSuggestions>> {
    const fallback: NextChapterSuggestions = {
      nextChapterGoal: '根据本章结尾钩子，明确下一章要推进的剧情目标。',
      conflictToPush: '选择一个主线冲突或人物关系冲突继续加压。',
      suspenseToKeep: '保留当前最重要的信息差，不要过早解释。',
      foreshadowingToHint: '选择 1 个中高权重伏笔轻微推进。',
      foreshadowingNotToReveal: '避免提前回收尚未铺垫充分的关键伏笔。',
      suggestedEndingHook: '下一章结尾应形成新的行动压力或信息反转。',
      readerEmotionTarget: '保持期待感、紧张感和对角色选择的好奇。'
    }
    const userPrompt = [
      '请基于本章复盘，生成下一章任务建议。不要续写正文。',
      '输出严格 JSON：{"nextChapterGoal":"","conflictToPush":"","suspenseToKeep":"","foreshadowingToHint":"","foreshadowingNotToReveal":"","suggestedEndingHook":"","readerEmotionTarget":""}',
      '',
      `项目上下文：\n${projectContext || '暂无'}`,
      '',
      `章节：第 ${chapter.order} 章《${chapter.title || '未命名'}》`,
      `剧情摘要：${chapter.summary}`,
      `角色变化：${chapter.characterChanges}`,
      `新增伏笔：${chapter.newForeshadowing}`,
      `已回收伏笔：${chapter.resolvedForeshadowing}`,
      `结尾钩子：${chapter.endingHook}`,
      `风险提醒：${chapter.riskWarnings}`
    ].join('\n')

    return this.client.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureNextSuggestions, fallback, undefined, validateNextSuggestionsSchema)
  }
}
