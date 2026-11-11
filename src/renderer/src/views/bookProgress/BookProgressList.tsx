import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AppData, ID } from '../../../../shared/types'
import {
  createBookProgressReader, type BookChapterRange, type BookProgressOptions, type BookProgressRow
} from '../../../../services/BookProgressService'
import { StatusBadge, type BadgeTone } from '../../components/UI'
import { formatDate } from '../../utils/format'
import { locateBookProgressSource, type BookProgressNavigation, type BookProgressSource } from './navigation'

const PAGE_SIZE = 25
const statuses: Record<BookProgressRow['status'], [string, BadgeTone]> = {
  committed: ['已正式写回', 'success'], historical: ['历史正文', 'neutral'], empty: ['空章', 'warning'],
  draft_only: ['仅有草稿', 'info'], missing: ['缺章', 'warning'], archived: ['已归档', 'neutral'],
  writeback_failed: ['写回失败', 'danger']
}
const interval = (from: number, to: number) => from === to ? `第 ${from} 章` : `第 ${from} 至 ${to} 章`

function Ranges({ label, ranges, onSelect }: {
  label: string; ranges: BookChapterRange[]; onSelect: (r: BookChapterRange) => void
}) {
  const [shown, setShown] = useState(4)
  return <div className="book-progress-ranges">
    <span>{label}</span>
    {ranges.length ? ranges.slice(0, shown).map((r) => <button type="button" key={r.from}
      className="book-progress-link" onClick={() => onSelect(r)}>{interval(r.from, r.to)}</button>) : <strong>无</strong>}
    {ranges.length > shown && <button type="button" className="book-progress-link" onClick={() => setShown(shown + 8)}>
      更多章段（余 {ranges.length - shown} 段）</button>}
  </div>
}

function RowState({ row }: { row: BookProgressRow }) {
  const [label, tone] = statuses[row.status]
  const failure = row.writebackFailure
  return <>
    <StatusBadge tone={tone}>{label}</StatusBadge>
    {failure && <>
      <small>{row.manuscriptStatus === 'committed' ? '书中保留：此前已写回的正文'
        : row.manuscriptStatus === 'historical' ? '书中保留：历史正文' : `书中现状：${statuses[row.manuscriptStatus][0]}`}</small>
      <details className="book-progress-failure">
        <summary>{failure.kind === 'revision_commit' ? '修订' : '草稿'}写回详情</summary>
        <time dateTime={failure.attemptedAt}>{formatDate(failure.attemptedAt)}</time>
        <p>{failure.reason}</p>
      </details>
    </>}
  </>
}

export default function BookProgressList({ data, projectId, onOpenChapter, onOpenSource }:
BookProgressNavigation & { data: AppData; projectId: ID }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [filter, setFilter] = useState<BookProgressOptions>({})
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState<number | null>(null)
  const readPage = useMemo(() => createBookProgressReader(data, projectId), [data, projectId])
  const report = useMemo(() => readPage({ ...filter, offset, limit: PAGE_SIZE }), [readPage, filter, offset])
  const { range, rows, totalRows, completeThrough, completeRanges, nextAssignableOrder, missingRanges } = report
  const lastOffset = Math.max(0, Math.floor((totalRows - 1) / PAGE_SIZE) * PAGE_SIZE)
  useEffect(() => { if (offset > lastOffset) setOffset(lastOffset) }, [lastOffset, offset])

  function applyRange(event: FormEvent) {
    event.preventDefault()
    const fromChapter = from === '' ? undefined : Number(from)
    const toChapter = to === '' ? undefined : Number(to)
    if ([fromChapter, toChapter].some((n) => n !== undefined && (!Number.isSafeInteger(n) || n < 1))) {
      setError('章号须为正整数。')
    } else if (fromChapter !== undefined && toChapter !== undefined && toChapter < fromChapter) {
      setError('结束章不能早于起始章。')
    } else {
      setFilter({ ...filter, fromChapter, toChapter }); setOffset(0); setError('')
    }
  }

  function selectRange(r?: BookChapterRange) {
    setFrom(r ? String(r.from) : ''); setTo(r ? String(r.to) : '')
    setFilter({ fromChapter: r?.from, toChapter: r?.to }); setOffset(0); setError('')
  }

  function openSource(order: number, source: BookProgressSource) {
    const location = locateBookProgressSource(data, projectId, source)
    if (location) onOpenSource?.(location)
    else setUnavailable(order)
  }

  return <div className="book-progress-list">
    <dl className="book-progress-summary">
      <div><dt>从第 1 章连续写至</dt><dd>{completeThrough ? `第 ${completeThrough} 章` : '尚无连续正文'}</dd></div>
      <div><dt>可分配的新章号</dt><dd>第 {nextAssignableOrder} 章</dd></div>
    </dl>
    <Ranges label="全书完整章段" ranges={completeRanges} onSelect={selectRange} />
    <form onSubmit={applyRange} className="book-progress-form book-progress-filters" aria-label="按章号筛选">
      <label>起始章<input type="number" value={from} min="1" step="1" placeholder="不限"
        onChange={(e) => { setFrom(e.target.value); setError('') }} /></label>
      <label>结束章<input type="number" value={to} min="1" step="1" placeholder="不限"
        onChange={(e) => { setTo(e.target.value); setError('') }} /></label>
      <button type="submit" className="secondary-button">查看范围</button>
      <label className="book-progress-check"><input type="checkbox" checked={Boolean(filter.issuesOnly)}
        onChange={(e) => { setFilter({ ...filter, issuesOnly: e.target.checked }); setOffset(0) }} />仅看问题</label>
      {(from || to || filter.fromChapter || filter.toChapter || filter.issuesOnly) &&
        <button type="button" className="book-progress-link" onClick={() => selectRange()}>重置筛选</button>}
      {error && <p role="alert">{error}</p>}
    </form>
    <div className="book-progress-results" role="status">
      <strong>{range.toChapter >= range.fromChapter ? interval(range.fromChapter, range.toChapter) : '当前范围无章节'}</strong>
      <span>范围正文 {range.totalWords.toLocaleString()} 字</span><span>{totalRows.toLocaleString()} 条{filter.issuesOnly ? '问题' : '记录'}</span>
    </div>
    <Ranges label="范围内缺正文" ranges={missingRanges} onSelect={selectRange} />
    {rows.length ? <table className="book-progress-table" aria-label="全书章节清单">
      <thead><tr><th scope="col">章节</th><th scope="col">正文状态</th><th scope="col">计入字数</th><th scope="col">打开</th></tr></thead>
      <tbody>{rows.map((row) => {
        const failure = row.writebackFailure
        const chapterId = row.manuscriptStatus === 'archived' ? null : row.chapterId
        const draftId = failure?.kind === 'chapter_commit' ? failure.draftId : row.status === 'draft_only' ? row.draftId : null
        const revisionId = failure?.kind === 'revision_commit' ? failure.revisionVersionId : null
        return <tr key={row.order}>
          <th scope="row"><span>第 {row.order} 章</span>{row.title && row.title !== `第 ${row.order} 章` && <strong>{row.title}</strong>}</th>
          <td><RowState row={row} /></td>
          <td className="book-progress-count">{row.wordCount.toLocaleString()}</td>
          <td><div className="book-progress-actions">
            {revisionId && onOpenSource && <button type="button" onClick={() => openSource(row.order, { kind: 'revision',
              versionId: revisionId, sessionId: failure?.revisionSessionId, chapterId: failure?.chapterId })}>回到修订稿</button>}
            {draftId && onOpenSource && <button type="button" onClick={() => openSource(row.order, { kind: 'draft',
              draftId, jobId: failure?.jobId ?? row.jobId })}>回到草稿</button>}
            {chapterId && onOpenChapter && <button type="button" onClick={() => onOpenChapter(chapterId)}>{row.wordCount ? '查看正文' : '打开章节'}</button>}
            {unavailable === row.order && <small role="alert">找不到这次写回对应的稿件。</small>}
          </div></td>
        </tr>
      })}</tbody>
    </table> : <p className="book-progress-empty">{filter.issuesOnly ? '当前范围没有待处理的问题。' : '当前范围没有章节记录。'}</p>}
    {totalRows > PAGE_SIZE && <nav className="book-progress-pages" aria-label="清单分页">
      <button type="button" className="book-progress-icon" aria-label="上一页" title="上一页" disabled={!offset}
        onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft size={17} /></button>
      <span>第 {Math.floor(offset / PAGE_SIZE) + 1} / {Math.ceil(totalRows / PAGE_SIZE)} 页</span>
      <button type="button" className="book-progress-icon" aria-label="下一页" title="下一页" disabled={offset >= lastOffset}
        onClick={() => setOffset(Math.min(lastOffset, offset + PAGE_SIZE))}><ChevronRight size={17} /></button>
    </nav>}
  </div>
}
