import type { Chapter, ChapterContinuityBridge, ChapterContinuityBridgeSuggestion } from '../../../../shared/types'
import { TextArea } from '../../components/FormFields'
import type { ReviewTextField } from './chapterViewTypes'

interface ChapterReviewPanelProps {
  selected: Chapter
  selectedBridge: ChapterContinuityBridge | null
  reviewFields: Array<{ key: ReviewTextField; label: string }>
  onUpdateChapter: (patch: Partial<Chapter>) => void
  onUpdateContinuityBridgeField: (field: keyof ChapterContinuityBridgeSuggestion, value: string) => void
}

export function ChapterReviewPanel({
  selected,
  selectedBridge,
  reviewFields,
  onUpdateChapter,
  onUpdateContinuityBridgeField
}: ChapterReviewPanelProps) {
  return (
    <div className="panel chapter-review-panel">
      <h2>本章复盘</h2>
      <div className="form-grid">
        {reviewFields.map((field) => (
          <TextArea
            key={field.key}
            label={field.label}
            value={String(selected[field.key] ?? '')}
            onChange={(value) => onUpdateChapter({ [field.key]: value } as Partial<Chapter>)}
          />
        ))}
      </div>
      <div className="panel continuity-mini-panel">
        <h3>下一章衔接状态</h3>
        <p className="muted">
          保存后，Prompt 构建器和生产流水线生成第 {selected.order + 1} 章时会优先使用这组状态。
        </p>
        <div className="form-grid">
          <TextArea
            label="结尾位置"
            value={selectedBridge?.lastSceneLocation ?? ''}
            onChange={(value) => onUpdateContinuityBridgeField('lastSceneLocation', value)}
          />
          <TextArea
            label="身体状态"
            value={selectedBridge?.lastPhysicalState ?? ''}
            onChange={(value) => onUpdateContinuityBridgeField('lastPhysicalState', value)}
          />
          <TextArea
            label="情绪状态"
            value={selectedBridge?.lastEmotionalState ?? ''}
            onChange={(value) => onUpdateContinuityBridgeField('lastEmotionalState', value)}
          />
          <TextArea
            label="未完成动作"
            value={selectedBridge?.lastUnresolvedAction ?? ''}
            onChange={(value) => onUpdateContinuityBridgeField('lastUnresolvedAction', value)}
          />
          <TextArea
            label="下一章必须接住"
            value={selectedBridge?.immediateNextBeat ?? ''}
            onChange={(value) => onUpdateContinuityBridgeField('immediateNextBeat', value)}
          />
          <TextArea
            label="禁止重置"
            value={selectedBridge?.mustNotReset ?? ''}
            onChange={(value) => onUpdateContinuityBridgeField('mustNotReset', value)}
          />
          <TextArea
            label="开放小张力"
            value={selectedBridge?.openMicroTensions ?? ''}
            onChange={(value) => onUpdateContinuityBridgeField('openMicroTensions', value)}
          />
        </div>
      </div>
    </div>
  )
}
