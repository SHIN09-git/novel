import { AgentCommitService } from '../AgentCommitService'
import { handleRevisionWrite } from '../revision/agentRevisionTools'
import { applyAgentCandidateDecisions } from './agentCandidateDecisionTools'
import { undoAgentCandidateDecision } from './agentCandidateUndoTools'
import { AgentDecisionService } from '../AgentDecisionService'
import type { AgentRuntimeData } from '../AgentRuntime'
import { saveAgentChapterCommitBundle, saveAgentRuntimeData } from '../AgentRuntime'
import { AgentRunService } from '../AgentRunService'
import { executeAgentChapterPipeline } from '../AgentPipelineExecutor'
import { AgentExecutionControlService } from '../AgentExecutionControlService'
import { applyAgentChapterAcceptance, previewAgentChapterAcceptance } from './agentChapterAcceptanceTools'
import { withAgentActionAcknowledgement } from '../agentAcknowledgedAction'
import { handleAgentChapterTaskWriteTool } from './agentChapterTaskTools'
import { handleAgentWorldWriteTool } from './agentWorldTools'
import type { AppData } from '../../shared/types'
import { OPENING_READER_EMOTION_FALLBACK } from '../../services/OpeningChapterContextPolicy'
import {
  archiveChapterInAppData,
  isChapterArchived,
  restoreArchivedChapterInAppData
} from '../../services/ChapterLifecycleService'
import {
  chapterTaskArg,
  findProjectId,
  hasApproval,
  requiredPositiveInteger,
  requiredString,
  safePipelineMode,
  safeSafetyMode,
  stringArg,
  temperatureArg
} from './agentToolArguments'
import type { AgentToolHandlerResult } from './agentToolTypes'

export async function handleAgentWriteTool(
  name: string,
  args: Record<string, unknown>,
  data: AppData,
  runtime: AgentRuntimeData
): Promise<AgentToolHandlerResult> {
  const taskWrite = await handleAgentChapterTaskWriteTool(name, args, data, runtime)
  if (taskWrite.handled) return taskWrite
  const worldWrite = await handleAgentWorldWriteTool(name, args, data, runtime)
  if (worldWrite.handled) return worldWrite
  const revisionWrite = await handleRevisionWrite(name, args, data, runtime)
  if (revisionWrite.handled) return revisionWrite
  switch (name) {
    case 'agent.previewChapterAcceptance':
      return { handled: true, payload: await previewAgentChapterAcceptance(data, args, runtime) }
    case 'agent.applyChapterAcceptance':
      return { handled: true, payload: await applyAgentChapterAcceptance(data, args, runtime) }
    case 'agent.undoCandidateDecision':
      return { handled: true, payload: await undoAgentCandidateDecision(data, args, runtime) }
    case 'agent.applyCandidateDecisions':
      return { handled: true, payload: await applyAgentCandidateDecisions(data, args, runtime) }
    case 'agent.startAgentRun': {
      const projectId = findProjectId(data, args)
      const project = data.projects.find((item) => item.id === projectId)
      const targetChapterOrder = requiredPositiveInteger(args, 'chapterOrder')
      const prepared = AgentRunService.prepareSingleChapterRun({
        appData: data,
        projectId,
        targetChapterOrder,
        goal: stringArg(args, 'goal'),
        chapterTaskSnapshot: chapterTaskArg(args, 'chapterTask', {
          readerEmotion: targetChapterOrder === 1 ? OPENING_READER_EMOTION_FALLBACK : '',
          styleRequirement: targetChapterOrder === 1 ? '' : project?.style ?? ''
        }),
        temperature: temperatureArg(args),
        safetyMode: safeSafetyMode(stringArg(args, 'safetyMode'))
      })
      const saved = await saveAgentRuntimeData(prepared.appData, runtime)
      return { handled: true, payload: { agentRun: prepared.agentRun, job: prepared.job, stepCount: prepared.steps.length, warning: prepared.warning, saved } }
    }
    case 'agent.runChapterPipeline': {
      const projectId = findProjectId(data, args)
      const project = data.projects.find((item) => item.id === projectId)
      const targetChapterOrder = requiredPositiveInteger(args, 'chapterOrder')
      const prepared = AgentRunService.prepareSingleChapterRun({
        appData: data,
        projectId,
        targetChapterOrder,
        goal: stringArg(args, 'goal'),
        chapterTaskSnapshot: chapterTaskArg(args, 'chapterTask', {
          readerEmotion: stringArg(args, 'readerEmotionTarget') ?? (targetChapterOrder === 1 ? OPENING_READER_EMOTION_FALLBACK : ''),
          targetWordCount: stringArg(args, 'estimatedWordCount') ?? '3000-5000',
          styleRequirement: targetChapterOrder === 1 ? '' : project?.style ?? ''
        }),
        temperature: temperatureArg(args),
        safetyMode: safeSafetyMode(stringArg(args, 'safetyMode'))
      })
      await saveAgentRuntimeData(prepared.appData, runtime)
      const executed = await executeAgentChapterPipeline({
        appData: prepared.appData,
        runtime,
        agentRunId: prepared.agentRun.id,
        jobId: prepared.job.id,
        pipelineMode: safePipelineMode(stringArg(args, 'pipelineMode')),
        estimatedWordCount: stringArg(args, 'estimatedWordCount'),
        readerEmotionTarget: stringArg(args, 'readerEmotionTarget'),
        budgetMaxTokens: typeof args.budgetMaxTokens === 'number' ? args.budgetMaxTokens : undefined
      })
      return {
        handled: true,
        payload: {
          agentRun: executed.agentRun,
          job: executed.job,
          completedStepCount: executed.completedStepCount,
          draftIds: executed.draftIds,
          failedStep: executed.failedStep
            ? { type: executed.failedStep.type, errorMessage: executed.failedStep.errorMessage }
            : null,
          awaitingAcceptance: !executed.failedStep && executed.draftIds.length > 0
        }
      }
    }
    case 'agent.retryChapterPipeline': {
      const agentRunId = requiredString(args, 'agentRunId')
      const jobId = requiredString(args, 'jobId')
      const run = data.agentRuns.find((item) => item.id === agentRunId)
      const job = data.chapterGenerationJobs.find((item) => item.id === jobId)
      if (!run) throw new Error(`AgentRun not found: ${agentRunId}`)
      if (!job) throw new Error(`Pipeline job not found: ${jobId}`)
      if (run.projectId !== job.projectId || !run.createdJobIds.includes(job.id)) {
        throw new Error('AgentRun and pipeline job are not part of the same production run.')
      }
      const executed = await executeAgentChapterPipeline({
        appData: data,
        runtime,
        agentRunId,
        jobId,
        pipelineMode: safePipelineMode(stringArg(args, 'pipelineMode')),
        estimatedWordCount: stringArg(args, 'estimatedWordCount'),
        readerEmotionTarget: stringArg(args, 'readerEmotionTarget'),
        budgetMaxTokens: typeof args.budgetMaxTokens === 'number' ? args.budgetMaxTokens : undefined
      })
      return {
        handled: true,
        payload: {
          agentRun: executed.agentRun,
          job: executed.job,
          resumedFromStep: executed.startedFromStep,
          completedStepCount: executed.completedStepCount,
          draftIds: executed.draftIds,
          failedStep: executed.failedStep
            ? { type: executed.failedStep.type, errorMessage: executed.failedStep.errorMessage }
            : null,
          awaitingAcceptance: !executed.failedStep && executed.draftIds.length > 0
        }
      }
    }
    case 'agent.cancelChapterPipeline': {
      const jobId = requiredString(args, 'jobId')
      const job = data.chapterGenerationJobs.find((item) => item.id === jobId)
      if (!job) throw new Error(`Pipeline job not found: ${jobId}`)
      const run = data.agentRuns.find((item) => item.createdJobIds.includes(jobId)) ?? null
      if (job.status !== 'running') {
        return {
          handled: true,
          payload: {
            accepted: false,
            jobId,
            agentRunId: run?.id ?? null,
            jobStatus: job.status,
            message: 'The pipeline job is not currently running; no cancellation marker was created.'
          }
        }
      }
      const request = await AgentExecutionControlService.requestCancellation(
        runtime,
        jobId,
        stringArg(args, 'reason') ?? ''
      )
      return {
        handled: true,
        payload: {
          accepted: true,
          jobId,
          agentRunId: run?.id ?? null,
          requestedAt: request.requestedAt,
          reason: request.reason,
          message: 'Cancellation requested. The active executor will preserve completed steps and pause this job.'
        }
      }
    }
    case 'agent.continueAgentRun': {
      const prepared = AgentRunService.prepareSequentialChapterRun({
        appData: data,
        projectId: findProjectId(data, args),
        targetChapterOrder: requiredPositiveInteger(args, 'startChapterOrder'),
        chapterCount: requiredPositiveInteger(args, 'chapterCount', 1000),
        goal: stringArg(args, 'goal'),
        safetyMode: safeSafetyMode(stringArg(args, 'safetyMode'))
      })
      const saved = await saveAgentRuntimeData(prepared.appData, runtime)
      return {
        handled: true,
        payload: {
          agentRun: prepared.agentRun,
          currentJob: prepared.job,
          targetChapterOrders: prepared.agentRun.targetChapterOrders,
          createdJobCount: prepared.agentRun.createdJobIds.length,
          stepCount: prepared.steps.length,
          warning: prepared.warning,
          saved
        }
      }
    }
    case 'agent.recordAcceptanceDecision': {
      const result = AgentDecisionService.recordAcceptanceDecision({
        appData: data,
        agentRunId: requiredString(args, 'agentRunId'),
        jobId: requiredString(args, 'jobId')
      })
      const saved = await saveAgentRuntimeData(result.appData, runtime)
      return { handled: true, payload: { decision: result.decision, preview: result.preview, recommendation: result.recommendation, saved } }
    }
    case 'agent.archiveChapter': {
      const projectId = findProjectId(data, args)
      const chapterId = requiredString(args, 'chapterId')
      const chapter = data.chapters.find((item) => item.id === chapterId && item.projectId === projectId)
      if (!chapter) throw new Error(`Chapter not found: ${chapterId}`)
      if (isChapterArchived(chapter)) throw new Error(`Chapter is already archived: ${chapterId}`)
      const archivedAt = new Date().toISOString()
      const next = archiveChapterInAppData(data, chapterId, archivedAt)
      const saved = await withAgentActionAcknowledgement({ runtime, projectId, chapterOrder: chapter.order,
        action: 'manage_chapters', confirmed: hasApproval(args) }, () => saveAgentRuntimeData(next, runtime))
      return { handled: true, payload: { projectId, chapterId, archivedAt, retainedVersionCount: data.chapterVersions.filter((version) => version.chapterId === chapterId).length, saved } }
    }
    case 'agent.restoreArchivedChapter': {
      const projectId = findProjectId(data, args)
      const chapterId = requiredString(args, 'chapterId')
      const chapter = data.chapters.find((item) => item.id === chapterId && item.projectId === projectId)
      if (!chapter) throw new Error(`Chapter not found: ${chapterId}`)
      if (!isChapterArchived(chapter)) throw new Error(`Chapter is not archived: ${chapterId}`)
      const restored = restoreArchivedChapterInAppData(data, chapterId, new Date().toISOString())
      // Restoring into a newly occupied order must be covered at both ends.
      const saved = await withAgentActionAcknowledgement({ runtime, projectId,
        chapterOrders: [...new Set([chapter.order, restored.chapter.order])],
        action: 'manage_chapters', confirmed: hasApproval(args) }, () => saveAgentRuntimeData(restored.data, runtime))
      return { handled: true, payload: { projectId, chapterId, chapterOrder: restored.chapter.order, orderChanged: restored.orderChanged, saved } }
    }
    case 'agent.applyApprovedChapterCommit': {
      const preview = data.agentActionPreviews.find((item) => item.id === requiredString(args, 'previewId'))
      if (!preview) throw new Error('采纳预览不存在。')
      if (preview.evidence.some((item) => item.startsWith('chapter-acceptance-v1:'))) {
        throw new Error('Use agent.applyChapterAcceptance for this body-bound project-authorized preview.')
      }
      const chapterOrder = data.chapterGenerationJobs.find((item) => item.id === preview.jobId && item.projectId === preview.projectId)?.targetChapterOrder
      return withAgentActionAcknowledgement({ runtime, projectId: preview.projectId, chapterOrder,
        action: 'accept_draft', confirmed: hasApproval(args) || !preview.requiresHumanApproval,
        requiresGrant: preview.requiresHumanApproval
      }, async (grant) => {
      const result = AgentCommitService.applyActionPreview({
        appData: data,
        previewId: requiredString(args, 'previewId'),
        confirm: hasApproval(args) || Boolean(grant)
      })
      if (result.appliedCommit.kind !== 'chapter_commit') {
        throw new Error(`Preview ${result.preview.id} is not a chapter commit preview.`)
      }
      const acceptedBundle = result.appliedCommit.bundle
      if (grant && acceptedBundle.actor && !data.chapterCommitBundles.some((item) => item.commitId === acceptedBundle.commitId)) {
        acceptedBundle.actor.authorizationGrantId = grant.id
      }
      const commitSave = await saveAgentChapterCommitBundle(result.appliedCommit.bundle, runtime)
      const metadataSave = await saveAgentRuntimeData(result.appData, runtime)
      return {
        handled: true,
        payload: {
          preview: result.preview,
          decision: result.decision,
          appliedCommit: { kind: result.appliedCommit.kind, id: result.appliedCommit.bundle.commitId },
          commitSave,
          metadataSave
        }
      }
      })
    }
    default:
      return { handled: false }
  }
}
