#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { createModelComparisonCases, MODEL_COMPARISON_FIXTURE_VERSION } from './fixtures/model-comparison.mjs'
import { COMPARISON_RECIPES, comparisonHash, comparisonReviewSheet, prepareComparisonContext } from './utils/model-comparison-preflight.mjs'

const args = process.argv.slice(2)
assert(args.length === 0 || args.length === 2 && args[0] === '--output', 'Usage: --output <new-directory-under-tmp>; this tool never calls models')
const tmpRoot = resolve(repoRoot, 'tmp')
const output = resolve(repoRoot, args[1] ?? `tmp/model-comparison/preparation-${new Date().toISOString().replace(/[:.]/g, '-')}`)
function inside(root, path) {
  const rel = relative(root, path)
  return Boolean(rel) && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
assert(inside(tmpRoot, output), 'Output must be a new directory inside repository tmp')
await mkdir(tmpRoot, { recursive: true })
const parent = resolve(output, '..')
await mkdir(parent, { recursive: true })
const parentReal = await realpath(parent)
const tmpReal = await realpath(tmpRoot)
assert(parentReal === tmpReal || inside(tmpReal, parentReal), 'Output parent resolves outside repository tmp')
await mkdir(output)
const work = await mkdtemp(join(tmpRoot, 'comparison-build-'))
const originalFetch = globalThis.fetch
let networkCalls = 0
globalThis.fetch = async () => { networkCalls++; throw new Error('Network disabled in comparison preparation') }
try {
  const entry = join(work, 'preparation.mjs')
  await build({ stdin: { resolveDir: repoRoot, contents: `
    export { normalizeAppData } from './src/shared/defaults';
    export { AgentRunService } from './src/agent/AgentRunService';
    export { projectData } from './src/renderer/src/utils/projectData';
    export { runPipelineFromStepEngine } from './src/renderer/src/views/generation/pipelineRunnerEngine';
    export { pipelineContextFromStepOutput } from './src/renderer/src/views/generation/pipelineUtils';
  ` }, outfile: entry, bundle: true, format: 'esm', platform: 'node', target: 'node22', packages: 'external', logLevel: 'silent' })
  const api = await import(pathToFileURL(entry).href)
  const cases = createModelComparisonCases()
  const manifest = {
    schemaVersion: 1, preparedAt: new Date().toISOString(), fixtureVersion: MODEL_COMPARISON_FIXTURE_VERSION,
    status: 'preparing', synthetic: true, networkCalls: 0, paidCalls: 0,
    modelNames: null, providerOrCli: null, currency: null, totalSpendingCap: null,
    readiness: 'awaiting_model_and_budget_configuration',
    allowedToCallModels: false,
    limitations: [
      'This is an offline preparation tool, not a paid execution runner.',
      'Prepared context precedes ChapterPlan; final draft context must still be rebuilt by the normal workflow.',
      'Repair, retries and failed requests belong in total cost; missing usage or revision telemetry remains unknown.',
      'Do not treat provider token estimates as a guaranteed billing cap or subscription quota conversion.'
    ],
    sourceHashes: {}, runs: []
  }
  for (const file of [
    'scripts/fixtures/model-comparison.mjs', 'scripts/utils/model-comparison-preflight.mjs',
    'scripts/prepare-model-comparison.mjs', 'src/agent/AgentRunService.ts',
    'src/renderer/src/views/generation/pipelineRunnerEngine.ts',
    'src/renderer/src/views/generation/pipelineSteps/contextPlanning.ts',
    'src/renderer/src/utils/promptContext.ts', 'src/services/PromptBuilderService.ts'
  ]) manifest.sourceHashes[file] = comparisonHash(await readFile(join(repoRoot, file)))
  for (const scenario of cases) {
    const pair = []
    for (const recipe of COMPARISON_RECIPES) {
      const prepared = await prepareComparisonContext(api, scenario, recipe)
      assert(prepared.report.coverage.every((item) => item.included), `${scenario.id}: missing context ${JSON.stringify(prepared.report.coverage.filter((item) => !item.included))}`)
      pair.push(prepared.report)
      const stem = `${scenario.id}-${recipe}`
      await writeFile(join(output, `${stem}.context.txt`), prepared.prompt, 'utf8')
      await writeFile(join(output, `${stem}.json`), JSON.stringify(prepared.report, null, 2) + '\n', 'utf8')
      if (recipe === COMPARISON_RECIPES[0]) await writeFile(join(output, `${scenario.id}.seed.json`), JSON.stringify(prepared.seed, null, 2) + '\n', 'utf8')
    }
    assert.equal(pair[0].inputSha256, pair[1].inputSha256, 'Compared recipes must start with identical data and task')
    assert.equal(pair[0].contextSha256, pair[1].contextSha256, 'Compared recipes must not receive different initial facts')
    manifest.runs.push(...pair.map(({ task, promptBlockOrder, recipe, warnings, unmetNeeds, ...summary }) => summary))
  }
  assert.equal(networkCalls, 0)
  manifest.networkCalls = networkCalls
  manifest.status = 'prepared_not_executed'
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  await writeFile(join(output, 'blind-review.json'), JSON.stringify(comparisonReviewSheet(cases), null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({ ok: true, output, cases: cases.length, preparedRuns: manifest.runs.length, paidCalls: 0, status: manifest.status }))
} finally {
  globalThis.fetch = originalFetch
  assert(inside(await realpath(tmpRoot), await realpath(work)), 'Refusing cleanup outside tmp')
  await rm(work, { recursive: true, force: true })
}
