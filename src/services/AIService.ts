import type {
  AIResult,
  AppSettings,
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
  StageSummary
} from '../shared/types'
import type { QualityGateEvaluation } from './QualityGateService'

const REVIEW_SYSTEM_PROMPT = [
  '你不是小说续写助手，而是小说编辑和长篇上下文管理员。',
  '你的任务是从章节正文中提取对后续创作有长期影响的信息。',
  '不要把普通描写、一次性情绪、无后续影响的对白都记录下来。',
  '优先提取会影响人物关系、主线推进、伏笔回收、世界规则和未来冲突的信息。',
  '必须输出严格 JSON。不要输出 Markdown、解释、代码块或额外废话。'
].join('\n')

function fallbackResult<T>(data: T, error = '未配置 API Key，已生成本地结构化模板。'): AIResult<T> {
  return { ok: true, usedAI: false, data, error }
}

function parseJsonObject(rawText: string): unknown {
  const trimmed = rawText.trim()
  if (!trimmed) throw new Error('AI 返回为空。')

  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
    if (fenced) return JSON.parse(fenced)

    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1))
    }
    throw new Error('无法从 AI 返回中解析 JSON。')
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeWeight(value: unknown): ForeshadowingWeight {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'payoff') return value
  if (value === '低') return 'low'
  if (value === '中') return 'medium'
  if (value === '高') return 'high'
  if (value === '回收') return 'payoff'
  return 'medium'
}

function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function ensureChapterReview(value: unknown): ChapterReviewDraft {
  const obj = asObject(value)
  return {
    summary: asString(obj.summary),
    newInformation: asString(obj.newInformation),
    characterChanges: asString(obj.characterChanges),
    newForeshadowing: asString(obj.newForeshadowing),
    resolvedForeshadowing: asString(obj.resolvedForeshadowing),
    endingHook: asString(obj.endingHook),
    riskWarnings: asString(obj.riskWarnings)
  }
}

function ensureCharacterSuggestions(value: unknown, characterIds: Set<ID>): CharacterStateSuggestion[] {
  const list = Array.isArray(value) ? value : asObject(value).suggestions
  if (!Array.isArray(list)) return []

  return list
    .map((item) => asObject(item))
    .filter((item) => characterIds.has(asString(item.characterId)))
    .map((item) => ({
      characterId: asString(item.characterId),
      changeSummary: asString(item.changeSummary),
      newCurrentEmotionalState: asString(item.newCurrentEmotionalState),
      newRelationshipWithProtagonist: asString(item.newRelationshipWithProtagonist),
      newNextActionTendency: asString(item.newNextActionTendency),
      relatedChapterId: asString(item.relatedChapterId) || null,
      confidence: Math.max(0, Math.min(1, asNumber(item.confidence, 0.5)))
    }))
}

function ensureCandidate(value: unknown, validCharacterIds: Set<ID>): ForeshadowingCandidate {
  const obj = asObject(value)
  return {
    title: asString(obj.title) || '未命名伏笔',
    description: asString(obj.description),
    firstChapterOrder: normalizeNullableNumber(obj.firstChapterOrder),
    suggestedWeight: normalizeWeight(obj.suggestedWeight),
    expectedPayoff: asString(obj.expectedPayoff),
    relatedCharacterIds: asStringArray(obj.relatedCharacterIds).filter((id) => validCharacterIds.has(id)),
    notes: asString(obj.notes)
  }
}

function ensureForeshadowingExtraction(value: unknown, foreshadowingIds: Set<ID>, characterIds: Set<ID>): ForeshadowingExtractionResult {
  const obj = asObject(value)
  const statusChanges = Array.isArray(obj.statusChanges) ? obj.statusChanges : []
  const normalizedChanges: ForeshadowingStatusChangeSuggestion[] = statusChanges
    .map((item) => asObject(item))
    .filter((item) => foreshadowingIds.has(asString(item.foreshadowingId)))
    .map((item) => {
      const status = asString(item.suggestedStatus)
      return {
        foreshadowingId: asString(item.foreshadowingId),
        suggestedStatus:
          status === 'resolved' || status === 'partial' || status === 'abandoned' || status === 'unresolved'
            ? status
            : 'partial',
        evidenceText: asString(item.evidenceText),
        notes: asString(item.notes),
        confidence: Math.max(0, Math.min(1, asNumber(item.confidence, 0.5)))
      }
    })

  const advancedForeshadowingIds = asStringArray(obj.advancedForeshadowingIds).filter((id) => foreshadowingIds.has(id))
  const resolvedForeshadowingIds = asStringArray(obj.resolvedForeshadowingIds).filter((id) => foreshadowingIds.has(id))
  for (const id of advancedForeshadowingIds) {
    if (!normalizedChanges.some((change) => change.foreshadowingId === id)) {
      normalizedChanges.push({ foreshadowingId: id, suggestedStatus: 'partial', evidenceText: '', notes: '', confidence: 0.5 })
    }
  }
  for (const id of resolvedForeshadowingIds) {
    if (!normalizedChanges.some((change) => change.foreshadowingId === id)) {
      normalizedChanges.push({ foreshadowingId: id, suggestedStatus: 'resolved', evidenceText: '', notes: '', confidence: 0.5 })
    }
  }

  return {
    newForeshadowingCandidates: Array.isArray(obj.newForeshadowingCandidates)
      ? obj.newForeshadowingCandidates.map((item) => ensureCandidate(item, characterIds))
      : [],
    advancedForeshadowingIds,
    resolvedForeshadowingIds,
    abandonedForeshadowingCandidates: Array.isArray(obj.abandonedForeshadowingCandidates)
      ? obj.abandonedForeshadowingCandidates.map((item) => ensureCandidate(item, characterIds))
      : [],
    statusChanges: normalizedChanges
  }
}

function ensureNextSuggestions(value: unknown): NextChapterSuggestions {
  const obj = asObject(value)
  return {
    nextChapterGoal: asString(obj.nextChapterGoal),
    conflictToPush: asString(obj.conflictToPush),
    suspenseToKeep: asString(obj.suspenseToKeep),
    foreshadowingToHint: asString(obj.foreshadowingToHint),
    foreshadowingNotToReveal: asString(obj.foreshadowingNotToReveal),
    suggestedEndingHook: asString(obj.suggestedEndingHook),
    readerEmotionTarget: asString(obj.readerEmotionTarget)
  }
}

function ensureChapterPlan(value: unknown): ChapterPlan {
  const obj = asObject(value)
  return {
    chapterTitle: asString(obj.chapterTitle) || '未命名章节',
    chapterGoal: asString(obj.chapterGoal),
    conflictToPush: asString(obj.conflictToPush),
    characterBeats: asString(obj.characterBeats),
    foreshadowingToUse: asString(obj.foreshadowingToUse),
    foreshadowingNotToReveal: asString(obj.foreshadowingNotToReveal),
    endingHook: asString(obj.endingHook),
    readerEmotionTarget: asString(obj.readerEmotionTarget),
    estimatedWordCount: asString(obj.estimatedWordCount)
  }
}

function ensureChapterDraft(value: unknown): ChapterDraftResult {
  const obj = asObject(value)
  return {
    title: asString(obj.title) || asString(obj.chapterTitle) || '未命名章节',
    body:
      asString(obj.body) ||
      asString(obj.chapterBody) ||
      asString(obj.chapterText) ||
      asString(obj.content) ||
      asString(obj.text) ||
      asString(obj.draft) ||
      asString(obj.markdown)
  }
}

function rawTextAsChapterDraft(rawText: string, fallbackTitle: string): ChapterDraftResult | null {
  const trimmed = rawText.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/```(?:json|markdown|md|text)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const body = fenced || trimmed
  if (!body) return null
  if (/^\s*[\[{]/.test(body) || /"(?:body|chapterBody|chapterText|content)"\s*:/.test(body)) return null
  return {
    title: fallbackTitle || '未命名章节',
    body
  }
}

function isTruncatedFinishReason(value: string | undefined): boolean {
  return /length|max[_-]?tokens|token_limit/i.test(value ?? '')
}

function normalizeSeverity(value: unknown): ConsistencySeverity {
  if (value === 'low' || value === 'medium' || value === 'high') return value
  return 'medium'
}

function normalizeIssueCategory(value: unknown): ConsistencyReviewIssue['category'] {
  if (
    value === 'timeline' ||
    value === 'setting' ||
    value === 'character_ooc' ||
    value === 'foreshadowing' ||
    value === 'pacing' ||
    value === 'reader_emotion'
  ) {
    return value
  }
  return 'setting'
}

function ensureConsistencyReview(value: unknown): ConsistencyReviewData {
  const obj = asObject(value)
  const issues = Array.isArray(obj.issues)
    ? obj.issues.map((item) => {
        const issue = asObject(item)
        return {
          category: normalizeIssueCategory(issue.category),
          severity: normalizeSeverity(issue.severity),
          description: asString(issue.description),
          evidence: asString(issue.evidence),
          suggestion: asString(issue.suggestion)
        }
      })
    : []

  return {
    timelineProblems: asStringArray(obj.timelineProblems),
    settingConflicts: asStringArray(obj.settingConflicts),
    characterOOC: asStringArray(obj.characterOOC),
    foreshadowingMisuse: asStringArray(obj.foreshadowingMisuse),
    pacingProblems: asStringArray(obj.pacingProblems),
    emotionPayoffProblems: asStringArray(obj.emotionPayoffProblems),
    suggestions: asStringArray(obj.suggestions),
    severitySummary: normalizeSeverity(obj.severitySummary),
    issues
  }
}

function clampScore(value: unknown, fallback = 70): number {
  return Math.max(0, Math.min(100, Math.round(asNumber(value, fallback))))
}

function ensureDimensionScores(value: unknown): QualityGateDimensionScores {
  const obj = asObject(value)
  return {
    plotCoherence: clampScore(obj.plotCoherence),
    characterConsistency: clampScore(obj.characterConsistency),
    foreshadowingControl: clampScore(obj.foreshadowingControl),
    styleMatch: clampScore(obj.styleMatch),
    pacing: clampScore(obj.pacing),
    emotionalPayoff: clampScore(obj.emotionalPayoff),
    originality: clampScore(obj.originality),
    promptCompliance: clampScore(obj.promptCompliance)
  }
}

function ensureQualityGateIssue(value: unknown): QualityGateIssue {
  const obj = asObject(value)
  return {
    severity: normalizeSeverity(obj.severity),
    type: asString(obj.type) || 'general',
    description: asString(obj.description),
    evidence: asString(obj.evidence),
    suggestedFix: asString(obj.suggestedFix)
  }
}

function ensureQualityGateEvaluation(value: unknown): QualityGateEvaluation {
  const obj = asObject(value)
  const dimensions = ensureDimensionScores(obj.dimensions)
  const overallScore = clampScore(obj.overallScore)
  const issues = Array.isArray(obj.issues) ? obj.issues.map(ensureQualityGateIssue) : []
  return {
    overallScore,
    pass: typeof obj.pass === 'boolean' ? obj.pass : overallScore >= 75 && !issues.some((issue) => issue.severity === 'high'),
    dimensions,
    issues,
    requiredFixes: asStringArray(obj.requiredFixes),
    optionalSuggestions: asStringArray(obj.optionalSuggestions)
  }
}

function ensureRevisionCandidate(value: unknown): { revisionInstruction: string; revisedText: string } {
  const obj = asObject(value)
  return {
    revisionInstruction: asString(obj.revisionInstruction),
    revisedText: asString(obj.revisedText)
  }
}

export class AIService {
  constructor(private readonly settings?: AppSettings) {}

  private hasApiConfig(): boolean {
    if (!this.settings) return false
    return this.settings.apiProvider === 'local' || this.settings.apiKey.trim().length > 0
  }

  private async requestJson<T>(
    systemPrompt: string,
    userPrompt: string,
    normalize: (value: unknown) => T,
    fallback: T,
    parseFallback?: (rawText: string) => T | null
  ): Promise<AIResult<T>> {
    if (!this.settings || !this.hasApiConfig()) {
      return fallbackResult(fallback)
    }

    try {
      const response = await window.novelAPI.chatCompletion({
        settings: this.settings,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })

      if (!response.ok || !response.content) {
        return { ok: false, usedAI: true, data: null, error: response.error || 'AI 调用失败。' }
      }

      if (isTruncatedFinishReason(response.finishReason)) {
        return {
          ok: false,
          usedAI: true,
          data: null,
          rawText: response.content,
          finishReason: response.finishReason,
          error: 'AI 输出被 max tokens 截断。请提高设置页 Max Tokens，或降低章节预计字数后重试。'
        }
      }

      try {
        return {
          ok: true,
          usedAI: true,
          data: normalize(parseJsonObject(response.content)),
          rawText: response.content,
          finishReason: response.finishReason
        }
      } catch (error) {
        const fallbackData = parseFallback?.(response.content)
        if (fallbackData) {
          return {
            ok: true,
            usedAI: true,
            data: fallbackData,
            rawText: response.content,
            finishReason: response.finishReason,
            parseError: error instanceof Error ? error.message : String(error),
            error: 'AI 没有返回严格 JSON，已将原始正文保留为章节草稿。'
          }
        }
        return {
          ok: false,
          usedAI: true,
          data: null,
          rawText: response.content,
          finishReason: response.finishReason,
          parseError: error instanceof Error ? error.message : String(error),
          error: '解析失败，可手动复制原始返回。'
        }
      }
    } catch (error) {
      return { ok: false, usedAI: true, data: null, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async generateChapterReview(chapterText: string, context: string): Promise<AIResult<ChapterReviewDraft>> {
    const fallback: ChapterReviewDraft = {
      summary: '本章剧情摘要：\n- ',
      newInformation: '本章新增信息：\n- ',
      characterChanges: '本章角色变化：\n- ',
      newForeshadowing: '本章新增伏笔：\n- ',
      resolvedForeshadowing: '本章已回收伏笔：\n- ',
      endingHook: '本章结尾钩子：\n- ',
      riskWarnings: '本章风险提醒：\n- '
    }
    const userPrompt = [
      '请阅读章节正文与上下文，输出严格 JSON，字段必须为：',
      '{"summary":"","newInformation":"","characterChanges":"","newForeshadowing":"","resolvedForeshadowing":"","endingHook":"","riskWarnings":""}',
      '',
      `上下文：\n${context || '暂无'}`,
      '',
      `章节正文：\n${chapterText || '暂无正文'}`
    ].join('\n')

    return this.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureChapterReview, fallback)
  }

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
      estimatedWordCount: options.estimatedWordCount
    }

    const userPrompt = [
      'You are planning the next chapter for a long-form novel pipeline.',
      'Return strict JSON only with keys:',
      '{"chapterTitle":"","chapterGoal":"","conflictToPush":"","characterBeats":"","foreshadowingToUse":"","foreshadowingNotToReveal":"","endingHook":"","readerEmotionTarget":"","estimatedWordCount":""}',
      `Mode: ${options.mode}. conservative = obey canon and add little; standard = moderate progress; aggressive = may propose new conflict/foreshadowing but mark it as candidate only.`,
      `Target chapter: ${options.targetChapterOrder}`,
      `Expected word count: ${options.estimatedWordCount}`,
      `Reader emotion target: ${options.readerEmotionTarget || 'not specified'}`,
      '',
      `Context:\n${context}`
    ].join('\n')

    return this.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureChapterPlan, fallback)
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
        `预计字数：${chapterPlan.estimatedWordCount || options.estimatedWordCount}`
      ].join('\n')
    }

    const userPrompt = [
      'You are drafting a novel chapter from an approved chapter plan.',
      'Return strict JSON only: {"title":"","body":""}',
      'The body must be complete prose, not an outline, summary, beat sheet, checklist, or bracketed notes.',
      'Write a full chapter with scenes, actions, dialogue, sensory details, and an ending hook.',
      'Do not stop mid-sentence. If the requested length is too high for the token budget, produce a shorter but complete chapter ending cleanly.',
      'Do not reveal foreshadowing listed as forbidden.',
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

    return this.requestJson(
      REVIEW_SYSTEM_PROMPT,
      userPrompt,
      ensureChapterDraft,
      fallback,
      (rawText) => rawTextAsChapterDraft(rawText, chapterPlan.chapterTitle || fallback.title)
    )
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

    return this.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, (value) => ensureCharacterSuggestions(value, characterIds), fallback)
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
      '输出严格 JSON：{"newForeshadowingCandidates":[],"advancedForeshadowingIds":[],"resolvedForeshadowingIds":[],"abandonedForeshadowingCandidates":[],"statusChanges":[{"foreshadowingId":"","suggestedStatus":"partial","evidenceText":"","notes":"","confidence":0.0}]}',
      'newForeshadowingCandidates 与 abandonedForeshadowingCandidates 的字段为：title, description, firstChapterOrder, suggestedWeight(low|medium|high|payoff), expectedPayoff, relatedCharacterIds, notes。',
      '',
      `已有伏笔：\n${existingForeshadowing.map((item) => `${item.id} | ${item.title} | ${item.status} | ${item.weight} | ${item.description}`).join('\n') || '暂无'}`,
      '',
      `可选角色：\n${characters.map((character) => `${character.id} | ${character.name}`).join('\n') || '暂无'}`,
      '',
      `上下文：\n${context || '暂无'}`,
      '',
      `章节正文：\n${chapterText || '暂无正文'}`
    ].join('\n')

    return this.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, (value) => ensureForeshadowingExtraction(value, foreshadowingIds, characterIds), fallback)
  }

  async generateNextChapterSuggestions(
    chapter: Chapter,
    projectContext: string
  ): Promise<AIResult<NextChapterSuggestions>> {
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

    return this.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureNextSuggestions, fallback)
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
      'You are a consistency editor for a long-form novel.',
      'Review the drafted chapter against the context. Return strict JSON only with keys:',
      '{"timelineProblems":[],"settingConflicts":[],"characterOOC":[],"foreshadowingMisuse":[],"pacingProblems":[],"emotionPayoffProblems":[],"suggestions":[],"severitySummary":"low","issues":[{"category":"timeline","severity":"low","description":"","evidence":"","suggestion":""}]}',
      'severitySummary must be low, medium, or high.',
      'issue.category must be one of timeline, setting, character_ooc, foreshadowing, pacing, reader_emotion.',
      '',
      `Draft title: ${chapterDraft.title}`,
      `Draft body:\n${chapterDraft.body}`,
      '',
      `Context:\n${context}`
    ].join('\n')

    return this.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureConsistencyReview, fallback)
  }

  async generateQualityGateReport(
    chapterDraft: ChapterDraftResult,
    context: string,
    chapterPlan: ChapterPlan | null
  ): Promise<AIResult<QualityGateEvaluation>> {
    const fallback: QualityGateEvaluation = {
      overallScore: 68,
      pass: false,
      dimensions: {
        plotCoherence: 70,
        characterConsistency: 70,
        foreshadowingControl: 70,
        styleMatch: 68,
        pacing: 65,
        emotionalPayoff: 65,
        originality: 68,
        promptCompliance: 70
      },
      issues: [
        {
          severity: 'medium',
          type: 'manual_review_required',
          description: '未配置 API Key 或质量门禁未调用模型，本报告为本地保守模板。',
          evidence: '缺少模型级审稿证据。',
          suggestedFix: '人工核对剧情推进、角色一致性、伏笔控制和文风后再接受草稿。'
        }
      ],
      requiredFixes: [],
      optionalSuggestions: ['人工确认草稿没有污染长期设定后再应用章节复盘或记忆更新。']
    }

    const userPrompt = [
      'You are a quality gate reviewer for a long-form novel generation pipeline.',
      'Your job is to decide whether this chapter draft is safe to move into human confirmation and memory-update review.',
      'Return strict JSON only. Do not output Markdown or explanatory text.',
      'Schema:',
      '{"overallScore":0,"pass":false,"dimensions":{"plotCoherence":0,"characterConsistency":0,"foreshadowingControl":0,"styleMatch":0,"pacing":0,"emotionalPayoff":0,"originality":0,"promptCompliance":0},"issues":[{"severity":"low","type":"","description":"","evidence":"","suggestedFix":""}],"requiredFixes":[],"optionalSuggestions":[]}',
      'Each dimension must be 0-100. pass should be false if score < 75, if characterConsistency < 70, if foreshadowingControl < 70, or if any high severity issue exists.',
      'Evaluate: plot goal progress, current character state consistency, forbidden foreshadowing reveal, unregistered major canon, style sample match, pacing, reader emotion payoff, AI cliche / over-explanation, and compliance with the chapter plan.',
      '',
      `Chapter plan:\n${JSON.stringify(chapterPlan ?? {}, null, 2)}`,
      '',
      `Draft title: ${chapterDraft.title}`,
      `Draft body:\n${chapterDraft.body}`,
      '',
      `Context:\n${context}`
    ].join('\n')

    return this.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureQualityGateEvaluation, fallback)
  }

  async generateRevisionCandidate(
    chapterDraft: ChapterDraftResult,
    issue: QualityGateIssue,
    context: string
  ): Promise<AIResult<{ revisionInstruction: string; revisedText: string }>> {
    const fallback = {
      revisionInstruction: issue.suggestedFix || '请根据质量门禁问题进行局部修订。',
      revisedText: ''
    }

    const userPrompt = [
      'You are revising a local problem in a novel chapter draft.',
      'Return strict JSON only: {"revisionInstruction":"","revisedText":""}',
      'Do not rewrite the whole chapter unless the issue requires it. Preserve canon and character state.',
      '',
      `Issue:\n${JSON.stringify(issue, null, 2)}`,
      '',
      `Draft title: ${chapterDraft.title}`,
      `Draft body:\n${chapterDraft.body}`,
      '',
      `Context:\n${context}`
    ].join('\n')

    return this.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureRevisionCandidate, fallback)
  }

  async buildNextChapterPrompt(context: string): Promise<string> {
    return context
  }
}
