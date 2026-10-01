import type { Chapter, Character, ContextBudgetProfile, ContextSelectionResult, Foreshadowing } from '../../../../shared/types'
import { ContextBudgetManager } from '../../../../services/ContextBudgetManager'
import { StatCard, TokenBudgetMeter } from '../../components/UI'

interface PromptBudgetPanelProps {
  budgetProfile: ContextBudgetProfile
  budgetSelection: ContextSelectionResult
  chapters: Chapter[]
  characters: Character[]
  foreshadowings: Foreshadowing[]
}

export function PromptBudgetPanel({
  budgetProfile,
  budgetSelection,
  chapters,
  characters,
  foreshadowings
}: PromptBudgetPanelProps) {
  const selectedChapterLabels =
    chapters
      .filter((chapter) => budgetSelection.selectedChapterIds.includes(chapter.id))
      .map((chapter) => `第 ${chapter.order} 章`)
      .join('、') || '无'
  const selectedCharacterLabels =
    characters
      .filter((character) => budgetSelection.selectedCharacterIds.includes(character.id))
      .map((character) => character.name)
      .join('、') || '无'
  const selectedForeshadowingLabels =
    foreshadowings
      .filter((item) => budgetSelection.selectedForeshadowingIds.includes(item.id))
      .map((item) => item.title)
      .join('、') || '无'

  return (
    <section className="panel prompt-budget-panel">
      <h2>记忆预算调度</h2>
      <p className="muted">{ContextBudgetManager.explainSelection(budgetSelection)}</p>
      <TokenBudgetMeter value={budgetSelection.estimatedTokens} max={budgetProfile.maxTokens} label="上下文选择" />
      <div className="metric-grid prompt-budget-stats">
        <StatCard label="纳入章节" value={budgetSelection.selectedChapterIds.length} tone="accent" />
        <StatCard label="纳入角色" value={budgetSelection.selectedCharacterIds.length} tone="success" />
        <StatCard label="纳入伏笔" value={budgetSelection.selectedForeshadowingIds.length} tone="warning" />
        <StatCard label="省略项目" value={budgetSelection.omittedItems.length} tone="info" />
      </div>
      <div className="budget-columns">
        <div>
          <h3>已选择内容</h3>
          <ul className="advice-list">
            <li>章节：{selectedChapterLabels}</li>
            <li>角色：{selectedCharacterLabels}</li>
            <li>伏笔：{selectedForeshadowingLabels}</li>
          </ul>
        </div>
        <div>
          <h3>省略与风险</h3>
          <ul className="advice-list">
            {budgetSelection.omittedItems.slice(0, 6).map((item, index) => (
              <li key={`${item.type}-${item.id ?? index}`}>{item.type}：{item.reason}</li>
            ))}
            {budgetSelection.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
