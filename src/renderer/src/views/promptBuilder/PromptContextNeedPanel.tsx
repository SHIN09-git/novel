import type { Character, ContextNeedPlan, Foreshadowing, ID } from '../../../../shared/types'
import { TextArea, Toggle } from '../../components/FormFields'
import { now } from '../../utils/format'

interface PromptContextNeedPanelProps {
  contextNeedPlan: ContextNeedPlan | null
  characters: Character[]
  foreshadowings: Foreshadowing[]
  onGenerate: () => void
  onChange: (plan: ContextNeedPlan) => void
  onToggleCharacter: (characterId: ID, checked: boolean) => void
  onToggleForeshadowing: (id: ID, role: 'required' | 'forbidden', checked: boolean) => void
}

const presenceLabels = { onstage: '在场', offscreen: '场外参与', referenced: '仅被提及' } as const
const involvementLabels = { mentioned: '提及', present: '预计在场', must_act: '必须行动' } as const

export function PromptContextNeedPanel({
  contextNeedPlan,
  characters,
  foreshadowings,
  onGenerate,
  onChange,
  onToggleCharacter,
  onToggleForeshadowing
}: PromptContextNeedPanelProps) {
  return (
    <section className="panel context-need-panel">
      <div className="panel-title-row">
        <h2>上下文需求计划</h2>
        <button className="secondary-button" onClick={onGenerate}>生成上下文需求计划</button>
      </div>
      {!contextNeedPlan ? (
        <p className="muted">先判断本章需要检索哪些角色卡字段、状态事实、伏笔、时间线和设定，再交给预算调度器筛选上下文。</p>
      ) : (
        <div className="stack-list">
          <p><strong>场景类型：</strong>{contextNeedPlan.expectedSceneType}</p>
          <TextArea
            label="本章意图"
            value={contextNeedPlan.chapterIntent}
            rows={3}
            onChange={(chapterIntent) => onChange({ ...contextNeedPlan, chapterIntent, updatedAt: now() })}
          />
          <div className="budget-columns">
            <div>
              <h3>预计出场角色</h3>
              <ul className="advice-list">
                {contextNeedPlan.expectedCharacters.map((item) => {
                  const character = characters.find((candidate) => candidate.id === item.characterId)
                  const fields = contextNeedPlan.requiredCharacterCardFields[item.characterId] ?? []
                  const categories = contextNeedPlan.requiredStateFactCategories[item.characterId] ?? []
                  return (
                    <li key={item.characterId}>
                      <strong>{character?.name ?? item.characterId}</strong>
                      ：{involvementLabels[item.involvement]} · {presenceLabels[item.expectedPresence]}
                      {item.uncertain ? ' · 待确认' : ''}
                      <br />
                      <span className="muted">
                        字段 {fields.join('、') || '-'}；
                        {item.stateCheckRequired ? `需核对状态 ${categories.join('、') || '当前硬状态'}` : '无需读取完整状态账本'}
                      </span>
                      <br />
                      <span className="muted">{item.reason}</span>
                    </li>
                  )
                })}
                {contextNeedPlan.expectedCharacters.length === 0 ? <li>暂无预计角色。</li> : null}
              </ul>
            </div>
            <div>
              <h3>伏笔与连续性</h3>
              <ul className="advice-list">
                <li>需要伏笔：{contextNeedPlan.requiredForeshadowingIds.length}</li>
                <li>禁止伏笔：{contextNeedPlan.forbiddenForeshadowingIds.length}</li>
                <li>必须检查：{contextNeedPlan.mustCheckContinuity.join('、') || '-'}</li>
                {contextNeedPlan.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}
              </ul>
            </div>
          </div>
          <details className="context-item">
            <summary>手动微调需求计划</summary>
            <div className="budget-columns">
              <div>
                <h3>出场角色</h3>
                <div className="checkbox-grid">
                  {characters.map((character) => (
                    <Toggle
                      key={character.id}
                      label={character.name}
                      checked={contextNeedPlan.expectedCharacters.some((item) => item.characterId === character.id)}
                      onChange={(checked) => onToggleCharacter(character.id, checked)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <h3>伏笔需求</h3>
                <div className="stack-list context-need-foreshadowing-list">
                  {foreshadowings.map((item) => (
                    <div key={item.id} className="context-item">
                      <strong>{item.title}</strong>
                      <Toggle
                        label="本章需要检索"
                        checked={contextNeedPlan.requiredForeshadowingIds.includes(item.id)}
                        onChange={(checked) => onToggleForeshadowing(item.id, 'required', checked)}
                      />
                      <Toggle
                        label="本章禁止提及/推进"
                        checked={contextNeedPlan.forbiddenForeshadowingIds.includes(item.id)}
                        onChange={(checked) => onToggleForeshadowing(item.id, 'forbidden', checked)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </div>
      )}
    </section>
  )
}
