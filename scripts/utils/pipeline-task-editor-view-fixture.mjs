import assert from 'node:assert/strict'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './repo-root.mjs'

function createHookHost() {
  const frame = { slots: [], cursor: 0 }
  const effects = []
  let changed = false
  return {
    render(fn) {
      frame.cursor = 0
      changed = false
      const result = fn()
      for (const effect of effects.splice(0)) effect()
      return { result, changed }
    },
    state(initial) {
      const index = frame.cursor++
      if (!(index in frame.slots)) frame.slots[index] = typeof initial === 'function' ? initial() : initial
      return [frame.slots[index], (next) => {
        const value = typeof next === 'function' ? next(frame.slots[index]) : next
        changed ||= !Object.is(value, frame.slots[index])
        frame.slots[index] = value
      }]
    },
    effect(callback, dependencies) {
      const index = frame.cursor++, previous = frame.slots[index]
      if (!previous || dependencies.some((value, offset) => !Object.is(value, previous.dependencies[offset]))) {
        effects.push(() => {
          previous?.cleanup?.()
          frame.slots[index] = { dependencies, cleanup: callback() }
        })
      }
    }
  }
}

function viewFixturePlugin() {
  const modules = {
    react: `export const useState = initial => globalThis.__pipelineTaskEditorView.hooks.state(initial);
      export const useEffect = (callback, dependencies) => globalThis.__pipelineTaskEditorView.hooks.effect(callback, dependencies);`,
    'react/jsx-runtime': `export const jsx = (type, props, key) => typeof type === 'function' ? type({...props, key}) : {type, props, key};
      export const jsxs = jsx; export const Fragment = 'fragment';`,
    ConfirmDialog: `export const useConfirm = () => async () => true;`,
    EditorialVerdictService: `export const getEditorialVerdictForDraft = () => null;`,
    ChapterAcceptanceReviewService: `export const hasCompleteChapterReview = () => false;`,
    novelDirectorBridge: `export const getNovelDirectorClipboardApi = () => ({writeText: async () => {}});`,
    useProjectData: `export const useProjectData = () => globalThis.__pipelineTaskEditorView.scoped;`,
    GenerationPipelineConsole: `export const GenerationPipelineConsole = props => {
      globalThis.__pipelineTaskEditorView.consoleProps = props; return null;
    };`,
    PipelineTaskEditor: `export const PipelineTaskEditor = props => {
      globalThis.__pipelineTaskEditorView.taskEditorProps = props; return null;
    };`,
    usePipelineConfigState: `export const usePipelineConfigState = () => {
      const env = globalThis.__pipelineTaskEditorView, config = env.config;
      const selectedSnapshot = config.snapshots.find(item => item.id === config.selectedSnapshotId) ?? null;
      return {
        nextChapter: 3, targetChapterOrder: config.targetChapterOrder, setTargetChapterOrder: value => { config.targetChapterOrder = value },
        pipelineMode: 'standard', setPipelineMode: () => {}, estimatedWordCount: '2000', setEstimatedWordCount: () => {},
        readerEmotionTarget: '紧张', setReaderEmotionTarget: () => {}, readerEmotionPresets: [], newReaderEmotionPreset: '', setNewReaderEmotionPreset: () => {},
        budgetMode: 'standard', setBudgetMode: () => {}, budgetMaxTokens: 3000, setBudgetMaxTokens: () => {},
        contextSource: config.contextSource, setContextSource: value => { config.contextSource = value },
        selectedSnapshotId: config.selectedSnapshotId, selectedSnapshot, snapshots: config.snapshots,
        selectedJobId: config.selectedJobId, setSelectedJobId: value => { config.selectedJobId = value },
        rememberCurrentReaderEmotionTarget: () => {}, applyReaderEmotionPreset: () => {}, addReaderEmotionPresetFromInput: () => '',
        useAutoContext: () => { config.contextSource = 'auto'; config.selectedSnapshotId = null },
        handleSnapshotChange: value => {
          config.selectedSnapshotId = value || null;
          const snapshot = config.snapshots.find(item => item.id === value);
          if (snapshot) config.targetChapterOrder = snapshot.targetChapterOrder;
        }
      };
    };`,
    useSelectedPipelineJob: `export const useSelectedPipelineJob = (_scoped, selectedJobId, preparingNewTask) => {
      const env = globalThis.__pipelineTaskEditorView;
      env.selectionArgs = {selectedJobId, preparingNewTask};
      const selectedJob = preparingNewTask ? null : env.jobs.find(job => job.id === selectedJobId) ?? null;
      const selectedSteps = selectedJob ? env.steps.filter(step => step.jobId === selectedJob.id) : [];
      return { jobs: env.jobs, selectedJob, selectedSteps, selectedCandidates: [], selectedReports: [], selectedRevisionCandidates: [],
        selectedTrace: null, selectedAuthorSummary: null, selectedTraceSnapshot: null, consistencyIssueById: new Map(), latestDraft: null,
        latestQualityReport: null, traceConsistencyReport: null, traceQualityReport: null, traceContinuityBridge: null,
        traceRedundancyReport: null, selectedStepsKey: selectedSteps.map(step => step.id + ':' + step.status).join('|') };
    };`,
    usePipelineRunner: `export const PIPELINE_STEP_LABELS = {generate_chapter_review: '复盘章节'};
      export const canSkipPipelineStep = () => true;
      export const usePipelineRunner = () => {
        const env = globalThis.__pipelineTaskEditorView;
        return { pipelineMessage: env.pipelineMessage, setPipelineMessage: value => { env.pipelineMessage = value; env.messages.push(value) },
          isPipelineRunning: false, runPipeline: (...args) => { env.runs.push(args) }, retryStep: async (...args) => { env.retries.push(args) },
          skipStep: async (...args) => { env.skips.push(args) }, cancelPipeline: () => {} };
      };`,
    useChapterTaskEditing: `export const useChapterTaskEditing = args => {
      globalThis.__pipelineTaskEditorView.taskEditorArgs = args;
      return { task: globalThis.__pipelineTaskEditorView.task, busy: false, onSave: async () => {}, sourceLabel: 'fixture' };
    };`,
    useDraftAcceptance: `export const useDraftAcceptance = () => ({acceptDraft: () => {}, acceptDraftUnreviewed: () => {}, rejectDraft: () => {}});`,
    useMemoryCandidates: `export const useMemoryCandidates = () => ({applyCandidate: () => {}, applyAllPendingCandidates: () => {}, rejectCandidate: () => {}});`,
    usePipelineRevisionActions: `export const usePipelineRevisionActions = () => ({generateRevisionCandidate: () => {}, acceptRevisionCandidate: () => {},
      rejectRevisionCandidate: () => {}, startRevisionFromConsistencyIssue: () => {}, startRevisionFromEditorialIssue: () => {}, updateConsistencyIssueStatus: () => {}});`,
    usePipelineTraceActions: `export const usePipelineTraceActions = () => ({copyRunTrace: () => {}, generateAuthorSummary: () => {}});`,
    usePipelinePrimaryAction: `export const usePipelinePrimaryAction = () => ({primaryActionLabel: '开始生成', runPrimaryAction: () => {}});`
  }
  return {
    name: 'pipeline-task-editor-view-fixture',
    setup(builder) {
      builder.onResolve({ filter: /./ }, ({ path }) => {
        const name = path === 'react/jsx-runtime' ? path : path.split('/').at(-1)
        if (Object.hasOwn(modules, name)) return { path: name, namespace: 'pipeline-task-editor-view-fixture' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'pipeline-task-editor-view-fixture' }, ({ path }) => ({ contents: modules[path], loader: 'js' }))
    }
  }
}

async function loadView() {
  const output = await build({
    entryPoints: [join(repoRoot, 'src/renderer/src/views/GenerationPipelineView.tsx')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
    plugins: [viewFixturePlugin()]
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(
    (id) => { throw new Error(`Unexpected fixture dependency: ${id}`) }, module, module.exports)
  return module.exports.GenerationPipelineView
}

function createHarness(View) {
  const at = '2026-09-06T00:00:00.000Z'
  const oldAutoJob = {
    id: 'old-auto-job', projectId: 'project-1', targetChapterOrder: 2, contextSource: 'auto', status: 'idle',
    currentStep: 'generate_chapter_review', errorMessage: '', createdAt: at, updatedAt: at,
    taskEdit: { resumeStep: 'generate_chapter_review', scope: 'expression', changedFields: [], reusableArtifacts: [], warnings: [] }
  }
  const failedStep = {
    id: 'old-review', jobId: oldAutoJob.id, type: 'generate_chapter_review', status: 'failed', inputSnapshot: '', output: '',
    errorMessage: 'fixture failure', createdAt: at, updatedAt: at
  }
  const snapshot = { id: 'manual-snapshot', projectId: 'project-1', targetChapterOrder: 7, mode: 'standard', estimatedTokens: 2000,
    chapterTask: { goal: '快照目标', conflict: '', suspenseToKeep: '', allowedPayoffs: '', forbiddenPayoffs: '', endingHook: '',
      readerEmotion: '', targetWordCount: '2000', styleRequirement: '' }, budgetProfile: { maxTokens: 3000 }, createdAt: at, updatedAt: at }
  const empty = []
  const env = {
    hooks: createHookHost(), jobs: [oldAutoJob], steps: [failedStep], task: snapshot.chapterTask,
    config: { targetChapterOrder: 2, contextSource: 'auto', selectedSnapshotId: null, selectedJobId: oldAutoJob.id, snapshots: [snapshot] },
    scoped: { bible: null, chapters: empty, qualityGateReports: empty, chapterCommitBundles: empty },
    runs: [], retries: [], skips: [], messages: [], pipelineMessage: '', consoleProps: null, taskEditorProps: null, taskEditorArgs: null, selectionArgs: null
  }
  const data = { settings: { defaultTokenBudget: 3000 }, editorialVerdicts: [] }
  const project = { id: 'project-1', name: 'Fixture project', coreAppeal: '', createdAt: at, updatedAt: at }
  function render() {
    globalThis.__pipelineTaskEditorView = env
    for (let pass = 0; pass < 10; pass++) {
      const result = env.hooks.render(() => View({ data, project, saveData: async () => ({ ok: true }) }))
      if (!result.changed) return env
    }
    throw new Error('GenerationPipelineView fixture did not settle.')
  }
  return { env, oldAutoJob, failedStep, render }
}

export async function verifyPipelineTaskEditorViewGuards() {
  const View = await loadView()

  {
    const { env, oldAutoJob, failedStep, render } = createHarness(View)
    render()
    env.taskEditorProps.onDirtyChange(true)
    render()
    assert.equal(env.consoleProps.configPanel.taskEditingLocked, true)
    assert.equal(env.consoleProps.configPanel.startDisabled, true)
    assert.equal(env.consoleProps.topStatusBar.primaryActionDisabled, true)
    await env.consoleProps.currentArtifactPanel.onSkipStep(oldAutoJob, failedStep)
    assert.deepEqual(env.skips, [], 'A dirty task must block skip callbacks before the runner is reached.')
    assert.match(env.pipelineMessage, /请先保存任务/)
  }

  {
    const { env, oldAutoJob, render } = createHarness(View)
    render()
    env.consoleProps.configPanel.onContextSourceChange('prompt_snapshot')
    env.consoleProps.configPanel.onSnapshotChange('manual-snapshot')
    render()
    assert.equal(env.consoleProps.selectedJob, null, 'Selecting a manual snapshot must clear the old auto job from the view.')
    env.consoleProps.configPanel.onStart()
    assert.equal(env.retries.length, 0, 'A manual snapshot must not resume an old auto-context job.')
    assert.deepEqual(env.runs, [[]], 'A manual snapshot must start a fresh pipeline run.')
    assert.equal(oldAutoJob.id, 'old-auto-job')
  }

  {
    const { env, render } = createHarness(View)
    render()
    env.consoleProps.configPanel.onTargetChapterOrderChange(9)
    render()
    assert.equal(env.consoleProps.selectedJob, null, 'Changing the target chapter must stop editing the previous job.')
    assert.equal(env.selectionArgs.preparingNewTask, true)
    assert.equal(env.taskEditorArgs.selectedJob, null)
    assert.equal(env.taskEditorArgs.targetChapterOrder, 9)
  }
}
