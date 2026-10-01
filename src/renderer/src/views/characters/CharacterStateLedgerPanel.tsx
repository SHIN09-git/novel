import type { CharacterCardField, CharacterStateChangeCandidate, CharacterStateFact, StateFactCategory } from '../../../../shared/types'
import { Plus } from 'lucide-react'
import { SelectField, TextInput } from '../../components/FormFields'
import { useBufferedField } from '../../hooks/useBufferedField'
import { CARD_FIELD_LABELS, STATE_CATEGORY_OPTIONS, STATE_TEMPLATES, factDisplayValue, factEditableValue } from './characterStateUi'

interface CharacterStateLedgerPanelProps {
  draftKey: string
  stateFacts: CharacterStateFact[]
  stateCandidates: CharacterStateChangeCandidate[]
  factTemplate: string
  factCategory: StateFactCategory
  factLabel: string
  factValue: string
  factSaving: boolean
  factMessage: string
  onChooseStateTemplate: (key: string) => void
  onFactCategoryChange: (category: StateFactCategory) => void
  onFactLabelChange: (label: string) => void
  onFactValueChange: (value: string) => void
  onAddStateFact: () => void
  onUpdateStateFactValue: (fact: CharacterStateFact, value: string) => void
  onUpdateStateFactLinkedFields: (fact: CharacterStateFact, field: CharacterCardField, enabled: boolean) => void
  onArchiveStateFact: (fact: CharacterStateFact) => void
  onApplyStateCandidate: (candidate: CharacterStateChangeCandidate) => void
  onRejectStateCandidate: (candidate: CharacterStateChangeCandidate) => void
}

interface StateFactCardProps {
  fact: CharacterStateFact
  onUpdateValue: (fact: CharacterStateFact, value: string) => void
  onUpdateLinkedFields: (fact: CharacterStateFact, field: CharacterCardField, enabled: boolean) => void
  onArchive: (fact: CharacterStateFact) => void
}

function StateFactCard({ fact, onUpdateValue, onUpdateLinkedFields, onArchive }: StateFactCardProps) {
  const bufferedValue = useBufferedField({
    value: factEditableValue(fact),
    onCommit: (value) => onUpdateValue(fact, value),
    delayMs: 500,
    resetKey: fact.id
  })

  return (
    <article className="state-fact-card">
      <div>
        <strong>{fact.label}</strong>
        <span>{factDisplayValue(fact)}</span>
        <small>
          {{ hard: '硬状态', soft: '软状态', note: '参考备注' }[fact.trackingLevel]} · {STATE_CATEGORY_OPTIONS.find((option) => option.value === fact.category)?.label ?? fact.category} · {{ always: '始终引入', when_relevant: '相关时引入', manual_only: '仅手动引入' }[fact.promptPolicy]}
        </small>
        <small>
          来源：{fact.sourceChapterOrder ? `第 ${fact.sourceChapterOrder} 章` : '手动/未关联章节'}
          {fact.evidence ? ` · 证据：${fact.evidence}` : ''}
        </small>
        <details className="state-link-editor">
          <summary>修改挂接字段</summary>
          <div className="checkbox-grid">
            {Object.entries(CARD_FIELD_LABELS).map(([fieldKey, fieldLabel]) => (
              <label key={fieldKey}>
                <input
                  type="checkbox"
                  checked={fact.linkedCardFields.includes(fieldKey as CharacterCardField)}
                  onChange={(event) => onUpdateLinkedFields(fact, fieldKey as CharacterCardField, event.target.checked)}
                />
                {fieldLabel}
              </label>
            ))}
          </div>
        </details>
      </div>
      <input
        aria-label={`编辑${fact.label}`}
        value={bufferedValue.value}
        onBlur={bufferedValue.flush}
        onChange={(event) => bufferedValue.onChange(event.target.value)}
      />
      <button className="ghost-button" onClick={() => onArchive(fact)}>归档</button>
    </article>
  )
}

export function CharacterStateLedgerPanel({
  draftKey,
  stateFacts,
  stateCandidates,
  factTemplate,
  factCategory,
  factLabel,
  factValue,
  factSaving,
  factMessage,
  onChooseStateTemplate,
  onFactCategoryChange,
  onFactLabelChange,
  onFactValueChange,
  onAddStateFact,
  onUpdateStateFactValue,
  onUpdateStateFactLinkedFields,
  onArchiveStateFact,
  onApplyStateCandidate,
  onRejectStateCandidate
}: CharacterStateLedgerPanelProps) {
  const uncategorizedFacts = stateFacts.filter((fact) => fact.linkedCardFields.length === 0)

  return (
    <div className="panel character-state-ledger-panel">
      <h2>动态状态账本</h2>
      <p className="muted">{stateFacts.length} 项生效状态{stateCandidates.length > 0 ? ` · ${stateCandidates.length} 项待确认` : ''}</p>
      <details className="character-add-fact">
      <summary><Plus size={16} aria-hidden="true" />新增状态事实</summary>
      <div className="form-grid compact">
        <SelectField
          label="常用模板"
          value={factTemplate}
          options={STATE_TEMPLATES.map((template) => ({ value: template.key, label: template.label }))}
          onChange={onChooseStateTemplate}
        />
        <SelectField label="类别" value={factCategory} options={STATE_CATEGORY_OPTIONS} onChange={onFactCategoryChange} />
        <TextInput label="状态名称" value={factLabel} onChange={onFactLabelChange} bufferKey={draftKey} />
        <TextInput
          label="状态值"
          value={factValue}
          bufferKey={draftKey}
          placeholder={STATE_TEMPLATES.find((item) => item.key === factTemplate)?.valueHint}
          onChange={onFactValueChange}
        />
      </div>
      <button className="primary-button" disabled={factSaving || !factLabel.trim()} onClick={onAddStateFact}>
        {factSaving ? '保存中…' : '新增状态事实'}
      </button>
      <p className="character-form-status" role="status">{factMessage}</p>
      </details>
      <div className="state-ledger-groups">
        {Object.entries(CARD_FIELD_LABELS).map(([field, label]) => {
          const facts = stateFacts.filter((fact) => fact.linkedCardFields.includes(field as CharacterCardField))
          if (!facts.length) return null
          return (
            <section key={field} className="state-ledger-group">
              <h3>{label}</h3>
              {facts.map((fact) => (
                <StateFactCard
                  key={fact.id}
                  fact={fact}
                  onUpdateValue={onUpdateStateFactValue}
                  onUpdateLinkedFields={onUpdateStateFactLinkedFields}
                  onArchive={onArchiveStateFact}
                />
              ))}
            </section>
          )
        })}
        {stateFacts.length === 0 ? <p className="muted">暂无动态状态。建议先添加现金、持有物品、当前位置或伤势。</p> : null}
        {uncategorizedFacts.length > 0 ? (
          <section className="state-ledger-group">
            <h3>未归类状态</h3>
            {uncategorizedFacts.map((fact) => (
              <StateFactCard
                key={fact.id}
                fact={fact}
                onUpdateValue={onUpdateStateFactValue}
                onUpdateLinkedFields={onUpdateStateFactLinkedFields}
                onArchive={onArchiveStateFact}
              />
            ))}
          </section>
        ) : null}
      </div>
      {stateCandidates.length > 0 ? (
        <div className="candidate-list">
          <h3>待确认状态变化候选</h3>
          {stateCandidates.map((candidate) => (
            <article key={candidate.id} className="candidate-card">
              <strong>{candidate.proposedFact?.label || candidate.proposedTransaction?.reason || '状态变化候选'}</strong>
              <p>{candidate.evidence || '暂无证据文本'}</p>
              <p>
                {String(candidate.beforeValue ?? '未记录')} → {String(candidate.afterValue ?? candidate.proposedFact?.value ?? '未记录')}
              </p>
              <div className="row-actions">
                <button className="primary-button" onClick={() => onApplyStateCandidate(candidate)}>接受</button>
                <button className="ghost-button" onClick={() => onRejectStateCandidate(candidate)}>拒绝</button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}
