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
  Foreshadowing,
  ForeshadowingExtractionResult,
  NextChapterSuggestions,
  PipelineMode,
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

export class AIService {
  private readonly chapterReviewAI: ChapterReviewAI
  private readonly generationPipelineAI: GenerationPipelineAI
  private readonly qualityGateAI: QualityGateAI
  private readonly revisionAI: RevisionAI
  private readonly storyDirectionAI: StoryDirectionAI

  constructor(settings?: AppSettings) {
    const client = new AIClient(settings)
    this.chapterReviewAI = new ChapterReviewAI(client)
    this.generationPipelineAI = new GenerationPipelineAI(client)
    this.qualityGateAI = new QualityGateAI(client)
    this.revisionAI = new RevisionAI(client)
    this.storyDirectionAI = new StoryDirectionAI(client)
  }

  generateChapterReview(chapterText: string, context: string): Promise<AIResult<ChapterReviewDraft>> {
    return this.chapterReviewAI.generateChapterReview(chapterText, context)
  }

  generateChapterPlan(
    context: string,
    options: { mode: PipelineMode; targetChapterOrder: number; estimatedWordCount: string; readerEmotionTarget: string }
  ): Promise<AIResult<ChapterPlan>> {
    return this.generationPipelineAI.generateChapterPlan(context, options)
  }

  generateChapterDraft(
    chapterPlan: ChapterPlan,
    context: string,
    options: { mode: PipelineMode; estimatedWordCount: string; readerEmotionTarget: string; retryReason?: string }
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
    chapterPlan: ChapterPlan | null
  ): Promise<AIResult<QualityGateEvaluation>> {
    return this.qualityGateAI.generateQualityGateReport(chapterDraft, context, chapterPlan)
  }

  generateRevisionCandidate(
    chapterDraft: ChapterDraftResult,
    issue: QualityGateIssue,
    context: string
  ): Promise<AIResult<{ revisionInstruction: string; revisedText: string }>> {
    return this.qualityGateAI.generateRevisionCandidate(chapterDraft, issue, context)
  }

  generateRevision(request: RevisionGenerationRequest, context: string): Promise<AIResult<RevisionResult>> {
    return this.revisionAI.generateRevision(request, context)
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
