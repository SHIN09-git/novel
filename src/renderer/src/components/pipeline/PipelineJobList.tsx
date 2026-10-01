import type { ChapterGenerationJob, ChapterGenerationStepType, ID } from '../../../../shared/types'
import { formatDate } from '../../utils/format'

import { pipelineJobStatusLabel } from './pipelineStatusLabels'

export function PipelineJobList({
  jobs,
  selectedJobId,
  labels,
  onSelectJob
}: {
  jobs: ChapterGenerationJob[]
  selectedJobId: ID | null
  labels: Record<ChapterGenerationStepType, string>
  onSelectJob: (jobId: ID) => void
}) {
  return (
    <details className="pipeline-card pipeline-job-list pipeline-tool-details">
      <summary className="pipeline-tool-summary">
        <span>
          <strong>运行历史</strong>
          <small>{jobs.length} 条{selectedJobId ? ' · 已选择任务' : ''}</small>
        </span>
        <span className="pipeline-tool-summary-action">查看</span>
      </summary>
      {jobs.length === 0 ? (
        <p className="muted">暂无流水线任务。</p>
      ) : (
        <div className="pipeline-job-items">
          {jobs.map((job) => (
            <button key={job.id} data-status={job.status} className={job.id === selectedJobId ? 'pipeline-job-item active' : 'pipeline-job-item'} onClick={() => onSelectJob(job.id)}>
              <strong>第 {job.targetChapterOrder} 章</strong>
              <span>{job.currentStep ? labels[job.currentStep] : '未开始'}</span>
              <small>
                {pipelineJobStatusLabel(job.status)} · {formatDate(job.createdAt)}
              </small>
            </button>
          ))}
        </div>
      )}
    </details>
  )
}
