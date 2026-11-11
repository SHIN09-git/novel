import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, Check, Pencil } from 'lucide-react'
import type { AppData, Character, CharacterCardReviewCommand, CharacterProfilePatch, ID } from '../../../../shared/types'
import { createCharacterCardReviewReader, type CardReviewEvidence } from '../../../../services/characterState/cardReview'
import { getUserFriendlyError } from '../../../../shared/errorUtils'
import { getNovelDirectorDataApi } from '../../platform/novelDirectorBridge'
import type { RunPersistedStorageOperation } from '../../utils/saveDataState'
import { formatDate } from '../../utils/format'
import { CharacterProfilePanels } from './CharacterProfilePanels'

interface Props {
  data: AppData
  character: Character
  runOperation?: RunPersistedStorageOperation
  onOpenChapter?: (id: ID) => void
  children: ReactNode
}

function display(value: CardReviewEvidence['after'], unit: string) {
  return value === null ? '未记录' : (Array.isArray(value) ? value.join('、') : String(value)) + unit
}

export function CharacterCardReviewPanel({ data, character, runOperation, onOpenChapter, children }: Props) {
  const reader = useMemo(() => createCharacterCardReviewReader(data, character.projectId), [data, character.projectId])
  const [choice, setChoice] = useState(() => reader.chapters.at(-1) ?? null)
  const target = reader.chapters.find(c => c.id === choice?.id && c.order === choice.order)
  const selectionMissing = !target && (Boolean(choice) || reader.chapters.length > 0)
  const review = useMemo(() => reader.get(character.id, target?.order), [reader, character.id, target?.order])
  const [draft, setDraft] = useState<{ original: Character; token: string; patch: CharacterProfilePatch } | null>(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const old = review.lastCardReview
  const oldOrder = review.lastReviewedChapter?.chapterOrder ?? old?.chapterOrder
  const staleDraft = Boolean(draft && draft.token !== review.previewFingerprint)
  const evidenceRows = review.evidence.length || !review.latestConfirmedFact ? review.evidence : [review.latestConfirmedFact]
  const canReview = target && review.canMarkReviewed && runOperation && !saving
  const hasEdits = draft && Object.entries(draft.patch).some(([key, value]) => draft.original[key as keyof CharacterProfilePatch] !== value)

  async function commit() {
    if (!target || !runOperation || !canReview || staleDraft || pending.current) return
    const command: CharacterCardReviewCommand = { projectId: character.projectId, characterId: character.id,
      chapterId: target.id, chapterOrder: target.order, expectedFingerprint: draft?.token ?? review.previewFingerprint,
      ...(draft ? { decision: 'update', patch: draft.patch } : { decision: 'keep' }) }
    pending.current = true
    setSaving(true)
    setMessage('')
    try {
      await runOperation(async current => {
        const api = getNovelDirectorDataApi()
        if (typeof api.reviewCharacterCard !== 'function') throw new Error('当前版本不能提交角色卡核对，请更新应用。')
        const result = await api.reviewCharacterCard(command)
        const updated = result.character
        return { storagePath: result.storagePath, data: { ...current, characters: current.characters.map(c =>
          c.projectId === updated.projectId && c.id === updated.id ? updated : c) } }
      })
      setDraft(null)
      setMessage(`已${command.decision === 'keep' ? '保留原卡' : '更新角色卡'}，核对到第 ${target.order} 章。`)
    } catch (error) {
      setMessage(getUserFriendlyError(error))
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return <>
    <section className="character-card-review" aria-label="角色卡核对">
      <h2>角色卡核对</h2>
      <label className="field"><span className="field-label">对照正式章节</span>
        <select value={target?.id ?? ''} disabled={saving || Boolean(draft)} onChange={e => {
          setChoice(reader.chapters.find(c => c.id === e.target.value) ?? null); setMessage('')
        }}>
          {!target && <option value="">{reader.chapters.length ? '请重新选择章节' : '暂无可核对的正式章节'}</option>}
          {reader.chapters.map(c => <option value={c.id} key={c.id}>第 {c.order} 章 · {c.title}</option>)}
        </select>
      </label>
      {selectionMissing ? <p role="alert">请重新选择对照章节，核对记录未变。</p> : <>
      <dl>
        <div><dt>最后变化章</dt><dd>{review.lastChangedChapter === null ? '无记录' : `第 ${review.lastChangedChapter} 章`}</dd></div>
        <div><dt>最后人工核对</dt><dd>{!old ? '未核对' : `第 ${oldOrder} 章`}
          {review.status === 'stale' && '（原记录待复核）'}</dd>
          {old && <dd><small><time dateTime={old.reviewedAt}>{formatDate(old.reviewedAt)}</time> · {old.decision === 'keep' ? '保留原卡' : '更新卡片'}</small></dd>}</div>
        <div><dt>最近已确认事实</dt><dd>{review.latestConfirmedFactChapter ? `第 ${review.latestConfirmedFactChapter.chapterOrder} 章` : '暂无可定位事实'}</dd></div>
      </dl>
      {old && target && <p>{review.chaptersSinceReview !== null ? `距第 ${target.order} 章相差 ${review.chaptersSinceReview} 章。` : '原核对章节已不可用。'}
        {oldOrder !== old.chapterOrder && `核对时为第 ${old.chapterOrder} 章。`}
        {review.status === 'stale' && '卡片、正式章节或事实依据已变化，请重新核对。'}</p>}
      {target && !review.canMarkReviewed && <p>已有更晚的核对记录；回看前章不会回退记录。</p>}
      <details className="character-review-evidence">
        <summary>查看证据 · {review.status === 'reviewed' ? '核对后' : '截至所选章'} {review.evidence.length} 条已确认事实</summary>
        {!review.evidence.length && <p>{review.latestConfirmedFact
          ? '核对后未发现新的已确认变化。上次核对范围内的最近一条：' : '未找到可定位的已确认事实。'}</p>}
        {evidenceRows.map(row => <article key={JSON.stringify([row.factId, row.transactionId])}>
          <strong>{row.label}{row.transactionType === 'resolve' ? '（已了结）' : row.transactionType === 'invalidate' ? '（已失效）' : ''}：
            {row.before !== null && `${display(row.before, row.unit)} → `}{display(row.after, row.unit)}</strong>
          <div>第 {row.chapter.chapterOrder} 章 · {row.chapter.title} · {row.location ? `正文第 ${row.location.paragraph} 段` : '账本说明，未定位到唯一原句'}</div>
          <blockquote>{row.evidence || '提交记录没有附原句。'}</blockquote>
          {onOpenChapter && <button type="button" className="ghost-button" disabled={Boolean(draft) || saving}
            onClick={() => onOpenChapter(row.chapter.chapterId)}>打开第 {row.chapter.chapterOrder} 章 <ArrowUpRight size={14} /></button>}
        </article>)}
      </details>
      {review.unlocatedCount > 0 && <p>另有 {review.unlocatedCount} 条账本记录缺少当前正式版本的依据，未计入。</p>}
      {!draft && <div className="row-actions">
        <button type="button" className="secondary-button" disabled={!canReview} onClick={() => void commit()}>
          <Check size={15} />保留原卡{target ? `，核对到第 ${target.order} 章` : '并标记核对'}</button>
        <button type="button" className="secondary-button" disabled={!canReview} onClick={() => {
          setMessage(''); setDraft({ original: character, token: review.previewFingerprint, patch: {} })
        }}><Pencil size={15} />编辑卡片后核对</button>
      </div>}
      </>}
      {message && <p role="status">{message}</p>}
    </section>
    {draft ? <fieldset disabled={saving} className="character-review-form">
      <legend>本次核对的卡片修改 · 尚未提交</legend>
      <CharacterProfilePanels staged character={{ ...draft.original, ...draft.patch }}
        onUpdate={patch => setDraft(previous => previous && { ...previous, patch: { ...previous.patch, ...patch } })} />
      {staleDraft && <p role="alert">核对依据已变化；请取消本次编辑，重新查看证据。</p>}
      <div className="row-actions">
        <button type="button" className="primary-button" disabled={!canReview || !hasEdits || staleDraft} onClick={() => void commit()}>
          <Check size={15} />确认更新并核对到第 {target?.order} 章</button>
        <button type="button" className="secondary-button" onClick={() => { setDraft(null); setMessage('') }}>取消本次编辑</button>
      </div>
    </fieldset> : children}
  </>
}
