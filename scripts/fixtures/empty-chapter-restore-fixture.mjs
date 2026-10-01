export const EMPTY_CHAPTER_PROJECT_ID = 'project-empty'
export const OTHER_PROJECT_ID = 'project-other'
export const EMPTY_CHAPTER_ID = 'chapter-empty'
export const OTHER_CHAPTER_ID = 'chapter-other'
export const HISTORICAL_VERSION_ID = 'version-historical'

const timestamp = '2026-09-22T00:00:00.000Z'

function project(id, name) {
  return {
    id,
    name,
    genre: '',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: '',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function chapter(id, projectId, order, title, body) {
  return {
    id,
    projectId,
    order,
    title,
    body,
    summary: '',
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '',
    riskWarnings: '',
    includedInStageSummary: false,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function createEmptyChapterRestoreFixture({ body = '' } = {}) {
  return {
    schemaVersion: 3,
    projects: [project(EMPTY_CHAPTER_PROJECT_ID, 'Empty Chapter Project'), project(OTHER_PROJECT_ID, 'Other Project')],
    storyBibles: [],
    chapters: [
      chapter(EMPTY_CHAPTER_ID, EMPTY_CHAPTER_PROJECT_ID, 1, 'Empty Chapter', body),
      chapter(OTHER_CHAPTER_ID, OTHER_PROJECT_ID, 1, 'Other Chapter', 'other project body')
    ],
    characters: [],
    characterStateLogs: [],
    characterStateFacts: [],
    characterStateTransactions: [],
    characterStateChangeCandidates: [],
    foreshadowings: [],
    timelineEvents: [],
    stageSummaries: [],
    promptVersions: [],
    promptContextSnapshots: [],
    storyDirectionGuides: [],
    contextNeedPlans: [],
    chapterContinuityBridges: [],
    chapterGenerationJobs: [],
    chapterGenerationSteps: [],
    generatedChapterDrafts: [],
    memoryUpdateCandidates: [],
    consistencyReviewReports: [],
    contextBudgetProfiles: [],
    qualityGateReports: [],
    generationRunTraces: [],
    redundancyReports: [],
    revisionCandidates: [],
    revisionSessions: [],
    revisionRequests: [],
    revisionVersions: [],
    chapterVersions: [
      {
        id: HISTORICAL_VERSION_ID,
        projectId: EMPTY_CHAPTER_PROJECT_ID,
        chapterId: EMPTY_CHAPTER_ID,
        source: 'manual_revision',
        title: 'Historical Chapter',
        body: 'historical non-empty body',
        note: 'historical version',
        createdAt: '2026-09-21T00:00:00.000Z',
        baseChapterVersionId: null,
        linkedChapterCommitId: null,
        linkedRevisionCommitId: null,
        linkedGenerationRunTraceId: null
      },
      {
        id: 'version-other',
        projectId: OTHER_PROJECT_ID,
        chapterId: OTHER_CHAPTER_ID,
        source: 'manual_revision',
        title: 'Other Chapter',
        body: 'other project body',
        note: 'other project history',
        createdAt: '2026-09-21T00:00:00.000Z',
        baseChapterVersionId: null,
        linkedChapterCommitId: null,
        linkedRevisionCommitId: null,
        linkedGenerationRunTraceId: null
      }
    ],
    chapterCommitBundles: [],
    revisionCommitBundles: [],
    agentRuns: [],
    agentActionPreviews: [],
    settings: {
      apiProvider: 'openai',
      apiKey: '',
      hasApiKey: false,
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
  }
}
