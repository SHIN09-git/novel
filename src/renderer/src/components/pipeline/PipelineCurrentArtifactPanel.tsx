import type { ChapterGenerationJob, ChapterGenerationStep, ChapterGenerationStepType, GeneratedChapterDraft } from '../../../../shared/types'
import { StatusBadge } from '../UI'
import { PipelineDraftPanel } from './PipelineDraftPanel'

export type PipelineArtifactTab = 'plan' | 'draft' | 'steps'

function latestPlanOutput(steps: ChapterGenerationStep[]) {
  return steps.find((step) => step.type === 'generate_chapter_plan' && step.output.trim())?.output ?? ''
}

export function PipelineCurrentArtifactPanel({
  activeTab,
  onActiveTabChange,
  job,
  draft,
  steps,
  labels,
  onAcceptDraft,
  onRejectDraft,
  onRetryDraft,
  onCopyDraft,
  onOpenDraftRevision,
  onRetryStep,
  onSkipStep
}: {
  activeTab: PipelineArtifactTab
  onActiveTabChange: (tab: PipelineArtifactTab) => void
  job: ChapterGenerationJob | null
  draft: GeneratedChapterDraft | null
  steps: ChapterGenerationStep[]
  labels: Record<ChapterGenerationStepType, string>
  onAcceptDraft: (draft: GeneratedChapterDraft) => void
  onRejectDraft: (draft: GeneratedChapterDraft) => void
  onRetryDraft: (job: ChapterGenerationJob) => void
  onCopyDraft: (draft: GeneratedChapterDraft) => void
  onOpenDraftRevision?: (draft: GeneratedChapterDraft) => void
  onRetryStep: (job: ChapterGenerationJob, stepType: ChapterGenerationStepType) => void
  onSkipStep: (job: ChapterGenerationJob, step: ChapterGenerationStep) => void
}) {
  const planOutput = latestPlanOutput(steps)
  const failedStep = steps.find((step) => step.status === 'failed')

  return (
    <section className="pipeline-card pipeline-current-artifact">
      <div className="pipeline-card-title">
        <h3>当前主要产物</h3>
        {failedStep ? <StatusBadge tone="danger">{labels[failedStep.type]} 失败</StatusBadge> : null}
      </div>
      <div className="pipeline-artifact-tabs">
        <button className={activeTab === 'plan' ? 'active' : ''} onClick={() => onActiveTabChange('plan')}>
          任务书
        </button>
        <button className={activeTab === 'draft' ? 'active' : ''} onClick={() => onActiveTabChange('draft')}>
          草稿
        </button>
        <button className={activeTab === 'steps' ? 'active' : ''} onClick={() => onActiveTabChange('steps')}>
          步骤输出
        </button>
      </div>

      {activeTab === 'draft' ? (
        <PipelineDraftPanel
          draft={draft}
          job={job}
          onAccept={onAcceptDraft}
          onReject={onRejectDraft}
          onRetryDraft={onRetryDraft}
          onCopyDraft={onCopyDraft}
          onOpenRevision={onOpenDraftRevision}
        />
      ) : null}

      {activeTab === 'plan' ? (
        <div className="pipeline-artifact-body">
          {planOutput ? <pre>{planOutput}</pre> : <p className="muted">章节任务书会在“生成任务书”步骤完成后显示。</p>}
        </div>
      ) : null}

      {activeTab === 'steps' ? (
        <div className="pipeline-step-output-list">
          {steps.length === 0 ? <p className="muted">还没有步骤输出。</p> : null}
          {steps.map((step) => (
            <details key={step.id} className={`pipeline-step-output ${step.status}`} open={step.status === 'failed' || step.status === 'running'}>
              <summary>
                <strong>{labels[step.type]}</strong>
                <StatusBadge tone={step.status === 'failed' ? 'danger' : step.status === 'completed' ? 'success' : step.status === 'running' ? 'accent' : 'neutral'}>{step.status}</StatusBadge>
              </summary>
              {step.errorMessage ? <p className="error-text">{step.errorMessage}</p> : null}
              {step.output ? <pre>{step.output.slice(0, 1200)}</pre> : <p className="muted">暂无输出。</p>}
              <div className="row-actions">
                <button className="ghost-button" disabled={!job} onClick={() => job && onRetryStep(job, step.type)}>
                  重试
                </button>
                <button className="ghost-button" disabled={!job} onClick={() => job && onSkipStep(job, step)}>
                  跳过
                </button>
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </section>
  )
}
