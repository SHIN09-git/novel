import type { ChapterGenerationJob, GeneratedChapterDraft, PipelineContextSource, PromptContextSnapshot, QualityGateReport } from '../../../../shared/types'
import { StatusBadge } from '../UI'

function jobStatusTone(status: ChapterGenerationJob['status'] | 'empty') {
  if (status === 'failed') return 'danger' as const
  if (status === 'completed') return 'success' as const
  if (status === 'running') return 'accent' as const
  return 'neutral' as const
}

function qualityStatus(report: QualityGateReport | null) {
  if (!report) return { label: '未生成', tone: 'neutral' as const }
  return report.pass ? { label: '通过', tone: 'success' as const } : { label: '未通过', tone: 'danger' as const }
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
  const sourceLabel = contextSource === 'prompt_snapshot' ? 'Prompt 快照' : '自动构建'

  return (
    <div className="pipeline-top-status-inner">
      <div className="pipeline-top-status-main">
        <span className="chapter-kicker">AI 章节生成控制台</span>
        <h2>第 {targetChapterOrder} 章</h2>
      </div>
      <div className="pipeline-status-cluster">
        <div>
          <span>Job 状态</span>
          <StatusBadge tone={jobStatusTone(jobStatus)}>{job ? job.status : '未开始'}</StatusBadge>
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
        <div>
          <span>草稿</span>
          <strong>{draft ? draft.status : '未生成'}</strong>
        </div>
      </div>
      <button className="primary-button" type="button" disabled={isRunning || primaryActionDisabled} onClick={onPrimaryAction}>
        {isRunning ? '流水线正在运行' : primaryActionLabel}
      </button>
    </div>
  )
}
