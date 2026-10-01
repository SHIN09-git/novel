import type { Chapter, ChapterContinuityBridge, ContinuitySource } from '../../../../shared/types'
import { endingExcerpt } from '../../../../services/ContinuityService'
import { TextArea, Toggle } from '../../components/FormFields'

interface PromptContinuityPanelProps {
  previousChapter: Chapter | null
  continuity: {
    bridge: ChapterContinuityBridge | null
    source: ContinuitySource | null
  }
  useContinuityBridge: boolean
  continuityInstructions: string
  onUseContinuityBridgeChange: (checked: boolean) => void
  onContinuityInstructionsChange: (value: string) => void
}

export function PromptContinuityPanel({
  previousChapter,
  continuity,
  useContinuityBridge,
  continuityInstructions,
  onUseContinuityBridgeChange,
  onContinuityInstructionsChange
}: PromptContinuityPanelProps) {
  return (
    <section className="panel">
      <div className="panel-title-row">
        <h2>章节衔接</h2>
        <Toggle label="使用衔接桥" checked={useContinuityBridge} onChange={onUseContinuityBridgeChange} />
      </div>
      <p className="muted">
        上一章：{previousChapter ? `第 ${previousChapter.order} 章 ${previousChapter.title || '未命名'}` : '暂无上一章'} · 来源：
        {continuity.source === 'saved_bridge' ? '已保存衔接桥' : continuity.source === 'auto_from_previous_ending' ? '上一章结尾片段兜底' : '暂无'}
      </p>
      {previousChapter ? (
        <div className="context-item">
          <strong>上一章结尾片段</strong>
          <p className="muted">{endingExcerpt(previousChapter, 500) || '暂无正文片段'}</p>
        </div>
      ) : null}
      {continuity.bridge ? (
        <div className="stack-list">
          <p><strong>下一章开头必须接住：</strong>{continuity.bridge.immediateNextBeat || continuity.bridge.mustContinueFrom || '未填写'}</p>
          <p><strong>禁止重置：</strong>{continuity.bridge.mustNotReset || '不要重新介绍已有环境、机关和设定。'}</p>
          <p><strong>开放小张力：</strong>{continuity.bridge.openMicroTensions || '未填写'}</p>
        </div>
      ) : null}
      <TextArea
        label="本章衔接补充指令"
        value={continuityInstructions}
        rows={4}
        onChange={onContinuityInstructionsChange}
      />
    </section>
  )
}
