import type { ChapterGenerationJob, ChapterGenerationStep, ChapterGenerationStepType } from '../../../../shared/types'
import { StatusBadge } from '../../components/UI'

interface PipelineStepsPanelProps {
  job: ChapterGenerationJob | null
  steps: ChapterGenerationStep[]
  labels: Record<ChapterGenerationStepType, string>
  onRetry: (job: ChapterGenerationJob, stepType: ChapterGenerationStepType) => void
  onSkip: (job: ChapterGenerationJob, step: ChapterGenerationStep) => void
}

export function PipelineStepsPanel({ job, steps, labels, onRetry, onSkip }: PipelineStepsPanelProps) {
  return (
    <div className="panel">
      <h2>步骤输出</h2>
      <div className="pipeline-steps">
        {steps.map((step) => (
          <article key={step.id} className={`pipeline-step ${step.status}`}>
            <div>
              <strong>{labels[step.type]}</strong>
              <StatusBadge tone={step.status === 'failed' ? 'danger' : step.status === 'completed' ? 'success' : step.status === 'running' ? 'accent' : 'neutral'}>{step.status}</StatusBadge>
            </div>
            {step.errorMessage ? <p className="error-text">{step.errorMessage}</p> : null}
            {step.output ? <pre>{step.output.slice(0, 900)}</pre> : null}
            <div className="row-actions">
              <button className="ghost-button" disabled={!job} onClick={() => job && onRetry(job, step.type)}>
                重试
              </button>
              <button className="ghost-button" disabled={!job} onClick={() => job && onSkip(job, step)}>
                跳过
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
