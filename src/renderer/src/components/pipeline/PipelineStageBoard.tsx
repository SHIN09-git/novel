import { createContext, useContext, type ReactNode } from 'react'
import type { ChapterCommitBundle, ChapterGenerationJob, ChapterGenerationStep, ChapterGenerationStepStatus, ChapterGenerationStepType, GeneratedChapterDraft } from '../../../../shared/types'

export interface PipelineStageDefinition {
  id: 'context' | 'draft' | 'review' | 'confirm'
  title: string
  description: string
  stepTypes: ChapterGenerationStepType[]
}

export const PIPELINE_STAGES: PipelineStageDefinition[] = [
  {
    id: 'context',
    title: '准备上下文',
    description: '确定本章需要的事实、角色与规则。',
    stepTypes: ['context_need_planning', 'context_budget_selection', 'build_context']
  },
  {
    id: 'draft',
    title: '生成正文',
    description: '先形成任务书，再用补全后的上下文写正文。',
    stepTypes: [
      'generate_chapter_plan',
      'context_need_planning_from_plan',
      'context_budget_selection_delta',
      'rebuild_context_with_plan',
      'generate_chapter_draft'
    ]
  },
  {
    id: 'review',
    title: '审稿诊断',
    description: '复盘变化，检查连续性与质量风险。',
    stepTypes: [
      'generate_chapter_review',
      'propose_character_updates',
      'propose_foreshadowing_updates',
      'consistency_review',
      'quality_gate'
    ]
  },
  {
    id: 'confirm',
    title: '等待决定',
    description: '审阅结论后，由你决定是否采纳这版正文。',
    stepTypes: ['await_user_confirmation']
  }
]

export type PipelineStageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'ready_for_decision' | 'accepted'

export interface PipelineStageSnapshot {
  definition: PipelineStageDefinition
  status: PipelineStageStatus
  completedCount: number
  totalCount: number
  currentStep: ChapterGenerationStep | null
}

function stepByType(steps: ChapterGenerationStep[], type: ChapterGenerationStepType) {
  return steps.find((step) => step.type === type) ?? null
}

function isSettled(status: ChapterGenerationStepStatus | undefined) {
  return status === 'completed' || status === 'skipped'
}

const PipelineStageDecisionContext = createContext({ hasAcceptedCommit: false })

export function PipelineStageDecisionProvider({
  draft,
  chapterCommitBundles,
  children
}: {
  draft: GeneratedChapterDraft | null
  chapterCommitBundles: ChapterCommitBundle[]
  children: ReactNode
}) {
  const hasAcceptedCommit = Boolean(
    draft && chapterCommitBundles.some((bundle) => bundle.generatedDraftId === draft.id && bundle.jobId === draft.jobId)
  )

  return <PipelineStageDecisionContext.Provider value={{ hasAcceptedCommit }}>{children}</PipelineStageDecisionContext.Provider>
}

function stageStatus(stage: PipelineStageDefinition, stageSteps: Array<ChapterGenerationStep | null>, hasAcceptedCommit: boolean): PipelineStageStatus {
  if (stageSteps.some((step) => step?.status === 'failed')) return 'failed'
  if (stageSteps.some((step) => step?.status === 'running')) return 'running'
  if (stageSteps.length > 0 && stageSteps.every((step) => isSettled(step?.status))) {
    if (stage.id === 'confirm') return hasAcceptedCommit ? 'accepted' : 'ready_for_decision'
    return 'completed'
  }
  return 'pending'
}

export function getPipelineStageSnapshots(steps: ChapterGenerationStep[], hasAcceptedCommit = false): PipelineStageSnapshot[] {
  return PIPELINE_STAGES.map((definition) => {
    const stageSteps = definition.stepTypes.map((type) => stepByType(steps, type))
    const currentStep = stageSteps.find((step) => step?.status === 'running' || step?.status === 'failed') ?? null
    return {
      definition,
      status: stageStatus(definition, stageSteps, hasAcceptedCommit),
      completedCount: stageSteps.filter((step) => isSettled(step?.status)).length,
      totalCount: definition.stepTypes.length,
      currentStep
    }
  })
}

export function getPipelineNextAction(
  job: ChapterGenerationJob | null,
  stages: PipelineStageSnapshot[],
  labels: Record<ChapterGenerationStepType, string>
) {
  const failed = stages.find((stage) => stage.status === 'failed')
  if (failed?.currentStep) return `处理失败步骤：${labels[failed.currentStep.type]}。`

  const running = stages.find((stage) => stage.status === 'running')
  if (running?.currentStep) return `等待${labels[running.currentStep.type]}完成，或在需要时取消本次运行。`

  const accepted = stages.find((stage) => stage.status === 'accepted')
  if (accepted) return '这版正文已经采纳并提交到章节版本。'

  const readyForDecision = stages.find((stage) => stage.status === 'ready_for_decision')
  if (readyForDecision) return '正文与诊断已准备好，等待你的采纳决定。'

  if (job?.status === 'completed') return '审阅正文与诊断结论，再决定是否采纳。'
  if (job?.status === 'paused') return '从当前阶段继续运行。'

  const pending = stages.find((stage) => stage.status === 'pending')
  if (pending) return `下一步：${pending.definition.title}。`
  return job ? '等待确认或开始新的章节任务。' : '配置本章目标后开始生成。'
}

function stageStatusLabel(status: PipelineStageStatus) {
  switch (status) {
    case 'completed':
      return '已完成'
    case 'running':
      return '进行中'
    case 'failed':
      return '需处理'
    case 'ready_for_decision':
      return '等待决定'
    case 'accepted':
      return '已采纳/已提交'
    default:
      return '待开始'
  }
}

export function PipelineStageBoard({
  job,
  steps,
  labels
}: {
  job: ChapterGenerationJob | null
  steps: ChapterGenerationStep[]
  labels: Record<ChapterGenerationStepType, string>
}) {
  const { hasAcceptedCommit } = useContext(PipelineStageDecisionContext)
  const stages = getPipelineStageSnapshots(steps, hasAcceptedCommit)
  const activeStage = stages.find((stage) => stage.status === 'running' || stage.status === 'failed' || stage.status === 'ready_for_decision') ?? stages.find((stage) => stage.status === 'pending')
  const nextAction = getPipelineNextAction(job, stages, labels)

  return (
    <div className="pipeline-stage-board" aria-label="章节生产阶段">
      <div className="pipeline-stage-board-header">
        <div>
          <span className="pipeline-stage-eyebrow">章节生产流程</span>
          <strong>{activeStage ? `当前：${activeStage.definition.title}` : '流程已完成'}</strong>
        </div>
        <p>{nextAction}</p>
      </div>
      <ol className="pipeline-stage-list">
        {stages.map((stage, index) => {
          const isActive = stage.definition.id === activeStage?.definition.id
          return (
            <li key={stage.definition.id} className={`pipeline-stage-item ${stage.status}${isActive ? ' active' : ''}`}>
              <span className="pipeline-stage-index" aria-hidden="true">{index + 1}</span>
              <div className="pipeline-stage-copy">
                <div>
                  <strong>{stage.definition.title}</strong>
                  <span>{stageStatusLabel(stage.status)}</span>
                </div>
                <p>{stage.definition.description}</p>
                <small>{stage.completedCount}/{stage.totalCount} 个步骤完成</small>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
