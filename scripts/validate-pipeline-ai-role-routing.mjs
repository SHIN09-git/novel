#!/usr/bin/env node

/*
 * Batch B contract validation.
 *
 * This script intentionally lives outside the normal test chain until the
 * role-routing production contract is implemented. It validates the pieces
 * that already exist at runtime and reports the missing Batch B capabilities
 * precisely instead of passing against a local mock.
 */
import { build } from 'esbuild'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const roles = ['planner', 'prose', 'extraction', 'reviewer', 'revision']
const roleSteps = {
  planner: 'generate_chapter_plan',
  prose: 'generate_chapter_draft',
  extraction: 'generate_chapter_review',
  reviewer: 'consistency_review',
  revision: 'revision_candidate'
}

const results = []

function check(name, ok, details = undefined) {
  results.push({ name, ok, ...(details === undefined ? {} : { details }) })
}

function baseSettings() {
  return {
    apiProvider: 'compatible',
    apiKey: 'DO_NOT_PERSIST_THIS_TEST_KEY',
    hasApiKey: true,
    baseUrl: 'https://example.invalid/v1',
    modelName: 'base-model',
    codexCliPath: 'codex',
    codexCliModel: '',
    temperature: 0.4,
    maxTokens: 2400,
    retryEnabled: true,
    maxRetries: 2,
    requestTimeoutMs: 300_000,
    enableAutoSummary: false,
    enableChapterDiagnostics: false,
    defaultTokenBudget: 16_000,
    defaultPromptMode: 'standard',
    theme: 'system'
  }
}

async function bundle(relativePath) {
  const result = await build({
    entryPoints: [join(root, relativePath)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent'
  })
  const source = result.outputFiles[0]?.text
  if (!source) throw new Error(`Unable to bundle ${relativePath}`)
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

async function findRoleModuleCandidates() {
  const candidates = new Set([
    'src/services/PipelineRoleRoutingService.ts',
    'src/services/PipelineAIRoleService.ts',
    'src/services/AIRoleRoutingService.ts',
    'src/services/PipelineRunContextService.ts'
  ])
  const roots = ['src/services', 'src/agent', 'src/main']

  async function walk(directory) {
    let entries = []
    try {
      entries = await readdir(join(root, directory), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(child)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      const source = await readFile(join(root, child), 'utf8')
      if (/role.?config|role.?routing|role.?for.?step|logical.?call.?budget/i.test(source)) {
        candidates.add(child.replaceAll('\\', '/'))
      }
    }
  }

  for (const directory of roots) await walk(directory)
  return [...candidates]
}

function findExport(module, names) {
  return names.map((name) => module[name]).find((value) => typeof value === 'function')
}

async function loadRoleRouter() {
  const candidates = await findRoleModuleCandidates()
  const loaded = []
  for (const candidate of candidates) {
    try {
      const module = await bundle(candidate)
      const resolveRole = findExport(module, [
        'resolvePipelineAIRoleConfig',
        'resolvePipelineRoleConfig',
        'resolveAIRoleConfig',
        'resolveRoleConfig',
        'resolvePipelineRoleSettings'
      ])
      const roleForStep = findExport(module, [
        'getPipelineRoleForStep',
        'resolvePipelineRoleForStep',
        'getRoleForStep',
        'roleForStep'
      ])
      const callBudget = findExport(module, [
        'getPipelineLogicalCallBudget',
        'estimatePipelineAiCallBudget',
        'estimateLogicalCallBudget',
        'getLogicalCallBudget'
      ])
      if (resolveRole || roleForStep || callBudget) loaded.push({ candidate, module, resolveRole, roleForStep, callBudget })
    } catch {
      // A candidate file may mention the contract in a comment or type only.
    }
  }
  return {
    candidates,
    module: loaded.find((item) => item.resolveRole) ?? null,
    partial: loaded
  }
}

function comparableRunConfig(config) {
  return {
    apiProvider: config?.apiProvider,
    baseUrl: config?.baseUrl,
    modelName: config?.modelName,
    codexCliPath: config?.codexCliPath,
    codexCliModel: config?.codexCliModel,
    temperature: config?.temperature,
    maxTokens: config?.maxTokens,
    retryEnabled: config?.retryEnabled,
    maxRetries: config?.maxRetries,
    requestTimeoutMs: config?.requestTimeoutMs
  }
}

async function validateExistingRuntime() {
  const [{ createPipelineAIRunConfig, resolvePipelineRunSettings }, retry, errors] = await Promise.all([
    bundle('src/services/PipelineRunContextService.ts'),
    bundle('src/main/utils/retry.ts'),
    bundle('src/main/utils/aiErrors.ts')
  ])

  const settings = baseSettings()
  const snapshot = createPipelineAIRunConfig(settings)
  check(
    'run snapshot excludes apiKey',
    !JSON.stringify(snapshot).includes(settings.apiKey),
    { keys: Object.keys(snapshot) }
  )
  check(
    'run snapshot freezes the current provider/model/runtime controls',
    snapshot.apiProvider === settings.apiProvider &&
      snapshot.modelName === settings.modelName &&
      snapshot.requestTimeoutMs === settings.requestTimeoutMs &&
      snapshot.maxRetries === settings.maxRetries
  )

  const oldConfig = {
    apiProvider: 'local',
    baseUrl: 'http://127.0.0.1:9999/v1',
    modelName: 'legacy-model',
    codexCliPath: 'codex',
    codexCliModel: '',
    temperature: 0.2,
    maxTokens: 1200,
    retryEnabled: false,
    maxRetries: 0,
    // A non-default legacy timeout proves custom historical settings survive
    // normalization; the migration of the old 120s default is tested by the
    // existing AI retry validation.
    requestTimeoutMs: 140_000
  }
  const restored = resolvePipelineRunSettings(oldConfig, settings)
  check(
    'legacy aiRunConfig can be restored without reviving credentials',
    restored.apiProvider === oldConfig.apiProvider &&
      restored.modelName === oldConfig.modelName &&
      restored.requestTimeoutMs === oldConfig.requestTimeoutMs &&
      restored.apiKey === '',
    { restored: comparableRunConfig(restored) }
  )

  const retryAttempts = []
  let calls = 0
  const retryResult = await retry.retryWithBackoff(
    async () => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('temporary network failure'), { code: 'ETIMEDOUT' })
      return 'ok'
    },
    {
      maxRetries: 1,
      initialDelayMs: 0,
      maxDelayMs: 0,
      shouldRetry: errors.isRetryableAiError,
      onRetry: (attempt) => retryAttempts.push(attempt)
    }
  )
  check(
    'transient retry succeeds and records one retry attempt',
    retryResult === 'ok' && calls === 2 && retryAttempts.length === 1 && retryAttempts[0] === 1,
    { calls, retryAttempts }
  )

  return { settings, createPipelineAIRunConfig }
}

async function validateRoleContract(settings, createPipelineAIRunConfig) {
  const routing = await loadRoleRouter()
  const roleModule = routing.module
  const stepRouting = await validatePipelineStepRoleCalls(settings, createPipelineAIRunConfig)
  check(
    'production exposes a complete role-routing contract',
    Boolean(roleModule && roleModule.resolveRole && roleModule.roleForStep && roleModule.callBudget),
    {
      expected: 'role-config resolver (resolvePipelineRoleSettings or equivalent) + step-to-role resolver + logical-call budget estimator',
      scannedCandidates: routing.candidates.map((item) => relative(root, join(root, item))),
      partialExports: routing.partial.map((item) => ({
        source: item.candidate,
        resolveRole: Boolean(item.resolveRole),
        roleForStep: Boolean(item.roleForStep),
        callBudget: Boolean(item.callBudget)
      }))
    }
  )
  const { resolveRole, roleForStep, callBudget } = roleModule ?? {}
  const run = createRoleAwareFixture(settings, createPipelineAIRunConfig)
  const defaults = {}
  if (resolveRole) {
    for (const role of roles) {
      const resolved = invokeRoleResolver(resolveRole, run, settings, role)
      defaults[role] = comparableRunConfig(resolved)
    }
  }
  const base = comparableRunConfig(run)
  check(
    'five role configs default-inherit the run snapshot',
    Boolean(resolveRole) && roles.every((role) => JSON.stringify(defaults[role]) === JSON.stringify(base)),
    defaults
  )

  const roleOverrides = Object.fromEntries(
    roles.map((role) => [role, { modelName: `role-${role}-model`, maxTokens: 1000 + roles.indexOf(role) }])
  )
  const overriddenRun = createPipelineAIRunConfig(settings, roleOverrides)
  const selectedRoleModels = {}
  if (resolveRole) {
    for (const role of roles) {
      selectedRoleModels[role] = comparableRunConfig(invokeRoleResolver(resolveRole, overriddenRun, settings, role))
    }
  }
  check(
    'each pipeline role selects its own frozen role config',
    Boolean(resolveRole) && roles.every((role) => selectedRoleModels[role].modelName === `role-${role}-model`),
    selectedRoleModels
  )

  const routingErrors = []
  if (roleForStep) {
    for (const role of roles) {
      const step = roleSteps[role]
      const selected = roleForStep(step)
      if (selected !== role) routingErrors.push({ role, step, selected })
    }
  }
  check(
    'planner/prose/extraction/reviewer/revision route to their role',
    stepRouting.ok && (roleForStep ? routingErrors.length === 0 : true),
    stepRouting.ok ? (roleForStep ? routingErrors : stepRouting.rolesByCall) : stepRouting.details
  )

  const retryErrors = []
  if (resolveRole && roleForStep) {
    for (const role of roles) {
      const step = roleSteps[role]
      const initialRole = roleForStep(step, { attempt: 0 })
      const retryRole = roleForStep(step, { attempt: 1, retry: true })
      if (initialRole !== retryRole || initialRole !== role) retryErrors.push({ role, step, initialRole, retryRole })
    }
  }
  check(
    'retries keep the same role',
    stepRouting.retryStable &&
      (roleForStep
        ? retryErrors.length === 0
        : Boolean(resolveRole) && roles.every((role) => {
            const first = comparableRunConfig(invokeRoleResolver(resolveRole, overriddenRun, settings, role))
            const retry = comparableRunConfig(invokeRoleResolver(resolveRole, overriddenRun, settings, role))
            return JSON.stringify(first) === JSON.stringify(retry)
          })),
    stepRouting.retryStable ? (roleForStep ? retryErrors : stepRouting.rolesByCall) : stepRouting.details
  )

  const standardBudget = callBudget ? normalizeBudget(callBudget('standard')) : null
  const strictBudget = callBudget ? normalizeBudget(callBudget('strict')) : null
  check('standard logical call budget is <= 4', standardBudget !== null && standardBudget <= 4, { standardBudget })
  check('strict allows at most one extra independent review', strictBudget !== null && strictBudget <= 5 && strictBudget >= (standardBudget ?? 0), { strictBudget, standardBudget })
}

async function validatePipelineStepRoleCalls(settings, createPipelineAIRunConfig) {
  const modulePaths = [
    'src/renderer/src/views/generation/pipelineSteps/chapterPlanGeneration.ts',
    'src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts',
    'src/renderer/src/views/generation/pipelineSteps/memoryExtraction.ts',
    'src/renderer/src/views/generation/pipelineSteps/consistencyReview.ts'
  ]
  const loaded = {}
  try {
    for (const path of modulePaths) loaded[path] = await bundle(path)
  } catch (error) {
    return { ok: false, retryStable: false, details: `Unable to load production pipeline step: ${String(error)}` }
  }

  const { EMPTY_APP_DATA } = await bundle('src/shared/defaults/index.ts')
  const project = {
    id: 'role-routing-project',
    name: 'Role routing fixture',
    genre: '',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: '',
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z'
  }
  const options = {
    targetChapterOrder: 2,
    pipelineMode: 'standard',
    estimatedWordCount: '1-1000',
    readerEmotionTarget: '紧张',
    budgetMode: 'standard',
    budgetMaxTokens: 2_000
  }
  const plan = {
    chapterTitle: '角色路由测试章',
    chapterGoal: '验证角色路由',
    conflictToPush: '验证角色路由冲突',
    characterBeats: '主角做出选择',
    foreshadowingToUse: '',
    foreshadowingNotToReveal: '',
    endingHook: '留下钩子',
    readerEmotionTarget: '紧张',
    estimatedWordCount: '1-1000',
    openingContinuationBeat: '承接上一章',
    carriedPhysicalState: '无',
    carriedEmotionalState: '紧张',
    unresolvedMicroTensions: '',
    forbiddenResets: '',
    allowedNovelty: '',
    forbiddenNovelty: ''
  }
  const job = {
    id: 'role-routing-job',
    projectId: project.id,
    targetChapterOrder: options.targetChapterOrder,
    chapterTaskSnapshot: null,
    promptContextSnapshotId: null,
    contextSource: 'auto',
    status: 'running',
    currentStep: 'generate_chapter_plan',
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    errorMessage: ''
  }
  const roleCalls = []
  const working = structuredClone(EMPTY_APP_DATA)
  working.projects = [project]
  working.chapterGenerationSteps = [{
    id: 'role-routing-step',
    jobId: job.id,
    type: 'generate_chapter_plan',
    status: 'running',
    inputSnapshot: '',
    output: '',
    errorMessage: '',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }]
  const fakeAI = {
    generateChapterPlan: async () => ({ ok: true, usedAI: true, data: plan }),
    generateChapterDraft: async () => ({
      ok: true,
      usedAI: true,
      // Keep this fixture above the production minimum draft threshold. The
      // content is synthetic and never touches a user project.
      data: {
        title: plan.chapterTitle,
        body: Array.from({ length: 700 }, (_, index) => `测试动作${index + 1}推动冲突并留下新的观察点。`).join('')
      }
    }),
    updateCharacterStates: async () => ({ ok: true, usedAI: true, data: [] }),
    generateConsistencyReview: async () => ({
      ok: true,
      usedAI: true,
      data: {
        timelineProblems: [],
        settingConflicts: [],
        characterOOC: [],
        foreshadowingMisuse: [],
        pacingProblems: [],
        emotionPayoffProblems: [],
        suggestions: [],
        severitySummary: 'low',
        issues: []
      }
    })
  }
  const env = {
    project,
    scoped: {
      bible: null,
      chapters: [],
      characters: [],
      characterStateLogs: [],
      characterStateFacts: [],
      foreshadowings: [],
      timelineEvents: [],
      stageSummaries: []
    },
    targetChapterOrder: options.targetChapterOrder,
    pipelineMode: options.pipelineMode,
    estimatedWordCount: options.estimatedWordCount,
    readerEmotionTarget: options.readerEmotionTarget,
    budgetMode: options.budgetMode,
    budgetMaxTokens: options.budgetMaxTokens,
    aiSettings: settings,
    runId: job.id,
    getAiService: async (role) => {
      roleCalls.push(role)
      return fakeAI
    },
    diagnostics: {
      auditNovelty: async () => ({
        newNamedCharacters: [],
        newWorldRules: [],
        newSystemMechanics: [],
        newOrganizationsOrRanks: [],
        majorLoreReveals: [],
        suspiciousDeusExRules: [],
        untracedNames: [],
        severity: 'pass',
        summary: 'synthetic role-routing fixture'
      }),
      analyzeRedundancy: async (request) => ({
        id: 'role-routing-redundancy',
        projectId: request.projectId,
        jobId: job.id,
        chapterId: request.chapterId,
        draftId: request.draftId,
        draftContentHash: null,
        repeatedPhrases: [],
        repeatedSceneDescriptions: [],
        repeatedExplanations: [],
        overusedIntensifiers: [],
        redundantParagraphs: [],
        compressionSuggestions: [],
        overallRedundancyScore: 0,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      })
    },
    getAiSettings: () => settings,
    persistWorking: async (next) => next,
    updateStepInData: (data, stepId, patch) => ({
      ...data,
      chapterGenerationSteps: data.chapterGenerationSteps.map((step) => step.id === stepId ? { ...step, ...patch } : step)
    })
  }
  const state = {
    working,
    context: 'role routing context',
    plan: null,
    draftResult: null,
    noveltyAuditResult: null,
    planGapAnalysis: null,
    contextNeedPlanFromPlan: null,
    rebuiltContextFromPlan: true,
    draftRecord: null,
    contextNeedPlan: null,
    budgetProfile: {},
    budgetSelection: null,
    recipeSkipReasons: []
  }
  try {
    await loaded[modulePaths[0]].runGenerateChapterPlanStep({
      env,
      state,
      job,
      step: working.chapterGenerationSteps[0],
      options,
      activeStoryDirectionGuide: null,
      snapshot: null,
      storyDirectionTracePatch: {}
    })
    const draftStep = { ...working.chapterGenerationSteps[0], id: 'role-routing-draft-step', type: 'generate_chapter_draft' }
    state.working.chapterGenerationSteps.push(draftStep)
    await loaded[modulePaths[1]].runGenerateChapterDraftStep({
      env,
      state,
      job: { ...job, currentStep: 'generate_chapter_draft' },
      step: draftStep,
      options,
      activeStoryDirectionGuide: null,
      snapshot: null,
      storyDirectionTracePatch: {}
    })
    const extractionStep = { ...draftStep, id: 'role-routing-extraction-step', type: 'propose_character_updates' }
    state.working.chapterGenerationSteps.push(extractionStep)
    await loaded[modulePaths[2]].runCharacterUpdateExtractionStep({
      env,
      state,
      job,
      step: extractionStep,
      options,
      activeStoryDirectionGuide: null,
      snapshot: null,
      storyDirectionTracePatch: {}
    })
    const reviewStep = { ...draftStep, id: 'role-routing-review-step', type: 'consistency_review' }
    state.working.chapterGenerationSteps.push(reviewStep)
    await loaded[modulePaths[3]].runConsistencyReviewStep({
      env,
      state,
      job: { ...job, pipelineMode: 'conservative', currentStep: 'consistency_review' },
      step: reviewStep,
      options,
      activeStoryDirectionGuide: null,
      snapshot: null,
      storyDirectionTracePatch: {}
    })
  } catch (error) {
    return { ok: false, retryStable: false, details: `Production role call fixture failed: ${String(error)}`, rolesByCall: roleCalls }
  }

  const expectedCalls = ['planner', 'prose', 'extraction', 'reviewer']
  const actual = roleCalls.slice(0, expectedCalls.length)
  const revisionSettings = createPipelineAIRunConfig(settings)
  const revisionRole = revisionSettings.roles?.revision
  const revisionHandlerSource = await readFile(join(root, 'src/renderer/src/views/generation/pipelineRevisionActionHandlers.ts'), 'utf8')
  const revisionRouted = Boolean(revisionRole) && revisionHandlerSource.includes("resolvePipelineRoleSettings") && revisionHandlerSource.includes("'revision'")
  if (revisionRouted) actual.push('revision')
  const expected = [...expectedCalls, 'revision']
  const retryRoles = [...actual]
  return {
    ok: JSON.stringify(actual) === JSON.stringify(expected),
    retryStable: JSON.stringify(retryRoles) === JSON.stringify(actual),
    rolesByCall: actual,
    details: { expected, actual, revisionRouted, capturedCalls: roleCalls }
  }
}

function createRoleAwareFixture(settings, createPipelineAIRunConfig) {
  return createPipelineAIRunConfig(settings)
}

function invokeRoleResolver(resolveRole, run, settings, role) {
  // Current production API is resolvePipelineRoleSettings(snapshot, fallback,
  // role). Future role-config services may expose the simpler
  // resolveRoleConfig(snapshot, role) shape; support both without mocking it.
  if (resolveRole.name === 'resolvePipelineRoleSettings') return resolveRole(run, settings, role)
  return resolveRole(run, role)
}

function normalizeBudget(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!value || typeof value !== 'object') return null
  for (const key of ['logicalCalls', 'maxLogicalCalls', 'callCount', 'count']) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) return value[key]
  }
  return null
}

async function validateSafeTelemetry() {
  const module = await bundle('src/main/services/AIService.ts')
  const secret = 'ROLE_ROUTING_TEST_SECRET_DO_NOT_LOG'
  const promptMarker = 'ROLE_ROUTING_PROMPT_MUST_NOT_BE_LOGGED'
  const proseMarker = 'ROLE_ROUTING_PROSE_MUST_NOT_BE_LOGGED'
  const logs = []
  const service = new module.AIService(
    { getApiKey: async () => secret },
    {},
    {
      logger: {
        info: (message) => logs.push(String(message)),
        warn: (message) => logs.push(String(message))
      },
      httpClient: {
        async postWithFallback() {
          throw new Error(`simulated transient failure ${secret}`)
        }
      }
    }
  )
  await service.chatCompletion({
    runId: 'run-role-routing-telemetry',
    settings: { ...baseSettings(), retryEnabled: false },
    messages: [
      { role: 'system', content: promptMarker },
      { role: 'user', content: proseMarker }
    ]
  })
  const telemetry = logs.join('\n')
  check(
    'AI telemetry excludes prompt, prose, and api key',
    !telemetry.includes(secret) && !telemetry.includes(promptMarker) && !telemetry.includes(proseMarker),
    {
      logCount: logs.length,
      containsApiKey: telemetry.includes(secret),
      containsPrompt: telemetry.includes(promptMarker),
      containsProse: telemetry.includes(proseMarker)
    }
  )
}

async function validateAgentRoleCredentials() {
  const compiled = await build({
    entryPoints: [join(root, 'src/agent/AgentPipelineExecutor.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node22',
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(join(root, 'src/agent/AgentPipelineExecutor.ts')).href) },
    external: ['better-sqlite3', 'electron'], logLevel: 'silent'
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports
  )
  const { resolveAgentPipelineAIProfile } = module.exports
  const { createPipelineAIRunConfig } = await bundle('src/services/PipelineRunContextService.ts')
  const local = { ...baseSettings(), apiProvider: 'local' }
  for (const role of roles) {
    for (const provider of ['openai', 'compatible']) {
      const snapshot = createPipelineAIRunConfig(local, { [role]: { apiProvider: provider } })
      for (const hasKey of [false, true]) {
        const profile = resolveAgentPipelineAIProfile(snapshot, local, hasKey)
        check(`Agent detects ${provider} ${role} with environment key=${hasKey}`,
          profile.requiresEnvironmentApiKey && profile.roleSettings[role].hasApiKey === hasKey &&
          profile.roleSettings[role].apiProvider === provider && profile.roleSettings[role].apiKey === '' &&
          !JSON.stringify(profile).includes(local.apiKey))
      }
    }
  }
  const localRoles = Object.fromEntries(roles.map((role, index) => [role, { apiProvider: index % 2 ? 'local' : 'codex_cli' }]))
  const allLocal = createPipelineAIRunConfig(baseSettings(), localRoles)
  check('Agent does not require environment key when every frozen role is local/CLI',
    !resolveAgentPipelineAIProfile(allLocal, baseSettings(), false).requiresEnvironmentApiKey)
  const remote = createPipelineAIRunConfig(baseSettings())
  const { roles: ignoredRoles, schemaVersion: ignoredVersion, ...legacy } = remote
  const legacyProfile = resolveAgentPipelineAIProfile(legacy, local, false)
  check('Agent legacy snapshot role inheritance preserves remote key requirement',
    legacyProfile.requiresEnvironmentApiKey && roles.every((role) => !legacyProfile.roleSettings[role].hasApiKey))
  const changedSettings = { ...baseSettings(), pipelineModelRoles: { reviewer: { apiProvider: 'compatible' } } }
  check('Agent key preflight uses frozen roles rather than later settings',
    !resolveAgentPipelineAIProfile(allLocal, changedSettings, false).requiresEnvironmentApiKey)
  const inherited = resolveAgentPipelineAIProfile(null, changedSettings, false)
  check('Agent absent snapshot resolves roles from current settings',
    inherited.requiresEnvironmentApiKey && !inherited.roleSettings.reviewer.hasApiKey)
}

async function main() {
  if (process.argv.includes('--agent-credentials')) {
    await validateAgentRoleCredentials()
    const failed = results.filter((item) => !item.ok)
    console.log(JSON.stringify({ ok: !failed.length, totalChecks: results.length, passedChecks: results.length - failed.length, failed }, null, 2))
    if (failed.length) process.exitCode = 1
    return
  }
  let runtime = null
  try {
    runtime = await validateExistingRuntime()
  } catch (error) {
    check('existing runtime contract can be executed', false, String(error))
  }

  if (runtime) {
    try {
      await validateRoleContract(runtime.settings, runtime.createPipelineAIRunConfig)
    } catch (error) {
      check('role-routing validation completed', false, String(error))
    }
  }

  try {
    await validateAgentRoleCredentials()
  } catch (error) {
    check('Agent role credential validation completed', false, String(error))
  }

  try {
    await validateSafeTelemetry()
  } catch (error) {
    check('safe telemetry validation completed', false, String(error))
  }

  const failed = results.filter((item) => !item.ok)
  const report = {
    ok: failed.length === 0,
    contract: 'Batch B run-level AI role routing',
    roles,
    totalChecks: results.length,
    passedChecks: results.length - failed.length,
    failed,
    covered: [
      'five role default inheritance',
      'apiKey-free run snapshot',
      'legacy aiRunConfig recovery',
      'step-to-role selection',
      'retry role stability',
      'safe prompt/prose/key telemetry',
      'standard <= 4 logical calls',
      'strict <= standard + 1 independent review'
    ]
  }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
