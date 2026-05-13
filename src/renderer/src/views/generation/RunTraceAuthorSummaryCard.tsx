import type { GenerationRunTrace, RunTraceAuthorSummary } from '../../../../shared/types'

interface RunTraceAuthorSummaryCardProps {
  trace: GenerationRunTrace
  authorSummary?: RunTraceAuthorSummary | null
  onGenerateAuthorSummary?: (trace: GenerationRunTrace) => void
}

export function RunTraceAuthorSummaryCard({ trace, authorSummary, onGenerateAuthorSummary }: RunTraceAuthorSummaryCardProps) {
  return (
    <section className={`author-summary-card status-${authorSummary?.overallStatus ?? 'unknown'}`}>
      <div className="panel-title-row">
        <h3>章节生成诊断摘要</h3>
        {!authorSummary ? (
          <button className="secondary-button" onClick={() => onGenerateAuthorSummary?.(trace)}>
            生成诊断摘要
          </button>
        ) : null}
      </div>
      {authorSummary ? (
        <>
          <p>{authorSummary.oneLineDiagnosis}</p>
          {authorSummary.likelyProblemSources.length ? (
            <div className="budget-columns">
              {authorSummary.likelyProblemSources.slice(0, 4).map((source) => (
                <article key={source.source} className="candidate-card">
                  <h3>
                    {source.source} · {source.severity}
                  </h3>
                  <p>{source.recommendation}</p>
                  <ul className="advice-list">
                    {source.evidence.slice(0, 3).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          ) : null}
          {authorSummary.nextActions.length ? (
            <ul className="advice-list">
              {authorSummary.nextActions.slice(0, 5).map((action) => (
                <li key={`${action.actionType}-${action.label}`}>
                  {action.label}：{action.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="muted">作者摘要会把质量门禁、审稿、上下文遗漏、新设定风险和冗余检测整理成可行动建议；原始 JSON 仍保留在高级信息里。</p>
      )}
    </section>
  )
}
