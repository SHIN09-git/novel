import type { AppData } from '../shared/types'

export type AgentProjectOverviewData = Pick<
  AppData,
  | 'projects'
  | 'chapters'
  | 'characters'
  | 'characterStateFacts'
  | 'foreshadowings'
  | 'timelineEvents'
  | 'stageSummaries'
  | 'hardCanonPacks'
  | 'storyDirectionGuides'
  | 'chapterGenerationJobs'
  | 'memoryUpdateCandidates'
  | 'characterStateChangeCandidates'
>

export const AGENT_PROJECT_OVERVIEW_COLLECTIONS = [
  'projects',
  'chapters',
  'characters',
  'characterStateFacts',
  'foreshadowings',
  'timelineEvents',
  'stageSummaries',
  'hardCanonPacks',
  'storyDirectionGuides',
  'chapterGenerationJobs',
  'memoryUpdateCandidates',
  'characterStateChangeCandidates'
] as const satisfies readonly (keyof AgentProjectOverviewData)[]
