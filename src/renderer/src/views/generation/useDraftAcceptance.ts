import type {
  AppData,
  ChapterCommitBundle,
  Chapter,
  ChapterGenerationJob,
  GeneratedChapterDraft,
  ID,
  Project,
  QualityGateReport,
  EditorialVerdict,
  ChapterAcceptanceReview
} from '../../../../shared/types'
import { AuthorDecisionPolicyService } from '../../../../services/AuthorDecisionPolicyService'
import { latestQualityReportForDraft } from '../../../../services/DraftDiagnosticBindingService'
import { hasCompleteChapterReview } from '../../../../services/ChapterAcceptanceReviewService'
import type { ConfirmFn } from '../../components/ConfirmDialog'
import { newId, now } from '../../utils/format'
import { projectData } from '../../utils/projectData'
import type { SaveDataHandler } from '../../utils/saveDataState'
import { getNovelDirectorDataApi } from '../../platform/novelDirectorBridge'

interface UseDraftAcceptanceArgs {
  project: Project
  saveData: SaveDataHandler
  saveChapterCommitBundle?: (buildCommit: (currentData: AppData) => { next: AppData; bundle: ChapterCommitBundle }) => Promise<void>
  selectedJob: ChapterGenerationJob | null
  targetChapterOrder: number
  chapters: Chapter[]
  qualityGateReports: QualityGateReport[]
  /** Optional for legacy callers; an empty collection means verdicts are authoritative. */
  editorialVerdicts?: ReadonlyArray<EditorialVerdict>
  confirmAction: ConfirmFn
  setPipelineMessage: (message: string) => void
}

function updateProjectTimestamp(data: AppData, projectId: ID): Project[] {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: now() } : project))
}

export function useDraftAcceptance({
  project,
  saveData,
  saveChapterCommitBundle,
  selectedJob,
  targetChapterOrder,
  chapters,
  qualityGateReports,
  editorialVerdicts,
  confirmAction,
  setPipelineMessage
}: UseDraftAcceptanceArgs) {
  async function acceptDraft(draft: GeneratedChapterDraft, mode: ChapterAcceptanceReview['mode'] = 'reviewed') {
    if (draft.status !== 'draft') return
    if (selectedJob?.status === 'running') {
      setPipelineMessage('生成仍在运行，请先停止或等待完成再采纳。')
      return
    }
    const report = latestQualityReportForDraft(qualityGateReports.filter((item) => item.projectId === draft.projectId && item.jobId === draft.jobId), draft)
    let authoritativeVerdicts = editorialVerdicts
    if (!authoritativeVerdicts && selectedJob?.pipelineRecipe) {
      try {
        authoritativeVerdicts = (await getNovelDirectorDataApi().load()).data.editorialVerdicts
      } catch (error) {
        setPipelineMessage(`读取当前编辑裁定失败：${error instanceof Error ? error.message : String(error)}`)
        return
      }
    }
    const verdict = authoritativeVerdicts
      ? AuthorDecisionPolicyService.latestEditorialVerdictForDraft(authoritativeVerdicts, draft)
      : null
    const complete = hasCompleteChapterReview(report, verdict, Boolean(authoritativeVerdicts) || Boolean(selectedJob?.pipelineRecipe))
    if (mode === 'reviewed' && !complete) {
      setPipelineMessage('当前正文尚未完成匹配的审稿。请重新检查，或选择“未完成审稿，直接采纳”保留正文。')
      return
    }
    if (mode === 'unreviewed' && complete) {
      setPipelineMessage('当前正文已有完整审稿，请查看结论后使用正常采纳。')
      return
    }
    let reviewPrompt: ReturnType<typeof AuthorDecisionPolicyService.draftAcceptancePrompt> | null = null
    if (verdict && verdict.status !== 'incomplete') {
      const verdictDecision = AuthorDecisionPolicyService.assessEditorialVerdict(verdict)
      if (verdictDecision.requiresHumanReview) {
        reviewPrompt = AuthorDecisionPolicyService.editorialVerdictAcceptancePrompt(verdict)
      }
    }
    if (report) {
      const decision = AuthorDecisionPolicyService.assessQualityGate(report)
      if (decision.requiresHumanReview) {
        const qualityPrompt = AuthorDecisionPolicyService.draftAcceptancePrompt(report)
        reviewPrompt = reviewPrompt ? { ...reviewPrompt,
          message: `${reviewPrompt.message}\n\n${qualityPrompt.message}`,
          tone: reviewPrompt.tone === 'danger' || qualityPrompt.tone === 'danger' ? 'danger' : 'default'
        } : qualityPrompt
      }
    }

    const targetOrder = selectedJob?.targetChapterOrder ?? targetChapterOrder
    const existing = chapters.find((chapter) => chapter.projectId === project.id && chapter.order === targetOrder)
    const timestamp = now()
    const chapterId = existing?.id ?? newId()

    if (reviewPrompt || existing || mode === 'unreviewed') {
      const confirmed = await confirmAction({
        title: mode === 'unreviewed' ? `未完成审稿，采纳第 ${targetOrder} 章` : `接受第 ${targetOrder} 章`,
        message: [mode === 'unreviewed' ? '当前正文尚未完成审稿。仍然采纳时会记录为“未审稿采纳”，不会标记通过，已有失败项也会保留。之后可继续审稿或修订。' : null,
          reviewPrompt?.message,
          existing ? `将替换第 ${targetOrder} 章的标题和正文；当前版本会保留在版本历史中。` : '将这份草稿写入正式章节。',
          '本次不会自动接受记忆或角色状态候选，这些变化可另行处理。'].filter(Boolean).join('\n\n'),
        confirmLabel: mode === 'unreviewed' ? '确认未审稿采纳' : reviewPrompt?.tone === 'danger' ? '确认保留并采纳' : '接受章节',
        tone: existing ? 'danger' : reviewPrompt?.tone ?? 'default'
      })
      if (!confirmed) return
    }

    try {
      const { applyChapterCommitBundleToAppData, buildAcceptedDraftCommitBundle } = await import(
        '../../../../services/ChapterCommitBundleService'
      )
      const buildCommit = (current: AppData) => {
        const currentScoped = projectData(current, project.id)
        const currentExisting = currentScoped.chapters.find((chapter) => chapter.order === targetOrder)
        const currentDraft = currentScoped.generatedChapterDrafts.find((item) => item.id === draft.id && item.jobId === draft.jobId)
        if (!currentDraft || currentDraft.status !== 'draft' || currentDraft.body !== draft.body ||
          currentDraft.title !== draft.title || currentDraft.updatedAt !== draft.updatedAt) {
          throw new Error('草稿在确认期间已变化，请阅读最新正文后重新采纳。')
        }
        if ((currentExisting?.id ?? null) !== (existing?.id ?? null) || currentExisting?.body !== existing?.body ||
          currentExisting?.title !== existing?.title) {
          throw new Error('目标章节在确认期间已变化，请先核对最新版本。')
        }
        const currentReport = latestQualityReportForDraft(currentScoped.qualityGateReports.filter((item) => item.jobId === currentDraft.jobId), currentDraft)
        const currentVerdict = authoritativeVerdicts
          ? AuthorDecisionPolicyService.latestEditorialVerdictForDraft(current.editorialVerdicts, currentDraft) : null
        if (JSON.stringify(currentReport) !== JSON.stringify(report) ||
          (authoritativeVerdicts && JSON.stringify(currentVerdict) !== JSON.stringify(verdict))) {
          throw new Error('编辑结论在确认期间已更新，请查看最新结论后采纳。')
        }
        const bundle = buildAcceptedDraftCommitBundle({
          appData: current,
          projectId: project.id,
          draftId: draft.id,
          targetChapterOrder: targetOrder,
          commitId: newId(),
          chapterId: currentExisting?.id ?? chapterId,
          acceptedAt: timestamp,
          chapterVersionId: newId(),
          acceptanceMode: mode,
          requireEditorialVerdict: Boolean(authoritativeVerdicts),
          commitNote: mode === 'unreviewed' ? '作者明确选择未完成审稿即采纳，已有诊断仍保留。' : '接受 AI 草稿为正式章节。'
        })
        const next = {
          ...applyChapterCommitBundleToAppData(current, bundle),
          projects: updateProjectTimestamp(current, project.id)
        }
        return { next, bundle }
      }

      if (saveChapterCommitBundle) {
        await saveChapterCommitBundle(buildCommit)
        setPipelineMessage(`第 ${targetOrder} 章已接受并写入版本链。现在可以继续生成第 ${targetOrder + 1} 章。`)
        return
      }

      const saved = await saveData((current) => buildCommit(current).next)
      if (!saved.ok) throw new Error(saved.errorMessage)
      setPipelineMessage(`第 ${targetOrder} 章已接受并写入版本链。现在可以继续生成第 ${targetOrder + 1} 章。`)
    } catch (error) {
      setPipelineMessage(`接受草稿失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function rejectDraft(draft: GeneratedChapterDraft) {
    if (draft.status !== 'draft') return
    const saved = await saveData((current) => ({
      ...current,
      generatedChapterDrafts: current.generatedChapterDrafts.map((item) =>
        item.id === draft.id && item.status === 'draft' ? { ...item, status: 'rejected', updatedAt: now() } : item
      )
    }))
    if (!saved.ok) setPipelineMessage(`拒绝草稿失败：${saved.errorMessage}`)
  }

  return { acceptDraft, acceptDraftUnreviewed: (draft: GeneratedChapterDraft) => acceptDraft(draft, 'unreviewed'), rejectDraft }
}
