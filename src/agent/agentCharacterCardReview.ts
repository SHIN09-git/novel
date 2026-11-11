import type { AppData, ID } from '../shared/types'
import { redactSensitiveText } from '../shared/errorUtils'
import { getCharacterCardReview, type CardReviewEvidence } from '../services/characterState/cardReview'

export function readAgentCharacterCardReview(data: AppData, projectId: ID, characterId: ID,
  full: boolean, asOfChapterOrder?: number, maxChars = 160) {
  const review = getCharacterCardReview(data, projectId, characterId, asOfChapterOrder)
  const compact = {
    status: review.status, currentChapterOrder: review.currentChapter?.chapterOrder ?? null,
    lastChangedChapter: review.lastChangedChapter,
    lastReviewedChapterId: review.lastCardReview?.chapterId ?? null,
    lastReviewedChapterOrder: review.lastReviewedChapter?.chapterOrder ?? review.lastCardReview?.chapterOrder ?? null,
    latestConfirmedFactChapterOrder: review.latestConfirmedFactChapter?.chapterOrder ?? null,
    chaptersSinceReview: review.chaptersSinceReview, changesSinceReview: review.changesSinceReview,
    evidenceCount: review.evidence.length, unlocatedCount: review.unlocatedCount
  }
  if (!full) return compact
  const bodies = new Map(data.chapters.filter(c => c.projectId === projectId).map(c => [c.id, c.body.trim()]))
  function evidence(row: CardReviewEvidence) {
    const chapter = row.chapter
    const secret = [data.settings.apiKey]
    const body = bodies.get(chapter.chapterId)
    const safeBody = body && redactSensitiveText(body, secret)
    function excerpt(raw: string) {
      let safe = redactSensitiveText(raw, secret)
      // A one-line chapter can be an entire ledger quote. Return a locator and a fragment, not the manuscript.
      if (safeBody && safe.includes(safeBody)) {
        const chars = Array.from(safeBody)
        safe = safe.replaceAll(safeBody, chars.slice(0, Math.min(80, Math.floor(chars.length / 2))).join('') + '…')
      }
      const chars = Array.from(safe), limit = Math.min(maxChars, 160)
      return chars.length > limit ? chars.slice(0, limit).join('') + '…' : safe
    }
    const value = (v: CardReviewEvidence['after']) => typeof v === 'string' || Array.isArray(v)
      ? excerpt(Array.isArray(v) ? v.join('、') : v) : v
    return { chapterId: chapter.chapterId, chapterOrder: chapter.chapterOrder, chapterVersionId: chapter.chapterVersionId,
      bodyFingerprint: chapter.bodyFingerprint, factId: row.factId, transactionId: row.transactionId, label: excerpt(row.label),
      transactionType: row.transactionType, stateKey: excerpt(row.stateKey), before: value(row.before), after: value(row.after),
      unit: excerpt(row.unit), evidenceKind: row.location ? 'current_text' : 'ledger_note', excerpt: excerpt(row.evidence), location: row.location }
  }
  return { ...compact, evidence: review.evidence.map(evidence),
    ...(review.latestConfirmedFact && !review.evidence.length ? { latestConfirmedFact: evidence(review.latestConfirmedFact) } : {}) }
}
