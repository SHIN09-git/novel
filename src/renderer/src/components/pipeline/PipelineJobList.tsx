import type { ChapterGenerationJob, ChapterGenerationStepType, ID } from '../../../../shared/types'
import { formatDate } from '../../utils/format'

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
    <section className="pipeline-card pipeline-job-list">
      <div className="pipeline-card-title">
        <h3>Job 历史</h3>
        <span>{jobs.length} 条</span>
      </div>
      {jobs.length === 0 ? (
        <p className="muted">暂无流水线任务。</p>
      ) : (
        <div className="pipeline-job-items">
          {jobs.map((job) => (
            <button key={job.id} className={job.id === selectedJobId ? 'pipeline-job-item active' : 'pipeline-job-item'} onClick={() => onSelectJob(job.id)}>
              <strong>第 {job.targetChapterOrder} 章</strong>
              <span>{job.currentStep ? labels[job.currentStep] : '未开始'}</span>
              <small>
                {job.status} · {formatDate(job.createdAt)}
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
