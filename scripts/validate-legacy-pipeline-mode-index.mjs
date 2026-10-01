#!/usr/bin/env node
// node scripts/validate-legacy-pipeline-mode-index.mjs [--benchmark] [--jobs=2000] [--steps-per-job=8] [--iterations=5]
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import { build } from 'esbuild'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const { values: options } = parseArgs({
  options: {
    benchmark: { type: 'boolean', default: false },
    jobs: { type: 'string', default: '2000' },
    'steps-per-job': { type: 'string', default: '8' },
    iterations: { type: 'string', default: '5' }
  }
})
for (const key of ['jobs', 'steps-per-job', 'iterations']) {
  assert(Number.isSafeInteger(Number(options[key])) && Number(options[key]) > 0, `--${key} must be a positive integer`)
}

const sourcePath = join(repoRoot, 'src/shared/normalizers/appData.ts')
const source = await readFile(sourcePath, 'utf8')

// Replace only the lookup implementation in memory. Both builds retain the real
// normalizeAppData/recipe wiring; no generated files or application data are used.
function referenceSource(current) {
  const replacements = new Map([
    ['indexLegacyPipelineModes', `function indexLegacyPipelineModes(_jobs, steps) { return steps }`],
    ['legacyPipelineModeForJob', `function legacyPipelineModeForJob(value, steps) {
  const job = objectOrEmpty(value)
  const directMode = normalizePipelineMode(job.pipelineMode)
  if (directMode) return directMode
  const jobId = stringValue(job.id)
  let latestMode = null
  let latestOrder = Number.NEGATIVE_INFINITY
  steps.forEach((step, index) => {
    if (step.jobId !== jobId) return
    const mode = pipelineModeFromStepSnapshot(step.inputSnapshot)
    if (!mode) return
    const timestamp = Date.parse(step.updatedAt || step.createdAt)
    const order = Number.isFinite(timestamp) ? timestamp : index
    if (order >= latestOrder) {
      latestMode = mode
      latestOrder = order
    }
  })
  return latestMode
}`]
  ])
  const parsed = ts.createSourceFile(sourcePath, current, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const edits = parsed.statements
    .filter((node) => ts.isFunctionDeclaration(node) && replacements.has(node.name?.text))
    .map((node) => ({ start: node.getStart(parsed), end: node.end, text: replacements.get(node.name.text) }))
  assert.equal(edits.length, replacements.size, 'Both lookup functions must be found for the before/after comparison')
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    current = current.slice(0, edit.start) + edit.text + current.slice(edit.end)
  }
  return current
}

async function loadModule(contents) {
  const result = await build({
    stdin: {
      contents: `${contents}\nexport { indexLegacyPipelineModes, legacyPipelineModeForJob }\n`,
      resolveDir: dirname(sourcePath),
      sourcefile: sourcePath,
      loader: 'ts'
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent'
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}

const before = await loadModule(referenceSource(source))
const after = await loadModule(source)
const timestamp = '2026-01-01T00:00:00.000Z'
const modes = ['conservative', 'standard', 'aggressive']

function withFixedClock(run) {
  const OriginalDate = globalThis.Date
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [timestamp])) }
    static now() { return OriginalDate.parse(timestamp) }
  }
  try { return run() } finally { globalThis.Date = OriginalDate }
}

function job(id, extra = {}) {
  return { id, projectId: 'synthetic-project', ...extra }
}

function step(jobId, mode, extra = {}) {
  return { jobId, inputSnapshot: JSON.stringify({ pipelineMode: mode }), createdAt: timestamp, updatedAt: timestamp, ...extra }
}

let equivalenceCases = 0
function equivalent(label, jobs, steps, expectedModes, extra = {}) {
  const input = { ...extra, chapterGenerationJobs: jobs, chapterGenerationSteps: steps }
  const untouched = structuredClone(input)
  const expected = withFixedClock(() => before.normalizeAppData(input))
  const actual = withFixedClock(() => after.normalizeAppData(input))
  assert.deepEqual(actual, expected, `${label}: entire normalized AppData must match`)
  assert.deepEqual(input, untouched, `${label}: inputs must not be mutated`)
  if (Array.isArray(steps)) assert.equal(actual.chapterGenerationSteps, steps, `${label}: preserve steps identity`)
  if (expectedModes !== undefined) {
    assert.deepEqual(actual.chapterGenerationJobs.map((value) => value.pipelineMode), expectedModes, label)
  }
  equivalenceCases += 1
  return actual
}

equivalent('absent arrays', undefined, undefined, [])
equivalent('non-array collections', {}, null, [])
equivalent('no jobs must not inspect steps', [], [null, undefined], [])
equivalent('empty steps and malformed jobs', [job('j'), null, [], 7, job('d', { pipelineMode: 'aggressive' })], [],
  [null, null, null, null, 'aggressive'])
equivalent('direct mode wins', modes.map((mode) => job(mode, { pipelineMode: mode })),
  modes.map((mode, index) => step(mode, modes[(index + 1) % modes.length])), modes)
equivalent('invalid direct mode falls back', [job('j', { pipelineMode: 'AGGRESSIVE' })], [step('j', 'standard')], ['standard'])
equivalent('updatedAt takes precedence over createdAt', [job('j')], [
  step('j', 'conservative', { updatedAt: '2020-01-01', createdAt: '2040-01-01' }),
  step('j', 'standard', { updatedAt: '2021-01-01', createdAt: '1990-01-01' }),
  step('j', 'aggressive', { updatedAt: '2019-01-01', createdAt: '2100-01-01' })
], ['standard'])
for (const updatedAt of [undefined, null, '', false, 0]) {
  equivalent(`falsy updatedAt: ${String(updatedAt)}`, [job('j')], [
    step('j', 'conservative'), step('j', 'aggressive', { updatedAt, createdAt: '2027-01-01' })
  ], ['aggressive'])
}
equivalent('invalid nonempty updatedAt must not retry createdAt', [job('j')], [
  step('j', 'conservative'), step('j', 'aggressive', { updatedAt: 'invalid', createdAt: '2099-01-01' })
], ['conservative'])
equivalent('equal timestamps choose the later step', [job('j')], modes.map((mode) => step('j', mode)), ['aggressive'])
equivalent('all invalid dates choose the later index', [job('j')], [
  step('j', 'conservative', { updatedAt: 'invalid' }),
  step('j', 'aggressive', { updatedAt: undefined, createdAt: undefined })
], ['aggressive'])
for (const milliseconds of [2, 3]) {
  equivalent(`global index competes with epoch milliseconds: ${milliseconds}`, [job('j')], [
    step('j', 'conservative', { updatedAt: new Date(milliseconds).toISOString() }),
    step('unrelated', 'standard'), step('unrelated', 'standard'),
    step('j', 'aggressive', { updatedAt: 'invalid' })
  ], ['aggressive'])
}
equivalent('valid date can tie an earlier invalid-date index', [job('j')], [
  step('j', 'conservative', { updatedAt: 'invalid' }),
  step('j', 'aggressive', { updatedAt: new Date(0).toISOString() })
], ['aggressive'])
equivalent('negative timestamps are not clamped', [job('j')], [
  step('j', 'conservative', { updatedAt: 'invalid' }),
  step('j', 'aggressive', { updatedAt: new Date(-1).toISOString() })
], ['conservative'])
const sparseSteps = new Array(7)
sparseSteps[0] = step('j', 'conservative', { updatedAt: new Date(5).toISOString() })
sparseSteps[6] = step('j', 'aggressive', { updatedAt: 'invalid' })
const sparseJobs = new Array(3)
sparseJobs[2] = job('j')
equivalent('sparse arrays preserve holes and global indexes', sparseJobs, sparseSteps)

const badSnapshots = [undefined, null, false, 42, {}, [], '', ' \t\n', '{', '{"pipelineMode":',
  'null', '[]', 'true', '42', '"aggressive"', '{}', '{"pipelineMode":null}',
  '{"pipelineMode":"AGGRESSIVE"}', '{"pipelineMode":" aggressive "}', '{"pipelineMode":{"mode":"aggressive"}}',
  '{"nested":{"pipelineMode":"aggressive"}}']
for (const [index, inputSnapshot] of badSnapshots.entries()) {
  equivalent(`missing or corrupt snapshot ${index}`, [job('j')], [
    step('j', 'conservative'), step('j', 'aggressive', { inputSnapshot, updatedAt: '2099-01-01' })
  ], ['conservative'])
  equivalent(`only invalid snapshot ${index}`, [job('j')], [step('j', null, { inputSnapshot })], [null])
}
equivalent('whitespace around valid JSON', [job('j')], [
  step('j', null, { inputSnapshot: ' \n {"pipelineMode":"aggressive"} \n' })
], ['aggressive'])
equivalent('strict step IDs, empty job IDs, duplicate IDs and Map keys', [
  job(7), {}, job(''), job('7'), job('__proto__'), job('constructor'), job('toString'),
  job('same', { projectId: 'a' }), job('same', { projectId: 'b' }), job('same', { pipelineMode: 'conservative' })
], [
  step('', 'standard'), step(7, 'conservative'), step(null, 'conservative'), step(undefined, 'conservative'),
  step('7', 'aggressive'), step('__proto__', 'conservative'), step('constructor', 'aggressive'),
  step('toString', 'standard'), step('same', 'aggressive')
], ['standard', 'standard', 'standard', 'aggressive', 'conservative', 'aggressive', 'standard', 'aggressive', 'aggressive', 'conservative'])

const recipeResult = equivalent('recipe inference and persisted snapshots', [
  job('a', { pipelineRecipeId: 'standard', pipelineRecipe: null }),
  job('b', { pipelineRecipeId: 'fast' }),
  job('c', { pipelineRecipeId: 'custom' }),
  job('d', { pipelineRecipe: { id: 'strict', version: 99, name: ' frozen ', steps: [] } }),
  job('e', { pipelineRecipe: { id: 'invalid', steps: [] } }),
  job('f', { pipelineMode: 'conservative', pipelineRecipeId: 'fast' })
], [step('a', 'aggressive'), step('b', 'conservative'), step('d', 'aggressive'), step('e', 'conservative'), step('f', 'aggressive')])
assert.deepEqual(recipeResult.chapterGenerationJobs.map((value) => [
  value.pipelineMode, value.pipelineRecipeId, value.pipelineRecipeVersion, value.pipelineRecipe?.id ?? null
]), [
  ['aggressive', 'fast', 1, null], ['conservative', 'strict', 1, null], [null, 'custom', 1, null],
  ['aggressive', 'strict', 1, 'strict'], ['conservative', 'strict', 1, 'strict'], ['conservative', 'strict', 1, null]
])
equivalent('other normalizers and unknown fields remain intact', [job('j', {
  chapterTaskSnapshot: { goal: 'synthetic goal', targetWordCount: '800' },
  taskEdit: { changedFields: ['goal', 'unknown', 'goal'], scope: 'expression' },
  aiRunConfig: {}, contextSource: 'prompt_snapshot', promptContextSnapshotId: 'snapshot', marker: { keep: true }
})], [step('j', 'aggressive')], ['aggressive'], {
  schemaVersion: 3,
  settings: { requestTimeoutMs: 120000, apiKey: 'synthetic-only', marker: true },
  projects: [{ id: 'synthetic-project', name: 'Synthetic' }],
  chapters: [{ id: 'chapter', projectId: 'synthetic-project', order: 1, body: 'Synthetic text.' }],
  characters: [{ id: 'character', projectId: 'synthetic-project', name: 'Fixture' }],
  storyBibles: [{ id: 'bible', marker: true }],
  promptContextSnapshots: [{ id: 'snapshot', projectId: 'synthetic-project', mode: 'custom' }],
  untouchedExtension: { marker: true }
})

// Seeded differential cases include duplicate/malformed IDs, interleaved steps,
// invalid dates, direct modes and explicit recipes without external fixtures.
let seed = 0x5eed1234
function random(limit) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return Math.floor((seed / 0x100000000) * limit)
}
function pick(values) { return values[random(values.length)] }
const ids = ['', 'a', 'b', 'c', '__proto__', 'constructor', 'orphan', 7, null, undefined]
const dateValues = [undefined, null, '', 'invalid', timestamp, '2025-01-01', '2027-01-01',
  new Date(-1).toISOString(), new Date(0).toISOString(), new Date(5).toISOString()]
const snapshots = [...badSnapshots, ...modes.map((pipelineMode) => JSON.stringify({ pipelineMode }))]
for (let iteration = 0; iteration < 400; iteration += 1) {
  const jobs = Array.from({ length: random(24) }, () => job(pick(ids), {
    pipelineMode: pick([...modes, null, undefined, 'invalid']),
    pipelineRecipeId: pick(['fast', 'strict', 'custom', null]),
    pipelineRecipe: pick([null, undefined, { id: 'custom', steps: [] }, { id: 'invalid', steps: [] }])
  }))
  const steps = Array.from({ length: random(100) }, () => ({
    jobId: pick(ids), inputSnapshot: pick(snapshots), updatedAt: pick(dateValues), createdAt: pick(dateValues)
  }))
  if (steps.length && iteration % 3 === 0) delete steps[random(steps.length)]
  equivalent(`seeded differential case ${iteration}`, jobs, steps)
}

const changedSteps = [step('j', 'conservative')]
equivalent('first invocation', [job('j')], changedSteps, ['conservative'])
changedSteps.push(step('j', 'aggressive'))
equivalent('index is rebuilt on the next invocation', [job('j')], changedSteps, ['aggressive'])

function makeScaleFixture(jobCount, stepsPerJob, duplicateIds = false) {
  const jobs = Array.from({ length: jobCount }, (_, index) => job(duplicateIds ? 'shared' : `j-${index}`))
  const steps = Array.from({ length: jobCount * stepsPerJob }, (_, index) => step(
    duplicateIds ? 'shared' : `j-${index % jobCount}`, modes[index % modes.length], {
      inputSnapshot: JSON.stringify({ pipelineMode: modes[index % modes.length], context: 'x'.repeat(256) })
    }
  ))
  return { chapterGenerationJobs: jobs, chapterGenerationSteps: steps }
}

function countWork(module, fixture) {
  const counts = { stepVisits: 0, snapshotReads: 0, jsonParses: 0, dateParses: 0 }
  const measuredSteps = fixture.chapterGenerationSteps.map((value) => ({
    ...value,
    get jobId() { counts.stepVisits += 1; return value.jobId },
    get inputSnapshot() { counts.snapshotReads += 1; return value.inputSnapshot }
  }))
  const originalParse = JSON.parse
  const originalDateParse = Date.parse
  JSON.parse = (...args) => { counts.jsonParses += 1; return originalParse(...args) }
  Date.parse = (...args) => { counts.dateParses += 1; return originalDateParse(...args) }
  try {
    const result = module.normalizeAppData({ ...fixture, chapterGenerationSteps: measuredSteps })
    return { counts, modes: result.chapterGenerationJobs.map((value) => value.pipelineMode) }
  } finally {
    JSON.parse = originalParse
    Date.parse = originalDateParse
  }
}

const complexityRows = []
for (const jobCount of [128, 256, 512]) {
  const fixture = makeScaleFixture(jobCount, 4)
  const oldWork = countWork(before, fixture)
  const newWork = countWork(after, fixture)
  const stepCount = fixture.chapterGenerationSteps.length
  assert.deepEqual(newWork.modes, oldWork.modes)
  assert.deepEqual(oldWork.counts, { stepVisits: jobCount * stepCount, snapshotReads: stepCount, jsonParses: stepCount, dateParses: stepCount })
  assert.deepEqual(newWork.counts, { stepVisits: stepCount, snapshotReads: stepCount, jsonParses: stepCount, dateParses: stepCount })
  complexityRows.push({ jobs: jobCount, steps: stepCount, beforeVisits: oldWork.counts.stepVisits, afterVisits: newWork.counts.stepVisits,
    beforeParses: oldWork.counts.jsonParses, afterParses: newWork.counts.jsonParses })
}
const duplicates = makeScaleFixture(128, 4, true)
const duplicateBefore = countWork(before, duplicates)
const duplicateAfter = countWork(after, duplicates)
assert.deepEqual(duplicateAfter.modes, duplicateBefore.modes)
assert.deepEqual(duplicateBefore.counts, { stepVisits: 65536, snapshotReads: 65536, jsonParses: 65536, dateParses: 65536 })
assert.deepEqual(duplicateAfter.counts, { stepVisits: 512, snapshotReads: 512, jsonParses: 512, dateParses: 512 })
complexityRows.push({ jobs: '128 (duplicate IDs)', steps: 512, beforeVisits: 65536, afterVisits: 512, beforeParses: 65536, afterParses: 512 })

for (const fixture of [
  { ...duplicates, chapterGenerationJobs: [] },
  { ...duplicates, chapterGenerationJobs: duplicates.chapterGenerationJobs.map((value) => ({ ...value, pipelineMode: 'standard' })) }
]) {
  assert.deepEqual(countWork(after, fixture).counts, { stepVisits: 0, snapshotReads: 0, jsonParses: 0, dateParses: 0 })
}
const mixed = {
  chapterGenerationJobs: [job('legacy'), job('direct', { pipelineMode: 'standard' })],
  chapterGenerationSteps: [step('orphan', 'aggressive'), step('direct', 'aggressive'), step('legacy', 'conservative')]
}
assert.deepEqual(countWork(after, mixed).counts, { stepVisits: 3, snapshotReads: 1, jsonParses: 1, dateParses: 1 })
const unreadable = ['orphan', 'direct'].map((jobId) => ({
  jobId,
  get inputSnapshot() { throw new Error('Unneeded snapshots must not be read') }
}))
assert.deepEqual(after.normalizeAppData({ ...mixed, chapterGenerationSteps: [...unreadable, step('legacy', 'conservative')] })
  .chapterGenerationJobs.map((value) => value.pipelineMode), ['conservative', 'standard'])

console.log(`PASS: ${equivalenceCases} full-AppData equivalence cases, recipe assertions, input preservation and snapshot short-circuits.`)
console.log('PASS: deterministic complexity assertions (step visits and JSON/date parse counts).')
console.table(complexityRows)

function resolveModes(module, fixture) {
  const index = module.indexLegacyPipelineModes(fixture.chapterGenerationJobs, fixture.chapterGenerationSteps)
  return fixture.chapterGenerationJobs.map((value) => module.legacyPipelineModeForJob(value, index))
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

if (options.benchmark) {
  const fixture = makeScaleFixture(Number(options.jobs), Number(options['steps-per-job']))
  const iterations = Number(options.iterations)
  equivalent('benchmark fixture', fixture.chapterGenerationJobs, fixture.chapterGenerationSteps)
  const rows = []
  for (const [scope, run] of [
    ['mode lookup (index + all jobs)', resolveModes],
    ['complete normalizeAppData', (module, data) => module.normalizeAppData(data)]
  ]) {
    for (let warmup = 0; warmup < 2; warmup += 1) { run(before, fixture); run(after, fixture) }
    const samples = { before: [], after: [] }
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const order = iteration % 2 ? [['after', after], ['before', before]] : [['before', before], ['after', after]]
      for (const [label, module] of order) {
        const start = performance.now()
        const result = run(module, fixture)
        samples[label].push(performance.now() - start)
        assert.equal(Array.isArray(result) ? result.length : result.chapterGenerationJobs.length, fixture.chapterGenerationJobs.length)
      }
    }
    const oldMedian = median(samples.before)
    const newMedian = median(samples.after)
    rows.push({ scope, beforeMs: oldMedian.toFixed(3), afterMs: newMedian.toFixed(3), speedup: `${(oldMedian / newMedian).toFixed(2)}x` })
  }
  console.log(`Synthetic benchmark: ${options.jobs} jobs, ${fixture.chapterGenerationSteps.length} steps, ${iterations} samples, ${process.version} ${process.platform}/${process.arch}.`)
  console.log('Median wall times are informational; deterministic counts above enforce the complexity contract.')
  console.table(rows)
}
