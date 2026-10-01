#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const AUDIT_MEMO_CALL = 'return withNoveltyAuditMemo(() => NoveltyDetector.auditWithinScope(options))'

async function loadImplementation(memoEnabled) {
  const result = await build({
    stdin: {
      contents: [
        "export { NoveltyDetector } from './src/services/NoveltyDetector.ts'",
        "export { keywordOccurrences, textMatches, withNoveltyAuditMemo } from './src/services/novelty/noveltyText.ts'"
      ].join('\n'),
      resolveDir: repoRoot,
      sourcefile: 'novelty-audit-memo-validation.ts'
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
    plugins: memoEnabled ? [] : [{
      name: 'original-algorithm-without-audit-memo',
      setup(builder) {
        builder.onLoad({ filter: /[\\/]NoveltyDetector\.ts$/ }, async ({ path }) => {
          const source = await readFile(path, 'utf8')
          assert.equal(source.split(AUDIT_MEMO_CALL).length, 2, 'baseline must bypass exactly one memo entry')
          // Only the scope wrapper is bypassed; all matching and audit logic stays identical.
          return {
            contents: source.replace(AUDIT_MEMO_CALL, 'return NoveltyDetector.auditWithinScope(options)'),
            loader: 'ts'
          }
        })
      }
    }]
  })
  assert(result.outputFiles[0]?.text, 'expected an in-memory bundle')
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}

const POSITIVE_TEXT = [
  '门禁倒计时只剩三秒，系统面板突然弹出附加条款：主角获得临时权限，可以立即强制放行。',
  '没有公告、记录或前文线索，区域管理员-03宣布核心单元可携带三名协同单元，共享身份后直接脱困。',
  '屏幕继续揭示完整真相：意识剥离后的记忆会写入冗余池，这才是系统核心的真正机制。'
].join('')
const CONTEXT_TEXT = '站台记录了雨声和脚步。值班记录写明门口的灯已经修好，旅客仍在等待下一班列车。\n'
const PROBE_SOURCE = '独立缓存探针只记录雨声和脚步。'
const PROBE_TERM = '临时权限'

function fixtures() {
  const bodies = [
    POSITIVE_TEXT,
    '管理员工位旁的旧钟又慢了一分钟，值班员向上级汇报了电梯停运情况。',
    '她沿着声音的源头走到源头书店，招牌上的“系统核心”只是一本科幻小说的书名。',
    '周烬否认存在所谓临时权限，也没有附加条款，更不可能凭空获得豁免。',
    '【区域管理员－０３】首次接管此区，并授予队伍紧急权限。',
    '广播宣布：“补充条款已经生效，核心单元可携带协同单元脱困。”',
    '档案揭示完整真相：意识剥离后的记忆会进入冗余池。',
    '门外的人摘下帽子：“我叫顾临川”。',
    '系统面板没有给出权限。主角按此前约定等待。',
    ''
  ]
  const strictPlan = {
    chapterTitle: '合成测试', chapterGoal: '继续调查', conflictToPush: '', characterBeats: '',
    foreshadowingToUse: '', foreshadowingNotToReveal: '', endingHook: '', readerEmotionTarget: '',
    estimatedWordCount: '3000', openingContinuationBeat: '', carriedPhysicalState: '',
    carriedEmotionalState: '', unresolvedMicroTensions: '', forbiddenResets: '',
    allowedNovelty: '无', forbiddenNovelty: '禁止新增规则、系统权限、管理员和重大设定'
  }
  const plans = [null, strictPlan, {
    ...strictPlan,
    allowedNovelty: {
      allowedNewCharacters: ['顾临川'], allowedNewRules: ['临时权限'],
      allowedNewSystemMechanics: ['共享身份'], allowedNewOrganizationsOrRanks: [],
      allowedLoreReveals: [], notes: ''
    },
    forbiddenNovelty: ''
  }]
  const contexts = ['', '已有记录：临时权限需要支付明确代价，顾临川已经出场。', CONTEXT_TEXT.repeat(10)]
  return bodies.flatMap((generatedText) => plans.flatMap((chapterPlan) => contexts.map((context) => ({
    generatedText, context, chapterPlan, knownCharacterNames: ['周烬']
  }))))
}

function countSegments(run, source) {
  const prototype = Intl.Segmenter.prototype
  const original = prototype.segment
  let calls = 0
  prototype.segment = function (text) {
    if (source === undefined || text === source) calls += 1
    return original.call(this, text)
  }
  try {
    return { value: run(), calls }
  } finally {
    prototype.segment = original
  }
}

function validateParity(original, current) {
  const cases = fixtures()
  assert.equal(cases.length, 90)
  const sourceHints = new Set()
  for (const [index, input] of cases.entries()) {
    const expected = original.NoveltyDetector.audit(input)
    const actual = current.NoveltyDetector.audit(input)
    assert.deepEqual(actual, expected, `audit parity case ${index + 1}`)
    for (const findings of Object.values(actual).filter(Array.isArray)) {
      for (const finding of findings) if (finding.sourceHint) sourceHints.add(finding.sourceHint)
    }
  }
  assert(sourceHints.has('known_context_or_canon'), 'parity must cover prior-context sourceHint')
  assert(sourceHints.has('chapter_allowed_novelty'), 'parity must cover authorized sourceHint')
  assert(sourceHints.has('chapter_forbidden_novelty'), 'parity must cover forbidden sourceHint')

  const text = '\u{20000} 前文。ＡＰＩ 权限：【附加条款】立即生效。'
  const keywords = ['API', '附加条款']
  const expected = original.keywordOccurrences(text, keywords)
  const actual = current.withNoveltyAuditMemo(() => {
    for (const keyword of keywords) {
      current.textMatches(text, keyword)
      current.textMatches(text, keyword)
    }
    return current.keywordOccurrences(text, keywords)
  })
  assert.deepEqual(actual, expected, 'all offsets and evidence must remain identical')
  assert.equal(actual.length, 2)
  for (const occurrence of actual) {
    const matchedText = occurrence.keyword === 'API' ? 'ＡＰＩ' : occurrence.keyword
    assert.equal(occurrence.index, text.indexOf(matchedText))
    assert.equal(text.slice(occurrence.index, occurrence.matchEnd), matchedText)
    assert.equal(text.slice(occurrence.sentenceStart, occurrence.sentenceEnd), occurrence.sentence)
  }
  return cases.length
}

function validateMemoLifecycle(original, current) {
  for (const [source, expected] of [[PROBE_SOURCE, false], ['已知记录：临时权限需要付出代价。', true]]) {
    const uncached = countSegments(() => {
      assert.equal(current.textMatches(source, PROBE_TERM), expected)
      assert.equal(current.textMatches(source, PROBE_TERM), expected)
    }, source)
    const cached = countSegments(() => current.withNoveltyAuditMemo(() => {
      assert.equal(current.textMatches(source, PROBE_TERM), expected)
      assert.equal(current.textMatches(source, PROBE_TERM), expected)
    }), source)
    assert.equal(uncached.calls, 2, 'matching outside an audit must not be cached')
    assert.equal(cached.calls, 1, `${expected} must be cached with one underlying scan`)
    assert.equal(countSegments(() => current.textMatches(source, PROBE_TERM), source).calls, 1, 'successful scope must clean up')
  }

  current.withNoveltyAuditMemo(() => {
    assert.equal(current.textMatches('API X kept', 'API'), true)
    assert.equal(current.textMatches('APIX kept', 'API'), false, 'source keys must preserve raw word boundaries')
    assert.equal(current.textMatches('API X kept', 'API X'), true)
    assert.equal(current.textMatches('API X kept', 'APIX'), false, 'term keys must preserve raw word boundaries')
  })

  const input = { generatedText: POSITIVE_TEXT, context: '', chapterPlan: null }
  const expected = original.NoveltyDetector.audit(input)
  const failure = new Error('intentional audit failure')
  const failingInput = {
    ...input,
    get generatedText() {
      assert.equal(current.textMatches(PROBE_SOURCE, PROBE_TERM), false)
      throw failure
    }
  }
  const failed = countSegments(() => {
    assert.throws(() => current.NoveltyDetector.audit(failingInput), (error) => error === failure)
    current.textMatches(PROBE_SOURCE, PROBE_TERM)
  }, PROBE_SOURCE)
  assert.equal(failed.calls, 2, 'failed audit must not retain its memo')

  for (const innerThrows of [false, true]) {
    const nested = countSegments(() => current.NoveltyDetector.audit({
      ...input,
      get generatedText() {
        current.textMatches(PROBE_SOURCE, PROBE_TERM)
        const innerInput = {
          ...input,
          get generatedText() {
            current.textMatches(PROBE_SOURCE, PROBE_TERM)
            if (innerThrows) throw failure
            return input.generatedText
          }
        }
        if (innerThrows) {
          assert.throws(() => current.NoveltyDetector.audit(innerInput), (error) => error === failure)
        } else {
          assert.deepEqual(current.NoveltyDetector.audit(innerInput), expected)
        }
        current.textMatches(PROBE_SOURCE, PROBE_TERM)
        return input.generatedText
      }
    }), PROBE_SOURCE)
    assert.equal(nested.calls, 2, 'inner audit needs its own memo and must restore the outer memo')
    assert.deepEqual(nested.value, expected, 'nested audit must preserve the outer result')
    assert.equal(countSegments(() => current.textMatches(PROBE_SOURCE, PROBE_TERM), PROBE_SOURCE).calls, 1)
  }

  let body = input.generatedText
  const mutableInput = {
    ...input,
    get generatedText() {
      current.textMatches(PROBE_SOURCE, PROBE_TERM)
      return body
    }
  }
  const revised = countSegments(() => {
    const first = current.NoveltyDetector.audit(mutableInput)
    body = '这里只记录雨声和脚步，旅客仍在等待列车。'
    const second = current.NoveltyDetector.audit(mutableInput)
    assert.deepEqual(first, expected)
    assert.deepEqual(second, original.NoveltyDetector.audit({ ...input, generatedText: body }))
    assert.notDeepEqual(second, first, 'changed draft must produce a new audit')
    return second
  }, PROBE_SOURCE)
  assert.equal(revised.calls, 2, 'even identical pairs must be recomputed across audits')

  const repeatedInput = { ...input, generatedText: repeatToSize(POSITIVE_TEXT, 2000), context: repeatToSize(CONTEXT_TEXT, 1000) }
  const before = countSegments(() => original.NoveltyDetector.audit(repeatedInput))
  const after = countSegments(() => current.NoveltyDetector.audit(repeatedInput))
  assert.deepEqual(after.value, before.value)
  assert(after.calls < before.calls, 'real audit must reduce scan operations without a timing threshold')
  return { baselineSegments: before.calls, memoSegments: after.calls }
}

function repeatToSize(seed, length) {
  return seed.repeat(Math.ceil(length / seed.length)).slice(0, length)
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * ratio) - 1]
}

function benchmark(original, current) {
  const warmups = 2
  const iterations = 7
  const results = []
  for (const contextCharacters of [1000, 8000, 24000]) {
    const input = {
      generatedText: repeatToSize(POSITIVE_TEXT, 2000),
      context: repeatToSize(CONTEXT_TEXT, contextCharacters),
      chapterPlan: null
    }
    const durations = { original: [], memo: [] }
    for (let index = -warmups; index < iterations; index += 1) {
      const order = index % 2 === 0 ? [['original', original], ['memo', current]] : [['memo', current], ['original', original]]
      const audits = {}
      for (const [name, implementation] of order) {
        const started = performance.now()
        audits[name] = implementation.NoveltyDetector.audit(input)
        if (index >= 0) durations[name].push(performance.now() - started)
      }
      assert.deepEqual(audits.memo, audits.original, 'benchmark audit parity')
    }
    const summarize = (values) => ({
      p50Ms: Number(percentile(values, 0.5).toFixed(3)),
      p95Ms: Number(percentile(values, 0.95).toFixed(3)),
      samplesMs: values.map((value) => Number(value.toFixed(3)))
    })
    const row = { bodyCharacters: 2000, contextCharacters, original: summarize(durations.original), memo: summarize(durations.memo) }
    results.push(row)
    console.log(JSON.stringify(row))
  }
  return {
    benchmark: 'novelty-audit-memo',
    measuredAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
    methodology: { warmups, iterations, clock: 'performance.now()', order: 'alternating', baseline: 'identical source with only the audit memo wrapper bypassed' },
    note: 'Synthetic local inputs; no models, storage or IPC. Only the benchmark JSON is written; timings are not pass/fail thresholds.',
    results
  }
}

async function main() {
  assert(process.argv.slice(2).every((argument) => argument === '--benchmark'), 'Usage: node scripts/validate-novelty-audit-memo.mjs [--benchmark]')
  const original = await loadImplementation(false)
  const current = await loadImplementation(true)
  const parityCases = validateParity(original, current)
  const operations = validateMemoLifecycle(original, current)
  console.log(`validate-novelty-audit-memo: ${parityCases} parity cases, offsets/sourceHint, true/false caching, raw keys, exception cleanup, nested audits and changed drafts passed; scans ${operations.baselineSegments} -> ${operations.memoSegments}`)
  if (process.argv.includes('--benchmark')) {
    const report = benchmark(original, current)
    report.sourceHashes = {}
    for (const path of ['src/services/NoveltyDetector.ts', 'src/services/novelty/noveltyText.ts']) {
      report.sourceHashes[path] = createHash('sha256').update(await readFile(join(repoRoot, path))).digest('hex')
    }
    const outputDir = join(repoRoot, 'tmp/performance')
    await mkdir(outputDir, { recursive: true })
    const output = join(outputDir, 'novelty-audit-memo.json')
    await writeFile(output, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
    console.log(`Result: ${output}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
