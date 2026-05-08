import type {
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  GeneratedChapterDraft,
  QualityGateIssue,
  QualityGateReport,
  RevisionCandidate
} from '../../../../shared/types'
import { StatusBadge } from '../UI'
import { formatDate } from '../../utils/format'

const CONSISTENCY_TYPE_LABELS: Record<ConsistencyReviewIssue['type'], string> = {
  timeline_conflict: '时间线冲突',
  worldbuilding_conflict: '设定冲突',
  character_knowledge_leak: '角色知识越界',
  character_motivation_gap: '动机断裂',
  character_ooc: '角色 OOC',
  foreshadowing_misuse: '伏笔误用',
  foreshadowing_leak: '伏笔提前泄露',
  geography_or_physics_conflict: '空间/物理冲突',
  previous_chapter_contradiction: '前文矛盾',
  continuity_gap: '连续性缺口',
  other: '其他'
}

function severityTone(severity: string) {
  if (severity === 'high') return 'danger' as const
  if (severity === 'medium') return 'warning' as const
  return 'neutral' as const
}

export function PipelineDiagnosticsPanel({
  qualityReport,
  consistencyReports,
  revisionCandidates,
  latestDraft,
  linkedConsistencyIssueTitle,
  onGenerateRevisionCandidate,
  onAcceptRevisionCandidate,
  onRejectRevisionCandidate,
  onStartRevisionFromConsistencyIssue,
  onUpdateConsistencyIssueStatus
}: {
  qualityReport: QualityGateReport | null
  consistencyReports: ConsistencyReviewReport[]
  revisionCandidates: RevisionCandidate[]
  latestDraft: GeneratedChapterDraft | null
  linkedConsistencyIssueTitle: (issueId: string | undefined) => string | null
  onGenerateRevisionCandidate: (issue: QualityGateIssue, report: QualityGateReport, draft: GeneratedChapterDraft) => void
  onAcceptRevisionCandidate: (candidate: RevisionCandidate) => void
  onRejectRevisionCandidate: (candidate: RevisionCandidate) => void
  onStartRevisionFromConsistencyIssue: (report: ConsistencyReviewReport, issue: ConsistencyReviewIssue) => void
  onUpdateConsistencyIssueStatus: (report: ConsistencyReviewReport, issue: ConsistencyReviewIssue, status: ConsistencyReviewIssue['status']) => void
}) {
  const highConsistencyIssues = consistencyReports.flatMap((report) => report.issues.filter((issue) => issue.severity === 'high').map((issue) => ({ report, issue })))
  const visibleQualityIssues = qualityReport?.issues.filter((issue) => issue.severity === 'high' || issue.severity === 'medium') ?? []

  return (
    <section className="pipeline-card pipeline-diagnostics-summary">
      <div className="pipeline-card-title">
        <h3>诊断与门禁</h3>
        {qualityReport ? (
          <StatusBadge tone={qualityReport.pass ? 'success' : 'danger'}>{qualityReport.pass ? '质量通过' : '需修订'}</StatusBadge>
        ) : (
          <StatusBadge>未生成</StatusBadge>
        )}
      </div>

      {qualityReport ? (
        <div className="pipeline-quality-summary">
          <strong>质量门禁总分 {qualityReport.overallScore}</strong>
          <p className="muted">
            {qualityReport.pass ? '建议可进入人工确认。' : '建议先进入修订，低质量草稿接受仍会二次确认。'}
          </p>
          <details>
            <summary>维度分数</summary>
            <div className="metric-grid compact-metrics">
              {Object.entries(qualityReport.dimensions).map(([key, value]) => (
                <article key={key}>
                  <span>{key}</span>
                  <strong className={value < 70 ? 'over-budget' : ''}>{value}</strong>
                </article>
              ))}
            </div>
          </details>
          {visibleQualityIssues.length ? (
            <div className="candidate-list compact-list">
              {visibleQualityIssues.map((issue, index) => {
                const linkedTitle = linkedConsistencyIssueTitle(issue.linkedConsistencyIssueId)
                return (
                  <article key={`${issue.type}-${index}`} className={`candidate-card ${issue.severity}`}>
                    <h3>{issue.severity} · {issue.type}</h3>
                    {linkedTitle ? (
                      <p>该问题已在一致性审稿中记录：{linkedTitle}</p>
                    ) : (
                      <>
                        <p>{issue.description}</p>
                        <p className="muted">证据：{issue.evidence || '暂无'}</p>
                        <p>{issue.suggestedFix}</p>
                      </>
                    )}
                    {latestDraft ? (
                      <button className="ghost-button" onClick={() => onGenerateRevisionCandidate(issue, qualityReport, latestDraft)}>
                        生成修订候选
                      </button>
                    ) : null}
                  </article>
                )
              })}
            </div>
          ) : (
            <p className="muted">暂无 high / medium 质量问题。</p>
          )}
          {qualityReport.requiredFixes.length ? (
            <details>
              <summary>必修项 {qualityReport.requiredFixes.length} 条</summary>
              <ul className="advice-list">
                {qualityReport.requiredFixes.map((fix) => (
                  <li key={fix}>{fix}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : (
        <p className="muted">质量门禁会在一致性审稿后执行。</p>
      )}

      <div className="pipeline-consistency-summary">
        <h4>一致性审稿</h4>
        {consistencyReports.length === 0 ? <p className="muted">审稿报告会在第 7 步完成后显示。</p> : null}
        {highConsistencyIssues.length ? (
          <div className="candidate-list compact-list">
            {highConsistencyIssues.map(({ report, issue }) => (
              <article key={issue.id} className="candidate-card high">
                <h3>
                  high · {CONSISTENCY_TYPE_LABELS[issue.type]} · {issue.status}
                </h3>
                <strong>{issue.title}</strong>
                <p>{issue.description}</p>
                <p className="muted">证据：{issue.evidence || '暂无'}</p>
                <div className="row-actions">
                  <button className="primary-button" onClick={() => onStartRevisionFromConsistencyIssue(report, issue)}>
                    进入修订
                  </button>
                  <button className="ghost-button" disabled={issue.status === 'ignored'} onClick={() => onUpdateConsistencyIssueStatus(report, issue, 'ignored')}>
                    忽略
                  </button>
                  <button className="ghost-button" disabled={issue.status === 'resolved'} onClick={() => onUpdateConsistencyIssueStatus(report, issue, 'resolved')}>
                    标记已解决
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : consistencyReports.length ? (
          <p className="muted">没有 high severity 一致性问题。</p>
        ) : null}
        {consistencyReports.map((report) => (
          <details key={report.id}>
            <summary>
              完整审稿 · {report.severitySummary} · {formatDate(report.createdAt)}
            </summary>
            {report.legacyIssuesText ? <pre>{report.legacyIssuesText}</pre> : null}
            {report.issues.length === 0 ? (
              <p className="muted">没有结构化一致性问题。</p>
            ) : (
              <div className="candidate-list compact-list">
                {report.issues.map((issue) => (
                  <article key={issue.id} className={`candidate-card ${issue.severity}`}>
                    <h3>
                      <StatusBadge tone={severityTone(issue.severity)}>{issue.severity}</StatusBadge> {CONSISTENCY_TYPE_LABELS[issue.type]} · {issue.status}
                    </h3>
                    <strong>{issue.title}</strong>
                    <p>{issue.description}</p>
                    <p className="muted">证据：{issue.evidence || '暂无'}</p>
                    <p>{issue.suggestedFix || issue.revisionInstruction || '暂无建议修复方式'}</p>
                    <div className="row-actions">
                      <button className="ghost-button" onClick={() => onStartRevisionFromConsistencyIssue(report, issue)}>
                        生成修订
                      </button>
                      <button className="ghost-button" disabled={issue.status === 'ignored'} onClick={() => onUpdateConsistencyIssueStatus(report, issue, 'ignored')}>
                        忽略
                      </button>
                      <button className="ghost-button" disabled={issue.status === 'resolved'} onClick={() => onUpdateConsistencyIssueStatus(report, issue, 'resolved')}>
                        标记已解决
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p>{report.suggestions || '暂无建议'}</p>
          </details>
        ))}
      </div>

      <div className="pipeline-revision-candidates">
        <h4>修订候选</h4>
        {revisionCandidates.length === 0 ? (
          <p className="muted">可从质量门禁问题中生成局部修订候选。</p>
        ) : (
          <div className="candidate-list compact-list">
            {revisionCandidates.map((candidate) => (
              <article key={candidate.id} className="candidate-card">
                <h3>{candidate.status} · {candidate.targetIssue}</h3>
                <p>{candidate.revisionInstruction}</p>
                <details>
                  <summary>查看修订正文</summary>
                  <pre>{candidate.revisedText || '暂无修订正文'}</pre>
                </details>
                <div className="row-actions">
                  <button className="primary-button" disabled={candidate.status !== 'pending'} onClick={() => onAcceptRevisionCandidate(candidate)}>
                    应用到草稿
                  </button>
                  <button className="danger-button" disabled={candidate.status !== 'pending'} onClick={() => onRejectRevisionCandidate(candidate)}>
                    拒绝修订
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
