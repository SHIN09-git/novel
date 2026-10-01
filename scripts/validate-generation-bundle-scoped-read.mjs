import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const workspace = await mkdtemp(join(tmpdir(), 'novel-generation-bundle-scoped-read-'))
const entryPath = join(workspace, 'entry.mjs')
const databasePath = join(workspace, 'validation.sqlite')

function runTrace(overrides = {}) {
  return {
    id: 'trace-target',
    jobId: 'job-target',
    projectId: 'project-target',
    generatedDraftId: 'draft-target',
    qualityGateReportId: 'quality-target',
    consistencyReviewReportId: 'consistency-target',
    editorialVerdictId: 'verdict-legacy',
    ...overrides
  }
}

function incrementalBundle(trace = runTrace()) {
  return {
    schemaVersion: 1,
    jobId: 'job-target',
    projectId: 'project-target',
    chapterId: 'chapter-target',
    updatedAt: '2026-09-07T00:00:00.000Z',
    job: {
      id: 'job-target',
      projectId: 'project-target',
      targetChapterOrder: 9
    },
    steps: [],
    generatedDrafts: [],
    qualityGateReports: [],
    consistencyReviewReports: [],
    memoryUpdateCandidates: [],
    characterStateChangeCandidates: [],
    redundancyReports: [],
    editorialVerdicts: [],
    runTrace: trace
  }
}

function validationReferenceIds(context) {
  return Object.fromEntries([
    ['generatedChapterDrafts', context.generatedChapterDrafts],
    ['consistencyReviewReports', context.consistencyReviewReports],
    ['qualityGateReports', context.qualityGateReports],
    ['editorialVerdicts', context.editorialVerdicts]
  ].map(([collection, items]) => [collection, items.map((item) => item.id)]))
}

await build({
  stdin: {
    resolveDir: repoRoot,
    contents: `
      export { ensureSqliteSchema } from './src/storage/sqlite/sqliteSchema';
      export { readAppDataFromDatabase } from './src/storage/sqlite/sqliteSnapshot';
      export { readGenerationBundleValidationContext } from './src/storage/sqlite/sqliteGenerationContext';
      export { validateGenerationRunBundle } from './src/services/GenerationRunBundleService';
    `
  },
  outfile: entryPath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  logLevel: 'silent'
})

const modules = await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
const db = new Database(databasePath)
const observedQueries = []
const originalPrepare = db.prepare.bind(db)
db.prepare = (sql) => {
  observedQueries.push(sql)
  return originalPrepare(sql)
}

try {
  modules.ensureSqliteSchema(db, '2026-09-07T00:00:00.000Z')
  const insert = db.prepare(
    'INSERT INTO entities (collection, id, project_id, job_id, json) VALUES (?, ?, ?, ?, ?)'
  )
  const add = (collection, id, jobId, value, projectId = value.projectId ?? null) => {
    insert.run(collection, id, projectId, jobId, JSON.stringify(value))
  }

  add('generatedChapterDrafts', 'draft-target', 'job-target', {
    id: 'draft-target', jobId: 'job-target', projectId: 'project-target', chapterId: 'chapter-target'
  })
  add('qualityGateReports', 'quality-target', 'job-target', {
    id: 'quality-target', jobId: 'job-target', projectId: 'project-target', chapterId: 'chapter-target'
  })
  add('consistencyReviewReports', 'consistency-target', 'job-target', {
    id: 'consistency-target', jobId: 'job-target', projectId: 'project-target', chapterId: 'chapter-target'
  })
  add('editorialVerdicts', 'verdict-legacy', null, {
    id: 'verdict-legacy', jobId: 'job-target', projectId: 'project-target', chapterId: 'chapter-target'
  })
  add('qualityGateReports', 'quality-same-job-foreign-project', 'job-target', {
    id: 'quality-same-job-foreign-project', jobId: 'job-target', projectId: 'project-foreign', chapterId: 'chapter-target'
  })
  add('generatedChapterDrafts', 'draft-other-job', 'job-other', {
    id: 'draft-other-job', jobId: 'job-other', projectId: 'project-target', chapterId: 'chapter-target', body: 'x'.repeat(2_000_000)
  })
  add('chapters', 'chapter-large-unrelated', null, {
    id: 'chapter-large-unrelated', projectId: 'project-target', body: 'x'.repeat(2_000_000)
  })

  observedQueries.length = 0
  const readAndValidate = db.transaction(() => {
    const context = modules.readGenerationBundleValidationContext(db, 'job-target')
    modules.validateGenerationRunBundle(incrementalBundle(), context)
    return context
  })
  const context = readAndValidate()

  assert.deepEqual(context.generatedChapterDrafts.map((item) => item.id), ['draft-target'])
  assert.deepEqual(context.consistencyReviewReports.map((item) => item.id), ['consistency-target'])
  assert.deepEqual(context.qualityGateReports.map((item) => item.id), [
    'quality-same-job-foreign-project',
    'quality-target'
  ])
  assert.deepEqual(context.editorialVerdicts.map((item) => item.id), ['verdict-legacy'])
  assert.equal(observedQueries.length, 1, 'Scoped read should issue one entity query.')
  assert.match(observedQueries[0], /collection IN \(\?, \?, \?, \?\)/)
  assert.match(observedQueries[0], /job_id = \? OR job_id IS NULL/)
  assert.doesNotMatch(observedQueries[0], /SELECT \*|chapters/i)

  const fullData = modules.readAppDataFromDatabase(db)
  const fullReadValidationContext = {
    generatedChapterDrafts: fullData.generatedChapterDrafts.filter((item) => item.jobId === 'job-target'),
    consistencyReviewReports: fullData.consistencyReviewReports.filter((item) => item.jobId === 'job-target'),
    qualityGateReports: fullData.qualityGateReports.filter((item) => item.jobId === 'job-target'),
    editorialVerdicts: fullData.editorialVerdicts.filter((item) => item.jobId === 'job-target')
  }
  assert.deepEqual(
    validationReferenceIds(context),
    validationReferenceIds(fullReadValidationContext),
    'Scoped context must match the full-read validator reference inputs.'
  )

  assert.throws(
    () => modules.validateGenerationRunBundle(
      incrementalBundle(runTrace({ generatedDraftId: 'draft-other-job' })),
      context
    ),
    /generatedDraftId draft-other-job is not present/
  )

  const failedReadAndValidate = db.transaction(() => {
    const failedContext = modules.readGenerationBundleValidationContext(db, 'job-target')
    modules.validateGenerationRunBundle(
      incrementalBundle(runTrace({ editorialVerdictId: 'verdict-missing' })),
      failedContext
    )
  })
  assert.throws(failedReadAndValidate, /editorialVerdictId verdict-missing is not present/)
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM entities').get().count,
    7,
    'Validation failure in the read transaction must not alter persisted rows.'
  )

  console.log('Generation bundle scoped validation read: passed')
} finally {
  db.close()
  await rm(workspace, { recursive: true, force: true })
}
