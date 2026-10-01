import { defaultModulesForMode } from '../../../shared/defaults'
import type { AppData, BuildPromptResult, ChapterTask, ContextBudgetProfile, ContextNeedPlan, ContextSelectionMode, ContextSelectionResult, ForeshadowingTreatmentMode, ID, Project, StoryDirectionGuide } from '../../../shared/types'
import { ContextBudgetManager } from '../../../services/ContextBudgetManager'
import { PromptBuilderService } from '../../../services/PromptBuilderService'
import { isolateOpeningCharacterCards, shouldIsolateOpeningLegacyContext } from '../../../services/OpeningChapterContextPolicy'
import { createPipelinePromptConfigFromSelection } from './contextSelectionConfig'
import { recommendedCharacters, recommendedForeshadowings } from './foreshadowingRecommendations'
import { projectData } from './projectData'

export { createContextBudgetProfile } from './contextBudgetProfile'
export { recommendedCharacters, recommendedForeshadowings } from './foreshadowingRecommendations'

export function selectBudgetContext(
  project: Project,
  data: AppData,
  targetChapterOrder: number,
  budgetProfile: ContextBudgetProfile,
  forcedSelection: {
    characterIds?: ID[]
    foreshadowingIds?: ID[]
    chapterTask?: Partial<ChapterTask> | null
    foreshadowingTreatmentOverrides?: Record<ID, ForeshadowingTreatmentMode>
    contextNeedPlan?: ContextNeedPlan | null
    selectionMode?: ContextSelectionMode
    isolateOpeningLegacyContext?: boolean
  } = {}
): ContextSelectionResult {
  const scoped = projectData(data, project.id)
  return ContextBudgetManager.selectContext(
    {
      project,
      bible: scoped.bible,
      chapters: scoped.chapters,
      characters: scoped.characters,
      foreshadowings: scoped.foreshadowings,
      timelineEvents: scoped.timelineEvents,
      stageSummaries: scoped.stageSummaries
    },
    targetChapterOrder,
    budgetProfile,
    forcedSelection
  )
}

export function buildPipelineContext(
  project: Project,
  data: AppData,
  targetChapterOrder: number,
  emotion: string,
  wordCount: string,
  budgetProfile?: ContextBudgetProfile,
  explicitSelection?: ContextSelectionResult,
  storyDirectionGuide?: StoryDirectionGuide | null,
  chapterTask?: ChapterTask | null,
  omitStyleSample = false
): string {
  if (budgetProfile && explicitSelection) {
    return buildPipelineContextFromSelection(project, data, targetChapterOrder, emotion, wordCount, budgetProfile, explicitSelection, null, storyDirectionGuide, chapterTask, omitStyleSample)
  }

  const scoped = projectData(data, project.id)
  const autoForeshadowings = recommendedForeshadowings(scoped.foreshadowings, targetChapterOrder)
  const autoCharacters = recommendedCharacters(scoped.characters, autoForeshadowings)
  return PromptBuilderService.build({
    project,
    bible: scoped.bible,
    chapters: scoped.chapters,
    characters: scoped.characters,
    characterStateLogs: scoped.characterStateLogs,
    characterStateFacts: scoped.characterStateFacts,
    foreshadowings: scoped.foreshadowings,
    timelineEvents: scoped.timelineEvents,
    stageSummaries: scoped.stageSummaries,
    chapterContinuityBridges: scoped.chapterContinuityBridges,
    hardCanonPack: scoped.hardCanonPacks[0] ?? null,
    config: {
      projectId: project.id,
      targetChapterOrder,
      mode: 'standard',
      modules: defaultModulesForMode('standard'),
      task: {
        goal: `生成第 ${targetChapterOrder} 章草稿`,
        conflict: '',
        suspenseToKeep: '',
        allowedPayoffs: '',
        forbiddenPayoffs: '',
        endingHook: '',
        readerEmotion: emotion,
        targetWordCount: wordCount,
        styleRequirement: project.style
      },
      selectedCharacterIds: autoCharacters.map((character) => character.id),
      selectedForeshadowingIds: autoForeshadowings.map((item) => item.id)
    },
    budgetProfile,
    storyDirectionGuide
  })
}

export function buildPipelineContextFromSelection(
  project: Project,
  data: AppData,
  targetChapterOrder: number,
  emotion: string,
  wordCount: string,
  budgetProfile: ContextBudgetProfile,
  selection: ContextSelectionResult,
  contextNeedPlan?: ContextNeedPlan | null,
  storyDirectionGuide?: StoryDirectionGuide | null,
  chapterTask?: ChapterTask | null,
  isolateLegacyCreativeContext = false
): string {
  return buildPipelineContextResultFromSelection(project, data, targetChapterOrder, emotion, wordCount, budgetProfile, selection, contextNeedPlan, storyDirectionGuide, chapterTask, isolateLegacyCreativeContext).finalPrompt
}

export function buildPipelineContextResultFromSelection(
  project: Project,
  data: AppData,
  targetChapterOrder: number,
  emotion: string,
  wordCount: string,
  budgetProfile: ContextBudgetProfile,
  selection: ContextSelectionResult,
  contextNeedPlan?: ContextNeedPlan | null,
  storyDirectionGuide?: StoryDirectionGuide | null,
  chapterTask?: ChapterTask | null,
  isolateLegacyCreativeContext = false
): BuildPromptResult {
  const scoped = projectData(data, project.id)
  const isolateOpeningLegacyContext = shouldIsolateOpeningLegacyContext(targetChapterOrder, isolateLegacyCreativeContext)
  const promptProject = isolateOpeningLegacyContext
    ? { ...project, genre: '', description: '', targetReaders: '', coreAppeal: '', style: '' }
    : project
  const promptBible = isolateOpeningLegacyContext && scoped.bible
    ? {
        ...scoped.bible,
        styleSample: '',
        ...(isolateOpeningLegacyContext
          ? { narrativeTone: '', bannedTropes: '', immutableFacts: '' }
          : {})
      }
    : scoped.bible
  const promptCharacters = isolateOpeningLegacyContext ? isolateOpeningCharacterCards(scoped.characters) : scoped.characters
  const config = createPipelinePromptConfigFromSelection({
    projectId: project.id,
    targetChapterOrder,
    emotion,
    wordCount,
    projectStyle: project.style,
    modules: defaultModulesForMode('standard'),
    selection,
    chapterTask
  })

  return PromptBuilderService.buildResult({
    project: promptProject,
    bible: promptBible,
    chapters: isolateOpeningLegacyContext ? [] : scoped.chapters,
    characters: promptCharacters,
    characterStateLogs: isolateOpeningLegacyContext ? [] : scoped.characterStateLogs,
    characterStateFacts: isolateOpeningLegacyContext ? [] : scoped.characterStateFacts,
    foreshadowings: isolateOpeningLegacyContext ? [] : scoped.foreshadowings,
    timelineEvents: isolateOpeningLegacyContext ? [] : scoped.timelineEvents,
    stageSummaries: isolateOpeningLegacyContext ? [] : scoped.stageSummaries,
    chapterContinuityBridges: isolateOpeningLegacyContext ? [] : scoped.chapterContinuityBridges,
    contextNeedPlan: isolateOpeningLegacyContext ? null : contextNeedPlan ?? null,
    storyDirectionGuide: isolateOpeningLegacyContext ? null : storyDirectionGuide ?? null,
    hardCanonPack: isolateOpeningLegacyContext ? null : scoped.hardCanonPacks[0] ?? null,
    config,
    budgetProfile,
    explicitContextSelection: selection
  })
}
