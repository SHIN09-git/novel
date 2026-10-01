import type {
  CharacterStateChangeCandidate,
  CharacterStateFact,
  CharacterStateTransaction,
  ChapterReviewDraft,
  MemoryUpdateCandidate,
  PostDraftAnalysisResult
} from '../../../../../shared/types'
import {
  ensurePostDraftAnalysis,
  sanitizeChapterReviewForPostDraft
} from '../../../../../services/ai/AIResponseNormalizer'
import { newId, now } from '../../../utils/format'
import { appendGenerationRunTraceAiCall } from '../../../utils/runTrace'
import { noveltyAdjustedConfidence, noveltyWarnings, serializeOutput } from '../pipelineUtils'
import { parseOutput } from '../pipelineRuntimeBasics'
import type { PipelineStepHandlerContext } from '../pipelineRunnerTypes'

function meaningfulText(value: unknown): string {
  return String(value ?? '').trim()
}

function hasChapterReviewMemoryContent(review: ChapterReviewDraft): boolean {
  const bridge = review.continuityBridgeSuggestion
  return [
    review.summary,
    review.newInformation,
    review.characterChanges,
    review.newForeshadowing,
    review.resolvedForeshadowing,
    review.endingHook,
    review.riskWarnings,
    ...(bridge ? Object.values(bridge) : [])
  ].some((value) => meaningfulText(value))
}

export function postDraftAnalysisFromWorking(
  working: PipelineStepHandlerContext['state']['working'],
  jobId: string,
  characterIds: Set<string>,
  foreshadowingIds: Set<string>
): PostDraftAnalysisResult | null {
  const reviewStep = working.chapterGenerationSteps
    .filter((item) => item.jobId === jobId && item.type === 'generate_chapter_review' && item.status === 'completed')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  const parsed = parseOutput<unknown>(reviewStep?.output ?? '', null)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const candidate = parsed as Partial<PostDraftAnalysisResult>
  if (!candidate.chapterReview || !Array.isArray(candidate.characterSuggestions) || !candidate.foreshadowingExtraction) return null
  return ensurePostDraftAnalysis(candidate, characterIds, foreshadowingIds)
}

function fallbackAnalysis(review: ChapterReviewDraft, warning: string): PostDraftAnalysisResult {
  return {
    chapterReview: review,
    characterSuggestions: [],
    foreshadowingExtraction: {
      newForeshadowingCandidates: [],
      advancedForeshadowingIds: [],
      resolvedForeshadowingIds: [],
      abandonedForeshadowingCandidates: [],
      statusChanges: []
    },
    analysisMode: 'legacy_review_fallback',
    warnings: warning ? [warning] : []
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}

export async function runChapterReviewStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options, snapshot } = ctx
  const { project, updateStepInData } = env
  const aiService = await env.getAiService('extraction')
  if (!state.draftResult) throw new Error('缺少章节正文草稿，无法复盘')

  const selectedCharacterIds = new Set(snapshot?.selectedCharacterIds ?? state.budgetSelection?.selectedCharacterIds ?? [])
  const selectedForeshadowingIds = new Set(snapshot?.selectedForeshadowingIds ?? state.budgetSelection?.selectedForeshadowingIds ?? [])
  const analysisCharacters = env.scoped.characters.filter(
    (character) => selectedCharacterIds.has(character.id) || (character.name.length >= 2 && state.draftResult!.body.includes(character.name))
  )
  const analysisForeshadowings = env.scoped.foreshadowings.filter(
    (item) => selectedForeshadowingIds.has(item.id) || (item.title.length >= 2 && state.draftResult!.body.includes(item.title))
  )
  const characterIds = new Set(analysisCharacters.map((character) => character.id))
  const foreshadowingIds = new Set(analysisForeshadowings.map((item) => item.id))
  const supportsUnifiedAnalysis = typeof aiService.generatePostDraftAnalysis === 'function'
  let unifiedResult: Awaited<ReturnType<typeof aiService.generatePostDraftAnalysis>> | null = null
  let unifiedThrownError = ''
  if (supportsUnifiedAnalysis) {
    try {
      unifiedResult = await aiService.generatePostDraftAnalysis(
        state.draftResult.body,
        state.context,
        analysisCharacters,
        analysisForeshadowings
      )
    } catch (error) {
      unifiedThrownError = errorText(error)
    }
  }
  if (unifiedResult) {
    state.working = appendGenerationRunTraceAiCall(
      state.working,
      job.id,
      step,
      'extraction',
      unifiedResult.telemetry,
      unifiedResult.ok && Boolean(unifiedResult.data) ? 'success' : 'failed'
    )
  }
  const unifiedSucceeded = Boolean(
    unifiedResult?.data && unifiedResult.ok !== false && unifiedResult.usedAI !== false && !unifiedResult.parseError
  )
  const unifiedAnalysis = unifiedSucceeded && unifiedResult?.data
    ? ensurePostDraftAnalysis(unifiedResult.data, characterIds, foreshadowingIds)
    : null
  const legacyResult = !unifiedAnalysis && typeof aiService.generateChapterReview === 'function'
    ? await aiService.generateChapterReview(state.draftResult.body, state.context)
    : null
  if (legacyResult) {
    state.working = appendGenerationRunTraceAiCall(
      state.working,
      job.id,
      step,
      'extraction',
      legacyResult.telemetry,
      legacyResult.ok && Boolean(legacyResult.data) ? 'success' : 'failed'
    )
  }
  const review = unifiedAnalysis?.chapterReview ?? (legacyResult?.data
    ? sanitizeChapterReviewForPostDraft(legacyResult.data, characterIds)
    : null)
  if (!review) {
    throw new Error(
      unifiedThrownError || unifiedResult?.error || unifiedResult?.parseError ||
      legacyResult?.error || legacyResult?.parseError || '复盘生成失败'
    )
  }

  const usedAI = unifiedAnalysis ? unifiedResult?.usedAI ?? true : legacyResult?.usedAI ?? false
  const failureReason = unifiedThrownError || unifiedResult?.parseError || unifiedResult?.error || ''
  const fallbackWarning = supportsUnifiedAnalysis && !unifiedAnalysis
    ? `统一生成后分析未完成，已只补做章节复盘；角色与伏笔候选保持为空，避免重复发送整章。${failureReason ? ` 原因：${failureReason}` : ''}`
    : ''
  const auditWarnings = [...noveltyWarnings(state.noveltyAuditResult), ...(fallbackWarning ? [fallbackWarning] : [])]
  const analysisForOutput = unifiedAnalysis ?? (supportsUnifiedAnalysis ? fallbackAnalysis(review, fallbackWarning) : null)
  const timestamp = now()
  const reviewCandidates: MemoryUpdateCandidate[] = hasChapterReviewMemoryContent(review) ? [{
    id: newId(),
    projectId: project.id,
    jobId: job.id,
    type: 'chapter_review',
    targetId: null,
    proposedPatch: {
      schemaVersion: 1,
      kind: 'chapter_review_update',
      summary: review.summary || '章节复盘',
      sourceChapterOrder: options.targetChapterOrder,
      warnings: auditWarnings,
      targetChapterId: null,
      targetChapterOrder: options.targetChapterOrder,
      review: {
        summary: review.summary,
        newInformation: review.newInformation,
        characterChanges: review.characterChanges,
        newForeshadowing: review.newForeshadowing,
        resolvedForeshadowing: review.resolvedForeshadowing,
        endingHook: review.endingHook,
        riskWarnings: review.riskWarnings
      },
      continuityBridgeSuggestion: review.continuityBridgeSuggestion ?? null
    },
    evidence: usedAI ? 'AI 对生成正文的章节复盘草稿' : '本地复盘结果',
    confidence: noveltyAdjustedConfidence(state.noveltyAuditResult, usedAI ? 0.75 : 0),
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp
  }] : []
  const stateCandidates: CharacterStateChangeCandidate[] = review.characterStateChangeSuggestions.map((suggestion) => {
    const existingFact = state.working.characterStateFacts.find(
      (fact) => fact.projectId === project.id && fact.characterId === suggestion.characterId && fact.key === suggestion.key && fact.status === 'active'
    )
    const fact: CharacterStateFact = {
      id: existingFact?.id ?? newId(), projectId: project.id, characterId: suggestion.characterId,
      category: suggestion.category, key: suggestion.key, label: suggestion.label,
      valueType: Array.isArray(suggestion.afterValue) ? 'list' : typeof suggestion.afterValue === 'number' ? 'number' : 'text',
      value: suggestion.afterValue ?? existingFact?.value ?? '', unit: existingFact?.unit ?? '',
      linkedCardFields: suggestion.linkedCardFields,
      trackingLevel: suggestion.category === 'status' || suggestion.category === 'relationship' ? 'soft' : 'hard',
      promptPolicy: 'when_relevant', status: 'active', sourceChapterId: null,
      sourceChapterOrder: options.targetChapterOrder, evidence: suggestion.evidence, confidence: suggestion.confidence,
      createdAt: existingFact?.createdAt ?? timestamp, updatedAt: timestamp
    }
    const transaction: CharacterStateTransaction = {
      id: newId(), projectId: project.id, characterId: suggestion.characterId, factId: fact.id,
      chapterId: null, chapterOrder: options.targetChapterOrder, transactionType: suggestion.suggestedTransactionType,
      beforeValue: suggestion.beforeValue ?? existingFact?.value ?? null, afterValue: suggestion.afterValue,
      delta: suggestion.delta, reason: suggestion.evidence, evidence: suggestion.evidence,
      source: 'pipeline', status: 'pending', createdAt: timestamp, updatedAt: timestamp
    }
    return {
      id: newId(), projectId: project.id, jobId: job.id, characterId: suggestion.characterId,
      chapterId: null, chapterOrder: options.targetChapterOrder, candidateType: suggestion.changeType,
      targetFactId: existingFact?.id ?? null, proposedFact: fact, proposedTransaction: transaction,
      beforeValue: suggestion.beforeValue ?? existingFact?.value ?? null, afterValue: suggestion.afterValue,
      evidence: suggestion.evidence, confidence: suggestion.confidence, riskLevel: suggestion.riskLevel,
      status: 'pending', createdAt: timestamp, updatedAt: timestamp
    }
  })
  state.working = {
    ...updateStepInData(state.working, step.id, { status: 'completed', output: serializeOutput(analysisForOutput ?? review) }),
    memoryUpdateCandidates: [...reviewCandidates, ...state.working.memoryUpdateCandidates],
    characterStateChangeCandidates: [...stateCandidates, ...state.working.characterStateChangeCandidates]
  }
}
