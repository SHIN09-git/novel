#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'agent-runtime-p5-test')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf-8')
}

async function bundle(entryPoint, outfileName) {
  const outfile = join(outDir, outfileName)
  await build({
    entryPoints: [join(root, entryPoint)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function now() {
  return '2026-05-31T00:00:00.000Z'
}

function fixture() {
  const timestamp = now()
  const skLikeSecret = ['sk', 'test-agent-p5-secret-1234567890'].join('-')
  return {
    schemaVersion: 3,
    projects: [
      {
        id: 'project-1',
        name: 'Agent P5 Fixture',
        genre: 'test',
        description: 'Fixture project.',
        targetReaders: '',
        coreAppeal: '',
        style: 'PROJECT_STYLE_WITH_FUTURE_STAGE_PRESSURE',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    chapters: [
      {
        id: 'chapter-1',
        projectId: 'project-1',
        order: 1,
        title: 'Old Chapter',
        body: `Old chapter body FULL_PROSE_SHOULD_NOT_LEAK_BY_DEFAULT.${'x'.repeat(2200)}FULL_PROSE_END_MARKER`,
        summary: 'Old summary.',
        newInformation: '',
        characterChanges: '',
        newForeshadowing: '',
        resolvedForeshadowing: '',
        endingHook: '',
        riskWarnings: '',
        includedInStageSummary: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    chapterGenerationJobs: [
      {
        id: 'job-1',
        projectId: 'project-1',
        targetChapterOrder: 1,
        promptContextSnapshotId: 'snapshot-1',
        contextSource: 'prompt_snapshot',
        status: 'completed',
        currentStep: 'await_user_confirmation',
        createdAt: timestamp,
        updatedAt: timestamp,
        errorMessage: ''
      }
    ],
    chapterGenerationSteps: [
      {
        id: 'step-context-1',
        jobId: 'job-1',
        projectId: 'project-1',
        type: 'build_context',
        status: 'completed',
        output: JSON.stringify({ snapshotId: 'snapshot-1' }),
        errorMessage: '',
        startedAt: timestamp,
        completedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    generatedChapterDrafts: [
      {
        id: 'draft-1',
        projectId: 'project-1',
        chapterId: 'chapter-1',
        jobId: 'job-1',
        title: 'Accepted Draft',
        body: 'Accepted draft body.',
        summary: 'Draft summary.',
        status: 'draft',
        tokenEstimate: 500,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    qualityGateReports: [
      {
        id: 'quality-1',
        projectId: 'project-1',
        jobId: 'job-1',
        chapterId: 'chapter-1',
        draftId: 'draft-1',
        promptContextSnapshotId: null,
        overallScore: 92,
        pass: true,
        dimensions: {
          plotCoherence: 92,
          characterConsistency: 92,
          characterStateConsistency: 92,
          foreshadowingControl: 92,
          chapterContinuity: 92,
          redundancyControl: 92,
          styleMatch: 92,
          pacing: 92,
          emotionalPayoff: 92,
          originality: 92,
          promptCompliance: 92,
          contextRelevanceCompliance: 92
        },
        issues: [],
        requiredFixes: [],
        optionalSuggestions: [],
        createdAt: timestamp
      }
    ],
    consistencyReviewReports: [
      {
        id: 'consistency-1',
        projectId: 'project-1',
        jobId: 'job-1',
        chapterId: 'chapter-1',
        promptContextSnapshotId: null,
        issues: [],
        suggestions: '',
        severitySummary: 'low',
        createdAt: timestamp
      }
    ],
    generationRunTraces: [
      {
        id: 'trace-1',
        projectId: 'project-1',
        jobId: 'job-1',
        targetChapterOrder: 1,
        promptContextSnapshotId: null,
        contextSource: 'auto',
        selectedChapterIds: ['chapter-1'],
        selectedStageSummaryIds: [],
        selectedCharacterIds: [],
        selectedForeshadowingIds: [],
        selectedTimelineEventIds: [],
        foreshadowingTreatmentModes: {},
        foreshadowingTreatmentOverrides: {},
        omittedContextItems: [],
        contextWarnings: [],
        contextTokenEstimate: 100,
        contextSelectionTrace: null,
        forcedContextBlocks: [],
        compressionRecords: [],
        promptBlockOrder: [],
        finalPromptTokenEstimate: 200,
        promptLintWarnings: [],
        promptLintIssueCount: 0,
        generatedDraftId: 'draft-1',
        consistencyReviewReportId: 'consistency-1',
        qualityGateReportId: 'quality-1',
        revisionSessionIds: [],
        acceptedRevisionVersionId: null,
        acceptedMemoryCandidateIds: [],
        rejectedMemoryCandidateIds: [],
        continuityBridgeId: null,
        continuitySource: null,
        redundancyReportId: null,
        continuityWarnings: [],
        contextNeedPlanId: null,
        requiredCharacterCardFields: {},
        requiredStateFactCategories: {},
        contextNeedPlanWarnings: [],
        contextNeedPlanMatchedItems: [],
        contextNeedPlanOmittedItems: [],
        includedCharacterStateFactIds: [],
        characterStateWarnings: [],
        characterStateIssueIds: [],
        noveltyAuditResult: { severity: 'pass', summary: 'ok', newNamedCharacters: [], newWorldRules: [], newSystemMechanics: [], newOrganizationsOrRanks: [], majorLoreReveals: [], suspiciousDeusExRules: [], untracedNames: [] },
        storyDirectionGuideId: null,
        storyDirectionGuideSource: null,
        storyDirectionGuideHorizon: null,
        storyDirectionGuideStartChapterOrder: null,
        storyDirectionGuideEndChapterOrder: null,
        storyDirectionBeatId: null,
        storyDirectionAppliedToChapterTask: false,
        hardCanonPackItemCount: 0,
        hardCanonPackTokenEstimate: 0,
        includedHardCanonItemIds: [],
        truncatedHardCanonItemIds: [],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    runTraceAuthorSummaries: [],
    promptContextSnapshots: [
      {
        id: 'snapshot-1',
        projectId: 'project-1',
        targetChapterOrder: 1,
        mode: 'standard',
        budgetProfileId: null,
        budgetProfile: {
          id: 'budget-1',
          projectId: 'project-1',
          name: 'standard',
          maxTokens: 16000,
          mode: 'standard',
          includeRecentChaptersCount: 3,
          includeStageSummariesCount: 2,
          includeMainCharacters: true,
          includeRelatedCharacters: true,
          includeForeshadowingWeights: ['high'],
          includeTimelineEventsCount: 5,
          styleSampleMaxChars: 1000,
          createdAt: timestamp,
          updatedAt: timestamp
        },
        contextSelectionResult: {
          selectedChapterIds: ['chapter-1'],
          selectedStageSummaryIds: [],
          selectedCharacterIds: [],
          selectedForeshadowingIds: [],
          selectedTimelineEventIds: [],
          omittedItems: [],
          estimatedTokens: 100,
          warnings: [],
          compressionRecords: [],
          selectedCharacterFieldMap: {},
          selectedCharacterStateFactIds: [],
          contextSelectionTrace: null
        },
        selectedCharacterIds: [],
        selectedForeshadowingIds: [],
        foreshadowingTreatmentOverrides: {},
        chapterTask: {
          goal: 'test',
          conflict: '',
          suspenseToKeep: '',
          allowedPayoffs: '',
          forbiddenPayoffs: '',
          endingHook: '',
          readerEmotion: '',
          targetWordCount: '',
          styleRequirement: '',
          allowedNovelty: { allowedNewCharacters: [], allowedNewRules: [], allowedNewSystemMechanics: [], allowedNewOrganizationsOrRanks: [], allowedLoreReveals: [], notes: '' },
          forbiddenNovelty: { forbiddenNewCharacters: [], forbiddenNewRules: [], forbiddenSystemMechanics: [], forbiddenOrganizationsOrRanks: [], forbiddenLoreReveals: [], notes: '' }
        },
        contextNeedPlan: null,
        storyDirectionGuide: null,
        finalPrompt: `Snapshot prompt text PROMPT_SHOULD_NOT_LEAK_BY_DEFAULT.${'p'.repeat(2200)}PROMPT_END_MARKER apiKey=TEST_AGENT_P5_PROMPT_SECRET_SHOULD_NOT_APPEAR ${skLikeSecret}`,
        estimatedTokens: 100,
        source: 'manual',
        note: '',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    agentRuns: [
      {
        id: 'agent-run-1',
        projectId: 'project-1',
        goal: 'Run chapter 1.',
        mode: 'single_chapter',
        safetyMode: 'autonomous',
        targetChapterOrders: [1],
        status: 'paused',
        createdJobIds: ['job-1'],
        createdDraftIds: [],
        createdCommitIds: [],
        pendingHumanReviewItemIds: [],
        decisions: [],
        summary: '',
        warnings: [],
        startedAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
        schemaVersion: 1
      }
    ],
    agentActionPreviews: [],
    settings: {
      apiProvider: 'openai',
      apiKey: 'TEST_AGENT_P5_SECRET_SHOULD_NOT_APPEAR',
      hasApiKey: true,
      baseUrl: '',
      modelName: '',
      temperature: 0.8,
      maxTokens: 8000,
      retryEnabled: true,
      maxRetries: 3,
      enableAutoSummary: false,
      enableChapterDiagnostics: false,
      defaultTokenBudget: 16000,
      defaultPromptMode: 'standard',
      theme: 'system'
    }
  }
}

async function requestLine(child, request) {
  return new Promise((resolvePromise, reject) => {
    let stdout = ''
    const timer = setTimeout(() => reject(new Error('Timed out waiting for tool server response.')), 10000)
    const onData = (chunk) => {
      stdout += Buffer.from(chunk).toString('utf-8')
      const lineEnd = stdout.indexOf('\n')
      if (lineEnd < 0) return
      clearTimeout(timer)
      child.stdout.off('data', onData)
      resolvePromise(JSON.parse(stdout.slice(0, lineEnd)))
    }
    child.stdout.on('data', onData)
    child.stdin.write(`${JSON.stringify(request)}\n`)
  })
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const toolSource = read('src/agent/tools/AgentToolService.ts')
const definitionSource = read('src/agent/tools/agentToolDefinitions.ts')
const writeHandlerSource = read('src/agent/tools/agentToolWriteHandlers.ts')
const serverSource = read('src/agent/mcp/server.ts')
const packageJson = JSON.parse(read('package.json'))
const runTests = read('scripts/run-tests.mjs')

assert(toolSource.includes('AGENT_TOOL_DEFINITIONS'), 'Agent tool definitions must exist.')
assert(definitionSource.includes('agent.applyApprovedChapterCommit'), 'Agent tools must expose approved chapter commit apply.')
assert(writeHandlerSource.includes('saveAgentChapterCommitBundle'), 'Agent tools must use transaction-backed commit save.')
assert(serverSource.includes('tools/list'), 'Tool server must expose MCP-style tools/list.')
assert(serverSource.includes('tools/call'), 'Tool server must expose MCP-style tools/call.')
assert(
  serverSource.match(/void handleRequest\(request\)/g)?.length >= 2,
  'MCP line and framed transports must dispatch requests without serially awaiting long-running tools.'
)
assert(
  !serverSource.includes('await handleLineMessage') && !serverSource.includes('await handleFramedMessage'),
  'MCP input parsing must remain non-blocking so progress and cancellation can run beside a pipeline request.'
)
assert(packageJson.scripts['agent:tools'] === 'node scripts/run-agent-tools.mjs', 'package.json must expose npm run agent:tools.')
assert(runTests.includes('validate-agent-runtime-p5.mjs'), 'npm test must include P5 agent validation.')
const runAgentToolsScript = read('scripts/run-agent-tools.mjs')
assert(runAgentToolsScript.includes('fileURLToPath(import.meta.url)'), 'run-agent-tools.mjs must derive repo root from its own file path.')
assert(!runAgentToolsScript.includes("resolve('.')"), 'run-agent-tools.mjs must not depend on the caller cwd for repo root.')
assert(runAgentToolsScript.includes('cwd: root'), 'run-agent-tools.mjs must spawn the bundled MCP server with repo root cwd.')
assert(!toolSource.includes('better-sqlite3'), 'AgentToolService must not import SQLite directly.')
assert(!serverSource.includes('better-sqlite3'), 'Agent MCP server must not import SQLite directly.')
assert(!/renderer\/src|src\/renderer|from ['"].*views|from ['"].*components/.test(toolSource + serverSource), 'Agent tool API must not import renderer UI.')

const { normalizeAppData } = await bundle('src/shared/normalizers/appData.ts', 'normalizer.mjs')
const { draftContentHash } = await bundle('src/services/DraftDiagnosticBindingService.ts', 'draft-binding.mjs')
const { AgentToolService } = await bundle('src/agent/tools/AgentToolService.ts', 'agent-tool-service.mjs')

const normalized = normalizeAppData(fixture())
const currentHash = draftContentHash(normalized.generatedChapterDrafts[0].body)
const data = {
  ...normalized,
  qualityGateReports: normalized.qualityGateReports.map((report) => ({ ...report, draftContentHash: currentHash })),
  consistencyReviewReports: normalized.consistencyReviewReports.map((report) => ({
    ...report,
    draftId: 'draft-1',
    draftContentHash: currentHash
  })),
  generationRunTraces: normalized.generationRunTraces.map((trace) => ({
    ...trace,
    noveltyAuditResult: trace.noveltyAuditResult
      ? { ...trace.noveltyAuditResult, sourceDraftId: 'draft-1', sourceContentHash: currentHash, auditedAt: now() }
      : null
  }))
}
const fixturePath = join(outDir, 'novel-director-data.json')
await writeFile(fixturePath, JSON.stringify(data, null, 2), 'utf-8')

const toolNames = AgentToolService.listTools().map((tool) => tool.name)
for (const requiredName of [
  'agent.listProjects',
  'agent.getProjectDigest',
  'agent.getArchivedChapters',
  'agent.getChapterText',
  'agent.getPromptSnapshot',
  'agent.getRunDiagnostics',
  'agent.inspectPipelineJob',
  'agent.recordAcceptanceDecision',
  'agent.applyApprovedChapterCommit',
  'agent.archiveChapter',
  'agent.restoreArchivedChapter',
  'agent.continueAgentRun',
  'agent.runChapterPipeline',
  'agent.retryChapterPipeline',
  'agent.getPipelineProgress',
  'agent.cancelChapterPipeline'
]) {
  assert(toolNames.includes(requiredName), `Missing Agent tool ${requiredName}.`)
}
assert(AgentToolService.listTools().find((tool) => tool.name === 'agent.applyApprovedChapterCommit')?.riskLevel === 'write_commit', 'Commit apply tool must be marked write_commit.')
assert(AgentToolService.listTools().find((tool) => tool.name === 'agent.archiveChapter')?.riskLevel === 'write_commit', 'Chapter archive tool must be marked write_commit.')
assert(AgentToolService.listTools().find((tool) => tool.name === 'agent.restoreArchivedChapter')?.riskLevel === 'write_commit', 'Chapter restore tool must be marked write_commit.')
const startRunSchema = AgentToolService.listTools().find((tool) => tool.name === 'agent.startAgentRun')?.inputSchema
const runPipelineSchema = AgentToolService.listTools().find((tool) => tool.name === 'agent.runChapterPipeline')?.inputSchema
const retryPipelineSchema = AgentToolService.listTools().find((tool) => tool.name === 'agent.retryChapterPipeline')?.inputSchema
assert(startRunSchema?.properties?.chapterTask, 'startAgentRun must accept a structured chapter task contract.')
assert(runPipelineSchema?.properties?.chapterTask, 'runChapterPipeline must accept a structured chapter task contract.')
assert(startRunSchema?.properties?.temperature?.maximum === 2, 'startAgentRun must expose bounded per-job temperature.')
assert(runPipelineSchema?.properties?.temperature?.maximum === 2, 'runChapterPipeline must expose bounded per-job temperature.')
assert(!retryPipelineSchema?.properties?.chapterTask, 'retryChapterPipeline must not replace the persisted chapter task contract.')
assert(!retryPipelineSchema?.properties?.temperature, 'retryChapterPipeline must not replace the persisted temperature snapshot.')

const listed = await AgentToolService.callTool({ name: 'agent.listProjects', arguments: { storagePath: fixturePath } })
assert(JSON.stringify(listed).includes('Agent P5 Fixture'), 'agent.listProjects should read fixture project.')
assert(!JSON.stringify(listed).includes('TEST_AGENT_P5_SECRET_SHOULD_NOT_APPEAR'), 'Tool output must not include API key.')

const chapterText = await AgentToolService.callTool({ name: 'agent.getChapterText', arguments: { storagePath: fixturePath, projectId: 'project-1', chapterOrder: 1 } })
assert(chapterText.data.text === undefined, 'Chapter text tool must omit full text by default.')
const fullChapterText = await AgentToolService.callTool({ name: 'agent.getChapterText', arguments: { storagePath: fixturePath, projectId: 'project-1', chapterOrder: 1, detail: 'full' } })
assert(JSON.stringify(fullChapterText).includes('FULL_PROSE_END_MARKER'), 'Chapter text tool must return complete prose when full read has no maxChars.')

const promptDefault = await AgentToolService.callTool({ name: 'agent.getGenerationPrompt', arguments: { storagePath: fixturePath, jobId: 'job-1' } })
assert(promptDefault.data.text === undefined, 'Prompt tool must omit full prompt by default.')
assert(JSON.stringify(promptDefault).includes('PROMPT_SHOULD_NOT_LEAK_BY_DEFAULT'), 'Prompt excerpt should resolve prompt snapshot ids for job prompts.')
const promptFull = await AgentToolService.callTool({ name: 'agent.getGenerationPrompt', arguments: { storagePath: fixturePath, jobId: 'job-1', detail: 'full' } })
assert(promptFull.data.text.includes('PROMPT_END_MARKER'), 'Prompt tool should dereference and return the complete snapshot prompt when full is requested.')
const snapshot = await AgentToolService.callTool({ name: 'agent.getPromptSnapshot', arguments: { storagePath: fixturePath, snapshotId: 'snapshot-1' } })
assert(JSON.stringify(snapshot).includes('selectedCounts'), 'Prompt snapshot tool should return compact selection summary.')
assert(!JSON.stringify(snapshot).includes('TEST_AGENT_P5_PROMPT_SECRET_SHOULD_NOT_APPEAR'), 'Prompt snapshot excerpt must redact API-key-like text.')
const snapshotFull = await AgentToolService.callTool({ name: 'agent.getPromptSnapshot', arguments: { storagePath: fixturePath, snapshotId: 'snapshot-1', includePrompt: true } })
assert(snapshotFull.data.finalPrompt.includes('PROMPT_END_MARKER'), 'Prompt snapshot full read without maxChars must not use the compact excerpt limit.')
assert(!JSON.stringify(snapshotFull).includes(['sk', 'test-agent-p5-secret-1234567890'].join('-')), 'Prompt snapshot full output must redact sk-like secrets.')
const inspected = await AgentToolService.callTool({ name: 'agent.inspectPipelineJob', arguments: { storagePath: fixturePath, jobId: 'job-1' } })
assert(JSON.stringify(inspected).includes('"id":"job-1"'), 'agent.inspectPipelineJob should alias run diagnostics.')

const run = await AgentToolService.callTool({ name: 'agent.continueAgentRun', arguments: { storagePath: fixturePath, projectId: 'project-1', startChapterOrder: 2, chapterCount: 5 } })
assert(JSON.stringify(run).includes('"targetChapterOrders":[2,3,4,5,6]'), 'continueAgentRun should record requested chapter range.')
const longRun = await AgentToolService.callTool({ name: 'agent.continueAgentRun', arguments: { storagePath: fixturePath, projectId: 'project-1', startChapterOrder: 20, chapterCount: 40 } })
assert(longRun.data.targetChapterOrders.length === 40, 'Agent queue must allow dozens of chapters while preparing one chapter workflow at a time.')
const toolChapterTask = {
  goal: 'TOOL_TASK_CONTRACT：从普通早餐开始，保持日常感。',
  conflict: '早餐时收到一条含糊短信。',
  suspenseToKeep: '不解释发信人身份。',
  endingHook: '出门前发现鞋柜位置变了。',
  readerEmotion: '轻松中带一点疑惑。',
  targetWordCount: '2600-3000',
  styleRequirement: '自然、生活化。'
}
const startedWithContract = await AgentToolService.callTool({
  name: 'agent.startAgentRun',
  arguments: {
    storagePath: fixturePath,
    projectId: 'project-1',
    chapterOrder: 8,
    goal: 'TOOL_RUN_AUDIT_GOAL',
    chapterTask: toolChapterTask,
    temperature: 0.42
  }
})
assert(startedWithContract.data.agentRun.goal === 'TOOL_RUN_AUDIT_GOAL', 'The run audit goal must remain independent from the chapter task.')
assert(startedWithContract.data.job.chapterTaskSnapshot.goal === toolChapterTask.goal, 'The tool must persist the structured task on the chapter job.')
assert(startedWithContract.data.job.chapterTaskSnapshot.allowedPayoffs === '', 'Partial tool tasks must normalize to the complete ChapterTask shape.')
assert(startedWithContract.data.job.aiRunConfig.temperature === 0.42, 'The tool temperature override must be frozen in job.aiRunConfig.')
const openingWithSparseContract = await AgentToolService.callTool({
  name: 'agent.startAgentRun',
  arguments: {
    storagePath: fixturePath,
    projectId: 'project-1',
    chapterOrder: 1,
    chapterTask: { goal: '从普通早饭自然开始。' }
  }
})
assert(
  openingWithSparseContract.data.job.chapterTaskSnapshot.styleRequirement === '' &&
    !JSON.stringify(openingWithSparseContract.data.job.chapterTaskSnapshot).includes('PROJECT_STYLE_WITH_FUTURE_STAGE_PRESSURE'),
  'A sparse authoritative chapter-1 task must not inherit plot-bearing project style.'
)
assert(
  openingWithSparseContract.data.job.chapterTaskSnapshot.readerEmotion.includes('不承接不存在的上一章情绪'),
  'A sparse authoritative chapter-1 task must receive an opening-safe emotion fallback.'
)
const laterWithSparseContract = await AgentToolService.callTool({
  name: 'agent.startAgentRun',
  arguments: {
    storagePath: fixturePath,
    projectId: 'project-1',
    chapterOrder: 10,
    chapterTask: { goal: '继续既有章节。' }
  }
})
assert(
  laterWithSparseContract.data.job.chapterTaskSnapshot.styleRequirement === 'PROJECT_STYLE_WITH_FUTURE_STAGE_PRESSURE',
  'Later sparse tasks may still inherit the established project style.'
)
let invalidTemperatureRejected = false
try {
  await AgentToolService.callTool({
    name: 'agent.startAgentRun',
    arguments: { storagePath: fixturePath, projectId: 'project-1', chapterOrder: 9, chapterTask: toolChapterTask, temperature: 2.1 }
  })
} catch (error) {
  invalidTemperatureRejected = /temperature|maximum|between 0 and 2/i.test(String(error))
}
assert(invalidTemperatureRejected, 'Per-job temperature must reject values outside 0-2.')
let malformedTemperatureRejected = false
try {
  await AgentToolService.callTool({
    name: 'agent.startAgentRun',
    arguments: { storagePath: fixturePath, projectId: 'project-1', chapterOrder: 9, chapterTask: toolChapterTask, temperature: 'warm' }
  })
} catch (error) {
  malformedTemperatureRejected = /temperature must be a number between 0 and 2/i.test(String(error))
}
assert(malformedTemperatureRejected, 'Malformed per-job temperature must fail instead of silently falling back to project settings.')
let malformedNumberRejected = false
try {
  await AgentToolService.callTool({ name: 'agent.getChapterText', arguments: { storagePath: fixturePath, projectId: 'project-1', chapterOrder: '1junk' } })
} catch (error) {
  malformedNumberRejected = /invalid chapterOrder/i.test(String(error))
}
assert(malformedNumberRejected, 'Agent tool arguments must reject partially numeric chapter orders.')
let malformedReadLimitRejected = false
try {
  await AgentToolService.callTool({ name: 'agent.getChapterText', arguments: { storagePath: fixturePath, projectId: 'project-1', chapterOrder: 1, detail: 'full', maxChars: 'unbounded' } })
} catch (error) {
  malformedReadLimitRejected = /maxChars must be a positive integer/i.test(String(error))
}
assert(malformedReadLimitRejected, 'Invalid maxChars must fail instead of silently returning unbounded full text.')
const singleRun = await AgentToolService.callTool({ name: 'agent.runChapterPipeline', arguments: { storagePath: fixturePath, projectId: 'project-1', chapterOrder: 7 } })
assert(JSON.stringify(singleRun).includes('"targetChapterOrders":[7]'), 'agent.runChapterPipeline should create a traceable single-chapter run.')
assert(Number.isInteger(singleRun.data.completedStepCount), 'agent.runChapterPipeline should return actual pipeline execution progress.')
assert(Object.hasOwn(singleRun.data, 'failedStep'), 'agent.runChapterPipeline should report the failed step or null after real execution.')
const singleRunProgress = await AgentToolService.callTool({
  name: 'agent.getPipelineProgress',
  arguments: { storagePath: fixturePath, jobId: singleRun.data.job.id }
})
assert(singleRunProgress.data.totalStepCount === 14, 'getPipelineProgress must expose the standard step count.')
assert(typeof singleRunProgress.data.progressPercent === 'number', 'getPipelineProgress must expose structured progress.')
const inactiveCancel = await AgentToolService.callTool({
  name: 'agent.cancelChapterPipeline',
  arguments: { storagePath: fixturePath, jobId: singleRun.data.job.id, reason: 'not running' }
})
assert(inactiveCancel.data.accepted === false, 'cancelChapterPipeline must not create a marker for a non-running job.')
if (singleRun.data.failedStep) {
  const retried = await AgentToolService.callTool({
    name: 'agent.retryChapterPipeline',
    arguments: {
      storagePath: fixturePath,
      agentRunId: singleRun.data.agentRun.id,
      jobId: singleRun.data.job.id
    }
  })
  assert(retried.data.job.id === singleRun.data.job.id, 'retryChapterPipeline must reuse the failed job instead of creating another one.')
  assert(retried.data.agentRun.id === singleRun.data.agentRun.id, 'retryChapterPipeline must reuse the existing AgentRun.')
  assert(retried.data.resumedFromStep === singleRun.data.failedStep.type, 'retryChapterPipeline must resume from the persisted failed step.')
}

const decision = await AgentToolService.callTool({ name: 'agent.recordAcceptanceDecision', arguments: { storagePath: fixturePath, agentRunId: 'agent-run-1', jobId: 'job-1' } })
const previewId = decision.data.preview.id
const applied = await AgentToolService.callTool({ name: 'agent.applyApprovedChapterCommit', arguments: { storagePath: fixturePath, previewId } })
assert(applied.data.appliedCommit.kind === 'chapter_commit', 'applyApprovedChapterCommit should apply chapter commit preview.')
const saved = JSON.parse(await readFile(fixturePath, 'utf-8'))
assert(saved.chapterCommitBundles?.length === 1, 'Tool API commit apply should persist ChapterCommitBundle.')
assert(saved.chapters?.[0]?.body === 'Accepted draft body.', 'Tool API commit apply should update chapter text.')
assert(!JSON.stringify(saved).includes('TEST_AGENT_P5_SECRET_SHOULD_NOT_APPEAR'), 'Tool API save path must sanitize API keys.')

const server = spawn(process.execPath, [join(root, 'scripts', 'run-agent-tools.mjs')], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: false
})
try {
  const init = await requestLine(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  assert(init.result?.capabilities?.tools, 'MCP server initialize should advertise tools capability.')
  const tools = await requestLine(server, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  assert(tools.result.tools.some((tool) => tool.name === 'agent.listProjects'), 'MCP tools/list should include agent.listProjects.')
  const call = await requestLine(server, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'agent.listProjects', arguments: { storagePath: fixturePath } } })
  assert(call.result.structuredContent.data.some((project) => project.id === 'project-1'), 'MCP tools/call should invoke Agent tool.')
} finally {
  server.kill()
}

console.log('Agent Runtime P5 validation passed.')
