import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { BOOK_CONTINUITY_COLLECTIONS, createBookContinuityReader } from '../../../../services/BookContinuityService'
import type { BookAuditFinding, BookAuditKind, BookAuditOptions, BookAuditStatus } from '../../../../services/bookContinuity/types'
import { createBookCollectionSelection } from '../../../../shared/bookCollectionSelection'
import type { AppData, ID } from '../../../../shared/types'
import { StatusBadge, type BadgeTone } from '../../components/UI'
import type { BookProgressNavigation } from './navigation'

const PAGE_SIZE = 10
const kinds: Record<BookAuditKind, string> = {
  money: '钱款', headcount: '人数', inventory: '物件', promise: '承诺', whereabouts: '人物下落', season: '季节', countdown: '倒计时'
}
const statuses: Record<BookAuditStatus, [string, BadgeTone]> = {
  conflict: ['冲突', 'danger'], needs_evidence: ['待核', 'warning'], open: ['未结', 'neutral']
}
type Jump = Pick<BookProgressNavigation, 'onOpenChapter'>

function Finding({ finding, onOpenChapter }: Jump & { finding: BookAuditFinding }) {
  const [label, tone] = statuses[finding.status]
  return <li>
    <div className="book-audit-heading"><StatusBadge tone={tone}>{label}</StatusBadge>
      <span>{kinds[finding.kind]}</span><h3>{finding.title}</h3></div>
    <p className="book-audit-reason">{finding.reason}</p>
    {finding.evidence.length ? <ol className="book-audit-evidence" aria-label="正式正文证据">
      {finding.evidence.map((e, i) => <li key={JSON.stringify([e.chapterId, e.chapterOrder, e.versionId, e.contentHash, e.excerpt, i])}>
        <div className="book-audit-source">
          <button type="button" className="book-progress-link" disabled={!onOpenChapter}
            onClick={() => onOpenChapter?.(e.chapterId)} aria-label={`查看第 ${e.chapterOrder} 章正式正文`}>
            第 {e.chapterOrder} 章<ArrowUpRight size={14} aria-hidden="true" /></button>
          <details className="book-audit-version" onKeyDown={event => {
            if (event.key === 'Escape' && event.currentTarget.open) {
              event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus()
            }
          }}>
            <summary aria-label={`第 ${e.chapterOrder} 章版本信息`}>版本信息</summary>
            <dl><dt>正文版本</dt><dd>{e.versionId ? <code>{e.versionId}</code> : '当前正文无版本记录'}</dd>
              <dt>正文指纹</dt><dd><code>{e.contentHash}</code></dd></dl>
          </details>
        </div>
        {e.excerpt ? <blockquote>{e.excerpt}</blockquote> : <p>未定位到可引用的正文原句。</p>}
      </li>)}
    </ol> : <p className="book-progress-empty">尚无可定位的正式正文证据。</p>}
  </li>
}

export default function BookContinuityPanel({ data, projectId, onOpenChapter }: Jump & { data: AppData; projectId: ID }) {
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState<BookAuditOptions>({})
  const select = useMemo(() => createBookCollectionSelection(projectId, BOOK_CONTINUITY_COLLECTIONS), [projectId])
  const scoped = useMemo(() => select(data), [data, select])
  const reader = useMemo(() => createBookContinuityReader(scoped, projectId, { to: query.to }), [scoped, projectId, query.to])
  const result = useMemo(() => {
    try {
      const page = reader.read({ ...query, limit: PAGE_SIZE })
      const last = Math.max(0, Math.ceil(page.total / PAGE_SIZE) - 1) * PAGE_SIZE
      return { page: page.offset > last ? reader.read({ ...query, offset: last, limit: PAGE_SIZE }) : page }
    } catch (err) { return { error: err instanceof Error ? err.message : '无法读取当前范围。' } }
  }, [reader, query])
  const { page } = result
  useEffect(() => {
    if (page && page.offset !== (query.offset ?? 0)) setQuery(q => ({ ...q, offset: page.offset }))
  }, [page, query.offset])
  const rangePending = from !== String(query.from ?? '') || to !== String(query.to ?? '')
  function applyRange(event: FormEvent) {
    event.preventDefault()
    const start = from ? Number(from) : undefined, end = to ? Number(to) : undefined
    if ([start, end].some(n => n !== undefined && (!Number.isSafeInteger(n) || n < 1))) return setError('章号须为正整数。')
    if (start !== undefined && end !== undefined && start > end) return setError('截止章不能早于起始章。')
    setFrom(String(start ?? '')); setTo(String(end ?? '')); setError('')
    setQuery(q => ({ ...q, from: start, to: end, offset: 0 }))
  }
  function reset() { setFrom(''); setTo(''); setQuery({}); setError('') }

  return <section className="book-continuity-panel" aria-label="全书核对结果">
    <form onSubmit={applyRange} className="book-progress-form book-progress-filters" aria-label="全书核对筛选">
      <label>起始章<input type="number" min="1" step="1" value={from} placeholder="不限"
        onChange={e => { setFrom(e.target.value); setError('') }} /></label>
      <label>截止章<input type="number" min="1" step="1" value={to} placeholder="不限"
        onChange={e => { setTo(e.target.value); setError('') }} /></label>
      <button type="submit" className="secondary-button">应用章段</button>
      <label>类别<select value={query.kind ?? ''} onChange={e => {
        const kind = e.target.value as BookAuditKind | ''; setQuery(q => ({ ...q, kind: kind || undefined, offset: 0 }))
      }}><option value="">全部类别</option>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>状态<select value={query.status ?? ''} onChange={e => {
        const status = e.target.value as BookAuditStatus | ''; setQuery(q => ({ ...q, status: status || undefined, offset: 0 }))
      }}><option value="">全部状态</option>{Object.entries(statuses).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <button type="button" className="book-progress-link" onClick={reset}>重置筛选</button>
      {(error || (!rangePending && result.error)) && <p role="alert">{error || result.error}</p>}
    </form>
    {rangePending ? <p role="status">章段尚未应用。</p> : page && <>
      <div className="book-progress-results" role="status" aria-atomic="true">
        <strong>{page.from === page.to ? `第 ${page.to} 章` : `第 ${page.from} 至 ${page.to} 章`}</strong>
        <span>冲突 {page.counts.conflict}</span><span>待核 {page.counts.needs_evidence}</span><span>未结 {page.counts.open}</span>
        <strong>筛选结果 {page.total} 条</strong>
      </div>
      {page.findings.length ? <ol className="book-audit-findings" aria-label="核对条目"
        key={JSON.stringify([projectId, page.from, page.to, query.kind, query.status, page.offset])}>
        {page.findings.map((f, i) => <Finding key={page.offset + i} finding={f} onOpenChapter={onOpenChapter} />)}
      </ol> : <p className="book-progress-empty">当前范围和筛选条件下没有核对条目。</p>}
      {page.total > PAGE_SIZE && <nav className="book-progress-pages" aria-label="全书核对分页">
        <button type="button" className="book-progress-icon" aria-label="核对上一页" title="上一页" disabled={!page.offset}
          onClick={() => setQuery(q => ({ ...q, offset: page.offset - PAGE_SIZE }))}><ChevronLeft size={17} /></button>
        <span aria-live="polite">第 {Math.floor(page.offset / PAGE_SIZE) + 1} / {Math.ceil(page.total / PAGE_SIZE)} 页</span>
        <button type="button" className="book-progress-icon" aria-label="核对下一页" title="下一页" disabled={page.offset + PAGE_SIZE >= page.total}
          onClick={() => setQuery(q => ({ ...q, offset: page.offset + PAGE_SIZE }))}><ChevronRight size={17} /></button>
      </nav>}
    </>}
  </section>
}
