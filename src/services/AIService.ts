import type {
  AIResult,
  AppSettings,
  Character,
  CharacterStateSuggestion,
  Chapter,
  ChapterDraftResult,
  ChapterPlan,
  ChapterReviewDraft,
  ChapterTask,
  ConsistencyReviewData,
  Foreshadowing,
  ForeshadowingExtractionResult,
  NextChapterSuggestions,
  PipelineMode,
  PostDraftAnalysisResult,
  QualityGateReviewScope,
  QualityGateIssue,
  RevisionGenerationRequest,
  RevisionResult,
  StageSummary,
  StoryDirectionGenerationResult,
  StoryDirectionPolishResult
} from '../shared/types'
import type { QualityGateEvaluation } from './QualityGateService'
import { AIClient } from './ai/AIClient'
import { ChapterReviewAI } from './ai/ChapterReviewAI'
import { GenerationPipelineAI } from './ai/GenerationPipelineAI'
import { QualityGateAI } from './ai/QualityGateAI'
import { RevisionAI } from './ai/RevisionAI'
import { StoryDirectionAI, type GenerateStoryDirectionGuideInput, type PolishStoryDirectionIdeaInput } from './ai/StoryDirectionAI'
import type { AIChatCompletionTransport } from './ai/AITransport'
import type { AIRequestControl } from './ai/AIJsonClient'
import type { CancelAiCallResult } from '../shared/ipc/ipcTypes'

// Renderer/business AI workflow facade. The name is kept for existing imports;
// conceptually this orchestrates feature-specific AI helpers, while the
// main-process AITransportService owns credentials and HTTP transport.
export class AIService {
  private readonly client: AIClient
  private readonly chapterReviewAI: ChapterReviewAI
  private readonly generationPipelineAI: GenerationPipelineAI
  private readonly qualityGateAI: QualityGateAI
  private readonly revisionAI: RevisionAI
  private readonly storyDirectionAI: StoryDirectionAI

  constructor(settings?: AppSettings, options: { runId?: string; transport?: AIChatCompletionTransport } = {}) {
    const client = new AIClient(settings, options.transport, options.runId)
    this.client = client
    this.chapterReviewAI = new ChapterReviewAI(client)
    this.generationPipelineAI = new GenerationPipelineAI(client)
    this.qualityGateAI = new QualityGateAI(client)
    this.revisionAI = new RevisionAI(client)
    this.storyDirectionAI = new StoryDirectionAI(client)
  }

  generateChapterReview(chapterText: string, context: string): Promise<AIResult<ChapterReviewDraft>> {
    return this.chapterReviewAI.generateChapterReview(chapterText, context)
  }

  generatePostDraftAnalysis(
    chapterText: string,
    context: string,
    characters: Character[],
    foreshadowing: Foreshadowing[]
  ): Promise<AIResult<PostDraftAnalysisResult>> {
    return this.chapterReviewAI.generatePostDraftAnalysis(chapterText, context, characters, foreshadowing)
  }

  generateChapterPlan(
    context: string,
    options: { mode: PipelineMode; targetChapterOrder: number; estimatedWordCount: string; readerEmotionTarget: string; chapterTask: ChapterTask }
  ): Promise<AIResult<ChapterPlan>> {
    return this.generationPipelineAI.generateChapterPlan(context, options)
  }

  generateChapterDraft(
    chapterPlan: ChapterPlan,
    context: string,
    options: { mode: PipelineMode; targetChapterOrder: number; estimatedWordCount: string; readerEmotionTarget: string; chapterTask: ChapterTask; authoritativeChapterTask?: boolean; retryReason?: string; previousDraft?: ChapterDraftResult; retryIssueTypes?: string[] }
  ): Promise<AIResult<ChapterDraftResult>> {
    return this.generationPipelineAI.generateChapterDraft(chapterPlan, context, options)
  }

  generateStageSummary(chapters: Chapter[]): Promise<Omit<StageSummary, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>> {
    return this.chapterReviewAI.generateStageSummary(chapters)
  }

  updateCharacterStates(
    chapterText: string,
    characters: Character[],
    context: string
  ): Promise<AIResult<CharacterStateSuggestion[]>> {
    return this.chapterReviewAI.updateCharacterStates(chapterText, characters, context)
  }

  extractForeshadowing(
    chapterText: string,
    existingForeshadowing: Foreshadowing[],
    context: string,
    characters: Character[] = []
  ): Promise<AIResult<ForeshadowingExtractionResult>> {
    return this.chapterReviewAI.extractForeshadowing(chapterText, existingForeshadowing, context, characters)
  }

  generateNextChapterSuggestions(chapter: Chapter, projectContext: string): Promise<AIResult<NextChapterSuggestions>> {
    return this.chapterReviewAI.generateNextChapterSuggestions(chapter, projectContext)
  }

  generateConsistencyReview(chapterDraft: ChapterDraftResult, context: string): Promise<AIResult<ConsistencyReviewData>> {
    return this.generationPipelineAI.generateConsistencyReview(chapterDraft, context)
  }

  generateQualityGateReport(
    chapterDraft: ChapterDraftResult,
    context: string,
    chapterPlan: ChapterPlan | null,
    reviewScope?: QualityGateReviewScope
  ): Promise<AIResult<QualityGateEvaluation>> {
    return this.qualityGateAI.generateQualityGateReport(chapterDraft, context, chapterPlan, reviewScope)
  }

  generateRevisionCandidate(
    chapterDraft: ChapterDraftResult,
    issue: QualityGateIssue,
    context: string
  ): Promise<AIResult<{ revisionInstruction: string; revisedText: string }>> {
    return this.qualityGateAI.generateRevisionCandidate(chapterDraft, issue, context)
  }

  generateRevision(
    request: RevisionGenerationRequest,
    context: string,
    requestControl?: AIRequestControl
  ): Promise<AIResult<RevisionResult>> {
    return this.revisionAI.generateRevision(request, context, requestControl)
  }

  cancelCall(runId: string, callId: string): Promise<CancelAiCallResult> {
    return this.client.cancelCall(runId, callId)
  }

  reduceAITone(chapterText: string, context: string): Promise<AIResult<RevisionResult>> {
    return this.revisionAI.reduceAITone(chapterText, context)
  }

  improveDialogue(sectionText: string, characters: Character[], context: string): Promise<AIResult<RevisionResult>> {
    return this.revisionAI.improveDialogue(sectionText, characters, context)
  }

  strengthenConflict(sectionText: string, context: string): Promise<AIResult<RevisionResult>> {
    return this.revisionAI.strengthenConflict(sectionText, context)
  }

  compressPacing(chapterText: string, context: string): Promise<AIResult<RevisionResult>> {
    return this.revisionAI.compressPacing(chapterText, context)
  }

  polishStoryDirectionIdea(input: PolishStoryDirectionIdeaInput): Promise<AIResult<StoryDirectionPolishResult>> {
    return this.storyDirectionAI.polishUserStoryDirectionIdea(input)
  }

  generateStoryDirectionGuide(input: GenerateStoryDirectionGuideInput): Promise<AIResult<StoryDirectionGenerationResult>> {
    return this.storyDirectionAI.generateStoryDirectionGuide(input)
  }

  async buildNextChapterPrompt(context: string): Promise<string> {
    return context
  }
}

export { AIService as AIWorkflowService }
