import type {
  CharacterStateSuggestion,
  ForeshadowingExtractionResult,
  MemoryUpdateCandidate
} from '../../../../../shared/types'
import { newId, now } from '../../../utils/format'
import { appendGenerationRunTraceAiCall } from '../../../utils/runTrace'
import {
  sanitizeCharacterSuggestionsForPostDraft,
  sanitizeForeshadowingExtractionForPostDraft
} from '../../../../../services/ai/AIResponseNormalizer'
import { noveltyAdjustedConfidence, noveltyWarnings, serializeOutput } from '../pipelineUtils'
import type { PipelineStepHandlerContext } from '../pipelineRunnerTypes'
import { postDraftAnalysisFromWorking } from './postDraftAnalysis'
export { runChapterReviewStep } from './postDraftAnalysis'

export async function runCharacterUpdateExtractionStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options } = ctx
  const { project, scoped, updateStepInData } = env
  if (!state.draftResult) throw new Error('缺少章节正文草稿，无法提取角色更新')
  const characterIds = new Set(scoped.characters.map((character) => character.id))
  const foreshadowingIds = new Set(scoped.foreshadowings.map((item) => item.id))
  const sharedAnalysis = postDraftAnalysisFromWorking(state.working, job.id, characterIds, foreshadowingIds)
  let suggestions: CharacterStateSuggestion[]
  if (sharedAnalysis) {
    suggestions = sharedAnalysis.characterSuggestions
  } else {
    const aiService = await env.getAiService('extraction')
    if (typeof aiService.updateCharacterStates !== 'function') throw new Error('当前 AI 服务不支持角色更新提取')
    const result = await aiService.updateCharacterStates(state.draftResult.body, scoped.characters, state.context)
    state.working = appendGenerationRunTraceAiCall(
      state.working,
      job.id,
      step,
      'extraction',
      result.telemetry,
      result.ok && Boolean(result.data) ? 'success' : 'failed'
    )
    if (!result.data) throw new Error(result.error || result.parseError || '角色更新提取失败')
    suggestions = sanitizeCharacterSuggestionsForPostDraft(result.data, characterIds)
  }
  const auditWarnings = noveltyWarnings(state.noveltyAuditResult)
  const candidates: MemoryUpdateCandidate[] = suggestions.map((suggestion) => ({
    id: newId(),
    projectId: project.id,
    jobId: job.id,
    type: 'character',
    targetId: suggestion.characterId,
    proposedPatch: {
      schemaVersion: 1,
      kind: 'character_state_update',
      summary: suggestion.changeSummary || '角色变化',
      sourceChapterOrder: options.targetChapterOrder,
      warnings: auditWarnings,
      characterId: suggestion.characterId,
      relatedChapterId: suggestion.relatedChapterId ?? null,
      relatedChapterOrder: options.targetChapterOrder,
      changeSummary: suggestion.changeSummary,
      newCurrentEmotionalState: suggestion.newCurrentEmotionalState,
      newRelationshipWithProtagonist: suggestion.newRelationshipWithProtagonist,
      newNextActionTendency: suggestion.newNextActionTendency
    },
    evidence: suggestion.changeSummary,
    confidence: noveltyAdjustedConfidence(state.noveltyAuditResult, suggestion.confidence),
    status: 'pending',
    createdAt: now(),
    updatedAt: now()
  }))
  state.working = {
    ...updateStepInData(state.working, step.id, { status: 'completed', output: serializeOutput(suggestions) }),
    memoryUpdateCandidates: [...candidates, ...state.working.memoryUpdateCandidates]
  }
}

export async function runForeshadowingUpdateExtractionStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options } = ctx
  const { project, scoped, updateStepInData } = env
  if (!state.draftResult) throw new Error('缺少章节正文草稿，无法提取伏笔更新')
  const characterIds = new Set(scoped.characters.map((character) => character.id))
  const foreshadowingIds = new Set(scoped.foreshadowings.map((item) => item.id))
  const sharedAnalysis = postDraftAnalysisFromWorking(state.working, job.id, characterIds, foreshadowingIds)
  let extraction: ForeshadowingExtractionResult
  let usedAI = Boolean(sharedAnalysis)
  if (sharedAnalysis) {
    extraction = sharedAnalysis.foreshadowingExtraction
  } else {
    const aiService = await env.getAiService('extraction')
    if (typeof aiService.extractForeshadowing !== 'function') throw new Error('当前 AI 服务不支持伏笔更新提取')
    const result = await aiService.extractForeshadowing(state.draftResult.body, scoped.foreshadowings, state.context, scoped.characters)
    state.working = appendGenerationRunTraceAiCall(
      state.working,
      job.id,
      step,
      'extraction',
      result.telemetry,
      result.ok && Boolean(result.data) ? 'success' : 'failed'
    )
    if (!result.data) throw new Error(result.error || result.parseError || '伏笔更新提取失败')
    extraction = sanitizeForeshadowingExtractionForPostDraft(result.data, foreshadowingIds, characterIds)
    usedAI = result.usedAI
  }
  const auditWarnings = noveltyWarnings(state.noveltyAuditResult)
  const newCandidates: MemoryUpdateCandidate[] = extraction.newForeshadowingCandidates.map((candidate) => ({
    id: newId(),
    projectId: project.id,
    jobId: job.id,
    type: 'foreshadowing',
    targetId: null,
    proposedPatch: {
      schemaVersion: 1,
      kind: 'foreshadowing_create',
      summary: candidate.title || '新伏笔',
      sourceChapterOrder: options.targetChapterOrder,
      warnings: auditWarnings,
      candidate
    },
    evidence: candidate.description,
    confidence: noveltyAdjustedConfidence(state.noveltyAuditResult, usedAI ? 0.7 : 0),
    status: 'pending',
    createdAt: now(),
    updatedAt: now()
  }))
  const changeCandidates: MemoryUpdateCandidate[] = extraction.statusChanges.map((change) => ({
    id: newId(),
    projectId: project.id,
    jobId: job.id,
    type: 'foreshadowing',
    targetId: change.foreshadowingId,
    proposedPatch: {
      schemaVersion: 1,
      kind: 'foreshadowing_status_update',
      summary: change.evidenceText || '伏笔状态变化',
      sourceChapterOrder: options.targetChapterOrder,
      warnings: auditWarnings,
      foreshadowingId: change.foreshadowingId,
      suggestedStatus: change.suggestedStatus,
      recommendedTreatmentMode: change.recommendedTreatmentMode,
      actualPayoffChapter: change.suggestedStatus === 'resolved' ? options.targetChapterOrder : null,
      evidenceText: change.evidenceText,
      notes: change.notes
    },
    evidence: change.evidenceText,
    confidence: noveltyAdjustedConfidence(state.noveltyAuditResult, change.confidence),
    status: 'pending',
    createdAt: now(),
    updatedAt: now()
  }))
  state.working = {
    ...updateStepInData(state.working, step.id, { status: 'completed', output: serializeOutput(extraction) }),
    memoryUpdateCandidates: [...newCandidates, ...changeCandidates, ...state.working.memoryUpdateCandidates]
  }
}
