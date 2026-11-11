import type { AppData, Chapter, ChapterCommitBundle, CharacterStateFact, CharacterStateFactValue, CharacterStateTransaction, ID } from '../../shared/types'
import { isChapterArchived } from '../ChapterLifecycleService'
import { createManuscriptEvidenceIndex } from '../bookContinuity/manuscriptEvidence'

export const CHARACTER_CARD_REVIEW_COLLECTIONS = [
  'projects', 'characters', 'chapters', 'chapterVersions', 'chapterCommitBundles',
  'characterStateFacts', 'characterStateTransactions', 'characterStateChangeCandidates'
] as const satisfies readonly (keyof AppData)[]
export type CardReviewData = Pick<AppData, typeof CHARACTER_CARD_REVIEW_COLLECTIONS[number]>

export interface CardReviewChapter {
  chapterId: ID
  chapterOrder: number
  title: string
  chapterVersionId: ID | null
  bodyFingerprint: string
}

export interface CardReviewEvidence {
  chapter: CardReviewChapter
  factId: ID
  transactionId: ID | null
  transactionType: CharacterStateTransaction['transactionType'] | null
  stateKey: string
  label: string
  before: CharacterStateFactValue | null
  after: CharacterStateFactValue | null
  unit: string
  evidence: string
  location: { start: number; end: number; paragraph: number } | null
}

function paragraphAt(body: string, start: number): number {
  const lines = body.slice(0, start).split(/\r\n|\r|\n/)
  return lines.slice(0, -1).filter(line => line.trim()).length + 1
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function containsAppliedRecord(c: ChapterCommitBundle, f: CharacterStateFact, tx?: CharacterStateTransaction) {
  const owned = (r: CharacterStateFact | CharacterStateTransaction) => r.projectId === f.projectId && r.characterId === f.characterId
  if (tx) return c.appliedCharacterStateTransactions?.some(t => owned(t) && t.id === tx.id && t.factId === f.id &&
    t.status === 'accepted' && t.evidence === tx.evidence && sameValue(t.afterValue, tx.afterValue))
  return c.appliedCharacterStateFacts?.some(item => owned(item) && item.id === f.id &&
    item.evidence === f.evidence && sameValue(item.value, f.value))
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const id = key(item)
    const group = groups.get(id)
    if (group) group.push(item)
    else groups.set(id, [item])
  }
  return groups
}

export function createCardReviewEvidenceIndex(data: CardReviewData, projectId: ID) {
  const owned = data.chapters.filter(c => c.projectId === projectId)
  const byIdentity = groupBy(owned, c => c.id)
  const active = owned.filter(c => !isChapterArchived(c) && Number.isSafeInteger(c.order) && c.order > 0)
  const byOrder = groupBy(active, c => String(c.order))
  const chapters = active.filter(c => c.id && c.body.trim() && byIdentity.get(c.id)!.length === 1 && byOrder.get(String(c.order))!.length === 1)
    .sort((a, b) => a.order - b.order)
  const byId = new Map(chapters.map(c => [c.id, c]))
  const versions = groupBy(data.chapterVersions.filter(v => v.projectId === projectId), v => v.chapterId)
  const manuscriptEvidence = createManuscriptEvidenceIndex(data.chapterVersions, projectId)
  const sources = new Map<ID, CardReviewChapter>()
  function source(c: Chapter): CardReviewChapter {
    let row = sources.get(c.id)
    if (!row) {
      const { versionId, contentHash } = manuscriptEvidence(c)
      row = { chapterId: c.id, chapterOrder: c.order, title: c.title, chapterVersionId: versionId, bodyFingerprint: contentHash }
      sources.set(c.id, row)
    }
    return row
  }

  const commits = data.chapterCommitBundles.filter(c => c.projectId === projectId)
  const txCommits = new Map<ID, ChapterCommitBundle[]>(), factCommits = new Map<ID, ChapterCommitBundle[]>()
  for (const c of commits) {
    for (const [items, map] of [[c.appliedCharacterStateTransactions, txCommits], [c.appliedCharacterStateFacts, factCommits]] as const) {
      for (const item of items ?? []) {
        const key = JSON.stringify([item.characterId, item.id])
        if (item.projectId === projectId) map.set(key, [...(map.get(key) ?? []), c])
      }
    }
  }
  const jobCommits = groupBy(commits, c => c.jobId ?? c.generatedDraft?.jobId ?? '')
  const facts = groupBy(data.characterStateFacts.filter(f => f.projectId === projectId &&
    (f.status === 'active' || f.status === 'resolved')), f => f.characterId)
  const transactions = groupBy(data.characterStateTransactions.filter(t => t.projectId === projectId), t => t.characterId)
  const candidates = groupBy(data.characterStateChangeCandidates.filter(c => c.projectId === projectId), c => c.characterId)
  function matchesCurrentCommit(c: ChapterCommitBundle, chapter: Chapter) {
    if (c.chapterId !== chapter.id || c.chapter?.id !== chapter.id || c.chapter.projectId !== projectId ||
      c.chapter.body !== chapter.body) return false
    const v = c.chapterVersion
    if (!v || v.source === 'before_accept_draft') return !(versions.get(chapter.id) ?? []).some(other =>
      other.createdAt >= c.acceptedAt && other.id !== v?.id)
    return v.chapterId === chapter.id && v.projectId === projectId &&
      v.body === chapter.body && v.id === source(chapter).chapterVersionId
  }

  function readEvidence(characterId: ID, through: number) {
    const rows: CardReviewEvidence[] = []
    let unlocatedCount = 0
    const ownedFacts = new Map((facts.get(characterId) ?? []).map(f => [f.id, f]))
    const mirroredHeads = new Set<ID>()
    const candidatesByNote = groupBy(candidates.get(characterId) ?? [], c => c.evidence)
    function add(f: CharacterStateFact, tx?: CharacterStateTransaction) {
      const transactionId = tx?.id ?? null
      const id = tx ? tx.chapterId : f.sourceChapterId, order = tx ? tx.chapterOrder : f.sourceChapterOrder
      const note = tx ? tx.evidence : f.evidence
      const recordKey = JSON.stringify([characterId, transactionId ?? f.id])
      const applied = (tx ? txCommits : factCommits).get(recordKey) ?? []
      const related = (candidatesByNote.get(note) ?? []).filter(c => (c.proposedTransaction?.id === tx?.id && Boolean(tx) ||
        (tx?.source !== 'manual' && (c.proposedFact?.id === f.id || c.targetFactId === f.id || c.proposedFact?.key === f.key) &&
          sameValue(c.afterValue ?? c.proposedFact?.value, tx ? tx.afterValue : f.value))) &&
        (!id || !c.chapterId || c.chapterId === id) && (!c.chapterOrder || !order || c.chapterOrder === order))
      const accepted = related.filter(c => c.status === 'accepted')
      const jobs = [...new Set(accepted.flatMap(c => c.jobId ? [c.jobId] : []))]
      const bindings = applied.length ? applied : jobs.flatMap(job => jobCommits.get(job) ?? [])
      const boundIds = new Set(bindings.map(c => c.chapterId))
      // A stored ID follows a reorder. Never silently replace a missing ID with its former slot.
      const boundId = id ?? (boundIds.size === 1 ? [...boundIds][0] : null)
      const slot = order !== null ? byOrder.get(String(order)) : null
      const quote = note.trim()
      // Old order-only rows need independent corroboration. Never guess from an order shared by two chapters.
      const candidate = !boundId && !bindings.length && slot?.length === 1 ? byId.get(slot[0].id) : undefined
      const corroboratedSlot = candidate && (tx?.sourceBodyHash || (quote && chapters.filter(c => c.body.includes(quote)).length === 1))
      const chapter = boundId ? byId.get(boundId) : corroboratedSlot ? candidate : null
      if (!chapter || chapter.order > through) {
        if (!boundId && order !== null && order <= through) unlocatedCount++
        return
      }
      const currentCommits = bindings.filter(c => matchesCurrentCommit(c, chapter))
      const hashes = [tx?.sourceBodyHash, ...accepted.map(c => c.proposedTransaction?.sourceBodyHash)].filter(Boolean)
      const wrongHash = hashes.some(hash => hash !== source(chapter).bodyFingerprint)
      const bound = applied.length ? currentCommits.some(c => containsAppliedRecord(c, f, tx)) :
        jobs.length === 1 && currentCommits.some(c => hashes.length || c.acceptedCharacterStateChangeCandidates?.some(item =>
          item.projectId === projectId && item.characterId === characterId && item.status === 'accepted' && accepted.some(a => a.id === item.id)))
      const start = quote ? chapter.body.indexOf(quote) : -1
      const unique = start >= 0 && chapter.body.indexOf(quote, start + 1) < 0 && /[\p{L}\p{N}]/u.test(quote)
      const alsoInOldBody = !bound && !hashes.length && unique && (versions.get(chapter.id) ?? [])
        .some(v => v.body !== chapter.body && v.body.includes(quote))
      // A known obsolete/draft origin is not rescued by a quote that also occurs in the new body.
      const missingOrigin = (bindings.length > 0 || jobs.length > 0) && !bound
      const uncorroborated = !bound && !hashes.length && (tx?.source === 'pipeline' || !unique || alsoInOldBody)
      if (wrongHash || missingOrigin || uncorroborated || (!applied.length && related.length && !accepted.length)) {
        unlocatedCount++
        return
      }
      rows.push({ chapter: source(chapter), factId: f.id, transactionId, transactionType: tx?.transactionType ?? null,
        stateKey: tx?.factDefinition?.key ?? f.key, label: tx?.factDefinition?.label ?? f.label,
        unit: tx?.factDefinition?.unit ?? f.unit, before: tx?.beforeValue ?? null, after: tx ? tx.afterValue : f.value,
        evidence: quote, location: unique ? { start, end: start + quote.length, paragraph: paragraphAt(chapter.body, start) } : null })
    }
    for (const [factId, journal] of groupBy(transactions.get(characterId) ?? [], t => t.factId)) {
      const f = ownedFacts.get(factId)
      if (!f) continue
      if (journal.some(t => sameValue(t.afterValue, f.value) && ((t.chapterId && t.chapterId === f.sourceChapterId) ||
        (t.chapterOrder !== null && t.chapterOrder === f.sourceChapterOrder)))) mirroredHeads.add(factId)
      const accepted = journal.filter(t => t.status === 'accepted')
      const undo = accepted.filter(t => t.reversesTransactionIds || (t.source === 'manual' && /^撤销候选决定 .+；补偿记录 .+$/.test(t.reason)))
      if (undo.some(t => !t.reversesTransactionIds)) { mirroredHeads.add(factId); continue }
      const excluded = new Set(undo.flatMap(t => [t.id, ...t.reversesTransactionIds!]))
      for (const t of accepted) if (!excluded.has(t.id)) add(f, t)
    }
    // Never revive a stale/rejected transaction via its mirror; independently sourced legacy facts still count.
    for (const f of ownedFacts.values()) if (!mirroredHeads.has(f.id)) {
      add(f)
    }
    rows.sort((a, b) => a.chapter.chapterOrder - b.chapter.chapterOrder || (a.location?.start ?? Infinity) -
      (b.location?.start ?? Infinity) || (a.transactionId ?? a.factId).localeCompare(b.transactionId ?? b.factId))
    return { rows, unlocatedCount }
  }
  return { chapters, byId, source, readEvidence }
}
