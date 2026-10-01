interface ReaderHeaderActionsProps {
  showSummaries: boolean
  onToggleSummaries: () => void
  onDecreaseFont: () => void
  onIncreaseFont: () => void
  onCopyAll: () => void
  onBackToChapters: () => void
}

export function ReaderHeaderActions({
  showSummaries,
  onToggleSummaries,
  onDecreaseFont,
  onIncreaseFont,
  onCopyAll,
  onBackToChapters
}: ReaderHeaderActionsProps) {
  return (
    <div className="reader-toolbar" aria-label="阅读工具栏">
      <div className="reader-toolbar-group" aria-label="阅读设置">
        <span className="reader-toolbar-label">字号</span>
        <button className="ghost-button" type="button" title="减小字号" aria-label="减小字号" onClick={onDecreaseFont}>A-</button>
        <button className="ghost-button" type="button" title="增大字号" aria-label="增大字号" onClick={onIncreaseFont}>A+</button>
        <button className="ghost-button reader-summary-toggle" type="button" aria-pressed={showSummaries} onClick={onToggleSummaries}>
          {showSummaries ? '隐藏摘要' : '显示摘要'}
        </button>
      </div>
      <div className="reader-toolbar-group reader-toolbar-primary">
        <button className="ghost-button" type="button" onClick={onCopyAll}>复制全书</button>
        <button className="primary-button" type="button" onClick={onBackToChapters}>回到章节编辑</button>
      </div>
    </div>
  )
}
