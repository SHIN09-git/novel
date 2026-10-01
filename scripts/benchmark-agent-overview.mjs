#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import {
  createLongNovelFixture,
  LONG_NOVEL_FIXTURE_VERSION,
  LONG_NOVEL_PROJECT_ID
} from './fixtures/long-novel-performance.mjs'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `${name} needs a value`)
  return process.argv[index + 1]
}

function inside(parent, target) {
  const path = relative(parent, target)
  return Boolean(path) && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

function percentile(samples, quantile) {
  return [...samples].sort((a, b) => a - b)[Math.max(0, Math.ceil(samples.length * quantile) - 1)]
}

function timingSummary(samples) {
  return {
    p50Ms: round(percentile(samples, 0.5)),
    p95Ms: round(percentile(samples, 0.95)),
    rawSamplesMs: samples.map(round)
  }
}

async function fileBytes(path) {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

const sizes = argument('--sizes', '10,100,500').split(',').map(Number)
const iterations = Number(argument('--iterations', '9'))
const warmups = Number(argument('--warmups', '2'))
assert(sizes.length && sizes.every((size) => Number.isInteger(size) && size >= 1 && size <= 1000))
assert(Number.isInteger(iterations) && iterations >= 1 && iterations <= 100)
assert(Number.isInteger(warmups) && warmups >= 0 && warmups <= 20)

const tmpRoot = resolve(repoRoot, 'tmp')
const outputPath = resolve(repoRoot, argument('--output', 'tmp/performance/agent-overview.json'))
const temporaryRoot = join(tmpRoot, 'performance', 'agent-overview-runs')
assert(inside(tmpRoot, outputPath), '--output must resolve inside the repository tmp directory')
assert(!basename(outputPath).includes('..'), '--output filename is invalid')

const entryPathFor = (workspace) => join(workspace, 'entry.mjs')
const toolNames = [
  'agent.listProjects',
  'agent.getProjectDigest',
  'agent.getNextChapterTarget',
  'agent.getPendingHumanReviewItems'
]

const sourceFiles = [
  'src/agent/AgentProjectOverviewRuntime.ts',
  'src/agent/AgentRuntime.ts',
  'src/agent/agentProjectOverviewData.ts',
  'src/agent/agentProjectSummaries.ts',
  'src/agent/tools/AgentToolService.ts',
  'src/agent/tools/agentOverviewReadHandlers.ts',
  'src/agent/tools/agentToolReadHandlers.ts',
  'src/storage/SqliteStorageService.ts',
  'src/storage/sqlite/sqliteSnapshot.ts',
  'src/shared/normalizers/appData.ts',
  'scripts/fixtures/long-novel-performance.mjs',
  'scripts/benchmark-agent-overview.mjs'
]

const packageInfo = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
const result = {
  schemaVersion: 1,
  benchmark: 'agent-project-overview-read',
  measuredAt: new Date().toISOString(),
  fixtureVersion: LONG_NOVEL_FIXTURE_VERSION,
  sizes,
  iterations,
  warmups,
  environment: {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
    nodeAbi: process.versions.modules,
    appVersion: packageInfo.version,
    sqliteVersion: null,
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim())
  },
  methodology: {
    clock: 'performance.now()',
    warmup: `${warmups} untimed calls per implementation before ${iterations} timed calls per implementation.`,
    order: 'Baseline and new alternate first position for each formal pair.',
    baseline: 'loadAgentRuntimeData followed by handleAgentReadTool and construction of the AgentToolService response shape.',
    newPath: 'AgentToolService.callTool using loadAgentProjectOverview and the 12-collection SQLite projection.',
    equality: 'Every baseline/new response pair is checked with assert.deepEqual.',
    cache: 'No benchmark cache; each call opens a fresh read-only SQLite connection.',
    boundaries: 'Node service latency, excluding MCP process startup, transport and Electron UI. No OS cache flush or forced GC; not a cross-machine hard latency gate.',
    outputPolicy: 'JSON output is restricted to the repository tmp directory.',
    contentPolicy: 'Synthetic fixture only; output omits prose, full AppData, and complete tool payloads.'
  },
  sourceHashes: {},
  scenarios: [],
  status: 'running'
}

for (const file of sourceFiles) {
  result.sourceHashes[file] = sha256(await readFile(join(repoRoot, file)))
}

let storage = null
let readonly = null
let workspace = null

async function buildRuntimeBundle() {
  const entryPath = entryPathFor(workspace)
  await build({
    stdin: {
      resolveDir: repoRoot,
      contents: `
        export { normalizeAppData } from './src/shared/defaults';
        export { SqliteStorageService } from './src/storage/SqliteStorageService';
        export { AgentToolService } from './src/agent/tools/AgentToolService';
        export { loadAgentRuntimeData } from './src/agent/AgentRuntime';
        export { handleAgentReadTool } from './src/agent/tools/agentToolReadHandlers';
        export { AGENT_PROJECT_OVERVIEW_COLLECTIONS } from './src/agent/agentProjectOverviewData';
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
  return import(pathToFileURL(entryPath).href)
}

function toolArguments(name, dataPath, userDataPath) {
  const base = { storagePath: dataPath, userDataPath }
  return name === 'agent.listProjects' ? base : { ...base, projectId: LONG_NOVEL_PROJECT_ID }
}

async function callBaseline(api, name, args) {
  const runtime = await api.loadAgentRuntimeData({
    storagePath: args.storagePath,
    userDataPath: args.userDataPath
  })
  const handled = api.handleAgentReadTool(name, args, runtime.data)
  assert(handled.handled, `Baseline did not handle ${name}`)
  return {
    tool: name,
    ok: true,
    storage: {
      source: runtime.source,
      storagePath: runtime.storagePath,
      userDataPath: runtime.userDataPath,
      revision: runtime.revision
    },
    data: handled.payload
  }
}

async function callNew(api, name, args) {
  return api.AgentToolService.callTool({ name, arguments: args })
}

async function measureCall(fn) {
  const started = performance.now()
  const value = await fn()
  const elapsed = performance.now() - started
  return { elapsed, value }
}

function sqlPayload(readonlyDb, collections) {
  const where = collections.length ? ` WHERE collection IN (${collections.map(() => '?').join(', ')})` : ''
  const params = collections.length ? collections : []
  const row = readonlyDb.prepare(`
    SELECT COUNT(*) AS rows, COALESCE(SUM(length(CAST(json AS BLOB))), 0) AS jsonBytes
    FROM entities${where}
  `).get(...params)
  return { rows: Number(row.rows), jsonBytes: Number(row.jsonBytes) }
}

function ratio(part, whole) {
  return whole === 0 ? null : round(part / whole)
}

async function runScenario(api, size) {
  const raw = createLongNovelFixture(size)
  const data = api.normalizeAppData(raw)
  assert.equal(data.chapters.length, size)
  assert.equal(data.chapterVersions.length, size * 2)
  assert.equal(data.chapterGenerationSteps.length, size * 14)
  assert.equal(data.chapterCommitBundles.length, size)
  assert.equal(data.generatedChapterDrafts.length, size)
  assert.equal(data.generationRunTraces.length, size)

  const dataPath = join(workspace, `novel-${size}.sqlite`)
  storage = new api.SqliteStorageService(dataPath)
  await storage.save(data)
  readonly = new Database(dataPath, { readonly: true, fileMustExist: true })
  readonly.pragma('query_only = ON')
  result.environment.sqliteVersion ??= readonly.prepare('SELECT sqlite_version() AS version').get().version

  const userDataPath = workspace
  const argsByTool = Object.fromEntries(toolNames.map((name) => [name, toolArguments(name, dataPath, userDataPath)]))
  const allEntities = sqlPayload(readonly, [])
  const overviewCollections = api.AGENT_PROJECT_OVERVIEW_COLLECTIONS
  const overviewEntities = sqlPayload(readonly, overviewCollections)
  const scenario = {
    chapters: size,
    fixture: {
      synthetic: true,
      version: LONG_NOVEL_FIXTURE_VERSION,
      appDataJsonBytes: Buffer.byteLength(JSON.stringify(data))
    },
    sqlPayload: {
      baseline: allEntities,
      new: overviewEntities,
      ratios: {
        rows: ratio(overviewEntities.rows, allEntities.rows),
        jsonBytes: ratio(overviewEntities.jsonBytes, allEntities.jsonBytes)
      }
    },
    tools: {}
  }

  for (const name of toolNames) {
    const args = argsByTool[name]
    for (let i = 0; i < warmups; i++) {
      const first = i % 2 === 0 ? callBaseline : callNew
      const second = i % 2 === 0 ? callNew : callBaseline
      const before = await first(api, name, args)
      const after = await second(api, name, args)
      assert.deepEqual(before, after, `Warmup output mismatch for ${name} at ${size} chapters`)
    }

    const beforeSamples = []
    const afterSamples = []
    let firstMeasuredBaseline = null
    let firstMeasuredNew = null
    for (let i = 0; i < iterations; i++) {
      const baselineFirst = i % 2 === 0
      const firstFn = baselineFirst ? callBaseline : callNew
      const secondFn = baselineFirst ? callNew : callBaseline
      const first = await measureCall(() => firstFn(api, name, args))
      const second = await measureCall(() => secondFn(api, name, args))
      const baseline = baselineFirst ? first : second
      const modern = baselineFirst ? second : first
      beforeSamples.push(baseline.elapsed)
      afterSamples.push(modern.elapsed)
      firstMeasuredBaseline ??= baseline.value
      firstMeasuredNew ??= modern.value
      assert.deepEqual(baseline.value, modern.value, `Output mismatch for ${name} at ${size} chapters, iteration ${i + 1}`)
    }

    scenario.tools[name] = {
      before: {
        method: 'baseline',
        ...timingSummary(beforeSamples),
        responseBytes: Buffer.byteLength(JSON.stringify(firstMeasuredBaseline))
      },
      after: {
        method: 'new',
        ...timingSummary(afterSamples),
        responseBytes: Buffer.byteLength(JSON.stringify(firstMeasuredNew))
      },
      outputsDeepEqual: true
    }
  }

  scenario.diskBytes = {
    sqlite: await fileBytes(dataPath),
    wal: await fileBytes(`${dataPath}-wal`),
    shm: await fileBytes(`${dataPath}-shm`)
  }
  readonly.close()
  readonly = null
  storage.close()
  storage = null
  return scenario
}

try {
  await mkdir(dirname(outputPath), { recursive: true })
  await mkdir(temporaryRoot, { recursive: true })
  workspace = await mkdtemp(join(temporaryRoot, 'run-'))
  assert(inside(temporaryRoot, workspace), 'Temporary workspace escaped benchmark directory')
  const api = await buildRuntimeBundle()
  for (const size of sizes) {
    const scenario = await runScenario(api, size)
    result.scenarios.push(scenario)
    process.stdout.write(`${size} chapters: completed ${toolNames.length} baseline/new comparisons\n`)
  }
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'
  result.error = error instanceof Error ? error.stack : String(error)
  process.exitCode = 1
} finally {
  readonly?.close()
  readonly = null
  storage?.close()
  storage = null
  result.finishedAt = new Date().toISOString()
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  if (workspace) {
    const tempRootReal = await realpath(temporaryRoot)
    const workspaceReal = await realpath(workspace)
    assert(inside(tempRootReal, workspaceReal), 'Refusing cleanup outside benchmark temporary directory')
    await rm(workspace, { recursive: true, force: true })
    assert(!existsSync(workspace), 'Temporary benchmark workspace was not removed')
  }
}

console.log(`Result: ${outputPath}`)
