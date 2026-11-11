import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const bundle = await build({
  stdin: {
    contents: [
      "export { getTruncatedDraftFragment } from './src/services/ChapterDraftFragmentService'",
      "export { isIncompleteChapterEnvelope, isTruncatedFinishReason, ensureChapterDraft, rawTextAsChapterDraft } from './src/services/ai/responseNormalizers/chapter'",
      "export { getChapterDraftEnvelopeError } from './src/services/ChapterDraftEnvelopeService'",
      "export { validateChapterDraftSchema } from './src/services/ai/AISchemaValidator'",
      "export { parseAiResponsePayload } from './src/main/services/AIResponseParser'",
      "export { MainAIJsonClient } from './src/main/services/MainAIJsonClient'",
      "export { AIClient } from './src/services/ai/AIClient'"
    ].join('\n'),
    resolveDir: repoRoot, loader: 'ts'
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'
})
const { getTruncatedDraftFragment, isTruncatedFinishReason, isIncompleteChapterEnvelope, getChapterDraftEnvelopeError,
  ensureChapterDraft, rawTextAsChapterDraft, validateChapterDraftSchema, parseAiResponsePayload, MainAIJsonClient, AIClient
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)

const title = '雨棚'
const fallbackTitle = '第七章'
const prose = '　　她推开木窗。\r\n\r\n“还在下吗？”'
const numberedProse = ['广播显示 [07:30]，门仍关着。', '[7号站台] 他停了下来', '[7], he read, and lowered the page.']
const raw = JSON.stringify({ title, body: prose })
const limited = ['length', 'max_tokens', 'max-tokens', 'maxTokens', 'token_limit', 'max_output_tokens',
  'MAX_COMPLETION_TOKENS', 'model_length', 'token-limit-reached']
const other = [undefined, '', 'stop', 'end_turn', 'content_filter', 'refusal', 'timeout', 'cancelled',
  'context_length_exceeded', 'not_max_tokens', 'length/content_filter', 'stop: max_tokens', 'lengthy']
const response = (rawText, finishReason, extra) => Object.freeze({ ok: false, usedAI: true, data: null, rawText, finishReason, ...extra })
const expected = (body, finishReason = 'length', name = fallbackTitle) =>
  ({ kind: 'incomplete_chapter_fragment', title: name, body, finishReason })
const extract = (rawText) => getTruncatedDraftFragment(response(rawText, 'length'), fallbackTitle)
const payload = (finish_reason, message) => parseAiResponsePayload({ choices: [{ finish_reason, message }] })

test('only explicit provider limit codes qualify, independently of punctuation', () => {
  for (const reason of limited) assert.equal(isTruncatedFinishReason(` ${reason} `), true, reason)
  for (const reason of other) assert.equal(isTruncatedFinishReason(reason), false, String(reason))
  for (const ending of ['。', '……', '——', '”', '！', '']) {
    const body = '他停在开口前' + ending
    for (const reason of [...limited, ...other]) {
      assert.deepEqual(getTruncatedDraftFragment(response(body, reason), fallbackTitle),
        limited.includes(reason) ? expected(body, reason) : null, `finish_reason=${reason}; ending=${ending}`)
    }
  }
})

test('only rawText and uncontradicted provider metadata are evidence', () => {
  const telemetry = Object.freeze({ finishReason: 'max_output_tokens', terminationCategory: 'none' })
  assert.deepEqual(getTruncatedDraftFragment(response(raw, undefined, { telemetry }), fallbackTitle),
    expected(prose, 'max_output_tokens', title))
  for (const input of [
    response(raw, 'stop', { telemetry }), response(raw, 'content_filter', { telemetry }),
    response(raw, 'length', { telemetry: { finishReason: 'content_filter' } }),
    response(raw, 'length', { telemetry: { terminationCategory: 'cancelled' } }),
    response(raw, 'length', { telemetry: { terminationCategory: 'timeout' } }),
    response(raw, undefined, { error: 'finish_reason=length', parseError: 'max_tokens' }),
    response(raw, 'length', { usedAI: false }),
    response(undefined, 'length', { data: { title, body: prose }, error: prose }),
    response({ body: prose }, 'length'), response('', 'length')
  ]) assert.equal(getTruncatedDraftFragment(input, fallbackTitle), null)
})

test('recover only a whole JSON value or a closed body string; preserve its exact contents', () => {
  const body = '她写下 "A"、{B} 和 C:\\书页。\n　　雨停了。'
  const json = JSON.stringify({ title, body })
  for (const sample of [json, json.slice(0, -1), json.slice(0, -1) + ' ,', `\`\`\`json\n${json}\n\`\`\``]) {
    assert.deepEqual(extract(sample), expected(body, 'length', title))
  }
  assert.deepEqual(extract('{"body":"第一行\n第二行"}'), expected('第一行\n第二行'))
  assert.deepEqual(extract(JSON.stringify({ chapterTitle: title, chapterBody: body })), expected(body, 'length', title))
  assert.deepEqual(extract(JSON.stringify(body)), expected(body))
  assert.deepEqual(extract(JSON.stringify({ body, title: '思考' })), expected(body, 'length', '思考'))
  assert.deepEqual(getTruncatedDraftFragment(response('{"body":"雨停了。"}', 'length'), ' '),
    expected('雨停了。', 'length', '未命名章节'))
})

test('plain prose, dialogue and in-story lists are not rewritten or classified by vocabulary', () => {
  for (const body of [
    prose, ...numberedProse, '林舟把写着“本章目标”的纸揉成一团。', '“推理过程？”她问。',
    '"Wait," she said. "Leave the light on."',
    'Analysis was never his forte. He put the outline in the drawer.',
    '他在便条上列了两行：\n1. 旧钥匙\n2. 蓝手套',
    '- Bread\n- Milk\nAt the foot of the list he wrote her name.',
    '[Tuesday]\nShe had come back for the notebook.'
  ]) assert.deepEqual(extract(body), expected(body))
  assert.deepEqual(extract(`\`\`\`text\n${prose}\n\`\`\``), expected(prose))
})

test('reject half strings, bad escapes, arrays, conflicting fields and JSON debris', () => {
  for (const sample of [
    '', '  ', '……', 'null', 'true', '1e5', '{', '{"tit', '{"title":"只有标题"}',
    '{"title":"雨棚","body":', '{"body":"木窗开了', '{"body":"木窗\\', '{"body":"木窗\\u4e',
    '{"body":"她说："等等"。"}', '{"body":"雨停了。",}', '{"body":"雨停了。"} trailing',
    raw + raw, '提示：' + raw, '{"plan":' + raw, JSON.stringify([JSON.parse(raw)]),
    '{"body":null}', '{"body":23}', '{"body":["雨停了。"]}', '{"body":{"text":"雨停了。"}}',
    '{"body":"雨停了。","chapterText":"另一段。"}', '{"type":"reasoning","text":"雨停了。"}',
    '{"body":"[\\"field\\"]"}', 'title', 'chapterBody', '"body"', '"body":"不是纯正文"',
    'title, body', '她推开木窗。\n"chapterGoal": "写到这里"',
    '\x60\x60\x60json\n' + raw, '\x60\x60\x60json\n雨停了。\n\x60\x60\x60'
  ]) assert.equal(extract(sample), null, sample)
})

test('task, outline, reasoning and refusal envelopes never become prose, even inside body', () => {
  for (const text of [
    '【本章目标】\n找到钥匙。', '## 章节大纲\n1. 找到钥匙', '- 角色节拍：推开窗',
    'chapterGoal: find the key', '推理过程：先安排一次停电。', '<think>泄漏的内部推理</think>\n雨停了。',
    '<|channel|>analysis<|message|>not final prose', '[analysis]\nThe key is missing.',
    'reasoning_content: arrange a delay', 'Content filter: blocked'
  ]) {
    assert.equal(extract(text), null, text)
    assert.equal(extract(JSON.stringify({ title, body: text })), null, text)
  }
  assert.equal(extract(JSON.stringify({ refusal: prose })), null)
})

test('provider content filtering and typed private parts cannot be recovered as public text', () => {
  for (const reply of [
    payload('content_filter', { content: raw }), payload('length', { content: raw, refusal: 'refused' }),
    payload('length', { content: [{ type: 'text', text: raw }, { type: 'refusal', text: 'refused' }] }),
    payload('length', { content: [{ type: 'reasoning', text: prose }] })
  ]) {
    assert.equal(reply.result.ok, false)
    assert.equal(reply.result.content, undefined)
    assert.equal(reply.canRetryWithoutResponseFormat, false)
  }
  const mixed = payload('max_output_tokens', { content: [
    { type: 'thinking', thinking: 'private note' }, { type: 'reasoning', text: 'private note' },
    { type: 'text', text: raw.slice(0, 6) }, { type: 'output_text', text: raw.slice(6) }
  ] })
  assert.equal(mixed.result.content, raw)
  assert.equal(mixed.diagnostics.reasoningCharacters, 2 * 'private note'.length)
  assert.equal(payload('stop', { content: '' }).canRetryWithoutResponseFormat, true)
})

const brokenEnvelopes = [
  '[' + raw + ',', '[' + raw, '[' + raw + '}', '[' + raw + ',]', '{"items":[' + raw + '],',
  '章节如下：\n\x60\x60\x60json\n[' + raw + ',\n\x60\x60\x60\n以上。', '\x60\x60\x60json\n' + raw,
  raw + ']', raw + '\n[', '{"body":"雨停了。"', '{"body":"雨停了，\\'
]
const wrappedBody = '她把 ]、}、" 和 \\ 写在纸上。\n屋里的人念了三遍 \x60\x60\x60。'
const wrappedRaw = JSON.stringify({ title, body: wrappedBody })
const fullEnvelopes = [
  wrappedRaw, '以下是章节：\n' + wrappedRaw + '\n以上。',
  '以下是章节：\n\x60\x60\x60json\n' + wrappedRaw + '\n\x60\x60\x60\n以上。',
  '结果：[' + wrappedRaw + ']\n以上。', wrappedRaw.replace('\\n', '\n')
]

test('an injected ok + data cannot establish that the raw chapter envelope is complete', () => {
  for (const rawText of brokenEnvelopes) {
    const injected = { ok: true, usedAI: true, data: { title, body: prose }, rawText }
    assert.equal(isIncompleteChapterEnvelope(injected.rawText), true, rawText)
    assert.match(getChapterDraftEnvelopeError(injected.rawText), /JSON/)
  }
  for (const text of [...fullEnvelopes, '[' + raw + ']', prose, ...numberedProse, '[Tuesday]\nA letter arrived.']) {
    assert.equal(isIncompleteChapterEnvelope(text), false, text)
    assert.equal(getChapterDraftEnvelopeError(text), null)
  }
  assert.equal(getChapterDraftEnvelopeError(undefined), null)
})

for (const Client of [AIClient, MainAIJsonClient]) {
  test(`${Client.name}: stop or absent reason cannot promote a sliced inner chapter`, async () => {
    let wire
    const client = new Client({ apiProvider: 'local' }, { chatCompletion: async () => wire })
    const asProse = (text) => rawTextAsChapterDraft(text, fallbackTitle)
    for (const finishReason of ['stop', undefined]) {
      for (const content of brokenEnvelopes) {
        wire = { ok: true, content, finishReason }
        const result = await client.requestJson('', '', ensureChapterDraft, null, asProse, validateChapterDraftSchema)
        assert.equal(result.ok, false, content)
        assert.equal(result.data, null)
        assert.equal(result.rawText, content)
        assert.equal(result.finishReason, finishReason)
        assert.equal(result.parseError, getChapterDraftEnvelopeError(content))
        assert.equal(getTruncatedDraftFragment(result, fallbackTitle), null)
      }
    }
    wire = { ok: true, content: '[' + raw + ',', finishReason: 'stop' }
    let fallbackCalls = 0
    const fallback = () => { fallbackCalls++; return { title, body: prose } }
    assert.equal((await client.requestJson('', '', ensureChapterDraft, null, fallback)).ok, false)
    assert.equal((await client.requestJson('', '', (v) => v, null, fallback, validateChapterDraftSchema)).ok, false)
    assert.equal(fallbackCalls, 0)
    for (const content of fullEnvelopes) {
      wire = { ok: true, content, finishReason: 'stop' }
      const result = await client.requestJson('', '', ensureChapterDraft, null, asProse, validateChapterDraftSchema)
      assert.equal(result.ok, true, content)
      assert.deepEqual(result.data, { title, body: wrappedBody })
    }
    for (const finishReason of ['stop', undefined]) {
      for (const content of [prose, ...numberedProse]) {
        wire = { ok: true, content, finishReason }
        const result = await client.requestJson('', '', ensureChapterDraft, null, asProse, validateChapterDraftSchema)
        assert.equal(result.ok, true, content)
        assert.equal(result.data.body, content.trim())
      }
    }
    wire = { ok: true, content: '[{"summary":"雨停了。"},', finishReason: 'stop' }
    assert.deepEqual((await client.requestJson('', '', (v) => v, null)).data, { summary: '雨停了。' })
  })

  test(`${Client.name}: provider limit survives the parser and client as failed, never accepted`, async () => {
    let reply
    const client = new Client({ apiProvider: 'local' }, { chatCompletion: async () => reply.result })
    for (const reason of limited) {
      reply = payload(reason, { content: [{ type: 'text', text: raw }], reasoning_content: 'not output' })
      const result = await client.requestJson('', '', assert.fail, null, assert.fail)
      assert.equal(result.ok, false)
      assert.equal(result.data, null)
      assert.equal(result.rawText, raw)
      assert.equal(result.finishReason, reason)
      assert.deepEqual(getTruncatedDraftFragment(Object.freeze(result), fallbackTitle), expected(prose, reason, title))
      reply = payload(reason, { content: '', reasoning_content: 'not output' })
      assert.equal(reply.canRetryWithoutResponseFormat, false)
      assert.match(reply.result.error, /Max Tokens/)
      assert.equal(getTruncatedDraftFragment(await client.requestJson('', '', assert.fail, null), fallbackTitle), null)
    }
    reply = payload('stop', { content: raw })
    const complete = await client.requestJson('', '', (value) => value, null)
    assert.equal(complete.ok, true)
    assert.deepEqual(complete.data, { title, body: prose })
    assert.equal(getTruncatedDraftFragment(complete, fallbackTitle), null)
  })
}
