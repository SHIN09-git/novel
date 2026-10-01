import {
  relocateRevisionRequest,
  revisionTargetMatchCount
} from '../../../../services/RevisionRequestRelocationService'
import { draftContentHash } from '../../../../services/DraftDiagnosticBindingService'
import { newId, now } from '../../utils/format'
import type { RevisionStudioActionContext } from './revisionStudioActionTypes'

export async function relocateSourceRequest(
  context: RevisionStudioActionContext,
  mode: 'selection' | 'full_chapter'
): Promise<void> {
  const request = context.sourceRequest
  if (!request) {
    context.setMessage('原修订要求已不存在，请重新选择修订问题。')
    return
  }
  if (mode === 'selection' && revisionTargetMatchCount(context.sourceBody, context.targetRange) !== 1) {
    context.setMessage('新选区必须在当前正文中唯一出现；请重新选择段落或转为整章修订。')
    return
  }
  const confirmed = await context.confirmAction({
    title: '在最新正文重新定位',
    message: mode === 'full_chapter'
      ? '确定将当前修改要求重新绑定到最新正文，并明确改为整章修订吗？原要求和旧候选会保留。'
      : '确定将当前修改要求和选区重新绑定到最新正文吗？原要求和旧候选会保留。',
    confirmLabel: mode === 'full_chapter' ? '转为整章并确认' : '确认重新定位'
  })
  if (!confirmed) return

  const relocatedRequestId = newId()
  const createdAt = now()
  let relocated = false
  const saved = await context.saveData((current) => {
    const result = relocateRevisionRequest(current, {
      projectId: context.project.id,
      sourceKind: context.sourceKind,
      chapterId: context.selectedChapter?.id ?? '',
      sourceDraftId: context.sourceKind === 'draft' ? context.selectedDraft?.id ?? null : null,
      requestId: request.id,
      expectedSourceContentHash: draftContentHash(context.sourceBody),
      mode,
      targetRange: context.targetRange,
      type: context.revisionType,
      instruction: context.instruction,
      relocatedRequestId,
      createdAt
    })
    relocated = true
    return result.data
  })
  if (!saved.ok || !relocated) {
    context.setMessage(`重新定位失败：${saved.ok ? '修订要求没有保存。' : saved.errorMessage}`)
    return
  }
  context.setSourceRequestId(relocatedRequestId)
  if (mode === 'full_chapter') context.setTargetRange('')
  context.setMessage('已在最新正文重新定位。你可以检查要求后生成新的修订版本。')
}
