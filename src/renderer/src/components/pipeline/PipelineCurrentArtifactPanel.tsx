import type { ReactNode } from 'react'
import type { ChapterAcceptanceReview, ChapterGenerationJob, ChapterGenerationStep, ChapterGenerationStepType, GeneratedChapterDraft } from '../../../../shared/types'
import { readChapterStepFragment } from '../../../../shared/chapterStepFragment'
import { StatusBadge } from '../UI'
import { PipelineDraftPanel } from './PipelineDraftPanel'

export type PipelineArtifactTab = 'plan' | 'draft' | 'steps'

function latestPlanOutput(steps: ChapterGenerationStep[]) {
  return steps.find((step) => step.type === 'generate_chapter_plan' && step.output.trim())?.output ?? ''
}

function StepOutput({ step }: { step: ChapterGenerationStep }) {
  const fragment = readChapterStepFragment(step)
  if (!fragment) return step.output ? <pre>{step.output.slice(0, 1200)}</pre> : <p className="muted">暂无输出。</p>
  return (
    <>
      <p className="notice">保留的不完整片段，仅供查看，不能采纳。{fragment.finishReason ? `结束原因：${fragment.finishReason}` : ''}</p>
      {fragment.title ? <strong>{fragment.title}</strong> : null}
      <pre>{fragment.body}</pre>
    </>
  )
}

export function PipelineCurrentArtifactPanel({
  activeTab,
  taskEditor,
  onActiveTabChange,
  job,
  isRunning,
  draft,
  previousDraft,
  lengthOverflowNotice,
  hardCanonBlock,
  steps,
  labels,
  onAcceptDraft,
  onAcceptUnreviewedDraft,
  acceptanceReview,
  onRejectDraft,
  onRetryDraft,
  onCopyDraft,
  onOpenDraftRevision,
  onRetryStep,
  onSkipStep,
  canSkipStep
}: {
  activeTab: PipelineArtifactTab
  taskEditor?: ReactNode
  onActiveTabChange: (tab: PipelineArtifactTab) => void
  job: ChapterGenerationJob | null
  isRunning: boolean
  draft: GeneratedChapterDraft | null
  previousDraft?: GeneratedChapterDraft
  lengthOverflowNotice?: string | null
  hardCanonBlock?: string | null
  steps: ChapterGenerationStep[]
  labels: Record<ChapterGenerationStepType, string>
  onAcceptDraft: (draft: GeneratedChapterDraft) => void
  onAcceptUnreviewedDraft?: (draft: GeneratedChapterDraft) => void
  acceptanceReview?: ChapterAcceptanceReview
  onRejectDraft: (draft: GeneratedChapterDraft) => void
  onRetryDraft: (job: ChapterGenerationJob) => void
  onCopyDraft: (draft: GeneratedChapterDraft) => void
  onOpenDraftRevision?: (draft: GeneratedChapterDraft) => void
  onRetryStep: (job: ChapterGenerationJob, stepType: ChapterGenerationStepType) => void
  onSkipStep: (job: ChapterGenerationJob, step: ChapterGenerationStep) => void
  canSkipStep: (type: ChapterGenerationStepType) => boolean
}) {
  const planOutput = latestPlanOutput(steps)
  const failedStep = steps.find((step) => step.status === 'failed')
  const effectiveTab: PipelineArtifactTab = !job || (activeTab === 'draft' && !draft) ? 'plan' : activeTab
  const artifactTitle = effectiveTab === 'draft' ? '当前草稿' : effectiveTab === 'steps' ? '步骤输出' : '本章任务'

  return (
    <section className="pipeline-card pipeline-current-artifact">
      <div className="pipeline-card-title">
        <h3>{job ? `第 ${job.targetChapterOrder} 章 · ${artifactTitle}` : artifactTitle}</h3>
        {failedStep ? (
          <button className="pipeline-failed-step-link" type="button" onClick={() => onActiveTabChange('steps')}>
            <StatusBadge tone="danger">{labels[failedStep.type]} 失败 · 查看重试</StatusBadge>
          </button>
        ) : null}
      </div>
      <div className="pipeline-artifact-tabs">
        <button className={effectiveTab === 'plan' ? 'active' : ''} onClick={() => onActiveTabChange('plan')}>
          任务书
        </button>
        <button className={effectiveTab === 'draft' ? 'active' : ''} disabled={!draft} onClick={() => onActiveTabChange('draft')}>
          草稿
        </button>
        <button className={effectiveTab === 'steps' ? 'active' : ''} disabled={!job} onClick={() => onActiveTabChange('steps')}>
          步骤输出
        </button>
      </div>

      {effectiveTab === 'draft' ? (
        <PipelineDraftPanel
          draft={draft}
          job={job}
          lengthOverflowNotice={lengthOverflowNotice}
          hardCanonBlock={hardCanonBlock}
          isRunning={isRunning}
          onAccept={onAcceptDraft}
          onAcceptUnreviewed={onAcceptUnreviewedDraft}
          acceptanceReview={acceptanceReview}
          onReject={onRejectDraft}
          onRetryDraft={onRetryDraft}
          onCopyDraft={onCopyDraft}
          onOpenRevision={onOpenDraftRevision}
        />
      ) : null}

        <div className="pipeline-artifact-body" hidden={effectiveTab !== 'plan'}>
          {taskEditor}
          {planOutput ? <details><summary>原始任务书</summary><pre>{planOutput}</pre></details> : !taskEditor ? <p className="muted">章节任务书会在“生成任务书”步骤完成后显示。</p> : null}
        </div>

      {effectiveTab === 'steps' ? (
        <div className="pipeline-step-output-list">
          {steps.length === 0 ? <p className="muted">还没有步骤输出。</p> : null}
          {previousDraft ? <details><summary>此前的完整草稿：{previousDraft.title}</summary><pre>{previousDraft.body}</pre></details> : null}
          {steps.map((step) => (
            <details key={step.id} className={`pipeline-step-output ${step.status}`} open={step.status === 'failed' || step.status === 'running'}>
              <summary>
                <strong>{labels[step.type]}</strong>
                <StatusBadge tone={step.status === 'failed' ? 'danger' : step.status === 'completed' ? 'success' : step.status === 'running' ? 'accent' : 'neutral'}>{step.status}</StatusBadge>
              </summary>
              {step.errorMessage ? <p className="error-text">{step.errorMessage}</p> : null}
              <StepOutput step={step} />
              <div className="row-actions">
                <button className="ghost-button" disabled={!job || isRunning || step.status === 'running'} onClick={() => job && onRetryStep(job, step.type)}>
                  重试
                </button>
                <button className="ghost-button" disabled={!job || isRunning || step.status !== 'failed' || !canSkipStep(step.type)} onClick={() => job && onSkipStep(job, step)}>
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
