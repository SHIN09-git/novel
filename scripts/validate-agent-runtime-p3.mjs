#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'agent-runtime-p3-test')

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
  return {
    schemaVersion: 3,
    projects: [
      {
        id: 'project-1',
        name: 'Agent P3 Fixture',
        genre: 'test',
        description: '',
        targetReaders: '',
        coreAppeal: '',
        style: '',
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
        body: 'Old chapter body.',
        summary: '',
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
        promptContextSnapshotId: null,
        contextSource: 'auto',
        status: 'completed',
        currentStep: 'await_user_confirmation',
        createdAt: timestamp,
        updatedAt: timestamp,
        errorMessage: ''
      }
    ],
    chapterGenerationSteps: [],
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
    runTraceAuthorSummaries: [
      {
        id: 'summary-1',
        projectId: 'project-1',
        chapterId: 'chapter-1',
        jobId: 'job-1',
        traceId: 'trace-1',
        generatedDraftId: 'draft-1',
        createdAt: timestamp,
        summaryVersion: 1,
        overallStatus: 'good',
        oneLineDiagnosis: 'No major risk.',
        likelyProblemSources: [],
        nextActions: [],
        sourceRefs: { generationRunTraceId: 'trace-1' }
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
      apiKey: 'TEST_AGENT_P3_SECRET_SHOULD_NOT_APPEAR',
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

async function runCli(args, expectedCode = 0) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    const errors = []
    const child = spawn(process.execPath, [join(root, 'scripts', 'run-agent.mjs'), ...args], {
      cwd: root,
      shell: false
    })
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)))
    child.on('error', reject)
    child.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString('utf-8')
      const stderr = Buffer.concat(errors).toString('utf-8')
      if (code !== expectedCode) {
        reject(new Error(`CLI exited ${code}: ${stderr || stdout}`))
        return
      }
      resolvePromise({ stdout, stderr, json: JSON.parse(stdout) })
    })
  })
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const cliSource = read('src/agent/cli.ts')
const toolSource = read('src/agent/tools/AgentToolService.ts')
const toolDefinitionSource = read('src/agent/tools/agentToolDefinitions.ts')
const toolWriteSource = read('src/agent/tools/agentToolWriteHandlers.ts')
const runtimeSource = read('src/agent/AgentRuntime.ts')
const commitSource = read('src/agent/AgentCommitService.ts')
const runTests = read('scripts/run-tests.mjs')

assert(commitSource.includes('buildAcceptedDraftCommitBundle'), 'AgentCommitService must build ChapterCommitBundle.')
assert(commitSource.includes('applyChapterCommitBundleToAppData'), 'AgentCommitService must locally apply ChapterCommitBundle.')
assert(runtimeSource.includes('saveAgentChapterCommitBundle'), 'AgentRuntime must expose transactional chapter commit save.')
assert(runtimeSource.includes('storageSourceForPath(result.storagePath)'), 'AgentRuntime must report the storage backend that actually completed the write.')
assert(cliSource.includes('apply-action-preview'), 'Agent CLI must expose apply-action-preview.')
assert(cliSource.includes('AgentToolService'), 'Agent CLI should delegate command execution to AgentToolService.')
assert(toolSource.includes('handleAgentWriteTool'), 'Agent Tool facade must delegate mutations to the write handler.')
assert(toolWriteSource.includes('saveAgentChapterCommitBundle'), 'Agent Tool write handler must call the transactional chapter commit save path.')
assert(toolDefinitionSource.includes('agent.applyApprovedChapterCommit'), 'Agent Tool API must expose approved chapter commit apply.')
assert(runTests.includes('validate-agent-runtime-p3.mjs'), 'npm test must include P3 agent validation.')
assert(!commitSource.includes('better-sqlite3'), 'AgentCommitService must not import SQLite directly.')

const { normalizeAppData } = await bundle('src/shared/normalizers/appData.ts', 'normalizer.mjs')
const { draftContentHash, noveltyAuditMatchesDraft } = await bundle('src/services/DraftDiagnosticBindingService.ts', 'draft-binding.mjs')
const { AgentDecisionService } = await bundle('src/agent/AgentDecisionService.ts', 'agent-decision-service.mjs')
const { AgentCommitService } = await bundle('src/agent/AgentCommitService.ts', 'agent-commit-service.mjs')
const { applyChapterCommitBundleToAppData } = await bundle('src/services/ChapterCommitBundleService.ts', 'chapter-commit-service.mjs')
const { saveAgentRuntimeData } = await bundle('src/agent/AgentRuntime.ts', 'agent-runtime.mjs')

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
      ? { ...trace.noveltyAuditResult, sourceDraftId: 'draft-1', sourceContentHash: currentHash }
      : null
  }))
}

const runtimeStoragePath = join(outDir, 'runtime-metadata.json')
const runtime = {
  data: normalizeAppData({}),
  storagePath: runtimeStoragePath,
  userDataPath: outDir,
  source: 'json',
  revision: 'missing'
}
const runtimeSave = await saveAgentRuntimeData(data, runtime)
assert(runtimeSave.storagePath === runtimeStoragePath, 'Agent runtime save must return the actual JSON storage path.')
assert(runtime.source === 'json' && runtime.storagePath === runtimeStoragePath, 'Agent runtime must adopt the backend and path that completed the write.')
assert(runtime.revision === runtimeSave.revision, 'Agent runtime revision must advance with the completed write.')
assert(runtime.data === data, 'Agent runtime memory snapshot must match the successfully persisted AppData.')

assert(
  noveltyAuditMatchesDraft(data.generationRunTraces[0].noveltyAuditResult, data.generatedChapterDrafts[0]),
  `Fixture novelty audit must match current draft: ${JSON.stringify(data.generationRunTraces[0].noveltyAuditResult)}`
)
const staleAuthorSummaryData = {
  ...data,
  runTraceAuthorSummaries: [{
    ...data.runTraceAuthorSummaries[0],
    createdAt: '2026-06-01T00:00:00.000Z',
    overallStatus: 'risky',
    oneLineDiagnosis: 'STALE_AUTHOR_SUMMARY_MUST_NOT_AFFECT_DECISION',
    sourceRefs: { generationRunTraceId: 'trace-1' }
  }]
}
const recommendationWithoutStaleSummary = AgentDecisionService.buildAcceptanceRecommendation(staleAuthorSummaryData, 'job-1')
assert(
  !recommendationWithoutStaleSummary.reasons.some((reason) => reason.includes('STALE_AUTHOR_SUMMARY_MUST_NOT_AFFECT_DECISION')),
  'Agent acceptance must ignore author summaries that are not bound to the current diagnostic reports.'
)
const withPreview = AgentDecisionService.recordAcceptanceDecision({ appData: data, agentRunId: 'agent-run-1', jobId: 'job-1' }).appData
const preview = withPreview.agentActionPreviews[0]
assert(preview.actionType === 'chapter_commit', `Low-risk accept recommendation should create chapter_commit preview: ${JSON.stringify(withPreview.agentActionPreviews[0])}`)
const applied = AgentCommitService.applyActionPreview({ appData: withPreview, previewId: preview.id })
assert(applied.appliedCommit.kind === 'chapter_commit', 'Applying accept preview should produce a chapter commit.')
assert(applied.appData.chapters.find((chapter) => chapter.id === 'chapter-1')?.body === 'Accepted draft body.', 'Chapter body should be updated from draft.')
assert(
  applied.appData.chapterVersions.some(
    (version) => version.source === 'generated_draft' && version.body === 'Accepted draft body.'
  ),
  'Agent acceptance should create a formal generated-draft ChapterVersion.'
)
assert(
  applied.appData.chapterVersions.some(
    (version) => version.source === 'before_accept_draft' && version.body === 'Old chapter body.'
  ),
  'Agent acceptance should preserve the overwritten chapter as a pre-commit snapshot.'
)
assert(applied.appData.chapterCommitBundles.length === 1, 'ChapterCommitBundle should be stored in AppData.')
assert(applied.appData.generatedChapterDrafts.find((draft) => draft.id === 'draft-1')?.status === 'accepted', 'Draft should be marked accepted.')
assert(applied.appData.agentActionPreviews[0].status === 'applied', 'Preview should be marked applied.')
assert(applied.appData.agentRuns[0].createdCommitIds.includes(applied.appliedCommit.bundle.commitId), 'AgentRun should record created commit id.')
assert(applied.appData.agentRuns[0].createdDraftIds.includes('draft-1'), 'AgentRun should record accepted draft id.')

const commitOnly = applyChapterCommitBundleToAppData(withPreview, applied.appliedCommit.bundle)
const recoveredAfterPartialSave = AgentCommitService.applyActionPreview({
  appData: commitOnly,
  previewId: preview.id
})
assert(
  recoveredAfterPartialSave.appliedCommit.bundle.commitId === applied.appliedCommit.bundle.commitId,
  'Retry after a commit-only partial save must reuse the persisted ChapterCommitBundle.'
)
assert(
  recoveredAfterPartialSave.appData.agentActionPreviews[0].status === 'applied',
  'Retry after a commit-only partial save must finish the preview metadata.'
)
assert(
  recoveredAfterPartialSave.appData.chapterVersions.length === commitOnly.chapterVersions.length &&
    recoveredAfterPartialSave.appData.chapterVersions.every((version) => version.baseChapterVersionId !== version.id),
  'Commit recovery must not duplicate versions or create a self-referential version chain.'
)

let repeatedBlocked = false
try {
  AgentCommitService.applyActionPreview({ appData: applied.appData, previewId: preview.id })
} catch {
  repeatedBlocked = true
}
assert(repeatedBlocked, 'Applying the same preview twice should be blocked at the preview layer.')

const risky = AgentDecisionService.recordAcceptanceDecision({
  appData: normalizeAppData({
    ...fixture(),
    generationRunTraces: [{ ...fixture().generationRunTraces[0], noveltyAuditResult: { severity: 'fail', summary: 'bad', newNamedCharacters: [], newWorldRules: [], newSystemMechanics: [], newOrganizationsOrRanks: [], majorLoreReveals: [], suspiciousDeusExRules: [], untracedNames: [] } }]
  }),
  agentRunId: 'agent-run-1',
  jobId: 'job-1'
}).appData
const riskyPreview = risky.agentActionPreviews[0]
assert(riskyPreview.requiresHumanApproval, 'Risky preview should require human approval.')
let confirmRequired = false
try {
  AgentCommitService.applyActionPreview({ appData: risky, previewId: riskyPreview.id })
} catch {
  confirmRequired = true
}
assert(confirmRequired, 'Risky preview should require explicit confirmation before apply.')

const fixturePath = join(outDir, 'novel-director-data.json')
await writeFile(fixturePath, JSON.stringify(data, null, 2), 'utf-8')
const decisionCli = await runCli(['record-acceptance-decision', '--storage', fixturePath, '--agent-run-id', 'agent-run-1', '--job-id', 'job-1'])
const previewId = decisionCli.json.data.preview.id
const applyCli = await runCli(['apply-action-preview', '--storage', fixturePath, '--preview-id', previewId])
assert(applyCli.json.data.appliedCommit.kind === 'chapter_commit', 'CLI apply-action-preview should apply a chapter commit.')
const saved = JSON.parse(await readFile(fixturePath, 'utf-8'))
assert(saved.chapterCommitBundles?.length === 1, 'CLI apply-action-preview should persist ChapterCommitBundle.')
assert(saved.chapters?.[0]?.body === 'Accepted draft body.', 'CLI apply-action-preview should persist chapter text.')
assert(saved.agentActionPreviews?.[0]?.status === 'applied', 'CLI apply-action-preview should persist preview applied status.')
assert(saved.agentRuns?.[0]?.createdCommitIds?.length === 1, 'CLI apply-action-preview should persist AgentRun commit id.')
assert(!JSON.stringify(saved).includes('TEST_AGENT_P3_SECRET_SHOULD_NOT_APPEAR'), 'Agent P3 save path must sanitize API keys.')

console.log('Agent Runtime P3 validation passed.')
