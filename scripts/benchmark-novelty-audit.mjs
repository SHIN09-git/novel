#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import os from 'node:os'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'performance', 'novelty-audit')

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function round(value) {
  return Math.round(value * 1000) / 1000
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

function repeatToSize(seed, targetCharacters) {
  let text = ''
  while (text.length < targetCharacters) text += seed
  return text.slice(0, targetCharacters)
}

const BENIGN_PARAGRAPH = [
  '管理员工位旁的旧钟又慢了一分钟，值班员向上级汇报了电梯停运情况。',
  '她沿着声音的源头走到源头书店，招牌上的“系统核心”只是一本科幻小说的书名。',
  '周烬否认存在所谓临时权限，也没有附加条款，更不可能凭空获得豁免。',
  '广播复述了昨日被划掉的句子：“区域管理员-03拥有强制放行权。”记录员随即注明该传言不成立。',
  '五米范围只是走廊的物理长度，不代表共享身份或保护机制。'
].join('')

const POSITIVE_PARAGRAPH = [
  '门禁倒计时只剩三秒，系统面板突然弹出附加条款：主角获得临时权限，可以立即强制放行。',
  '没有公告、记录或前文线索，区域管理员-03宣布核心单元可携带三名协同单元，共享身份后直接脱困。',
  '屏幕继续揭示完整真相：意识剥离后的记忆会写入冗余池，这才是系统核心的真正机制。'
].join('')

const SAMPLE_DEFINITIONS = [
  { name: 'small', characters: 2_000, iterations: 80, warmups: 12 },
  { name: 'medium', characters: 24_000, iterations: 40, warmups: 8 },
  { name: 'large', characters: 160_000, iterations: 16, warmups: 5 }
]

const chapterPlan = {
  chapterTitle: '性能样例章',
  chapterGoal: '利用已有线索继续调查，不新增规则',
  conflictToPush: '门禁倒计时持续推进',
  characterBeats: '',
  foreshadowingToUse: '',
  foreshadowingNotToReveal: '',
  endingHook: '',
  readerEmotionTarget: '紧张',
  estimatedWordCount: '3000',
  openingContinuationBeat: '',
  carriedPhysicalState: '',
  carriedEmotionalState: '',
  unresolvedMicroTensions: '',
  forbiddenResets: '',
  allowedNovelty: '无',
  forbiddenNovelty: '禁止新增救命规则、系统权限、管理员和重大设定'
}

async function loadDetector() {
  await mkdir(outDir, { recursive: true })
  const bundlePath = join(outDir, 'NoveltyDetector.benchmark.mjs')
  await build({
    entryPoints: [join(root, 'src', 'services', 'NoveltyDetector.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)
}

async function main() {
  const { NoveltyDetector } = await loadDetector()
  const results = []
  for (const definition of SAMPLE_DEFINITIONS) {
    const text = repeatToSize(`${BENIGN_PARAGRAPH}${POSITIVE_PARAGRAPH}`, definition.characters)
    const input = {
      generatedText: text,
      context: '已有角色：周烬。已有规则：门禁倒计时结束前必须离开。',
      chapterPlan
    }
    for (let index = 0; index < definition.warmups; index += 1) NoveltyDetector.audit(input)
    const durations = []
    let lastAudit = null
    for (let index = 0; index < definition.iterations; index += 1) {
      const startedAt = performance.now()
      lastAudit = NoveltyDetector.audit(input)
      durations.push(performance.now() - startedAt)
    }
    results.push({
      ...definition,
      utf8Bytes: Buffer.byteLength(text, 'utf8'),
      findings: lastAudit
        ? Object.values(lastAudit)
            .filter(Array.isArray)
            .reduce((sum, findings) => sum + findings.length, 0)
        : 0,
      timing: summarize(durations)
    })
  }

  const report = {
    benchmark: 'novelty-audit',
    measuredAt: new Date().toISOString(),
    buildMode: 'esbuild production-style Node bundle of the real NoveltyDetector implementation',
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem()
    },
    methodology: {
      clock: 'performance.now()',
      statistics: 'warmup followed by repeated samples; p50/p95 use nearest-rank percentile',
      samplesContain: 'Chinese true positives, benign prose, substring collisions, negation, quotations and proper names'
    },
    results
  }

  const outputArgument = argumentValue('--output')
  if (outputArgument) {
    const outputPath = resolve(root, outputArgument)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
