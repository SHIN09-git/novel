import assert from 'node:assert/strict'
import { join } from 'node:path'

export const artifactCollections = ['chapterGenerationJobs', 'chapterGenerationSteps', 'contextNeedPlans', 'contextBudgetProfiles', 'generationRunTraces']

export function assertRecords(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: record count`)
  const byId = new Map(actual.map((item) => [item.id, item]))
  assert.equal(byId.size, actual.length, `${label}: duplicate ids`)
  assert.equal(new Set(expected.map((item) => item.id)).size, expected.length, `${label}: duplicate fixture ids`)
  for (const item of expected) assert.deepEqual(byId.get(item.id), item, `${label}:${item.id}`)
}

export function assertDataRecords(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort())
  // SQLite reads entity collections in id order; nested arrays remain order-sensitive.
  for (const [key, value] of Object.entries(expected)) {
    if (Array.isArray(value)) assertRecords(actual[key], value, key)
    else assert.deepEqual(actual[key], value, key)
  }
}

export async function withDeadline(promise, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5000)
    })])
  } finally { clearTimeout(timer) }
}

export function initialData(api) {
  const stamp = '2026-09-06T10:00:00.000Z'
  const job = { id: 'foreign-job', projectId: 'p2', targetChapterOrder: 2, contextSource: 'auto',
    status: 'running', currentStep: 'context_need_planning', errorMessage: '', createdAt: stamp, updatedAt: stamp }
  const data = api.normalizeAppData({
    projects: [{ id: 'p1', name: 'Fixture project', createdAt: stamp, updatedAt: stamp },
      { id: 'p2', name: 'Unrelated project', createdAt: stamp, updatedAt: stamp }],
    chapters: [{ id: 'foreign-chapter', projectId: 'p2', order: 1, title: 'Unrelated', body: 'UNRELATED_PROSE', createdAt: stamp, updatedAt: stamp }],
    chapterGenerationJobs: [job],
    chapterGenerationSteps: ['context_need_planning', 'context_need_planning_from_plan', 'context_budget_selection', 'context_budget_selection_delta']
      .map((type) => ({ id: `foreign-${type}`, jobId: job.id, type, status: 'pending', inputSnapshot: '', output: '',
        errorMessage: '', createdAt: stamp, updatedAt: stamp }))
  })
  return checkpointData(api, data, job.id)
}

export function unrelatedData(data) {
  const jobIds = new Set(data.chapterGenerationJobs.filter((job) => job.projectId === 'p2').map((job) => job.id))
  return Object.fromEntries(Object.entries(data).filter(([, value]) => Array.isArray(value)).map(([key, value]) =>
    [key, value.filter((item) => key === 'projects' ? item.id === 'p2' : item.projectId === 'p2' || jobIds.has(item.jobId))]))
}

export function createHookHost() {
  const frames = new Map()
  let current
  const effects = []
  return {
    render(key, fn) {
      const frame = frames.get(key) ?? { slots: [], cursor: 0 }
      frames.set(key, frame); frame.cursor = 0; current = frame
      try { return fn() } finally { current = undefined }
    },
    state(initial) {
      const frame = current, index = frame.cursor++
      if (!(index in frame.slots)) frame.slots[index] = typeof initial === 'function' ? initial() : initial
      return [frame.slots[index], (next) => { frame.slots[index] = typeof next === 'function' ? next(frame.slots[index]) : next }]
    },
    ref(value) {
      const index = current.cursor++
      return current.slots[index] ??= { current: value }
    },
    effect(fn, deps) {
      const index = current.cursor++, previous = current.slots[index]
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous[i]))) effects.push(fn)
      current.slots[index] = deps
    },
    flushEffects() { for (const fn of effects.splice(0)) fn() }
  }
}

export function handoffPlugin(repoRoot) {
  const noopHooks = ['useDraftAcceptance', 'useMemoryCandidates', 'usePipelineRevisionActions', 'usePipelineTraceActions']
  const modules = {
    react: `export const useState = initial => globalThis.__pipelineHandoff.hooks.state(initial);
      export const useRef = initial => globalThis.__pipelineHandoff.hooks.ref(initial);
      export const useEffect = (fn,deps) => globalThis.__pipelineHandoff.hooks.effect(fn,deps);
      export const useMemo = fn => fn(); export const useCallback = fn => fn;`,
    'react/jsx-runtime': `export const jsx = (type,props) => ({type,props}); export const jsxs = jsx; export const Fragment = 'fragment';`,
    electron: `export const contextBridge = {exposeInMainWorld:(key,value)=>{globalThis.window[key]=value}};
      export const app = {getPath:()=>{throw new Error('Real app paths forbidden in handoff fixture')}};
      export const ipcMain = {handle:(key,fn)=>globalThis.__pipelineHandoff.handlers.set(key,fn)};
      export const ipcRenderer = {invoke:(...args)=>globalThis.__pipelineHandoff.invoke(...args)};
      export const dialog = new Proxy({}, {get:()=>()=>{throw new Error('Dialogs forbidden in handoff fixture')}});`,
    LogService: `export const LogService = {info:()=>{},warn:()=>{},error:()=>{}};`,
    ConfirmDialog: `export const useConfirm = () => async () => true;`,
    GenerationPipelineConsole: `export const GenerationPipelineConsole = () => null;`,
    // Task editing is outside this handoff fixture; its save path must never substitute for the runner.
    PipelineTaskEditor: `export const PipelineTaskEditor = () => null;`,
    useChapterTaskEditing: `export const useChapterTaskEditing = args => ({busy:args.isRunning,
      onSave:async()=>{throw new Error('Task editing is outside the pipeline handoff fixture')}});`,
    usePipelineConfigState: `export const usePipelineConfigState = () => ({nextChapter:2,targetChapterOrder:2,pipelineMode:'standard',
      estimatedWordCount:'1000',readerEmotionTarget:'Fixture',budgetMode:'balanced',budgetMaxTokens:3456,contextSource:'auto',selectedSnapshot:null,
      setSelectedJobId:id=>{globalThis.__pipelineHandoff.selectedJobId=id},rememberCurrentReaderEmotionTarget:()=>{}});`,
    useSelectedPipelineJob: `export const useSelectedPipelineJob = () => ({selectedJob:null,latestDraft:null,selectedSteps:[],jobs:[],
      selectedCandidates:[],selectedReports:[],selectedRevisionCandidates:[],consistencyIssueById:new Map()});`,
    usePipelineRunner: `import {usePipelineRunner as run} from 'real-handoff-runner';
      export {canSkipPipelineStep,PIPELINE_STEP_LABELS} from 'real-handoff-steps';
      export const usePipelineRunner = args => {
        globalThis.__pipelineHandoff.runnerArgs=args;
        return globalThis.__pipelineHandoff.runner=run(args);
      };`,
    pipelineRunnerEngine: `export const runPipelineFromStepEngine = (...args) => globalThis.__pipelineHandoff.engine(...args);`,
    AIService: `export class AIService {constructor(){throw new Error('AI forbidden in handoff fixture')}}`
  }
  for (const name of noopHooks) modules[name] = `export const ${name} = () => ({});`
  return { name: 'pipeline-handoff-boundaries', setup(builder) {
    builder.onResolve({ filter: /^real-handoff-runner$/ }, () => ({ path: join(repoRoot, 'src/renderer/src/views/generation/usePipelineRunner.ts') }))
    builder.onResolve({ filter: /^real-handoff-steps$/ }, () => ({ path: join(repoRoot, 'src/renderer/src/views/generation/pipelineStepDefinitions.ts') }))
    builder.onResolve({ filter: /./ }, ({ path }) => {
      const name = path === 'react/jsx-runtime' ? path : path.split('/').at(-1)
      if (Object.hasOwn(modules, name)) return { path: name, namespace: 'handoff-fixture' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'handoff-fixture' }, ({ path }) => ({ contents: modules[path], loader: 'js' }))
  } }
}

export function checkpointData(api, initial, jobId) {
  const job = initial.chapterGenerationJobs.find((item) => item.id === jobId)
  const common = { projectId: job.projectId, targetChapterOrder: job.targetChapterOrder, createdAt: job.createdAt, updatedAt: job.updatedAt }
  const needs = ['base', 'derived'].map((suffix) => ({ ...common, id: `${jobId}-need-${suffix}`, source: 'generation_pipeline',
    chapterIntent: `NEEDS_${suffix}`, requiredCharacterIds: [], contextNeeds: [] }))
  const budgets = ['base', 'delta'].map((suffix) => ({ ...common, id: `${jobId}-budget-${suffix}`, name: `BUDGET_${suffix}`, mode: 'balanced', maxTokens: 3456 }))
  const outputs = {
    context_need_planning: needs[0], context_need_planning_from_plan: { derivedContextNeedPlan: needs[1] },
    context_budget_selection: { profile: budgets[0] }, context_budget_selection_delta: { profile: budgets[1] }
  }
  return api.normalizeAppData({ ...initial,
    chapterGenerationJobs: initial.chapterGenerationJobs.map((item) => item.id === jobId ? { ...item, status: 'completed', currentStep: 'await_user_confirmation' } : item),
    chapterGenerationSteps: initial.chapterGenerationSteps.map((step) => step.jobId === jobId && outputs[step.type]
      ? { ...step, status: 'completed', output: JSON.stringify(outputs[step.type]) } : step),
    contextNeedPlans: [...initial.contextNeedPlans, ...needs], contextBudgetProfiles: [...initial.contextBudgetProfiles, ...budgets],
    generationRunTraces: [...initial.generationRunTraces, { ...common, id: `${jobId}-trace`, jobId,
      contextSource: 'auto', contextNeedPlanId: needs[1].id, contextWarnings: ['TRACE_HANDOFF_MARKER'], schemaVersion: 1 }]
  })
}
