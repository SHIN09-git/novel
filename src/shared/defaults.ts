import type {
  AppData,
  AppSettings,
  ChapterTask,
  PromptMode,
  PromptModuleSelection,
  StoryBible
} from './types'

export const DEFAULT_SETTINGS: AppSettings = {
  apiProvider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-4.1',
  temperature: 0.8,
  maxTokens: 8000,
  enableAutoSummary: false,
  enableChapterDiagnostics: false,
  defaultTokenBudget: 16000,
  defaultPromptMode: 'standard',
  theme: 'system'
}

export const EMPTY_APP_DATA: AppData = {
  schemaVersion: 1,
  projects: [],
  storyBibles: [],
  chapters: [],
  characters: [],
  characterStateLogs: [],
  foreshadowings: [],
  timelineEvents: [],
  stageSummaries: [],
  promptVersions: [],
  chapterGenerationJobs: [],
  chapterGenerationSteps: [],
  generatedChapterDrafts: [],
  memoryUpdateCandidates: [],
  consistencyReviewReports: [],
  contextBudgetProfiles: [],
  qualityGateReports: [],
  revisionCandidates: [],
  settings: DEFAULT_SETTINGS
}

export function createEmptyBible(projectId: string): StoryBible {
  return {
    projectId,
    worldbuilding: '',
    corePremise: '',
    protagonistDesire: '',
    protagonistFear: '',
    mainConflict: '',
    powerSystem: '',
    bannedTropes: '',
    styleSample: '',
    narrativeTone: '',
    immutableFacts: '',
    updatedAt: new Date().toISOString()
  }
}

export function defaultModulesForMode(mode: PromptMode): PromptModuleSelection {
  if (mode === 'light') {
    return {
      bible: true,
      progress: false,
      recentChapters: true,
      characters: false,
      foreshadowing: false,
      stageSummaries: false,
      timeline: false,
      chapterTask: true,
      forbidden: true,
      outputFormat: true
    }
  }

  if (mode === 'full') {
    return {
      bible: true,
      progress: true,
      recentChapters: true,
      characters: true,
      foreshadowing: true,
      stageSummaries: true,
      timeline: true,
      chapterTask: true,
      forbidden: true,
      outputFormat: true
    }
  }

  return {
    bible: true,
    progress: true,
    recentChapters: true,
    characters: true,
    foreshadowing: true,
    stageSummaries: true,
    timeline: false,
    chapterTask: true,
    forbidden: true,
    outputFormat: true
  }
}

export function createEmptyChapterTask(): ChapterTask {
  return {
    goal: '',
    conflict: '',
    suspenseToKeep: '',
    allowedPayoffs: '',
    forbiddenPayoffs: '',
    endingHook: '',
    readerEmotion: '',
    targetWordCount: '3000-5000',
    styleRequirement: ''
  }
}

export function normalizeAppData(input: Partial<AppData>): AppData {
  return {
    ...EMPTY_APP_DATA,
    ...input,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(input.settings ?? {})
    },
    projects: input.projects ?? [],
    storyBibles: input.storyBibles ?? [],
    chapters: input.chapters ?? [],
    characters: input.characters ?? [],
    characterStateLogs: input.characterStateLogs ?? [],
    foreshadowings: input.foreshadowings ?? [],
    timelineEvents: input.timelineEvents ?? [],
    stageSummaries: input.stageSummaries ?? [],
    promptVersions: input.promptVersions ?? [],
    chapterGenerationJobs: input.chapterGenerationJobs ?? [],
    chapterGenerationSteps: input.chapterGenerationSteps ?? [],
    generatedChapterDrafts: input.generatedChapterDrafts ?? [],
    memoryUpdateCandidates: input.memoryUpdateCandidates ?? [],
    consistencyReviewReports: input.consistencyReviewReports ?? [],
    contextBudgetProfiles: input.contextBudgetProfiles ?? [],
    qualityGateReports: input.qualityGateReports ?? [],
    revisionCandidates: input.revisionCandidates ?? []
  }
}
