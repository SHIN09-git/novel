import type {
  AIResult,
  Character,
  Chapter,
  Foreshadowing,
  Project,
  StageSummary,
  StoryBible,
  StoryDirectionGenerationResult,
  StoryDirectionHorizon,
  StoryDirectionPolishResult,
  TimelineEvent
} from '../../shared/types'
import type { AIClient } from './AIClient'

export interface PolishStoryDirectionIdeaInput {
  userRawIdea: string
  project: Project
  recentStageSummaries: StageSummary[]
  activeGuide?: { title: string; aiGuidance: string } | null
}

export interface GenerateStoryDirectionGuideInput {
  project: Project
  horizonChapters: StoryDirectionHorizon
  startChapterOrder: number
  userRawIdea: string
  userPolishedIdea: string
  stageSummaries: StageSummary[]
  recentChapters: Chapter[]
  activeForeshadowings: Foreshadowing[]
  characters: Character[]
  timelineEvents: TimelineEvent[]
  storyBible: StoryBible | null
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : []
}

function normalizePolish(value: unknown): StoryDirectionPolishResult {
  const item = asObject(value)
  return {
    polishedIdea: asString(item.polishedIdea),
    preservedUserIntent: asString(item.preservedUserIntent),
    assumptions: asStringArray(item.assumptions),
    constraints: asStringArray(item.constraints),
    warnings: asStringArray(item.warnings)
  }
}

function normalizeGeneration(value: unknown): StoryDirectionGenerationResult {
  const item = asObject(value)
  const beats = Array.isArray(item.chapterBeats) ? item.chapterBeats.map(asObject) : []
  return {
    title: asString(item.title),
    aiGuidance: asString(item.aiGuidance),
    strategicTheme: asString(item.strategicTheme),
    coreDramaticPromise: asString(item.coreDramaticPromise),
    emotionalCurve: asString(item.emotionalCurve),
    characterArcDirectives: asString(item.characterArcDirectives),
    foreshadowingDirectives: asString(item.foreshadowingDirectives),
    constraints: asString(item.constraints),
    forbiddenTurns: asString(item.forbiddenTurns),
    chapterBeats: beats.map((beat, index) => ({
      chapterOffset: typeof beat.chapterOffset === 'number' ? beat.chapterOffset : index + 1,
      chapterOrder: typeof beat.chapterOrder === 'number' ? beat.chapterOrder : null,
      goal: asString(beat.goal),
      conflict: asString(beat.conflict),
      characterFocus: asString(beat.characterFocus),
      foreshadowingToUse: asString(beat.foreshadowingToUse),
      foreshadowingNotToReveal: asString(beat.foreshadowingNotToReveal),
      suspenseToKeep: asString(beat.suspenseToKeep),
      endingHook: asString(beat.endingHook),
      readerEmotion: asString(beat.readerEmotion),
      mustAvoid: asString(beat.mustAvoid),
      notes: asString(beat.notes)
    })),
    warnings: asStringArray(item.warnings)
  }
}

function fallbackPolish(input: PolishStoryDirectionIdeaInput): StoryDirectionPolishResult {
  const idea = input.userRawIdea.trim()
  return {
    polishedIdea: idea,
    preservedUserIntent: idea,
    assumptions: [],
    constraints: ['未调用远程 AI；保留用户原始想法作为可编辑纲领。'],
    warnings: idea ? [] : ['用户尚未输入剧情走向；可以直接基于阶段摘要生成 AI 导向。']
  }
}

function fallbackGeneration(input: GenerateStoryDirectionGuideInput): StoryDirectionGenerationResult {
  const guidance = input.userPolishedIdea.trim() || input.userRawIdea.trim() || '承接当前阶段摘要，稳步推进下一组章节。'
  return {
    title: `第 ${input.startChapterOrder}-${input.startChapterOrder + input.horizonChapters - 1} 章剧情导向`,
    aiGuidance: guidance,
    strategicTheme: guidance,
    coreDramaticPromise: guidance,
    emotionalCurve: '从承接余波进入新压力，再在阶段末形成新的钩子。',
    characterArcDirectives: '保持已有角色状态，不跳过上一章余波。',
    foreshadowingDirectives: '只按已有 treatmentMode 暗示、推进或回收伏笔。',
    constraints: '不得改写已发生事实；不得新增未确认硬设定。',
    forbiddenTurns: '不得使用无铺垫救命规则或临时权限解决危机。',
    chapterBeats: Array.from({ length: input.horizonChapters }, (_, index) => ({
      chapterOffset: index + 1,
      chapterOrder: input.startChapterOrder + index,
      goal: index === 0 ? guidance : '',
      conflict: '',
      characterFocus: '',
      foreshadowingToUse: '',
      foreshadowingNotToReveal: '',
      suspenseToKeep: '',
      endingHook: '',
      readerEmotion: '',
      mustAvoid: '不得违背上一章衔接、角色硬状态、伏笔 treatmentMode 和硬设定。',
      notes: ''
    })),
    warnings: ['未调用远程 AI；已生成本地保守剧情导向模板。']
  }
}

function summaryForPrompt(stageSummaries: StageSummary[]): string {
  return stageSummaries
    .slice(-6)
    .map((summary) => `第 ${summary.chapterStart}-${summary.chapterEnd} 章：${summary.plotProgress || summary.nextStageDirection}`)
    .join('\n')
}

export class StoryDirectionAI {
  constructor(private readonly client: AIClient) {}

  async polishUserStoryDirectionIdea(input: PolishStoryDirectionIdeaInput): Promise<AIResult<StoryDirectionPolishResult>> {
    const systemPrompt =
      '你是长篇小说总纲编辑。请把用户粗写的未来剧情想法润色为中期剧情纲领。只整理、澄清、压缩和增强执行性，不新增硬设定，不写正文，不替用户擅自决定不可逆重大转折。必须返回 strict JSON。'
    const userPrompt = [
      `项目：${input.project.name}`,
      `用户原始想法：${input.userRawIdea || '（无）'}`,
      `近期阶段摘要：\n${summaryForPrompt(input.recentStageSummaries) || '（暂无）'}`,
      input.activeGuide ? `当前 active 导向：${input.activeGuide.title}\n${input.activeGuide.aiGuidance}` : '',
      '请返回 JSON：{"polishedIdea":"","preservedUserIntent":"","assumptions":[],"constraints":[],"warnings":[]}'
    ]
      .filter(Boolean)
      .join('\n\n')
    return this.client.requestJson(systemPrompt, userPrompt, normalizePolish, fallbackPolish(input))
  }

  async generateStoryDirectionGuide(input: GenerateStoryDirectionGuideInput): Promise<AIResult<StoryDirectionGenerationResult>> {
    const systemPrompt =
      '你是长篇小说剧情导演。请基于用户纲领、阶段摘要、近期章节、角色、伏笔、时间线和硬设定，生成未来 5/10 章的中期剧情指导。这不是正文，不是详细大纲，而是供章节生成使用的方向性 beat sheet。不得违反已有事实；新角色、新机制、新组织、新世界观只能作为候选，不能当成稳定 canon。必须返回 strict JSON。'
    const userPrompt = [
      `项目：${input.project.name}`,
      `覆盖范围：从第 ${input.startChapterOrder} 章开始，未来 ${input.horizonChapters} 章`,
      `用户原始想法：${input.userRawIdea || '（无）'}`,
      `润色纲领：${input.userPolishedIdea || '（无）'}`,
      `阶段摘要：\n${summaryForPrompt(input.stageSummaries) || '（暂无）'}`,
      `近期章节：\n${input.recentChapters.slice(-5).map((chapter) => `第 ${chapter.order} 章 ${chapter.title}：${chapter.summary}`).join('\n')}`,
      `角色：${input.characters.map((character) => character.name).join('、')}`,
      `活跃伏笔：${input.activeForeshadowings.map((item) => `${item.title}(${item.treatmentMode}/${item.status})`).join('、')}`,
      `时间线事件：${input.timelineEvents.slice(-10).map((event) => event.title).join('、')}`,
      `硬设定：${input.storyBible?.immutableFacts || input.storyBible?.worldbuilding || '（暂无）'}`,
      '每个 chapterBeat 必须包含 chapterOffset、chapterOrder、goal、conflict、characterFocus、foreshadowingToUse、foreshadowingNotToReveal、suspenseToKeep、endingHook、readerEmotion、mustAvoid、notes。',
      '请返回 JSON：{"title":"","aiGuidance":"","strategicTheme":"","coreDramaticPromise":"","emotionalCurve":"","characterArcDirectives":"","foreshadowingDirectives":"","constraints":"","forbiddenTurns":"","chapterBeats":[],"warnings":[]}'
    ]
      .filter(Boolean)
      .join('\n\n')
    return this.client.requestJson(systemPrompt, userPrompt, normalizeGeneration, fallbackGeneration(input))
  }
}
