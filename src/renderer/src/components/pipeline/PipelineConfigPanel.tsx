import type { ContextBudgetMode, ID, PipelineContextSource, PipelineMode, PromptContextSnapshot } from '../../../../shared/types'
import { NumberInput, SelectField, TextInput } from '../FormFields'
import { PipelineContextSnapshotPanel } from './PipelineContextSnapshotPanel'
import { PipelineActionBar } from './PipelineActionBar'
import { formatDate } from '../../utils/format'

export function PipelineConfigPanel({
  targetChapterOrder,
  nextChapter,
  pipelineMode,
  estimatedWordCount,
  readerEmotionTarget,
  readerEmotionPresets,
  newReaderEmotionPreset,
  budgetMode,
  budgetMaxTokens,
  defaultTokenBudget,
  contextSource,
  snapshots,
  selectedSnapshot,
  selectedSnapshotId,
  isRunning,
  onTargetChapterOrderChange,
  onPipelineModeChange,
  onEstimatedWordCountChange,
  onReaderEmotionTargetChange,
  onReaderEmotionPreset,
  onNewReaderEmotionPresetChange,
  onAddReaderEmotionPreset,
  onBudgetModeChange,
  onBudgetMaxTokensChange,
  onContextSourceChange,
  onSnapshotChange,
  onUseAutoContext,
  onStart
}: {
  targetChapterOrder: number
  nextChapter: number
  pipelineMode: PipelineMode
  estimatedWordCount: string
  readerEmotionTarget: string
  readerEmotionPresets: string[]
  newReaderEmotionPreset: string
  budgetMode: ContextBudgetMode
  budgetMaxTokens: number
  defaultTokenBudget: number
  contextSource: PipelineContextSource
  snapshots: PromptContextSnapshot[]
  selectedSnapshot: PromptContextSnapshot | null
  selectedSnapshotId: ID | null
  isRunning: boolean
  onTargetChapterOrderChange: (value: number) => void
  onPipelineModeChange: (value: PipelineMode) => void
  onEstimatedWordCountChange: (value: string) => void
  onReaderEmotionTargetChange: (value: string) => void
  onReaderEmotionPreset: (value: string) => void
  onNewReaderEmotionPresetChange: (value: string) => void
  onAddReaderEmotionPreset: () => void
  onBudgetModeChange: (value: ContextBudgetMode) => void
  onBudgetMaxTokensChange: (value: number) => void
  onContextSourceChange: (value: PipelineContextSource) => void
  onSnapshotChange: (value: ID | '') => void
  onUseAutoContext: () => void
  onStart: () => void
}) {
  return (
    <div className="pipeline-config-stack">
      <section className="pipeline-card">
        <div className="pipeline-card-title">
          <h3>生成配置</h3>
          <span>长期记忆候选不会自动写入</span>
        </div>
        <div className="form-grid compact">
          <NumberInput label="目标章节编号" min={1} value={targetChapterOrder} onChange={(value) => onTargetChapterOrderChange(value ?? nextChapter)} />
          <SelectField<PipelineMode>
            label="生成模式"
            value={pipelineMode}
            onChange={onPipelineModeChange}
            options={[
              { value: 'conservative', label: '保守' },
              { value: 'standard', label: '标准' },
              { value: 'aggressive', label: '激进' }
            ]}
          />
          <TextInput label="章节预计字数" value={estimatedWordCount} onChange={onEstimatedWordCountChange} />
          <TextInput label="读者情绪目标" value={readerEmotionTarget} onChange={onReaderEmotionTargetChange} />
        </div>

        <div className="reader-emotion-presets">
          <div className="reader-emotion-presets-header">
            <strong>快捷情绪</strong>
            <span>点击即可填入，也会记住上次使用的目标。</span>
          </div>
          <div className="reader-emotion-preset-list">
            {readerEmotionPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                className={preset === readerEmotionTarget ? 'reader-emotion-chip active' : 'reader-emotion-chip'}
                onClick={() => onReaderEmotionPreset(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
          <div className="reader-emotion-add">
            <TextInput label="新增情绪预设" value={newReaderEmotionPreset} onChange={onNewReaderEmotionPresetChange} placeholder="例如：克制、酸涩、余韵" />
            <button className="ghost-button" type="button" disabled={!newReaderEmotionPreset.trim()} onClick={onAddReaderEmotionPreset}>
              添加并使用
            </button>
          </div>
        </div>
      </section>

      <section className="pipeline-card">
        <div className="pipeline-card-title">
          <h3>上下文来源</h3>
          <span>{contextSource === 'prompt_snapshot' ? '使用 Prompt 构建器快照' : '自动构建上下文'}</span>
        </div>
        <div className="form-grid compact">
          <SelectField<ContextBudgetMode>
            label="预算模式"
            value={budgetMode}
            onChange={onBudgetModeChange}
            options={[
              { value: 'light', label: '轻量' },
              { value: 'standard', label: '标准' },
              { value: 'full', label: '完整' },
              { value: 'custom', label: '自定义' }
            ]}
          />
          <NumberInput label="预算 token" min={1000} value={budgetMaxTokens} onChange={(value) => onBudgetMaxTokensChange(value ?? defaultTokenBudget)} />
          <SelectField<PipelineContextSource>
            label="来源"
            value={contextSource}
            onChange={onContextSourceChange}
            options={[
              { value: 'auto', label: '自动构建上下文' },
              { value: 'prompt_snapshot', label: '使用 Prompt 快照' }
            ]}
          />
          {contextSource === 'prompt_snapshot' ? (
            <SelectField<ID | ''>
              label="Prompt 快照"
              value={selectedSnapshotId ?? ''}
              onChange={onSnapshotChange}
              options={[
                { value: '', label: '选择快照' },
                ...snapshots.map((snapshot) => ({
                  value: snapshot.id,
                  label: `第 ${snapshot.targetChapterOrder} 章 · ${snapshot.estimatedTokens} token · ${formatDate(snapshot.createdAt)}`
                }))
              ]}
            />
          ) : null}
        </div>
        <PipelineContextSnapshotPanel
          contextSource={contextSource}
          snapshot={selectedSnapshot}
          selectedSnapshotId={selectedSnapshotId}
          targetChapterOrder={targetChapterOrder}
          onUseAutoContext={onUseAutoContext}
        />
        <PipelineActionBar>
          <button className="ghost-button pipeline-config-start" type="button" disabled={isRunning} onClick={onStart}>
            {isRunning ? '流水线正在运行' : '开始生成'}
          </button>
        </PipelineActionBar>
      </section>
    </div>
  )
}
