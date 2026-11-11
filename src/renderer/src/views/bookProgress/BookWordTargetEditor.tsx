import { useRef, useState, type FormEvent } from 'react'
import type { Project } from '../../../../shared/types'
import { normalizeBookWordTarget } from '../../../../shared/normalizers/bookWordTarget'
import type { SaveDataHandler } from '../../utils/saveDataState'
import { now } from '../../utils/format'

type Target = Project['bookWordTarget']
const sameTarget = (a: Target, b: Target) => a?.min === b?.min && a?.max === b?.max

export function BookWordTargetEditor({ project, saveData, onClose }: {
  project: Project; saveData: SaveDataHandler; onClose: () => void
}) {
  const [original] = useState(() => normalizeBookWordTarget(project.bookWordTarget))
  const [min, setMin] = useState(original?.min?.toString() ?? '')
  const [max, setMax] = useState(original?.max?.toString() ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    const lower = min === '' ? undefined : Number(min)
    const upper = max === '' ? undefined : Number(max)
    const target = normalizeBookWordTarget({ min: lower, max: upper })
    if ((min || max) && !target) {
      setError(lower !== undefined && upper !== undefined && lower > upper
        ? '目标下限不能高于上限。' : '字数须为正整数；不设的一项可以留空。')
      return
    }
    if (sameTarget(original, target)) { onClose(); return }
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const result = await saveData((current) => {
        const latest = current.projects.find((item) => item.id === project.id)
        if (!latest) throw new Error('项目已移除，请返回项目列表。')
        const { bookWordTarget: previous, ...metadata } = latest
        if (!sameTarget(normalizeBookWordTarget(previous), original)) {
          throw new Error('全书目标已变更，请取消后重新编辑。')
        }
        const updated = { ...metadata, ...(target ? { bookWordTarget: target } : {}), updatedAt: now() }
        return { ...current, projects: current.projects.map((item) => item === latest ? updated : item) }
      })
      if (result.ok) onClose()
      else setError(result.errorMessage)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '目标保存失败，请重试。')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return <form className="book-progress-form book-target-editor" aria-label="编辑全书目标" onSubmit={save}>
    <label>目标下限（字）<input type="number" min="1" step="1" placeholder="不限" autoFocus
      value={min} disabled={busy} onChange={(e) => { setMin(e.target.value); setError('') }} /></label>
    <label>目标上限（字）<input type="number" min="1" step="1" placeholder="不限"
      value={max} disabled={busy} onChange={(e) => { setMax(e.target.value); setError('') }} /></label>
    <button type="submit" className="primary-button" disabled={busy}>{busy ? '正在保存…' : '保存目标'}</button>
    <button type="button" className="ghost-button" disabled={busy} onClick={onClose}>取消</button>
    {(min || max) && <button type="button" className="book-progress-link" disabled={busy}
      onClick={() => { setMin(''); setMax(''); setError('') }}>清空目标</button>}
    {error && <p role="alert">{error}</p>}
  </form>
}
