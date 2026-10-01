import { useMemo, useState } from 'react'
import type { AppData } from '../../../../shared/types'
import type { CandidateDecisionReceipt, CandidateDecisionUndoPreview } from '../../../../shared/types/candidateDecision'
import { previewCandidateDecisionUndo } from '../../../../services/CandidateDecisionUndoService'
import { DecisionInboxUndoPreview } from './DecisionInboxUndoPreview'
import { decisionReceiptSummary, decisionReceiptTime, decisionRecordTitle } from './decisionInboxUiModel'

export function DecisionInboxHistory({ data, projectId, receipts, disabled, onUndo }: {
  data: AppData
  projectId: string
  receipts: CandidateDecisionReceipt[]
  disabled: boolean
  onUndo: (preview: CandidateDecisionUndoPreview, restoreChangedFields: boolean) => void
}) {
  const [visibleCount, setVisibleCount] = useState(10)
  const [openReceiptId, setOpenReceiptId] = useState<string | null>(null)
  const [previewReceiptId, setPreviewReceiptId] = useState<string | null>(null)
  const undoByOriginalId = useMemo(() => new Map(receipts.filter((receipt) => receipt.operation === 'undo' && receipt.undoesReceiptId)
    .map((receipt) => [receipt.undoesReceiptId!, receipt.id])), [receipts])
  const previewResult = useMemo(() => {
    if (!previewReceiptId) return null
    try {
      return { preview: previewCandidateDecisionUndo(data, { projectId, receiptId: previewReceiptId }), error: '' }
    } catch (error) {
      return { preview: null, error: error instanceof Error ? error.message : '暂时无法生成撤销预览。' }
    }
  }, [data, projectId, previewReceiptId])

  function showRelatedReceipt(id: string) {
    const index = receipts.findIndex((receipt) => receipt.id === id)
    if (index < 0) return
    setVisibleCount((count) => Math.max(count, index + 1))
    setOpenReceiptId(id)
    setPreviewReceiptId(null)
    requestAnimationFrame(() => document.getElementById(`inbox-receipt-${id}`)?.focus())
  }

  return (
    <section className="inbox-history" aria-label="处理记录">
      <p className="inbox-history-note">撤销仅补偿该次处理的改动，不会回退整部小说或删除原处理记录。</p>
      {!receipts.length ? <div className="inbox-empty"><strong>暂无处理记录</strong></div> : null}
      {receipts.slice(0, visibleCount).map((receipt) => {
        const undoReceiptId = undoByOriginalId.get(receipt.id)
        const isUndo = receipt.operation === 'undo'
        const isLegacy = !receipt.effects
        const previewOpen = previewReceiptId === receipt.id
        const originalExists = receipt.undoesReceiptId && receipts.some((item) => item.id === receipt.undoesReceiptId)
        const titles = [...new Set(receipt.effects?.map(decisionRecordTitle) ?? [])]
        return (
          <article className="inbox-history-entry" key={receipt.id} id={`inbox-receipt-${receipt.id}`}
            data-decision-receipt-id={receipt.id} tabIndex={-1}>
            <div className="inbox-history-heading">
              <div><strong>{decisionReceiptSummary(receipt)}</strong>
                <span>{decisionReceiptTime(receipt.decidedAt)} · {receipt.actor.kind === 'user' ? '作者' : 'Agent'}
                  {undoReceiptId ? ' · 已撤销' : ''}</span>
                {titles.length ? <p>{titles.slice(0, 3).join('、')}{titles.length > 3 ? `等 ${titles.length} 条记录` : ''}</p> : null}
              </div>
              <div className="inbox-history-actions">
                {undoReceiptId ? <button className="text-button" type="button" onClick={() => showRelatedReceipt(undoReceiptId)}>查看撤销记录</button> : null}
                {isUndo && originalExists ? <button className="text-button" type="button" onClick={() => showRelatedReceipt(receipt.undoesReceiptId!)}>查看原处理记录</button> : null}
                {!isUndo ? <button type="button" className="ghost-button" aria-expanded={previewOpen}
                  disabled={disabled || Boolean(undoReceiptId) || isLegacy}
                  title={isLegacy ? '旧记录没有保存改动前的字段值，无法自动撤销。' : undoReceiptId ? '该次处理已撤销。' : undefined}
                  onClick={() => setPreviewReceiptId(previewOpen ? null : receipt.id)}>预览撤销</button> : null}
              </div>
            </div>
            {isLegacy && !isUndo && !undoReceiptId ? <p className="inbox-history-note">旧记录未保存处理前的值，无法自动撤销。请到对应的角色、记忆、伏笔或时间线页面核对。</p> : null}
            <details className="inbox-record-details" open={openReceiptId === receipt.id}
              onToggle={(event) => {
                if (event.currentTarget.open) setOpenReceiptId(receipt.id)
                else setOpenReceiptId((current) => current === receipt.id ? null : current)
              }}>
              <summary>处理详情</summary>
              <p>{receipt.reason || '未填写原因'}</p>
              <p>记录标识：{receipt.id}{receipt.undoesReceiptId ? ` · 原记录：${receipt.undoesReceiptId}` : ''}</p>
              {receipt.decisions.length ? <ul>{receipt.decisions.map((item) => <li key={`${item.kind}:${item.candidateId}`}>
                {item.kind === 'memory' ? '记忆候选' : '角色状态候选'} · {item.decision === 'accept' ? '接受' : '拒绝'}
                {item.amendment ? '（编辑后）' : ''} · {item.candidateId}
              </li>)}</ul> : null}
            </details>
            {previewOpen && previewResult?.error ? <p role="alert" className="inbox-candidate-warning">{previewResult.error}</p> : null}
            {previewOpen && previewResult?.preview ? <DecisionInboxUndoPreview
              key={`${receipt.id}:${previewResult.preview.expectedFingerprint}:${previewResult.preview.status}`}
              preview={previewResult.preview} effects={receipt.effects} disabled={disabled} onUndo={onUndo}
              onCancel={() => setPreviewReceiptId(null)} onRelatedReceipt={showRelatedReceipt}
            /> : null}
          </article>
        )
      })}
      {visibleCount < receipts.length ? <button className="ghost-button inbox-history-more" type="button"
        onClick={() => setVisibleCount((count) => count + 10)}>显示更早记录（剩余 {receipts.length - visibleCount} 条）</button> : null}
    </section>
  )
}
