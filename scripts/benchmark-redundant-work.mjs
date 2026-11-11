import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { dirname, join, relative, resolve } from 'node:path'
import os from 'node:os'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { createLongNovelFixture } from './fixtures/long-novel-performance.mjs'

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? fallback : process.argv[index + 1]
}
const baseline = argument('--baseline-ref', execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim())
assert(/^[a-f\d]{7,40}$/.test(baseline), 'Use a commit hash as --baseline-ref')
const output = resolve(repoRoot, argument('--output', 'tmp/performance/redundant-work.json'))
const paths = [
  'src/services/novelty/noveltyMatcher.ts', 'src/services/novelty/noveltyText.ts',
  'src/services/TokenEstimator.ts', 'src/services/PromptBuilderService.ts',
  'src/services/promptFormatters/promptUtils.ts', 'src/services/ai/AIPromptTemplates.ts'
]
const referenceSources = new Map(paths.map((path) => [path,
  execFileSync('git', ['show', `${baseline}:${path}`], { cwd: repoRoot, encoding: 'utf8' })]))
async function load(reference) {
  const result = await build({
    stdin: { resolveDir: repoRoot, loader: 'ts', contents: `
      export { NoveltyDetector } from './src/services/NoveltyDetector';
      export { TokenEstimator } from './src/services/TokenEstimator';
      export { PromptBuilderService } from './src/services/PromptBuilderService';
      export { REVISION_SYSTEM_PROMPT, buildRevisionUserPrompt } from './src/services/ai/AIPromptTemplates';
      export { normalizeAppData, createEmptyBible } from './src/shared/defaults';
    ` }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'node24', logLevel: 'silent',
    plugins: reference ? [{ name: 'baseline', setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, ({ path }) => {
        const contents = referenceSources.get(relative(repoRoot, path).replaceAll('\\', '/'))
        return contents === undefined ? undefined : { contents, loader: 'ts' }
      })
    } }] : []
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const before = await load(true), after = await load(false)
const warmups = 3, iterations = 15
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const round = (n) => Number(n.toFixed(3))
  return { p50Ms: round(sorted[Math.ceil(sorted.length * 0.5) - 1]),
    p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]), samplesMs: values.map(round) }
}
function measure(name, run, dimensions) {
  const durations = { before: [], after: [] }
  let last
  for (let i = -warmups; i < iterations; i++) {
    const result = {}
    for (const label of i % 2 === 0 ? ['before', 'after'] : ['after', 'before']) {
      const start = performance.now()
      result[label] = run(label === 'before' ? before : after)
      if (i >= 0) durations[label].push(performance.now() - start)
    }
    assert.deepEqual(result.after, result.before, `${name}: observable output must not change`)
    last = result.after
  }
  const row = { name, ...dimensions, before: stats(durations.before), after: stats(durations.after),
    outputHash: createHash('sha256').update(JSON.stringify(last)).digest('hex') }
  console.log(`${name}: p50 ${row.before.p50Ms} -> ${row.after.p50Ms} ms`)
  return row
}
const repeat = (text, length) => text.repeat(Math.ceil(length / text.length)).slice(0, length)
const body = '门禁倒计时只剩三秒，系统面板突然弹出附加条款：主角获得临时权限，可以立即强制放行。区域管理员-03宣布核心单元可携带三名协同单元，共享身份后直接脱困。档案显示意识剥离后的记忆会进入冗余池。'
const context = '站台记录了雨声和脚步。值班记录写明门口的灯已经修好，旅客仍在等待下一班列车。\n'
const results = []
for (const length of [1000, 8000, 24000]) {
  const input = { generatedText: repeat(body, 2000), context: repeat(context, length), chapterPlan: null }
  results.push(measure(`novelty-context-${length}`, (api) => api.NoveltyDetector.audit(input),
    { bodyCharacters: input.generatedText.length, contextCharacters: length }))
}
for (const length of [2000, 24000, 160000]) {
  const input = { generatedText: repeat(body, length), context, chapterPlan: null }
  results.push(measure(`novelty-body-${length}`, (api) => api.NoveltyDetector.audit(input),
    { bodyCharacters: length, contextCharacters: context.length }))
}
for (const size of [10, 100, 500]) {
  const data = after.normalizeAppData(createLongNovelFixture(size))
  const project = data.projects[0]
  const input = { ...data, project, bible: after.createEmptyBible(project.id),
    config: { projectId: project.id, targetChapterOrder: size + 1, mode: 'standard',
      selectedCharacterIds: data.characters.slice(0, 2).map((item) => item.id),
      selectedForeshadowingIds: data.foreshadowings.slice(-10).map((item) => item.id),
      modules: Object.fromEntries(['bible', 'progress', 'recentChapters', 'characters', 'foreshadowing',
        'stageSummaries', 'timeline', 'chapterTask', 'forbidden', 'outputFormat'].map((key) => [key, true])),
      task: { goal: '林砚与苏宁核对车票的来源', conflict: '日期与记录不符', suspenseToKeep: '报时声的原因',
        allowedPayoffs: '', forbiddenPayoffs: '', endingHook: '门外传来敲门声', readerEmotion: '紧张',
        targetWordCount: '3000', styleRequirement: '简洁' }
    }
  }
  results.push(measure(`prompt-${size}-chapters`, (api) => {
    const result = api.PromptBuilderService.buildResult(input)
    return { finalPrompt: result.finalPrompt, promptBlockOrder: result.promptBlockOrder,
      estimatedTokens: result.estimatedTokens, warnings: result.warnings }
  }, { chapterCount: size }))
}
results.push(measure('token-estimate-24000', (api) => api.TokenEstimator.estimate(repeat(body, 24000)), { characters: 24000 }))
const revisionPrompts = ['polish_style', 'fix_character_knowledge', 'reduce_ai_tone', 'improve_continuity', 'reduce_redundancy']
  .map((type) => {
    const request = { type, instruction: '按所选类型修改', revisionScope: 'local',
      fullChapterText: '开头。目标句。结尾。', targetRange: '目标句。' }
    const prompt = (api) => `${api.REVISION_SYSTEM_PROMPT}\n${api.buildRevisionUserPrompt(request, '已知记录')}`
    const oldText = prompt(before), newText = prompt(after)
    return { type, beforeCharacters: oldText.length, afterCharacters: newText.length,
      beforeTokens: after.TokenEstimator.estimate(oldText), afterTokens: after.TokenEstimator.estimate(newText) }
  })
const report = { benchmark: 'redundant-work', measuredAt: new Date().toISOString(), baseline,
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
  method: { warmups, iterations, clock: 'performance.now', order: 'alternating before/after',
    scope: 'Real services under Node, not UI latency. Baseline replaces only the six listed modules with committed source.',
    data: 'Synthetic fixtures only; no user data, models or network. Outputs compared on every iteration except intentional revision prompt changes.',
    regression: 'Semantic parity and operation counts are gates; timings are observational.' },
  sources: {}, results, revisionPrompts }
for (const path of paths) report.sources[path] = {
  beforeSha256: createHash('sha256').update(referenceSources.get(path)).digest('hex'),
  afterSha256: createHash('sha256').update(await readFile(join(repoRoot, path))).digest('hex')
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(`Raw results: ${output}`)
