import assert from 'node:assert/strict'
import { loadDomainModules } from './utils/load-domain-modules.mjs'
import { auditBook, continuitySurfaceFixture, laterQuote } from './fixtures/book-continuity-surfaces.mjs'

const { normalizeAppData, buildBookContinuityReport, buildRevisionCommitBundle, applyRevisionCommitBundleToAppData,
  buildRestoreRevisionCommitBundle, draftContentHash } = await loadDomainModules('shared/defaults', 'services/BookContinuityService',
  'services/RevisionCommitBundleService', 'services/ChapterVersionChainService', 'services/DraftDiagnosticBindingService')
const original = normalizeAppData(continuitySurfaceFixture())
const chapterId = auditBook + '-5', args = { from: 5, to: 5, kind: 'money', status: 'conflict' }
const report = (data, options = args) => buildBookContinuityReport(data, auditBook, options)
const old = report(original)
assert.equal(old.total, 1)
const ends = old.findings[0].evidence
assert.deepEqual(ends.map(e => e.chapterOrder), [2, 5], 'chapter 5 may need a baseline outside the query range')
assert.equal(ends[0].versionId, null, 'imported chapter without a recorded version')
assert.equal(ends[1].versionId, 'current-v5')
assert.equal(report(original, { ...args, from: 1, to: 4 }).total, 0, 'earlier chapters cannot borrow a later conflict')
const edited = applyRevisionCommitBundleToAppData(original, buildRevisionCommitBundle({ appData: original,
  chapterId, projectId: auditBook, afterText: '顾宁合上账本，没有开支。', revisionCommitId: 'edit', newChapterVersionId: 'v-edit',
  revisedAt: '2026-10-02T00:00:00Z', revisedBy: 'user' }))
assert.equal(report(edited).total, 0, 'no stale conflict after a real revision')
assert(!JSON.stringify(report(edited, { to: 96 })).includes(laterQuote))
const before = original.chapters.find(c => c.id === chapterId)
const pasted = { ...edited, chapters: edited.chapters.map(c => c.id === chapterId ? { ...c, body: before.body } : c) }
assert.equal(report(pasted).findings[0].evidence[1].versionId, null, 'manually pasted text cannot claim a superseded version')
const restored = applyRevisionCommitBundleToAppData(edited, buildRestoreRevisionCommitBundle({ appData: edited, projectId: auditBook,
  chapterId, sourceVersionId: 'current-v5', revisionCommitId: 'restore', newChapterVersionId: 'v-restored',
  restoredAt: '2026-10-03T00:00:00Z' }))
const restoredEnd = report(restored).findings[0].evidence[1]
assert.equal(restoredEnd.versionId, 'v-restored')
assert.equal(restoredEnd.contentHash, draftContentHash(before.body))
const reorder = { ...restored, chapters: restored.chapters.map(c => c.id === chapterId ? { ...c, order: 97 } : c) }
assert.equal(report(reorder).total, 0)
assert.deepEqual(report(reorder, { ...args, from: 97, to: 97 }).findings[0].evidence.map(e => e.chapterOrder), [2, 97])
const archived = { ...restored, chapters: restored.chapters.map(c => c.id === chapterId ? { ...c, archivedAt: '2026-10-04' } : c) }
assert.equal(report(archived).total, 0)
console.log('PASS 96-chapter evidence: both ends, cutoff, revision, repasted text, restore commit, reordering and archive.')
