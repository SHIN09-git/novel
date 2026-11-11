import assert from 'node:assert/strict'
import { loadDomainModules } from './utils/load-domain-modules.mjs'

const { estimateProjectUsage: estimate, findProjectRate: find, normalizeProjectModelRates: normalize, priceUsageAttempt: price,
  normalizeAppData, pipelineUsagePreview, revisionMessages, chapterPlanMessages, chapterDraftMessages, RevisionAI, GenerationPipelineAI,
  buildAuthoritativeOpeningPlan } = await loadDomainModules('services/ProjectUsagePricing.ts', 'shared/normalizers/appData.ts',
  'services/ai/RevisionAI.ts', 'services/ai/GenerationPipelineAI.ts', 'services/OpeningChapterPlanGuardService.ts',
  'renderer/src/views/generation/pipelineUsagePreview.ts')
const endpoint = 'https://fixture.example', model = 'team/fixture-1', provider = 'compatible'
const base = { provider, endpoint, model, currency: 'CNY', inputPerMillionTokens: 4, outputPerMillionTokens: 7 }
const discount = { ...base, cachedInputPerMillionTokens: 1 }

const [clean] = normalize([{ ...base, currency: ' cny ', endpoint: 'https://FIXTURE.example:443/v1?token=fixture-secret',
  apiKey: 'fixture-secret', headers: { Authorization: 'private' } }])
assert.deepEqual(clean, base)
assert.deepEqual(normalize([discount, base]), [base])
assert.equal(find([clean], provider, endpoint + '/v2/custom', model), clean)
for (const args of [['openai', endpoint, model], [provider, endpoint + ':444', model], [provider, 'http://fixture.example', model],
  [provider, endpoint, model.toUpperCase()], [provider, '', model], [provider, endpoint, '']]) {
  assert.equal(find([clean], ...args), undefined)
}
for (const bad of [null, {}, { ...base, endpoint: 'file:///C:/fixture' }, { ...base, endpoint: 'https://name:password@fixture.example' },
  { ...base, endpoint: 'https://sk-x.example' }, { ...base, model: 'sk-y' },
  { ...base, model: 'abc/ghp_fixture' }, { ...base, model: 'x'.repeat(300) }, { ...base, model: 'name?key=fixture' },
  { ...base, provider: 'guess' }, { ...base, currency: '¥' }, { ...base, inputPerMillionTokens: '' },
  { ...base, outputPerMillionTokens: -1 }, { ...base, cachedInputPerMillionTokens: NaN }]) {
  assert.deepEqual(normalize([bad]), [])
}
assert.deepEqual(normalize(undefined), [])
const projects = normalizeAppData({ projects: [{ id: 'a', name: 'A', modelRates: [base] }, { id: 'b', name: 'B' },
  { id: 'c', name: 'C', modelRates: { apiKey: 'fixture' } }] }).projects
assert.deepEqual(projects[0].modelRates, [base])
assert(!('modelRates' in projects[1]) && !('modelRates' in projects[2]))
console.log('PASS origin, provider and case-sensitive model matching; project price normalization and credential rejection')

const receipt = { promptTokens: 1_000_000, completionTokens: 2_000_000, cachedPromptTokens: 250_000, reasoningTokens: 100_000 }
assert.equal(price(receipt, base), 18)
assert.equal(price(receipt, discount), 17.25)
assert.equal(price({ ...receipt, cachedPromptTokens: undefined }, discount), null)
assert.equal(price({ ...receipt, cachedPromptTokens: undefined }, { ...base, cachedInputPerMillionTokens: 4 }), 18)
assert.equal(price({ promptTokens: 0, completionTokens: 1_000_000 }, discount), 7)
assert.equal(price({ promptTokens: 0, completionTokens: 0 }, discount), 0)
assert.equal(price({ ...receipt, cachedPromptTokens: 0 }, discount), 18)
assert.equal(price(receipt, { ...base, inputPerMillionTokens: 0, outputPerMillionTokens: 0 }), 0)
for (const invalid of [undefined, { totalTokens: 8 }, { promptTokens: 2 }, { completionTokens: 0 },
  { ...receipt, promptTokens: -1 }, { ...receipt, completionTokens: 0.5 }, { ...receipt, cachedPromptTokens: 1_000_001 }]) {
  assert.equal(price(invalid, base), null)
}
assert.equal(price(receipt, undefined), null)
assert.equal(price(receipt, { ...base, provider: 'codex_cli' }), null)
console.log('PASS physical receipt pricing, unknown versus zero, disjoint cached/uncached inputs and included reasoning')

const request = { model, provider, endpoint, rates: [discount], maxTokens: 20 }
const counted = estimate({ ...request, countedInputTokens: 10 })
assert.deepEqual(counted.inputTokens, { min: 10, max: 10 })
assert.deepEqual(counted.outputTokens, { min: 0, max: 20 })
assert.deepEqual(counted.cost, { currency: 'CNY', min: 10 / 1e6, max: 180 / 1e6 })
assert.equal(counted.scope, 'single_request')
assert.equal(counted.pipelineBudget, null)
assert.equal(counted.bookBudget, null)
assert.deepEqual(estimate({ ...request, countedInputTokens: 0 }).inputTokens, { min: 0, max: 0 })
assert.deepEqual(estimate({ ...request, rates: [{ ...base, cachedInputPerMillionTokens: 8 }], countedInputTokens: 10 }).cost,
  { currency: 'CNY', min: 40 / 1e6, max: 220 / 1e6 })
for (const unknown of [{}, { messages: [] }, { messages: [{ content: '' }] }, { countedInputTokens: -1 }, { countedInputTokens: null },
  { countedInputTokens: 5.5 }, { countedInputTokens: Number.MAX_SAFE_INTEGER + 1 }, { countedInputTokens: 4, messages: [{ content: 'both' }] }]) {
  const e = estimate({ ...request, ...unknown })
  assert.equal(e.inputTokens, null)
  assert.equal(e.cost, null)
}
const messages = [{ role: 'system', content: '系统' }, { role: 'user', content: 'abcde' }]
assert.deepEqual(estimate({ ...request, messages }).inputTokens, { min: 3, max: 6 })
assert.equal(estimate({ ...request, messages, rates: [] }).pricing, 'no_rate')
assert.equal(estimate({ ...request, messages, maxTokens: null }).cost, null)
const sub = estimate({ ...request, messages, provider: 'codex_cli' })
assert.equal(sub.pricing, 'subscription'); assert.equal(sub.outputTokens, null); assert.equal(sub.cost, null)
assert(!/abcde|fixture|系统/.test(JSON.stringify(estimate({ ...request, messages }))))
console.log('PASS counted or text input; cache extremes; CLI and non-single budgets stay unknown; no message echo')

// Record the two strings sent to a local dummy client. No bridge, network or model is involved.
let captured
const dummy = { requestJson: async (sys, user, _normalize, fallback) => {
  captured = [{ role: 'system', content: sys }, { role: 'user', content: user }]
  return { ok: true, data: fallback, usedAI: false }
} }
const local = { type: 'custom', revisionScope: 'local', fullChapterText: '样例全文只用于测试。', targetRange: '只用于测试', instruction: '' }
await new RevisionAI(dummy).generateRevision(local, '样例上下文')
assert.deepEqual(revisionMessages(local, '样例上下文'), captured)
assert(captured[1].content.includes(local.fullChapterText))
const task = { goal: '合成任务', conflict: '', suspenseToKeep: '', allowedPayoffs: '', forbiddenPayoffs: '',
  endingHook: '', readerEmotion: '', targetWordCount: '300', styleRequirement: '' }
const opts = { mode: 'standard', targetChapterOrder: 2, readerEmotionTarget: '', estimatedWordCount: '300', chapterTask: task }
const gen = new GenerationPipelineAI(dummy)
const plan = (await gen.generateChapterPlan('样例上下文', opts)).data
assert.deepEqual(chapterPlanMessages('样例上下文', opts), captured)
await gen.generateChapterDraft(plan, '正文上下文', opts)
assert.deepEqual(chapterDraftMessages(plan, '正文上下文', opts), captured)
const data = normalizeAppData({ projects: [{ id: 'a', name: '临时样例', modelRates: [discount] }], settings: {
  apiProvider: provider, baseUrl: endpoint, modelName: model, pipelineModelRoles: { planner: { maxTokens: 313 }, prose: { maxTokens: 417 } } } })
const job = { projectId: 'a', id: 'qa-job', targetChapterOrder: 2, contextSource: 'auto' }
const options = { targetChapterOrder: 2, pipelineMode: 'standard', estimatedWordCount: '300', readerEmotionTarget: '', budgetMode: 'standard', budgetMaxTokens: 9000 }
const source = JSON.stringify(data)
const preview = pipelineUsagePreview(data, data.projects[0], job, 'context_need_planning', options)
assert.match(preview, /章节规划模型.*\n预计输入：[\d,]+ 至 [\d,]+ token\n预计输出：0 至 313 token\n按本书当前价目：CNY/u)
assert.equal(JSON.stringify(data), source, 'preview mutated the book')
const openingOpts = { ...opts, targetChapterOrder: 1, authoritativeChapterTask: true }
const ranges = estimate({ ...request, messages: chapterDraftMessages(buildAuthoritativeOpeningPlan(task), '', openingOpts) }).inputTokens
const savedOpening = pipelineUsagePreview(data, data.projects[0], { ...job, targetChapterOrder: 1, chapterTaskSnapshot: task,
  aiRunConfig: { ...data.settings, roles: { prose: { maxTokens: 197 } } } }, 'generate_chapter_plan', { ...options, targetChapterOrder: 1 })
assert(savedOpening.includes(`预计输入：${ranges.min.toLocaleString('zh-CN')} 至 ${ranges.max.toLocaleString('zh-CN')} token`))
assert.match(savedOpening, /正文生成模型[\s\S]*预计输出：0 至 197 token/)
assert.throws(() => pipelineUsagePreview(data, data.projects[0], { ...job, projectId: 'foreign' }, 'generate_chapter_plan', options))
assert.throws(() => pipelineUsagePreview(data, data.projects[0], { ...job, contextSource: 'prompt_snapshot', promptContextSnapshotId: 'missing' }, 'generate_chapter_plan', options))
console.log('PASS real message builders, local revision includes full text, in-memory context prep and frozen opening-draft settings')
