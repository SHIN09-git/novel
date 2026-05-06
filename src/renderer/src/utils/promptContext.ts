import { defaultModulesForMode } from '../../../shared/defaults'
import { shouldRecommendForeshadowing } from '../../../shared/foreshadowingTreatment'
import type { AppData, Character, ContextBudgetMode, ContextBudgetProfile, ContextSelectionResult, Foreshadowing, ID, Project } from '../../../shared/types'
import { ContextBudgetManager } from '../../../services/ContextBudgetManager'
import { parseChapterNumbersFromText, PromptBuilderService } from '../../../services/PromptBuilderService'
import { newId, now } from './format'
import { projectData } from './projectData'

export function expectedPayoffNearText(text: string, targetChapterOrder: number): boolean {
  const numbers = parseChapterNumbersFromText(text)
  return numbers.some((num) => Math.abs(num - targetChapterOrder) <= 3)
}

export function recommendedForeshadowings(items: Foreshadowing[], targetChapterOrder: number): Foreshadowing[] {
  return items.filter((item) => shouldRecommendForeshadowing(item, expectedPayoffNearText(item.expectedPayoff, targetChapterOrder)))
}

export function recommendedCharacters(characters: Character[], foreshadowings: Foreshadowing[]): Character[] {
  const relatedIds = new Set(foreshadowings.flatMap((item) => item.relatedCharacterIds))
  return characters.filter((character) => character.isMain || relatedIds.has(character.id))
}

export function createContextBudgetProfile(
  projectId: ID,
  mode: ContextBudgetMode,
  maxTokens: number,
  name = '临时预算方案'
): ContextBudgetProfile {
  const timestamp = now()
  const isLight = mode === 'light'
  const isFull = mode === 'full'
  return {
    id: newId(),
    projectId,
    name,
    maxTokens,
    mode,
    includeRecentChaptersCount: isLight ? 2 : isFull ? 5 : 3,
    includeStageSummariesCount: isLight ? 0 : isFull ? 8 : 2,
    includeMainCharacters: true,
    includeRelatedCharacters: !isLight,
    includeForeshadowingWeights: isLight ? ['high', 'payoff'] : isFull ? ['low', 'medium', 'high', 'payoff'] : ['medium', 'high', 'payoff'],
    includeTimelineEventsCount: isLight ? 0 : isFull ? 20 : 6,
    styleSampleMaxChars: isLight ? 600 : isFull ? 2000 : 1200,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function selectBudgetContext(
  project: Project,
  data: AppData,
  targetChapterOrder: number,
  budgetProfile: ContextBudgetProfile,
  forcedSelection: { characterIds?: ID[]; foreshadowingIds?: ID[] } = {}
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
  budgetProfile?: ContextBudgetProfile
): string {
  const scoped = projectData(data, project.id)
  const autoForeshadowings = recommendedForeshadowings(scoped.foreshadowings, targetChapterOrder)
  const autoCharacters = recommendedCharacters(scoped.characters, autoForeshadowings)
  return PromptBuilderService.build({
    project,
    bible: scoped.bible,
    chapters: scoped.chapters,
    characters: scoped.characters,
    characterStateLogs: scoped.characterStateLogs,
    foreshadowings: scoped.foreshadowings,
      timelineEvents: scoped.timelineEvents,
      stageSummaries: scoped.stageSummaries,
      chapterContinuityBridges: scoped.chapterContinuityBridges,
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
    budgetProfile
  })
}
