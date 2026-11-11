import { useEffect, useRef, useState } from 'react'
import { Check, Eye, X } from 'lucide-react'
import type { Chapter, ChapterTitlePrefixMode, ChapterTitlePreview, ChapterTitleRename } from '../../../../shared/types'
import { applyTitleReceiptToChapters } from '../../../../shared/chapterTitleHistory'
import { getUserFriendlyError } from '../../../../shared/errorUtils'
import { isStorageRevisionConflict } from '../../../../shared/storageRevisionConflict'
import { getNovelDirectorDataApi } from '../../platform/novelDirectorBridge'
import type { RunPersistedStorageOperation } from '../../utils/saveDataState'
import { newId } from '../../utils/format'
import './chapter-titles.css'

interface Props {
  chapters: Chapter[]
  singleId: string | null
  projectId: string
  blocked: boolean
  run: RunPersistedStorageOperation
  onClose: (message?: string) => void
}

export function ChapterTitleDialog({ chapters, singleId, projectId, blocked, run, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), pending = useRef(false)
  // Freeze the editing baseline. The preview must not silently rebase hand-entered titles.
  const [original] = useState(() => chapters.map(({ id, order, title }) => ({ id, order, title })))
  const [from, setFrom] = useState(String(original[0]?.order ?? 1))
  const [to, setTo] = useState(String(original.at(-1)?.order ?? 1))
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [titles, setTitles] = useState<Map<string, string>>(() => new Map())
  const [mode, setMode] = useState<ChapterTitlePrefixMode>(singleId ? 'manual' : 'strip')
  const [review, setReview] = useState<{ command: ChapterTitleRename; preview: ChapterTitlePreview } | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const range = singleId ? original.filter(c => c.id === singleId) : original.filter(c => c.order >= Number(from) && c.order <= Number(to))
  const chosen = range.filter(c => !excluded.has(c.id))
  const validRange = singleId || (Number.isSafeInteger(+from) && +from > 0 && Number.isSafeInteger(+to) && +from <= +to)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  function edited(change: () => void) { change(); setReview(null); setError('') }
  async function act(commit: boolean) {
    if (pending.current || blocked || !validRange || !chosen.length) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const api = getNovelDirectorDataApi()
      if (!commit) {
        const command: ChapterTitleRename = { projectId, operationId: newId(), prefixMode: mode, edits: chosen.map(c => ({
          chapterId: c.id, ...(titles.has(c.id) || mode === 'manual' ? { title: titles.get(c.id) ?? c.title } : {})
        })) }
        const { preview } = await run(async () => ({ preview: await api.previewChapterTitleRename(command), data: undefined }))
        const byId = new Map(chosen.map(c => [c.id, c]))
        if (preview.rows.some(r => byId.get(r.chapterId)?.title !== r.oldTitle || byId.get(r.chapterId)?.order !== r.chapterOrder)) {
          throw new Error('正式章名或章号已变化，请关闭改名窗口，重新选择章节。')
        }
        setReview({ command, preview })
      } else if (review?.preview.previewHash && review.preview.changedCount) {
        const { command, preview } = review, expectedPreviewHash = preview.previewHash!
        const result = await run(async current => {
          const saved = await api.applyChapterTitleRename({ command, expectedPreviewHash, expectedRevision: preview.expectedRevision })
          return { ...saved, data: saved.replayed ? undefined : { ...current,
            chapters: applyTitleReceiptToChapters(current.chapters, saved.receipt),
            chapterTitleReceipts: [...current.chapterTitleReceipts, saved.receipt] } }
        })
        onClose(result.replayed ? '这批章名已提交，没有重复写入。' : `已更改 ${preview.changedCount} 个正式章名。`)
      }
    } catch (e) {
      setError(getUserFriendlyError(e))
      // Keep the original operation available for retry after an uncertain transport failure.
      if (isStorageRevisionConflict(e)) setReview(null)
    } finally { pending.current = false; setBusy(false) }
  }

  return <dialog ref={dialog} className="chapter-title-dialog" aria-labelledby="chapter-title-heading"
    onCancel={e => { e.preventDefault(); if (!pending.current) onClose() }}>
    <header><h2 id="chapter-title-heading">{singleId ? '更改本章标题' : '批量更改章名'}</h2>
      <button type="button" className="ghost-button" aria-label="关闭改名窗口" title="关闭" disabled={busy} onClick={() => onClose()}><X size={17} /></button>
    </header>
    <fieldset disabled={busy}>
      <div className="chapter-title-filters">
        {!singleId && <><label>起始章<input type="number" min="1" value={from} onChange={e => edited(() => setFrom(e.target.value))} /></label>
          <label>结束章<input type="number" min="1" value={to} onChange={e => edited(() => setTo(e.target.value))} /></label></>}
        <label>章号前缀<select value={mode} onChange={e => edited(() => setMode(e.target.value as ChapterTitlePrefixMode))}>
          <option value="manual">按手动输入</option><option value="keep">保留原章号前缀</option><option value="strip">去除章号前缀</option>
        </select></label>
      </div>
      <div className="chapter-title-grid"><table><thead><tr><th>章号</th><th>旧标题</th><th>拟用标题</th></tr></thead>
        <tbody>{range.map(c => <tr key={c.id}><td><label>{!singleId && <input type="checkbox" aria-label={`选择第 ${c.order} 章`}
          checked={!excluded.has(c.id)} onChange={() => edited(() => setExcluded(prev => {
            const next = new Set(prev); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next
          }))} />}{c.order}</label></td><td>{c.title || '（空）'}</td>
          <td><input aria-label={`第 ${c.order} 章拟用标题`} disabled={excluded.has(c.id)} value={titles.get(c.id) ?? c.title}
            onChange={e => edited(() => setTitles(new Map(titles).set(c.id, e.target.value)))} /></td></tr>)}</tbody></table></div>
      {!validRange || !chosen.length ? <p role="status">请选择有效章段和至少一章。</p> : null}
      {review && <section className="chapter-title-preview" aria-label="改名预览">
        <h3>改名预览</h3><p>{review.preview.authorization.actor.kind === 'user' ? '作者本人确认' : 'Agent 项目授权'} · 已选 {review.preview.rows.length} 章，实际改动 {review.preview.changedCount} 章</p>
        <details><summary>核对权限与数据版本</summary>
          <p>管理章节：{review.preview.authorization.authorized ? '允许提交本批改名' : '未获授权'}</p>
          <p>预览时的数据版本：<code>{review.preview.expectedRevision}</code></p>
        </details>
        <div className="chapter-title-grid"><table><thead><tr><th>章号</th><th>旧标题</th><th>新标题</th></tr></thead>
          <tbody>{review.preview.rows.map(r => <tr key={r.chapterId}><td>{r.chapterOrder}</td><td>{r.oldTitle || '（空）'}</td><td>{r.newTitle}</td></tr>)}</tbody></table></div>
      </section>}
      {error && <p role="alert">{error}</p>}
      {blocked && <p role="alert">请先处理未保存的章节表单或数据冲突。</p>}
      <footer className="row-actions">
        <button type="button" className="ghost-button" onClick={() => onClose()}>取消</button>
        <button type="button" className="secondary-button" disabled={blocked || !validRange || !chosen.length} onClick={() => void act(false)}><Eye size={15} />预览改名</button>
        <button type="button" className="primary-button" disabled={blocked || !review?.preview.previewHash || !review.preview.changedCount}
          onClick={() => void act(true)}><Check size={15} />确认提交改名</button>
      </footer>
    </fieldset>
  </dialog>
}
