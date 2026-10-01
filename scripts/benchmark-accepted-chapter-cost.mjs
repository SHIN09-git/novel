#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { build } from 'esbuild'
import { createLongNovelFixture, LONG_NOVEL_FIXTURE_VERSION, LONG_NOVEL_PROJECT_ID } from './fixtures/long-novel-performance.mjs'
import { repoRoot } from './utils/repo-root.mjs'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function percentile(sorted, value) {
  return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)]
}

function inside(parent, target) {
  const path = relative(parent, target)
  return Boolean(path) && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function completeFixture(data) {
  for (const trace of data.generationRunTraces) {
    for (const call of trace.aiCalls) call.stepId = `${trace.jobId}-${call.stepType}`
  }
  return Object.assign(data, {
    revisionSessions: [], revisionRequests: [], revisionVersions: [], revisionCandidates: [], revisionCommitBundles: []
  })
}

const iterations = Number(argument('--iterations', '20'))
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) throw new Error('--iterations must be an integer from 1 to 1000')
const warmups = Number(argument('--warmups', '3'))
if (!Number.isInteger(warmups) || warmups < 0 || warmups > 100) throw new Error('--warmups must be an integer from 0 to 100')
const outputArg = argument('--output', '')
const tempRoot = resolve(repoRoot, 'tmp')
const outputPath = outputArg
  ? (isAbsolute(outputArg) ? resolve(outputArg) : resolve(repoRoot, outputArg))
  : join(tempRoot, 'performance', 'accepted-chapter-cost.json')
assert(inside(tempRoot, outputPath), '--output must resolve inside the repository tmp directory')
assert(dirname(outputPath) === join(tempRoot, 'performance'), '--output must be directly inside tmp/performance')
assert(/^accepted-chapter-cost(?:-[a-z0-9._-]+)?\.json$/i.test(basename(outputPath)), '--output must use an accepted-chapter-cost*.json filename')
await mkdir(tempRoot, { recursive: true })
await mkdir(dirname(outputPath), { recursive: true })
assert(inside(await realpath(tempRoot), await realpath(dirname(outputPath))), 'resolved output directory must remain inside tmp')
try {
  assert(!(await lstat(outputPath)).isSymbolicLink(), '--output must not be a symbolic link')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const outDir = await mkdtemp(join(tempRoot, 'accepted-chapter-cost-benchmark-'))

try {
  const outfile = join(outDir, 'accepted-chapter-cost.mjs')
  await build({
    entryPoints: [join(repoRoot, 'src/services/AcceptedChapterCostService.ts')],
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'
  })
  const { measureAcceptedChapterCost } = await import(pathToFileURL(outfile).href)
  const measurements = []
  for (const chapterCount of [10, 100, 500]) {
    const data = completeFixture(createLongNovelFixture(chapterCount))
    const chapterId = `perf-chapter-${chapterCount}`
    for (let i = 0; i < warmups; i++) measureAcceptedChapterCost({ data, projectId: LONG_NOVEL_PROJECT_ID, chapterId })
    const samplesMs = []
    let checksum = 0
    for (let i = 0; i < iterations; i++) {
      const started = performance.now()
      const result = measureAcceptedChapterCost({ data, projectId: LONG_NOVEL_PROJECT_ID, chapterId })
      samplesMs.push(performance.now() - started)
      checksum += result.callCount + result.totalTokens.known
    }
    const sorted = [...samplesMs].sort((a, b) => a - b)
    measurements.push({
      chapterCount,
      targetChapterId: chapterId,
      fixtureSha256: sha256(JSON.stringify(data)),
      iterations,
      warmups,
      minMs: Number(sorted[0].toFixed(3)),
      medianMs: Number(percentile(sorted, 0.5).toFixed(3)),
      p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
      maxMs: Number(sorted.at(-1).toFixed(3)),
      meanMs: Number((samplesMs.reduce((total, value) => total + value, 0) / samplesMs.length).toFixed(3)),
      samplesMs: samplesMs.map((value) => Number(value.toFixed(3))),
      checksum
    })
  }
  const output = {
    benchmark: 'accepted-chapter-cost-pure-statistics',
    measuredAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      node: process.version,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem()
    },
    methodology: {
      clock: 'performance.now()',
      percentile: 'Nearest rank over recorded samples after warmup.',
      outputPolicy: 'JSON output is restricted to the repository tmp directory.'
    },
    sourceHashes: Object.fromEntries(await Promise.all([
      'src/services/AcceptedChapterCostService.ts',
      'scripts/fixtures/long-novel-performance.mjs',
      'scripts/benchmark-accepted-chapter-cost.mjs'
    ].map(async (file) => [file, sha256(await readFile(join(repoRoot, file)))]))),
    fixture: {
      name: 'long-novel-performance',
      version: LONG_NOVEL_FIXTURE_VERSION,
      synthetic: true,
      usage: 'mock',
      networkRequests: false,
      claimBoundary: 'Runtime and coverage verification only; not literary quality, real provider cost, or cost improvement.'
    },
    measurements
  }
  const json = `${JSON.stringify(output, null, 2)}\n`
  await writeFile(outputPath, json, 'utf8')
  process.stdout.write(json)
} finally {
  await rm(outDir, { recursive: true, force: true })
}
