#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const outputArgIndex = process.argv.indexOf('--output')
const outputPath = resolve(
  repoRoot,
  outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : 'tmp/performance/post-draft-analysis.json'
)
const bundleDir = join(repoRoot, 'tmp', 'performance', 'post-draft-analysis')
const bundlePath = join(bundleDir, 'benchmark-entry.mjs')

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

async function loadModules() {
  await mkdir(bundleDir, { recursive: true })
  await build({
    stdin: {
      contents: [
        "export { ChapterReviewAI } from './src/services/ai/ChapterReviewAI.ts'",
        "export { TokenEstimator } from './src/services/TokenEstimator.ts'"
      ].join('\n'),
      resolveDir: repoRoot,
      sourcefile: 'post-draft-benchmark-entry.ts'
    },
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)
}

function fixture() {
  const paragraph = '雨水沿站台顶棚滴落。周烬右臂的灼痛加重，他没有使用未持有的钥匙，只依据门牌和广播留下的旧线索继续判断。'
  const contextLine = '上一章结尾停在旧站台铁门前；本章任务是验证呼吸声来源，不得新增临时权限或无代价豁免。'
  return {
    chapterText: Array.from({ length: 85 }, (_, index) => `${index + 1}. ${paragraph}`).join('\n'),
    context: Array.from({ length: 38 }, (_, index) => `${index + 1}. ${contextLine}`).join('\n'),
    characters: Array.from({ length: 6 }, (_, index) => ({
      id: `character-${index + 1}`,
      name: ['周烬', '韩笑颜', '陈屿', '沈知予', '林默', '顾宁'][index],
      role: index === 0 ? '主角' : '本章相关角色',
      emotionalState: '',
      protagonistRelationship: '',
      nextActionTendency: ''
    })),
    foreshadowings: Array.from({ length: 10 }, (_, index) => ({
      id: `foreshadowing-${index + 1}`,
      title: `站台线索${index + 1}`,
      status: 'unresolved',
      weight: index < 3 ? 'high' : 'medium',
      treatmentMode: index === 0 ? 'advance' : 'hint',
      description: `第 ${index + 1} 条已登记线索，只能按当前 treatmentMode 处理。`
    }))
  }
}

function capturingClient(calls) {
  return {
    async requestJson(systemPrompt, userPrompt, _normalize, fallback) {
      calls.push({ systemPrompt, userPrompt })
      return { ok: true, usedAI: false, data: fallback }
    }
  }
}

async function runLegacy(ChapterReviewAI, data) {
  const calls = []
  const service = new ChapterReviewAI(capturingClient(calls))
  await service.generateChapterReview(data.chapterText, data.context)
  await service.updateCharacterStates(data.chapterText, data.characters, data.context)
  await service.extractForeshadowing(data.chapterText, data.foreshadowings, data.context, data.characters)
  return calls
}

async function runUnified(ChapterReviewAI, data) {
  const calls = []
  const service = new ChapterReviewAI(capturingClient(calls))
  await service.generatePostDraftAnalysis(data.chapterText, data.context, data.characters, data.foreshadowings)
  return calls
}

function inputTokens(calls, TokenEstimator) {
  return calls.reduce(
    (total, call) => total + TokenEstimator.estimate(`${call.systemPrompt}\n${call.userPrompt}`),
    0
  )
}

async function measure(fn, warmups = 8, iterations = 40) {
  for (let index = 0; index < warmups; index += 1) await fn()
  const samples = []
  let lastCalls = []
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now()
    lastCalls = await fn()
    samples.push(performance.now() - startedAt)
  }
  return {
    calls: lastCalls,
    iterations,
    p50Ms: round(percentile(samples, 0.5), 3),
    p95Ms: round(percentile(samples, 0.95), 3)
  }
}

async function main() {
  const { ChapterReviewAI, TokenEstimator } = await loadModules()
  const data = fixture()
  const legacy = await measure(() => runLegacy(ChapterReviewAI, data))
  const unified = await measure(() => runUnified(ChapterReviewAI, data))
  const legacyTokens = inputTokens(legacy.calls, TokenEstimator)
  const unifiedTokens = inputTokens(unified.calls, TokenEstimator)
  const report = {
    measuredAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    fixture: {
      chapterCharacters: data.chapterText.length,
      contextCharacters: data.context.length,
      characterCount: data.characters.length,
      foreshadowingCount: data.foreshadowings.length,
      warmups: 8,
      iterations: 40
    },
    legacy: {
      modelCalls: legacy.calls.length,
      estimatedInputTokens: legacyTokens,
      p50PromptBuildMs: legacy.p50Ms,
      p95PromptBuildMs: legacy.p95Ms
    },
    unified: {
      modelCalls: unified.calls.length,
      estimatedInputTokens: unifiedTokens,
      p50PromptBuildMs: unified.p50Ms,
      p95PromptBuildMs: unified.p95Ms
    },
    improvement: {
      modelCallReductionPercent: round((1 - unified.calls.length / legacy.calls.length) * 100, 1),
      estimatedInputTokenReductionPercent: round((1 - unifiedTokens / legacyTokens) * 100, 1)
    },
    note: 'Synthetic fixture; measures prompt construction and estimated request input, not provider latency or output quality.'
  }
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
