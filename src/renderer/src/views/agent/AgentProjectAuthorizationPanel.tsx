import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfirm } from '../../components/ConfirmDialog'
import { getNovelDirectorAgentAuthorizationApi } from '../../platform/novelDirectorBridge'
import type {
  AgentAuthorizationAction,
  AgentAuthorizationGrant
} from '../../../../shared/types/agentAuthorization'
import { AGENT_AUTHORIZATION_ACTIONS } from '../../../../shared/types/agentAuthorization'
import { formatDate } from '../../utils/format'

const ACTION_LABELS: Record<AgentAuthorizationAction, string> = {
  edit_world: '编辑世界观与长期设定',
  accept_high_risk_candidates: '接受高风险候选',
  accept_unreviewed_draft: '接受未经审阅草稿',
  accept_draft: '接受草稿',
  apply_revision: '应用修订',
  manage_chapters: '管理章节',
  edit_chapter_task: '编辑章节任务'
}

const HIGH_RISK_ACTIONS = new Set<AgentAuthorizationAction>([
  'edit_world',
  'accept_high_risk_candidates',
  'accept_unreviewed_draft'
])

interface AgentProjectAuthorizationPanelProps {
  projectId: string
  chapterOrders: number[]
  dataIdentity: object
}

export function formatAuthorizationRange(grant: AgentAuthorizationGrant): string {
  if (grant.chapterStart === null && grant.chapterEnd === null) return '全部章节'
  if (grant.chapterStart === null) return `截至第 ${grant.chapterEnd} 章`
  if (grant.chapterEnd === null) return `第 ${grant.chapterStart} 章起`
  if (grant.chapterStart === grant.chapterEnd) return `第 ${grant.chapterStart} 章`
  return `第 ${grant.chapterStart}-${grant.chapterEnd} 章`
}

export function isAuthorizationContextCurrent(
  current: { projectId: string; dataIdentity: object },
  expected: { projectId: string; dataIdentity: object }
): boolean {
  return current.projectId === expected.projectId && current.dataIdentity === expected.dataIdentity
}

export type AuthorizationRangeResult =
  | { ok: true; chapterStart: number | null; chapterEnd: number | null }
  | { ok: false; error: string }

export function parseAuthorizationRange(scope: 'all' | 'range', chapterStart: string, chapterEnd: string): AuthorizationRangeResult {
  if (scope === 'all') return { ok: true, chapterStart: null, chapterEnd: null }
  const start = Number(chapterStart)
  const end = Number(chapterEnd)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end <= 0 || start > end) {
    return { ok: false, error: '请填写有效的章节范围，起始章不能大于结束章。' }
  }
  return { ok: true, chapterStart: start, chapterEnd: end }
}

export function toggleAuthorizationAction(
  current: readonly AgentAuthorizationAction[],
  action: AgentAuthorizationAction
): AgentAuthorizationAction[] {
  const selected = new Set(current)
  if (selected.has(action)) {
    selected.delete(action)
    if (action === 'accept_draft') selected.delete('accept_unreviewed_draft')
  } else {
    selected.add(action)
    if (action === 'accept_unreviewed_draft') selected.add('accept_draft')
  }
  return AGENT_AUTHORIZATION_ACTIONS.filter((item) => selected.has(item))
}

export function validateAuthorizationSelection(actions: readonly AgentAuthorizationAction[], scope: 'all' | 'range'): string | null {
  if (scope === 'range' && actions.includes('edit_world')) {
    return '“编辑世界观与长期设定”是项目全局资料，请将章节范围改为“全部章节”后再授予。'
  }
  return null
}

export function AgentProjectAuthorizationPanel({ projectId, chapterOrders, dataIdentity }: AgentProjectAuthorizationPanelProps) {
  const confirmAction = useConfirm()
  const api = getNovelDirectorAgentAuthorizationApi()
  const [expanded, setExpanded] = useState(false)
  const [grants, setGrants] = useState<AgentAuthorizationGrant[]>([])
  const [selectedActions, setSelectedActions] = useState<AgentAuthorizationAction[]>([])
  const [scope, setScope] = useState<'all' | 'range'>('all')
  const [chapterStart, setChapterStart] = useState('')
  const [chapterEnd, setChapterEnd] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [unavailable, setUnavailable] = useState(!api)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const activeContextRef = useRef({ projectId, dataIdentity })
  activeContextRef.current = { projectId, dataIdentity }

  const sortedChapterOrders = useMemo(
    () => [...new Set(chapterOrders)].sort((a, b) => a - b),
    [chapterOrders]
  )

  useEffect(() => {
    let cancelled = false
    setGrants([])
    setSelectedActions([])
    setScope('all')
    setChapterStart('')
    setChapterEnd('')
    setSubmitting(false)
    setLoading(true)
    setError('')
    setMessage('')
    if (!api) {
      setUnavailable(true)
      setLoading(false)
      return () => { cancelled = true }
    }
    setUnavailable(false)
    void api.list(projectId)
      .then((result) => {
        if (!cancelled) setGrants(result)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [api, projectId, dataIdentity])

  function toggleAction(action: AgentAuthorizationAction) {
    setSelectedActions((current) => toggleAuthorizationAction(current, action))
  }

  async function grant() {
    const operationContext = activeContextRef.current
    setError('')
    setMessage('')
    if (!api || selectedActions.length === 0) return
    const selectionError = validateAuthorizationSelection(selectedActions, scope)
    if (selectionError) {
      setError(selectionError)
      return
    }
    const range = parseAuthorizationRange(scope, chapterStart, chapterEnd)
    if (!range.ok) {
      setError(range.error)
      return
    }
    const { chapterStart: start, chapterEnd: end } = range
    const rangeDescription = scope === 'all' ? '全部章节' : `第 ${start}-${end} 章`
    const highRisk = selectedActions.filter((action) => HIGH_RISK_ACTIONS.has(action)).map((action) => ACTION_LABELS[action])
    const confirmed = await confirmAction({
      title: '授予项目授权',
      message: `将向 Agent 授予${rangeDescription}的以下权限：${selectedActions.map((action) => ACTION_LABELS[action]).join('、')}。${highRisk.length ? `其中包含高风险动作：${highRisk.join('、')}。` : ''}授权会写入当前项目的数据源绑定记录。`,
      confirmLabel: '授予授权'
    })
    if (!confirmed) return
    if (!isAuthorizationContextCurrent(activeContextRef.current, operationContext)) return
    setSubmitting(true)
    try {
      const created = await api.grant({
        projectId,
        actions: selectedActions,
        chapterStart: start,
        chapterEnd: end
      })
      if (isAuthorizationContextCurrent(activeContextRef.current, operationContext)) {
        setGrants((current) => [created, ...current])
        setSelectedActions([])
        setMessage('项目授权已授予。')
      }
    } catch (grantError) {
      if (isAuthorizationContextCurrent(activeContextRef.current, operationContext)) {
        setError(grantError instanceof Error ? grantError.message : String(grantError))
      }
    } finally {
      if (isAuthorizationContextCurrent(activeContextRef.current, operationContext)) setSubmitting(false)
    }
  }

  async function revoke(grantItem: AgentAuthorizationGrant) {
    if (!api) return
    const operationContext = activeContextRef.current
    const confirmed = await confirmAction({
      title: '撤回项目授权',
      message: `确定撤回${formatAuthorizationRange(grantItem)}的授权吗？Agent 将不能再使用这条授权。`,
      confirmLabel: '撤回授权',
      tone: 'danger'
    })
    if (!confirmed) return
    if (!isAuthorizationContextCurrent(activeContextRef.current, operationContext)) return
    setSubmitting(true)
    setError('')
    try {
      const revoked = await api.revoke({ projectId, grantId: grantItem.id })
      if (!revoked) {
        if (isAuthorizationContextCurrent(activeContextRef.current, operationContext)) setError('这条授权已不存在或不属于当前项目。')
        return
      }
      if (isAuthorizationContextCurrent(activeContextRef.current, operationContext)) {
        setGrants((current) => current.map((item) => item.id === revoked.id ? revoked : item))
        setMessage('项目授权已撤回。')
      }
    } catch (revokeError) {
      if (isAuthorizationContextCurrent(activeContextRef.current, operationContext)) {
        setError(revokeError instanceof Error ? revokeError.message : String(revokeError))
      }
    } finally {
      if (isAuthorizationContextCurrent(activeContextRef.current, operationContext)) setSubmitting(false)
    }
  }

  return (
    <section className="agent-authorization-panel">
      <div className="agent-authorization-header">
        <div>
          <h2>项目授权</h2>
          <p>授权范围内可连续执行，超出范围再由作者决定；撤回不删除已提交版本。</p>
        </div>
        <div className="row-actions">
          {unavailable ? <span className="status-badge warning">授权接口不可用</span> : null}
          <button className="ghost-button" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
            {expanded ? '收起' : '展开'}
          </button>
        </div>
      </div>

      {expanded ? (
        unavailable ? (
          <p className="notice warning">当前应用桥接不支持项目授权，已安全停用此面板。请更新应用后再使用。</p>
        ) : (
          <div className="agent-authorization-body">
            <div className="agent-authorization-form">
              <div className="agent-authorization-actions">
                <strong>允许 Agent 执行的动作</strong>
                <div className="agent-authorization-checkboxes">
                  {AGENT_AUTHORIZATION_ACTIONS.map((action) => (
                    <label key={action} className="toggle agent-authorization-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedActions.includes(action)}
                        onChange={() => toggleAction(action)}
                      />
                      <span>{ACTION_LABELS[action]}</span>
                      {HIGH_RISK_ACTIONS.has(action) ? <small>高风险</small> : null}
                      {action === 'accept_unreviewed_draft' ? <small className="agent-authorization-dependency">需同时允许“接受草稿”</small> : null}
                    </label>
                  ))}
                </div>
              </div>

              <div className="agent-authorization-scope">
                <strong>授权章节范围</strong>
                <label className="toggle">
                  <input type="radio" name={`agent-authorization-scope-${projectId}`} checked={scope === 'all'} onChange={() => setScope('all')} />
                  全部章节
                </label>
                <label className="toggle">
                  <input type="radio" name={`agent-authorization-scope-${projectId}`} checked={scope === 'range'} onChange={() => setScope('range')} />
                  指定范围
                </label>
                {scope === 'range' ? (
                  <div className="agent-authorization-range">
                    <label className="field">
                      <span className="field-label">起始章</span>
                      <input type="number" min="1" value={chapterStart} onChange={(event) => setChapterStart(event.target.value)} />
                    </label>
                    <label className="field">
                      <span className="field-label">结束章</span>
                      <input type="number" min="1" value={chapterEnd} onChange={(event) => setChapterEnd(event.target.value)} />
                    </label>
                  </div>
                ) : null}
                <p className="muted">没有具体章节序号的全局资料编辑，需要选择“全部章节”授权。当前项目已有章节：{sortedChapterOrders.length ? sortedChapterOrders.join('、') : '暂无'}。</p>
              </div>

              <div className="row-actions agent-authorization-submit">
                <button className="primary-button" type="button" disabled={submitting || loading || selectedActions.length === 0} onClick={() => void grant()}>授予授权</button>
                {!selectedActions.length ? <span className="muted">请选择至少一项动作，系统不会自动勾选全部。</span> : null}
              </div>
            </div>

            {message ? <p className="notice">{message}</p> : null}
            {error ? <p className="notice danger">授权操作失败：{error}</p> : null}
            <div className="agent-authorization-list">
              <div className="panel-title-row">
                <strong>当前与历史授权</strong>
                {loading ? <span className="muted">正在读取...</span> : null}
              </div>
              {grants.length ? grants.map((grantItem) => (
                <article key={grantItem.id} className={`agent-authorization-row ${grantItem.status === 'revoked' ? 'revoked' : ''}`}>
                  <div>
                    <strong>{formatAuthorizationRange(grantItem)}</strong>
                    <p>{grantItem.actions.map((action) => ACTION_LABELS[action]).join('、')}</p>
                    <small>{grantItem.status === 'active' ? `授予于 ${formatDate(grantItem.createdAt)}` : `已撤回于 ${formatDate(grantItem.revokedAt ?? grantItem.updatedAt)}`}</small>
                  </div>
                  {grantItem.status === 'active' ? <button className="ghost-button danger-text" type="button" disabled={submitting} onClick={() => void revoke(grantItem)}>撤回</button> : <span className="status-badge neutral">已撤回</span>}
                </article>
              )) : <p className="muted">暂无授权。Agent 不会因此获得任何额外权限。</p>}
            </div>
          </div>
        )
      ) : null}
    </section>
  )
}
