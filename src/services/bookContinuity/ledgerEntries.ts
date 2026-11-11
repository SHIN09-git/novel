import type { Chapter, CharacterStateFact, CharacterStateTransaction, ID } from '../../shared/types'
import type { BookAuditContext, BookAuditEvidence, BookAuditFinding } from './types'
import { currency, excerptAt, ownership, promiseWord, quantitiesIn, whereaboutsWord, type Passage } from './ledgerText'

export type LedgerKind = Exclude<BookAuditFinding['kind'], 'season' | 'countdown'>
export interface LedgerEntry {
  kind: LedgerKind
  fact: CharacterStateFact
  tx?: CharacterStateTransaction
  chapter: Chapter
  passage?: Passage
  proof?: BookAuditEvidence
  offset?: number
  missing?: string
  authorHold?: boolean
}

const cashKey = /现金|余额|银钱|盘缠|经费|公款|私款|存款|金币|银币|铜钱|cash|money|balance|funds|wallet|coins/i
const headcountKey = /人数|队员数|队伍规模|head[_ -]?count|(?:team|party|crew|group)[_. -]?(?:size|count|members)/i
const presenceKey = /^(?:presence|appearance|whereabouts|life_status|出场|实际出场|出场状态|在场状态|下落|人物下落|行踪|待交代下落|生死状态)$/i
export const authorHoldValue = (v: unknown) => typeof v === 'string' &&
  /^(?:deferred|paused|intentional_blank|intentional|暂缓|暂缓交代|有意留白|刻意留白)$/iu.test(v.trim())

function kindOf(fact: CharacterStateFact): LedgerKind | undefined {
  if (fact.category === 'promise' || fact.category === 'inventory') return fact.category
  if (['status', 'location', 'physical', 'custom'].includes(fact.category) &&
      [fact.key, fact.label].some(key => presenceKey.test(key.trim()))) return 'whereabouts'
  if (['resource', 'status', 'custom'].includes(fact.category) && headcountKey.test(fact.key + ' ' + fact.label)) return 'headcount'
  if (fact.category === 'resource' && (cashKey.test(fact.key + ' ' + fact.label) || currency.test(fact.unit.trim()))) return 'money'
}

function focusWithin(quote: string, kind: LedgerKind, fact: CharacterStateFact, tx?: CharacterStateTransaction): number {
  if (kind === 'money' || kind === 'headcount') {
    const amounts = quantitiesIn(quote, kind, fact.unit)
    for (const v of [tx ? tx.afterValue : fact.value, tx?.delta, tx?.beforeValue]) {
      if (typeof v !== 'number' && typeof v !== 'string') continue
      const focus = amounts.find(m => m.value === Math.abs(Number(v)))
      if (focus) return focus.at
    }
    return amounts[0]?.at ?? 0
  }
  if (kind === 'inventory') {
    const value = tx ? tx.afterValue : fact.value
    for (const item of [fact.label, ...(Array.isArray(value) ? value : [])]) {
      if (item && quote.includes(item)) return quote.indexOf(item)
    }
    return ownership.exec(quote)?.index ?? 0
  }
  return (kind === 'promise' ? promiseWord : whereaboutsWord).exec(quote)?.index ?? 0
}

function sentences(body: string): Passage[] {
  const passages: Passage[] = []
  for (const m of body.matchAll(/[^\s。！？!?][^\r\n。！？!?]*[。！？!?]*[”’」』"]*/gu)) {
    passages.push({ text: m[0].trimEnd(), at: m.index! })
  }
  return passages
}

function locate(chapter: Chapter, passages: Passage[], evidence: string): Passage | undefined {
  const quote = evidence.trim()
  if (!/[\p{L}\p{N}]/u.test(quote)) return
  const at = chapter.body.indexOf(quote)
  if (at < 0 || chapter.body.indexOf(quote, at + 1) >= 0) return
  const end = at + quote.length
  const first = passages.find(line => line.at <= at && at < line.at + line.text.length)
  const last = first && (end <= first.at + first.text.length ? first :
    passages.find(line => line.at < end && end <= line.at + line.text.length))
  if (!first || !last) return
  // An unchanged fragment inside a new denial, or "10" inside "100", is not the old assertion.
  if (/(?:并非|并未|不曾|没有|如果|假如|否认)[^，。；：]{0,8}$/u.test(chapter.body.slice(first.at, at)) ||
      (/^[\d零〇一二两三四五六七八九十百千万]/u.test(quote) && /[\d零〇一二两三四五六七八九十百千万.]/u.test(chapter.body.charAt(at - 1))) ||
      (/[\d零〇一二两三四五六七八九十百千万]$/u.test(quote) && /^[\d零〇一二两三四五六七八九十百千万.]/u.test(chapter.body.slice(end)))) return
  return { at: first.at, text: chapter.body.slice(first.at, last.at + last.text.length) }
}

export function readLedger(ctx: BookAuditContext) {
  const lines = new Map(ctx.chapters.map(ch => [ch.id, sentences(ch.body)]))
  const names = new Map(ctx.data.characters.filter(c => c.projectId === ctx.projectId).map(c => [c.id, c.name]))
  const rows: LedgerEntry[] = []
  function add(fact: CharacterStateFact, tx?: CharacterStateTransaction, missing?: string) {
    const kind = kindOf(fact)
    if (!kind) return
    const id = tx ? tx.chapterId : fact.sourceChapterId
    const order = tx ? tx.chapterOrder : fact.sourceChapterOrder
    const chapter = ctx.chapterFor(id, order)
    if (!chapter || (id && chapter.id !== id) || !lines.has(chapter.id)) return
    const quote = (tx ? tx.evidence : fact.evidence).trim()
    const passage = !missing ? locate(chapter, lines.get(chapter.id)!, quote) : undefined
    const focus = passage ? passage.text.indexOf(quote) + focusWithin(quote, kind, fact, tx) : 0
    const proof = passage && ctx.evidence(chapter, excerptAt(chapter, passage, focus))
    // A deliberate editorial hold silences only its own reminder; it proves no event in the story.
    const authorHold = !missing && !!id && (kind === 'promise' || kind === 'whereabouts') && (!tx || tx.source === 'manual') &&
      !tx?.sourceBodyHash && authorHoldValue(tx ? tx.afterValue : fact.value)
    if (!missing && !proof && !authorHold) missing = '记录中的原句无法在当前正式正文中唯一定位。'
    if (proof && tx?.sourceBodyHash && tx.sourceBodyHash !== proof.contentHash) missing = '交易绑定的正文指纹与当前版本不同。'
    if (!id && !tx?.sourceBodyHash && quote && ctx.chapters.some(c => c.id !== chapter.id && c.body.includes(quote))) {
      missing = '只有章号，且这段引文出现在多章，无法确认所属章节。'
    }
    rows.push({ kind, fact, chapter, tx, offset: !missing && passage ? passage.at + passage.text.indexOf(quote) : undefined,
      passage: missing ? undefined : passage, proof: missing ? undefined : proof, missing, authorHold })
  }
  const journals = new Map<ID, CharacterStateTransaction[]>()
  for (const tx of ctx.data.characterStateTransactions) {
    if (tx.projectId !== ctx.projectId) continue
    const journal = journals.get(tx.factId) ?? []
    journal.push(tx)
    journals.set(tx.factId, journal)
  }
  for (const fact of ctx.data.characterStateFacts) {
    if (fact.projectId !== ctx.projectId || !['active', 'resolved'].includes(fact.status)) continue
    const journal = (journals.get(fact.id) ?? []).filter(t => t.characterId === fact.characterId)
    const accepted = journal.filter(t => t.status === 'accepted')
    const undos = accepted.filter(t => t.reversesTransactionIds || (t.source === 'manual' && /^撤销候选决定 .+；补偿记录 .+$/u.test(t.reason)))
    if (undos.some(t => !t.reversesTransactionIds)) continue
    const excluded = new Set(undos.flatMap(t => [t.id, ...t.reversesTransactionIds!]))
    const redefined = accepted.some(t => !excluded.has(t.id) && t.factDefinition &&
      (['category', 'key', 'label', 'unit'] as const).some(k => t.factDefinition![k] !== fact[k]))
    for (const tx of accepted) {
      if (excluded.has(tx.id)) continue
      add(tx.factDefinition ? { ...fact, ...tx.factDefinition } : fact, tx,
        !tx.factDefinition && redefined ? '旧流水没有保留当时的账户定义，不能借用后来的名称或单位。' : undefined)
    }
    // A mirror cannot reintroduce a rejected, undone or obsolete journal entry under a new evidence note.
    const mirror = journal.some(t => (t.chapterId && fact.sourceChapterId ? t.chapterId === fact.sourceChapterId :
      t.chapterOrder != null && t.chapterOrder === fact.sourceChapterOrder) &&
      JSON.stringify(t.afterValue) === JSON.stringify(fact.value))
    if (!mirror) add(fact)
  }
  rows.sort((a, b) => a.chapter.order - b.chapter.order || (a.offset ?? -1) - (b.offset ?? -1) ||
    (a.tx?.id ?? a.fact.id).localeCompare(b.tx?.id ?? b.fact.id))
  function proofFor(r: LedgerEntry, term: string): BookAuditEvidence | undefined {
    if (!r.proof || !r.passage || !term || r.proof.excerpt.includes(term)) return r.proof
    const index = r.passage.text.indexOf(term)
    return index < 0 ? r.proof : ctx.evidence(r.chapter, excerptAt(r.chapter, r.passage, index))
  }
  return { rows, lines, names, proofFor }
}

export type Ledger = ReturnType<typeof readLedger>
export const entryValue = (r: LedgerEntry) => r.tx ? r.tx.afterValue : r.fact.value
export const isClosed = (r: LedgerEntry) => r.tx
  ? r.tx.transactionType === 'invalidate' || r.tx.transactionType === 'resolve' || (!!r.tx.factDefinition && r.tx.factDefinition.status !== 'active') ||
    (r.fact.status === 'resolved' && (r.fact.sourceChapterId ? r.fact.sourceChapterId === r.chapter.id :
      r.fact.sourceChapterOrder === r.chapter.order) && r.fact.evidence === r.tx.evidence)
  : r.fact.status === 'resolved'

export function proofs(...entries: LedgerEntry[]): BookAuditEvidence[] {
  return [...new Map(entries.filter(r => r.proof).map(r => [
    JSON.stringify([r.chapter.id, r.passage!.at]), r.proof!
  ])).values()].sort((a, b) => a.chapterOrder - b.chapterOrder)
}
