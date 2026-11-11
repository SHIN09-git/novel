import type { AppData, Chapter, CharacterStateFact, CharacterStateTransaction } from '../../shared/types'
import { resourceAccountScope } from '../../shared/characterStateDefinition'
import { isChapterArchived } from '../ChapterLifecycleService'
import { draftContentHash } from '../DraftDiagnosticBindingService'

type Coverage = 'complete' | 'partial'
type Source = { order: number; chapter?: Chapter }
type Point = { fact: CharacterStateFact; at: number; time: number; conflict: boolean }
const tuple = (...parts: unknown[]) => JSON.stringify(parts)
const owner = (f: CharacterStateFact | CharacterStateTransaction, id: string) => tuple(f.projectId, f.characterId, id)
const field = (f: CharacterStateFact) => tuple(f.projectId, f.characterId, f.category, f.key?.trim() || null,
  f.key?.trim() ? null : f.id, f.unit?.trim() ?? '', f.category === 'resource' ? resourceAccountScope(f.key, f.label) : '')
const validOrder = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0
const stamp = (date: string) => Date.parse(date) || 0
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function chapterSources(chapters: readonly Chapter[] | undefined, coverage: Coverage) {
  const byId = new Map<string, Chapter>()
  const knownIds = new Set<string>()
  for (const c of chapters ?? []) {
    knownIds.add(c.id)
    const key = tuple(c.projectId, c.id)
    const old = byId.get(key)
    if (!old || old.updatedAt < c.updatedAt) byId.set(key, c)
  }
  const byOrder = new Map<string, Chapter | null>()
  const latestOfficialOrder = new Map<string, number>()
  for (const c of byId.values()) {
    const key = tuple(c.projectId, c.order)
    byOrder.set(key, byOrder.has(key) ? null : c)
    if (!isChapterArchived(c) && c.body?.trim()) latestOfficialOrder.set(c.projectId, Math.max(latestOfficialOrder.get(c.projectId) ?? 0, c.order))
  }
  function sourceFor(projectId: string, id: string | null, at: number | null, target: number): Source | null {
    const chapter = id ? byId.get(tuple(projectId, id)) : byOrder.get(tuple(projectId, at))
    if (chapter === null || (chapter && isChapterArchived(chapter))) return null
    if (id && !chapter && (knownIds.has(id) || (chapters && coverage === 'complete'))) return null
    const order = chapter?.order ?? at
    return validOrder(order) && order <= target ? { order, chapter } : null
  }
  return { sourceFor, isNewChapter: (projectId: string, target: number) => Boolean(chapters && coverage === 'complete' &&
    target > (latestOfficialOrder.get(projectId) ?? 0)) }
}

// Undo is an editorial correction, not a new event at the chapter to which the ledger row was restored.
function isCompensation(tx: CharacterStateTransaction): boolean {
  return Boolean(tx.reversesTransactionIds) || (tx.source === 'manual' && /^撤销候选决定 .+；补偿记录 .+$/.test(tx.reason))
}

function currentExcerpt(body: string, evidence: string): boolean {
  const quote = evidence?.trim()
  if (!quote || !/\p{L}/u.test(quote)) return false
  const at = body.indexOf(quote), end = at + quote.length
  if (at < 0 || body.indexOf(quote, at + 1) >= 0) return false
  // A number extended by a revision, or a now-negated excerpt, is not the old assertion.
  const numeral = /[\d零〇一二两三四五六七八九十百千万.]/
  return !(numeral.test(quote.at(-1)!) && numeral.test(body.charAt(end))) &&
    !(numeral.test(quote[0]) && numeral.test(body.charAt(at - 1))) &&
    !/(?:并非|并未|没有|否认|如果|假如)[^，。；：\n]{0,8}$/.test(body.slice(Math.max(0, at - 12), at))
}

function latestPoint(old: Point | undefined, next: Point, preferHead = false): Point {
  if (!old) return next
  const delta = next.at - old.at || next.time - old.time
  if (delta !== 0) return delta > 0 ? next : old
  if (preferHead) return next
  const conflict = old.conflict || next.conflict || !sameValue(next.fact.value, old.fact.value) || next.fact.status !== old.fact.status
  const representative = next.fact.id < old.fact.id ? next : old
  return { ...representative, conflict }
}

/**
 * Inclusive story time. Without a chapter directory only an explicit order can establish time.
 * A partial directory can disprove a source, but omission from a selection cannot disprove one.
 */
export function projectCharacterStatesAtChapter(
  facts: readonly CharacterStateFact[], transactions: readonly CharacterStateTransaction[], target: number,
  chapters?: readonly Chapter[], coverage: Coverage = 'complete'
): CharacterStateFact[] {
  if (!validOrder(target) || !facts.length) return []
  const { sourceFor, isNewChapter } = chapterSources(chapters, coverage)
  const hashes = new Map<Chapter, string>()
  const history = new Map<string, CharacterStateTransaction[]>()
  for (const tx of transactions) {
    if (tx.status !== 'accepted') continue
    const key = owner(tx, tx.factId)
    const group = history.get(key)
    if (group) group.push(tx)
    else history.set(key, [tx])
  }
  function supported(tx: CharacterStateTransaction, source: Source): boolean {
    if (!source.chapter) return !chapters || coverage === 'partial' || (tx.source === 'manual' && !tx.sourceBodyHash)
    if (tx.sourceBodyHash) {
      let hash = hashes.get(source.chapter)
      if (!hash) hashes.set(source.chapter, hash = draftContentHash(source.chapter.body))
      return !!source.chapter.body.trim() && hash === tx.sourceBodyHash
    }
    // A dated author assertion is not required to be a quotation. Old extraction records, however,
    // have no version binding: only their evidence in the current text can corroborate them.
    return tx.source === 'manual' || currentExcerpt(source.chapter.body, tx.evidence)
  }

  const latest = new Map<string, Point>()
  for (const fact of facts) {
    if (fact.status === 'inactive' || fact.status === 'retconned') continue
    // A mutable row can change its key or denomination. Resolve its own history before merging independent rows.
    let point: Point | undefined
    const entries = history.get(owner(fact, fact.id)) ?? []
    const head = sourceFor(fact.projectId, fact.sourceChapterId, fact.sourceChapterOrder, target)
    if (fact.status === 'resolved' && !fact.sourceChapterId && !validOrder(fact.sourceChapterOrder)) continue
    const undone = new Set<string>()
    let unlinkedUndo = false
    for (const tx of entries) {
      if (!isCompensation(tx)) continue
      if (!tx.reversesTransactionIds) unlinkedUndo = true
      for (const id of tx.reversesTransactionIds ?? []) undone.add(id)
    }
    let hasHeadEntry = false, supportedHead = false, restoredHead = false
    const redefined = entries.some(tx => tx.factDefinition && !undone.has(tx.id) && field({ ...fact, ...tx.factDefinition }) !== field(fact))
    for (const tx of entries) {
      const source = sourceFor(tx.projectId, tx.chapterId, tx.chapterOrder, target)
      const mirror = (tx.chapterId && fact.sourceChapterId ? tx.chapterId === fact.sourceChapterId :
        (tx.chapterOrder ?? source?.order) === (fact.sourceChapterOrder ?? head?.order)) && sameValue(tx.afterValue, fact.value)
      if (isCompensation(tx)) {
        if (mirror && unlinkedUndo) restoredHead = true
        continue
      }
      if (mirror) hasHeadEntry = true
      if (undone.has(tx.id) || unlinkedUndo || !source || !supported(tx, source) || (!tx.factDefinition && redefined)) continue
      const status: CharacterStateFact['status'] = tx.transactionType === 'resolve' ? 'resolved' : tx.transactionType === 'invalidate' ? 'inactive' :
        tx.factDefinition?.status ?? (mirror && fact.status === 'resolved' ? 'resolved' : 'active')
      if (status === 'active' && tx.afterValue == null) continue
      if (mirror && status === fact.status) supportedHead = true
      const historic: CharacterStateFact = {
        ...fact, ...tx.factDefinition, status, value: tx.afterValue ?? '', evidence: tx.evidence ?? '',
        // Never lift a private ledger row into a prompt by replaying an older policy.
        promptPolicy: fact.promptPolicy === 'manual_only' ? 'manual_only' : tx.factDefinition?.promptPolicy ?? fact.promptPolicy,
        sourceChapterId: tx.chapterId ?? source.chapter?.id ?? null, sourceChapterOrder: source.order,
        updatedAt: tx.createdAt
      }
      point = latestPoint(point, { fact: historic, at: source.order, time: stamp(tx.createdAt), conflict: false })
    }
    if (head && (!hasHeadEntry || supportedHead || restoredHead)) {
      const row = { ...fact, sourceChapterOrder: head.order, sourceChapterId: fact.sourceChapterId ?? head.chapter?.id ?? null }
      point = latestPoint(point, { fact: row, at: head.order, time: stamp(fact.updatedAt), conflict: false }, supportedHead)
    }
    if (fact.status === 'active' && !fact.sourceChapterId && fact.sourceChapterOrder == null && isNewChapter(fact.projectId, target)) {
      const undatedAuthorEntry = (tx: CharacterStateTransaction) => !tx.chapterId && tx.chapterOrder == null &&
        !tx.sourceBodyHash && tx.source === 'manual' && !isCompensation(tx)
      const currentManual = entries.some(tx => undatedAuthorEntry(tx) && sameValue(tx.afterValue, fact.value))
      if (!entries.length || (currentManual && entries.every(tx => {
        if (undatedAuthorEntry(tx)) return true
        const source = sourceFor(tx.projectId, tx.chapterId, tx.chapterOrder, target)
        return !isCompensation(tx) && !undone.has(tx.id) && source && supported(tx, source)
      }))) {
        // A new manual edit supersedes its own history. A bare legacy setting cannot overrule a dated entry.
        point = latestPoint(point, { fact: { ...fact, currentAsOfChapter: target },
          at: currentManual ? target : 0, time: stamp(fact.updatedAt), conflict: false })
      }
    }
    if (point) {
      const key = field(point.fact)
      latest.set(key, latestPoint(latest.get(key), point))
    }
  }
  return [...latest.entries()].sort(([a], [b]) => a < b ? -1 : Number(a !== b))
    .flatMap(([, item]) => item.conflict || item.fact.status !== 'active' ? [] : [item.fact])
}

export function characterStatesForProjectAtChapter(
  data: Pick<AppData, 'characterStateFacts' | 'chapters'> & Partial<Pick<AppData, 'characterStateTransactions'>>,
  projectId: string, target: number
): CharacterStateFact[] {
  return projectCharacterStatesAtChapter(data.characterStateFacts.filter(f => f.projectId === projectId),
    (data.characterStateTransactions ?? []).filter(tx => tx.projectId === projectId), target,
    data.chapters.filter(c => c.projectId === projectId))
}
