#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'agent-runtime-p0-test')

function assert(condition, message) {
  if (!condition) throw new Error(message)
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

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf-8')
}

function now() {
  return '2026-05-31T00:00:00.000Z'
}

function makeFixture() {
  const timestamp = now()
  return {
    schemaVersion: 3,
    projects: [
      {
        id: 'project-1',
        name: 'Agent Fixture',
        genre: 'test',
        description: 'Compact public description.',
        targetReaders: '',
        coreAppeal: '',
        style: '',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    storyBibles: [],
    chapters: [
      {
        id: 'chapter-1',
        projectId: 'project-1',
        order: 1,
        title: 'Chapter One',
        body: 'FULL_PROSE_SHOULD_NOT_APPEAR '.repeat(80),
        summary: 'Short chapter summary.',
        newInformation: '',
        characterChanges: '',
        newForeshadowing: '',
        resolvedForeshadowing: '',
        endingHook: 'Short hook.',
        riskWarnings: '',
        includedInStageSummary: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    characters: [
      {
        id: 'char-1',
        projectId: 'project-1',
        name: 'Tester',
        role: '',
        surfaceGoal: '',
        deepDesire: '',
        coreFear: '',
        selfDeception: '',
        knownInformation: '',
        unknownInformation: '',
        protagonistRelationship: '',
        emotionalState: '',
        nextActionTendency: '',
        forbiddenWriting: '',
        lastChangedChapter: null,
        isMain: true,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    characterStateLogs: [],
    characterStateFacts: [],
    characterStateTransactions: [],
    characterStateChangeCandidates: [
      {
        id: 'state-candidate-1',
        projectId: 'project-1',
        jobId: 'job-1',
        characterId: 'char-1',
        chapterId: 'chapter-1',
        chapterOrder: 1,
        candidateType: 'create_fact',
        targetFactId: null,
        proposedFact: null,
        proposedTransaction: null,
        beforeValue: null,
        afterValue: null,
        evidence: 'state evidence',
        confidence: 0.9,
        riskLevel: 'low',
        status: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    foreshadowings: [
      {
        id: 'foreshadowing-1',
        projectId: 'project-1',
        title: 'Hidden Rule',
        firstChapterOrder: 1,
        description: '',
        status: 'unresolved',
        weight: 'high',
        treatmentMode: 'hint',
        expectedPayoff: '',
        payoffMethod: '',
        relatedCharacterIds: [],
        relatedMainPlot: '',
        notes: '',
        actualPayoffChapter: null,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    timelineEvents: [],
    stageSummaries: [],
    promptVersions: [],
    promptContextSnapshots: [],
    storyDirectionGuides: [],
    hardCanonPacks: [],
    contextNeedPlans: [],
    chapterContinuityBridges: [],
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
    chapterGenerationSteps: [
      {
        id: 'step-1',
        jobId: 'job-1',
        type: 'generate_chapter_draft',
        status: 'completed',
        inputSnapshot: '',
        output: 'STEP_OUTPUT_SHOULD_NOT_APPEAR '.repeat(30),
        errorMessage: '',
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
        title: 'Draft One',
        body: 'DRAFT_FULL_PROSE_SHOULD_NOT_APPEAR '.repeat(80),
        summary: '',
        status: 'draft',
        tokenEstimate: 1234,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    memoryUpdateCandidates: [
      {
        id: 'memory-candidate-1',
        projectId: 'project-1',
        type: 'chapter_review_update',
        sourceChapterId: 'chapter-1',
        sourceChapterOrder: 1,
        jobId: 'job-1',
        proposedPatch: {
          schemaVersion: 1,
          kind: 'chapter_review_update',
          summary: 'review',
          targetChapterId: 'chapter-1',
          targetChapterOrder: 1,
          review: {
            summary: '',
            newInformation: '',
            characterChanges: '',
            newForeshadowing: '',
            resolvedForeshadowing: '',
            endingHook: '',
            riskWarnings: ''
          },
          continuityBridgeSuggestion: null
        },
        evidence: '',
        confidence: 0.8,
        status: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp
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
    contextBudgetProfiles: [],
    qualityGateReports: [
      {
        id: 'quality-1',
        projectId: 'project-1',
        jobId: 'job-1',
        chapterId: 'chapter-1',
        draftId: 'draft-1',
        promptContextSnapshotId: null,
        overallScore: 86,
        pass: true,
        dimensions: {
          plotCoherence: 86,
          characterConsistency: 86,
          characterStateConsistency: 86,
          foreshadowingControl: 86,
          chapterContinuity: 86,
          redundancyControl: 86,
          styleMatch: 86,
          pacing: 86,
          emotionalPayoff: 86,
          originality: 86,
          promptCompliance: 86,
          contextRelevanceCompliance: 86
        },
        issues: [],
        requiredFixes: [],
        optionalSuggestions: [],
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
        selectedCharacterIds: ['char-1'],
        selectedForeshadowingIds: ['foreshadowing-1'],
        selectedTimelineEventIds: [],
        foreshadowingTreatmentModes: {},
        foreshadowingTreatmentOverrides: {},
        omittedContextItems: [],
        contextWarnings: [],
        contextTokenEstimate: 1000,
        contextSelectionTrace: null,
        forcedContextBlocks: [],
        compressionRecords: [],
        promptBlockOrder: [],
        finalPromptTokenEstimate: 2000,
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
        noveltyAuditResult: null,
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
    redundancyReports: [],
    revisionCandidates: [],
    revisionSessions: [],
    revisionRequests: [],
    revisionVersions: [],
    chapterVersions: [],
    chapterCommitBundles: [],
    revisionCommitBundles: [],
    agentRuns: [],
    settings: {
      apiProvider: 'openai',
      apiKey: 'TEST_AGENT_RUNTIME_SECRET_SHOULD_NOT_APPEAR',
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

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const typesIndex = read('src/shared/types/index.ts')
const appDataTypes = read('src/shared/types/appData.ts')
const defaults = read('src/shared/defaults/index.ts')
const normalizerIndex = read('src/shared/normalizers/index.ts')
const appDataNormalizer = read('src/shared/normalizers/appData.ts')
const packageJson = JSON.parse(read('package.json'))

assert(typesIndex.includes("export * from './agent'"), 'Agent types must be exported from shared types index.')
assert(appDataTypes.includes('agentRuns: AgentRun[]'), 'AppData must include agentRuns.')
assert(defaults.includes('agentRuns: []'), 'EMPTY_APP_DATA must default agentRuns to [].')
assert(normalizerIndex.includes("export * from './agent'"), 'Agent normalizer must be exported.')
assert(appDataNormalizer.includes('normalizeAgentRun'), 'normalizeAppData must normalize agentRuns.')
assert(packageJson.scripts.agent === 'node scripts/run-agent.mjs', 'package.json must expose npm run agent.')

const agentSources = [
  'src/agent/AgentReadableSummaryService.ts',
  'src/agent/agentReadableSummaryTypes.ts',
  'src/agent/agentProjectSummaries.ts',
  'src/agent/agentChapterSummaries.ts',
  'src/agent/agentVersionReaders.ts',
  'src/agent/agentContentReaders.ts',
  'src/agent/agentReadableText.ts',
  'src/agent/agentSummaryHelpers.ts',
  'src/agent/AgentRuntime.ts',
  'src/agent/cli.ts'
].map((file) => read(file)).join('\n')
const agentReadableSummarySource = read('src/agent/AgentReadableSummaryService.ts')
const agentProjectSummarySource = read('src/agent/agentProjectSummaries.ts')
const agentChapterSummarySource = read('src/agent/agentChapterSummaries.ts')
const agentVersionReaderSource = read('src/agent/agentVersionReaders.ts')
const agentReadableTextSource = read('src/agent/agentReadableText.ts')
const agentSummaryHelpersSource = read('src/agent/agentSummaryHelpers.ts')
const runAgentScript = read('scripts/run-agent.mjs')
assert(!/renderer\/src|src\/renderer|from ['"].*views|from ['"].*components/.test(agentSources), 'Agent runtime must not import renderer UI.')
assert(!agentSources.includes('better-sqlite3'), 'Agent runtime must not directly import better-sqlite3.')
assert(runAgentScript.includes('fileURLToPath(import.meta.url)'), 'run-agent.mjs must derive repo root from its own file path.')
assert(!runAgentScript.includes("resolve('.')"), 'run-agent.mjs must not depend on the caller cwd for repo root.')
assert(runAgentScript.includes('cwd: root'), 'run-agent.mjs must spawn the bundled CLI with repo root cwd.')
assert(!agentSources.includes('window.novelDirector'), 'Agent runtime must not depend on preload window APIs.')
assert(agentReadableSummarySource.includes("from './agentReadableText'"), 'Agent readable summary service must delegate text redaction and extraction helpers.')
assert(agentReadableSummarySource.includes("from './agentSummaryHelpers'"), 'Agent readable summary service must delegate summary selector helpers.')
assert(agentReadableSummarySource.includes("from './agentProjectSummaries'"), 'Agent readable summary facade must delegate project summaries.')
assert(agentReadableSummarySource.includes("from './agentChapterSummaries'"), 'Agent readable summary facade must delegate chapter diagnostics.')
assert(agentReadableSummarySource.includes("from './agentVersionReaders'"), 'Agent readable summary facade must delegate version reads.')
assert(agentProjectSummarySource.includes('const pendingReview = pendingReviewForProject'), 'Agent project listing must not recompute pending-review counts twice.')
assert(agentChapterSummarySource.includes('belongsToRunOrChapter'), 'Agent chapter diagnostics must scope reports to the requested project and run/chapter.')
assert(agentVersionReaderSource.includes('buildChapterVersionChain'), 'Agent version reads must reuse the formal version-chain service.')
assert(agentReadableTextSource.includes('redactSensitiveText'), 'Agent readable text helper must own sensitive text redaction.')
assert(agentReadableTextSource.includes('resolvePromptSnapshotText'), 'Agent readable text helper must own prompt snapshot resolution.')
assert(agentReadableTextSource.includes('findVersionText'), 'Agent readable text helper must own version body lookup.')
assert(agentSummaryHelpersSource.includes('pendingReviewForProject'), 'Agent summary helper must own pending review aggregation.')
assert(agentSummaryHelpersSource.includes('qualitySummary') && agentSummaryHelpersSource.includes('consistencySummary'), 'Agent summary helper must own diagnostic digests.')

const { normalizeAppData } = await bundle('src/shared/normalizers/appData.ts', 'app-data-normalizer.mjs')
assert(Array.isArray(normalizeAppData({}).agentRuns), 'normalizeAppData({}) must include agentRuns array.')

const { AgentReadableSummaryService } = await bundle('src/agent/AgentReadableSummaryService.ts', 'agent-summary-service.mjs')
const fixture = normalizeAppData(makeFixture())
const list = AgentReadableSummaryService.listProjects(fixture)
assert(list.length === 1 && list[0].chapterCount === 1, 'listProjects should summarize projects without UI.')
const digest = AgentReadableSummaryService.getProjectDigest(fixture, 'project-1')
assert(digest.nextChapterOrder === 2, 'project digest should expose next chapter target.')
const chapterState = AgentReadableSummaryService.getChapterProductionState(fixture, 'project-1', 1)
assert(chapterState.chapter?.bodyCharCount > 100, 'chapter-state should expose body length.')
assert(!JSON.stringify(chapterState).includes('FULL_PROSE_SHOULD_NOT_APPEAR'), 'chapter-state must not expose full chapter prose.')
assert(!JSON.stringify(chapterState).includes('DRAFT_FULL_PROSE_SHOULD_NOT_APPEAR'), 'chapter-state must not expose full draft prose.')
const versionChain = AgentReadableSummaryService.getChapterVersionChain(fixture, 'project-1', 1)
assert(versionChain.versions[0]?.isCurrent === true, 'version-chain should expose the current version first.')
assert(!JSON.stringify(versionChain).includes('FULL_PROSE_SHOULD_NOT_APPEAR'), 'version-chain must not expose full prose.')

const crossProjectReports = normalizeAppData(makeFixture())
crossProjectReports.qualityGateReports[0] = {
  ...crossProjectReports.qualityGateReports[0],
  projectId: 'another-project'
}
const scopedChapterState = AgentReadableSummaryService.getChapterProductionState(crossProjectReports, 'project-1', 1)
assert(scopedChapterState.diagnostics.qualityGate === null, 'chapter diagnostics must reject cross-project reports even when draft ids collide.')

const archivedFixture = normalizeAppData(makeFixture())
archivedFixture.chapters[0] = {
  ...archivedFixture.chapters[0],
  archivedAt: now(),
  updatedAt: now()
}
const archivedVersionChain = AgentReadableSummaryService.getChapterVersionChain(archivedFixture, 'project-1', 1)
assert(archivedVersionChain.chapterArchived === true, 'Agent version-chain reads must identify archived chapters.')
assert(archivedVersionChain.versions.length > 0, 'Agent version-chain reads must remain available for archived chapters.')
const archivedChapterText = AgentReadableSummaryService.getChapterText(archivedFixture, 'project-1', 1, { detail: 'full', maxChars: 5000 })
assert(archivedChapterText.metadata.archived === true, 'Agent chapter reads must identify archived prose.')
assert(archivedChapterText.text?.includes('FULL_PROSE_SHOULD_NOT_APPEAR'), 'Agent chapter reads must allow explicit full reads of archived prose.')

const fixturePath = join(outDir, 'novel-director-data.json')
await writeFile(fixturePath, JSON.stringify(makeFixture(), null, 2), 'utf-8')

const cliOutput = await new Promise((resolvePromise, reject) => {
  const chunks = []
  const errors = []
  const child = spawn(process.execPath, [join(root, 'scripts', 'run-agent.mjs'), 'chapter-state', '--storage', fixturePath, '--project-id', 'project-1', '--chapter', '1'], {
    cwd: root,
    shell: false
  })
  child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)))
  child.on('error', reject)
  child.on('close', (code) => {
    if (code !== 0) {
      reject(new Error(Buffer.concat(errors).toString('utf-8') || `agent CLI exited with ${code}`))
      return
    }
    resolvePromise(Buffer.concat(chunks).toString('utf-8'))
  })
})

assert(cliOutput.includes('"ok": true'), 'agent CLI should return ok JSON.')
assert(!cliOutput.includes('FULL_PROSE_SHOULD_NOT_APPEAR'), 'agent CLI output must not include full chapter prose.')
assert(!cliOutput.includes('DRAFT_FULL_PROSE_SHOULD_NOT_APPEAR'), 'agent CLI output must not include full draft prose.')
assert(!cliOutput.includes('STEP_OUTPUT_SHOULD_NOT_APPEAR'), 'agent CLI output must not include full step output.')
assert(!cliOutput.includes('TEST_AGENT_RUNTIME_SECRET_SHOULD_NOT_APPEAR'), 'agent CLI output must not include API keys.')
assert(!existsSync(join(outDir, 'novel-director-data.sqlite')), 'read-only JSON fixture command should not create a sibling SQLite database.')

console.log('Agent Runtime P0 validation passed.')
