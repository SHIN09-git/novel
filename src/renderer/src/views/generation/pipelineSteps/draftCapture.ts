import type { AIResult, ChapterDraftResult, ChapterPlan, ChapterTask, GeneratedChapterDraft } from '../../../../../shared/types'
import type { AIService } from '../../../../../services/AIService'
import { ChapterTaskContractService } from '../../../../../services/ChapterTaskContractService'
import { getTruncatedDraftFragment } from '../../../../../services/ChapterDraftFragmentService'
import { getChapterDraftEnvelopeError } from '../../../../../services/ChapterDraftEnvelopeService'
import { draftContentHash } from '../../../../../services/DraftDiagnosticBindingService'
import { isTruncatedFinishReason } from '../../../../../services/ai/responseNormalizers/chapter'
import { TokenEstimator } from '../../../../../services/TokenEstimator'
import { newId, now } from '../../../utils/format'
import { appendGenerationRunTraceAiCall, upsertGenerationRunTrace } from '../../../utils/runTrace'
import type { PipelineStepHandlerContext } from '../pipelineRunnerTypes'
import { serializeOutput, validateAuthoritativeChapterTaskDraft, validateGeneratedChapterDraft } from '../pipelineUtils'

type DraftCheckpoint = { kind: 'chapter_draft_checkpoint'; draftId: string; bodyHash: string; inputHash: string }
type RepairSource = ChapterDraftResult & { kind: 'chapter_draft_repair_source'; inputHash: string }

function readSavedOutput<T>(raw: string): T | null {
  if (!raw.trim()) return null
  // This is app-written state, not model output: never salvage a nested object from a damaged checkpoint.
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as T : null
  } catch { return null }
}

export function checkpointForDraft(draft: GeneratedChapterDraft, inputHash: string): DraftCheckpoint {
  return { kind: 'chapter_draft_checkpoint', inputHash, draftId: draft.id, bodyHash: draftContentHash(draft.body) }
}

export function draftInputHash(ctx: PipelineStepHandlerContext, chapterTask: ChapterTask): string {
  const { options, state } = ctx
  return draftContentHash(JSON.stringify([state.plan, state.context, chapterTask, options.targetChapterOrder,
    options.pipelineMode, options.estimatedWordCount, options.readerEmotionTarget]))
}

export function resumeCapturedDraft(ctx: PipelineStepHandlerContext, inputHash: string): GeneratedChapterDraft | null {
  if (ctx.step.status === 'completed') return null // Deliberate regeneration, not recovery.
  const raw = ctx.step.output || ''
  const saved = readSavedOutput<{ kind?: string; checkpoint?: DraftCheckpoint }>(raw)
  const checkpoint = saved?.kind === 'chapter_draft_checkpoint' ? saved as DraftCheckpoint : saved?.checkpoint
  const ambiguous = '草稿恢复记录不完整，已停止自动重写。请先查看已保存的草稿，再决定是否重新生成。'
  if (!checkpoint) {
    if (raw.trim() && !saved && ctx.state.working.generatedChapterDrafts.some((item) =>
      item.jobId === ctx.job.id && item.projectId === ctx.job.projectId && item.status === 'draft')) throw new Error(ambiguous)
    return null
  }
  if (checkpoint.kind !== 'chapter_draft_checkpoint' || !checkpoint.draftId || !checkpoint.inputHash || !checkpoint.bodyHash) throw new Error(ambiguous)
  if (checkpoint.inputHash !== inputHash) return null
  const draft = ctx.state.working.generatedChapterDrafts.find((item) => item.id === checkpoint.draftId &&
    item.jobId === ctx.job.id && item.projectId === ctx.job.projectId && item.status === 'draft')
  if (!draft) throw new Error('原草稿已被处理或移除，未重新调用写作模型。请查看本章当前版本。')
  if (draftContentHash(draft.body) !== checkpoint.bodyHash) {
    // A manual edit wins over the saved model response. Never restore the stale body from a step.
    const error = validateAuthoritativeChapterTaskDraft(draft.body, draft.title, ctx.options.estimatedWordCount, true,
      ctx.job.chapterTaskSnapshot, { allowReviewableLengthOverflow: true, allowReviewableLengthUnderflow: true })
    if (error) throw new Error(`已保留手改草稿；${error} 请先核对或修改，再重试审稿。`)
  }
  return draft
}

export async function captureReviewableDraft(
  ctx: PipelineStepHandlerContext, plan: ChapterPlan, chapterTask: ChapterTask, inputHash: string, ai: AIService
): Promise<GeneratedChapterDraft> {
  const { state, job, step, options, env } = ctx
  const saved = readSavedOutput<RepairSource | { kind: 'incomplete_chapter_fragment'; repairSource?: RepairSource }>(step.output || '')
  const source = saved?.kind === 'chapter_draft_repair_source' ? saved : saved?.kind === 'incomplete_chapter_fragment' ? saved.repairSource : null
  let repairSource = source?.inputHash === inputHash && typeof source.body === 'string' && typeof source.title === 'string' ? source : null
  const request = { mode: options.pipelineMode, targetChapterOrder: options.targetChapterOrder,
    estimatedWordCount: options.estimatedWordCount, readerEmotionTarget: options.readerEmotionTarget,
    chapterTask, authoritativeChapterTask: Boolean(job.chapterTaskSnapshot) }
  function takeResponse(result: AIResult<ChapterDraftResult>): ChapterDraftResult {
    const truncated = isTruncatedFinishReason(result.finishReason) || isTruncatedFinishReason(result.telemetry?.finishReason ?? undefined)
    const envelopeError = !truncated && result.ok ? getChapterDraftEnvelopeError(result.rawText) : null
    state.working = appendGenerationRunTraceAiCall(state.working, job.id, step, 'prose', result.telemetry,
      !truncated && !envelopeError && result.ok && result.data ? 'success' : 'failed')
    if (truncated) {
      const fragment = getTruncatedDraftFragment(result, plan.chapterTitle)
      if (fragment) {
        state.working = env.updateStepInData(state.working, step.id, {
          output: serializeOutput(repairSource ? { ...fragment, repairSource } : fragment)
        })
        throw new Error('模型明确报告输出被截断。可读片段已保留在正文生成步骤，不能直接采纳。')
      }
      throw new Error(result.error || '模型明确报告输出被截断，未取得可安全提取的正文。')
    }
    if (envelopeError) throw new Error(envelopeError)
    if (!result.ok || !result.data) throw new Error(result.error || result.parseError || '正文生成失败')
    return result.data
  }
  let candidate: ChapterDraftResult
  let usedAI = true
  if (repairSource) {
    candidate = { title: repairSource.title, body: repairSource.body }
  } else {
    const response = await ai.generateChapterDraft(plan, state.context, request)
    candidate = takeResponse(response)
    usedAI = response.usedAI
  }
  const validate = (allowNearMinimum = false) => validateAuthoritativeChapterTaskDraft(candidate.body, candidate.title,
    options.estimatedWordCount, usedAI, job.chapterTaskSnapshot,
    { allowReviewableLengthOverflow: true, allowReviewableLengthUnderflow: allowNearMinimum })
  let error = validate()
  if (error && usedAI) {
    const readable = !validateGeneratedChapterDraft(candidate.body, options.estimatedWordCount, false)
    if (readable && !repairSource) {
      // Retain the first readable version before a paid correction, even when that request fails.
      repairSource = { kind: 'chapter_draft_repair_source', inputHash, title: candidate.title, body: candidate.body }
      state.working = env.updateStepInData(state.working, step.id, { output: serializeOutput(repairSource) })
      await env.persistWorking(state.working, job.id)
    }
    const contract = job.chapterTaskSnapshot && ChapterTaskContractService.evaluate({ ...candidate, chapterTask })
    const previousDraft = contract && !validateGeneratedChapterDraft(candidate.body, options.estimatedWordCount, true) &&
      ChapterTaskContractService.isLocallyRepairable(contract) ? candidate : undefined
    const retry = await ai.generateChapterDraft(plan, state.context, { ...request, previousDraft, retryReason: error,
      retryIssueTypes: contract?.issues.map((issue) => issue.type) ?? [] })
    const later = takeResponse(retry)
    const laterReadable = !validateGeneratedChapterDraft(later.body, options.estimatedWordCount, false)
    if (!readable || (laterReadable && (!job.chapterTaskSnapshot ||
      !ChapterTaskContractService.shouldPreferEarlierAfterRetry({ earlier: candidate, later, chapterTask })))) {
      candidate = later
      usedAI = retry.usedAI
    }
    error = validate(true)
  }
  if (error) throw new Error(`${error} 请检查任务约束后重试。`)
  const at = now()
  const draft: GeneratedChapterDraft = { id: newId(), projectId: job.projectId, chapterId: null, jobId: job.id,
    title: candidate.title, body: candidate.body, summary: plan.chapterGoal, status: 'draft',
    tokenEstimate: TokenEstimator.estimate(candidate.body), createdAt: at, updatedAt: at }
  const checkpoint = checkpointForDraft(draft, inputHash)
  state.working = env.updateStepInData({ ...state.working, generatedChapterDrafts: [draft, ...state.working.generatedChapterDrafts] },
    step.id, { output: serializeOutput(checkpoint) })
  state.working = upsertGenerationRunTrace(state.working, job, {
    generatedDraftId: draft.id, qualityGateReportId: null, consistencyReviewReportId: null, redundancyReportId: null,
    noveltyAuditResult: null, editorialVerdictId: null, editorialVerdictDraftId: null, editorialVerdictDraftContentHash: null
  })
  await env.persistWorking(state.working, job.id)
  return draft
}
