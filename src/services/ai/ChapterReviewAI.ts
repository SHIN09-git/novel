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
  PostDraftAnalysisResult,
  StageSummary
} from '../../shared/types'
import { REVIEW_SYSTEM_PROMPT } from './AIPromptTemplates'
import {
  ensureChapterReview,
  ensureCharacterSuggestions,
  ensureForeshadowingExtraction,
  ensureNextSuggestions,
  ensurePostDraftAnalysis
} from './AIResponseNormalizer'
import {
  validateChapterReviewSchema,
  validateCharacterSuggestionsSchema,
  validateForeshadowingExtractionSchema,
  validateNextSuggestionsSchema,
  validatePostDraftAnalysisSchema
} from './AISchemaValidator'
import { StageSummaryService } from '../StageSummaryService'

function cleanText(value: unknown): string {
  return String(value ?? '').trim()
}

function contextBlock(label: string, value: unknown): string {
  const text = cleanText(value)
  return text
    ? `${label}：\n${text}`
    : `${label}：未提供。只依据章节正文和明确字段，不要补写背景设定。`
}

function chapterTextBlock(chapterText: string): string {
  const text = cleanText(chapterText)
  return text
    ? `章节正文：\n${text}`
    : [
        '章节正文：<missing>',
        '未提供章节正文。不要提取候选、不要生成复盘事实；返回空数组或空字段。'
      ].join('\n')
}

function listBlock(label: string, rows: string[], emptyText: string): string {
  const body = rows.map((row) => cleanText(row)).filter(Boolean).join('\n')
  return `${label}：\n${body || emptyText}`
}

function emptyChapterReview(): ChapterReviewDraft {
  return {
    summary: '',
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '',
    riskWarnings: '',
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
}

function emptyForeshadowingExtraction(): ForeshadowingExtractionResult {
  return {
    newForeshadowingCandidates: [],
    advancedForeshadowingIds: [],
    resolvedForeshadowingIds: [],
    abandonedForeshadowingCandidates: [],
    statusChanges: []
  }
}

export class ChapterReviewAI {
  constructor(private readonly client: AIClient) {}

  async generatePostDraftAnalysis(
    chapterText: string,
    context: string,
    characters: Character[],
    existingForeshadowing: Foreshadowing[]
  ): Promise<AIResult<PostDraftAnalysisResult>> {
    const characterIds = new Set(characters.map((character) => character.id))
    const foreshadowingIds = new Set(existingForeshadowing.map((item) => item.id))
    const fallback: PostDraftAnalysisResult = {
      chapterReview: emptyChapterReview(),
      characterSuggestions: [],
      foreshadowingExtraction: emptyForeshadowingExtraction(),
      analysisMode: 'unified',
      warnings: []
    }
    const userPrompt = [
      '请一次完成章节生成后的结构化分析，输出严格 JSON，不要写审稿散文。',
      '这次响应同时服务章节复盘、角色变化候选和伏笔变化候选，避免对同一正文重复调用模型。',
      '输出结构：',
      '{"chapterReview":{"summary":"","newInformation":"","characterChanges":"","newForeshadowing":"","resolvedForeshadowing":"","endingHook":"","riskWarnings":"","continuityBridgeSuggestion":{"lastSceneLocation":"","lastPhysicalState":"","lastEmotionalState":"","lastUnresolvedAction":"","lastDialogueOrThought":"","immediateNextBeat":"","mustContinueFrom":"","mustNotReset":"","openMicroTensions":""},"characterStateChangeSuggestions":[]},"characterSuggestions":[],"foreshadowingExtraction":{"newForeshadowingCandidates":[],"advancedForeshadowingIds":[],"resolvedForeshadowingIds":[],"abandonedForeshadowingCandidates":[],"statusChanges":[]}}',
      'chapterReview.characterStateChangeSuggestions 只提取会造成连续性硬伤的现金、物品、位置、伤势、知识、承诺和能力限制。',
      'characterSuggestions 只记录具有后续影响的情绪、关系或行动倾向变化，字段为 characterId, changeSummary, newCurrentEmotionalState, newRelationshipWithProtagonist, newNextActionTendency, relatedChapterId, confidence。',
      'foreshadowingExtraction 的新增候选必须确有未来兑现价值；已有伏笔只使用给定 ID，不能把正文中的普通细节全部升级成伏笔。',
      'chapterReview、characterSuggestions、foreshadowingExtraction 三块必须全部返回；没有变化时使用空字符串或空数组。',
      '禁止输出“待补充”“暂无”“未命名伏笔”“状态变化”等占位候选。候选必须包含正文证据。',
      '所有输出都只是 pending 候选，不得假定已经写入角色卡、伏笔账本或长期记忆。',
      '',
      listBlock(
        '可选角色',
        characters.map((character) => `${character.id} | ${character.name} | ${character.role}`),
        '无可选角色。角色相关数组必须为空。'
      ),
      '',
      listBlock(
        '已有伏笔',
        existingForeshadowing.map(
          (item) => `${item.id} | ${item.title} | ${item.status} | ${item.weight} | ${item.treatmentMode} | ${item.description}`
        ),
        '无已登记伏笔。'
      ),
      '',
      contextBlock('上下文', context),
      '',
      chapterTextBlock(chapterText)
    ].join('\n')

    return this.client.requestJson(
      REVIEW_SYSTEM_PROMPT,
      userPrompt,
      (value) => ensurePostDraftAnalysis(value, characterIds, foreshadowingIds),
      fallback,
      undefined,
      validatePostDraftAnalysisSchema
    )
  }

  async generateChapterReview(chapterText: string, context: string): Promise<AIResult<ChapterReviewDraft>> {
    const fallback = emptyChapterReview()
    const userPrompt = [
      '请阅读章节正文与上下文，输出严格 JSON。',
      '{"summary":"","newInformation":"","characterChanges":"","newForeshadowing":"","resolvedForeshadowing":"","endingHook":"","riskWarnings":"","continuityBridgeSuggestion":{"lastSceneLocation":"","lastPhysicalState":"","lastEmotionalState":"","lastUnresolvedAction":"","lastDialogueOrThought":"","immediateNextBeat":"","mustContinueFrom":"","mustNotReset":"","openMicroTensions":""},"characterStateChangeSuggestions":[{"characterId":"","category":"resource","key":"","label":"","changeType":"transaction","beforeValue":null,"afterValue":null,"delta":null,"evidence":"","confidence":0.5,"riskLevel":"medium","suggestedTransactionType":"update","linkedCardFields":["abilitiesAndResources"]}]}',
      'continuityBridgeSuggestion 是下一章衔接建议：只提取上一章结尾时的位置、身体状态、情绪状态、未完成动作、最后一句话/念头、下一章第一拍、必须承接内容、禁止重置项和开放小张力。',
      'characterStateChangeSuggestions 只提取会导致硬伤的角色状态变化：现金、物品、位置、伤势、已知秘密、承诺、能力限制。不要提取一次性情绪。',
      '',
      contextBlock('上下文', context),
      '',
      chapterTextBlock(chapterText)
    ].join('\n')

    return this.client.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureChapterReview, fallback, undefined, validateChapterReviewSchema)
  }

  async generateStageSummary(chapters: Chapter[]): Promise<Omit<StageSummary, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>> {
    return StageSummaryService.createDraftFromChapters(chapters)
  }

  async updateCharacterStates(
    chapterText: string,
    characters: Character[],
    context: string
  ): Promise<AIResult<CharacterStateSuggestion[]>> {
    const characterIds = new Set(characters.map((character) => character.id))
    const fallback: CharacterStateSuggestion[] = []
    const userPrompt = [
      '请从章节正文中提取角色当前戏剧状态变化，只输出确有长期影响的变化。',
      '输出严格 JSON：{"suggestions":[{"characterId":"","changeSummary":"","newCurrentEmotionalState":"","newRelationshipWithProtagonist":"","newNextActionTendency":"","relatedChapterId":null,"confidence":0.0}]}',
      '',
      `可选角色：\n${characters.map((character) => `${character.id} | ${character.name} | ${character.role}`).join('\n')}`,
      '',
      contextBlock('上下文', context),
      '',
      chapterTextBlock(chapterText)
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
    const fallback = emptyForeshadowingExtraction()
    const userPrompt = [
      '请从章节正文中提取伏笔信息。只记录会影响未来剧情的信息。',
      '输出严格 JSON：{"newForeshadowingCandidates":[],"advancedForeshadowingIds":[],"resolvedForeshadowingIds":[],"abandonedForeshadowingCandidates":[],"statusChanges":[{"foreshadowingId":"","suggestedStatus":"partial","recommendedTreatmentMode":"advance","evidenceText":"","notes":"","confidence":0.0}]}',
      'newForeshadowingCandidates 和 abandonedForeshadowingCandidates 的字段为：title, description, firstChapterOrder, suggestedWeight(low|medium|high|payoff), recommendedTreatmentMode(hidden|hint|advance|mislead|pause|payoff), expectedPayoff, relatedCharacterIds, notes。AI 只能提出 recommendedTreatmentMode 候选，不得假定已经写入伏笔账本。',
      '如果正文疑似提前回收了本应仅暗示、推进、暂停或隐藏的伏笔，请在 statusChanges.notes 中写明风险，不要直接改变伏笔账本。',
      '',
      listBlock('已有伏笔', existingForeshadowing.map((item) => `${item.id} | ${item.title} | ${item.status} | ${item.weight} | ${item.description}`), '无已登记伏笔。'),
      '',
      listBlock('可选角色', characters.map((character) => `${character.id} | ${character.name}`), '无可选角色。'),
      '',
      contextBlock('上下文', context),
      '',
      chapterTextBlock(chapterText)
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
      contextBlock('项目上下文', projectContext),
      '',
      `章节：第 ${chapter.order} 章${cleanText(chapter.title) ? `《${cleanText(chapter.title)}》` : ''}`,
      cleanText(chapter.summary) ? `剧情摘要：${cleanText(chapter.summary)}` : '',
      cleanText(chapter.characterChanges) ? `角色变化：${cleanText(chapter.characterChanges)}` : '',
      cleanText(chapter.newForeshadowing) ? `新增伏笔：${cleanText(chapter.newForeshadowing)}` : '',
      cleanText(chapter.resolvedForeshadowing) ? `已回收伏笔：${cleanText(chapter.resolvedForeshadowing)}` : '',
      cleanText(chapter.endingHook) ? `结尾钩子：${cleanText(chapter.endingHook)}` : '',
      cleanText(chapter.riskWarnings) ? `风险提醒：${cleanText(chapter.riskWarnings)}` : ''
    ].join('\n')

    return this.client.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureNextSuggestions, fallback, undefined, validateNextSuggestionsSchema)
  }
}
