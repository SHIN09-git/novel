import type { ChapterPlan, ChapterTask } from '../../../../../shared/types'
import { readChapterProseHandoff, type ChapterProseHandoff } from '../../../../../shared/chapterProseHandoff'
import { chapterDraftMessages } from '../../../../../services/ai/GenerationPipelineAI'
import { newId } from '../../../utils/format'
import type { PipelineStepHandlerContext } from '../pipelineRunnerTypes'
import { validateAuthoritativeChapterTaskDraft } from '../pipelineUtils'
import { persistCapturedDraft } from './draftCapture'

export async function receiveOrRequestProse(ctx: PipelineStepHandlerContext, plan: ChapterPlan, task: ChapterTask, inputHash: string) {
  const { state, step, env, job, options } = ctx
  const previous = readChapterProseHandoff(step)
  const submission = env.agentDraftSubmission
  if (submission && previous?.inputHash === inputHash) {
    if (previous.handoffId !== submission.handoffId) throw new Error('交接单已失效，请读取最新工作单。')
    const error = validateAuthoritativeChapterTaskDraft(submission.body, submission.title, options.estimatedWordCount,
      true, job.chapterTaskSnapshot, { allowReviewableLengthOverflow: true, allowReviewableLengthUnderflow: true })
    if (error) throw new Error(error)
    return persistCapturedDraft(ctx, submission, plan, inputHash, {
      handoffReceipt: { handoffId: previous.handoffId, submissionHash: submission.submissionHash },
      ...(submission.actorTag ? { actorTag: submission.actorTag } : {})
    })
  }
  const handoff: ChapterProseHandoff = previous?.inputHash === inputHash ? previous : {
    kind: 'awaiting_prose_draft', handoffId: newId(), inputHash, plan,
    messages: chapterDraftMessages(plan, state.context, {
      mode: options.pipelineMode, targetChapterOrder: options.targetChapterOrder,
      estimatedWordCount: options.estimatedWordCount, readerEmotionTarget: options.readerEmotionTarget,
      chapterTask: task, authoritativeChapterTask: Boolean(job.chapterTaskSnapshot)
    }),
    includedHardCanonItemIds: state.working.generationRunTraces.find(t => t.jobId === job.id)?.includedHardCanonItemIds ?? []
  }
  state.working = env.updateStepInData(state.working, step.id,
    { status: 'pending', output: JSON.stringify(handoff), errorMessage: '' },
    { status: 'paused', currentStep: step.type, errorMessage: submission ? '写作依据已改变，本次未收稿。请按新交接单核对正文再提交。' : '' })
  return null
}
