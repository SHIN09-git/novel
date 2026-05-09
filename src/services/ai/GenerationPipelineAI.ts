import { AIClient } from './AIClient'
import type {
  AIResult,
  Character,
  CharacterStateSuggestion,
  Chapter,
  ChapterDraftResult,
  ChapterPlan,
  ChapterReviewDraft,
  ConsistencyReviewData,
  ConsistencyReviewIssue,
  ConsistencySeverity,
  Foreshadowing,
  ForeshadowingCandidate,
  ForeshadowingExtractionResult,
  ForeshadowingStatusChangeSuggestion,
  ForeshadowingWeight,
  ID,
  NextChapterSuggestions,
  PipelineMode,
  QualityGateDimensionScores,
  QualityGateIssue,
  RevisionRequestType,
  RevisionResult,
  StageSummary
} from '../../shared/types'
import { REVIEW_SYSTEM_PROMPT } from './AIPromptTemplates'
import { ensureChapterDraft, ensureChapterPlan, ensureConsistencyReview, rawTextAsChapterDraft } from './AIResponseNormalizer'
import { validateChapterDraftSchema, validateChapterPlanSchema, validateConsistencyReviewSchema } from './AISchemaValidator'

function formatNoveltyPlan(value: ChapterPlan['allowedNovelty'] | ChapterPlan['forbiddenNovelty']): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value ?? '')
  }
}

export class GenerationPipelineAI {
  constructor(private readonly client: AIClient) {}

  async generateChapterPlan(
    context: string,
    options: { mode: PipelineMode; targetChapterOrder: number; estimatedWordCount: string; readerEmotionTarget: string }
  ): Promise<AIResult<ChapterPlan>> {
    const fallback: ChapterPlan = {
      chapterTitle: `第 ${options.targetChapterOrder} 章`,
      chapterGoal: '根据上下文明确本章目标，推进主线冲突。',
      conflictToPush: '选择一个已经存在的冲突继续加压，不凭空改写长期设定。',
      characterBeats: '让主要角色延续当前状态，并产生可记录的戏剧选择。',
      foreshadowingToUse: '轻微推进中/高权重未回收伏笔。',
      foreshadowingNotToReveal: '不要提前回收尚未铺垫充分的关键伏笔。',
      endingHook: '以新的行动压力、信息差或角色选择收束本章。',
      readerEmotionTarget: options.readerEmotionTarget || '期待、紧张、好奇',
      estimatedWordCount: options.estimatedWordCount,
      openingContinuationBeat: '直接承接上一章最后一幕，不重新开场。',
      carriedPhysicalState: '延续上一章结尾的身体状态。',
      carriedEmotionalState: '延续上一章结尾的情绪余波。',
      unresolvedMicroTensions: '保留上一章未释放的小张力。',
      forbiddenResets: '不要重新介绍已有环境、机制或人物关系。'
      , allowedNovelty: 'Only introduce new named characters, rules, organizations, lore reveals, props, or system mechanics when they are explicitly required by this chapter task or already foreshadowed in context.'
      , forbiddenNovelty: 'Do not invent rescue rules, unforeshadowed system permissions, new core canon mechanisms, arbitrary names for unknown people, or early explanations of protected mysteries.'
    }

    const userPrompt = [
      'You are planning the next chapter for a long-form novel pipeline.',
      'Return strict JSON only with keys:',
      '{"chapterTitle":"","chapterGoal":"","conflictToPush":"","characterBeats":"","foreshadowingToUse":"","foreshadowingNotToReveal":"","endingHook":"","readerEmotionTarget":"","estimatedWordCount":"","openingContinuationBeat":"","carriedPhysicalState":"","carriedEmotionalState":"","unresolvedMicroTensions":"","forbiddenResets":"","allowedNovelty":"","forbiddenNovelty":""}',
      'The plan must include continuity bridge fields: openingContinuationBeat, carriedPhysicalState, carriedEmotionalState, unresolvedMicroTensions, forbiddenResets.',
      'The plan must include allowedNovelty and forbiddenNovelty. allowedNovelty should cover allowedNewCharacters, allowedNewRules, allowedNewSystemMechanics, allowedNewOrganizationsOrRanks, allowedLoreReveals, and notes. forbiddenNovelty should cover forbiddenNewCharacters, forbiddenNewRules, forbiddenSystemMechanics, forbiddenOrganizationsOrRanks, forbiddenLoreReveals, and notes.',
      'If this is not an opening/reveal chapter, default to forbidding unforeshadowed major new rules and named characters. Crisis solutions must come from existing rules, foreshadowing, current character abilities, or the explicit task.',
      'Continuity hard rules: first scene must continue the previous chapter ending, preserve physical/emotional state, answer or carry the last hook within the first 300 Chinese characters, and avoid "meanwhile" or "some time later" unless explicitly requested.',
      `Mode: ${options.mode}. conservative = obey canon and add little; standard = moderate progress; aggressive = may propose new conflict/foreshadowing but mark it as candidate only.`,
      'Foreshadowing treatment modes in context are binding: hidden/pause must not be used by default; hint only faintly signals; advance may progress but not reveal truth; mislead may misdirect without contradicting final truth; payoff may reveal and affect choices.',
      'In foreshadowingToUse, separate items by treatment intent when possible: allowed hint, allowed advance, allowed mislead, allowed payoff. In foreshadowingNotToReveal, list hidden/pause items and any item that must not be paid off.',
      `Target chapter: ${options.targetChapterOrder}`,
      `Expected word count: ${options.estimatedWordCount}`,
      `Reader emotion target: ${options.readerEmotionTarget || 'not specified'}`,
      '',
      `Context:\n${context}`
    ].join('\n')

    const result = await this.client.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureChapterPlan, fallback, undefined, validateChapterPlanSchema)
    if (result.data) return result

    return {
      ok: true,
      usedAI: false,
      data: fallback,
      rawText: result.rawText,
      parseError: result.parseError,
      finishReason: result.finishReason,
      error: result.error
        ? `远程 AI 任务书生成失败，已降级为本地任务书模板。原始错误：${result.error}`
        : '远程 AI 任务书生成失败，已降级为本地任务书模板。'
    }
  }


  async generateChapterDraft(
    chapterPlan: ChapterPlan,
    context: string,
    options: { mode: PipelineMode; estimatedWordCount: string; readerEmotionTarget: string; retryReason?: string }
  ): Promise<AIResult<ChapterDraftResult>> {
    const fallback: ChapterDraftResult = {
      title: chapterPlan.chapterTitle || '未命名章节',
      body: [
        '【本地草稿模板】',
        '未配置 API Key 时不会自动生成正文。请根据下方任务书手动撰写，或在设置页配置兼容 Chat Completions 的 API。',
        '',
        `本章目标：${chapterPlan.chapterGoal}`,
        `必须推进的冲突：${chapterPlan.conflictToPush}`,
        `角色节拍：${chapterPlan.characterBeats}`,
        `可使用伏笔：${chapterPlan.foreshadowingToUse}`,
        `禁止提前揭示：${chapterPlan.foreshadowingNotToReveal}`,
        `结尾钩子：${chapterPlan.endingHook}`,
        `读者情绪：${chapterPlan.readerEmotionTarget || options.readerEmotionTarget}`,
        `预计字数：${chapterPlan.estimatedWordCount || options.estimatedWordCount}`,
        `开头承接：${chapterPlan.openingContinuationBeat}`,
        `延续身体状态：${chapterPlan.carriedPhysicalState}`,
        `延续情绪状态：${chapterPlan.carriedEmotionalState}`,
        `未释放小张力：${chapterPlan.unresolvedMicroTensions}`,
        `禁止重置：${chapterPlan.forbiddenResets}`
        , `Allowed novelty: ${formatNoveltyPlan(chapterPlan.allowedNovelty)}`,
        `Forbidden novelty: ${formatNoveltyPlan(chapterPlan.forbiddenNovelty)}`
      ].join('\n')
    }

    const userPrompt = [
      'You are drafting a novel chapter from an approved chapter plan.',
      'Return strict JSON only: {"title":"","body":""}',
      'The body must be complete prose, not an outline, summary, beat sheet, checklist, or bracketed notes.',
      'Write a full chapter with scenes, actions, dialogue, sensory details, and an ending hook.',
      'Do not stop mid-sentence. If the requested length is too high for the token budget, produce a shorter but complete chapter ending cleanly.',
      'Do not reveal foreshadowing listed as forbidden.',
      'Continuity hard rules: first scene must continue the previous chapter ending; do not restart the chapter with a fresh world introduction; preserve carried physical and emotional state; answer or carry the previous hook within the first 300 Chinese characters; avoid "meanwhile" / "some time later" unless the plan explicitly asks for a time jump.',
      'Redundancy hard rules: do not repeat already-known environment descriptions, do not re-explain mechanisms from previous chapters, avoid repeated abstract intensifiers, avoid repeated "this is not... but..." explanation structures, and add only necessary new information.',
      'Foreshadowing treatment rules are mandatory: hidden/pause must not be advanced or mentioned unless explicitly required; hint must stay subtle and cannot explain, advance, or pay off; advance may change the clue state but cannot reveal the truth; payoff is the only mode that may reveal and resolve.',
      'Novelty hard rules: do not invent unforeshadowed rescue rules, temporary permissions, system panel patches, new administrator ranks, or new core lore to solve the current crisis.',
      'Crisis resolution must come from provided rules, already foreshadowed clues, existing character abilities/resources, or mechanisms explicitly allowed in the chapter plan.',
      'If a new rule/mechanic is explicitly allowed, it must create cost, risk, or complication; it cannot be a free convenience. Do not name unknown people unless the plan allows it or the context already identifies them.',
      'Instance rules must not suddenly expand without an announcement, record, ticket, map, environmental clue, prior setup, or chapter-plan permission.',
      'Do not use system-panel addenda, emergency exceptions, manual evaluation, identity sharing, or administrator rank reveals as free deus-ex-machina tools.',
      'Do not convert unauthorized new lore into stable canon; any new entity/rule/lore must remain a pending candidate until human confirmation.',
      'Do not treat a convenient rule that first appears in the draft as established canon unless the chapter plan and Run Trace can explain its source.',
      'Do not change long-term canon, power rules, or stable worldbuilding.',
      'Do not make characters suddenly OOC. Preserve current dramatic state.',
      `Mode: ${options.mode}`,
      `Expected word count: ${options.estimatedWordCount}`,
      `Reader emotion target: ${options.readerEmotionTarget || chapterPlan.readerEmotionTarget}`,
      options.retryReason ? `Previous draft was rejected because: ${options.retryReason}. Regenerate a complete prose chapter now.` : '',
      '',
      `Chapter plan:\n${JSON.stringify(chapterPlan, null, 2)}`,
      '',
      `Context:\n${context}`
    ].join('\n')

    return this.client.requestJson(
      REVIEW_SYSTEM_PROMPT,
      userPrompt,
      ensureChapterDraft,
      fallback,
      (rawText) => rawTextAsChapterDraft(rawText, chapterPlan.chapterTitle || fallback.title),
      validateChapterDraftSchema
    )
  }


  async generateConsistencyReview(chapterDraft: ChapterDraftResult, context: string): Promise<AIResult<ConsistencyReviewData>> {
    const fallback: ConsistencyReviewData = {
      timelineProblems: [],
      settingConflicts: [],
      characterOOC: [],
      foreshadowingMisuse: [],
      pacingProblems: ['请人工检查章节节奏是否符合目标字数与读者情绪。'],
      emotionPayoffProblems: [],
      suggestions: ['未配置 API Key，已生成本地审稿模板。请人工核对时间线、设定、角色状态和伏笔使用。'],
      severitySummary: 'low',
      issues: []
    }

    const userPrompt = [
      'You are a continuity editor, not a quality scorer.',
      'Your task is to find contradictions between this chapter and prior chapters, canon, character knowledge, the foreshadowing ledger, and the timeline.',
      'Do not judge prose beauty, do not give generic advice like "increase tension", and do not provide an overall score.',
      'Every issue should include evidence and a concrete revisionInstruction. If there are no issues, return an empty issues array.',
      'Return strict JSON only with keys:',
      '{"timelineProblems":[],"settingConflicts":[],"characterOOC":[],"foreshadowingMisuse":[],"pacingProblems":[],"emotionPayoffProblems":[],"suggestions":[],"severitySummary":"low","issues":[{"id":"","type":"timeline_conflict","severity":"low","title":"","description":"","evidence":"","relatedChapterIds":[],"relatedCharacterIds":[],"relatedForeshadowingIds":[],"suggestedFix":"","revisionInstruction":"","status":"open"}]}',
      'severitySummary must be low, medium, or high.',
      'issue.type must be one of timeline_conflict, worldbuilding_conflict, character_knowledge_leak, character_motivation_gap, character_ooc, foreshadowing_misuse, foreshadowing_leak, geography_or_physics_conflict, previous_chapter_contradiction, continuity_gap, other.',
      'Focus on: timeline conflicts, worldbuilding/canon conflicts, character knowledge leaks, motivation gaps, OOC behavior, foreshadowing misuse/leak, geography/physics conflicts, contradictions with previous chapters, and continuity gaps.',
      '',
      `Draft title: ${chapterDraft.title}`,
      `Draft body:\n${chapterDraft.body}`,
      '',
      `Context:\n${context}`
    ].join('\n')

    return this.client.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureConsistencyReview, fallback, undefined, validateConsistencyReviewSchema)
  }

}
