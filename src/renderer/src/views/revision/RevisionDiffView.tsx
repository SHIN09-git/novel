import { useMemo } from 'react'
import { createTextDiff, type TextDiffSegment } from '../../utils/textDiff'

interface RevisionDiffViewProps {
  originalText: string
  revisedText: string
}

function segmentText(segment: TextDiffSegment): string {
  return segment.text ?? segment.revisedText ?? segment.originalText ?? ''
}

export function RevisionDiffView({ originalText, revisedText }: RevisionDiffViewProps) {
  const diff = useMemo(() => createTextDiff(originalText, revisedText), [originalText, revisedText])
  const percent = Math.round(diff.stats.changeRatio * 100)

  return (
    <div className="revision-diff">
      <div className="revision-diff-stats">
        <span>新增 {diff.stats.insertedChars}</span>
        <span>删除 {diff.stats.deletedChars}</span>
        <span>替换 {diff.stats.replacedChars}</span>
        <span>改动 {percent}%</span>
      </div>
      <div className="revision-diff-body">
        {diff.segments.length === 0 ? (
          <p className="muted">暂无可对比文本。</p>
        ) : (
          diff.segments.map((segment, index) => {
            if (segment.type === 'replace') {
              return (
                <article key={`${segment.type}-${index}`} className="revision-diff-segment revision-diff-replace">
                  <div>
                    <strong>原文</strong>
                    <pre>{segment.originalText}</pre>
                  </div>
                  <div>
                    <strong>修订后</strong>
                    <pre>{segment.revisedText}</pre>
                  </div>
                </article>
              )
            }
            return (
              <article key={`${segment.type}-${index}`} className={`revision-diff-segment revision-diff-${segment.type}`}>
                {segment.type === 'insert' ? <strong>新增</strong> : null}
                {segment.type === 'delete' ? <strong>删除</strong> : null}
                <pre>{segmentText(segment)}</pre>
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}
