import type {
  AppData,
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  ContextBudgetMode,
  EditorialVerdict,
  EditorialVerdictIssue,
  GeneratedChapterDraft,
  ID,
  Project,
  PromptContextSnapshot,
  QualityGateIssue,
  QualityGateReport,
  RevisionCandidate
} from '../../../../shared/types'
import type { projectData } from '../../utils/projectData'
import type { SaveDataHandler } from '../../utils/saveDataState'
import type { PipelineRevisionActionContext } from './pipelineRevisionActionHandlers'

type ProjectDataSnapshot = ReturnType<typeof projectData>

interface UsePipelineRevisionActionsArgs {
  data: AppData
  project: Project
  scoped: ProjectDataSnapshot
  selectedJob: AppData['chapterGenerationJobs'][number] | null
  selectedSteps: AppData['chapterGenerationSteps'][number][]
  selectedTraceSnapshot: PromptContextSnapshot | null
  latestDraft: GeneratedChapterDraft | null
  targetChapterOrder: number
  readerEmotionTarget: string
  estimatedWordCount: string
  budgetMode: ContextBudgetMode
  budgetMaxTokens: number
  saveData: SaveDataHandler
  setPipelineMessage: (message: string) => void
  onOpenRevision?: (prefill: { chapterId: ID | null; draftId: ID | null; requestId: ID }) => void
}

export function usePipelineRevisionActions(args: UsePipelineRevisionActionsArgs) {
  const context = args as PipelineRevisionActionContext
  const loadActions = () => import('./pipelineRevisionActionHandlers')

  return {
    async startRevisionFromEditorialIssue(verdict: EditorialVerdict, issue: EditorialVerdictIssue) {
      return (await import('./editorialRevisionActions')).startRevisionFromEditorialIssue(context, verdict, issue)
    },
    async updateConsistencyIssueStatus(
      report: ConsistencyReviewReport,
      issue: ConsistencyReviewIssue,
      status: ConsistencyReviewIssue['status']
    ) {
      return (await loadActions()).updateConsistencyIssueStatus(context, report, issue, status)
    },
    async startRevisionFromConsistencyIssue(report: ConsistencyReviewReport, issue: ConsistencyReviewIssue) {
      return (await loadActions()).startRevisionFromConsistencyIssue(context, report, issue)
    },
    async startDraftRevision(draft: GeneratedChapterDraft) {
      return (await loadActions()).startDraftRevision(context, draft)
    },
    async generateRevisionCandidate(issue: QualityGateIssue, report: QualityGateReport, draft: GeneratedChapterDraft) {
      return (await loadActions()).generateRevisionCandidate(context, issue, report, draft)
    },
    async acceptRevisionCandidate(candidate: RevisionCandidate) {
      return (await loadActions()).acceptRevisionCandidate(context, candidate)
    },
    async rejectRevisionCandidate(candidate: RevisionCandidate) {
      return (await loadActions()).rejectRevisionCandidate(context, candidate)
    }
  }
}
