import type {
  CharacterStateChangeCandidate,
  CharacterStateFact,
  CharacterStateTransaction,
  MemoryUpdateCandidate
} from '../../../../../shared/types'
import { newId, now } from '../../../utils/format'
import { noveltyAdjustedConfidence, noveltyWarnings, serializeOutput } from '../pipelineUtils'
import type { PipelineStepHandlerContext } from '../pipelineRunnerTypes'

export async function runChapterReviewStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options } = ctx
  const { project, aiService, updateStepInData } = env
  if (!state.draftResult) throw new Error('缺少章节正文草稿，无法复盘')
  const result = await aiService.generateChapterReview(state.draftResult.body, state.context)
  if (!result.data) throw new Error(result.error || result.parseError || '复盘生成失败')
  const auditWarnings = noveltyWarnings(state.noveltyAuditResult)
  const candidate: MemoryUpdateCandidate = {
    id: newId(),
    projectId: project.id,
    jobId: job.id,
    type: 'chapter_review',
    targetId: null,
    proposedPatch: {
      schemaVersion: 1,
      kind: 'chapter_review_update',
      summary: result.data.summary || '章节复盘',
      sourceChapterOrder: options.targetChapterOrder,
      warnings: auditWarnings,
      targetChapterId: null,
      targetChapterOrder: options.targetChapterOrder,
      review: {
        summary: result.data.summary,
        newInformation: result.data.newInformation,
        characterChanges: result.data.characterChanges,
        newForeshadowing: result.data.newForeshadowing,
        resolvedForeshadowing: result.data.resolvedForeshadowing,
        endingHook: result.data.endingHook,
        riskWarnings: result.data.riskWarnings
      },
      continuityBridgeSuggestion: result.data.continuityBridgeSuggestion ?? null
    },
    evidence: 'AI 对生成正文的章节复盘草稿',
    confidence: noveltyAdjustedConfidence(state.noveltyAuditResult, result.usedAI ? 0.75 : 0),
    status: 'pending',
    createdAt: now(),
    updatedAt: now()
  }
  const stateCandidates: CharacterStateChangeCandidate[] = result.data.characterStateChangeSuggestions.map((suggestion) => {
    const existingFact = state.working.characterStateFacts.find(
      (fact) => fact.projectId === project.id && fact.characterId === suggestion.characterId && fact.key === suggestion.key && fact.status === 'active'
    )
    const fact: CharacterStateFact = {
      id: existingFact?.id ?? newId(),
      projectId: project.id,
      characterId: suggestion.characterId,
      category: suggestion.category,
      key: suggestion.key,
      label: suggestion.label,
      valueType: Array.isArray(suggestion.afterValue) ? 'list' : typeof suggestion.afterValue === 'number' ? 'number' : 'text',
      value: suggestion.afterValue ?? existingFact?.value ?? '',
      unit: existingFact?.unit ?? '',
      linkedCardFields: suggestion.linkedCardFields,
      trackingLevel: suggestion.category === 'status' || suggestion.category === 'relationship' ? 'soft' : 'hard',
      promptPolicy: 'when_relevant',
      status: 'active',
      sourceChapterId: null,
      sourceChapterOrder: options.targetChapterOrder,
      evidence: suggestion.evidence,
      confidence: suggestion.confidence,
      createdAt: existingFact?.createdAt ?? now(),
      updatedAt: now()
    }
    const transaction: CharacterStateTransaction = {
      id: newId(),
      projectId: project.id,
      characterId: suggestion.characterId,
      factId: fact.id,
      chapterId: null,
      chapterOrder: options.targetChapterOrder,
      transactionType: suggestion.suggestedTransactionType,
      beforeValue: suggestion.beforeValue ?? existingFact?.value ?? null,
      afterValue: suggestion.afterValue,
      delta: suggestion.delta,
      reason: suggestion.evidence,
      evidence: suggestion.evidence,
      source: 'pipeline',
      status: 'pending',
      createdAt: now(),
      updatedAt: now()
    }
    return {
      id: newId(),
      projectId: project.id,
      jobId: job.id,
      characterId: suggestion.characterId,
      chapterId: null,
      chapterOrder: options.targetChapterOrder,
      candidateType: suggestion.changeType,
      targetFactId: existingFact?.id ?? null,
      proposedFact: fact,
      proposedTransaction: transaction,
      beforeValue: suggestion.beforeValue ?? existingFact?.value ?? null,
      afterValue: suggestion.afterValue,
      evidence: suggestion.evidence,
      confidence: suggestion.confidence,
      riskLevel: suggestion.riskLevel,
      status: 'pending',
      createdAt: now(),
      updatedAt: now()
    }
  })
  state.working = {
    ...updateStepInData(state.working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
    memoryUpdateCandidates: [candidate, ...state.working.memoryUpdateCandidates],
    characterStateChangeCandidates: [...stateCandidates, ...state.working.characterStateChangeCandidates]
  }
}

export async function runCharacterUpdateExtractionStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options } = ctx
  const { project, scoped, aiService, updateStepInData } = env
  if (!state.draftResult) throw new Error('缺少章节正文草稿，无法提取角色更新')
  const result = await aiService.updateCharacterStates(state.draftResult.body, scoped.characters, state.context)
  if (!result.data) throw new Error(result.error || result.parseError || '角色更新提取失败')
  const auditWarnings = noveltyWarnings(state.noveltyAuditResult)
  const candidates: MemoryUpdateCandidate[] = result.data.map((suggestion) => ({
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
    ...updateStepInData(state.working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
    memoryUpdateCandidates: [...candidates, ...state.working.memoryUpdateCandidates]
  }
}

export async function runForeshadowingUpdateExtractionStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options } = ctx
  const { project, scoped, aiService, updateStepInData } = env
  if (!state.draftResult) throw new Error('缺少章节正文草稿，无法提取伏笔更新')
  const result = await aiService.extractForeshadowing(state.draftResult.body, scoped.foreshadowings, state.context, scoped.characters)
  if (!result.data) throw new Error(result.error || result.parseError || '伏笔更新提取失败')
  const auditWarnings = noveltyWarnings(state.noveltyAuditResult)
  const newCandidates: MemoryUpdateCandidate[] = result.data.newForeshadowingCandidates.map((candidate) => ({
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
    confidence: noveltyAdjustedConfidence(state.noveltyAuditResult, result.usedAI ? 0.7 : 0),
    status: 'pending',
    createdAt: now(),
    updatedAt: now()
  }))
  const changeCandidates: MemoryUpdateCandidate[] = result.data.statusChanges.map((change) => ({
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
    ...updateStepInData(state.working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
    memoryUpdateCandidates: [...newCandidates, ...changeCandidates, ...state.working.memoryUpdateCandidates]
  }
}
