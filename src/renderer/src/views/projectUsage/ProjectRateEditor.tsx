import { useRef, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Project } from '../../../../shared/types'
import type { ProjectModelRate } from '../../../../shared/projectUsage'
import { normalizeProjectModelRates } from '../../../../shared/projectUsagePricing'
import { now } from '../../utils/format'
import type { SaveDataHandler } from '../../utils/saveDataState'

type Prices = 'inputPerMillionTokens' | 'outputPerMillionTokens' | 'cachedInputPerMillionTokens'
type RateRow = Omit<ProjectModelRate, Prices> & Record<Prices, string> & { id: number }
const blank = (id: number): RateRow => ({ id, provider: 'compatible', endpoint: '', model: '', currency: '',
  inputPerMillionTokens: '', outputPerMillionTokens: '', cachedInputPerMillionTokens: '' })
const priceFields = [['inputPerMillionTokens', '输入价'], ['outputPerMillionTokens', '输出价'],
  ['cachedInputPerMillionTokens', '缓存输入价（可选）']] as const

export function ProjectRateEditor({ project, saveData, onClose }: {
  project: Project; saveData: SaveDataHandler; onClose: (saved: boolean) => void
}) {
  const [original] = useState(() => normalizeProjectModelRates(project.modelRates))
  const [rows, setRows] = useState<RateRow[]>(() => original.map((r, id) => ({ ...r, id,
    inputPerMillionTokens: String(r.inputPerMillionTokens), outputPerMillionTokens: String(r.outputPerMillionTokens),
    cachedInputPerMillionTokens: r.cachedInputPerMillionTokens?.toString() ?? '' })))
  const nextId = useRef(rows.length)
  const saving = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const patch = (id: number, fields: Partial<RateRow>) => {
    setError('')
    setRows(current => current.map(r => r.id === id ? { ...r, ...fields } : r))
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    const rates: ProjectModelRate[] = []
    for (const [index, r] of rows.entries()) {
      const [rate] = normalizeProjectModelRates([{ ...r,
        inputPerMillionTokens: r.inputPerMillionTokens.trim() ? Number(r.inputPerMillionTokens) : undefined,
        outputPerMillionTokens: r.outputPerMillionTokens.trim() ? Number(r.outputPerMillionTokens) : undefined,
        cachedInputPerMillionTokens: r.cachedInputPerMillionTokens.trim() ? Number(r.cachedInputPerMillionTokens) : undefined }])
      if (!rate) { setError(`第 ${index + 1} 条价目无效。请核对服务地址、模型名称、三位币种代码和非负单价；不要输入凭据。`); return }
      if (rates.some(prev => prev.provider === rate.provider && prev.endpoint === rate.endpoint && prev.model === rate.model)) {
        setError(`第 ${index + 1} 条重复：同一提供方、来源地址和模型只能有一条价目。`); return
      }
      rates.push(rate)
    }
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const result = await saveData(current => {
        const latest = current.projects.find(p => p.id === project.id)
        if (!latest) throw new Error('项目已移除，请返回项目列表。')
        const { modelRates: previous, ...metadata } = latest
        if (JSON.stringify(normalizeProjectModelRates(previous)) !== JSON.stringify(original)) {
          throw new Error('本书价目已被更新。请取消后重新打开价目。')
        }
        const updated = { ...metadata, ...(rates.length ? { modelRates: rates } : {}), updatedAt: now() }
        return { ...current, projects: current.projects.map(p => p.id === latest.id ? updated : p) }
      })
      if (result.ok) onClose(true)
      else setError(result.errorMessage)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存价目失败，请重试。') }
    finally { saving.current = false; setBusy(false) }
  }

  return <form className="usage-rate-editor" aria-label="本书模型价目" onSubmit={save}>
    <p>单价按每百万 token 填写。缓存输入价留空时沿用输入价。服务地址只保存协议、主机和端口。</p>
    {rows.map((r, index) => <fieldset key={r.id} disabled={busy}>
      <legend>价目 {index + 1}</legend>
      <div className="usage-rate-fields">
        <label>提供方<select value={r.provider} onChange={e => patch(r.id, { provider: e.target.value as RateRow['provider'] })}>
          <option value="compatible">兼容服务</option><option value="openai">OpenAI</option><option value="local">本地服务</option>
          {r.provider === 'codex_cli' && <option value="codex_cli">Codex CLI（订阅）</option>}
        </select></label>
        <label>服务地址<input type="url" required value={r.endpoint} placeholder="https://host.example"
          onChange={e => patch(r.id, { endpoint: e.target.value })} /></label>
        <label>模型名称<input required maxLength={128} value={r.model} onChange={e => patch(r.id, { model: e.target.value })} /></label>
        <label>币种<input required maxLength={3} value={r.currency} placeholder="如 CNY" onChange={e => patch(r.id, { currency: e.target.value.toUpperCase() })} /></label>
        {priceFields.map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="any"
          required={key !== 'cachedInputPerMillionTokens'} value={r[key]} onChange={e => patch(r.id, { [key]: e.target.value })} /></label>)}
        <button type="button" className="usage-icon" aria-label={`移除价目 ${index + 1}`} title="移除这条价目"
          onClick={() => { setRows(current => current.filter(item => item.id !== r.id)); setError('') }}><Trash2 size={16} /></button>
      </div>
    </fieldset>)}
    <div className="row-actions">
      <button type="button" className="ghost-button" disabled={busy}
        onClick={() => { const row = blank(nextId.current++); setRows(current => [...current, row]) }}><Plus size={15} />添加价目</button>
      <button className="primary-button" disabled={busy} type="submit">{busy ? '正在保存…' : '保存价目'}</button>
      <button type="button" className="ghost-button" disabled={busy} onClick={() => onClose(false)}>取消</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </form>
}
