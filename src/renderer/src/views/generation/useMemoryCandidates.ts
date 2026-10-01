import type { AppData, CandidateDecisionCommand, ChapterGenerationJob, MemoryUpdateCandidate, Project, QualityGateReport } from '../../../../shared/types'
import { AuthorDecisionPolicyService } from '../../../../services/AuthorDecisionPolicyService'
import type { ConfirmFn } from '../../components/ConfirmDialog'
import { now } from '../../utils/format'
import type { SaveDataHandler } from '../../utils/saveDataState'
import type { ApplicableMemoryCandidatePatch } from './memoryCandidateActions'

interface UseMemoryCandidatesArgs {
  data?: AppData
  executeCandidateDecision?: (command: CandidateDecisionCommand) => Promise<void>
  project: Project
  selectedJob: ChapterGenerationJob | null
  qualityGateReports: QualityGateReport[]
  saveData: SaveDataHandler
  confirmAction: ConfirmFn
  setPipelineMessage: (message: string) => void
}

function showCannotApply(confirmAction: ConfirmFn, message: string) {
  return confirmAction({
    title: '无法应用记忆候选',
    message,
    confirmLabel: '知道了',
    cancelLabel: null
  })
}

export function useMemoryCandidates({ data, executeCandidateDecision, project, selectedJob, qualityGateReports, saveData, confirmAction, setPipelineMessage }: UseMemoryCandidatesArgs) {
  async function executeDecision(candidates: MemoryUpdateCandidate[], decision: 'accept' | 'reject') {
    if (!data || !executeCandidateDecision) return false
    try {
      const { previewCandidateDecisions } = await import('../../../../services/CandidateDecisionService')
      const preview = previewCandidateDecisions(data, { projectId: project.id,
        decisions: candidates.map((candidate) => ({ kind: 'memory', candidateId: candidate.id, decision })) })
      const confirmed = !preview.requiresConfirmation || await confirmAction({
        title: '确认记忆变化', confirmLabel: '确认写入', tone: 'danger',
        message: preview.items.map((item) => `${item.summary} ${item.warnings.join('；')}`).join('\n')
      })
      if (!confirmed) return true
      await executeCandidateDecision({ id: crypto.randomUUID(), projectId: project.id, actor: { kind: 'user' },
        reason: `流水线记忆候选：${decision}`, decidedAt: now(), schemaVersion: 1,
        decisions: preview.items.map(({ kind, candidateId, decision: action, expectedFingerprint }) =>
          ({ kind, candidateId, decision: action, expectedFingerprint })),
        ...(preview.requiresConfirmation ? { confirmedHighRisk: true } : {}) })
      setPipelineMessage(decision === 'accept'
        ? [`已应用 ${candidates.length} 条记忆候选；章节草稿仍可继续审核和接受。`,
          ...new Set(preview.items.flatMap((item) => item.warnings))].join('\n') : '记忆候选已拒绝。')
    } catch (error) {
      setPipelineMessage(`记忆候选处理失败：${error instanceof Error ? error.message : '请重试。'}`)
    }
    return true
  }
  async function confirmQualityGateBypass(candidates: MemoryUpdateCandidate[], title: string, confirmLabel: string): Promise<boolean> {
    const reviewReports = AuthorDecisionPolicyService.reportsForMemoryCandidates(candidates, qualityGateReports, data)
    const prompt = AuthorDecisionPolicyService.memoryCandidatePrompt(reviewReports, title, confirmLabel)
    return prompt ? confirmAction({ ...prompt, message: [prompt.message, ...candidateWarnings(candidates)].join('\n') }) : true
  }

  function candidateWarnings(candidates: MemoryUpdateCandidate[]): string[] {
    return [...new Set(candidates.flatMap((candidate) =>
      AuthorDecisionPolicyService.assessMemoryCandidateQuality(candidate, qualityGateReports, data).warnings))]
  }

  function applyPatch(
    current: AppData,
    item: ApplicableMemoryCandidatePatch,
    timestamp: string,
    actions: typeof import('./memoryCandidateActions')
  ): AppData {
    const candidateJob = current.chapterGenerationJobs.find(
      (job) => job.id === item.candidate.jobId && job.projectId === project.id
    )
    const targetChapterOrder = candidateJob?.targetChapterOrder
      ?? (selectedJob?.id === item.candidate.jobId ? selectedJob.targetChapterOrder : null)
    return actions.applyMemoryCandidatePatchToData({
      current,
      projectId: project.id,
      targetChapterOrder,
      candidate: item.candidate,
      patch: item.patch,
      timestamp
    })
  }

  async function applyCandidate(candidate: MemoryUpdateCandidate) {
    if (candidate.status !== 'pending') return
    if (await executeDecision([candidate], 'accept')) return
    const actions = await import('./memoryCandidateActions')
    const { patch, error } = actions.resolveApplicableMemoryPatch(candidate)
    if (!patch) {
      await showCannotApply(confirmAction, error ?? '该记忆候选无法应用。')
      return
    }

    const ok = await confirmQualityGateBypass([candidate], '质量门禁未通过', '应用记忆更新')
    if (!ok) return

    const timestamp = now()
    const saved = await saveData((current) => applyPatch(current, { candidate, patch, error: null }, timestamp, actions))
    if (!saved.ok) {
      setPipelineMessage(`记忆候选应用失败：${saved.errorMessage}`)
      return
    }
    setPipelineMessage(['记忆候选已写入对应账本；章节草稿仍可继续审核和接受。', ...candidateWarnings([candidate])].join('\n'))
  }

  async function applyAllPendingCandidates(candidates: MemoryUpdateCandidate[]) {
    const pending = candidates.filter((candidate) => candidate.status === 'pending')
    if (!pending.length) return
    if (await executeDecision(pending, 'accept')) return

    const actions = await import('./memoryCandidateActions')
    const applicable = pending
      .map((candidate) => ({ candidate, ...actions.resolveApplicableMemoryPatch(candidate) }))
      .filter((item): item is ApplicableMemoryCandidatePatch => Boolean(item.patch))
    const skipped = pending.length - applicable.length
    if (!applicable.length) {
      await showCannotApply(confirmAction, '没有可安全应用的待确认记忆候选。')
      return
    }

    const ok = await confirmQualityGateBypass(applicable.map((item) => item.candidate), '一键通过记忆候选', `应用 ${applicable.length} 条候选`)
    if (!ok) return

    const timestamp = now()
    const saved = await saveData((current) =>
      applicable.reduce<AppData>((nextData, item) => applyPatch(nextData, item, timestamp, actions), current)
    )
    if (!saved.ok) {
      setPipelineMessage(`记忆候选批量应用失败：${saved.errorMessage}`)
      return
    }
    setPipelineMessage([`已应用 ${applicable.length} 条记忆候选；章节草稿仍可继续审核和接受。`,
      ...candidateWarnings(applicable.map((item) => item.candidate))].join('\n'))
    if (skipped > 0) {
      await showCannotApply(confirmAction, `已应用 ${applicable.length} 条候选，另有 ${skipped} 条因格式不安全被跳过。`)
    }
  }

  async function rejectCandidate(candidate: MemoryUpdateCandidate) {
    if (candidate.status !== 'pending') return
    if (await executeDecision([candidate], 'reject')) return
    const { rejectMemoryCandidateInData } = await import('./memoryCandidateActions')
    const timestamp = now()
    const saved = await saveData((current) => rejectMemoryCandidateInData(current, candidate, timestamp))
    if (!saved.ok) setPipelineMessage(`记忆候选拒绝失败：${saved.errorMessage}`)
  }

  return { applyCandidate, applyAllPendingCandidates, rejectCandidate }
}
