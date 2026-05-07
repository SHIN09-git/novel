import type {
  ChapterContinuityBridge,
  ConsistencyReviewReport,
  GenerationRunTrace,
  ID,
  PromptContextSnapshot,
  QualityGateReport,
  RedundancyReport
} from '../../../../shared/types'
import { treatmentPromptRules } from '../../../../shared/foreshadowingTreatment'
import { formatDate, treatmentModeLabel, weightLabel } from '../../utils/format'
import { projectData } from '../../utils/projectData'

type ProjectDataSnapshot = ReturnType<typeof projectData>

interface RunTracePanelProps {
  trace: GenerationRunTrace | null
  snapshot: PromptContextSnapshot | null
  scoped: ProjectDataSnapshot
  consistencyReport: ConsistencyReviewReport | null
  qualityReport: QualityGateReport | null
  continuityBridge: ChapterContinuityBridge | null
  redundancyReport: RedundancyReport | null
  onCopy: (trace: GenerationRunTrace) => void
}

function contextItemLabel(projectDataSnapshot: ProjectDataSnapshot, type: string, id: ID | null): string {
  if (!id) return type
  if (type.includes('chapter')) {
    const chapter = projectDataSnapshot.chapters.find((item) => item.id === id)
    if (chapter) return `第 ${chapter.order} 章 ${chapter.title || '未命名'}`
  }
  if (type.includes('stage')) {
    const summary = projectDataSnapshot.stageSummaries.find((item) => item.id === id)
    if (summary) return `阶段摘要 ${summary.chapterStart}-${summary.chapterEnd}`
  }
  if (type.includes('character')) {
    return projectDataSnapshot.characters.find((item) => item.id === id)?.name ?? id
  }
  if (type.includes('foreshadowing')) {
    return projectDataSnapshot.foreshadowings.find((item) => item.id === id)?.title ?? id
  }
  return id
}

export function buildRunTraceSummary(
  trace: GenerationRunTrace,
  consistencyReport: ConsistencyReviewReport | null,
  qualityReport: QualityGateReport | null
) {
  return {
    id: trace.id,
    jobId: trace.jobId,
    targetChapterOrder: trace.targetChapterOrder,
    contextSource: trace.contextSource,
    promptContextSnapshotId: trace.promptContextSnapshotId,
    selectedCounts: {
      chapters: trace.selectedChapterIds.length,
      stageSummaries: trace.selectedStageSummaryIds.length,
      characters: trace.selectedCharacterIds.length,
      foreshadowings: trace.selectedForeshadowingIds.length
    },
    foreshadowingTreatmentModes: trace.foreshadowingTreatmentModes,
    foreshadowingTreatmentOverrides: trace.foreshadowingTreatmentOverrides,
    omittedContextItems: trace.omittedContextItems,
    contextWarnings: trace.contextWarnings,
    contextTokenEstimate: trace.contextTokenEstimate,
    forcedContextBlocks: trace.forcedContextBlocks,
    compressionRecords: trace.compressionRecords,
    finalPromptTokenEstimate: trace.finalPromptTokenEstimate,
    generatedDraftId: trace.generatedDraftId,
    continuityBridgeId: trace.continuityBridgeId,
    continuitySource: trace.continuitySource,
    continuityWarnings: trace.continuityWarnings,
    redundancyReportId: trace.redundancyReportId,
    consistencyReviewReportId: trace.consistencyReviewReportId,
    qualityGateReportId: trace.qualityGateReportId,
    issueCounts: {
      consistencyHigh: consistencyReport?.issues.filter((issue) => issue.severity === 'high').length ?? 0,
      consistencyMedium: consistencyReport?.issues.filter((issue) => issue.severity === 'medium').length ?? 0,
      consistencyLow: consistencyReport?.issues.filter((issue) => issue.severity === 'low').length ?? 0,
      qualityHigh: qualityReport?.issues.filter((issue) => issue.severity === 'high').length ?? 0,
      qualityMedium: qualityReport?.issues.filter((issue) => issue.severity === 'medium').length ?? 0,
      qualityLow: qualityReport?.issues.filter((issue) => issue.severity === 'low').length ?? 0
    },
    revisionSessionIds: trace.revisionSessionIds,
    acceptedRevisionVersionId: trace.acceptedRevisionVersionId,
    acceptedMemoryCandidateIds: trace.acceptedMemoryCandidateIds,
    rejectedMemoryCandidateIds: trace.rejectedMemoryCandidateIds,
    createdAt: trace.createdAt,
    updatedAt: trace.updatedAt
  }
}

function continuitySourceLabel(trace: GenerationRunTrace): string {
  if (trace.continuitySource === 'saved_bridge') return '已保存 Bridge'
  if (trace.continuitySource === 'auto_from_previous_ending') return '上一章结尾兜底'
  if (trace.continuitySource === 'manual') return '手动指令'
  return '未记录'
}

function compressionReplacementLabel(kind: GenerationRunTrace['compressionRecords'][number]['replacementKind']): string {
  if (kind === 'stage_summary') return '阶段摘要'
  if (kind === 'chapter_one_line_summary') return '一句话摘要'
  if (kind === 'summary_excerpt') return '摘要摘录'
  return '裁掉'
}

export function RunTracePanel({
  trace,
  snapshot,
  scoped,
  consistencyReport,
  qualityReport,
  continuityBridge,
  redundancyReport,
  onCopy
}: RunTracePanelProps) {
  return (
    <div className="panel run-trace-panel">
      <div className="panel-title-row">
        <h2>生成追踪</h2>
        {trace ? (
          <button className="ghost-button" onClick={() => onCopy(trace)}>
            复制追踪摘要
          </button>
        ) : null}
      </div>
      {!trace ? (
        <p className="muted">build_context 完成后会生成追踪记录，用于核对本次实际使用的上下文。</p>
      ) : (
        <>
          <div className="metric-grid">
            <article>
              <span>上下文来源</span>
              <strong>{trace.contextSource === 'prompt_snapshot' ? 'Prompt 快照' : '自动构建'}</strong>
              <p>{snapshot ? `${formatDate(snapshot.createdAt)} · ${snapshot.id}` : trace.promptContextSnapshotId || '未绑定快照'}</p>
            </article>
            <article>
              <span>纳入章节</span>
              <strong>{trace.selectedChapterIds.length}</strong>
              <p>阶段摘要 {trace.selectedStageSummaryIds.length}</p>
            </article>
            <article>
              <span>角色 / 伏笔</span>
              <strong>
                {trace.selectedCharacterIds.length} / {trace.selectedForeshadowingIds.length}
              </strong>
              <p>预算 {trace.contextTokenEstimate} / 最终 {trace.finalPromptTokenEstimate} token</p>
            </article>
            <article>
              <span>质量链路</span>
              <strong>{qualityReport ? (qualityReport.pass ? '通过' : '需审查') : '未完成'}</strong>
              <p>审稿 {consistencyReport ? '已完成' : '未完成'}</p>
            </article>
            <article>
              <span>章节衔接</span>
              <strong>{continuitySourceLabel(trace)}</strong>
              <p>{continuityBridge?.immediateNextBeat || trace.continuityBridgeId || '暂无衔接依据'}</p>
            </article>
            <article>
              <span>冗余检查</span>
              <strong>{redundancyReport ? `${redundancyReport.overallRedundancyScore} 分` : '未完成'}</strong>
              <p>{redundancyReport ? `${redundancyReport.compressionSuggestions.length} 条压缩建议` : trace.redundancyReportId || '暂无报告'}</p>
            </article>
          </div>
          <div className="budget-columns">
            <div>
              <h3>上下文压缩</h3>
              <ul className="advice-list">
                {trace.compressionRecords.length === 0 ? (
                  <li>本次没有触发章节回顾压缩。</li>
                ) : (
                  trace.compressionRecords.slice(0, 8).map((record) => (
                    <li key={record.id}>
                      第 {record.originalChapterOrder} 章{record.originalTitle ? `《${record.originalTitle}》` : ''}详细回顾 →{' '}
                      {compressionReplacementLabel(record.replacementKind)}，节省约 {record.savedTokenEstimate} token。{record.reason}
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div>
              <h3>伏笔 treatmentMode</h3>
              <div className="candidate-list compact">
                {trace.selectedForeshadowingIds.length === 0 ? (
                  <p className="muted">本次没有纳入伏笔。</p>
                ) : (
                  trace.selectedForeshadowingIds.map((id) => {
                    const item = scoped.foreshadowings.find((foreshadowing) => foreshadowing.id === id)
                    const mode = trace.foreshadowingTreatmentModes[id] ?? item?.treatmentMode ?? 'hint'
                    const override = trace.foreshadowingTreatmentOverrides[id]
                    return (
                      <article key={id} className="candidate-card">
                        <h3>{item?.title || id}</h3>
                        <p>
                          权重：{item ? weightLabel(item.weight) : '-'} · 全局：{item ? treatmentModeLabel(item.treatmentMode) : '-'} · 本次：
                          {treatmentModeLabel(mode)}
                          {override ? ` · override：${treatmentModeLabel(override)}` : ''}
                        </p>
                        <p className="muted">{treatmentPromptRules(mode).join('；')}</p>
                      </article>
                    )
                  })
                )}
              </div>
            </div>
            <div>
              <h3>省略上下文与警告</h3>
              <ul className="advice-list">
                {trace.forcedContextBlocks.length ? (
                  <li>强制上下文：{trace.forcedContextBlocks.map((block) => `${block.title}(${block.kind}, ${block.tokenEstimate} token)`).join('；')}</li>
                ) : null}
                {trace.compressionRecords.length ? (
                  <li>上下文压缩：{trace.compressionRecords.length} 条旧章节回顾已被短内容替换或裁掉。</li>
                ) : null}
                {trace.omittedContextItems.slice(0, 8).map((item, index) => (
                  <li key={`${item.type}-${item.id ?? index}`}>
                    {contextItemLabel(scoped, item.type, item.id)}：{item.reason}
                  </li>
                ))}
                {trace.contextWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
                {!trace.omittedContextItems.length && !trace.contextWarnings.length ? <li>暂无省略项或上下文风险。</li> : null}
              </ul>
            </div>
          </div>
          <div className="budget-columns">
            <div>
              <h3>质量链路</h3>
              <ul className="advice-list">
                <li>
                  一致性审稿：
                  {consistencyReport
                    ? `已完成 · ${consistencyReport.issues.filter((issue) => issue.severity === 'high').length} high / ${consistencyReport.issues.filter((issue) => issue.severity === 'medium').length} medium / ${consistencyReport.issues.filter((issue) => issue.severity === 'low').length} low`
                    : '未完成'}
                </li>
                <li>质量门禁：{qualityReport ? `${qualityReport.pass ? '通过' : '未通过'} · ${qualityReport.overallScore} 分` : '未完成'}</li>
                <li>转入修订：{consistencyReport?.issues.filter((issue) => issue.status === 'converted_to_revision').length ?? 0} 个 issue</li>
                <li>已接受修订版本：{trace.acceptedRevisionVersionId || '无'}</li>
              </ul>
            </div>
            <div>
              <h3>记忆更新</h3>
              <ul className="advice-list">
                <li>已接受候选：{trace.acceptedMemoryCandidateIds.length}</li>
                <li>已拒绝候选：{trace.rejectedMemoryCandidateIds.length}</li>
              </ul>
            </div>
          </div>
          <details className="snapshot-detail">
            <summary>查看追踪 JSON 摘要</summary>
            <pre>{JSON.stringify(buildRunTraceSummary(trace, consistencyReport, qualityReport), null, 2)}</pre>
          </details>
        </>
      )}
    </div>
  )
}
