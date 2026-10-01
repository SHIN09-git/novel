import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AiCallProgress } from './AiCallProgress'
import {
  AI_REWRITE_ACTIONS,
  menuPositionAtCursor,
  type AiRewriteAction
} from './aiRewriteMenuModel'

interface AiRewriteMenuPortalProps {
  anchor: { x: number; y: number }
  selectionLength: number
  busyActionId: string | null
  activeCall?: { runId: string; callId: string } | null
  customInstruction: string
  hint: string
  onCustomInstructionChange: (value: string) => void
  onAction: (action: AiRewriteAction) => void
  onCancel?: () => void
  onDismiss: () => void
}

export function AiRewriteMenuPortal({
  anchor,
  selectionLength,
  busyActionId,
  activeCall,
  customInstruction,
  hint,
  onCustomInstructionChange,
  onAction,
  onCancel,
  onDismiss
}: AiRewriteMenuPortalProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>(() => ({
    ...menuPositionAtCursor(anchor.x, anchor.y),
    visibility: 'hidden'
  }))

  useLayoutEffect(() => {
    let frame = 0
    const reposition = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = menuRef.current?.getBoundingClientRect()
        setMenuStyle({
          ...menuPositionAtCursor(anchor.x, anchor.y, rect?.width ?? 300, rect?.height ?? 360),
          visibility: 'visible'
        })
      })
    }
    reposition()
    const observer = new ResizeObserver(reposition)
    if (menuRef.current) observer.observe(menuRef.current)
    window.addEventListener('resize', reposition)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', reposition) }
  }, [anchor.x, anchor.y])

  useEffect(() => {
    const close = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.ai-rewrite-menu')) return
      onDismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onDismiss])

  return createPortal(
    <div className="ai-rewrite-menu" ref={menuRef} style={menuStyle} role="menu">
      <div className="ai-rewrite-menu-header">
        <strong>AI 快速重写</strong>
        <span>{selectionLength.toLocaleString()} 字</span>
      </div>
      {!busyActionId ? <div className="ai-rewrite-menu-actions">
        {AI_REWRITE_ACTIONS.map((action) => (
          <button key={action.id} type="button" disabled={Boolean(busyActionId)} onClick={() => onAction(action)}>
            {busyActionId === action.id ? '处理中...' : action.label}
          </button>
        ))}
      </div> : <p className="ai-rewrite-menu-hint">{AI_REWRITE_ACTIONS.find((action) => action.id === busyActionId)?.label ?? '继续改写'}</p>}
      {busyActionId && activeCall ? <AiCallProgress isRunning runId={activeCall.runId} callId={activeCall.callId} /> : null}
      {busyActionId && onCancel ? (
        <div className="row-actions" role="status" aria-live="polite">
          {!activeCall ? <span>正在等待 AI 返回</span> : null}
          <button className="ghost-button" type="button" onClick={onCancel}>取消本次</button>
        </div>
      ) : null}
      {!busyActionId ? <textarea
        className="ai-rewrite-custom-input"
        value={customInstruction}
        rows={3}
        placeholder="选择“自定义需求...”前，在这里写具体要求。"
        disabled={Boolean(busyActionId)}
        onChange={(event) => onCustomInstructionChange(event.target.value)}
      /> : null}
      {!busyActionId ? <p className="ai-rewrite-menu-hint">{hint}</p> : null}
    </div>,
    document.body
  )
}
