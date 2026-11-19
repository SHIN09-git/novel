import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { AgentLibraryGrant } from '../../../../shared/types/agentAuthorization'
import { useConfirm } from '../../components/ConfirmDialog'
import { getNovelDirectorAgentAuthorizationApi } from '../../platform/novelDirectorBridge'
import { formatDate } from '../../utils/format'

export function AgentLibraryAuthorizationPanel() {
  const api = getNovelDirectorAgentAuthorizationApi()
  const ask = useConfirm()
  const [authorization, setAuthorization] = useState<AgentLibraryGrant | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!api?.getLibraryAuthorization) return
    let current = true
    void api.getLibraryAuthorization().then(grant => {
      if (current) setAuthorization(grant)
    }).catch(reason => {
      if (current) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [api])
  if (!api?.getLibraryAuthorization || !api.grantLibrary || !api.revokeLibrary) return null

  async function changeAuthorization() {
    if (!api || busy || loading) return
    setBusy(true)
    setError('')
    try {
      const agreed = await ask(authorization ? {
        title: '撤回全库管理权',
        message: 'Agent 将不能再凭此授权修改书库。已有的单书授权和已提交改动不受影响。',
        confirmLabel: '撤回授权', tone: 'danger'
      } : {
        title: '授予 Agent 全库管理权',
        message: 'Agent 可管理当前书库的现有和未来作品，包括开书、修改和可恢复归档。正文仍须逐章审稿、通过质量门禁再提交。此权限不包含永久删除和应用设置。',
        confirmLabel: '授予全库管理权'
      })
      if (!agreed) return
      if (authorization) {
        await api.revokeLibrary(authorization.id)
        setAuthorization(await api.getLibraryAuthorization())
      } else setAuthorization(await api.grantLibrary())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return <section className="home-library-authorization" aria-label="Agent 全库管理权">
    <div>
      <strong>Agent 全库管理权</strong>
      <small>{loading ? '正在读取…' : authorization ? `已授权 · ${formatDate(authorization.createdAt)}` : '未授权'}</small>
    </div>
    <button className="ghost-button" type="button" disabled={loading || busy} onClick={() => void changeAuthorization()}>
      <ShieldCheck size={16} aria-hidden="true" />
      {authorization ? '撤回全库管理权' : '授予全库管理权'}
    </button>
    {error ? <p className="notice danger" role="alert">{error}</p> : null}
  </section>
}
