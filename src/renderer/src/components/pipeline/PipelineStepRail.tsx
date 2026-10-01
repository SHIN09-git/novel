import type { ChapterGenerationJob, ChapterGenerationStep, ChapterGenerationStepType } from '../../../../shared/types'
import { getPipelineRoleForStep } from '../../../../services/PipelineRunContextService'
import { AiCallProgress } from '../AiCallProgress'
import { StatusBadge, Stepper } from '../UI'
import { PipelineStageBoard } from './PipelineStageBoard'
import { pipelineJobStatusLabel } from './pipelineStatusLabels'

function currentStepDescription(job: ChapterGenerationJob | null, steps: ChapterGenerationStep[], labels: Record<ChapterGenerationStepType, string>) {
  if (!job) return '尚未创建流水线任务。'
  const failed = steps.find((step) => step.status === 'failed')
  if (failed) return `${labels[failed.type]} 失败，请查看错误摘要并重试。`
  const running = steps.find((step) => step.status === 'running')
  if (running) {
    return getPipelineRoleForStep(running.type)
      ? `${labels[running.type]} 正在请求模型，可能需要一些时间。`
      : `${labels[running.type]} 正在整理本章资料（本地处理）。`
  }
  if (job.currentStep) return `当前停留在 ${labels[job.currentStep]}。`
  return '等待开始。'
}

export function PipelineStepRail({
  job,
  steps,
  labels,
  isRunning,
  canSkipFailedStep,
  onRetry,
  onSkip,
  onCancel
}: {
  job: ChapterGenerationJob | null
  steps: ChapterGenerationStep[]
  labels: Record<ChapterGenerationStepType, string>
  isRunning: boolean
  canSkipFailedStep: boolean
  onRetry: (job: ChapterGenerationJob, stepType: ChapterGenerationStepType) => void
  onSkip: (job: ChapterGenerationJob, step: ChapterGenerationStep) => void
  onCancel: (job: ChapterGenerationJob) => void
}) {
  const failedStep = steps.find((step) => step.status === 'failed')
  const runningStep = steps.find((step) => step.status === 'running')
  const isAiStep = Boolean(runningStep && getPipelineRoleForStep(runningStep.type))

  return (
    <section className="pipeline-card pipeline-step-rail">
      <div className="pipeline-card-title">
        <h3>流程状态</h3>
        {job ? <StatusBadge tone={job.status === 'failed' ? 'danger' : job.status === 'completed' ? 'success' : job.status === 'running' ? 'accent' : 'neutral'}>{pipelineJobStatusLabel(job.status)}</StatusBadge> : null}
      </div>
      <p className={failedStep ? 'error-text' : 'muted'}>{currentStepDescription(job, steps, labels)}</p>
      <PipelineStageBoard job={job} steps={steps} labels={labels} />
      {runningStep ? (
        <div className="pipeline-running-meta">
          {isAiStep ? (
            <AiCallProgress isRunning={isRunning} runId={job?.id} startedAt={runningStep.updatedAt} />
          ) : (
            <span>正在整理本章资料（本地处理）</span>
          )}
          {job && isRunning ? (
            <button className="ghost-button" type="button" onClick={() => onCancel(job)}>
              取消当前运行
            </button>
          ) : null}
        </div>
      ) : null}
      <details className="pipeline-raw-steps">
        <summary>
          <span>高级步骤明细</span>
          <small>查看全部 {steps.length} 个原始步骤</small>
        </summary>
        <div className="pipeline-raw-steps-body">
          <Stepper steps={steps.map((step) => ({ id: step.id, type: step.type, status: step.status }))} labels={labels} />
        </div>
      </details>
      {failedStep && job ? (
        <div className="pipeline-error-box">
          <strong>{labels[failedStep.type]} 失败</strong>
          <p>{failedStep.errorMessage || '没有返回错误详情。'}</p>
          <div className="row-actions">
            <button className="primary-button" disabled={isRunning} onClick={() => onRetry(job, failedStep.type)}>
              重试失败步骤
            </button>
            {canSkipFailedStep ? (
              <button className="ghost-button" disabled={isRunning} onClick={() => onSkip(job, failedStep)}>
                跳过此可选步骤
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
