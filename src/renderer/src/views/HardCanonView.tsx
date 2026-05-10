import { useMemo, useState } from 'react'
import type { HardCanonItem, HardCanonItemCategory, HardCanonPriority, HardCanonStatus } from '../../../shared/types'
import { HardCanonPackService } from '../../../services/HardCanonPackService'
import { useConfirm } from '../components/ConfirmDialog'
import { projectData } from '../utils/projectData'
import { now } from '../utils/format'
import type { ProjectProps } from './viewTypes'

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

export function HardCanonView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const pack = HardCanonPackService.getHardCanonPackForProject(data, project.id)
  const promptPreview = useMemo(() => HardCanonPackService.compressHardCanonPackForPrompt(pack), [pack])
  const [draft, setDraft] = useState<HardCanonItem>(() => emptyDraft(project.id))
  const [message, setMessage] = useState('')
  const confirmAction = useConfirm()

  const sortedItems = [...pack.items].sort((a, b) => {
    const statusRank = a.status === 'active' ? 0 : a.status === 'inactive' ? 1 : 2
    const nextStatusRank = b.status === 'active' ? 0 : b.status === 'inactive' ? 1 : 2
    if (statusRank !== nextStatusRank) return statusRank - nextStatusRank
    const priorityRank: Record<HardCanonPriority, number> = { must: 0, high: 1, medium: 2 }
    return priorityRank[a.priority] - priorityRank[b.priority]
  })

  async function saveMeta(patch: Partial<typeof pack>) {
    await saveData((current) => HardCanonPackService.savePackMeta(current, { ...pack, ...patch, updatedAt: now() }))
    setMessage('硬设定包设置已保存。')
  }

  async function saveItem() {
    if (!draft.title.trim() || !draft.content.trim()) {
      setMessage('请填写标题和内容。')
      return
    }
    const timestamp = now()
    await saveData((current) =>
      HardCanonPackService.upsertHardCanonItem(current, {
        ...draft,
        id: draft.id || `hard-canon-item-${timestamp}`,
        projectId: project.id,
        title: draft.title.trim(),
        content: draft.content.trim(),
        createdAt: draft.createdAt || timestamp,
        updatedAt: timestamp
      })
    )
    setDraft(emptyDraft(project.id))
    setMessage('硬设定条目已保存。')
  }

  async function setStatus(item: HardCanonItem, status: HardCanonStatus) {
    await saveData((current) => HardCanonPackService.setHardCanonItemStatus(current, item.id, status))
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
    await saveData((current) => HardCanonPackService.removeHardCanonItem(current, item.id))
    setMessage('硬设定条目已删除。')
  }

  return (
    <div className="view hard-canon-view">
      <header className="view-header">
        <div>
          <p className="eyebrow">Hard Canon</p>
          <h1>硬设定包</h1>
          <p>这里放不能被 AI 改写的硬设定。不要放长篇剧情回顾、临时情绪或普通描写。</p>
        </div>
      </header>

      <section className="grid two">
        <div className="panel">
          <h2>设定包信息</h2>
          <label>
            标题
            <input value={pack.title} onChange={(event) => saveMeta({ title: event.target.value })} />
          </label>
          <label>
            说明
            <textarea rows={3} value={pack.description ?? ''} onChange={(event) => saveMeta({ description: event.target.value })} />
          </label>
          <label>
            Prompt 预算 token
            <input
              type="number"
              min={200}
              max={3000}
              value={pack.maxPromptTokens ?? 900}
              onChange={(event) => saveMeta({ maxPromptTokens: Number(event.target.value) || 900 })}
            />
          </label>
          <p className="muted">
            当前启用 {promptPreview.itemCount} 条，估算 {promptPreview.tokenEstimate} tokens。
            {promptPreview.truncatedItemIds.length ? ` 已截断 ${promptPreview.truncatedItemIds.length} 条长内容。` : ''}
          </p>
          {message && <p className="status-line">{message}</p>}
        </div>

        <div className="panel">
          <h2>{draft.id ? '编辑硬设定' : '新增硬设定'}</h2>
          <label>
            标题
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label>
            分类
            <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as HardCanonItemCategory })}>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {categoryLabels[category]}
                </option>
              ))}
            </select>
          </label>
          <label>
            优先级
            <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as HardCanonPriority })}>
              {priorities.map((priority) => (
                <option key={priority} value={priority}>
                  {priorityLabels[priority]}
                </option>
              ))}
            </select>
          </label>
          <label>
            内容
            <textarea rows={6} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
          </label>
          <div className="button-row">
            <button className="primary" onClick={saveItem}>
              {draft.id ? '保存修改' : '新增条目'}
            </button>
            {draft.id && <button onClick={() => setDraft(emptyDraft(project.id))}>取消编辑</button>}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>硬设定条目</h2>
        {!sortedItems.length && <p className="muted">还没有硬设定。建议先添加世界规则、角色身份、不可违背限制或关键时间锚点。</p>}
        <div className="list-stack">
          {sortedItems.map((item) => (
            <article key={item.id} className={`list-card ${item.status !== 'active' ? 'muted-card' : ''}`}>
              <div className="list-card-header">
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {categoryLabels[item.category]} · {priorityLabels[item.priority]} · {statusLabels[item.status]}
                  </span>
                </div>
                <div className="button-row">
                  <button onClick={() => setDraft(item)}>编辑</button>
                  {item.status === 'active' ? (
                    <button onClick={() => setStatus(item, 'inactive')}>停用</button>
                  ) : (
                    <button onClick={() => setStatus(item, 'active')}>启用</button>
                  )}
                  <button className="danger" onClick={() => removeItem(item)}>删除</button>
                </div>
              </div>
              <p>{item.content}</p>
              <small>来源：{item.sourceType ?? 'manual'} · 更新：{item.updatedAt}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Prompt 预览</h2>
        <pre className="output-box">{promptPreview.body || '暂无启用硬设定，最终正文 prompt 将跳过 HardCanonPack 块。'}</pre>
        {scoped.bible && <p className="muted">完整小说圣经仍保留在后台；HardCanonPack 只放不可违背短规则。</p>}
      </section>
    </div>
  )
}
