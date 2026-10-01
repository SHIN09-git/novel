import { AgentDecisionService } from '../AgentDecisionService'
import { handleRevisionRead } from '../revision/agentRevisionReads'
import { handleAgentChapterTaskReadTool } from './agentChapterTaskTools'
import { handleAgentWorldReadTool } from './agentWorldTools'
import { getAgentDecisionInbox, previewAgentCandidateDecisions } from './agentCandidateDecisionTools'
import { getAgentCandidateDecisionHistory, previewAgentCandidateDecisionUndo } from './agentCandidateUndoTools'
import { AgentReadableSummaryService } from '../AgentReadableSummaryService'
import { compact, redactSensitiveText } from '../agentReadableText'
import type { AppData, ID } from '../../shared/types'
import {
  findProjectId,
  readOptions,
  requiredPositiveInteger,
  requiredString,
  stringArg
} from './agentToolArguments'
import type { AgentToolHandlerResult } from './agentToolTypes'

function getPromptSnapshot(data: AppData, snapshotId: ID, args: Record<string, unknown>): unknown {
  const snapshot = data.promptContextSnapshots.find((item) => item.id === snapshotId)
  if (!snapshot) throw new Error(`Prompt snapshot not found: ${snapshotId}`)
  const options = readOptions(args)
  const includePrompt = options.detail === 'full' || options.includePrompt === true
  const explicitLimit = options.maxChars ?? null
  const excerptLimit = explicitLimit ?? 1600
  const safePrompt = redactSensitiveText(snapshot.finalPrompt)
  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    targetChapterOrder: snapshot.targetChapterOrder,
    mode: snapshot.mode,
    source: snapshot.source,
    estimatedTokens: snapshot.estimatedTokens,
    selectedCounts: {
      characters: snapshot.selectedCharacterIds.length,
      foreshadowings: snapshot.selectedForeshadowingIds.length,
      chapters: snapshot.contextSelectionResult.selectedChapterIds.length,
      stageSummaries: snapshot.contextSelectionResult.selectedStageSummaryIds.length,
      timelineEvents: snapshot.contextSelectionResult.selectedTimelineEventIds.length
    },
    contextNeedPlanId: snapshot.contextNeedPlan?.id ?? null,
    storyDirectionGuideId: snapshot.storyDirectionGuide?.id ?? null,
    note: snapshot.note,
    promptCharCount: safePrompt.length,
    promptExcerpt: compact(safePrompt, excerptLimit),
    finalPrompt: includePrompt ? (explicitLimit ? safePrompt.slice(0, explicitLimit) : safePrompt) : undefined,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt
  }
}

export function handleAgentReadTool(
  name: string,
  args: Record<string, unknown>,
  data: AppData
): AgentToolHandlerResult {
  const taskRead = handleAgentChapterTaskReadTool(name, args, data)
  if (taskRead.handled) return taskRead
  const worldRead = handleAgentWorldReadTool(name, args, data)
  if (worldRead.handled) return worldRead
  const revisionRead = handleRevisionRead(name, args, data)
  if (revisionRead.handled) return revisionRead
  switch (name) {
    case 'agent.getCandidateDecisionHistory':
      return { handled: true, payload: getAgentCandidateDecisionHistory(data, args) }
    case 'agent.previewCandidateDecisionUndo':
      return { handled: true, payload: previewAgentCandidateDecisionUndo(data, args) }
    case 'agent.getDecisionInbox':
      return { handled: true, payload: getAgentDecisionInbox(data, args) }
    case 'agent.previewCandidateDecisions':
      return { handled: true, payload: previewAgentCandidateDecisions(data, args) }
    case 'agent.listProjects':
      return { handled: true, payload: AgentReadableSummaryService.listProjects(data) }
    case 'agent.getProjectDigest':
      return { handled: true, payload: AgentReadableSummaryService.getProjectDigest(data, findProjectId(data, args)) }
    case 'agent.getNextChapterTarget':
      return { handled: true, payload: AgentReadableSummaryService.getNextChapterTarget(data, findProjectId(data, args)) }
    case 'agent.getArchivedChapters':
      return { handled: true, payload: AgentReadableSummaryService.getArchivedChapters(data, findProjectId(data, args)) }
    case 'agent.getChapterProductionState':
      return { handled: true, payload: AgentReadableSummaryService.getChapterProductionState(data, findProjectId(data, args), requiredPositiveInteger(args, 'chapterOrder')) }
    case 'agent.getChapterVersionChain':
      return { handled: true, payload: AgentReadableSummaryService.getChapterVersionChain(data, findProjectId(data, args), requiredPositiveInteger(args, 'chapterOrder')) }
    case 'agent.getChapterText':
      return { handled: true, payload: AgentReadableSummaryService.getChapterText(data, findProjectId(data, args), requiredPositiveInteger(args, 'chapterOrder'), readOptions(args)) }
    case 'agent.getDraftText':
      return { handled: true, payload: AgentReadableSummaryService.getDraftText(data, requiredString(args, 'draftId'), readOptions(args)) }
    case 'agent.getPromptSnapshot':
      return { handled: true, payload: getPromptSnapshot(data, requiredString(args, 'snapshotId'), args) }
    case 'agent.getGenerationPrompt':
      return { handled: true, payload: AgentReadableSummaryService.getGenerationPrompt(data, requiredString(args, 'jobId'), readOptions(args)) }
    case 'agent.getVersionDetail':
      return { handled: true, payload: AgentReadableSummaryService.getVersionDetail(data, findProjectId(data, args), requiredPositiveInteger(args, 'chapterOrder'), requiredString(args, 'versionId'), readOptions(args)) }
    case 'agent.getVersionDiff':
      return { handled: true, payload: AgentReadableSummaryService.getVersionDiff(data, findProjectId(data, args), requiredPositiveInteger(args, 'chapterOrder'), requiredString(args, 'fromVersionId'), requiredString(args, 'toVersionId'), readOptions(args)) }
    case 'agent.getRunDiagnostics':
    case 'agent.inspectPipelineJob':
      return { handled: true, payload: AgentReadableSummaryService.getRunDiagnostics(data, requiredString(args, 'jobId')) }
    case 'agent.getFullRunTrace':
      return { handled: true, payload: AgentReadableSummaryService.getFullRunTrace(data, stringArg(args, 'traceId') ?? requiredString(args, 'jobId'), readOptions(args)) }
    case 'agent.getCandidateDetail':
      return { handled: true, payload: AgentReadableSummaryService.getCandidateDetail(data, requiredString(args, 'candidateId'), readOptions(args)) }
    case 'agent.getPendingHumanReviewItems':
      return { handled: true, payload: AgentReadableSummaryService.getProjectDigest(data, findProjectId(data, args)).pendingReview }
    case 'agent.getAcceptanceRecommendation':
      return { handled: true, payload: AgentDecisionService.buildAcceptanceRecommendation(data, requiredString(args, 'jobId')) }
    case 'agent.getActionPreviews':
      return { handled: true, payload: data.agentActionPreviews.filter((preview) => preview.agentRunId === requiredString(args, 'agentRunId')) }
    case 'agent.getAgentRunSummary':
      return { handled: true, payload: AgentDecisionService.summarizeAgentRun(data, requiredString(args, 'agentRunId')) }
    default:
      return { handled: false }
  }
}
