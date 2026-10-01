import type { EditorialVerdict, EditorialVerdictIssue } from '../../../../shared/types'
import { buildEditorialRevisionRequest } from '../../../../services/EditorialRevisionRequestService'
import { appendGenerationRunTraceIds } from '../../utils/runTrace'
import { newId, now } from '../../utils/format'
import type { PipelineRevisionActionContext } from './pipelineRevisionActionHandlers'

export async function startRevisionFromEditorialIssue(context: PipelineRevisionActionContext,
  verdict: EditorialVerdict, issue: EditorialVerdictIssue): Promise<void> {
  if (!context.onOpenRevision) return
  let result: ReturnType<typeof buildEditorialRevisionRequest> | undefined
  const input = { projectId: context.project.id, verdictId: verdict.id, issueId: issue.id,
    expectedDraftHash: verdict.draftContentHash, sessionId: newId(), requestId: newId(), createdAt: now() }
  try {
    const saved = await context.saveData((current) => {
      result = buildEditorialRevisionRequest(current, input)
      return appendGenerationRunTraceIds(result.data, verdict.jobId, 'revisionSessionIds', [result.session.id])
    })
    if (!saved.ok) throw new Error(saved.errorMessage)
    if (!result) throw new Error('修订请求未创建。')
    context.setPipelineMessage(result.request.targetRange ? '已定位证据段落，可以修改要求后生成修订。' : '已带入问题说明，请先选择修订范围。')
    context.onOpenRevision({ chapterId: result.session.chapterId || null, draftId: result.session.sourceDraftId,
      requestId: result.request.id })
  } catch (error) {
    context.setPipelineMessage(`创建修订请求失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
