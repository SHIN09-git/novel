import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { RevisionDiffView } from '../views/revision/RevisionDiffView'
import { getNovelDirectorClipboardApi } from '../platform/novelDirectorBridge'
import type { useAiRewriteCandidate } from './useAiRewriteCandidate'
import { AiCallProgress } from './AiCallProgress'

export function AiRewriteResultPanel({ result, onUseSelection }: {
  result: Omit<ReturnType<typeof useAiRewriteCandidate>, 'run' | 'cancel'> & { cancel: () => void }
  onUseSelection: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<'edit' | 'diff'>('edit')
  const [instruction, setInstruction] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  useEffect(() => { setCopyMessage('') }, [result.message, result.candidate])
  const candidate = result.candidate
  if (!candidate) return null
  const busy = result.applying || Boolean(result.busyActionId)
  const original = candidate.scope === 'chapter' ? candidate.sourceBody : candidate.selection.text
  async function copyCandidate() {
    try { await getNovelDirectorClipboardApi().writeText(candidate!.text); setCopyMessage('已复制候选') }
    catch { setCopyMessage('复制失败，请选中候选文本复制。') }
  }
  return createPortal(
    <section className={`ai-rewrite-result-panel${collapsed ? ' collapsed' : ''}`} data-testid="ai-rewrite-result-panel"
      aria-label="重写候选" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setCollapsed(true) } }}>
      <header className="ai-rewrite-result-header">
        <div><strong>重写候选</strong><span>{candidate.label} · 尚未应用</span></div>
        <button type="button" className="ghost-button" onClick={() => setCollapsed(!collapsed)}>{collapsed ? '展开候选' : '收起'}</button>
      </header>
      {!collapsed ? <>
        <div className="ai-rewrite-result-controls">
          <div className="tab-row" aria-label="候选范围">
            <button type="button" aria-pressed={candidate.scope === 'selection'} className={candidate.scope === 'selection' ? 'active' : ''}
              disabled={busy} onClick={() => result.setScope('selection')}>局部片段</button>
            <button type="button" aria-pressed={candidate.scope === 'chapter'} className={candidate.scope === 'chapter' ? 'active' : ''}
              disabled={busy} onClick={() => result.setScope('chapter')}>整章候选</button>
          </div>
          <div className="tab-row" aria-label="候选视图">
            <button type="button" className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>编辑候选</button>
            <button type="button" className={tab === 'diff' ? 'active' : ''} onClick={() => setTab('diff')}>与原文对比</button>
          </div>
        </div>
        <div className="ai-rewrite-result-content">
          {result.stale ? <div className="notice warning">原文已变化，候选仍保留。
            <button type="button" className="ghost-button" disabled={busy} onClick={() => result.retarget()}>在最新正文重新定位</button>
          </div> : null}
          {tab === 'diff' ? <RevisionDiffView originalText={original} revisedText={candidate.text} /> : <>
            <details><summary>查看原{candidate.scope === 'chapter' ? '章节' : '片段'}</summary><pre>{original}</pre></details>
            <textarea className="ai-rewrite-result-text" aria-label="候选正文" rows={9} disabled={busy}
              value={candidate.text} onChange={(event) => result.edit(event.target.value)} />
          </>}
          <div className="ai-rewrite-result-refine">
            <input aria-label="继续修改要求" placeholder="继续修改要求" value={instruction} disabled={busy}
              onChange={(event) => setInstruction(event.target.value)} />
            <button type="button" className="ghost-button" disabled={busy || !instruction.trim()}
              onClick={() => result.refine(instruction)}>继续改写</button>
          </div>
          <p className="ai-rewrite-result-status" role="status">{copyMessage || result.message}</p>
          {result.busyActionId && result.activeCall ? <AiCallProgress isRunning runId={result.activeCall.runId} callId={result.activeCall.callId} /> : null}
          {result.persistenceStatus ? <div className="ai-rewrite-result-status" data-testid="quick-rewrite-save-status" role="status">
            {result.persistenceStatus === 'saved' ? '候选已暂存' : result.persistenceStatus === 'saving' ? '正在暂存候选...' : '候选尚未保存，请重试。'}
            <button type="button" className="ghost-button" disabled={busy} onClick={() => void result.saveCandidate()}>
              {result.persistenceStatus === 'failed' ? '重试暂存' : '暂存候选'}
            </button>
          </div> : null}
        </div>
        <footer className="ai-rewrite-result-footer">
          <button type="button" className="ghost-button" onClick={() => void copyCandidate()}>复制候选</button>
          <button type="button" className="ghost-button" disabled={busy} onClick={onUseSelection}>使用当前选区</button>
          <button type="button" className="ghost-button" disabled={busy} onClick={result.discard}>放弃候选</button>
          {result.busyActionId ? <button type="button" className="ghost-button" onClick={result.cancel}>取消本次</button> : null}
          <button type="button" className="primary-button" disabled={busy || result.stale || !candidate.text.trim()} onClick={() => void result.apply()}>
            {result.applying ? '正在保存' : candidate.scope === 'chapter' ? '作为整章采用' : '应用到选区'}
          </button>
        </footer>
      </> : null}
    </section>, document.body
  )
}
