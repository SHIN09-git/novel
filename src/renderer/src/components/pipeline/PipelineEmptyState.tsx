export function PipelineEmptyState() {
  return (
    <div className="pipeline-card pipeline-empty-state">
      <span className="chapter-kicker">Generation Pipeline</span>
      <h2>选择目标章节和上下文来源，开始生成下一章。</h2>
      <p className="muted">流水线会保留每一步输出；章节草稿和长期记忆更新仍然需要你确认后才会写入。</p>
    </div>
  )
}
