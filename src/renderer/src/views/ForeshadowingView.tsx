import { useState } from 'react'
import type { Foreshadowing, ForeshadowingStatus, ForeshadowingTreatmentMode, ForeshadowingWeight, ID } from '../../../shared/types'
import { FORESHADOWING_TREATMENT_OPTIONS, normalizeTreatmentMode, treatmentDescription } from '../../../shared/foreshadowingTreatment'
import { EmptyState, NumberInput, SelectField, TextArea, TextInput, Toggle } from '../components/FormFields'
import { Header } from '../components/Layout'
import { StatCard, StatusBadge, WeightBadge } from '../components/UI'
import { newId, now, statusLabel, treatmentModeLabel, weightLabel } from '../utils/format'
import { projectData } from '../utils/projectData'
import { expectedPayoffNearText } from '../utils/promptContext'
import type { ProjectProps } from './viewTypes'
import { updateProjectTimestamp } from './viewTypes'

export function ForeshadowingView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const [statusFilter, setStatusFilter] = useState<'all' | ForeshadowingStatus>('all')
  const [weightFilter, setWeightFilter] = useState<'all' | ForeshadowingWeight>('all')
  const [treatmentFilter, setTreatmentFilter] = useState<'all' | ForeshadowingTreatmentMode>('all')
  const [nearChapter, setNearChapter] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<ID | null>(null)
  const foreshadowings = scoped.foreshadowings
    .filter((item) => statusFilter === 'all' || item.status === statusFilter)
    .filter((item) => weightFilter === 'all' || item.weight === weightFilter)
    .filter((item) => treatmentFilter === 'all' || normalizeTreatmentMode(item.treatmentMode, item.status, item.weight) === treatmentFilter)
    .filter((item) => !nearChapter || !item.expectedPayoff || expectedPayoffNearText(item.expectedPayoff, nearChapter))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const selected = scoped.foreshadowings.find((item) => item.id === selectedId) ?? foreshadowings[0] ?? null

  async function addForeshadowing() {
    const timestamp = now()
    const item: Foreshadowing = {
      id: newId(),
      projectId: project.id,
      title: '新伏笔',
      firstChapterOrder: null,
      description: '',
      status: 'unresolved',
      weight: 'medium',
      treatmentMode: 'hint',
      expectedPayoff: '',
      payoffMethod: '',
      relatedCharacterIds: [],
      relatedMainPlot: '',
      notes: '',
      actualPayoffChapter: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData({ ...data, projects: updateProjectTimestamp(data, project.id), foreshadowings: [...data.foreshadowings, item] })
    setSelectedId(item.id)
  }

  async function updateForeshadowing(id: ID, patch: Partial<Foreshadowing>) {
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      foreshadowings: data.foreshadowings.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: now() } : item))
    })
  }

  async function deleteForeshadowing(item: Foreshadowing) {
    if (!confirm(`确定删除伏笔「${item.title}」吗？`)) return
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      foreshadowings: data.foreshadowings.filter((candidate) => candidate.id !== item.id)
    })
    setSelectedId(null)
  }

  return (
    <div className="foreshadowing-view">
      <Header title="伏笔账本" description="用处理方式控制伏笔本章是隐藏、暗示、推进、误导、暂停还是回收，避免高权重伏笔被每章过度推进。" actions={<button className="primary-button" onClick={addForeshadowing}>快速新增伏笔</button>} />
      <section className="foreshadowing-summary">
        <StatCard label="未回收" value={scoped.foreshadowings.filter((item) => item.status === 'unresolved').length} tone="accent" />
        <StatCard label="部分推进" value={scoped.foreshadowings.filter((item) => item.status === 'partial').length} tone="info" />
        <StatCard label="高/回收权重" value={scoped.foreshadowings.filter((item) => item.weight === 'high' || item.weight === 'payoff').length} tone="warning" />
        <StatCard label="已归档" value={scoped.foreshadowings.filter((item) => item.status === 'resolved' || item.status === 'abandoned').length} tone="success" />
      </section>
      <section className="panel filters asset-filters">
        <SelectField
          label="状态"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'unresolved', label: '未回收' },
            { value: 'partial', label: '部分推进' },
            { value: 'resolved', label: '已回收' },
            { value: 'abandoned', label: '废弃' }
          ]}
        />
        <SelectField
          label="权重"
          value={weightFilter}
          onChange={setWeightFilter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'low', label: '低' },
            { value: 'medium', label: '中' },
            { value: 'high', label: '高' },
            { value: 'payoff', label: '回收' }
          ]}
        />
        <NumberInput label="预计回收接近章节" value={nearChapter} onChange={setNearChapter} />
        <SelectField
          label="处理方式"
          value={treatmentFilter}
          onChange={setTreatmentFilter}
          options={[{ value: 'all', label: '全部' }, ...FORESHADOWING_TREATMENT_OPTIONS]}
        />
      </section>
      <section className="table-editor foreshadowing-workbench">
        <div className="panel table-panel">
          <table>
            <thead>
              <tr>
                <th>标题</th>
                <th>状态</th>
                <th>权重</th>
                <th>处理方式</th>
                <th>预计回收</th>
              </tr>
            </thead>
            <tbody>
              {foreshadowings.map((item) => (
                <tr key={item.id} className={`${item.id === selected?.id ? 'active-row' : ''} ${item.status}`} onClick={() => setSelectedId(item.id)}>
                  <td>{item.title}</td>
                  <td>
                    <StatusBadge tone={item.status === 'resolved' ? 'success' : item.status === 'abandoned' ? 'neutral' : item.status === 'partial' ? 'info' : 'accent'}>
                      {statusLabel(item.status)}
                    </StatusBadge>
                  </td>
                  <td><WeightBadge weight={item.weight} label={weightLabel(item.weight)} /></td>
                  <td>
                    <StatusBadge tone={normalizeTreatmentMode(item.treatmentMode, item.status, item.weight) === 'payoff' ? 'warning' : normalizeTreatmentMode(item.treatmentMode, item.status, item.weight) === 'hidden' || normalizeTreatmentMode(item.treatmentMode, item.status, item.weight) === 'pause' ? 'neutral' : 'info'}>
                      {treatmentModeLabel(normalizeTreatmentMode(item.treatmentMode, item.status, item.weight))}
                    </StatusBadge>
                  </td>
                  <td>{item.expectedPayoff || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          {!selected ? (
            <EmptyState title="暂无伏笔" description="新增伏笔后，可维护状态、权重、预计回收章节和关联角色。" />
          ) : (
            <>
              <div className="form-grid compact">
                <TextInput label="伏笔标题" value={selected.title} onChange={(title) => updateForeshadowing(selected.id, { title })} />
                <NumberInput label="首次出现章节" value={selected.firstChapterOrder} onChange={(firstChapterOrder) => updateForeshadowing(selected.id, { firstChapterOrder })} />
                <SelectField<ForeshadowingStatus>
                  label="当前状态"
                  value={selected.status}
                  onChange={(status) => updateForeshadowing(selected.id, { status })}
                  options={[
                    { value: 'unresolved', label: '未回收' },
                    { value: 'partial', label: '部分推进' },
                    { value: 'resolved', label: '已回收' },
                    { value: 'abandoned', label: '废弃' }
                  ]}
                />
                <SelectField<ForeshadowingWeight>
                  label="叙事权重"
                  value={selected.weight}
                  onChange={(weight) => updateForeshadowing(selected.id, { weight })}
                  options={[
                    { value: 'low', label: '低' },
                    { value: 'medium', label: '中' },
                    { value: 'high', label: '高' },
                    { value: 'payoff', label: '回收' }
                  ]}
                />
                <SelectField<ForeshadowingTreatmentMode>
                  label="当前处理方式"
                  value={normalizeTreatmentMode(selected.treatmentMode, selected.status, selected.weight)}
                  onChange={(treatmentMode) => updateForeshadowing(selected.id, { treatmentMode })}
                  options={FORESHADOWING_TREATMENT_OPTIONS}
                />
              </div>
              <p className="muted">{treatmentDescription(normalizeTreatmentMode(selected.treatmentMode, selected.status, selected.weight))}</p>
              {selected.weight === 'payoff' && normalizeTreatmentMode(selected.treatmentMode, selected.status, selected.weight) !== 'payoff' ? (
                <p className="notice">该伏笔权重较高，但当前未设置为回收。本章不会默认把它当作兑现项推进。</p>
              ) : null}
              <TextArea label="伏笔描述" value={selected.description} onChange={(description) => updateForeshadowing(selected.id, { description })} />
              <div className="form-grid">
                <TextArea label="预计回收章节或范围" value={selected.expectedPayoff} onChange={(expectedPayoff) => updateForeshadowing(selected.id, { expectedPayoff })} />
                <TextArea label="回收方式" value={selected.payoffMethod} onChange={(payoffMethod) => updateForeshadowing(selected.id, { payoffMethod })} />
                <TextArea label="关联主线" value={selected.relatedMainPlot} onChange={(relatedMainPlot) => updateForeshadowing(selected.id, { relatedMainPlot })} />
                <TextArea label="注意事项" value={selected.notes} onChange={(notes) => updateForeshadowing(selected.id, { notes })} />
              </div>
              <NumberInput label="实际回收章节" value={selected.actualPayoffChapter} onChange={(actualPayoffChapter) => updateForeshadowing(selected.id, { actualPayoffChapter })} />
              <div className="checkbox-grid">
                {scoped.characters.map((character) => (
                  <Toggle
                    key={character.id}
                    label={character.name}
                    checked={selected.relatedCharacterIds.includes(character.id)}
                    onChange={(checked) => {
                      const ids = checked
                        ? [...selected.relatedCharacterIds, character.id]
                        : selected.relatedCharacterIds.filter((id) => id !== character.id)
                      updateForeshadowing(selected.id, { relatedCharacterIds: ids })
                    }}
                  />
                ))}
              </div>
              <div className="row-actions">
                <button className="danger-button" onClick={() => deleteForeshadowing(selected)}>
                  删除伏笔
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
