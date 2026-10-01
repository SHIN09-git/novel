import type {
  ChapterGenerationJob,
  ChapterGenerationStep,
  GeneratedChapterDraft,
  QualityGateReport
} from '../../../../shared/types'
import type { PipelineArtifactTab } from '../../components/pipeline/PipelineCurrentArtifactPanel'

interface UsePipelinePrimaryActionArgs {
  selectedJob: ChapterGenerationJob | null
  selectedSteps: ChapterGenerationStep[]
  latestDraft: GeneratedChapterDraft | null
  latestQualityReport: QualityGateReport | null
  isPipelineRunning: boolean
  onStartPipeline: () => void
  onStartNextChapter: () => void
  onRetryStep: (job: ChapterGenerationJob, stepType: ChapterGenerationStep['type']) => void
  onAcceptDraft: (draft: GeneratedChapterDraft) => void
  onActiveArtifactTabChange: (tab: PipelineArtifactTab) => void
}

export function usePipelinePrimaryAction({
  selectedJob,
  selectedSteps,
  latestDraft,
  latestQualityReport,
  isPipelineRunning,
  onStartPipeline,
  onStartNextChapter,
  onRetryStep,
  onAcceptDraft,
  onActiveArtifactTabChange
}: UsePipelinePrimaryActionArgs) {
  function firstFailedStep() {
    return selectedSteps.find((step) => step.status === 'failed') ?? null
  }

  function primaryActionLabel() {
    if (!selectedJob) return '开始生成'
    if (selectedJob.status === 'running' || isPipelineRunning) return '流水线运行中'
    if (latestDraft?.status === 'accepted') return `生成第 ${selectedJob.targetChapterOrder + 1} 章`
    if (selectedJob.status === 'idle' && selectedJob.taskEdit) return '按此任务生成'
    if (selectedJob.status === 'failed' && firstFailedStep()) return '重试失败步骤'
    if (latestQualityReport && latestDraft?.status === 'draft') {
      return latestQualityReport.pass ? '接受章节草稿' : '审核后接受草稿'
    }
    if (latestDraft && !latestQualityReport) return '查看草稿'
    return selectedJob.status === 'completed' ? '查看结果' : '查看步骤'
  }

  function runPrimaryAction() {
    if (!selectedJob) {
      onStartPipeline()
      return
    }
    if (latestDraft?.status === 'accepted') {
      onStartNextChapter()
      return
    }
    if (selectedJob.status === 'idle' && selectedJob.taskEdit) {
      onRetryStep(selectedJob, selectedJob.taskEdit.resumeStep)
      return
    }
    const failed = firstFailedStep()
    if (selectedJob.status === 'failed' && failed) {
      onRetryStep(selectedJob, failed.type)
      return
    }
    if (latestQualityReport && latestDraft?.status === 'draft') {
      onAcceptDraft(latestDraft)
      return
    }
    if (latestDraft) {
      onActiveArtifactTabChange('draft')
      return
    }
    onActiveArtifactTabChange('steps')
  }

  return {
    primaryActionLabel: primaryActionLabel(),
    runPrimaryAction
  }
}
