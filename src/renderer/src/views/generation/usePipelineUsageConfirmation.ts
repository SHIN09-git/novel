import type { AppData, ChapterGenerationJob, ChapterGenerationStepType, Project } from '../../../../shared/types'
import { useConfirm } from '../../components/ConfirmDialog'
import type { PipelineRunOptions } from './pipelineRunnerTypes'

export function usePipelineUsageConfirmation(data: AppData, project: Project, setMessage: (message: string) => void) {
  const confirm = useConfirm()
  return async (job: ChapterGenerationJob, step: ChapterGenerationStepType, options: PipelineRunOptions) => {
    const { confirmPipelineUsage } = await import('./pipelineUsagePreview')
    return confirmPipelineUsage(confirm, setMessage, data, project, job, step, options)
  }
}
