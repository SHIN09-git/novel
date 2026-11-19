import { useEffect, useState } from 'react'
import { BookPlus } from 'lucide-react'
import type { AgentAuthorizationGrant } from '../../../../shared/types/agentAuthorization'
import type { Project } from '../../../../shared/types'
import { useConfirm } from '../../components/ConfirmDialog'
import { getNovelDirectorAgentAuthorizationApi } from '../../platform/novelDirectorBridge'

export function AgentBookCreationPanel({ projects }: { projects: Project[] }) {
  const api = getNovelDirectorAgentAuthorizationApi()
  const ask = useConfirm()
  const [grants, setGrants] = useState<AgentAuthorizationGrant[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!api?.listBookCreationGrants) return
    let current = true
    void api.listBookCreationGrants().then(result => {
      if (current) setGrants(result)
    }).catch(reason => {
      if (current) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [api])

  if (!api?.listBookCreationGrants) return null

  async function changeGrant(grant?: AgentAuthorizationGrant) {
    if (!api || busy) return
    const allowed = await ask(grant ? {
      title: '撤回开书授权',
      message: '撤回后 Agent 不能再凭这条授权创建或修改该书。已经提交的内容不受影响。',
      confirmLabel: '撤回授权', tone: 'danger'
    } : {
      title: '授权 Agent 开一本新书',
      message: 'Agent 可以创建一本新书，并自行写作、改设定、审稿和提交。每章都要通过质量门禁；授权不包含其他项目。',
      confirmLabel: '授予开书权'
    })
    if (!allowed) return
    setBusy(true)
    setError('')
    try {
      if (grant) {
        await api.revoke({ purpose: 'book_creation', projectId: grant.projectId, grantId: grant.id })
      } else await api.grant({ purpose: 'book_creation' })
      setGrants(await api.listBookCreationGrants())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return <section className="home-project-form">
    <div className="row-actions">
      <button className="ghost-button" type="button" onClick={() => void changeGrant()} disabled={busy}>
        <BookPlus size={16} aria-hidden="true" /> 授权 Agent 开书
      </button>
    </div>
    {grants.filter(grant => grant.status === 'active').map(grant => {
      const name = projects.find(project => project.id === grant.projectId)?.name
      return <div className="row-actions" key={grant.id}>
        <span>{name || '待 Agent 开书'}</span>
        <button className="ghost-button" type="button" disabled={busy} onClick={() => void changeGrant(grant)}>撤回</button>
      </div>
    })}
    {error ? <p className="notice danger" role="alert">{error}</p> : null}
  </section>
}
