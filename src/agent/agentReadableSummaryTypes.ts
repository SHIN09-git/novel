import type { ID } from '../shared/types'
import type {
  AgentAuthorSummaryDigest,
  AgentConsistencyDigest,
  AgentJobSummary,
  AgentPendingReviewSummary,
  AgentQualityGateDigest,
  AgentRedundancyDigest
} from './agentSummaryHelpers'

export interface AgentProjectListItem {
  id: ID
  name: string
  genre: string
  chapterCount: number
  archivedChapterCount: number
  characterCount: number
  foreshadowingCount: number
  activeForeshadowingCount: number
  pendingReviewCount: number
  latestChapterOrder: number | null
  latestChapterTitle: string | null
  updatedAt: string
}

export interface AgentProjectDigest {
  project: {
    id: ID
    name: string
    genre: string
    description: string
    updatedAt: string
  }
  nextChapterOrder: number
  counts: {
    chapters: number
    archivedChapters: number
    characters: number
    characterStateFacts: number
    activeForeshadowings: number
    timelineEvents: number
    stageSummaries: number
    hardCanonItems: number
    storyDirectionGuides: number
  }
  latestChapters: Array<{
    id: ID
    order: number
    title: string
    updatedAt: string
    bodyCharCount: number
    summary: string
    endingHook: string
  }>
  activeStoryDirection: {
    id: ID
    title: string
    horizon: number
    range: string
  } | null
  latestGenerationJob: AgentJobSummary | null
  pendingReview: AgentPendingReviewSummary
}

export interface AgentChapterState {
  projectId: ID
  chapterOrder: number
  chapter: {
    id: ID
    title: string
    updatedAt: string
    bodyCharCount: number
    summary: string
    endingHook: string
  } | null
  latestJob: AgentJobSummary | null
  drafts: Array<{
    id: ID
    jobId: ID
    title: string
    status: string
    bodyCharCount: number
    tokenEstimate: number
    updatedAt: string
  }>
  diagnostics: {
    qualityGate: AgentQualityGateDigest | null
    consistency: AgentConsistencyDigest | null
    redundancy: AgentRedundancyDigest | null
    authorSummary: AgentAuthorSummaryDigest | null
  }
  versionChain: {
    currentUpdatedAt: string | null
    historicalVersionCount: number
    latestHistoricalVersion: {
      id: ID
      source: string
      createdAt: string
      bodyCharCount: number
    } | null
  }
  pendingReview: AgentPendingReviewSummary
}

export interface AgentRunDiagnostics {
  job: AgentJobSummary | null
  steps: Array<{
    id: ID
    type: string
    status: string
    errorMessage: string
    outputCharCount: number
    updatedAt: string
  }>
  trace: {
    id: ID
    contextSource: string
    selectedCounts: {
      chapters: number
      stageSummaries: number
      characters: number
      foreshadowings: number
      timelineEvents: number
      characterStateFacts: number
      hardCanonItems: number
    }
    omittedContextItemCount: number
    contextWarningCount: number
    finalPromptTokenEstimate: number
    noveltySeverity: string | null
  } | null
  authorSummary: AgentAuthorSummaryDigest | null
}

export interface AgentVersionChainSummary {
  projectId: ID
  chapterOrder: number
  chapterId: ID | null
  chapterArchived: boolean
  versions: Array<{
    id: ID | string
    source: string
    isCurrent: boolean
    title: string
    createdAt: string
    bodyCharCount: number
    linkedChapterCommitId: ID | null
    linkedRevisionCommitId: ID | null
    linkedGenerationRunTraceId: ID | null
  }>
}

export interface AgentVersionDiffResult {
  projectId: ID
  chapterOrder: number
  fromVersionId: string
  toVersionId: string
  fromTitle: string
  toTitle: string
  fromCharCount: number
  toCharCount: number
  deltaChars: number
  commonPrefixChars: number
  commonSuffixChars: number
  changedFromExcerpt: string
  changedToExcerpt: string
}

export interface AgentArchivedChapterList {
  projectId: ID
  chapters: Array<{
    id: ID
    order: number
    title: string
    archivedAt: string
    bodyCharCount: number
    versionCount: number
  }>
}
