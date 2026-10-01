import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const channels = read('src/shared/ipc/ipcChannels.ts')
const ipcTypes = read('src/shared/ipc/ipcTypes.ts')
const preload = read('src/preload/index.ts')
const registerIpc = read('src/main/ipc/registerIpcHandlers.ts')
const diagnosticsIpc = read('src/main/ipc/diagnosticsIpcHandlers.ts')
const diagnosticsService = read('src/main/services/DiagnosticsService.ts')
const mainAiJsonClient = read('src/main/services/MainAIJsonClient.ts')
const diagnosticsApi = read('src/renderer/src/utils/diagnosticsApi.ts')
const qualityStep = read('src/renderer/src/views/generation/pipelineSteps/qualityCheck.ts')
const chapterStep = read('src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts')
const qualityGateAi = read('src/services/ai/QualityGateAI.ts')
const runTests = read('scripts/run-tests.mjs')

for (const channel of [
  'DIAGNOSTICS_ANALYZE_REDUNDANCY',
  'DIAGNOSTICS_AUDIT_NOVELTY',
  'DIAGNOSTICS_EVALUATE_QUALITY_GATE'
]) {
  assert(channels.includes(channel), `IPC channel exists: ${channel}`)
  assert(diagnosticsIpc.includes(`IPC_CHANNELS.${channel}`), `diagnostics IPC registers ${channel}`)
}

for (const typeName of [
  'DiagnosticsAnalyzeRedundancyRequest',
  'DiagnosticsAuditNoveltyRequest',
  'DiagnosticsEvaluateQualityGateRequest',
  'DiagnosticsEvaluateQualityGateResult'
]) {
  assert(ipcTypes.includes(typeName), `IPC type exists: ${typeName}`)
}

assert(preload.includes('diagnostics: {'), 'preload exposes grouped diagnostics API')
assert(preload.includes('analyzeRedundancy') && preload.includes('auditNovelty') && preload.includes('evaluateQualityGate'), 'preload exposes all diagnostics methods')
assert(registerIpc.includes('new DiagnosticsService(context.aiService)'), 'main diagnostics service owns diagnostics execution boundary')
assert(registerIpc.includes('registerDiagnosticsIpcHandlers(diagnosticsService)'), 'main IPC delegates diagnostics handlers to diagnosticsIpcHandlers')
assert(!registerIpc.includes('IPC_CHANNELS.DIAGNOSTICS_ANALYZE_REDUNDANCY'), 'main IPC should not inline redundancy diagnostics handler')
assert(!registerIpc.includes('IPC_CHANNELS.DIAGNOSTICS_AUDIT_NOVELTY'), 'main IPC should not inline novelty diagnostics handler')
assert(!registerIpc.includes('IPC_CHANNELS.DIAGNOSTICS_EVALUATE_QUALITY_GATE'), 'main IPC should not inline quality gate diagnostics handler')
assert(diagnosticsService.includes('QualityGateService.evaluateChapterDraft'), 'main diagnostics service evaluates quality gate in main process')
assert(diagnosticsService.includes('NoveltyDetector.audit'), 'main diagnostics service audits novelty in main process')
assert(diagnosticsService.includes('analyzeRedundancy'), 'main diagnostics service analyzes redundancy in main process')
assert(diagnosticsService.includes('new MainAIJsonClient'), 'main quality gate uses a main-process JSON AI client adapter')
assert(mainAiJsonClient.includes('aiTransport.chatCompletion') && !mainAiJsonClient.includes('window.novelDirector'), 'main JSON AI client uses main transport and does not touch renderer globals')
assert(qualityGateAi.includes('AIJsonClient') && !qualityGateAi.includes('constructor(private readonly client: AIClient)'), 'QualityGateAI depends on a transport-agnostic JSON client interface')
assert(ipcTypes.includes('chapterTask?: ChapterTask | null'), 'quality diagnostics IPC carries the authoritative ChapterTask contract')
assert(diagnosticsIpc.includes("optionalChapterTask(request.chapterTask, 'chapterTask')"), 'diagnostics IPC validates the nested ChapterTask contract')
assert(diagnosticsService.includes('chapterTask: request.chapterTask ?? null'), 'main diagnostics forwards ChapterTask into the quality service')

assert(qualityStep.includes('evaluateQualityGateDiagnostic') && qualityStep.includes('auditNoveltyDiagnostic'), 'quality step calls diagnostics API helpers')
assert(qualityStep.includes('chapterTask: job.chapterTaskSnapshot ?? null'), 'quality step sends the frozen job ChapterTask to diagnostics')
assert(!qualityStep.includes('QualityGateService') && !qualityStep.includes('NoveltyDetector'), 'quality step has no static diagnostic service imports')
assert(chapterStep.includes('auditNoveltyDiagnostic') && chapterStep.includes('analyzeRedundancyDiagnostic'), 'draft step calls diagnostics API helpers')
assert(!chapterStep.includes('NoveltyDetector') && !chapterStep.includes('RedundancyService'), 'draft step has no static novelty/redundancy service imports')

assert(diagnosticsApi.includes('getNovelDirectorDiagnosticsApi'), 'renderer diagnostics helper calls preload diagnostics API through guarded bridge accessor')
assert(!diagnosticsApi.includes("await import('../../../services/QualityGateService')"), 'renderer diagnostics helper does not lazy-load quality gate service')
assert(!diagnosticsApi.includes("await import('../../../services/NoveltyDetector')"), 'renderer diagnostics helper does not lazy-load novelty detector')
assert(!diagnosticsApi.includes("await import('../../../services/RedundancyService')"), 'renderer diagnostics helper does not lazy-load redundancy service')
assert(!diagnosticsApi.includes('window.novelDirector'), 'renderer diagnostics helper does not read window.novelDirector directly')
assert(runTests.includes('validate-main-diagnostics-boundary.mjs'), 'npm test runs main diagnostics boundary validation')

console.log('validate-main-diagnostics-boundary: ok')
