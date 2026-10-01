import type { ContextBudgetMode, PromptMode, PromptModuleSelection } from '../../../../shared/types'
import { NumberInput, SelectField, Toggle } from '../../components/FormFields'
import { TokenBudgetMeter } from '../../components/UI'

interface PromptControlPanelProps {
  targetChapterOrder: number
  mode: PromptMode
  budgetMode: ContextBudgetMode
  budgetMaxTokens: number
  tokenEstimate: number
  modules: PromptModuleSelection
  advice: string[]
  onTargetChapterOrderChange: (value: number | null) => void
  onModeChange: (mode: PromptMode) => void
  onBudgetModeChange: (mode: ContextBudgetMode) => void
  onBudgetMaxTokensChange: (value: number | null) => void
  onModulesChange: (modules: PromptModuleSelection) => void
  onResetAutomaticSelection: () => void
}

const moduleLabels: Record<keyof PromptModuleSelection, string> = {
  bible: '全书核心设定',
  progress: '当前剧情进度',
  recentChapters: '最近章节回顾',
  characters: '主要角色状态',
  foreshadowing: '当前相关伏笔',
  stageSummaries: '阶段摘要档案',
  timeline: '时间线校验',
  chapterTask: '当前章节任务书',
  forbidden: '本章禁止事项',
  outputFormat: '输出格式要求'
}

export function PromptControlPanel({
  targetChapterOrder,
  mode,
  budgetMode,
  budgetMaxTokens,
  tokenEstimate,
  modules,
  advice,
  onTargetChapterOrderChange,
  onModeChange,
  onBudgetModeChange,
  onBudgetMaxTokensChange,
  onModulesChange,
  onResetAutomaticSelection
}: PromptControlPanelProps) {
  return (
    <aside className="panel prompt-controls">
      <div className="prompt-controls-head">
        <h2>上下文控制</h2>
      </div>
      <NumberInput label="准备写第 N 章" value={targetChapterOrder} min={1} onChange={onTargetChapterOrderChange} />
      <SelectField<PromptMode>
        label="Prompt 模式"
        value={mode}
        onChange={onModeChange}
        options={[
          { value: 'light', label: '轻量模式' },
          { value: 'standard', label: '标准模式' },
          { value: 'full', label: '完整模式' }
        ]}
      />
      <details className="prompt-control-disclosure">
      <summary>预算设置</summary>
      <SelectField<ContextBudgetMode>
        label="记忆预算模式"
        value={budgetMode}
        onChange={onBudgetModeChange}
        options={[
          { value: 'light', label: '轻量' },
          { value: 'standard', label: '标准' },
          { value: 'full', label: '完整' },
          { value: 'custom', label: '自定义' }
        ]}
      />
      <NumberInput label="上下文预算 token" min={1000} value={budgetMaxTokens} onChange={onBudgetMaxTokensChange} />
      </details>
      <details className="module-box prompt-control-disclosure">
        <summary>上下文模块</summary>
        {(Object.keys(modules) as Array<keyof PromptModuleSelection>).map((key) => (
          <Toggle key={key} label={moduleLabels[key]} checked={modules[key]} onChange={(checked) => onModulesChange({ ...modules, [key]: checked })} />
        ))}
      </details>
      <button className="ghost-button" onClick={onResetAutomaticSelection}>恢复自动推荐</button>
      <TokenBudgetMeter value={tokenEstimate} max={budgetMaxTokens} label="最终 Prompt" />
      <ul className="advice-list">
        {advice.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </aside>
  )
}
