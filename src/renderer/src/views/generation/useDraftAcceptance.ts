import type {
  AppData,
  Chapter,
  ChapterGenerationJob,
  GeneratedChapterDraft,
  ID,
  Project,
  QualityGateReport
} from '../../../../shared/types'
import { createChapterVersionBeforeAcceptDraft } from '../../utils/draftAcceptance'
import { newId, now } from '../../utils/format'
import { projectData } from '../../utils/projectData'
import type { SaveDataInput } from '../../utils/saveDataState'

interface UseDraftAcceptanceArgs {
  project: Project
  saveData: (next: SaveDataInput) => Promise<void>
  selectedJob: ChapterGenerationJob | null
  targetChapterOrder: number
  chapters: Chapter[]
  qualityGateReports: QualityGateReport[]
}

function updateProjectTimestamp(data: AppData, projectId: ID): Project[] {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: now() } : project))
}

export function useDraftAcceptance({
  project,
  saveData,
  selectedJob,
  targetChapterOrder,
  chapters,
  qualityGateReports
}: UseDraftAcceptanceArgs) {
  async function acceptDraft(draft: GeneratedChapterDraft) {
    if (draft.status !== 'draft') return
    const report = qualityGateReports.find((item) => item.draftId === draft.id) ?? null
    if (report && !report.pass) {
      const forced = confirm(`质量门禁未通过（${report.overallScore} 分）。确认仍要进入章节草稿吗？`)
      if (!forced) return
      if (!confirm('再次确认：低分草稿可能导致后续复盘和记忆候选质量下降。是否强制接受？')) return
    }

    const targetOrder = selectedJob?.targetChapterOrder ?? targetChapterOrder
    const existing = chapters.find((chapter) => chapter.order === targetOrder)
    const timestamp = now()
    const chapterId = existing?.id ?? newId()

    if (existing) {
      if (!confirm(`第 ${existing.order} 章已存在，是否覆盖标题和正文？取消则保留草稿不写入章节。`)) return
    }

    await saveData((current) => {
      const currentScoped = projectData(current, project.id)
      const currentExisting = currentScoped.chapters.find((chapter) => chapter.order === targetOrder)
      const currentChapterId = currentExisting?.id ?? chapterId
      const currentChapterVersions = currentExisting
        ? [createChapterVersionBeforeAcceptDraft(currentExisting, project.id, timestamp), ...current.chapterVersions]
        : current.chapterVersions
      const currentChapters = currentExisting
        ? current.chapters.map((chapter) =>
            chapter.id === currentExisting.id
              ? { ...chapter, title: draft.title, body: draft.body, updatedAt: timestamp }
              : chapter
          )
        : [
            ...current.chapters,
            {
              id: currentChapterId,
              projectId: project.id,
              order: targetOrder,
              title: draft.title,
              body: draft.body,
              summary: draft.summary,
              newInformation: '',
              characterChanges: '',
              newForeshadowing: '',
              resolvedForeshadowing: '',
              endingHook: '',
              riskWarnings: '',
              includedInStageSummary: false,
              createdAt: timestamp,
              updatedAt: timestamp
            }
          ]

      return {
        ...current,
        projects: updateProjectTimestamp(current, project.id),
        chapters: currentChapters,
        chapterVersions: currentChapterVersions,
        generatedChapterDrafts: current.generatedChapterDrafts.map((item) =>
          item.id === draft.id ? { ...item, chapterId: currentChapterId, status: 'accepted', updatedAt: timestamp } : item
        ),
        consistencyReviewReports: current.consistencyReviewReports.map((report) =>
          report.jobId === draft.jobId ? { ...report, chapterId: currentChapterId } : report
        ),
        qualityGateReports: current.qualityGateReports.map((report) =>
          report.jobId === draft.jobId ? { ...report, chapterId: currentChapterId, draftId: draft.id } : report
        ),
        redundancyReports: current.redundancyReports.map((report) =>
          report.draftId === draft.id ? { ...report, chapterId: currentChapterId } : report
        )
      }
    })
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
