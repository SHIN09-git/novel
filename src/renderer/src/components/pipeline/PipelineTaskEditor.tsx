import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { ChapterTask } from '../../../../shared/types'

export const PIPELINE_TASK_FIELD_LABELS: Record<keyof ChapterTask, string> = {
  goal: '本章目标',
  conflict: '核心冲突',
  endingHook: '结尾',
  targetWordCount: '目标字数',
  styleRequirement: '表达要求',
  suspenseToKeep: '保留悬念',
  allowedPayoffs: '允许回收',
  forbiddenPayoffs: '禁止提前揭示',
  readerEmotion: '读者情绪'
}

const MAIN_FIELDS = ['goal', 'conflict', 'endingHook', 'targetWordCount', 'styleRequirement'] as const
const ADVANCED_FIELDS = ['suspenseToKeep', 'allowedPayoffs', 'forbiddenPayoffs', 'readerEmotion'] as const
const TASK_FIELDS: ReadonlyArray<keyof ChapterTask> = [...MAIN_FIELDS, ...ADVANCED_FIELDS]

export interface PipelineTaskEditorProps {
  task: ChapterTask
  busy: boolean
  onSave: (task: ChapterTask) => Promise<void>
  onGenerate?: () => void
  onDirtyChange?: (dirty: boolean) => void
  impact?: { label: string; reusableArtifacts: string[]; warnings: string[] }
  sourceLabel?: string
}

function sameTask(left: ChapterTask, right: ChapterTask) {
  return TASK_FIELDS.every((field) => left[field] === right[field])
}

export function PipelineTaskEditor({ task, busy, onSave, onGenerate, onDirtyChange, impact, sourceLabel }: PipelineTaskEditorProps) {
  const prefix = useId()
  const [editor, setEditor] = useState(() => ({ saved: { ...task }, draft: { ...task } }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const editorRef = useRef(editor)
  const incomingKey = JSON.stringify(TASK_FIELDS.map((field) => task[field]))
  const sourceKey = sourceLabel ?? ''
  const incomingKeyRef = useRef(incomingKey)
  const sourceKeyRef = useRef(sourceKey)
  const sourceVersionRef = useRef(0)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const busyRef = useRef(busy)
  const dirtyChangeRef = useRef(onDirtyChange)
  const dirty = !sameTask(editor.draft, editor.saved)
  const disabled = busy || saving

  useLayoutEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useLayoutEffect(() => { busyRef.current = busy }, [busy])

  useLayoutEffect(() => { dirtyChangeRef.current = onDirtyChange }, [onDirtyChange])

  useLayoutEffect(() => () => { dirtyChangeRef.current?.(false) }, [])

  useLayoutEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  useLayoutEffect(() => {
    const sourceChanged = sourceKeyRef.current !== sourceKey
    if (incomingKeyRef.current === incomingKey && !sourceChanged) return
    incomingKeyRef.current = incomingKey
    sourceKeyRef.current = sourceKey
    // A delayed echo of our successful save must not erase the next local edit.
    if (!sourceChanged && sameTask(task, editorRef.current.saved)) return
    sourceVersionRef.current++
    const next = { saved: { ...task }, draft: { ...task } }
    editorRef.current = next
    setEditor(next)
    setError('')
  }, [incomingKey, sourceKey])

  function changeField(field: keyof ChapterTask, value: string) {
    if (!mountedRef.current || busyRef.current || savingRef.current) return
    const current = editorRef.current
    const next = { ...current, draft: { ...current.draft, [field]: value } }
    editorRef.current = next
    setEditor(next)
    setError('')
  }

  function resetDraft() {
    if (!mountedRef.current || busyRef.current || savingRef.current) return
    const current = editorRef.current
    const next = { ...current, draft: { ...current.saved } }
    editorRef.current = next
    setEditor(next)
    setError('')
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mountedRef.current || busyRef.current || savingRef.current) return
    const current = editorRef.current
    if (sameTask(current.draft, current.saved)) return
    const submitted = { ...current.draft }
    const sourceVersion = sourceVersionRef.current
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      await onSave({ ...submitted })
      if (!mountedRef.current || sourceVersion !== sourceVersionRef.current) return
      const next = { ...editorRef.current, saved: submitted }
      editorRef.current = next
      setEditor(next)
    } catch (cause) {
      if (mountedRef.current && sourceVersion === sourceVersionRef.current) {
        setError(cause instanceof Error && cause.message ? `保存失败：${cause.message}` : '保存失败，请重试。')
      }
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  function generate() {
    const current = editorRef.current
    if (!mountedRef.current || busyRef.current || savingRef.current || !sameTask(current.draft, current.saved)) return
    onGenerate?.()
  }

  function fieldInput(field: keyof ChapterTask) {
    const id = `${prefix}-${field}`
    return (
      <div className={`pipeline-task-field${field === 'styleRequirement' ? ' full-width' : ''}`} key={field}>
        <label htmlFor={id}>{PIPELINE_TASK_FIELD_LABELS[field]}</label>
        {field === 'targetWordCount' ? <input id={id} name={field} type="text" value={editor.draft[field]}
          disabled={disabled} onChange={(event) => changeField(field, event.target.value)} /> :
          <textarea id={id} name={field} rows={field === 'goal' || field === 'conflict' ? 3 : 2}
            value={editor.draft[field]} disabled={disabled} onChange={(event) => changeField(field, event.target.value)} />}
      </div>
    )
  }

  return (
    <section className="pipeline-task-editor" aria-labelledby={`${prefix}-heading`} aria-busy={disabled}>
      <header className="pipeline-task-heading">
        <div><h3 id={`${prefix}-heading`}>本章任务</h3><p>来源：{sourceLabel || '未注明'}</p></div>
        <span className={`pipeline-task-status${dirty ? ' dirty' : ''}`} role="status" id={`${prefix}-status`}>
          {saving ? '正在保存' : dirty ? '本地更改 · 未保存' : '当前保存'}
        </span>
      </header>
      <form onSubmit={(event) => { void saveTask(event) }}>
        <div className="pipeline-task-fields">{MAIN_FIELDS.map(fieldInput)}</div>
        <details className="pipeline-task-advanced">
          <summary>更多任务要求</summary>
          <div className="pipeline-task-fields">{ADVANCED_FIELDS.map(fieldInput)}</div>
        </details>
        {impact ? <div className="pipeline-task-impact" aria-label="执行影响">
          <strong>{impact.label}</strong>
          {impact.reusableArtifacts.length ? <p>可复用：{impact.reusableArtifacts.join('、')}</p> : null}
          {impact.warnings.length ? <ul>{impact.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
        </div> : null}
        {error ? <p className="pipeline-task-error" role="alert">{error}</p> : null}
        <div className="pipeline-task-actions">
          <button className="ghost-button" type="button" disabled={disabled || !dirty} onClick={resetDraft}>重置未保存更改</button>
          <button className={dirty || !onGenerate ? 'primary-button' : 'ghost-button'} type="submit"
            disabled={disabled || !dirty}>保存任务</button>
          {onGenerate ? <button className={dirty ? 'ghost-button' : 'primary-button'} type="button"
            disabled={disabled || dirty} aria-describedby={`${prefix}-status`} title={dirty ? '请先保存任务' : undefined}
            onClick={generate}>按此任务生成</button> : null}
        </div>
      </form>
    </section>
  )
}
