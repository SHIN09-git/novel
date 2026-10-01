#!/usr/bin/env node
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { createModelComparisonCases } from './fixtures/model-comparison.mjs'
import { COMPARISON_RECIPES, comparisonHash, comparisonReviewSheet, prepareComparisonContext } from './utils/model-comparison-preflight.mjs'

const tmpRoot = join(repoRoot, 'tmp')
await mkdir(tmpRoot, { recursive: true })
const isolate = await mkdtemp(join(tmpRoot, 'model-comparison-preparation-test-'))
let checks = 0

function inside(root, path) {
  const rel = relative(root, path)
  return Boolean(rel) && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

async function test(label, run) {
  await run()
  checks += 1
  console.log(`PASS ${label}`)
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function runNode(args) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', fail)
    child.once('close', (code) => done({ code, stdout, stderr }))
  })
}

function assertEmptyBlindScores(sheet) {
  for (const entry of sheet.cases) {
    assert.equal(entry.preferredCandidate, null)
    assert.equal(entry.willingToAccept, null)
    assert.equal(entry.afterRevisionPreference, null)
    assert.equal(entry.finalAcceptedVersionId, null)
    assert.equal(entry.totalKnownCost, null)
    assert.equal(entry.knownCalls, null)
    assert.equal(entry.failedCalls, null)
    assert.equal(entry.retryCount, null)
    assert.equal(entry.wallTimeMs, null)
    for (const item of entry.rubric) {
      assert.equal(item.candidateA, null)
      assert.equal(item.candidateB, null)
      assert.equal(item.evidence, '')
    }
  }
}

function assertSeedHasNoStartedOfflineJob(seed) {
  assert.deepEqual(seed.chapterGenerationJobs, [], 'comparison seed must not import a started generation job')
  assert.deepEqual(seed.chapterGenerationSteps, [], 'comparison seed must not import cancelled pipeline steps')
  assert.deepEqual(seed.generatedChapterDrafts, [], 'comparison seed must not import generated drafts')
  assert.deepEqual(seed.chapterVersions, [], 'comparison seed must not import accepted chapter versions')
}

async function bundleApi() {
  const outfile = join(isolate, 'comparison-api.mjs')
  await build({
    stdin: {
      resolveDir: repoRoot,
      contents: `
        export { normalizeAppData } from './src/shared/defaults';
        export { AgentRunService } from './src/agent/AgentRunService';
        export { projectData } from './src/renderer/src/utils/projectData';
        export { runPipelineFromStepEngine } from './src/renderer/src/views/generation/pipelineRunnerEngine';
        export { pipelineContextFromStepOutput } from './src/renderer/src/views/generation/pipelineUtils';
      `
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    packages: 'external',
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

try {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error('Network is forbidden in model comparison preparation validation')
  }
  try {
    const api = await bundleApi()
    const baselineCases = createModelComparisonCases()

    await test('fixture has three independent fixed scenarios', () => {
      assert.equal(baselineCases.length, 3)
      assert.equal(new Set(baselineCases.map((scenario) => scenario.id)).size, 3)
      const fresh = createModelComparisonCases()
      assert.deepEqual(fresh, baselineCases)
      baselineCases[0].appData.projects[0].name = 'mutated only here'
      assert.notEqual(createModelComparisonCases()[0].appData.projects[0].name, 'mutated only here')
      assert.deepEqual(createModelComparisonCases(), fresh)
    })

    const cases = createModelComparisonCases()
    await test('real pipeline prepares all six contexts before the model boundary', async () => {
      for (const scenario of cases) {
        const pair = []
        for (const recipe of COMPARISON_RECIPES) {
          const before = structuredClone(scenario.appData)
          const prepared = await prepareComparisonContext(api, scenario, recipe)
          const { report, seed } = prepared
          assert.equal(report.caseId, scenario.id)
          assert.equal(report.recipeId, recipe)
          assert.equal(report.stage, 'before_generate_chapter_plan')
          assert.equal(report.modelBoundaryCalls, 0)
          assert.equal(report.targetChapterOrder, scenario.targetChapterOrder)
          assert.equal(seed.settings.apiKey, '')
          assert.equal(seed.settings.hasApiKey, false)
          assert.equal(seed.generatedChapterDrafts.length, before.generatedChapterDrafts?.length ?? 0)
          assert(report.coverage.every((item) => item.included),
            `${scenario.id}/${recipe} has incomplete required coverage: ${JSON.stringify(report.coverage.filter((item) => !item.included))}`)
          for (const kind of ['character', 'character_state', 'foreshadowing', 'hard_canon', 'timeline', 'bridge']) {
            assert(report.coverage.some((item) => item.kind === kind), `${scenario.id}/${recipe} must trace ${kind} coverage`)
          }
          assert(report.coverage.filter((item) => item.kind === 'foreshadowing').every((item) => item.expectedMode), 'foreshadowing coverage must retain expected modes')
          pair.push(prepared)
        }
        assert.equal(pair[0].report.inputSha256, pair[1].report.inputSha256, `${scenario.id} recipes must share the same input`)
        assert.equal(pair[0].report.contextSha256, pair[1].report.contextSha256, `${scenario.id} recipes must share the same initial context`)
      }
      assert.equal(fetchCalls, 0)
    })

    await test('repeated preparation is content-hash stable', async () => {
      const scenario = createModelComparisonCases()[0]
      const first = await prepareComparisonContext(api, scenario, 'standard')
      const second = await prepareComparisonContext(api, scenario, 'standard')
      assert.equal(first.report.inputSha256, second.report.inputSha256)
      assert.equal(first.report.contextSha256, second.report.contextSha256)
      assert.equal(comparisonHash(first.prompt), comparisonHash(second.prompt))
      assert.equal(first.report.modelBoundaryCalls, 0)
      assert.equal(second.report.modelBoundaryCalls, 0)
      assert.equal(fetchCalls, 0)
    })

    await test('missing expected selections remain visibly uncovered', async () => {
      const scenario = createModelComparisonCases()[0]
      scenario.expected.characterIds.push('not-in-fixture')
      scenario.expected.stateFactIds.push('not-in-fixture')
      scenario.expected.hardCanonItemIds.push('not-in-fixture')
      scenario.expected.timelineEventIds.push('not-in-fixture')
      scenario.expected.foreshadowingModes['not-in-fixture'] = 'payoff'
      scenario.expected.bridgeFragments.push('not-in-fixture')
      const prepared = await prepareComparisonContext(api, scenario, 'standard')
      const missing = prepared.report.coverage.filter((item) => item.id === 'not-in-fixture' || item.included === false)
      assert(missing.length >= 6)
      assert(missing.every((item) => item.included === false), 'missing expected fields must be reported as uncovered')
      assert.equal(prepared.report.modelBoundaryCalls, 0)
      assert.equal(fetchCalls, 0)
    })

    await test('blind review sheet contains no inferred score or decision', () => {
      const sheet = comparisonReviewSheet(createModelComparisonCases())
      assert.equal(sheet.configurationRevealed, false)
      assert.equal(sheet.cases.length, 3)
      assertEmptyBlindScores(sheet)
    })

    await test('real CLI creates six offline artifacts and a seed-only import package', async () => {
      const output = join(isolate, 'prepared')
      const result = await runNode([join(repoRoot, 'scripts', 'prepare-model-comparison.mjs'), '--output', output])
      assert.equal(result.code, 0, result.stderr || result.stdout)
      const summary = JSON.parse(result.stdout.trim())
      assert.deepEqual(summary, { ok: true, output, cases: 3, preparedRuns: 6, paidCalls: 0, status: 'prepared_not_executed' })
      const manifest = await readJson(join(output, 'manifest.json'))
      assert.equal(manifest.status, 'prepared_not_executed')
      assert.equal(manifest.allowedToCallModels, false)
      assert.equal(manifest.modelNames, null)
      assert.equal(manifest.providerOrCli, null)
      assert.equal(manifest.currency, null)
      assert.equal(manifest.totalSpendingCap, null)
      assert.equal(manifest.paidCalls, 0)
      assert.equal(manifest.networkCalls, 0)
      assert.equal(manifest.runs.length, 6)
      for (const scenario of createModelComparisonCases()) {
        const reports = await Promise.all(COMPARISON_RECIPES.map((recipe) => readJson(join(output, `${scenario.id}-${recipe}.json`))))
        assert.equal(reports[0].inputSha256, reports[1].inputSha256)
        assert.equal(reports[0].contextSha256, reports[1].contextSha256)
        assert(reports.every((report) => report.modelBoundaryCalls === 0 && report.coverage.every((item) => item.included)))
        assert(await exists(join(output, `${scenario.id}-standard.context.txt`)))
        assert(await exists(join(output, `${scenario.id}-fast.context.txt`)))
        const seed = await readJson(join(output, `${scenario.id}.seed.json`))
        assert.deepEqual(api.normalizeAppData(seed), seed, `${scenario.id} seed JSON must normalize without changes`)
        assertSeedHasNoStartedOfflineJob(seed)
      }
      assertEmptyBlindScores(await readJson(join(output, 'blind-review.json')))
      assert.equal(fetchCalls, 0)
    })

    await test('CLI rejects model execution, outside tmp and existing output directories', async () => {
      const script = join(repoRoot, 'scripts', 'prepare-model-comparison.mjs')
      const existing = join(isolate, 'existing')
      await mkdir(existing)
      const forbiddenRun = await runNode([script, '--run'])
      assert.notEqual(forbiddenRun.code, 0)
      const outsideTmp = await runNode([script, '--output', join(repoRoot, 'comparison-output-forbidden')])
      assert.notEqual(outsideTmp.code, 0)
      const overwrite = await runNode([script, '--output', existing])
      assert.notEqual(overwrite.code, 0)
      assert.equal(await exists(existing), true)
    })
  } finally {
    globalThis.fetch = originalFetch
  }
} finally {
  const realTmp = resolve(tmpRoot)
  const realIsolate = resolve(isolate)
  assert(inside(realTmp, realIsolate), 'Refusing cleanup outside repository tmp')
  await rm(isolate, { recursive: true, force: true })
  assert.equal(await exists(isolate), false, 'isolated validation directory was not cleaned up')
}

console.log(JSON.stringify({ ok: true, checks }))
