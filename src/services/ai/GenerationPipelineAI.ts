import { AIClient } from './AIClient'
import type {
  AIResult,
  Character,
  CharacterStateSuggestion,
  Chapter,
  ChapterDraftResult,
  ChapterPlan,
  ChapterReviewDraft,
  ChapterTask,
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
import { CHAPTER_DRAFT_SYSTEM_PROMPT, CHAPTER_PLAN_SYSTEM_PROMPT, OPENING_CHAPTER_DRAFT_SYSTEM_PROMPT, OPENING_CHAPTER_PLAN_SYSTEM_PROMPT, REVIEW_SYSTEM_PROMPT } from './AIPromptTemplates'
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

function openingDraftLengthAim(value: string): number | null {
  const values = [...String(value ?? '').matchAll(/\d+/g)]
    .map((match) => Number(match[0]))
    .filter((item) => Number.isFinite(item) && item > 0)
  if (values.length < 2) return null
  const minimum = Math.min(values[0], values[1])
  const maximum = Math.max(values[0], values[1])
  return Math.round(((minimum + maximum) / 2) / 100) * 100
}

function authoritativeOpeningRetryGuidance(retryReason: string, retryIssueTypes: string[]): string {
  const issueTypes = new Set(retryIssueTypes)
  const guidance: string[] = []
  const hasStructuredTypes = issueTypes.size > 0
  const hasLengthIssue = issueTypes.has('chapter_task_length') || (!hasStructuredTypes && /(?:可见字符|正文).{0,24}(?:低于|超过|不足|过长)/u.test(retryReason))
  if (hasLengthIssue && /(?:低于|不足|过短)/u.test(retryReason)) {
    guidance.push('字数不足时，只在结尾触发动作之前，深化原稿中已经存在的一处关系事件或小冲突，形成一段完整、有因果的场景互动；不得在触发动作之后补篇幅。')
  } else if (hasLengthIssue && /(?:超过|过长)/u.test(retryReason)) {
    guidance.push('字数超出时，压缩重复动作和解释，不改变事件顺序、人物状态和结尾。')
  }
  if (
    issueTypes.has('chapter_task_phrase_position') ||
    issueTypes.has('chapter_task_post_phrase_tail') ||
    (!hasStructuredTypes && /(?:首次出现|短语位置|收尾边界)/u.test(retryReason))
  ) {
    guidance.push('将指定短语及其触发动作整体移入任务规定的最后收尾段；短语出现后只保留 ChapterTask 明确允许的动作，删除其后的解释、追问、内心反复、新场景、时间延伸和气氛化尾声。不要为此增加关系戏或另一轮家务。')
  }
  if (issueTypes.has('chapter_task_phrase_count')) {
    guidance.push('指定短语只保留一次；对白、内心复述和屏幕重看都不得再次出现。')
  }
  if ([...issueTypes].some((type) => [
    'chapter_task_style_forbidden_term',
    'chapter_task_forbidden_source_inquiry',
    'chapter_task_forbidden_outing_decision'
  ].includes(type))) {
    guidance.push('对其余局部禁令，只删除或就地改写违规句，不新增替代剧情。')
  }
  return guidance.join('')
}

export function buildAuthoritativeOpeningDraftPrompt(
  chapterTask: ChapterTask,
  retryReason?: string,
  previousDraft?: ChapterDraftResult,
  retryIssueTypes: string[] = []
): string {
  const lengthAim = openingDraftLengthAim(chapterTask.targetWordCount)
  const hasRevisionTarget = Boolean(retryReason && previousDraft?.body.trim())
  const retryGuidance = retryReason ? authoritativeOpeningRetryGuidance(retryReason, retryIssueTypes) : ''
  return [
    '请根据下方唯一的 ChapterTask 写出完整的小说第一章。',
    '只输出严格 JSON：{"title":"","body":""}。body 必须是完整正文，不是提纲、总结、节拍表或任务说明。',
    '把 ChapterTask 当作创作简报，不要在正文中复述字段名、百分比、禁令或其他任务措辞。',
    '任务中的禁止项只用于划定边界，不要在正文中用否定叙述逐条证明自己遵守了它们。',
    lengthAim
      ? `字数按去除空白后的可见字符计；本次以约 ${lengthAim} 个可见字符为创作落点，允许范围仍以 ChapterTask 为准，不要贴着下限。用人物之间的默契、小摩擦和有因果的生活过程自然展开，不靠重复家务、解释任务或新增剧情凑字。`
      : '优先达到 ChapterTask 的目标字数；用人物之间的默契、小摩擦和有因果的生活过程自然展开，不靠重复家务、解释任务或新增剧情凑字。',
    '可以自由补足无剧情功能的日常动作、对话和普通生活纹理；每个动作服从当时的时间、地点与人物状态，不为迁就结尾而保留已经处理完的物品或麻烦。',
    retryReason
      ? hasRevisionTarget
        ? `上一版正文未通过基础完整性检查：${retryReason}。请把它作为唯一修订底稿，只修复上述失败项，不要另起一稿。保留未被指出的段落、事件顺序、人物关系、物件状态、标题和合规收束。${retryGuidance}先检查人物是否在场、物件去向和动作先后；不要新增菜品、场外行程、人物往事或模板化亲密动作来补字。仍须返回完整正文，不要只返回新增段落。`
        : `上一版正文未通过基础完整性检查：${retryReason}。请依据 ChapterTask 针对上述失败项重新生成完整正文，不要为修复一个约束引入新剧情。${retryGuidance || '不要无条件增加关系戏、另一轮家务或解释性段落。'}`
      : '',
    '',
    `ChapterTask：\n${JSON.stringify(chapterTask, null, 2)}`,
    hasRevisionTarget
      ? `\n上一版草稿（仅作为修订对象，不是新的设定来源）：\n${JSON.stringify({ title: previousDraft?.title ?? '', body: previousDraft?.body ?? '' }, null, 2)}`
      : ''
  ].join('\n')
}

export class GenerationPipelineAI {
  constructor(private readonly client: AIClient) {}

  async generateChapterPlan(
    context: string,
    options: { mode: PipelineMode; targetChapterOrder: number; estimatedWordCount: string; readerEmotionTarget: string; chapterTask: ChapterTask }
  ): Promise<AIResult<ChapterPlan>> {
    const chapterTask = options.chapterTask
    const isOpeningChapter = options.targetChapterOrder === 1
    const fallback: ChapterPlan = {
      chapterTitle: `第 ${options.targetChapterOrder} 章`,
      chapterGoal: chapterTask.goal || '根据上下文明确本章目标，推进主线冲突。',
      conflictToPush: chapterTask.conflict || '选择一个已经存在的冲突继续加压，不凭空改写长期设定。',
      characterBeats: '让主要角色延续当前状态，并产生可记录的戏剧选择。',
      foreshadowingToUse: chapterTask.allowedPayoffs || '轻微推进中/高权重未回收伏笔。',
      foreshadowingNotToReveal: chapterTask.forbiddenPayoffs || chapterTask.suspenseToKeep || '不要提前回收尚未铺垫充分的关键伏笔。',
      endingHook: chapterTask.endingHook || '以新的行动压力、信息差或角色选择收束本章。',
      readerEmotionTarget: chapterTask.readerEmotion || options.readerEmotionTarget || '期待、紧张、好奇',
      estimatedWordCount: chapterTask.targetWordCount || options.estimatedWordCount,
      openingContinuationBeat: isOpeningChapter ? '按本章任务从自然生活场景建立开场，不伪造前情。' : '直接承接上一章最后一幕，不重新开场。',
      carriedPhysicalState: isOpeningChapter ? '不存在上一章身体状态；只建立任务明确要求的当下状态。' : '延续上一章结尾的身体状态。',
      carriedEmotionalState: isOpeningChapter ? '不存在上一章情绪余波；按任务指定的情绪基线开场。' : '延续上一章结尾的情绪余波。',
      unresolvedMicroTensions: isOpeningChapter ? '不存在上一章未释放张力；不要自行补造前情。' : '保留上一章未释放的小张力。',
      forbiddenResets: isOpeningChapter ? '不得伪造上一章、既往行动、旧钩子或未在任务中提供的人物状态。' : '不要重新介绍已有环境、机制或人物关系。',
      allowedNovelty: isOpeningChapter
        ? '只从任务取得专名、背景、人物关系、剧情事件、线索和机制；允许补充不带专名、无剧情功能的普通食材、器具、摊贩或路人及生活动作。'
        : 'Only introduce new named characters, rules, organizations, lore reveals, props, or mechanics when they are explicitly required by this chapter task or already foreshadowed in context.',
      forbiddenNovelty: isOpeningChapter
        ? '不得新增任务未列出的专名、背景、规则、机制、组织、关键道具或事件。'
        : 'Do not invent rescue rules, unforeshadowed permissions, new core canon mechanisms, arbitrary names for unknown people, or early explanations of protected mysteries.'
    }

    const userPrompt = [
      'You are planning the target chapter for a long-form novel pipeline.',
      'Return strict JSON only with keys:',
      '{"chapterTitle":"","chapterGoal":"","conflictToPush":"","characterBeats":"","foreshadowingToUse":"","foreshadowingNotToReveal":"","endingHook":"","readerEmotionTarget":"","estimatedWordCount":"","openingContinuationBeat":"","carriedPhysicalState":"","carriedEmotionalState":"","unresolvedMicroTensions":"","forbiddenResets":"","allowedNovelty":"","forbiddenNovelty":""}',
      isOpeningChapter
        ? 'The JSON schema retains opening boundary fields. Fill them only with explicit no-prior-chapter boundaries and task-listed daily friction; they are not permission to invent continuity, backstory, or unresolved plot tension.'
        : 'The plan must include continuity bridge fields: openingContinuationBeat, carriedPhysicalState, carriedEmotionalState, unresolvedMicroTensions, forbiddenResets.',
      isOpeningChapter
        ? 'The plan must include allowedNovelty and forbiddenNovelty. For chapter 1, named people/places, backstory, relationships, plot events, clues, and mechanisms are task-closed. Unnamed mundane vendors/bystanders, generic ingredients/utensils, and routine sensory/action details are allowed only when they carry no lore, clue, or hook.'
        : 'The plan must include allowedNovelty and forbiddenNovelty. New named characters, rules, organizations, lore, and key props require explicit task permission or prior setup.',
      isOpeningChapter
        ? 'Opening-chapter hard rules: this is chapter 1. Establish the task-specified scene naturally. Do not invent a previous chapter, prior hook, off-page action, carried injury, or emotional aftermath.'
        : 'Continuity hard rules: first scene must continue the previous chapter ending, preserve physical/emotional state, answer or carry the last hook within the first 300 Chinese characters, and avoid "meanwhile" or "some time later" unless explicitly requested.',
      isOpeningChapter
        ? `Mode: ${options.mode}. Chapter 1 remains plot-closed in every mode: organize the task-listed daily situation, allow only non-plot mundane texture, and do not propose extra conflict or foreshadowing.`
        : `Mode: ${options.mode}. conservative = obey canon and add little; standard = moderate progress; aggressive = may propose new conflict/foreshadowing but mark it as candidate only.`,
      isOpeningChapter
        ? 'No existing foreshadowing is selected for this opening chapter. Do not add, hint at, advance, or explain any unlisted clue.'
        : 'Foreshadowing treatment modes in context are binding: hidden/pause must not be used by default; hint stays subtle; advance cannot reveal truth; payoff alone may resolve.',
      'The authoritative chapter task below is the immutable creative contract for this job. Preserve every specific instruction. If context contains generic or stale direction that conflicts with it, the authoritative chapter task wins.',
      `Authoritative chapter task:\n${JSON.stringify(chapterTask, null, 2)}`,
      `Target chapter: ${options.targetChapterOrder}`,
      `Expected word count: ${chapterTask.targetWordCount || options.estimatedWordCount}`,
      `Reader emotion target: ${chapterTask.readerEmotion || options.readerEmotionTarget || 'not specified'}`,
      '',
      `Context:\n${context}`
    ].join('\n')

    const result = await this.client.requestJson(
      isOpeningChapter ? OPENING_CHAPTER_PLAN_SYSTEM_PROMPT : CHAPTER_PLAN_SYSTEM_PROMPT,
      userPrompt,
      ensureChapterPlan,
      fallback,
      undefined,
      validateChapterPlanSchema
    )
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
    options: { mode: PipelineMode; targetChapterOrder: number; estimatedWordCount: string; readerEmotionTarget: string; chapterTask: ChapterTask; authoritativeChapterTask?: boolean; retryReason?: string; previousDraft?: ChapterDraftResult; retryIssueTypes?: string[] }
  ): Promise<AIResult<ChapterDraftResult>> {
    const chapterTask = options.chapterTask
    const isOpeningChapter = options.targetChapterOrder === 1
    const useCompactOpeningPrompt = isOpeningChapter && options.authoritativeChapterTask === true
    const draftScopeRules = isOpeningChapter
      ? [
          'Scope hard rules: named people/places, backstory, relationships, plot events, clues, and mechanisms must come from the authoritative task. You may add unnamed ordinary vendors/bystanders, generic ingredients/utensils, and routine daily details only when they introduce no lore, clue, solution, or hook.',
          'No existing foreshadowing is selected. Do not invent or hint at an unlisted clue, backstory, mechanism, organization, key prop, or named person.',
          'Do not solve a small conflict with a new convenience introduced only in this draft.'
        ]
      : [
          'Redundancy hard rules: do not repeat already-known environment descriptions or re-explain prior mechanisms; add only necessary new information.',
          'Foreshadowing treatment rules are mandatory: hidden/pause must not advance; hint stays subtle; advance cannot reveal truth; payoff alone may resolve.',
          'Novelty hard rules: do not invent unforeshadowed rescue rules, temporary permissions, organizations, ranks, or core lore to solve the current crisis.',
          'Crisis resolution must come from provided rules, already foreshadowed clues, existing character abilities/resources, or mechanisms explicitly allowed in the chapter plan.',
          'Any explicitly allowed new rule or mechanism must create cost, risk, or complication; it cannot be a free convenience.',
          'Do not name unknown people unless the plan allows it or the context already identifies them.',
          'Do not convert unauthorized new lore into stable canon; any new entity, rule, or lore remains a pending candidate until human confirmation.'
        ]
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

    const userPrompt = useCompactOpeningPrompt ? buildAuthoritativeOpeningDraftPrompt(chapterTask, options.retryReason, options.previousDraft, options.retryIssueTypes) : [
      'You are drafting a novel chapter from an approved chapter plan.',
      'Return strict JSON only: {"title":"","body":""}',
      'The body must be complete prose, not an outline, summary, beat sheet, checklist, or bracketed notes.',
      isOpeningChapter
        ? 'Write a full chapter with scenes, actions, dialogue, and concrete daily details. End only on the task-specified closing beat; do not intensify it into an extra danger, destiny, or web-fiction hook.'
        : 'Write a full chapter with scenes, actions, dialogue, sensory details, and an ending hook.',
      'Do not stop mid-sentence. If the requested length is too high for the token budget, produce a shorter but complete chapter ending cleanly.',
      'Do not reveal foreshadowing listed as forbidden.',
      isOpeningChapter
        ? 'Opening-chapter hard rules: this is chapter 1. Start naturally from the authoritative task. Do not invent a previous chapter, prior hook, off-page action, carried injury, or emotional aftermath.'
        : 'Continuity hard rules: first scene must continue the previous chapter ending; do not restart the chapter with a fresh world introduction; preserve carried physical and emotional state; answer or carry the previous hook within the first 300 Chinese characters; avoid "meanwhile" / "some time later" unless the plan explicitly asks for a time jump.',
      ...draftScopeRules,
      'Do not change long-term canon, power rules, or stable worldbuilding.',
      isOpeningChapter
        ? 'Keep behavior consistent only with the task-listed relationship and immediate situation; do not infer a pre-existing dramatic arc or carried state.'
        : 'Do not make characters suddenly OOC. Preserve current dramatic state.',
      'The authoritative chapter task below is the immutable creative contract for this job. Follow every specific instruction. If the generated chapter plan or context conflicts with it, the authoritative chapter task wins.',
      `Authoritative chapter task:\n${JSON.stringify(chapterTask, null, 2)}`,
      `Mode: ${options.mode}`,
      `Target chapter: ${options.targetChapterOrder}`,
      `Expected word count: ${chapterTask.targetWordCount || options.estimatedWordCount}`,
      `Reader emotion target: ${chapterTask.readerEmotion || options.readerEmotionTarget || chapterPlan.readerEmotionTarget}`,
      options.retryReason
        ? options.previousDraft?.body.trim()
          ? `Previous draft was rejected because: ${options.retryReason}. Revise the supplied draft in place, preserve compliant facts and scene order, and return the complete revised prose chapter. Do not return a patch.`
          : `Previous draft was rejected because: ${options.retryReason}. Regenerate a complete prose chapter now.`
        : '',
      '',
      `Chapter plan:\n${JSON.stringify(chapterPlan, null, 2)}`,
      '',
      `Context:\n${context}`,
      options.retryReason && options.previousDraft?.body.trim()
        ? `\nPrevious draft to revise (not an additional canon source):\n${JSON.stringify(options.previousDraft, null, 2)}`
        : ''
    ].join('\n')

    return this.client.requestJson(
      isOpeningChapter ? OPENING_CHAPTER_DRAFT_SYSTEM_PROMPT : CHAPTER_DRAFT_SYSTEM_PROMPT,
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
