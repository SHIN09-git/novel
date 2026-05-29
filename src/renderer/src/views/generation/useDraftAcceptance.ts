import type {
  AppData,
  ChapterCommitBundle,
  Chapter,
  ChapterGenerationJob,
  GeneratedChapterDraft,
  ID,
  Project,
  QualityGateReport
} from '../../../../shared/types'
import {
  applyChapterCommitBundleToAppData,
  buildAcceptedDraftCommitBundle
} from '../../../../services/ChapterCommitBundleService'
import { AuthorDecisionPolicyService } from '../../../../services/AuthorDecisionPolicyService'
import type { ConfirmFn } from '../../components/ConfirmDialog'
import { newId, now } from '../../utils/format'
import { projectData } from '../../utils/projectData'
import type { SaveDataInput } from '../../utils/saveDataState'

interface UseDraftAcceptanceArgs {
  project: Project
  saveData: (next: SaveDataInput) => Promise<void>
  saveChapterCommitBundle?: (buildCommit: (currentData: AppData) => { next: AppData; bundle: ChapterCommitBundle }) => Promise<void>
  selectedJob: ChapterGenerationJob | null
  targetChapterOrder: number
  chapters: Chapter[]
  qualityGateReports: QualityGateReport[]
  confirmAction: ConfirmFn
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
  confirmAction
}: UseDraftAcceptanceArgs) {
  async function acceptDraft(draft: GeneratedChapterDraft) {
    if (draft.status !== 'draft') return
    const report = qualityGateReports.find((item) => item.draftId === draft.id) ?? null
    const decision = AuthorDecisionPolicyService.assessQualityGate(report)
    if (report && decision.requiresHumanReview) {
      const forced = await confirmAction(AuthorDecisionPolicyService.draftAcceptancePrompt(report))
      if (!forced) return
      if (decision.requiresSecondConfirmation) {
        const doubleConfirmed = await confirmAction(AuthorDecisionPolicyService.forcedDraftAcceptancePrompt())
        if (!doubleConfirmed) return
      }
    }

    const targetOrder = selectedJob?.targetChapterOrder ?? targetChapterOrder
    const existing = chapters.find((chapter) => chapter.order === targetOrder)
    const timestamp = now()
    const chapterId = existing?.id ?? newId()

    if (existing) {
      const overwrite = await confirmAction({
        title: '覆盖已有章节',
        message: `第 ${existing.order} 章已存在，是否覆盖标题和正文？取消则保留草稿不写入章节。`,
        confirmLabel: '覆盖章节',
        tone: 'danger'
      })
      if (!overwrite) return
    }

    const buildCommit = (current: AppData) => {
      const currentScoped = projectData(current, project.id)
      const currentExisting = currentScoped.chapters.find((chapter) => chapter.order === targetOrder)
      const bundle = buildAcceptedDraftCommitBundle({
        appData: current,
        projectId: project.id,
        draftId: draft.id,
        targetChapterOrder: targetOrder,
        commitId: newId(),
        chapterId: currentExisting?.id ?? chapterId,
        acceptedAt: timestamp,
        chapterVersionId: currentExisting ? newId() : null,
        commitNote: '接受 AI 草稿为正式章节。'
      })
      const next = {
        ...applyChapterCommitBundleToAppData(current, bundle),
        projects: updateProjectTimestamp(current, project.id)
      }
      return { next, bundle }
    }

    if (saveChapterCommitBundle) {
      await saveChapterCommitBundle(buildCommit)
      return
    }

    await saveData((current) => buildCommit(current).next)
  }

  async function rejectDraft(draft: GeneratedChapterDraft) {
    if (draft.status !== 'draft') return
    await saveData((current) => ({
      ...current,
      generatedChapterDrafts: current.generatedChapterDrafts.map((item) =>
        item.id === draft.id ? { ...item, status: 'rejected', updatedAt: now() } : item
      )
    }))
  }

  return { acceptDraft, rejectDraft }
}
