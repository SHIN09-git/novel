import { useState } from 'react'
import type { CandidateDecisionEffect, CandidateDecisionFieldValue, CandidateDecisionUndoPreview } from '../../../../shared/types/candidateDecision'
import { traceMembershipRestore } from '../../../../services/candidateDecisionEffects'
import { canSubmitDecisionUndo, decisionRecordTitle } from './decisionInboxUiModel'

const FIELD_LABELS: Record<string, string> = {
  summary: '摘要', title: '标题', description: '说明', label: '状态标签', category: '类别', value: '值',
  status: '状态', currentValue: '当前值', beforeValue: '原值', afterValue: '新值', targetValue: '目标值',
  valueType: '值类型', linkedCardFields: '挂接角色卡', currentEmotionalState: '当前情绪',
  emotionalState: '当前情绪', protagonistRelationship: '与主角关系', lastChangedChapter: '最近变化章',
  relationshipWithProtagonist: '与主角关系', nextActionTendency: '下一步行动倾向',
  changeSummary: '变化摘要', newInformation: '新增信息', characterChanges: '角色变化',
  newForeshadowing: '新增伏笔', resolvedForeshadowing: '已回收伏笔', endingHook: '结尾钩子',
  riskWarnings: '风险提示', evidence: '证据', evidenceText: '证据文本', notes: '备注',
  weight: '权重', suggestedWeight: '建议权重', expectedPayoff: '预期回收',
  treatmentMode: '本章处理方式', recommendedTreatmentMode: '建议处理方式', lastTreatmentMode: '最近处理方式',
  actualPayoffChapter: '实际回收章', firstAppearanceChapter: '首次出现章',
  storyTime: '故事时间', result: '事件结果', downstreamImpact: '后续影响',
  compressedPlotSummary: '压缩剧情', irreversibleChanges: '不可逆变化',
  endingCarryoverState: '结尾承接状态', emotionalAftertaste: '情绪余味', pacingState: '节奏状态',
  coveredChapterRange: '覆盖章节', plotProgress: '剧情进展', characterRelations: '角色关系',
  secrets: '秘密', foreshadowingPlanted: '埋设伏笔', unresolvedQuestions: '未解问题',
  foreshadowingResolved: '回收伏笔', nextStageDirection: '下阶段方向',
  chapterOrder: '章节序号', chapterStart: '起始章', chapterEnd: '结束章', firstChapterOrder: '首次出现章',
  lastTouchedChapterOrder: '最近涉及章', resolvedChapterOrder: '回收章', confidence: '置信度',
  id: '记录标识', projectId: '项目标识', characterId: '角色标识', factId: '状态标识',
  chapterId: '章节标识', jobId: '运行标识', targetId: '目标标识', targetFactId: '目标状态标识',
  relatedCharacterIds: '关联角色标识', participantCharacterIds: '参与角色标识',
  createdAt: '创建时间', updatedAt: '更新时间', sourceChapterId: '来源章节标识',
  sourceChapterOrder: '来源章序', proposedPatch: '候选内容', proposedFact: '拟议状态',
  proposedTransaction: '拟议变化', source: '来源', sourceType: '来源类型', sourceId: '来源标识',
  trackingLevel: '追踪级别', promptPolicy: '提示词使用策略', riskLevel: '风险级别'
}

const ENUM_LABELS: Record<string, Record<string, string>> = {
  status: { pending: '待确认', accepted: '已接受', rejected: '已拒绝', active: '生效', inactive: '停用',
    deprecated: '已弃用', unresolved: '未回收', partial: '部分回收', resolved: '已回收', abandoned: '废弃' },
  category: { resource: '资源', inventory: '物品', location: '位置', physical: '身体状态', knowledge: '认知',
    promise: '承诺', ability: '能力', relationship: '关系', mental: '心理状态', goal: '目标', secret: '秘密',
    status: '当前状态', custom: '自定义', emotion: '情绪', identity: '身份', other: '其他' },
  treatmentMode: { hidden: '禁止提及', hint: '轻微暗示', advance: '推进', mislead: '误导', pause: '暂停', payoff: '回收' },
  weight: { low: '低', medium: '中', high: '高', payoff: '回收重点' },
  trackingLevel: { hard: '硬状态', soft: '软状态', note: '参考备注' },
  promptPolicy: { always: '始终引用', when_relevant: '相关时引用', manual_only: '仅手动选择' },
  linkedCardFields: { roleFunction: '角色定位', surfaceGoal: '表层目标', deepNeed: '深层需求', coreFear: '核心恐惧',
    decisionLogic: '决策逻辑', abilitiesAndResources: '能力与资源', weaknessAndCost: '弱点与代价',
    relationshipTension: '关系张力', futureHooks: '未来伏笔' }
}

const ACTION_LABELS: Record<CandidateDecisionUndoPreview['items'][number]['action'], string> = {
  restore_fields: '恢复本次改动的字段', remove_created: '移除本次新增记录',
  retain_history: '保留历史记录', deactivate_created: '停用本次新增记录'
}

function fieldLabel(path: string[]) {
  return path.map((part) => FIELD_LABELS[part] ?? (/^\d+$/.test(part) ? `第 ${Number(part) + 1} 项` : part)).join(' / ') || '记录内容'
}

function isTechnicalField(path: string[]) {
  return path.some((part) => /(?:Ids?|At)$/.test(part) || part === 'id' || part === 'schemaVersion')
}

function ValueContent({ value, name = '' }: { value: unknown; name?: string }) {
  if (value === null) return <span>空值</span>
  if (value === undefined) return <span>未记录值</span>
  if (typeof value === 'boolean') return <span>{value ? '是 (true)' : '否 (false)'}</span>
  if (typeof value === 'number') return <span>{value}</span>
  if (typeof value === 'string') {
    const text = ENUM_LABELS[name]?.[value] ?? value
    if (!text) return <span>空文本</span>
    return text.length > 180
      ? <details className="inbox-undo-long-value"><summary>{text.slice(0, 140)}…</summary><span>{text}</span></details>
      : <span>{text}</span>
  }
  if (Array.isArray(value)) return value.length
    ? <ul>{value.map((item, index) => <li key={index}><ValueContent value={item} name={name} /></li>)}</ul>
    : <span>空列表</span>
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([key, item]) => (
    <div key={key}><dt>{FIELD_LABELS[key] ?? key}</dt><dd><ValueContent value={item} name={key} /></dd></div>
  ))}</dl>
  return <span>{String(value)}</span>
}

export function DecisionFieldValue({ field, path }: { field: CandidateDecisionFieldValue; path: string[] }) {
  return field.exists ? <ValueContent value={field.value} name={path.at(-1)} /> : <span>未设置（字段不存在）</span>
}

function UndoField({ field, action, effect }: {
  field: CandidateDecisionUndoPreview['items'][number]['fields'][number]
  action: CandidateDecisionUndoPreview['items'][number]['action']
  effect?: CandidateDecisionEffect
}) {
  const restored = effect ? traceMembershipRestore(effect, field, field.current) ?? field.before : field.before
  return (
    <div className={`inbox-undo-field${field.conflicted ? ' conflicted' : ''}`} data-undo-field={field.path.join('.')}>
      <strong title={field.path.join('.')}>{fieldLabel(field.path)}{field.conflicted ? ' · 后续已修改' : ''}</strong>
      <div className="inbox-undo-values">
        <div><small>当时写入</small><DecisionFieldValue field={field.after} path={field.path} /></div>
        <div><small>当前值</small><DecisionFieldValue field={field.current} path={field.path} /></div>
        <div><small>撤销后</small>{action === 'remove_created' ? <span>移除记录</span> :
          action === 'retain_history' ? <DecisionFieldValue field={field.current} path={field.path} /> :
          action === 'deactivate_created' ? (field.path.length === 1 && field.path[0] === 'status'
            ? <span>停用</span> : <DecisionFieldValue field={field.current} path={field.path} />) :
          <DecisionFieldValue field={restored} path={field.path} />}</div>
      </div>
    </div>
  )
}

export function DecisionInboxUndoPreview({ preview, effects, disabled, onUndo, onCancel, onRelatedReceipt }: {
  preview: CandidateDecisionUndoPreview
  effects?: CandidateDecisionEffect[]
  disabled: boolean
  onUndo: (preview: CandidateDecisionUndoPreview, restoreChangedFields: boolean) => void
  onCancel: () => void
  onRelatedReceipt: (id: string) => void
}) {
  const [restoreChangedFields, setRestoreChangedFields] = useState(false)
  const canSubmit = canSubmitDecisionUndo(preview, restoreChangedFields)
  return (
    <section className="inbox-undo-preview" aria-label="撤销预览" data-undo-status={preview.status}>
      <header><strong>撤销预览</strong><p>仅处理这次决定涉及的记录；原处理记录和历史仍会保留。</p></header>
      {preview.requiresConfirmation && (preview.status === 'ready' || preview.status === 'conflict') ?
        <p className="inbox-undo-risk"><strong>高风险变更</strong>：撤销将按下方预览更改长期记录，请核对差异后再确认。</p> : null}
      {preview.status === 'already_undone' ? <p>这次处理已经撤销。
        {preview.undoReceiptId ? <button className="text-button" type="button" onClick={() => onRelatedReceipt(preview.undoReceiptId!)}>查看撤销记录</button> : null}
      </p> : null}
      {preview.status === 'unavailable' ? <p>无法自动撤销这次处理，请到对应的角色、记忆、伏笔或时间线页面核对。</p> : null}
      {preview.status === 'conflict' ? <p className="inbox-candidate-warning">{preview.canRestoreConflicts
        ? '以下记录已有后续修改。撤销将按预览恢复字段、移除或停用记录。'
        : '记录或依赖发生变化，无法安全撤销。请先到相关页面核对。'}</p> : null}
      {preview.items.map((item) => {
        const effect = effects?.find((entry) => entry.collection === item.collection && entry.id === item.id)
        const fields = item.fields.filter((field) => field.conflicted || (item.action === 'restore_fields' && !isTechnicalField(field.path)))
        const extraFields = item.action === 'restore_fields' ? [] : item.fields.filter((field) => !field.conflicted && !isTechnicalField(field.path))
        const technical = item.fields.filter((field) => isTechnicalField(field.path) && !field.conflicted)
        return <div className="inbox-undo-item" key={`${item.collection}:${item.id}`}>
          <header><strong>{decisionRecordTitle(item)}</strong><span>{ACTION_LABELS[item.action]}</span></header>
          {fields.map((field) => <UndoField key={JSON.stringify(field.path)} field={field} action={item.action} effect={effect} />)}
          {extraFields.length ? <details className="inbox-record-details"><summary>查看记录内容（{extraFields.length} 项）</summary>
            {extraFields.map((field) => <UndoField key={JSON.stringify(field.path)} field={field} action={item.action} effect={effect} />)}
          </details> : null}
          <details className="inbox-record-details"><summary>记录标识{technical.length ? '与关联字段' : ''}</summary>
            <p>{item.collection} · {item.id}</p>
            {technical.map((field) => <UndoField key={JSON.stringify(field.path)} field={field} action={item.action} effect={effect} />)}
          </details>
        </div>
      })}
      {preview.warnings.length ? <ul className="inbox-undo-warnings">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
      {preview.status === 'conflict' && preview.canRestoreConflicts ? (
        <label className="inbox-restore-consent"><input type="checkbox" checked={restoreChangedFields} disabled={disabled}
          onChange={(event) => setRestoreChangedFields(event.target.checked)} />
          <span>我已核对差异，同意按“撤销后”列处理这些后续修改</span>
        </label>
      ) : null}
      <div className="inbox-event-actions">
        <button className="ghost-button" type="button" disabled={disabled} onClick={onCancel}>取消</button>
        <button className="primary-button" type="button" disabled={disabled || !canSubmit}
          onClick={() => onUndo(preview, restoreChangedFields)}>确认撤销这次处理</button>
      </div>
    </section>
  )
}
