import type { AppData, ID } from '../shared/types'
import { AgentDecisionService } from './AgentDecisionService'
import type { AgentProjectOverviewData } from './agentProjectOverviewData'
import {
  getCandidateDetail,
  getChapterText,
  getDraftText,
  getFullRunTrace,
  getGenerationPrompt
} from './agentContentReaders'
import { getChapterProductionState, getRunDiagnostics } from './agentChapterSummaries'
import {
  getArchivedChapters,
  getNextChapterTarget,
  getProjectDigest,
  listProjects
} from './agentProjectSummaries'
import type {
  AgentArchivedChapterList,
  AgentChapterState,
  AgentProjectDigest,
  AgentProjectListItem,
  AgentRunDiagnostics,
  AgentVersionChainSummary,
  AgentVersionDiffResult
} from './agentReadableSummaryTypes'
import type { AgentReadOptions, AgentTextReadResult } from './agentReadableText'
import { getChapterVersionChain, getVersionDetail, getVersionDiff } from './agentVersionReaders'

export type { AgentReadDetail, AgentReadOptions, AgentTextReadResult } from './agentReadableText'
export type { AgentJobSummary, AgentPendingReviewSummary } from './agentSummaryHelpers'
export type {
  AgentArchivedChapterList,
  AgentChapterState,
  AgentProjectDigest,
  AgentProjectListItem,
  AgentRunDiagnostics,
  AgentVersionChainSummary,
  AgentVersionDiffResult
} from './agentReadableSummaryTypes'

// Stable facade for CLI/MCP callers. Domain queries live in pure modules so UI-free
// Agent reads can evolve without turning this protocol surface into another monolith.
export class AgentReadableSummaryService {
  static listProjects(data: AgentProjectOverviewData): AgentProjectListItem[] {
    return listProjects(data)
  }

  static getProjectDigest(data: AgentProjectOverviewData, projectId: ID): AgentProjectDigest {
    return getProjectDigest(data, projectId)
  }

  static getNextChapterTarget(
    data: AgentProjectOverviewData,
    projectId: ID
  ): { projectId: ID; nextChapterOrder: number; reason: string } {
    return getNextChapterTarget(data, projectId)
  }

  static getArchivedChapters(data: AppData, projectId: ID): AgentArchivedChapterList {
    return getArchivedChapters(data, projectId)
  }

  static getChapterProductionState(
    data: AppData,
    projectId: ID,
    chapterOrder: number
  ): AgentChapterState {
    return getChapterProductionState(data, projectId, chapterOrder)
  }

  static getRunDiagnostics(data: AppData, jobId: ID): AgentRunDiagnostics {
    return getRunDiagnostics(data, jobId)
  }

  static getChapterVersionChain(
    data: AppData,
    projectId: ID,
    chapterOrder: number
  ): AgentVersionChainSummary {
    return getChapterVersionChain(data, projectId, chapterOrder)
  }

  static getChapterText(
    data: AppData,
    projectId: ID,
    chapterOrder: number,
    options: AgentReadOptions = {}
  ): AgentTextReadResult {
    return getChapterText(data, projectId, chapterOrder, options)
  }

  static getDraftText(
    data: AppData,
    draftId: ID,
    options: AgentReadOptions = {}
  ): AgentTextReadResult {
    return getDraftText(data, draftId, options)
  }

  static getGenerationPrompt(
    data: AppData,
    jobId: ID,
    options: AgentReadOptions = {}
  ): AgentTextReadResult {
    return getGenerationPrompt(data, jobId, options)
  }

  static getVersionDetail(
    data: AppData,
    projectId: ID,
    chapterOrder: number,
    versionId: string,
    options: AgentReadOptions = {}
  ): AgentTextReadResult {
    return getVersionDetail(data, projectId, chapterOrder, versionId, options)
  }

  static getVersionDiff(
    data: AppData,
    projectId: ID,
    chapterOrder: number,
    fromVersionId: string,
    toVersionId: string,
    options: AgentReadOptions = {}
  ): AgentVersionDiffResult {
    return getVersionDiff(data, projectId, chapterOrder, fromVersionId, toVersionId, options)
  }

  static getFullRunTrace(
    data: AppData,
    traceOrJobId: ID,
    options: AgentReadOptions = {}
  ): AgentTextReadResult {
    return getFullRunTrace(data, traceOrJobId, options)
  }

  static getCandidateDetail(
    data: AppData,
    candidateId: ID,
    options: AgentReadOptions = {}
  ): AgentTextReadResult {
    return getCandidateDetail(data, candidateId, options)
  }

  static getAcceptanceRecommendation(
    data: AppData,
    jobId: ID
  ): {
    jobId: ID
    recommendation: 'accept' | 'revise' | 'reject' | 'wait' | 'pause'
    confidence: number
    riskLevel: string
    reasons: string[]
    draftId: ID | null
    nextActions: string[]
    requiresHumanApproval: boolean
  } {
    return AgentDecisionService.buildAcceptanceRecommendation(data, jobId)
  }
}
