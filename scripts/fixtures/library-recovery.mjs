import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const tag = 'novel-director-library-s0-v1'
export const books = [
  { id: 's0-quay', name: '纸灯码头' },
  { id: 's0-tide', name: '潮表留白' }
]
export const acceptedBody = '末班渡船离岸后，许遥才看见绳桩旁那盏纸灯。\n\n她掀开灯罩，里面压着一张没有盖章的船票。'
export const revisedBody = acceptedBody.replace('一张没有盖章的船票', '一张回程船票，背面写着明早六点')
const waitBody = '排字房里剩下一块铅字。阿澄把它排进空栏，潮表上多了一个零。'
export const draftId = 's0-quay-draft'
export const waitJob = 's0-tide-job'
export const waitStep = 'await_user_confirmation'
export const digest = value => createHash('sha256').update(value).digest('hex')
const at = '2026-01-08T06:00:00.000Z'

// Only projects, unaccepted drafts and pipeline checkpoints are seeded. The packaged
// renderer must create both formal receipts, the chapter and its versions itself.
export function seed(baseUrl) {
  assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/)
  const model = { apiProvider: 'local', baseUrl, modelName: 's0-no-model', retryEnabled: false,
    maxRetries: 0, codexCliPath: '', codexCliModel: '' }
  const roles = Object.fromEntries(['planner', 'prose', 'extraction', 'reviewer', 'revision'].map(k => [k, model]))
  const jobs = books.map(({ id }, i) => ({
    id: id + '-job', projectId: id, targetChapterOrder: 1, pipelineMode: 'standard',
    promptContextSnapshotId: null, contextSource: 'auto', aiRunConfig: { ...model, roles, schemaVersion: 1 },
    status: i ? 'failed' : 'completed', currentStep: waitStep,
    errorMessage: i ? '虚构样本：等待确认步骤尚未交接。' : '', createdAt: at, updatedAt: at
  }))
  const drafts = books.map(({ id }, i) => ({
    id: id + '-draft', projectId: id, jobId: jobs[i].id, chapterId: null, title: i ? '铅字' : '回程票',
    body: i ? waitBody : acceptedBody, summary: '', status: 'draft', tokenEstimate: 48,
    createdAt: at, updatedAt: at
  }))
  return {
    projects: books.map(book => ({ ...book, genre: '虚构测试', description: '', targetReaders: '',
      coreAppeal: '', style: '', createdAt: at, updatedAt: at })),
    chapterGenerationJobs: jobs, generatedChapterDrafts: drafts,
    chapterGenerationSteps: jobs.flatMap((job, i) => ['generate_chapter_draft', waitStep].map((type, n) => ({
      id: job.id + '-' + type, jobId: job.id, type, status: n ? job.status : 'completed',
      inputSnapshot: JSON.stringify({ targetChapterOrder: 1, pipelineMode: 'standard' }),
      output: n ? (i ? '' : '等待确认') : JSON.stringify({ title: drafts[i].title, body: drafts[i].body,
        checkpoint: { kind: 'chapter_draft_checkpoint', draftId: drafts[i].id } }),
      errorMessage: n ? job.errorMessage : '', createdAt: at, updatedAt: at
    }))),
    settings: { ...model, apiKey: '', hasApiKey: false, enableAutoSummary: false,
      enableChapterDiagnostics: false, pipelineModelRoles: roles }
  }
}

// Verify relationships and content against the recipe BEFORE using a readback as an oracle.
export function signature(data) {
  const ids = data.projects.map(p => p.id).sort()
  assert.deepEqual(ids, books.map(p => p.id))
  assert.equal(data.chapters.length, 1)
  assert.equal(data.chapterCommitBundles.length, 1)
  assert.equal(data.revisionCommitBundles.length, 1)
  assert.equal(data.chapterVersions.length, 2)
  assert.equal(data.chapterGenerationJobs.length, 2)
  assert.equal(data.generatedChapterDrafts.length, 2)
  const [chapter] = data.chapters, [accept] = data.chapterCommitBundles, [revise] = data.revisionCommitBundles
  const draft = data.generatedChapterDrafts.find(d => d.id === draftId)
  const first = data.chapterVersions.find(v => v.source === 'generated_draft')
  const second = data.chapterVersions.find(v => v.source === 'manual_revision')
  assert(first && second && draft)
  for (const row of [draft, first, second, accept, revise]) {
    assert.equal(row.projectId, books[0].id)
    assert.equal(row.chapterId, chapter.id)
  }
  assert.equal(chapter.projectId, books[0].id)
  assert.equal(draft.status, 'accepted')
  assert.equal(accept.generatedDraftId, draft.id)
  assert.equal(accept.jobId, draft.jobId)
  assert.equal(first.linkedChapterCommitId, accept.commitId)
  assert.equal(second.linkedChapterCommitId, accept.commitId)
  assert.equal(second.linkedRevisionCommitId, revise.revisionCommitId)
  assert.equal(revise.linkedChapterCommitId, accept.commitId)
  assert.equal(first.baseChapterVersionId ?? null, null)
  assert.equal(revise.baseChapterVersionId, first.id)
  assert.equal(second.baseChapterVersionId, first.id)
  assert.equal(revise.newChapterVersionId, second.id)
  for (const text of [draft.body, first.body, accept.chapter.body, revise.beforeText]) assert.equal(text, acceptedBody)
  for (const text of [chapter.body, second.body, revise.afterText]) assert.equal(text, revisedBody)
  const job = data.chapterGenerationJobs.find(j => j.id === waitJob)
  const steps = data.chapterGenerationSteps.filter(s => s.jobId === waitJob)
  const generated = steps.find(s => s.type === 'generate_chapter_draft')
  const waiting = steps.find(s => s.type === waitStep)
  const pending = data.generatedChapterDrafts.find(d => d.jobId === waitJob)
  assert.equal(job.projectId, books[1].id)
  assert.equal(job.status, 'failed')
  assert.equal(job.currentStep, waitStep)
  assert.equal(waiting.status, 'failed')
  assert.equal(generated.status, 'completed')
  assert.equal(JSON.parse(generated.output).checkpoint.draftId, pending.id)
  assert.equal(pending.status, 'draft')
  assert.equal(pending.body, waitBody)
  return { projectIds: ids, chapterId: chapter.id, chapterSha256: digest(chapter.body),
    acceptedDraftId: draft.id, acceptanceId: accept.commitId, revisionId: revise.revisionCommitId,
    versions: [first, second].map(v => ({ id: v.id, base: v.baseChapterVersionId ?? null,
      source: v.source, bodySha256: digest(v.body) })),
    unfinished: { jobId: job.id, projectId: job.projectId, status: job.status, stepId: waiting.id,
      stepType: waiting.type, draftId: pending.id, draftSha256: digest(pending.body),
      checkpointSha256: digest(generated.output) } }
}
