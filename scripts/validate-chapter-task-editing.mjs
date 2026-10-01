import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { createHookHost, withDeadline } from './utils/pipeline-bundle-handoff-fixture.mjs'

await mkdir(join(repoRoot, 'tmp'), { recursive: true })
const directory = await mkdtemp(join(repoRoot, 'tmp', 'chapter-task-edit-'))
let checks = 0
let sqlite
const originalFetch = globalThis.fetch
const originalWindow = globalThis.window, originalDocument = globalThis.document, originalHooks = globalThis.__chapterTaskBindingHooks
const skipNative = process.argv.includes('--no-native')
let requests = 0
globalThis.fetch = async () => { requests++; throw new Error('Task editing must not call a provider') }
const test = async (label, run) => { await run(); checks++; console.log(`PASS ${label}`) }
try {
  const outfile = join(directory, 'api.mjs')
  await build({ stdin: { contents: `
    export * from './src/services/ChapterTaskEditService';
    export * from './src/services/GenerationRunBundleService';
    export * from './src/services/chapterTaskEdit/contextSourceBinding';
    export * from './src/shared/defaults';
    export * from './src/services/TokenEstimator';
    export * from './src/renderer/src/utils/projectData';
    export * from './src/renderer/src/views/generation/pipelineStateRestore';
    export * from './src/renderer/src/views/generation/pipelineSteps/chapterGeneration';
    export * from './src/renderer/src/views/generation/pipelineSteps/contextPlanning';
    export * from './src/storage/SqliteStorageService';
    export * from './src/storage/JsonStorageService';
  `, loader: 'ts', resolveDir: repoRoot }, outfile, bundle: true, platform: 'node', format: 'esm', external: ['better-sqlite3'], logLevel: 'silent' })
  const api = await import(pathToFileURL(outfile).href)
  const hookFile = join(directory, 'hooks.mjs')
  await build({ stdin: { contents: `
    export {useAppData} from './src/renderer/src/hooks/useAppData';
    export {useChapterTaskEditing} from './src/renderer/src/views/generation/useChapterTaskEditing';
  `, loader: 'ts', resolveDir: repoRoot }, outfile: hookFile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'task-binding-react-shell', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'task-binding-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'task-binding-fixture' }, () => ({ contents: `
        export const useState = value => globalThis.__chapterTaskBindingHooks.state(value);
        export const useRef = value => globalThis.__chapterTaskBindingHooks.ref(value);
        export const useEffect = (fn, deps) => globalThis.__chapterTaskBindingHooks.effect(fn, deps);
      ` }))
    } }] })
  const hookApi = await import(pathToFileURL(hookFile).href)
  const timestamp = '2026-09-06T02:00:00.000Z'
  const base = api.normalizeAppData({ ...api.EMPTY_APP_DATA,
    projects: [{ id: 'p1', name: '渡口任务测试', style: '朴素克制', createdAt: timestamp, updatedAt: timestamp }, { id: 'p2', name: '其他项目', createdAt: timestamp, updatedAt: timestamp }],
    chapters: [{ id: 'c1', projectId: 'p1', order: 1, title: '旧桥', body: '沈禾停在桥头，铜铃还在衣袋里。她抬起手，没有拉动渡口的绳索。', summary: '沈禾抵达旧桥。', createdAt: timestamp, updatedAt: timestamp }],
    characters: ['沈禾', '顾宁'].map((name, i) => ({ id: `character-${i}`, projectId: 'p1', name, role: i ? '配角' : '主角', roleFunction: '沿桥寻找信使', abilitiesAndResources: '一枚铜铃', weaknessAndCost: '过桥需付船资', createdAt: timestamp, updatedAt: timestamp })),
    characterStateFacts: [{ id: 'fact1', projectId: 'p1', characterId: 'character-0', category: 'inventory', key: 'items', label: '持有物品', valueType: 'list', value: ['铜铃'], linkedCardFields: ['abilitiesAndResources'], trackingLevel: 'hard', promptPolicy: 'always', status: 'active', sourceChapterId: 'c1', sourceChapterOrder: 1, createdAt: timestamp, updatedAt: timestamp }],
    foreshadowings: [{ id: 'f1', projectId: 'p1', title: '铜铃的刻痕', description: '铃内有一行刻痕。', status: 'planted', weight: 'high', treatmentMode: 'hint', createdAt: timestamp, updatedAt: timestamp }]
  })
  const task = { ...api.createEmptyChapterTask(), goal: '沈禾在旧桥寻找信使。', conflict: '渡船无人回应。', endingHook: '绳索轻轻动了一下。', targetWordCount: '800-1200', styleRequirement: '短句，动作清楚。' }
  const input = { projectId: 'p1', targetChapterOrder: 2, task, jobId: 'task-original', createdAt: timestamp, budgetMode: 'standard', budgetMaxTokens: 12000, pipelineMode: 'standard' }
  let fresh
  await test('saving a new task prepares context without AI and preserves the source AppData', async () => {
    const before = JSON.stringify(base)
    fresh = await api.prepareChapterTaskEdit(base, input)
    assert.equal(JSON.stringify(base), before)
    assert.equal(fresh.job.status, 'idle')
    assert.equal(fresh.impact.resumeStep, 'generate_chapter_plan')
    assert.deepEqual(fresh.job.chapterTaskSnapshot, task)
    assert.equal(requests, 0)
    assert.equal(fresh.data.generatedChapterDrafts.length, 0)
    const savedSteps = fresh.data.chapterGenerationSteps.filter(step => step.jobId === fresh.job.id)
    assert.equal(savedSteps.filter(step => step.status === 'completed').length, 3)
    const context = savedSteps.find(step => step.type === 'build_context').output
    for (const field of api.CHAPTER_TASK_FIELDS) if (task[field]) assert.ok(context.includes(task[field]), field)
    assert.equal(savedSteps.find(step => step.type === 'generate_chapter_plan').status, 'pending')
  })

  const stateFor = (data, job) => {
    const steps = data.chapterGenerationSteps.filter(step => step.jobId === job.id)
    const options = JSON.parse(steps[0].inputSnapshot)
    const state = { working: data, context: '', plan: null, draftResult: null, noveltyAuditResult: null, planGapAnalysis: null, contextNeedPlanFromPlan: null, rebuiltContextFromPlan: false, draftRecord: null, contextNeedPlan: null, budgetProfile: data.contextBudgetProfiles[0], budgetSelection: null, recipeSkipReasons: [] }
    api.restorePipelineStateFromCompletedSteps(state, steps, false, true)
    return { state, steps, options }
  }
  const ctxFor = (data, job) => {
    const restored = stateFor(data, job)
    return { ...restored, job, step: restored.steps[3], snapshot: null, activeStoryDirectionGuide: null, storyDirectionTracePatch: {},
      env: { data, project: data.projects[0], scoped: api.projectData(data, 'p1'), ...restored.options, aiSettings: data.settings,
        updateStepInData: (current, id, patch) => ({ ...current, chapterGenerationSteps: current.chapterGenerationSteps.map(step => step.id === id ? { ...step, ...patch } : step) }) }
    }
  }
  const ctx = ctxFor(fresh.data, fresh.job)
  ctx.state.plan = { chapterTitle: '渡口', chapterGoal: task.goal, conflictToPush: task.conflict, characterBeats: '沈禾继续寻找信使。', foreshadowingToUse: '轻微暗示铜铃的刻痕', foreshadowingNotToReveal: '铜铃来历', endingHook: task.endingHook, readerEmotionTarget: '', estimatedWordCount: task.targetWordCount, openingContinuationBeat: '沈禾仍停在桥头。', carriedPhysicalState: '衣袋中仍有铜铃。', carriedEmotionalState: '', unresolvedMicroTensions: '', forbiddenResets: '', allowedNovelty: {}, forbiddenNovelty: {} }
  ctx.state.working = ctx.env.updateStepInData(ctx.state.working, ctx.steps[3].id, { status: 'completed', output: JSON.stringify(ctx.state.plan) })
  for (const [type, run] of [['context_need_planning_from_plan', api.runPlanContextNeedStep], ['context_budget_selection_delta', api.runContextBudgetDeltaStep], ['rebuild_context_with_plan', api.runRebuildContextWithPlanStep]]) {
    ctx.step = ctx.steps.find(step => step.type === type)
    run(ctx)
  }
  const original = { ...ctx.state.working,
    chapterGenerationJobs: ctx.state.working.chapterGenerationJobs.map(job => ({ ...job, status: 'completed' })),
    generatedChapterDrafts: [{ id: 'old-draft', jobId: fresh.job.id, projectId: 'p1', chapterId: null, title: '旧草稿', body: '旧草稿正文，不能被保存任务替换。', summary: '', status: 'draft', createdAt: timestamp, updatedAt: timestamp }]
  }
  original.generationRunTraces = original.generationRunTraces.map(trace => ({ ...trace, generatedDraftId: 'old-draft', noveltyAuditResult: { severity: 'fail', summary: 'OLD_AUDIT' }, qualityGateReportId: 'old-quality' }))
  const oldPrompt = original.chapterGenerationSteps.find(step => step.jobId === fresh.job.id && step.type === 'rebuild_context_with_plan').output
  const oldData = JSON.stringify(original)
  const editInput = { ...input, sourceJobId: fresh.job.id, sourceUpdatedAt: timestamp, jobId: 'style-edit', task: { ...task, styleRequirement: '对话简洁，保留停顿。' } }
  let style
  await test('style edits reuse the completed plan and factual sections, never old draft reports', async () => {
    style = await api.prepareChapterTaskEdit(original, editInput)
    assert.equal(style.impact.scope, 'expression')
    assert.equal(style.impact.resumeStep, 'generate_chapter_draft')
    assert.equal(JSON.stringify(original), oldData)
    const restored = stateFor(style.data, style.job)
    assert.equal(restored.state.rebuiltContextFromPlan, true)
    assert.ok(restored.state.context.includes(editInput.task.styleRequirement))
    assert.ok(!restored.state.context.includes(task.styleRequirement))
    assert.deepEqual(restored.state.budgetSelection.selectedCharacterIds, ctx.state.budgetSelection.selectedCharacterIds)
    assert.equal(restored.state.draftRecord, null)
    const sections = text => [...text.matchAll(/^(##[^\n]+)\n([\s\S]*?)(?=^##|$(?![\s\S]))/gm)]
    for (const section of sections(JSON.parse(oldPrompt).finalPrompt)) {
      if (/本章任务契约|风格要求/.test(section[1])) continue
      const nextSection = sections(restored.state.context).find(item => item[1] === section[1])
      assert.equal(nextSection?.[2].trim(), section[2].trim(), section[1])
    }
    const trace = style.data.generationRunTraces.find(item => item.jobId === style.job.id)
    assert.equal(trace.generatedDraftId, null)
    assert.equal(trace.qualityGateReportId, null)
    assert.equal(trace.noveltyAuditResult, null)
    assert.equal(trace.finalPromptTokenEstimate, api.TokenEstimator.estimate(restored.state.context))
    assert.equal(trace.contextTokenEstimate + trace.forcedContextBlocks.reduce((sum, block) => sum + block.tokenEstimate, 0), trace.finalPromptTokenEstimate)
    assert.ok(trace.promptBlockOrder.find(block => block.kind === 'chapter_task').sourceIds.includes(style.job.id))
  })
  await test('body generation receives the rebuilt prompt and edited task after restoring saved steps', async () => {
    const running = ctxFor(style.data, style.job)
    running.step = running.steps.find(step => step.type === 'generate_chapter_draft')
    let received
    running.env.getAiService = async () => ({ generateChapterDraft: async (plan, context, options) => { received = { plan, context, options }; throw new Error('CAPTURED_REQUEST') } })
    await assert.rejects(api.runGenerateChapterDraftStep(running), /CAPTURED_REQUEST/)
    assert.equal(received.context, running.state.context)
    assert.deepEqual(received.options.chapterTask, editInput.task)
    assert.ok(received.context.includes(editInput.task.styleRequirement))
  })
  await test('length edit keeps the plan but updates word count and frozen budget metadata', async () => {
    const next = await api.prepareChapterTaskEdit(original, { ...editInput, jobId: 'length-edit', task: { ...task, targetWordCount: '1800-2200' }, budgetMaxTokens: 16000 })
    const restored = stateFor(next.data, next.job)
    assert.equal(next.impact.scope, 'budget')
    assert.equal(restored.state.plan.estimatedWordCount, '1800-2200')
    assert.equal(restored.options.estimatedWordCount, '1800-2200')
    assert.equal(restored.state.budgetProfile.maxTokens, 16000)
    assert.equal(restored.state.budgetSelection.contextSelectionTrace.budgetSummary.totalBudget, 16000)
    assert.ok(restored.state.context.includes('1800-2200'))
    assert.ok(!restored.state.context.includes('800-1200'))
    assert.deepEqual(next.job.aiRunConfig, fresh.job.aiRunConfig)
  })
  await test('plot changes rebuild only deterministic context and add the newly named character', async () => {
    const next = await api.prepareChapterTaskEdit(original, { ...editInput, jobId: 'plot-edit', task: { ...task, goal: '顾宁抵达渡口，向沈禾出示铜铃的刻痕。', allowedPayoffs: '铜铃的刻痕只轻微暗示。' } })
    const restored = stateFor(next.data, next.job)
    assert.equal(next.impact.scope, 'context')
    assert.equal(next.impact.resumeStep, 'generate_chapter_plan')
    assert.equal(restored.state.plan, null)
    assert.ok(restored.state.contextNeedPlan.expectedCharacters.some(item => item.characterId === 'character-1'))
    assert.ok(restored.state.context.includes('顾宁'))
    assert.ok(restored.state.context.includes('铜铃的刻痕'))
    assert.equal(restored.steps.find(step => step.type === 'generate_chapter_plan').status, 'pending')
    assert.equal(requests, 0)
  })
  await test('tight budget, different mode or incomplete history falls back to context preparation', async () => {
    for (const patch of [{ budgetMaxTokens: 1000 }, { budgetMode: 'light' }]) {
      const next = await api.prepareChapterTaskEdit(original, { ...editInput, ...patch, jobId: `fallback-${JSON.stringify(patch)}` })
      assert.equal(next.impact.scope, 'context')
      assert.ok(next.impact.warnings.length)
    }
    const noPlan = { ...original, chapterGenerationSteps: original.chapterGenerationSteps.filter(step => step.type !== 'generate_chapter_plan') }
    assert.equal((await api.prepareChapterTaskEdit(noPlan, editInput)).impact.resumeStep, 'generate_chapter_plan')
  })
  await test('same operation is idempotent; changed payload or source ownership is rejected', async () => {
    const replay = await api.prepareChapterTaskEdit(style.data, editInput)
    assert.equal(replay.data, style.data)
    assert.equal(replay.data.chapterGenerationJobs.filter(job => job.id === style.job.id).length, 1)
    await assert.rejects(api.prepareChapterTaskEdit(style.data, { ...editInput, task }), /编号/)
    await assert.rejects(api.prepareChapterTaskEdit(original, { ...editInput, projectId: 'p2' }), /原章节任务/)
    await assert.rejects(api.prepareChapterTaskEdit(original, { ...editInput, sourceUpdatedAt: 'stale' }), /已变化/)
    assert.equal(JSON.stringify(original), oldData)
  })
  await test('manual snapshots require an explicit new context and remain unchanged', async () => {
    const snapshot = { id: 'snapshot1', projectId: 'p1', targetChapterOrder: 2, chapterTask: task, finalPrompt: 'USER_MANUAL_PROMPT', createdAt: timestamp, updatedAt: timestamp }
    const snapData = { ...base, promptContextSnapshots: [snapshot] }
    const snapInput = { ...input, sourceSnapshotId: snapshot.id }
    await assert.rejects(api.prepareChapterTaskEdit(snapData, snapInput), /手动快照/)
    const next = await api.prepareChapterTaskEdit(snapData, { ...snapInput, refreshContext: true })
    assert.deepEqual(next.data.promptContextSnapshots, [snapshot])
    assert.equal(next.job.contextSource, 'auto')
    assert.equal(next.impact.sourcePromptContextSnapshotId, snapshot.id)
  })
  await test('legacy and malformed task edits normalize without inventing execution privileges', () => {
    assert.equal(api.normalizeChapterTaskEdit(null), null)
    const normalized = api.normalizeChapterTaskEdit({ scope: 'bad', resumeStep: 'quality_gate', changedFields: ['goal', 'goal', 'unknown'], warnings: null })
    assert.equal(normalized.scope, 'context')
    assert.equal(normalized.resumeStep, 'generate_chapter_plan')
    assert.deepEqual(normalized.changedFields, ['goal'])
    assert.deepEqual(normalized.warnings, [])
    assert.equal(api.normalizeChapterTask({}).targetWordCount, api.createEmptyChapterTask().targetWordCount)
  })
  await test('complete legacy chapter-one upstream cannot reuse later character state after a style-only edit', async () => {
    const legacyJob = { ...fresh.job, targetChapterOrder: 1, chapterTaskSnapshot: undefined, taskEdit: undefined, status: 'completed' }
    const legacy = { ...fresh.data,
      characters: fresh.data.characters.map(character => ({ ...character, emotionalState: '亲眼目睹大结局后的绝望' })),
      chapterGenerationJobs: [legacyJob],
      chapterGenerationSteps: fresh.data.chapterGenerationSteps.map(step => ({ ...step, status: 'pending', output: '',
        inputSnapshot: JSON.stringify({ ...JSON.parse(step.inputSnapshot), targetChapterOrder: 1 }) })) }
    const running = ctxFor(legacy, legacyJob)
    for (const [index, run] of [api.runContextNeedPlanningStep, api.runContextBudgetSelectionStep, api.runBuildContextStep].entries()) {
      running.step = running.steps[index]; run(running)
    }
    running.state.plan = { ...ctx.state.plan }
    running.state.working = running.env.updateStepInData(running.state.working, running.steps[3].id,
      { status: 'completed', output: JSON.stringify(running.state.plan) })
    for (const [type, run] of [['context_need_planning_from_plan', api.runPlanContextNeedStep],
      ['context_budget_selection_delta', api.runContextBudgetDeltaStep], ['rebuild_context_with_plan', api.runRebuildContextWithPlanStep]]) {
      running.step = running.steps.find(step => step.type === type); run(running)
    }
    assert.ok(running.state.context.includes('亲眼目睹大结局后的绝望'), 'The legacy fixture must actually contain later state.')
    assert.equal(running.state.working.chapterGenerationSteps.filter(step => step.status === 'completed').length, 7)
    const edited = { ...api.getChapterTaskForJob(running.state.working, 'p1', legacyJob, 1), styleRequirement: '简洁对白。' }
    const next = await api.prepareChapterTaskEdit(running.state.working, { ...input, sourceJobId: legacyJob.id,
      targetChapterOrder: 1, jobId: 'legacy-opening-edit', task: edited })
    assert.deepEqual(next.impact.changedFields, ['styleRequirement'])
    assert.equal(next.impact.scope, 'context'); assert.equal(next.impact.resumeStep, 'generate_chapter_plan')
    assert.ok(next.impact.warnings.some(warning => /旧首章/.test(warning)))
    assert.ok(!stateFor(next.data, next.job).state.context.includes('亲眼目睹大结局后的绝望'))
    assert.equal(stateFor(next.data, next.job).state.plan, null)
  })

  await test('context signatures bind project facts, not navigation, settings, other projects or run history', () => {
    const signature = api.chapterTaskContextSourceSignature(base, 'p1', 2)
    const unrelated = structuredClone(base)
    unrelated.projects[0].lastOpenedAt = 'later-open'; unrelated.projects[0].updatedAt = 'navigation-update'
    unrelated.projects[1].description = 'OTHER_PROJECT_EDIT'
    unrelated.chapters.push({ ...base.chapters[0], id: 'foreign', projectId: 'p2', body: 'OTHER_BODY' })
    unrelated.chapterGenerationJobs.push({ ...fresh.job, id: 'another-run' })
    unrelated.settings.apiKey = 'DO_NOT_COPY_SECRET'; unrelated.settings.modelName = 'other-model'
    assert.equal(api.chapterTaskContextSourceSignature(unrelated, 'p1', 2), signature)
    const reorderedKeys = value => Array.isArray(value) ? value.map(reorderedKeys) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorderedKeys(item)])) : value
    assert.equal(api.chapterTaskContextSourceSignature(reorderedKeys(base), 'p1', 2), signature)
    assert.match(signature, /^task-context-v1-[a-f0-9]{16}-\d+$/)
    const patches = [
      data => { data.projects[0].description = 'Changed premise' },
      data => { data.chapters[0].body = 'Changed previous ending' },
      data => { data.chapters[0].archivedAt = timestamp },
      data => { data.characters[0].abilitiesAndResources = 'Changed resources' },
      data => { data.characterStateFacts[0].value = ['石印'] },
      data => { data.foreshadowings[0].description = 'Changed clue' }
    ]
    for (const collection of ['storyBibles', 'characterStateLogs', 'timelineEvents', 'stageSummaries', 'chapterContinuityBridges', 'hardCanonPacks']) {
      patches.push(data => { data[collection].push({ id: 'new-source', projectId: 'p1', content: 'NEW_CONTEXT_INPUT' }) })
    }
    for (const patch of patches) {
      const changed = structuredClone(base); patch(changed)
      assert.notEqual(api.chapterTaskContextSourceSignature(changed, 'p1', 2), signature)
      assert.throws(() => api.assertChapterTaskContextSourceCurrent(changed, 'p1', 2, signature), /上下文资料已变化.*再次保存/)
    }
  })

  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
  // Only the bridge is in-memory. Both production hooks and useAppData's shared queue execute unchanged.
  async function queuedTaskSave(initial, submitted, mutate, { legacy = false, sourceJobId = null, budgetMaxTokens = 12000 } = {}) {
    const hooks = createHookHost(), release = deferred(), entered = deferred(), queued = deferred()
    globalThis.__chapterTaskBindingHooks = hooks
    globalThis.document = { documentElement: { dataset: {} } }
    let disk = structuredClone(initial), app, selected, fullCalls = 0, bundleCalls = 0, blockFirst = true
    const persistedBundles = []
    const bridge = {
      load: async () => ({ data: structuredClone(disk), storagePath: 'memory-only' }),
      save: async next => {
        fullCalls++
        if (blockFirst) { blockFirst = false; entered.resolve(); await release.promise }
        disk = structuredClone(next); return { storagePath: 'memory-only' }
      },
      saveGenerationRunBundle: async bundle => {
        bundleCalls++; persistedBundles.push(structuredClone(bundle))
        disk = api.applyGenerationRunBundleToAppData(disk, bundle)
        return { storagePath: 'memory-only' }
      }
    }
    if (legacy) delete bridge.saveGenerationRunBundle
    globalThis.window = { novelDirector: { data: bridge } }
    const render = () => {
      app = hooks.render('app', () => hookApi.useAppData()); hooks.flushEffects()
      return hooks.render('task', () => hookApi.useChapterTaskEditing({
        data: app.getCurrentData(), project: app.getCurrentData().projects.find(project => project.id === 'p1'),
        selectedJob: app.getCurrentData().chapterGenerationJobs.find(job => job.id === sourceJobId) ?? null,
        targetChapterOrder: 2, estimatedWordCount: task.targetWordCount, readerEmotionTarget: '',
        budgetMode: 'standard', budgetMaxTokens, pipelineMode: 'standard', isRunning: false,
        saveData: app.saveData, saveGenerationRunBundle: (merge, bundle) => { queued.resolve(bundle); return app.saveGenerationRunBundle(merge, bundle) },
        selectJob: id => { selected = id }, onGenerate: () => { throw new Error('Saving must not start generation') },
        confirmSnapshotRefresh: async () => true, selectedSnapshot: null
      }))
    }
    app = hooks.render('app', () => hookApi.useAppData()); hooks.flushEffects()
    await new Promise(resolve => setImmediate(resolve))
    const editor = render()
    const first = app.saveData(current => { const next = structuredClone(current); mutate(next); return next })
    let result, preparedBundle
    try {
      await withDeadline(entered.promise, 'earlier full save')
      result = editor.onSave(submitted).then(() => ({ ok: true }), error => ({ ok: false, error }))
      preparedBundle = await withDeadline(queued.promise, 'task bundle entering real queue')
      assert.equal(bundleCalls, 0)
    } finally { release.resolve(); await first }
    const outcome = await result
    return { outcome, preparedBundle, persistedBundles, render, get disk() { return disk }, get app() { return app },
      get selected() { return selected }, get fullCalls() { return fullCalls }, get bundleCalls() { return bundleCalls } }
  }

  for (const legacy of [false, true]) {
    await test(`${legacy ? 'old bridge' : 'dedicated bundle'}: queued chapter save rejects stale fresh context; retry uses new facts`, async () => {
      const submitted = structuredClone(task), before = JSON.stringify(submitted)
      const h = await queuedTaskSave(base, submitted, data => {
        data.chapters[0].body = '沈禾已经离开旧桥。NEW_FACT_LEFT_BRIDGE'; data.chapters[0].summary = 'NEW_FACT_LEFT_BRIDGE'
      }, { legacy })
      assert.equal(h.outcome.ok, false); assert.match(h.outcome.error.message, /上下文资料已变化.*编辑仍保留.*再次保存/)
      assert.equal(h.fullCalls, 1); assert.equal(h.bundleCalls, 0); assert.equal(h.selected, undefined)
      assert.equal(h.disk.chapterGenerationJobs.length, 0); assert.equal(h.disk.generationRunTraces.length, 0)
      assert.deepEqual(h.app.getCurrentData(), h.disk)
      assert.equal(JSON.stringify(submitted), before)
      const retryEditor = h.render(); assert.equal(retryEditor.busy, false)
      assert.match(h.app.status, /保存失败/)
      await retryEditor.onSave(submitted)
      assert.ok(h.selected)
      const saved = h.disk.chapterGenerationJobs.find(job => job.id === h.selected)
      assert.ok(stateFor(h.disk, saved).state.context.includes('NEW_FACT_LEFT_BRIDGE'))
      const serialized = JSON.stringify(h.disk)
      assert.ok(!serialized.includes('task-context-v1-')); assert.ok(!serialized.includes('contextSourceSignature'))
    })
  }

  await test('unrelated queued edits do not block fresh preparation; binding remains outside the saved bundle', async () => {
    const h = await queuedTaskSave(base, task, data => {
      data.projects[0].lastOpenedAt = 'later'; data.projects[0].updatedAt = 'navigation-update'
      data.projects[1].description = 'OTHER_PROJECT_EDIT'; data.settings.apiKey = 'DO_NOT_COPY_SECRET'
    })
    assert.equal(h.outcome.ok, true); assert.equal(h.bundleCalls, 1)
    assert.equal(h.disk.projects[1].description, 'OTHER_PROJECT_EDIT')
    assert.equal(h.disk.projects[0].lastOpenedAt, 'later')
    const bundle = JSON.stringify(h.persistedBundles[0])
    assert.ok(!bundle.includes('DO_NOT_COPY_SECRET')); assert.ok(!bundle.includes('task-context-v1-'))
  })

  await test('frozen reuse allows fact updates, while style edits falling back to fresh context reject them', async () => {
    const validOriginal = { ...original, generationRunTraces: original.generationRunTraces.map(trace => ({ ...trace, qualityGateReportId: null, noveltyAuditResult: null })) }
    const change = data => { data.chapters[0].body = 'NEW_FACT_LEFT_BRIDGE'; data.chapters[0].summary = 'NEW_FACT_LEFT_BRIDGE' }
    const reused = await queuedTaskSave(validOriginal, editInput.task, change, { sourceJobId: fresh.job.id })
    assert.equal(reused.outcome.ok, true); assert.equal(reused.preparedBundle.job.taskEdit.scope, 'expression')
    const job = reused.disk.chapterGenerationJobs.find(item => item.id === reused.selected)
    assert.ok(!stateFor(reused.disk, job).state.context.includes('NEW_FACT_LEFT_BRIDGE'))
    assert.ok(job.taskEdit.warnings.some(warning => /事实切片/.test(warning)))
    const rebuilt = await queuedTaskSave(validOriginal, editInput.task, change, { sourceJobId: fresh.job.id, budgetMaxTokens: 1000 })
    assert.equal(rebuilt.preparedBundle.job.taskEdit.scope, 'context')
    assert.equal(rebuilt.outcome.ok, false); assert.equal(rebuilt.bundleCalls, 0)
  })

  if (skipNative) console.log('SKIP explicit --no-native: existing SQLite/JSON round-trip test retained, not executed')
  else await test('task bundle writes round-trip in SQLite and JSON without altering old runs or other projects', async () => {
    // The synthetic old trace above deliberately contains obsolete references; storage receives a valid historical fixture.
    const storedBase = { ...original, generationRunTraces: original.generationRunTraces.map(trace => ({ ...trace, qualityGateReportId: null, noveltyAuditResult: null })) }
    sqlite = new api.SqliteStorageService(join(directory, 'task.sqlite'))
    await sqlite.save(storedBase)
    const bundle = api.buildGenerationRunBundle(style.data, style.job.id)
    await sqlite.saveGenerationRunBundle(bundle)
    await sqlite.saveGenerationRunBundle(bundle)
    const loaded = await sqlite.load()
    assert.deepEqual(loaded.chapterGenerationJobs.find(job => job.id === style.job.id).chapterTaskSnapshot, editInput.task)
    assert.deepEqual(loaded.generatedChapterDrafts, storedBase.generatedChapterDrafts)
    assert.deepEqual(loaded.projects.find(project => project.id === 'p2'), storedBase.projects.find(project => project.id === 'p2'))
    const rebuilt = stateFor(loaded, loaded.chapterGenerationJobs.find(job => job.id === style.job.id))
    assert.equal(rebuilt.state.rebuiltContextFromPlan, true)
    assert.ok(rebuilt.state.context.includes(editInput.task.styleRequirement))
    const json = new api.JsonStorageService(join(directory, 'export.json'))
    await json.save(loaded)
    const imported = await json.load()
    assert.deepEqual(imported.chapterGenerationJobs.find(job => job.id === style.job.id).taskEdit, loaded.chapterGenerationJobs.find(job => job.id === style.job.id).taskEdit)
  })
  console.log(JSON.stringify({ ok: true, checks, skippedNativeChecks: skipNative ? 1 : 0, providerCallsDuringTaskEditing: requests }))
} finally {
  globalThis.fetch = originalFetch
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument
  if (originalHooks === undefined) delete globalThis.__chapterTaskBindingHooks; else globalThis.__chapterTaskBindingHooks = originalHooks
  sqlite?.close()
  await rm(directory, { recursive: true, force: true })
}
