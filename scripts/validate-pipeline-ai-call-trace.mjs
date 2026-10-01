#!/usr/bin/env node

import { build } from 'esbuild'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function loadModule(relativePath) {
  const result = await build({
    entryPoints: [join(repoRoot, relativePath)],
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

const [clientModule, traceModule, defaultsModule, normalizerModule, qualityModule] = await Promise.all([
  loadModule('src/services/ai/AIClient.ts'),
  loadModule('src/renderer/src/utils/runTrace.ts'),
  loadModule('src/shared/defaults/index.ts'),
  loadModule('src/shared/normalizers/runTrace.ts'),
  loadModule('src/services/QualityGateService.ts')
])

const secret = 'PIPELINE_TRACE_SECRET_MUST_NOT_PERSIST'
const prompt = 'PIPELINE_TRACE_PROMPT_MUST_NOT_PERSIST'
const prose = 'PIPELINE_TRACE_PROSE_MUST_NOT_PERSIST'
const timestamp = '2026-09-06T00:00:00.000Z'
const settings = {
  ...defaultsModule.DEFAULT_SETTINGS,
  apiProvider: 'compatible',
  baseUrl: 'https://example.invalid/v1',
  modelName: 'trace-model',
  hasApiKey: true,
  apiKey: secret
}
const firstTelemetry = {
  callId: 'call-1',
  runId: 'job-1',
  provider: 'compatible',
  model: 'trace-model',
  durationMs: 1250,
  attempts: 2,
  responseFormatFallback: true,
  finishReason: 'stop',
  usage: { promptTokens: 400, completionTokens: 200, totalTokens: 600 },
  terminationCategory: 'none'
}
const client = new clientModule.AIClient(settings, {
  chatCompletion: async () => ({
    ok: true,
    content: '{"value":"ok"}',
    finishReason: 'stop',
    telemetry: firstTelemetry
  })
}, 'job-1')
const result = await client.requestJson(
  `system ${prompt}`,
  `user ${prose}`,
  (value) => value,
  { value: 'fallback' }
)
assert(result.ok && result.telemetry?.callId === 'call-1', 'AIClient must preserve safe transport telemetry')

const project = {
  id: 'project-1',
  name: 'Trace fixture',
  genre: '',
  description: '',
  targetReaders: '',
  coreAppeal: '',
  style: '',
  createdAt: timestamp,
  updatedAt: timestamp
}
const job = {
  id: 'job-1',
  projectId: project.id,
  targetChapterOrder: 2,
  contextSource: 'auto',
  status: 'running',
  currentStep: 'generate_chapter_plan',
  createdAt: timestamp,
  updatedAt: timestamp,
  errorMessage: ''
}
const step = {
  id: 'step-plan',
  jobId: job.id,
  type: 'generate_chapter_plan',
  status: 'running',
  inputSnapshot: '',
  output: '',
  errorMessage: '',
  createdAt: timestamp,
  updatedAt: timestamp
}
let data = structuredClone(defaultsModule.EMPTY_APP_DATA)
data.projects = [project]
data.chapterGenerationJobs = [job]
data.chapterGenerationSteps = [step]
data = traceModule.appendGenerationRunTraceAiCall(data, job.id, step, 'planner', result.telemetry, 'success')
data = traceModule.appendGenerationRunTraceAiCall(data, job.id, step, 'planner', result.telemetry, 'success')
assert(data.generationRunTraces[0].aiCalls.length === 1, 'same transport callId must be idempotent in Run Trace')

const secondTelemetry = {
  ...firstTelemetry,
  callId: 'call-2',
  durationMs: 900,
  attempts: 1,
  responseFormatFallback: false
}
data = traceModule.appendGenerationRunTraceAiCall(data, job.id, step, 'planner', secondTelemetry, 'success')
const calls = data.generationRunTraces[0].aiCalls
assert(calls.length === 2 && calls[1].logicalCallIndex === 2, 'logical retries must remain separate calls')
assert(calls[0].role === 'planner' && calls[0].stepId === step.id, 'trace must bind telemetry to role and step')
const serializedTrace = JSON.stringify(data.generationRunTraces[0])
assert(!serializedTrace.includes(secret) && !serializedTrace.includes(prompt) && !serializedTrace.includes(prose), 'trace must exclude secrets, prompts, and prose')

const legacyTrace = { ...data.generationRunTraces[0] }
delete legacyTrace.aiCalls
assert(normalizerModule.normalizeGenerationRunTrace(legacyTrace).aiCalls.length === 0, 'legacy traces must normalize with an empty aiCalls list')

const evaluation = {
  overallScore: 88,
  pass: true,
  dimensions: {
    plotCoherence: 88,
    characterConsistency: 88,
    characterStateConsistency: 88,
    foreshadowingControl: 88,
    chapterContinuity: 88,
    redundancyControl: 88,
    styleMatch: 88,
    pacing: 88,
    emotionalPayoff: 88,
    originality: 88,
    promptCompliance: 88,
    contextRelevanceCompliance: 88
  },
  issues: [],
  requiredFixes: [],
  optionalSuggestions: []
}
const draft = {
  id: 'draft-1',
  projectId: project.id,
  chapterId: null,
  jobId: job.id,
  title: '测试章',
  body: '这是一段用于质量门禁遥测验证的正文。角色推门进入房间，确认现场没有异常。',
  summary: '',
  status: 'draft',
  tokenEstimate: 30,
  createdAt: timestamp,
  updatedAt: timestamp
}
const qualityReport = await qualityModule.QualityGateService.evaluateChapterDraft({
  projectId: project.id,
  jobId: job.id,
  chapterId: null,
  draftId: draft.id,
  chapterDraft: draft,
  context: '质量门禁上下文',
  chapterPlan: null,
  aiService: {
    generateQualityGateReport: async () => ({
      ok: true,
      usedAI: true,
      data: evaluation,
      telemetry: secondTelemetry
    })
  }
})
assert(qualityReport.aiTelemetry?.callId === 'call-2', 'main-process quality report must carry safe AI telemetry back to the pipeline')

console.log('Pipeline AI call trace validation passed.')
