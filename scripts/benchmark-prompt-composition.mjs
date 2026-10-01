#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import os from 'node:os'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outputArgument = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : 'tmp/performance/prompt-composition.json'
const workDir = join(root, 'tmp', 'performance', 'prompt-composition')

function round(value) {
  return Math.round(value * 1000) / 1000
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
}

function summarize(values) {
  return {
    minMs: round(Math.min(...values)),
    p50Ms: round(percentile(values, 0.5)),
    p95Ms: round(percentile(values, 0.95)),
    maxMs: round(Math.max(...values)),
    meanMs: round(values.reduce((sum, value) => sum + value, 0) / values.length)
  }
}

function repeat(value, count) {
  return Array.from({ length: count }, () => value).join('')
}

function block(id, title, kind, source, body, priority, options = {}) {
  return {
    id,
    title,
    kind,
    priority,
    tokenEstimate: 0,
    source,
    sourceIds: options.sourceIds ?? [],
    included: true,
    compressed: options.compressed ?? false,
    forced: options.forced ?? false,
    omittedReason: null,
    reason: options.reason ?? 'synthetic benchmark block',
    body
  }
}

function renderFixture(blocks) {
  return [
    '# 性能测量用章节写作 Prompt',
    ...blocks.map((item) => `## ${item.title}\n${item.body}`)
  ].join('\n\n')
}

function fixture(name) {
  const bridge = '周烬仍站在门禁前，倒计时没有停止；韩笑颜握着旧钥匙，等待下一步判断。'
  const task = '本章目标：沿用已有线索推进调查。冲突：门禁倒计时继续收紧。结尾：留下新的选择压力。'
  const state = '角色硬状态：周烬右臂骨裂，现金余额 5000 元，持有旧地图；不得让伤势无解释消失。'
  const rules = '伏笔操作规则：本章只能轻微暗示对向站台，不得提前解释来源，不得直接回收。'
  const recent = repeat('第 17 章回顾：两人进入旧站台，记录发现一处不一致。', name === 'context-heavy' ? 36 : name === 'redundant' ? 18 : 8)
  const duplicate = name === 'redundant'
    ? '\n不得新增未铺垫救命规则。\n不得新增没有铺垫的救命规则。\n不得为了脱困而新增刚好可用的规则。\n'
    : ''
  const review = name === 'redundant' ? repeat('风险：建议后续章节保持克制。', 6) : ''
  const blocks = [
    block('bridge', '2. 上一章结尾衔接 Bridge', 'continuity_bridge', 'continuity_service', bridge, 2, { forced: true }),
    block('task', '3. 本章任务契约', 'chapter_task', 'prompt_config', task, 3),
    block('state', '4. 当前角色硬状态', 'character_state', 'characters_and_state_ledger', state, 4),
    block('rules', '5. 本章伏笔操作规则', 'foreshadowing_rules', 'foreshadowing_treatment', rules, 5),
    block('recent', '7. 最近章节详细回顾', 'recent_chapters', 'chapters', recent, 7, { compressed: name === 'context-heavy' }),
    block('style', '11. 风格要求 StyleEnvelope', 'style', 'story_bible_style', '克制、清晰，保持连续场景推进。', 11),
    block('novelty', '12. 禁止事项与 NoveltyPolicy', 'forbidden_and_novelty', 'story_bible_and_task', `${duplicate}${review}不得把低优先级资料改写成已发生事实。`, 12),
    block('output', '13. 输出格式要求', 'output_format', 'prompt_builder', '请直接输出正文，不要输出分析、注释或大纲。', 13)
  ]
  return { name, prompt: renderFixture(blocks), promptBlockOrder: blocks }
}

async function loadMetrics() {
  await mkdir(workDir, { recursive: true })
  const bundlePath = join(workDir, 'PromptCompositionMetricsService.mjs')
  await build({
    entryPoints: [join(root, 'src', 'services', 'PromptCompositionMetricsService.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)
}

async function main() {
  const { calculatePromptCompositionMetrics } = await loadMetrics()
  const scenarios = ['balanced', 'redundant', 'context-heavy']
  const warmups = 8
  const iterations = 40
  const results = []
  for (const name of scenarios) {
    const data = fixture(name)
    for (let index = 0; index < warmups; index += 1) calculatePromptCompositionMetrics(data.prompt, data.promptBlockOrder)
    const durations = []
    let metrics = null
    for (let index = 0; index < iterations; index += 1) {
      const started = performance.now()
      metrics = calculatePromptCompositionMetrics(data.prompt, data.promptBlockOrder)
      durations.push(performance.now() - started)
    }
    results.push({
      scenario: name,
      promptCharacters: data.prompt.length,
      promptUtf8Bytes: Buffer.byteLength(data.prompt, 'utf8'),
      blockCount: data.promptBlockOrder.length,
      warmups,
      iterations,
      metrics: {
        totalTokenEstimate: metrics.totalTokenEstimate,
        categoryTokenEstimates: metrics.categoryTokenEstimates,
        alertCount: metrics.alerts.length,
        repeatedSentenceCount: metrics.repeatedSentences.length,
        similarConstraintCount: metrics.similarConstraints.length
      },
      timing: summarize(durations)
    })
  }
  const report = {
    benchmark: 'prompt-composition-metrics',
    measuredAt: new Date().toISOString(),
    implementation: 'real PromptCompositionMetricsService bundled with esbuild for Node execution',
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: os.cpus().length
    },
    methodology: {
      clock: 'performance.now()',
      statistics: '8 warmups plus 40 repeated samples per scenario; p50/p95 nearest-rank percentile',
      scenarios: 'balanced, redundant constraints, and context-heavy synthetic Chinese prompts',
      dataPolicy: 'synthetic text only; no user project data is loaded or written'
    },
    results
  }
  const outputPath = resolve(root, outputArgument)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
