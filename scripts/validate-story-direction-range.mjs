import assert from 'node:assert/strict'
import test from 'node:test'
import { loadDomainModules } from './utils/load-domain-modules.mjs'

const { normalizeAppData, normalizeStoryDirectionGuide: normalize, normalizeGenerationRunTrace, StoryDirectionService,
  inspectStoryDirectionRange, MAX_STORY_DIRECTION_CHAPTERS: cap, StoryDirectionAI, AIClient, WorldManagementService: world,
  projectData, runPipelineFromStepEngine, createEmptyChapterTask } = await loadDomainModules(
  'shared/defaults', 'shared/storyDirectionRange', 'shared/normalizers/storyDirection', 'shared/normalizers/runTrace',
  'services/StoryDirectionService', 'services/ai/StoryDirectionAI', 'services/ai/AIClient', 'services/WorldManagementService',
  'renderer/src/utils/projectData', 'renderer/src/views/generation/pipelineRunnerEngine')

const at = '2026-01-01T00:00:00.000Z'
const projectId = 'range-test', project = { id: projectId, name: '章段试写' }
const positions = (start, count) => Array.from({ length: count }, (_, i) => ({
  chapterOffset: i + 1, chapterOrder: start + i, goal: '核对清单-' + (start + i)
}))
const guide = (start, end, extra = {}) => normalize({ id: 'guide-' + start, projectId, title: '清单', status: 'active',
  startChapterOrder: start, endChapterOrder: end, chapterBeats: positions(start, end - start + 1), ...extra })
const seed = () => normalizeAppData({ projects: [project] })
const input = (range) => ({ project, userRawIdea: '', userPolishedIdea: '', stageSummaries: [], recentChapters: [],
  activeForeshadowings: [], characters: [], timelineEvents: [], storyBible: null, ...range })
const source = { kind: 'agent_director', reason: '合成章段验收', requestedAt: at }
const command = patch => ({ projectId, entity: 'story_direction', action: 'create', operationId: 'new', source, patch: { title: '章段', ...patch } })

test('旧 5/10 原样往返；没有有效结束章时，不把默认值或节拍当作冲突证据', () => {
  for (const count of [5, 10]) {
    const old = guide(91, 90 + count)
    assert.deepEqual(normalize(old), old)
    for (const endChapterOrder of [undefined, null, 0, 90, 96.5, '96', Infinity]) {
      const read = normalize({ ...old, endChapterOrder, chapterBeats: positions(91, 6) })
      assert.deepEqual([read.startChapterOrder, read.endChapterOrder, read.horizonChapters], [91, 90 + count, count])
      assert.deepEqual(read.warnings, [])
      assert.equal(read.chapterBeats.length, 6, 'normalization must not discard beats')
    }
  }
  for (const count of [1, 6, cap]) {
    assert.deepEqual(normalize({ startChapterOrder: 91, endChapterOrder: 90 + count }).warnings, [])
  }
  const old = { ...guide(91, 96), horizonChapters: 5, warnings: ['作者备注'] }
  const read = normalize(old)
  assert.equal(read.horizonChapters, 6)
  assert.deepEqual(old.warnings, ['作者备注'])
  assert.match(read.warnings[1], /冲突.*5 章.*91-96.*6 章/)
  assert.deepEqual(normalize(read), read)
  const oversized = normalize({ ...old, endChapterOrder: 91 + cap })
  assert.equal(oversized.endChapterOrder, 91 + cap)
  assert.equal(oversized.horizonChapters, cap + 1)
  assert.match(oversized.warnings.join(' '), /最多/)
  assert.equal(StoryDirectionService.getActiveGuideForChapter([oversized], projectId, 91), null)
})

test('新输入不取整、不钳位；区间上限适用于跨度，不限制全书章号', async () => {
  const noRequest = new StoryDirectionAI({ requestJson: () => assert.fail('invalid input reached the model') })
  for (const [startChapterOrder, endChapterOrder, horizonChapters, reason] of [
    [0, 96, undefined, /起始/], [91.5, 96, undefined, /起始/], ['91', 96, undefined, /起始/],
    [91, null, 5, /结束/], [91, 0, 10, /结束/], [91, 90, undefined, /不能早于/], [91, 96.1, undefined, /结束/],
    [91, '96', undefined, /结束/], [91, 91 + cap, undefined, /最多/], [91, undefined, cap + 1, /horizonChapters/],
    [91, 96, -1, /horizonChapters/], [91, undefined, 1.5, /horizonChapters/],
    [Number.MAX_SAFE_INTEGER, undefined, 5, /结束/], [1, Number.MAX_SAFE_INTEGER + 1, undefined, /结束/]
  ]) {
    const range = { startChapterOrder, endChapterOrder, horizonChapters }
    assert.throws(() => world.preview(seed(), command(range)), reason)
    const failed = await noRequest.generateStoryDirectionGuide(input(range))
    assert.equal(failed.data, null)
    assert.equal(failed.usedAI, false)
    assert.match(failed.error, reason)
  }
  assert.equal(inspectStoryDirectionRange(Number.MAX_SAFE_INTEGER, undefined, 1).range.endChapterOrder, Number.MAX_SAFE_INTEGER)
  assert.equal(inspectStoryDirectionRange(9001, 9000 + cap).range.horizonChapters, cap)
})

test('AI 只接受逐章匹配的完整节拍；本地模板和旧长度调用使用同一范围', async () => {
  const requests = []
  let reply
  const ai = new StoryDirectionAI(new AIClient({ apiProvider: 'local' }, { chatCompletion: async request => {
    requests.push(request.messages.map(message => message.content).join('\n'))
    return { ok: true, finishReason: 'stop', content: JSON.stringify(reply) }
  } }))
  const local = new StoryDirectionAI(new AIClient(undefined, { chatCompletion: () => assert.fail('local template contacted a model') }))
  for (const [start, count] of [[91, 6], [96, 1], [1, 1], [200, cap]]) {
    const end = start + count - 1, expected = positions(start, count)
    reply = { chapterBeats: [...expected].reverse() }
    const range = { startChapterOrder: start, endChapterOrder: end }
    const result = await ai.generateStoryDirectionGuide(input(range))
    assert.equal(result.ok, true)
    assert.equal(result.usedAI, true)
    assert.match(requests.at(-1), new RegExp('第 ' + start + '-' + end + ' 章.*恰好有 ' + count + ' 个节拍'))
    const fallback = await local.generateStoryDirectionGuide(input(range))
    assert.equal(fallback.usedAI, false)
    for (const r of [result, fallback]) {
      assert.deepEqual(r.data.chapterBeats.map(b => [b.chapterOffset, b.chapterOrder]), expected.map(b => [b.chapterOffset, b.chapterOrder]))
    }
  }
  for (const count of [5, 10]) {
    const result = await local.generateStoryDirectionGuide(input({ startChapterOrder: 91, horizonChapters: count }))
    assert.equal(result.data.chapterBeats.at(-1).chapterOrder, 90 + count)
  }
  const six = positions(91, 6), range = input({ startChapterOrder: 91, endChapterOrder: 96, horizonChapters: 5 })
  reply = { chapterBeats: six }
  assert.match((await ai.generateStoryDirectionGuide(range)).data.warnings.join(' '), /冲突.*6 章/)
  for (const [beats, reason] of [
    [undefined, /数组/], [six.slice(1), /缺少章号：91/], [[...six, six[0]], /实际返回 7/],
    [[...six.slice(0, 5), six[3]], /重复/], [[...six.slice(0, 5), { chapterOrder: 97, chapterOffset: 7 }], /越界/],
    [[...six.slice(0, 5), { chapterOrder: 96, chapterOffset: 5 }], /序号应为 6/],
    ...[{ chapterOffset: 6 }, { chapterOrder: 96 }, { chapterOrder: 96, chapterOffset: 1.5 },
      { chapterOrder: '96', chapterOffset: 6 }, null].map(beat => [[...six.slice(0, 5), beat], /正整数/])
  ]) {
    reply = { chapterBeats: beats }
    const calls = requests.length, result = await ai.generateStoryDirectionGuide(range)
    assert.equal(requests.length, calls + 1)
    assert.equal(result.ok, false)
    assert.equal(result.usedAI, true)
    assert.equal(result.data, null)
    assert.match(result.error, reason)
  }
})

test('Agent 区间编辑只改指定端点，只有实际提供的冲突长度才预警；旧预览不能覆盖新版本', () => {
  const data = seed(), create = command({ startChapterOrder: 91, horizonChapters: 5 })
  const created = world.preview(data, create)
  assert.equal(created.after.endChapterOrder, 95)
  const apply = (state, cmd, preview) => world.apply(state, { ...cmd, expectedFingerprint: preview.fingerprint }, { authorizationGrantId: 'fixture' })
  const saved = apply(data, create, created).data
  const update = { ...create, action: 'update', id: created.id, operationId: 'update', patch: { endChapterOrder: 96, chapterBeats: positions(91, 6) } }
  const updated = world.preview(saved, update)
  assert.equal(updated.after.horizonChapters, 6)
  assert.deepEqual(updated.after.warnings, [])
  const conflict = world.preview(saved, { ...update, patch: { ...update.patch, horizonChapters: 5 } })
  assert.match(conflict.after.warnings.join(' '), /冲突.*91-96.*6/)
  const activate = { ...update, operationId: 'activate', action: 'set_status', patch: { status: 'active' } }
  const oldPreview = world.preview(saved, activate)
  const next = apply(saved, update, updated).data
  assert.deepEqual(next.storyDirectionGuides[0].chapterBeats, updated.after.chapterBeats)
  assert.throws(() => apply(next, activate, oldPreview), /changed since preview/)
  for (const [beat, message] of [[{ chapterOrder: 97 }, /越界/], [{ chapterOffset: 0 }, /正整数/],
    [{ chapterOrder: 91, chapterOffset: 2 }, /序号/]]) {
    assert.throws(() => world.preview(next, { ...update, operationId: 'bad', patch: { chapterBeats: [beat] } }), message)
  }
  assert.throws(() => world.preview(next, { ...update, operationId: 'duplicate', patch: { chapterBeats: [positions(91, 1)[0], positions(91, 1)[0]] } }), /重复/)
})

async function buildContext(live, target, snapshot = null, task = null) {
  const job = { id: 'job', projectId, targetChapterOrder: target, contextSource: snapshot ? 'prompt_snapshot' : 'auto',
    promptContextSnapshotId: snapshot?.id, chapterTaskSnapshot: task, pipelineMode: 'standard', createdAt: at, updatedAt: at }
  const steps = ['context_need_planning', 'context_budget_selection', 'build_context'].map(type => ({
    id: type, type, jobId: job.id, projectId, status: 'pending', output: '', createdAt: at, updatedAt: at
  }))
  const data = normalizeAppData({ projects: [project], storyDirectionGuides: [live], chapterGenerationJobs: [job],
    chapterGenerationSteps: steps, promptContextSnapshots: snapshot ? [snapshot] : [] })
  const options = { targetChapterOrder: target, pipelineMode: 'standard', estimatedWordCount: '2000',
    readerEmotionTarget: '', budgetMode: 'standard', budgetMaxTokens: 16000 }
  const out = await runPipelineFromStepEngine(data, job.id, steps[0].type, options, {
    ...options, data, scoped: projectData(data, projectId), project: data.projects[0], aiSettings: data.settings, runId: job.id,
    getAiService: () => assert.fail('building context must not call AI'), persistWorking: async value => value,
    updateStepInData: (value, id, patch) => ({ ...value,
      chapterGenerationSteps: value.chapterGenerationSteps.map(step => step.id === id ? { ...step, ...patch } : step) })
  })
  const built = out.chapterGenerationSteps.find(step => step.type === 'build_context')
  assert.equal(built.status, 'completed', out.chapterGenerationSteps.map(step => step.errorMessage).join(' '))
  return { prompt: built.output, trace: out.generationRunTraces[0], plan: out.contextNeedPlans[0] }
}

test('实际需求规划、预算、Prompt、Trace 和快照回放只记录本章节拍', async () => {
  const live = guide(91, 96), single = guide(96, 96)
  for (const [g, order] of [[live, 91], [live, 96], [single, 96], [guide(1, 1), 1]]) {
    const { prompt, trace, plan } = await buildContext(g, order)
    assert.ok(prompt.includes('覆盖章节：第 ' + g.startChapterOrder + '-' + g.endChapterOrder + ' 章'))
    assert.ok(prompt.includes('核对清单-' + order))
    assert.ok(g.chapterBeats.every(b => b.chapterOrder === order || !prompt.includes(b.goal)))
    assert.ok(plan.contextNeeds.some(need => need.sourceHint === 'storyDirection' && need.sourceId === g.id))
    assert.equal(trace.storyDirectionBeatId, g.chapterBeats.find(b => b.chapterOrder === order).id)
    assert.equal(trace.storyDirectionGuideHorizon, g.horizonChapters)
    assert.equal(trace.storyDirectionAppliedToChapterTask, true)
    assert.ok(trace.promptBlockOrder.some(b => b.kind === 'story_direction' && b.included && b.tokenEstimate > 0))
    assert.equal(normalizeGenerationRunTrace(trace).storyDirectionGuideHorizon, g.horizonChapters)
  }
  for (const [order, task] of [[90, null], [97, null], [96, createEmptyChapterTask()]]) {
    const { prompt, trace } = await buildContext(live, order, null, task)
    assert.ok(!prompt.includes('核对清单-'))
    assert.equal(trace.storyDirectionGuideHorizon, null)
  }
  const stored = { id: 'snap', projectId, targetChapterOrder: 96, storyDirectionGuide: { ...live, horizonChapters: 5 },
    finalPrompt: StoryDirectionService.formatForPrompt(live, 96) }
  const snap = normalizeAppData({ promptContextSnapshots: [stored] }).promptContextSnapshots[0]
  assert.equal(snap.storyDirectionGuide.horizonChapters, 6)
  assert.match(snap.storyDirectionGuide.warnings.join(' '), /冲突/)
  const { trace } = await buildContext(single, 96, snap)
  assert.equal(trace.storyDirectionGuideId, live.id)
  assert.equal(trace.storyDirectionGuideHorizon, 6)
  assert.equal(trace.storyDirectionBeatId, live.chapterBeats[5].id)
  assert.equal(trace.storyDirectionAppliedToChapterTask, false)
  const absent = await buildContext(single, 96, { ...snap, finalPrompt: '本次不使用中期剧情导向。' })
  assert.equal(absent.trace.storyDirectionGuideId, null)
  assert.equal(normalizeGenerationRunTrace({ storyDirectionGuideHorizon: 5, storyDirectionGuideStartChapterOrder: 91,
    storyDirectionGuideEndChapterOrder: 96 }).storyDirectionGuideHorizon, 6)
  assert.equal(normalizeGenerationRunTrace({ storyDirectionGuideHorizon: 10 }).storyDirectionGuideHorizon, 10)
})
