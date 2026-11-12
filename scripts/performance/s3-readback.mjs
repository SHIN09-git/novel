import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'

function inspect(file, fn) {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try { return db.transaction(() => fn(db))() } finally { db.close() }
}
export function fingerprints(file) {
  return inspect(file, db => new Map([...db.prepare('SELECT collection,id,json FROM entities ORDER BY collection,id').iterate()]
    .map(r => [r.collection + '/' + r.id, createHash('sha256').update(r.json).digest('hex')])))
}
export function changed(old, next) {
  const byCollection = {}
  for (const key of new Set([...old.keys(), ...next.keys()])) if (old.get(key) !== next.get(key)) {
    const c = key.split('/')[0]
    byCollection[c] = (byCollection[c] ?? 0) + 1
  }
  return byCollection
}
export function readback(file, committed) {
  return inspect(file, db => {
    const byId = db.prepare('SELECT json FROM entities WHERE collection=? AND id=?')
    const get = (c,id) => JSON.parse(byId.get(c,id).json)
    const books = ['one','two'].map(p => {
      const receipt = get('chapterCommitBundles', p + '-commit-4'), earlier = get('generatedChapterDrafts', receipt.generatedDraftId)
      const later = get('generatedChapterDrafts', p + '-draft-4-later'), job = get('chapterGenerationJobs', p + '-unfinished')
      const steps = db.prepare("SELECT json FROM entities WHERE collection='chapterGenerationSteps' AND job_id=?").all(job.id).map(r => JSON.parse(r.json))
      const a = get('revisionCommitBundles', p + '-chapter-4-revision-1'), b = get('revisionCommitBundles', p + '-chapter-4-revision-2')
      assert.equal(earlier.id, p + '-draft-4')
      assert.equal(earlier.status, 'accepted')
      assert.equal(earlier.body, receipt.generatedDraft.body)
      assert.equal(earlier.body, receipt.chapterVersion.body)
      assert.equal(later.status, 'draft')
      assert.equal(later.chapterId, earlier.chapterId)
      assert.equal(get('chapterGenerationJobs',later.jobId).status, 'completed')
      assert(later.createdAt > earlier.createdAt && later.body !== earlier.body)
      assert.equal(job.status,'failed')
      assert(steps.some(s => s.type === job.currentStep && s.status === 'failed'))
      assert(steps.some(s => s.status === 'pending') && steps.some(s => s.status === 'completed' && s.output))
      assert.equal(a.beforeText, earlier.body)
      assert.equal(a.afterText, b.beforeText)
      assert.equal(b.baseChapterVersionId, a.newChapterVersionId)
      assert.equal(b.afterText, get('chapters', earlier.chapterId).body)
      return { project: earlier.projectId, accepted: earlier.id, later: later.id, unfinished: job.id,
        failedStep: job.currentStep, pending: steps.filter(s => s.status === 'pending').length, revisionChain: [a.id,b.id] }
    })
    if (committed) {
      const draft = get('generatedChapterDrafts','000-selected-draft'), version = get('revisionVersions','000-version')
      assert.equal(draft.status,'accepted')
      assert.equal(version.status,'accepted')
      assert.equal(get('chapters','one-chapter-2').body, draft.body)
      assert.equal(get('chapters','one-chapter-500').body, version.body)
      const receipt = (c,field,val) => db.prepare('SELECT json FROM entities WHERE collection=? AND json_extract(json, ?) = ?').all(c,'$.'+field,val)
      const ac = receipt('chapterCommitBundles','generatedDraftId',draft.id), rc = receipt('revisionCommitBundles','revisionVersionId',version.id)
      assert.equal(ac.length,1)
      assert.equal(rc.length,1)
      assert.equal(JSON.parse(ac[0].json).acceptanceReview.mode,'reviewed')
      assert.equal(JSON.parse(ac[0].json).acceptanceReview.qualityGateReportId,'000-quality')
      assert.equal(JSON.parse(ac[0].json).acceptanceReview.editorialVerdictId,'000-verdict')
      assert.equal(get('chapterVersions',JSON.parse(rc[0].json).newChapterVersionId).body,version.body)
    }
    return { books, commitsVerified: committed, revision: db.prepare("SELECT value FROM meta WHERE key='revision'").get().value }
  })
}
