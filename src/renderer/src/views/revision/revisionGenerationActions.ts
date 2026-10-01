import type {
  QualityGateIssue,
  RevisionRequest,
  RevisionVersion
} from '../../../../shared/types'
import { newId, now } from '../../utils/format'
import { draftContentHash } from '../../../../services/DraftDiagnosticBindingService'
import { assertRevisionSourceMatches } from '../../../../services/RevisionSourceBindingService'
import {
  LocalRevisionMergeError,
  looksLikeFullChapterRevision,
  mergeLocalRevisionSafely
} from '../../utils/revisionMerge'
import {
  createRevisionSourceSnapshot,
  resolveRevisionResponseSession,
  selectRevisionSession
} from './revisionSessionModel'
import type {
  RevisionGenerationOverride,
  RevisionStudioActionContext
} from './revisionStudioActionTypes'
import { issueToRevisionType, revisionTypeName } from './revisionTypeCatalog'

export async function generateRevisionFromCurrent(
  context: RevisionStudioActionContext,
  override?: RevisionGenerationOverride
): Promise<void> {
  const {
    sourceKind,
    selectedChapter,
    selectedDraft,
    sourceBody,
    sourceTitle,
    targetRange,
    revisionType,
    instruction,
    saveData,
    getAiService,
    buildRevisionContext,
    setLoading,
    setMessage,
    setSelectedVersionId,
    setRevisionViewMode
  } = context
  if (sourceKind === 'chapter' && !selectedChapter) {
    setMessage('请先创建或选择一个章节。')
    return
  }
  if (sourceKind === 'draft' && !selectedDraft) {
    setMessage('请先选择一个草稿。')
    return
  }
  const hasOverrideSourceText = typeof override?.sourceText === 'string'
  const rawTarget = hasOverrideSourceText ? '' : override?.targetRange ?? targetRange
  const fullChapterText = hasOverrideSourceText ? override?.sourceText ?? '' : sourceBody
  const isLocalRevision = Boolean(rawTarget.trim()) && !hasOverrideSourceText
  const targetText = isLocalRevision ? rawTarget.trim() : fullChapterText
  if (!targetText.trim()) {
    setMessage('当前没有可修订的正文。')
    return
  }
  const type = override?.type ?? revisionType
  const finalInstruction = override?.instruction ?? instruction
  setLoading(true)
  setMessage('')
  try {
    if (hasOverrideSourceText && context.selectedVersion && ['draft', 'pending'].includes(context.selectedVersion.status)) {
      assertRevisionSourceMatches(context.selectedVersion, sourceBody, context.linkedDraftChapter?.body)
    }
    const sourceRequest = hasOverrideSourceText ? null : context.sourceRequest
    if (sourceRequest?.sourceDraftContentHash && sourceRequest.sourceDraftContentHash !== draftContentHash(sourceBody)) {
      throw new Error('这份修订要求对应的原文已经变化，请从最新正文重新选择修订问题。')
    }
    // Validate the selection before a paid request, not only when merging its response.
    if (isLocalRevision) mergeLocalRevisionSafely(fullChapterText, rawTarget, rawTarget.trim())
    const aiService = await getAiService()
    const result = await aiService.generateRevision(
      {
        type,
        targetRange: isLocalRevision ? rawTarget.trim() : undefined,
        instruction: finalInstruction,
        revisionScope: isLocalRevision ? 'local' : 'full',
        fullChapterText
      },
      buildRevisionContext()
    )
    if (!result.data) {
      setMessage(result.error || '修订生成失败。')
      return
    }
    if (!result.data.revisedText.trim()) {
      setMessage(result.error || '修订生成失败：AI 返回的 revisedText 为空。')
      return
    }
    const broaderResponse = isLocalRevision && looksLikeFullChapterRevision(fullChapterText, rawTarget, result.data.revisedText)
    const timestamp = now()
    const sourceSnapshot = createRevisionSourceSnapshot({
      projectId: context.project.id,
      chapterId: selectedChapter?.id ?? '',
      sourceDraftId: sourceKind === 'draft' ? selectedDraft?.id ?? null : null,
      sourceBody,
      sourceChapterBody: context.linkedDraftChapter?.body
    })
    const { session, reusedSession } = selectRevisionSession(
      context.activeSessions,
      sourceSnapshot,
      timestamp,
      newId
    )
    const request: RevisionRequest = {
      id: newId(),
      sessionId: session.id,
      type,
      targetRange: rawTarget.trim(),
      instruction: finalInstruction,
      ...(sourceRequest ? {
        relocatedFromRequestId: sourceRequest.relocatedFromRequestId,
        sourceEditorialVerdictId: sourceRequest.sourceEditorialVerdictId,
        sourceEditorialIssueId: sourceRequest.sourceEditorialIssueId,
        sourceDraftContentHash: sourceRequest.sourceDraftContentHash
      } : {}),
      createdAt: timestamp
    }
    const finalBody = isLocalRevision && !broaderResponse
      ? mergeLocalRevisionSafely(fullChapterText, rawTarget, result.data.revisedText)
      : result.data.revisedText
    const version: RevisionVersion = {
      id: newId(),
      sessionId: session.id,
      requestId: request.id,
      title: `${sourceTitle || (selectedChapter ? `第 ${selectedChapter.order} 章` : '未关联章节草稿')} · ${revisionTypeName(type)}`,
      body: finalBody,
      changedSummary: result.data.changedSummary,
      risks: result.data.risks,
      preservedFacts: result.data.preservedFacts,
      sourceContentHash: sourceSnapshot.sourceContentHash,
      ...(broaderResponse ? { responseScope: 'broader_than_requested' as const } : {}),
      ...(sourceSnapshot.sourceChapterContentHash
        ? { sourceChapterContentHash: sourceSnapshot.sourceChapterContentHash }
        : {}),
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    let lateResponseNotice = ''
    const saved = await saveData((current) => {
      const resolved = resolveRevisionResponseSession({
        current,
        sourceKind,
        source: sourceSnapshot,
        requestedSession: session,
        reusedSession,
        timestamp,
        createId: newId
      })
      const effectiveSession = resolved.session
      const effectiveRequest = effectiveSession.id === request.sessionId
        ? request
        : { ...request, sessionId: effectiveSession.id }
      const effectiveVersion = effectiveSession.id === version.sessionId
        ? version
        : { ...version, sessionId: effectiveSession.id }

      lateResponseNotice = resolved.notice
      return {
        ...current,
        revisionSessions: resolved.appendSession
          ? [effectiveSession, ...current.revisionSessions]
          : current.revisionSessions.map((item) =>
              item.id === effectiveSession.id ? { ...item, updatedAt: timestamp } : item
            ),
        revisionRequests: [effectiveRequest, ...current.revisionRequests],
        revisionVersions: [effectiveVersion, ...current.revisionVersions]
      }
    })
    if (!saved.ok) {
      setMessage(`修订版本保存失败：${saved.errorMessage}`)
      return
    }
    setSelectedVersionId(version.id)
    setRevisionViewMode('diff')
    const completionMessage = result.error ||
      (result.usedAI ? '修订版本已生成，接受前请对照检查。' : '未配置 API Key，已生成本地安全模板。')
    setMessage([lateResponseNotice, broaderResponse ? 'AI 返回范围超出选区，结果已保留为整章候选，未替换原文。请对比后决定。' : '', completionMessage].filter(Boolean).join('\n'))
  } catch (error) {
    if (error instanceof LocalRevisionMergeError) {
      setMessage('局部修订目标未能在原文中唯一匹配，请从正文中重新复制目标段落。')
    } else {
      setMessage(error instanceof Error ? error.message : '修订生成失败。')
    }
  } finally {
    setLoading(false)
  }
}

export async function startFromQualityIssue(
  context: RevisionStudioActionContext,
  issue: QualityGateIssue
): Promise<void> {
  const type = issueToRevisionType(issue)
  const instruction = issue.suggestedFix || issue.description
  context.setRevisionType(type)
  context.setInstruction(instruction)
  await generateRevisionFromCurrent(context, {
    type,
    instruction,
    targetRange: issue.evidence || ''
  })
}
