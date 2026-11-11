import { useMemo, useState } from 'react'
import type { HardCanonItem, HardCanonItemCategory, HardCanonPriority, HardCanonStatus } from '../../../shared/types'
import { HardCanonPackService } from '../../../services/HardCanonPackService'
import { compareHardCanonItems } from '../../../services/hardCanonDuplicates'
import { decisionFingerprint } from '../../../services/candidateDecisionPrimitives'
import { HardCanonCheckEditor, checkEditorDraft, checkFromEditor, describeHardCanonCheck } from './HardCanonCheckEditor'
import { useConfirm } from '../components/ConfirmDialog'
import { Field, TextArea, TextInput } from '../components/FormFields'
import { Header } from '../components/Layout'
import { StatusBadge } from '../components/UI'
import { useProjectData } from '../hooks/useProjectData'
import { now } from '../utils/format'
import type { ProjectProps } from './viewTypes'
import '../styles/views/hard-canon.css'

const categories: HardCanonItemCategory[] = [
  'world_rule',
  'system_rule',
  'character_identity',
  'character_hard_state',
  'timeline_anchor',
  'foreshadowing_rule',
  'relationship_fact',
  'prohibition',
  'style_boundary',
  'other'
]

const categoryLabels: Record<HardCanonItemCategory, string> = {
  world_rule: '世界规则',
  system_rule: '系统规则',
  character_identity: '角色身份',
  character_hard_state: '角色硬状态',
  timeline_anchor: '时间锚点',
  foreshadowing_rule: '伏笔规则',
  relationship_fact: '关系事实',
  prohibition: '禁止事项',
  style_boundary: '风格边界',
  other: '其他'
}

const priorities: HardCanonPriority[] = ['must', 'high', 'medium']
const priorityLabels: Record<HardCanonPriority, string> = {
  must: '必须',
  high: '高',
  medium: '中'
}

const statusLabels: Record<HardCanonStatus, string> = {
  active: '启用',
  inactive: '停用',
  deprecated: '废弃'
}

function emptyDraft(projectId: string): HardCanonItem {
  const timestamp = now()
  return {
    id: '',
    projectId,
    category: 'world_rule',
    title: '',
    content: '',
    priority: 'must',
    status: 'active',
    sourceType: 'manual',
    sourceId: null,
    relatedCharacterIds: [],
    relatedForeshadowingIds: [],
    relatedTimelineEventIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function HardCanonView(props: ProjectProps) {
  return <HardCanonProjectEditor key={props.project.id} {...props} />
}

function HardCanonProjectEditor({ data, project, saveData }: ProjectProps) {
  const scoped = useProjectData(data, project.id)
  const pack = useMemo(() => HardCanonPackService.getHardCanonPackForProject(data, project.id), [data, project.id])
  const promptPreview = useMemo(() => HardCanonPackService.compressHardCanonPackForPrompt(pack), [pack])
  const [draft, setDraft] = useState<HardCanonItem>(() => emptyDraft(project.id))
  const [condition, setCondition] = useState(() => checkEditorDraft())
  const [editVersion, setEditVersion] = useState('')
  const [message, setMessage] = useState('')
  const confirmAction = useConfirm()
  const prepared = useMemo(() => {
    try {
      const item = { ...draft, check: checkFromEditor(condition) }
      const duplicates = item.title.trim() && item.content.trim() ? compareHardCanonItems(pack.items, item) : null
      return { item, duplicates, error: '' }
    } catch (error) {
      return { item: null, duplicates: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [draft, condition, pack.items])

  function edit(item = emptyDraft(project.id)) {
    setDraft(item)
    setCondition(checkEditorDraft(item.check))
    setEditVersion(item.id ? decisionFingerprint(item) : '')
    setMessage('')
  }

  const sortedItems = useMemo(
    () =>
      [...pack.items].sort((a, b) => {
        const statusRank = a.status === 'active' ? 0 : a.status === 'inactive' ? 1 : 2
        const nextStatusRank = b.status === 'active' ? 0 : b.status === 'inactive' ? 1 : 2
        if (statusRank !== nextStatusRank) return statusRank - nextStatusRank
        const priorityRank: Record<HardCanonPriority, number> = { must: 0, high: 1, medium: 2 }
        return priorityRank[a.priority] - priorityRank[b.priority]
      }),
    [pack.items]
  )

  async function saveMeta(patch: Partial<typeof pack>) {
    const saved = await saveData((current) => {
      const currentPack = HardCanonPackService.getHardCanonPackForProject(current, project.id)
      return HardCanonPackService.savePackMeta(current, { ...currentPack, ...patch, updatedAt: now() })
    })
    if (!saved.ok) return saved
    setMessage('硬设定包设置已保存。')
    return saved
  }

  async function saveItem() {
    if (!draft.title.trim() || !draft.content.trim()) {
      setMessage('请填写标题和内容。')
      return
    }
    const { item, duplicates, error } = prepared
    if (!item) { setMessage(error); return }
    const reused = (existing: HardCanonItem) => `已复用「${existing.title}」（${existing.id}），保留原条目和${statusLabels[existing.status]}状态。`
    if (duplicates?.exact) {
      if (draft.id) { setMessage(`与「${duplicates.exact.title}」重复，未修改任何条目。`); return }
      edit()
      setMessage(reused(duplicates.exact))
      return
    }
    let resultMessage = '硬设定条目已保存。'
    const saved = await saveData((current) => {
      if (item.id && decisionFingerprint(HardCanonPackService.getHardCanonPackForProject(current, project.id)
        .items.find((entry) => entry.id === item.id)) !== editVersion) {
        throw new Error('该条目已更改或删除，请重新打开后再编辑。')
      }
      const result = HardCanonPackService.saveAuthoredItem(current, item)
      if (result.reused) resultMessage = reused(result.item)
      return result.data
    })
    if (!saved.ok) { setMessage(saved.errorMessage); return }
    edit()
    setMessage(resultMessage)
  }

  async function setStatus(item: HardCanonItem, status: HardCanonStatus) {
    const saved = await saveData((current) => HardCanonPackService.setHardCanonItemStatus(current, item.id, status, project.id))
    if (!saved.ok) return
    setMessage(`已${statusLabels[status]}：${item.title}`)
  }

  async function removeItem(item: HardCanonItem) {
    const ok = await confirmAction({
      title: '删除硬设定',
      message: `删除硬设定「${item.title}」？此操作不会删除任何小说正文。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      tone: 'danger'
    })
    if (!ok) return
    const saved = await saveData((current) => HardCanonPackService.removeHardCanonItem(current, item.id, project.id))
    if (!saved.ok) return
    setMessage('硬设定条目已删除。')
  }

  return (
    <div className="hard-canon-view">
      <Header
        title="硬设定包"
        description="这里放不能被 AI 改写的硬设定。不要放长篇剧情回顾、临时情绪或普通描写。"
      />

      <div className="hard-canon-layout">
        <aside className="hard-canon-editor">
          <section className="panel hard-canon-draft">
            <div className="panel-title-row">
              <h2>{draft.id ? '编辑硬设定' : '新增硬设定'}</h2>
              {draft.id ? <StatusBadge tone="accent">编辑中</StatusBadge> : null}
            </div>
            <Field label="标题">
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：白塔系统无法删除原始记录" />
            </Field>
            <div className="form-grid">
              <Field label="分类">
                <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as HardCanonItemCategory })}>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {categoryLabels[category]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="优先级">
                <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as HardCanonPriority })}>
                  {priorities.map((priority) => (
                    <option key={priority} value={priority}>
                      {priorityLabels[priority]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="内容">
              <textarea rows={6} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="一句可被检查的硬规则。" />
            </Field>
            <HardCanonCheckEditor draft={condition} onChange={setCondition} characters={scoped.characters} />
            {prepared.duplicates?.exact && <div className="hard-canon-comparison">
              <strong>已有相同规则 · {statusLabels[prepared.duplicates.exact.status]}</strong>
              <span>{prepared.duplicates.exact.title}（{prepared.duplicates.exact.id}）</span>
              <small>{draft.id ? '当前条目不会改写到这个 ID 上。' : '复用不会更改原条目的内容、优先级或启停状态。'}</small>
            </div>}
            {prepared.duplicates && prepared.duplicates.possible.length > 0 && <div className="hard-canon-comparison">
              <strong>可能重复 · 不自动合并</strong>
              {prepared.duplicates.possible.map((item) => <div key={item.id}>
                <span>{item.title} · {statusLabels[item.status]}（{item.id}）</span>
                <p>{item.content}</p>
              </div>)}
            </div>}
            <div className="row-actions">
              <button className="primary-button" onClick={saveItem}>
                {draft.id ? '保存修改' : prepared.duplicates?.exact ? '复用已有条目' : prepared.duplicates?.possible.length ? '另存为独立条目' : '新增条目'}
              </button>
              {draft.id && <button className="ghost-button" onClick={() => edit()}>取消编辑</button>}
            </div>
            {message && <p className="notice hard-canon-message" role="status">{message}</p>}
          </section>

          <section className="panel hard-canon-pack">
            <h2>设定包信息</h2>
            <TextInput label="标题" value={pack.title} debounceMs={500} bufferKey={pack.id} onChange={(title) => saveMeta({ title })} />
            <TextArea label="说明" rows={3} value={pack.description ?? ''} debounceMs={500} bufferKey={pack.id} onChange={(description) => saveMeta({ description })} />
            <Field label="Prompt 预算 token">
              <input
                type="number"
                min={200}
                max={3000}
                value={pack.maxPromptTokens ?? 900}
                onChange={(event) => saveMeta({ maxPromptTokens: Number(event.target.value) || 900 })}
              />
            </Field>
            <p className="hard-canon-budget">
              当前启用 <strong>{promptPreview.itemCount}</strong> 条，估算 <strong>{promptPreview.tokenEstimate}</strong> tokens。
              {promptPreview.truncatedItemIds.length ? ` 已截断 ${promptPreview.truncatedItemIds.length} 条长内容。` : ''}
            </p>
          </section>
        </aside>

        <div className="hard-canon-main">
          <section className="panel">
            <div className="panel-title-row">
              <h2>硬设定条目</h2>
              <span className="hard-canon-count">{sortedItems.length} 条</span>
            </div>
            {!sortedItems.length && <p className="muted">还没有硬设定。建议先添加世界规则、角色身份、不可违背限制或关键时间锚点。</p>}
            <div className="hard-canon-list">
              {sortedItems.map((item) => (
                <article key={item.id} className={`hard-canon-item priority-${item.priority}${item.status !== 'active' ? ' is-inactive' : ''}${draft.id === item.id ? ' is-editing' : ''}`}>
                  <div className="hard-canon-item-header">
                    <div>
                      <strong>{item.title}</strong>
                      <div className="hard-canon-item-tags">
                        <StatusBadge tone={item.priority === 'must' ? 'danger' : item.priority === 'high' ? 'warning' : 'neutral'}>{priorityLabels[item.priority]}</StatusBadge>
                        <StatusBadge tone="info">{categoryLabels[item.category]}</StatusBadge>
                        <StatusBadge tone={item.status === 'active' ? 'success' : 'neutral'}>{statusLabels[item.status]}</StatusBadge>
                        <StatusBadge tone={item.check ? 'info' : 'neutral'}>{item.check ? '可机械核查' : '只作写作提示'}</StatusBadge>
                      </div>
                    </div>
                    <div className="row-actions">
                      <button className="ghost-button" onClick={() => edit(item)}>编辑</button>
                      {item.status === 'active' ? (
                        <button className="ghost-button" onClick={() => setStatus(item, 'inactive')}>停用</button>
                      ) : (
                        <button className="ghost-button" onClick={() => setStatus(item, 'active')}>启用</button>
                      )}
                      <button className="danger-button" onClick={() => removeItem(item)}>删除</button>
                    </div>
                  </div>
                  <p>{item.content}</p>
                  {item.check && <p className="hard-canon-condition">{describeHardCanonCheck(item.check)}</p>}
                  <small>来源：{item.sourceType ?? 'manual'} · 更新：{item.updatedAt}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Prompt 预览</h2>
            <pre className="hard-canon-preview">{promptPreview.body || '暂无启用硬设定，最终正文 prompt 将跳过 HardCanonPack 块。'}</pre>
            {scoped.bible && <p className="muted">完整小说圣经仍保留在后台；HardCanonPack 只放不可违背短规则。</p>}
          </section>
        </div>
      </div>
    </div>
  )
}
