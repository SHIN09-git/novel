import { AuthorDecisionPolicyService } from '../../../../services/AuthorDecisionPolicyService'
import { latestQualityReportForText } from '../../../../services/DraftDiagnosticBindingService'
import {
  applyRevisionCommitBundleToAppData,
  buildRevisionCommitBundle
} from '../../../../services/RevisionCommitBundleService'
import {
  canAcceptRevisionVersionStatus,
  canEditRevisionVersionStatus,
  canRejectRevisionVersionStatus
} from '../../../../shared/revisionVersionPolicy'
import type { AppData, ID, RevisionCommitBundle, RevisionVersion } from '../../../../shared/types'
import { getNovelDirectorClipboardApi } from '../../platform/novelDirectorBridge'
import { newId, now } from '../../utils/format'
import { applyAcceptedRevisionWriteback } from '../../utils/revisionWriteback'
import { upsertGenerationRunTraceByJobId } from '../../utils/runTrace'
import { resolveRevisionAcceptanceTarget } from './revisionAcceptanceSnapshot'
import type { RevisionStudioActionContext } from './revisionStudioActionTypes'

export async function persistEditedVersionBody(context: RevisionStudioActionContext): Promise<boolean> {
  const { selectedVersion, editableVersionBody, saveData, setEditableVersionBody, setMessage } = context
  if (!selectedVersion || editableVersionBody === selectedVersion.body) return true
  if (!canEditRevisionVersionStatus(selectedVersion.status)) {
    setEditableVersionBody(selectedVersion.body)
    setMessage('已接受、拒绝或被取代的历史版本不可直接改写；请使用“继续修改”创建新版本。')
    return false
  }
  if (!editableVersionBody.trim()) {
    setMessage('修订版本正文不能为空。')
    return false
  }
  const versionId = selectedVersion.id
  const nextBody = editableVersionBody
  let saved = false
  const outcome = await saveData((current) => ({
    ...current,
    revisionVersions: current.revisionVersions.map((item) => {
      if (item.id !== versionId || !canEditRevisionVersionStatus(item.status)) return item
      if (item.body !== selectedVersion.body && item.body !== nextBody) {
        throw new Error('修订候选已被另一处更新，请核对最新版本后再保存。')
      }
      saved = true
      return { ...item, body: nextBody, updatedAt: now() }
    })
  }))
  if (!outcome.ok) {
    setMessage(`修订版本保存失败：${outcome.errorMessage}`)
    return false
  }
  if (!saved) {
    setMessage('修订版本状态已经变化，本次编辑未写入历史版本。')
    return false
  }
  return true
}

export async function selectRevisionVersion(context: RevisionStudioActionContext, versionId: ID): Promise<void> {
  if (context.selectedVersion?.id === versionId) return
  if (!(await persistEditedVersionBody(context))) return
  context.setSelectedVersionId(versionId)
}

export async function acceptVersion(
  context: RevisionStudioActionContext,
  requestedVersion: RevisionVersion
): Promise<void> {
  let version = requestedVersion
  if (context.selectedVersion?.id === requestedVersion.id && context.editableVersionBody !== context.selectedVersion.body) {
    if (!(await persistEditedVersionBody(context))) return
    version = { ...requestedVersion, body: context.editableVersionBody }
  }
  if (!canAcceptRevisionVersionStatus(version.status)) {
    context.setMessage('该修订版本已经进入历史状态，不能再次接受。可点击“继续修改”创建新版本。')
    return
  }
  if (!version.body.trim()) {
    context.setMessage('修订版本正文为空，无法接受。')
    return
  }
  if (context.sourceKind === 'chapter' && !context.selectedChapter) return
  if (context.sourceKind === 'draft' && !context.selectedDraft) {
    context.setMessage('请先选择一个草稿。')
    return
  }
  const matchingReport = latestQualityReportForText(context.latestQualityReports, version.body)
  const lowScoreReport = matchingReport && AuthorDecisionPolicyService.assessQualityGate(matchingReport).requiresHumanReview
    ? matchingReport
    : null
  const reviewWarning = lowScoreReport
    ? AuthorDecisionPolicyService.revisionAcceptancePrompt(lowScoreReport).message
    : !matchingReport && context.latestQualityReports.length > 0
      ? '已有质量报告对应的是修改前正文，当前修订尚未重新审稿。你可以保留这次修改，稍后审稿。'
      : ''
  const confirmMessage =
    context.sourceKind === 'chapter'
      ? '确定接受该修订版本并写回章节正文吗？旧正文会先进入版本历史。'
      : context.linkedDraftChapter
        ? '确定接受该修订版本并同步更新草稿和关联章节吗？旧章节正文会先进入版本历史。'
        : '确定接受该修订版本并更新草稿吗？该草稿尚未关联章节，本次不会写入任何已有章节。'
  const confirmed = await context.confirmAction({
    title: '接受修订版本',
    message: [version.responseScope === 'broader_than_requested'
      ? '这次局部重写返回了更大范围的内容。本次将采用右侧完整候选，不仅替换原选区；请确认已检查整章差异。' : '', reviewWarning, confirmMessage].filter(Boolean).join('\n\n'),
    confirmLabel: version.responseScope === 'broader_than_requested' ? '确认采用整章候选' : '接受修订',
    tone: reviewWarning ? 'danger' : 'default'
  })
  if (!confirmed) return
  const timestamp = now()
  let writebackMessage = ''
  const createRevisionCommit = (current: AppData): { next: AppData; bundle: RevisionCommitBundle } | null => {
    const { targetChapter } = resolveRevisionAcceptanceTarget(current, context, version)
    if (!targetChapter) {
      writebackMessage = '无法提交修订：目标章节不存在。'
      return null
    }

    const bundle = buildRevisionCommitBundle({
      appData: current,
      projectId: context.project.id,
      chapterId: targetChapter.id,
      revisionCommitId: newId(),
      newChapterVersionId: newId(),
      revisionSessionId: version.sessionId,
      revisionVersionId: version.id,
      revisedAt: timestamp,
      revisedBy: 'user_with_ai',
      revisionReason: version.title,
      revisionNote: context.sourceKind === 'draft' ? '接受草稿修订版本。' : '接受章节修订版本。'
    })

    writebackMessage =
      context.sourceKind === 'draft'
        ? '已接受草稿修订版本，同步更新草稿与关联章节，并记录正式修订提交。'
        : '已接受修订版本，并记录正式修订提交。'
    return {
      next: applyRevisionCommitBundleToAppData(current, bundle),
      bundle
    }
  }

  if (!(context.sourceKind === 'draft' && !context.linkedDraftChapter)) {
    try {
      if (context.saveRevisionCommitBundle) {
        await context.saveRevisionCommitBundle((current) => {
          const result = createRevisionCommit(current)
          if (!result) throw new Error(writebackMessage || '无法提交修订。')
          return result
        })
      } else {
        const saved = await context.saveData((current) => createRevisionCommit(current)?.next ?? current)
        if (!saved.ok) {
          context.setMessage(`修订提交失败：${saved.errorMessage}`)
          return
        }
      }
    } catch (error) {
      context.setMessage(error instanceof Error ? error.message : '修订提交失败。')
      return
    }
    context.setMessage(writebackMessage)
    return
  }

  const saved = await context.saveData((current) => {
    const { currentVersion, currentDraft } = resolveRevisionAcceptanceTarget(current, context, version)
    const acceptedVersion: RevisionVersion = {
      ...currentVersion,
      updatedAt: timestamp
    }
    if (!currentDraft) {
      writebackMessage = '草稿已不存在，无法写回修订版本。'
      return current
    }
    const currentWritebackSource = {
      kind: 'draft' as const,
      draft: currentDraft,
      linkedChapter: null
    }
    const writeback = applyAcceptedRevisionWriteback(
      current,
      context.project.id,
      currentWritebackSource,
      acceptedVersion,
      timestamp
    )
    writebackMessage = writeback.message
    let nextData: AppData = writeback.data
    const sourceSession = current.revisionSessions.find((session) => session.id === acceptedVersion.sessionId)
    const sourceDraft = sourceSession?.sourceDraftId
      ? current.generatedChapterDrafts.find((draft) => draft.id === sourceSession.sourceDraftId)
      : null
    if (sourceDraft?.jobId && sourceSession) {
      const existingTrace = current.generationRunTraces.find((trace) => trace.jobId === sourceDraft.jobId)
      nextData = upsertGenerationRunTraceByJobId(nextData, sourceDraft.jobId, {
        revisionSessionIds: [...new Set([...(existingTrace?.revisionSessionIds ?? []), sourceSession.id])],
        acceptedRevisionVersionId: acceptedVersion.id
      })
    }
    return nextData
  })
  if (!saved.ok) {
    context.setMessage(`修订版本保存失败：${saved.errorMessage}`)
    return
  }
  context.setMessage(writebackMessage)
}

export async function rejectVersion(context: RevisionStudioActionContext, version: RevisionVersion): Promise<void> {
  if (!canRejectRevisionVersionStatus(version.status)) {
    context.setMessage('该修订版本已经进入历史状态，不能重复拒绝。')
    return
  }
  let rejected = false
  const outcome = await context.saveData((current) => ({
    ...current,
    revisionVersions: current.revisionVersions.map((item) => {
      if (item.id !== version.id || !canRejectRevisionVersionStatus(item.status)) return item
      rejected = true
      return { ...item, status: 'rejected', updatedAt: now() }
    })
  }))
  if (!outcome.ok) {
    context.setMessage(`拒绝修订版本失败：${outcome.errorMessage}`)
    return
  }
  context.setMessage(rejected ? '已拒绝该修订版本。' : '修订版本状态已经变化，本次拒绝未执行。')
}

export async function copyRevisionVersion(
  context: RevisionStudioActionContext,
  version: Pick<RevisionVersion, 'body'>
): Promise<void> {
  try {
    await getNovelDirectorClipboardApi().writeText(version.body)
    context.setMessage('已复制修订版本正文。')
  } catch (error) {
    context.setMessage(error instanceof Error ? `复制失败：${error.message}` : '复制失败，请重试。')
  }
}
