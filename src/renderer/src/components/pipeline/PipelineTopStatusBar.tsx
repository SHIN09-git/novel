import type { ChapterGenerationJob, GeneratedChapterDraft, PipelineContextSource, PromptContextSnapshot, QualityGateReport } from '../../../../shared/types'
import { AuthorDecisionPolicyService } from '../../../../services/AuthorDecisionPolicyService'
import { StatusBadge } from '../UI'
import { pipelineJobStatusLabel } from './pipelineStatusLabels'

function jobStatusTone(status: ChapterGenerationJob['status'] | 'empty') {
  if (status === 'failed') return 'danger' as const
  if (status === 'completed') return 'success' as const
  if (status === 'running') return 'accent' as const
  return 'neutral' as const
}

function qualityStatus(report: QualityGateReport | null) {
  const decision = AuthorDecisionPolicyService.assessQualityGate(report)
  return { label: decision.label, tone: decision.tone }
}

function draftStatusLabel(status: GeneratedChapterDraft['status'] | 'empty') {
  return { empty: '尚无正文', draft: '等待确认', accepted: '已采纳', rejected: '已退回' }[status]
}

export function PipelineTopStatusBar({
  targetChapterOrder,
  job,
  contextSource,
  snapshot,
  qualityReport,
  draft,
  isRunning,
  primaryActionLabel,
  primaryActionDisabled,
  onPrimaryAction
}: {
  targetChapterOrder: number
  job: ChapterGenerationJob | null
  contextSource: PipelineContextSource
  snapshot: PromptContextSnapshot | null
  qualityReport: QualityGateReport | null
  draft: GeneratedChapterDraft | null
  isRunning: boolean
  primaryActionLabel: string
  primaryActionDisabled?: boolean
  onPrimaryAction: () => void
}) {
  const quality = qualityStatus(qualityReport)
  const jobStatus = job?.status ?? 'empty'
  const draftStatus = draft?.status ?? 'empty'
  const sourceLabel = contextSource === 'prompt_snapshot' ? 'Prompt 快照' : '自动构建'

  return (
    <div className="pipeline-top-status-inner">
      <div className="pipeline-top-status-main">
        <span className="chapter-kicker">AI 章节生成控制台</span>
        <h2>第 {targetChapterOrder} 章</h2>
      </div>
      <div className="pipeline-status-cluster">
        <div data-status={jobStatus}>
          <span>生成进度</span>
          <StatusBadge tone={jobStatusTone(jobStatus)}>{pipelineJobStatusLabel(jobStatus)}</StatusBadge>
        </div>
        <div>
          <span>上下文来源</span>
          <strong>{sourceLabel}</strong>
          {snapshot ? <small>第 {snapshot.targetChapterOrder} 章 · {snapshot.estimatedTokens} token</small> : null}
        </div>
        <div>
          <span>质量门禁</span>
          <StatusBadge tone={quality.tone}>{quality.label}</StatusBadge>
        </div>
        <div data-status={draftStatus}>
          <span>正文状态</span>
          <strong>{draftStatusLabel(draftStatus)}</strong>
        </div>
      </div>
      <button className="primary-button" type="button" disabled={isRunning || primaryActionDisabled} onClick={onPrimaryAction}>
        {isRunning ? '流水线正在运行' : primaryActionLabel}
      </button>
    </div>
  )
}
