import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const bundle = await build({
  stdin: { resolveDir: repoRoot, loader: 'ts', contents: `
    export * from './src/services/novelty/noveltyText';
    export { createKeywordMatcher } from './src/services/novelty/noveltyMatcher';
    export { TokenEstimator } from './src/services/TokenEstimator';
    export { PromptLintService } from './src/services/PromptLintService';
    export { renderPromptBlock, promptBlockOrderFromFinalPrompt } from './src/services/promptFormatters/promptUtils';
    export { REVISION_SYSTEM_PROMPT, buildRevisionUserPrompt } from './src/services/ai/AIPromptTemplates';
  ` }, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent'
})
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
let checks = 0
const check = (name, run) => { run(); checks++; console.log(`PASS ${name}`) }

check('same source is segmented once across different lookup terms, without cross-audit caching', () => {
  const source = '档案写明临时权限需要支付代价，顾临川已知此事。API-X 不是 APIX。'
  const prototype = Intl.Segmenter.prototype, original = prototype.segment
  let segments = 0
  prototype.segment = function (text) {
    if (text === source) segments++
    return original.call(this, text)
  }
  try {
    const run = () => api.withNoveltyAuditMemo(() => {
      for (const [term, expected] of [['临时权限', true], ['冗余池', false], ['顾临川', true], ['API', true], ['API-X', true]]) {
        assert.equal(api.textMatches(source, term), expected)
        assert.equal(api.textMatches(source, term), expected)
      }
    })
    run()
    assert.equal(segments, 1)
    run()
    assert.equal(segments, 2)
  } finally { prototype.segment = original }
})

check('prepared dictionary matching preserves source offsets and independent query results', () => {
  const text = '\u{20000}前文。ＡＰＩ 权限：【附加条款】立即生效。\n 临时权限需要支付代价。'
  const match = api.createKeywordMatcher(text)
  for (const terms of [['API'], ['附加条款', '条款'], ['临时权限'], ['APIX'], []]) {
    for (const radius of [0, 15, 130]) {
      const actual = match(terms, radius)
      assert.deepEqual(actual, api.keywordOccurrences(text, terms, radius))
      for (const item of actual) {
        assert.equal(text.slice(item.sentenceStart, item.sentenceEnd), item.sentence)
        assert.equal(text.slice(item.index, item.matchEnd).normalize('NFKC'), item.keyword)
      }
    }
  }
  const first = match(['API'])
  first[0].sentence = 'caller edited result'
  assert.notEqual(match(['API'])[0].sentence, first[0].sentence)
})

check('token estimates retain the prior Unicode and rounding semantics', () => {
  const reference = (text) => {
    if (!text?.trim()) return 0
    let cjk = 0, ascii = 0, other = 0
    for (const char of text) {
      if (/[\u4e00-\u9fff]/.test(char)) cjk++
      else if (/[\x00-\x7F]/.test(char)) ascii++
      else other++
    }
    return Math.ceil(cjk * 1.5 + ascii / 4 + other)
  }
  const texts = [null, undefined, '', ' \r\n\t', '中文 API 123', '\u{20000}\u{1f600}Ａé\ud800']
  for (let start = 0; start <= 0xffff; start += 257) {
    texts.push(Array.from({ length: 257 }, (_, offset) => String.fromCharCode(start + offset)).join(''))
  }
  for (const text of texts) assert.equal(api.TokenEstimator.estimate(text), reference(text))
})

check('prompt trace uses final rendered sections without rendering draft bodies again', () => {
  let reads = 0
  const make = (id, text, extra = {}) => ({ id, title: id, kind: 'test', priority: 1, source: 'fixture',
    sourceIds: ['source'], reason: 'fixture', enabled: true, get body() { reads++; return text }, ...extra })
  const blocks = [make('present', '正文资料\n不得改写事实。'),
    make('disabled', '不可读', { enabled: false, omittedReason: '用户关闭' }),
    make('empty', '待补充'), make('removed', 'Novelty guardrail: Do not introduce new rules.')]
  const rendered = blocks.map(api.renderPromptBlock)
  const prompt = api.PromptLintService.guardWritingPrompt(rendered.join('\n')).guardedPrompt
  const before = reads
  const trace = api.promptBlockOrderFromFinalPrompt(blocks, prompt, rendered)
  assert.equal(reads, before)
  assert.deepEqual(trace.map((item) => item.included), [true, false, false, false])
  assert.equal(trace[0].tokenEstimate, api.TokenEstimator.estimate(prompt))
  assert.deepEqual(trace[0].sourceIds, ['source'])
  assert.equal(trace[1].omittedReason, '用户关闭')
  assert.equal(trace[2].omittedReason, '模块关闭或无可用内容。')
  assert.equal(trace[3].omittedReason, '运行时 Prompt guard 已移除该区块。')
  assert.deepEqual(api.promptBlockOrderFromFinalPrompt(blocks, prompt), trace)
})

check('revision instructions include only relevant operations and preserve local/full contracts', () => {
  const request = { type: 'fix_character_knowledge', instruction: '只修正认知越界', revisionScope: 'local',
    fullChapterText: '开头。目标句。结尾。', targetRange: '目标句。' }
  const local = api.buildRevisionUserPrompt(request, '只使用已知记录')
  assert(local.includes('revisedText 必须只包含 targetRange'))
  assert(local.includes(request.fullChapterText) && local.includes(request.targetRange))
  assert(local.includes(request.instruction) && local.includes('treatmentMode'))
  assert(!local.includes('开头必须接住') && !local.includes('优先删减') && !local.includes('改善指定文本'))
  for (const type of ['fix_continuity', 'improve_continuity', 'strengthen_chapter_transition']) {
    assert(api.buildRevisionUserPrompt({ ...request, type }, '').includes('开头必须接住'))
  }
  for (const type of ['compress_pacing', 'reduce_redundancy', 'compress_description', 'remove_repeated_explanation']) {
    assert(api.buildRevisionUserPrompt({ ...request, type }, '').includes('优先删减'))
  }
  const full = api.buildRevisionUserPrompt({ ...request, revisionScope: 'full', type: 'reduce_ai_tone' }, '')
  assert(full.includes('revisedText 必须返回完整章节正文'))
  assert(!full.includes('targetRange') && !full.includes('<none>'))
  assert(full.includes('未命中规则的文字必须逐字保留'))
  assert(!full.includes('优先删减') && !full.includes('开头必须接住'))
  assert(api.REVISION_SYSTEM_PROMPT.includes('不改变剧情事实'))
  assert(api.REVISION_SYSTEM_PROMPT.includes('不新增重大设定'))
  assert(api.REVISION_SYSTEM_PROMPT.includes('严格 JSON'))
})

console.log(`Redundant work validation passed (${checks} groups).`)
