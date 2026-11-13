// Run from the library worktree; the detached S1 checkout supplies all fixture semantics.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { sha256 } from '../utils/long-novel-ui-driver.mjs'

const root = await realpath('.'), source = await realpath('tmp/s3-perf-s1')
assert.equal(source, join(root, 'tmp', 's3-perf-s1'))
assert.equal(execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), '804f738')
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: source, encoding: 'utf8' }).trim(), '')
await mkdir(resolve('tmp'), { recursive: true })
const dir = await mkdtemp(resolve('tmp/s3-seed-'))
const lib = join(dir, 'fixture-tools.mjs')
await build({ stdin: { contents: [
  "export { normalizeAppData } from './src/shared/defaults'",
  "export { draftContentHash } from './src/services/DraftDiagnosticBindingService'",
  "export { SqliteStorageService } from './src/storage/SqliteStorageService'",
  "export { buildRevisionCommitBundle,applyRevisionCommitBundleToAppData } from './src/services/RevisionCommitBundleService'"
].join('\n'), resolveDir: source }, bundle: true, platform: 'node', format: 'esm', outfile: lib, external: ['better-sqlite3'] })
const { normalizeAppData, SqliteStorageService, buildRevisionCommitBundle, applyRevisionCommitBundleToAppData, draftContentHash } =
  await import(pathToFileURL(lib))
const { createLongNovelFixture } = await import(pathToFileURL(join(source, 'scripts/fixtures/long-novel-performance.mjs')))
const date = day => '2026-09-' + String(day).padStart(2, '0') + 'T00:00:00.000Z'
function book(prefix, count) {
  const raw = JSON.parse(JSON.stringify(createLongNovelFixture(count)).replaceAll('perf-', prefix + '-'))
  raw.projects = raw.projects.slice(0, 1)
  const project = raw.projects[0]
  project.name = 'S3 ' + prefix
  // Every accepted job has a later, successful but unaccepted alternate and its own checkpoints.
  const steps = Map.groupBy(raw.chapterGenerationSteps, s => s.jobId)
  for (const [i, job] of [...raw.chapterGenerationJobs].entries()) {
    const alt = job.id + '-later', original = raw.generatedChapterDrafts[i]
    const draft = { ...original, id: original.id + '-later', jobId: alt, status: 'draft',
      body: original.body + '\nAlternative.', createdAt: date(9), updatedAt: date(9) }
    raw.chapterGenerationJobs.push({ ...job, id: alt, createdAt: date(9), updatedAt: date(9) })
    raw.generatedChapterDrafts.push(draft)
    for (const s of steps.get(job.id)) raw.chapterGenerationSteps.push({ ...s, id: alt + '-' + s.type, jobId: alt,
      createdAt: date(9), updatedAt: date(9), output: s.type === 'generate_chapter_draft' ? JSON.stringify({ title: draft.title, body: draft.body }) : s.output })
    // Earlier initial version must sort before the accepted version.
    raw.chapterVersions[2*i].createdAt = date(6)
    raw.chapterCommitBundles[i].previousChapterVersion.createdAt = date(6)
  }
  const failed = { ...raw.chapterGenerationJobs[0], id: prefix + '-unfinished', status: 'failed',
    targetChapterOrder: count + 1, currentStep: 'generate_chapter_draft', errorMessage: 'synthetic interruption' }
  raw.chapterGenerationJobs.push(failed)
  let reached = false
  for (const s of steps.get(raw.chapterGenerationJobs[0].id)) {
    const status = s.type === failed.currentStep ? 'failed' : reached ? 'pending' : 'completed'
    reached ||= status === 'failed'
    raw.chapterGenerationSteps.push({ ...s, id: failed.id + '-' + s.type, jobId: failed.id,
      status, output: reached ? '' : s.output, errorMessage: status === 'failed' ? failed.errorMessage : '' })
  }
  let data = normalizeAppData(raw)
  // Two successive formal revisions of every fourth chapter. Use real receipt construction.
  for (const chapter of data.chapters.filter(c => c.order % 4 === 0)) {
    for (const pass of [1, 2]) {
      const key = chapter.id + '-revision-' + pass
      const bundle = buildRevisionCommitBundle({ appData: data, projectId: project.id, chapterId: chapter.id,
        revisionCommitId: key, newChapterVersionId: key + '-v', revisedAt: date(9 + pass),
        afterText: chapter.body + '\nRevision ' + pass + '.', revisionReason: 'Synthetic history' })
      data = applyRevisionCommitBundleToAppData(data, bundle)
    }
  }
  return data
}
const first = book('one', 500), second = book('two', 220)
let data = Object.fromEntries(Object.entries(first).map(([k,v]) => [k, Array.isArray(v) ? [...v, ...second[k]] : v]))
const projectId = first.projects[0].id, timestamp = date(13)
const chapter = first.chapters.find(c => c.order === 2)
const job = { ...first.chapterGenerationJobs[0], id: '000-selected-job', targetChapterOrder: 2, createdAt: timestamp, updatedAt: timestamp }
const draft = { ...first.generatedChapterDrafts[0], id: '000-selected-draft', jobId: job.id, chapterId: chapter.id,
  title: chapter.title, body: chapter.body + '\nAccepted benchmark.', status: 'draft', createdAt: timestamp, updatedAt: timestamp }
data.chapterGenerationJobs.unshift(job)
data.generatedChapterDrafts.unshift(draft)
for (const s of first.chapterGenerationSteps.filter(s => s.jobId === 'one-job-2')) {
  data.chapterGenerationSteps.push({ ...s, id: job.id + '-' + s.type, jobId: job.id, createdAt: timestamp,
    updatedAt: timestamp, output: s.type === 'generate_chapter_draft' ? JSON.stringify({title:draft.title,body:draft.body}) : s.output })
}
const hash = draftContentHash(draft.body)
const quality = { ...first.qualityGateReports[0], id: '000-quality', chapterId: chapter.id, projectId, jobId: job.id,
  draftId: draft.id, draftContentHash: hash, pass: true, overallScore: 95, issues: [], createdAt: timestamp, updatedAt: timestamp }
data.qualityGateReports.unshift(quality)
const consistency = { ...first.consistencyReviewReports[0], id: '000-consistency', jobId: job.id, chapterId: chapter.id,
  draftId: draft.id, generatedDraftId: draft.id, draftContentHash: hash, createdAt: timestamp, updatedAt: timestamp }
data.consistencyReviewReports.unshift(consistency)
data.generationRunTraces.unshift({ ...first.generationRunTraces.find(t => t.jobId === 'one-job-2'), id: '000-trace',
  jobId: job.id, generatedDraftId: draft.id, qualityGateReportId: quality.id, consistencyReviewReportId: consistency.id,
  aiCalls: [], createdAt: timestamp, updatedAt: timestamp })
data.editorialVerdicts.unshift({ id: '000-verdict', projectId, jobId: job.id, chapterId: chapter.id, draftId: draft.id,
  draftContentHash: hash, draftRevision: timestamp, status: 'approved', coverage: { quality: 'current', consistency: 'current' }, canAccept: true,
  summary: 'Synthetic review', blockers: [], advisories: [], actions: [], sourceRefs: { qualityGateReportId: quality.id,
    consistencyReviewReportId: consistency.id, generationRunTraceId: '000-trace', redundancyReportId: null, noveltyAuditTraceId: null,
    characterStateIssueIds: [], ignoredStaleReportIds: [] }, schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp })
const revChapter = first.chapters.find(c => c.order === 500)
data.revisionSessions.unshift({ id: '000-session', projectId, chapterId: revChapter.id, sourceDraftId: null, status: 'active', createdAt: timestamp, updatedAt: timestamp })
data.revisionRequests.unshift({ id: '000-request', sessionId: '000-session', type: 'custom', instruction: 'Synthetic revision', createdAt: timestamp })
data.revisionVersions.unshift({ id: '000-version', sessionId: '000-session', requestId: '000-request', title: 'S3 revision',
  body: revChapter.body + '\nRevised benchmark.', sourceContentHash: draftContentHash(revChapter.body), status: 'pending',
  changedSummary: '', preservedFacts: '', risks: '', createdAt: timestamp, updatedAt: timestamp })
const model = { apiProvider: 'local', apiKey: '', hasApiKey: false, baseUrl: 'http://127.0.0.1:9/v1', modelName: 'offline-fixture',
  codexCliPath: '', codexCliModel: '', retryEnabled: false, maxRetries: 0 }
data.settings = { ...data.settings, ...model, pipelineModelRoles: Object.fromEntries(
  ['planner','prose','extraction','reviewer','revision'].map(role => [role, model])) }
const sqlitePath = join(dir, 'seed.sqlite')
const storage = new SqliteStorageService(sqlitePath, { legacyJsonPath: join(dir, 'unused.json') })
await storage.save(normalizeAppData(data))
data = await storage.load()
storage.close()
const compact = JSON.stringify(data), bytes = Buffer.byteLength(compact)
const collections = Object.fromEntries(Object.entries(data).filter(([,v]) => Array.isArray(v)).map(([k,v]) =>
  [k, { count: v.length, bytes: Buffer.byteLength(JSON.stringify(v)) }]))
const manifest = { recipe: 1, compactBytes: bytes, compactSha256: createHash('sha256').update(compact).digest('hex'),
  sqliteBytes: (await stat(sqlitePath)).size, sqliteSha256: await sha256(sqlitePath), collections }
console.log(JSON.stringify({ dir, ...manifest, collections: undefined }))
assert(bytes >= 150 * 2**20 && bytes <= 200 * 2**20, 'Compact fixture outside the requested band')
await writeFile(join(dir, 'seed.json'), compact, { flag: 'wx' })
await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
