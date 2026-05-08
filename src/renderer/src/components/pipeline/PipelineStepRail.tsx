import type { ChapterGenerationJob, ChapterGenerationStep, ChapterGenerationStepType } from '../../../../shared/types'
import { StatusBadge, Stepper } from '../UI'

function currentStepDescription(job: ChapterGenerationJob | null, steps: ChapterGenerationStep[], labels: Record<ChapterGenerationStepType, string>) {
  if (!job) return '尚未创建流水线任务。'
  const failed = steps.find((step) => step.status === 'failed')
  if (failed) return `${labels[failed.type]} 失败，请查看错误摘要并重试。`
  const running = steps.find((step) => step.status === 'running')
  if (running) return `${labels[running.type]} 正在执行，AI 请求可能需要一些时间。`
  if (job.currentStep) return `当前停留在 ${labels[job.currentStep]}。`
  return '等待开始。'
}

export function PipelineStepRail({
  job,
  steps,
  labels,
  onRetry,
  onSkip
}: {
  job: ChapterGenerationJob | null
  steps: ChapterGenerationStep[]
  labels: Record<ChapterGenerationStepType, string>
  onRetry: (job: ChapterGenerationJob, stepType: ChapterGenerationStepType) => void
  onSkip: (job: ChapterGenerationJob, step: ChapterGenerationStep) => void
}) {
  const failedStep = steps.find((step) => step.status === 'failed')

  return (
    <section className="pipeline-card pipeline-step-rail">
      <div className="pipeline-card-title">
        <h3>流程状态</h3>
        {job ? <StatusBadge tone={job.status === 'failed' ? 'danger' : job.status === 'completed' ? 'success' : job.status === 'running' ? 'accent' : 'neutral'}>{job.status}</StatusBadge> : null}
      </div>
      <p className={failedStep ? 'error-text' : 'muted'}>{currentStepDescription(job, steps, labels)}</p>
      <Stepper steps={steps.map((step) => ({ id: step.id, type: step.type, status: step.status }))} labels={labels} />
      {failedStep && job ? (
        <div className="pipeline-error-box">
          <strong>{labels[failedStep.type]} 失败</strong>
          <p>{failedStep.errorMessage || '没有返回错误详情。'}</p>
          <div className="row-actions">
            <button className="primary-button" onClick={() => onRetry(job, failedStep.type)}>
              重试失败步骤
            </button>
            <button className="ghost-button" onClick={() => onSkip(job, failedStep)}>
              跳过此步骤
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
