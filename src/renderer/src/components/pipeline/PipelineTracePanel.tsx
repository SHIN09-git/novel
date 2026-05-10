import type {
  ChapterContinuityBridge,
  ConsistencyReviewReport,
  GenerationRunTrace,
  PromptContextSnapshot,
  QualityGateReport,
  RedundancyReport,
  RunTraceAuthorSummary
} from '../../../../shared/types'
import { formatDate } from '../../utils/format'
import { buildRunTraceSummary } from '../../views/generation/RunTracePanel'

export function PipelineTracePanel({
  trace,
  snapshot,
  consistencyReport,
  qualityReport,
  continuityBridge,
  redundancyReport,
  authorSummary,
  onCopy,
  onGenerateAuthorSummary
}: {
  trace: GenerationRunTrace | null
  snapshot: PromptContextSnapshot | null
  consistencyReport: ConsistencyReviewReport | null
  qualityReport: QualityGateReport | null
  continuityBridge: ChapterContinuityBridge | null
  redundancyReport: RedundancyReport | null
  authorSummary: RunTraceAuthorSummary | null
  onCopy: (trace: GenerationRunTrace) => void
  onGenerateAuthorSummary?: (trace: GenerationRunTrace) => void
}) {
  if (!trace) {
    return (
      <section className="pipeline-card pipeline-trace-summary">
        <div className="pipeline-card-title">
          <h3>Run Trace</h3>
          <span>等待 build_context</span>
        </div>
        <p className="muted">上下文构建完成后，这里会记录本次实际使用的章节、角色、伏笔、压缩和强制上下文。</p>
      </section>
    )
  }

  const issueCount = (consistencyReport?.issues.length ?? 0) + (qualityReport?.issues.length ?? 0)

  return (
    <section className="pipeline-card pipeline-trace-summary">
      <div className="pipeline-card-title">
        <h3>Run Trace</h3>
        <button className="ghost-button" onClick={() => onCopy(trace)}>
          复制摘要
        </button>
      </div>
      <div className="pipeline-mini-metrics">
        <span>{trace.contextSource === 'prompt_snapshot' ? 'Prompt 快照' : '自动上下文'}</span>
        <span>章节 {trace.selectedChapterIds.length}</span>
        <span>角色 {trace.selectedCharacterIds.length}</span>
        <span>伏笔 {trace.selectedForeshadowingIds.length}</span>
        <span>省略 {trace.omittedContextItems.length}</span>
      </div>
      <p className="muted">
        预算 {trace.contextTokenEstimate} / 最终 {trace.finalPromptTokenEstimate} token
        {snapshot ? ` · 快照 ${formatDate(snapshot.createdAt)}` : ''}
      </p>
      <p className="muted">
        质量问题 {issueCount} · 修订 {trace.revisionSessionIds.length} · 接受记忆 {trace.acceptedMemoryCandidateIds.length} · 拒绝记忆 {trace.rejectedMemoryCandidateIds.length}
      </p>
      {authorSummary ? (
        <div className={`author-summary-card status-${authorSummary.overallStatus}`}>
          <div className="pipeline-card-title">
            <h4>作者诊断摘要</h4>
            <span>{authorSummary.overallStatus}</span>
          </div>
          <p>{authorSummary.oneLineDiagnosis}</p>
          {authorSummary.likelyProblemSources.length ? (
            <ul className="advice-list">
              {authorSummary.likelyProblemSources.slice(0, 4).map((source) => (
                <li key={source.source}>
                  {source.source} · {source.severity}：{source.recommendation}
                </li>
              ))}
            </ul>
          ) : null}
          {authorSummary.nextActions.length ? (
            <p className="muted">建议动作：{authorSummary.nextActions.slice(0, 3).map((action) => action.label).join(' / ')}</p>
          ) : null}
        </div>
      ) : (
        <button className="secondary-button" onClick={() => onGenerateAuthorSummary?.(trace)}>
          生成诊断摘要
        </button>
      )}
      {trace.compressionRecords.length ? (
        <details>
          <summary>上下文压缩 {trace.compressionRecords.length} 条</summary>
          <ul className="advice-list">
            {trace.compressionRecords.slice(0, 8).map((record) => (
              <li key={record.id}>
                第 {record.originalChapterOrder} 章 → {record.replacementKind}，节省约 {record.savedTokenEstimate} token
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {trace.forcedContextBlocks.length ? (
        <details>
          <summary>强制上下文 {trace.forcedContextBlocks.length} 条</summary>
          <ul className="advice-list">
            {trace.forcedContextBlocks.map((block) => (
              <li key={`${block.kind}-${block.sourceId ?? block.title}`}>{block.kind} · {block.title}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <details>
        <summary>高级 / 调试信息：查看追踪 JSON 摘要</summary>
        <pre>{JSON.stringify(buildRunTraceSummary(trace, consistencyReport, qualityReport), null, 2).slice(0, 2200)}</pre>
      </details>
      {continuityBridge ? <p className="muted">章节衔接：{continuityBridge.immediateNextBeat || continuityBridge.mustContinueFrom}</p> : null}
      {redundancyReport ? <p className="muted">冗余检查：{redundancyReport.overallRedundancyScore} 分</p> : null}
    </section>
  )
}
