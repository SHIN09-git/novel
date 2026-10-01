import type {
  ChapterCommitBundle,
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  EditorialVerdict,
  EditorialVerdictIssue,
  GeneratedChapterDraft,
  QualityGateIssue,
  QualityGateReport,
  RevisionCandidate
} from '../../../../shared/types'
import { AuthorDecisionPolicyService } from '../../../../services/AuthorDecisionPolicyService'
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

export interface PipelineDiagnosticsPanelProps {
  editorialVerdict: EditorialVerdict | null
  qualityReport: QualityGateReport | null
  consistencyReports: ConsistencyReviewReport[]
  revisionCandidates: RevisionCandidate[]
  latestDraft: GeneratedChapterDraft | null
  chapterCommitBundles: ChapterCommitBundle[]
  linkedConsistencyIssueTitle: (issueId: string | undefined) => string | null
  onGenerateRevisionCandidate: (issue: QualityGateIssue, report: QualityGateReport, draft: GeneratedChapterDraft) => void
  onAcceptRevisionCandidate: (candidate: RevisionCandidate) => void
  onRejectRevisionCandidate: (candidate: RevisionCandidate) => void
  onStartRevisionFromConsistencyIssue: (report: ConsistencyReviewReport, issue: ConsistencyReviewIssue) => void
  onStartRevisionFromEditorialIssue?: (verdict: EditorialVerdict, issue: EditorialVerdictIssue) => void
  onUpdateConsistencyIssueStatus: (report: ConsistencyReviewReport, issue: ConsistencyReviewIssue, status: ConsistencyReviewIssue['status']) => void
}

export function PipelineDiagnosticsPanel({
  editorialVerdict,
  qualityReport,
  consistencyReports,
  revisionCandidates,
  latestDraft,
  chapterCommitBundles,
  linkedConsistencyIssueTitle,
  onGenerateRevisionCandidate,
  onAcceptRevisionCandidate,
  onRejectRevisionCandidate,
  onStartRevisionFromConsistencyIssue,
  onStartRevisionFromEditorialIssue,
  onUpdateConsistencyIssueStatus
}: PipelineDiagnosticsPanelProps) {
  const visibleQualityIssues = qualityReport?.issues.filter((issue) => issue.severity === 'high' || issue.severity === 'medium') ?? []
  const qualityDecision = AuthorDecisionPolicyService.assessQualityGate(qualityReport)
  const acceptedCommit = latestDraft
    ? chapterCommitBundles.find((bundle) => bundle.generatedDraftId === latestDraft.id && bundle.jobId === latestDraft.jobId) ?? null
    : null

  return (
    <section className="pipeline-card pipeline-diagnostics-summary">
      <div className="pipeline-card-title">
        <h3>编辑结论</h3>
        {acceptedCommit ? (
          <StatusBadge tone="success">已采纳并提交</StatusBadge>
        ) : editorialVerdict ? (
          <StatusBadge tone={editorialVerdict.status === 'blocked' ? 'danger' : editorialVerdict.status === 'approved' ? 'success' : 'warning'}>
            {editorialVerdict.status === 'approved' ? '可以采纳' : editorialVerdict.status === 'advisory' ? '请斟酌' : editorialVerdict.status === 'blocked' ? '需要修订' : '诊断未齐'}
          </StatusBadge>
        ) : (
          <StatusBadge>尚无结论</StatusBadge>
        )}
      </div>

      {acceptedCommit ? (
        <p className="pipeline-editorial-summary">这份正文已经由你采纳并写入章节版本。</p>
      ) : editorialVerdict ? (
        <>
          <p className="pipeline-editorial-summary">{editorialVerdict.summary}</p>
          <div className="pipeline-editorial-section">
            <h4>需要先处理</h4>
            {editorialVerdict.blockers.length ? (
              <ul className="pipeline-editorial-list blockers">
                {editorialVerdict.blockers.map((issue) => (
                  <li key={issue.id}>
                    <strong>{issue.title}</strong>
                    <span>{issue.recommendation}</span>
                    {issue.evidence[0] ? <small>{issue.evidence[0]}</small> : null}
                    {issue.source !== 'diagnostic_binding' && onStartRevisionFromEditorialIssue ? <button className="ghost-button" onClick={() => onStartRevisionFromEditorialIssue(editorialVerdict, issue)}>修这一处</button> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="muted">没有必须先修订的问题。</p>}
          </div>
          <div className="pipeline-editorial-section">
            <h4>可自行取舍</h4>
            {editorialVerdict.advisories.length ? (
              <ul className="pipeline-editorial-list advisories">
                {editorialVerdict.advisories.map((issue) => (
                  <li key={issue.id}>
                    <strong>{issue.title}</strong>
                    <span>{issue.recommendation}</span>
                    {issue.evidence[0] ? <small>{issue.evidence[0]}</small> : null}
                    {issue.source !== 'diagnostic_binding' && onStartRevisionFromEditorialIssue ? <button className="ghost-button" onClick={() => onStartRevisionFromEditorialIssue(editorialVerdict, issue)}>按此建议修订</button> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="muted">没有额外建议项。</p>}
          </div>
          {editorialVerdict.actions.length ? (
            <div className="pipeline-editorial-section">
              <h4>接下来</h4>
              <ol className="pipeline-editorial-actions">
                {editorialVerdict.actions.slice(0, 3).map((action) => (
                  <li key={action.actionType}>
                    <strong>{action.label}</strong>
                    <span>{action.reason}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      ) : (
        <p className="pipeline-editorial-summary muted">当前草稿还没有可用的编辑结论；已生成的诊断报告仍可在下方查看。</p>
      )}

      <details className="pipeline-original-reports">
        <summary>查看原始诊断报告</summary>
        <div className="pipeline-original-reports-body">
          {qualityReport ? (
            <section className="pipeline-report-section">
              <h4>质量报告 · {qualityReport.overallScore} 分</h4>
              <p className="muted">
                {qualityDecision.status === 'passed'
                  ? '质量门禁已通过。'
                  : qualityDecision.status === 'needs_review'
                    ? `需要作者确认：${qualityDecision.reasons.join('；') || '存在关键维度风险'}。`
                    : `建议先修订：${qualityDecision.reasons.join('；') || '报告标记为未通过'}。`}
              </p>
              <div className="metric-grid compact-metrics">
                {Object.entries(qualityReport.dimensions).map(([key, value]) => (
                  <div key={key}>
                    <span>{key}</span>
                    <strong className={value < 70 ? 'over-budget' : ''}>{value}</strong>
                  </div>
                ))}
              </div>
              {visibleQualityIssues.length ? (
                <ul className="pipeline-report-list">
                  {visibleQualityIssues.map((issue, index) => {
                    const linkedTitle = linkedConsistencyIssueTitle(issue.linkedConsistencyIssueId)
                    return (
                      <li key={`${issue.type}-${index}`}>
                        <strong>{issue.type}</strong>
                        <span>{linkedTitle ? `已在一致性审稿中记录：${linkedTitle}` : issue.description}</span>
                        {!linkedTitle ? <small>建议：{issue.suggestedFix}</small> : null}
                        {latestDraft ? <button className="ghost-button" onClick={() => onGenerateRevisionCandidate(issue, qualityReport, latestDraft)}>生成修订候选</button> : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {qualityReport.requiredFixes.length ? <p>必修项：{qualityReport.requiredFixes.join('；')}</p> : null}
              <details>
                <summary>质量报告 JSON</summary>
                <pre>{JSON.stringify(qualityReport, null, 2)}</pre>
              </details>
            </section>
          ) : <p className="muted">尚未生成质量报告。</p>}

          <section className="pipeline-report-section">
            <h4>一致性审稿</h4>
            {consistencyReports.length === 0 ? <p className="muted">尚未生成一致性审稿报告。</p> : null}
            {consistencyReports.map((report) => (
              <details key={report.id}>
                <summary>审稿报告 · {report.severitySummary} · {formatDate(report.createdAt)}</summary>
                {report.legacyIssuesText ? <pre>{report.legacyIssuesText}</pre> : null}
                <ul className="pipeline-report-list">
                  {report.issues.map((issue) => (
                    <li key={issue.id}>
                      <strong><StatusBadge tone={severityTone(issue.severity)}>{issue.severity}</StatusBadge> {CONSISTENCY_TYPE_LABELS[issue.type]}</strong>
                      <span>{issue.title}：{issue.description}</span>
                      <small>建议：{issue.suggestedFix || issue.revisionInstruction || '暂无建议修复方式'}</small>
                      <div className="row-actions">
                        <button className="ghost-button" onClick={() => onStartRevisionFromConsistencyIssue(report, issue)}>生成修订</button>
                        <button className="ghost-button" disabled={issue.status === 'ignored'} onClick={() => onUpdateConsistencyIssueStatus(report, issue, 'ignored')}>忽略</button>
                        <button className="ghost-button" disabled={issue.status === 'resolved'} onClick={() => onUpdateConsistencyIssueStatus(report, issue, 'resolved')}>标记已解决</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <p>{report.suggestions || '暂无建议'}</p>
                <details>
                  <summary>审稿报告 JSON</summary>
                  <pre>{JSON.stringify(report, null, 2)}</pre>
                </details>
              </details>
            ))}
          </section>

          <section className="pipeline-report-section">
            <h4>修订候选</h4>
            {revisionCandidates.length === 0 ? <p className="muted">尚无修订候选。</p> : (
              <ul className="pipeline-report-list">
                {revisionCandidates.map((candidate) => (
                  <li key={candidate.id}>
                    <strong>{candidate.targetIssue}</strong>
                    <span>{candidate.revisionInstruction}</span>
                    <details><summary>查看修订正文</summary><pre>{candidate.revisedText || '暂无修订正文'}</pre></details>
                    <div className="row-actions">
                      <button className="primary-button" disabled={candidate.status !== 'pending'} onClick={() => onAcceptRevisionCandidate(candidate)}>应用到草稿</button>
                      <button className="danger-button" disabled={candidate.status !== 'pending'} onClick={() => onRejectRevisionCandidate(candidate)}>拒绝修订</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </details>
    </section>
  )
}
