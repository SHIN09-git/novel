import type { AppData, ID } from '../shared/types'
import { isChapterArchived } from '../services/ChapterLifecycleService'
import { PipelineRecipeService } from '../services/PipelineRecipeService'
import {
  compact,
  extractPromptFromParsed,
  resolvePromptSnapshotText,
  safeParseJson,
  textPayload
} from './agentReadableText'
import type { AgentReadOptions, AgentTextReadResult } from './agentReadableText'
import { findReadableChapterByOrder } from './agentVersionReaders'

export function getChapterText(
  data: AppData,
  projectId: ID,
  chapterOrder: number,
  options: AgentReadOptions = {}
): AgentTextReadResult {
  const projectExists = data.projects.some((project) => project.id === projectId)
  if (!projectExists) throw new Error(`Project not found: ${projectId}`)
  const chapter = findReadableChapterByOrder(data, projectId, chapterOrder)
  if (!chapter) throw new Error(`Chapter not found: project=${projectId}, order=${chapterOrder}`)
  return textPayload(chapter.id, 'chapter', chapter.title, chapter.body, options, {
    projectId,
    chapterOrder,
    archived: isChapterArchived(chapter),
    updatedAt: chapter.updatedAt,
    summary: compact(chapter.summary, 300),
    endingHook: compact(chapter.endingHook, 300)
  })
}

export function getDraftText(
  data: AppData,
  draftId: ID,
  options: AgentReadOptions = {}
): AgentTextReadResult {
  const draft = data.generatedChapterDrafts.find((item) => item.id === draftId)
  if (!draft) throw new Error(`Draft not found: ${draftId}`)
  return textPayload(draft.id, 'draft', draft.title, draft.body, options, {
    projectId: draft.projectId,
    chapterId: draft.chapterId,
    jobId: draft.jobId,
    status: draft.status,
    tokenEstimate: draft.tokenEstimate,
    updatedAt: draft.updatedAt
  })
}

export function getGenerationPrompt(
  data: AppData,
  jobId: ID,
  options: AgentReadOptions = {}
): AgentTextReadResult {
  const job = data.chapterGenerationJobs.find((item) => item.id === jobId)
  if (!job) throw new Error(`Job not found: ${jobId}`)
  const steps = data.chapterGenerationSteps
    .filter((step) => step.jobId === jobId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const completedOutputs = steps.filter(
    (step) => step.status === 'completed' && Boolean(step.output.trim()) && !PipelineRecipeService.isSkipOutput(step.output)
  )
  const contextStep =
    completedOutputs.find((step) => step.type === 'rebuild_context_with_plan') ??
    completedOutputs.find((step) => step.type === 'build_context') ??
    null
  const raw = contextStep?.output ?? ''
  const parsed = safeParseJson(raw)
  const extractedPrompt = extractPromptFromParsed(parsed) || raw
  const resolvedPrompt = resolvePromptSnapshotText(data, job, extractedPrompt)
  const prompt = resolvedPrompt.text
  return textPayload(
    job.id,
    'prompt',
    `Generation prompt for chapter ${job.targetChapterOrder}`,
    prompt,
    options,
    {
      projectId: job.projectId,
      jobId: job.id,
      contextStepId: contextStep?.id ?? null,
      contextStepType: contextStep?.type ?? null,
      contextSource: job.contextSource,
      promptSnapshotId: resolvedPrompt.snapshotId,
      promptAvailable: Boolean(prompt)
    },
    'prompt'
  )
}

export function getFullRunTrace(
  data: AppData,
  traceOrJobId: ID,
  options: AgentReadOptions = {}
): AgentTextReadResult {
  const trace = data.generationRunTraces.find(
    (item) => item.id === traceOrJobId || item.jobId === traceOrJobId
  )
  if (!trace) throw new Error(`Run trace not found: ${traceOrJobId}`)
  const traceJson = JSON.stringify(
    {
      ...trace,
      promptBlockOrder: trace.promptBlockOrder.map((item) => ({
        ...item,
        reason: compact(item.reason, 500)
      }))
    },
    null,
    2
  )
  return textPayload(
    trace.id,
    'trace',
    `Run trace ${trace.id}`,
    traceJson,
    options,
    {
      projectId: trace.projectId,
      jobId: trace.jobId,
      targetChapterOrder: trace.targetChapterOrder,
      contextSource: trace.contextSource,
      selectedChapterCount: trace.selectedChapterIds.length,
      selectedCharacterCount: trace.selectedCharacterIds.length,
      selectedForeshadowingCount: trace.selectedForeshadowingIds.length,
      finalPromptTokenEstimate: trace.finalPromptTokenEstimate
    },
    'diagnostics'
  )
}

export function getCandidateDetail(
  data: AppData,
  candidateId: ID,
  options: AgentReadOptions = {}
): AgentTextReadResult {
  const memory = data.memoryUpdateCandidates.find((candidate) => candidate.id === candidateId)
  if (memory) {
    return textPayload(
      memory.id,
      'candidate',
      `Memory candidate ${memory.type}`,
      JSON.stringify(memory.proposedPatch, null, 2),
      options,
      {
        projectId: memory.projectId,
        candidateType: memory.type,
        status: memory.status,
        confidence: memory.confidence,
        sourceChapterId:
          memory.proposedPatch.kind === 'chapter_review_update'
            ? memory.proposedPatch.targetChapterId
            : null,
        sourceChapterOrder: memory.proposedPatch.sourceChapterOrder ?? null
      },
      'diagnostics'
    )
  }
  const state = data.characterStateChangeCandidates.find((candidate) => candidate.id === candidateId)
  if (state) {
    return textPayload(
      state.id,
      'candidate',
      `Character state candidate ${state.candidateType}`,
      JSON.stringify(
        {
          proposedFact: state.proposedFact,
          proposedTransaction: state.proposedTransaction,
          evidence: state.evidence,
          beforeValue: state.beforeValue,
          afterValue: state.afterValue
        },
        null,
        2
      ),
      options,
      {
        projectId: state.projectId,
        characterId: state.characterId,
        chapterId: state.chapterId,
        chapterOrder: state.chapterOrder,
        status: state.status,
        confidence: state.confidence,
        riskLevel: state.riskLevel
      },
      'diagnostics'
    )
  }
  throw new Error(`Candidate not found: ${candidateId}`)
}
