import type { ChapterGenerationJob, GeneratedChapterDraft, MemoryUpdateCandidate, PromptContextSnapshot, QualityGateReport, ConsistencyReviewReport } from '../../../../shared/types'

export function PipelineRiskBanner({
  job,
  draft,
  qualityReport,
  consistencyReports,
  memoryCandidates,
  snapshot,
  targetChapterOrder,
  pipelineMessage
}: {
  job: ChapterGenerationJob | null
  draft: GeneratedChapterDraft | null
  qualityReport: QualityGateReport | null
  consistencyReports: ConsistencyReviewReport[]
  memoryCandidates: MemoryUpdateCandidate[]
  snapshot: PromptContextSnapshot | null
  targetChapterOrder: number
  pipelineMessage: string
}) {
  const risks: string[] = []
  const highConsistencyCount = consistencyReports.reduce((count, report) => count + report.issues.filter((issue) => issue.severity === 'high' && issue.status !== 'resolved').length, 0)
  const pendingCandidates = memoryCandidates.filter((candidate) => candidate.status === 'pending').length

  if (job?.status === 'failed') risks.push(job.errorMessage || '流水线失败，请查看失败步骤。')
  if (qualityReport && !qualityReport.pass) risks.push(`质量门禁未通过：总分 ${qualityReport.overallScore}。建议先修订。`)
  if (highConsistencyCount > 0) risks.push(`存在 ${highConsistencyCount} 个 high severity 一致性问题。`)
  if (snapshot && snapshot.targetChapterOrder !== targetChapterOrder) risks.push('Prompt 快照目标章节与当前目标章节不一致。')
  if (pendingCandidates > 0) risks.push(`${pendingCandidates} 条长期记忆候选等待确认，未确认不会写入。`)
  if (draft && draft.status === 'rejected') risks.push('当前草稿已被拒绝。')
  if (pipelineMessage) risks.push(pipelineMessage)

  if (risks.length === 0) {
    return (
      <div className="pipeline-risk-banner calm">
        <strong>当前没有阻断性风险</strong>
        <p>继续关注质量门禁、审稿和记忆候选即可。</p>
      </div>
    )
  }

  return (
    <div className="pipeline-risk-banner">
      <strong>需要关注</strong>
      <ul>
        {risks.slice(0, 5).map((risk) => (
          <li key={risk}>{risk}</li>
        ))}
      </ul>
    </div>
  )
}
