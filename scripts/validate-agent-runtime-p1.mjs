#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'agent-runtime-p1-test')

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

function makeFixture() {
  const timestamp = now()
  return {
    schemaVersion: 3,
    projects: [
      {
        id: 'project-1',
        name: 'Agent P1 Fixture',
        genre: 'test',
        description: 'Agent fixture project.',
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
        title: 'Current Chapter',
        body: 'CHAPTER_FULL_TEXT_MARKER '.repeat(60),
        summary: 'Readable summary.',
        newInformation: '',
        characterChanges: '',
        newForeshadowing: '',
        resolvedForeshadowing: '',
        endingHook: 'Hook.',
        riskWarnings: '',
        includedInStageSummary: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    chapterVersions: [
      {
        id: 'version-1',
        projectId: 'project-1',
        chapterId: 'chapter-1',
        source: 'generated_draft',
        title: 'Previous Version',
        body: 'PREVIOUS_VERSION_BODY_MARKER '.repeat(40),
        note: '',
        createdAt: timestamp,
        linkedRevisionCommitId: null,
        linkedGenerationRunTraceId: 'trace-1',
        linkedChapterCommitId: null,
        baseChapterVersionId: null
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
    chapterGenerationSteps: [
      {
        id: 'step-prompt',
        jobId: 'job-1',
        type: 'rebuild_context_with_plan',
        status: 'completed',
        inputSnapshot: '',
        output: JSON.stringify({ finalPrompt: 'PROMPT_FULL_TEXT_MARKER '.repeat(80), selectedCharacterIds: [] }),
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
        body: 'DRAFT_FULL_TEXT_MARKER '.repeat(60),
        summary: '',
        status: 'draft',
        tokenEstimate: 1200,
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
        overallScore: 90,
        pass: true,
        dimensions: {
          plotCoherence: 90,
          characterConsistency: 90,
          characterStateConsistency: 90,
          foreshadowingControl: 90,
          chapterContinuity: 90,
          redundancyControl: 90,
          styleMatch: 90,
          pacing: 90,
          emotionalPayoff: 90,
          originality: 90,
          promptCompliance: 90,
          contextRelevanceCompliance: 90
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
        severitySummary: 'none',
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
          summary: 'candidate',
          sourceChapterOrder: 1,
          warnings: [],
          targetChapterId: 'chapter-1',
          targetChapterOrder: 1,
          review: {
            summary: 'candidate',
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
    settings: {
      apiProvider: 'openai',
      apiKey: 'TEST_AGENT_P1_SECRET_SHOULD_NOT_APPEAR',
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

const agentSources = [
  'src/agent/AgentReadableSummaryService.ts',
  'src/agent/agentProjectSummaries.ts',
  'src/agent/agentChapterSummaries.ts',
  'src/agent/agentVersionReaders.ts',
  'src/agent/agentContentReaders.ts',
  'src/agent/AgentRuntime.ts',
  'src/agent/AgentRunService.ts',
  'src/agent/cli.ts'
].map((file) => read(file)).join('\n')
assert(!/renderer\/src|src\/renderer|from ['"].*views|from ['"].*components/.test(agentSources), 'Agent P1 runtime must not import renderer UI.')
assert(!agentSources.includes('window.novelDirector'), 'Agent P1 runtime must not depend on preload window APIs.')
assert(read('src/agent/cli.ts').includes('run-chapter'), 'Agent CLI must expose run-chapter.')
assert(read('src/agent/cli.ts').includes('generation-prompt'), 'Agent CLI must expose generation-prompt.')
assert(read('scripts/run-tests.mjs').includes('validate-agent-runtime-p1.mjs'), 'npm test must include P1 agent validation.')

const { normalizeAppData } = await bundle('src/shared/normalizers/appData.ts', 'normalizer.mjs')
const { draftContentHash } = await bundle('src/services/DraftDiagnosticBindingService.ts', 'draft-binding.mjs')
const { AgentRunService } = await bundle('src/agent/AgentRunService.ts', 'agent-run-service.mjs')
const { AgentReadableSummaryService } = await bundle('src/agent/AgentReadableSummaryService.ts', 'agent-readable.mjs')

const normalizedFixture = normalizeAppData(makeFixture())
const currentDraftHash = draftContentHash(normalizedFixture.generatedChapterDrafts[0].body)
const fixture = {
  ...normalizedFixture,
  qualityGateReports: normalizedFixture.qualityGateReports.map((report) => ({
    ...report,
    draftContentHash: currentDraftHash
  })),
  consistencyReviewReports: normalizedFixture.consistencyReviewReports.map((report) => ({
    ...report,
    draftId: 'draft-1',
    draftContentHash: currentDraftHash
  }))
}
const prepared = AgentRunService.prepareSingleChapterRun({
  appData: fixture,
  projectId: 'project-1',
  targetChapterOrder: 2,
  goal: 'Agent should create chapter 2.'
})
assert(prepared.agentRun.createdJobIds.length === 1, 'prepareSingleChapterRun should create a job reference.')
assert(prepared.steps.length >= 10, 'prepareSingleChapterRun should create pipeline steps.')
assert(prepared.appData.agentRuns.length === 1, 'prepareSingleChapterRun should write agentRuns.')
assert(prepared.appData.chapterGenerationJobs.some((job) => job.id === prepared.job.id), 'prepareSingleChapterRun should write the job.')

const chapterDefault = AgentReadableSummaryService.getChapterText(fixture, 'project-1', 1)
assert(!chapterDefault.text, 'chapter-text default must not include full prose in text field.')
const chapterFull = AgentReadableSummaryService.getChapterText(fixture, 'project-1', 1, { detail: 'full' })
assert(JSON.stringify(chapterFull).includes('CHAPTER_FULL_TEXT_MARKER'), 'chapter-text full mode should expose requested prose.')
assert(chapterFull.text?.length === chapterFull.charCount, 'chapter-text full mode without maxChars must return the complete safe prose.')
const promptDefault = AgentReadableSummaryService.getGenerationPrompt(fixture, 'job-1')
assert(!promptDefault.text, 'generation-prompt default must not include full prompt in text field.')
const promptFull = AgentReadableSummaryService.getGenerationPrompt(fixture, 'job-1', { detail: 'full', includePrompt: true })
assert(JSON.stringify(promptFull).includes('PROMPT_FULL_TEXT_MARKER'), 'generation-prompt full mode should expose requested prompt.')
assert(promptFull.text?.length === promptFull.charCount, 'generation-prompt full mode without maxChars must return the complete safe prompt.')
const diff = AgentReadableSummaryService.getVersionDiff(fixture, 'project-1', 1, 'version-1', 'current:chapter-1')
assert(diff.deltaChars !== 0, 'version-diff should compare historical and current text.')
const recommendation = AgentReadableSummaryService.getAcceptanceRecommendation(fixture, 'job-1')
assert(recommendation.recommendation === 'accept', 'acceptance recommendation should accept a passing draft.')

const fixturePath = join(outDir, 'novel-director-data.json')
await writeFile(fixturePath, JSON.stringify(makeFixture(), null, 2), 'utf-8')

const chapterDefaultCli = await runCli(['chapter-text', '--storage', fixturePath, '--project-id', 'project-1', '--chapter', '1'])
assert(!chapterDefaultCli.json.data.text, 'CLI chapter-text default must not include full prose in text field.')
const chapterFullCli = await runCli(['chapter-text', '--storage', fixturePath, '--project-id', 'project-1', '--chapter', '1', '--detail', 'full'])
assert(chapterFullCli.stdout.includes('CHAPTER_FULL_TEXT_MARKER'), 'CLI chapter-text full mode should expose prose.')
const promptFullCli = await runCli(['generation-prompt', '--storage', fixturePath, '--job-id', 'job-1', '--detail', 'full', '--include-prompt'])
assert(promptFullCli.stdout.includes('PROMPT_FULL_TEXT_MARKER'), 'CLI generation-prompt full mode should expose prompt.')
const runChapterCli = await runCli(['run-chapter', '--storage', fixturePath, '--project-id', 'project-1', '--chapter', '2', '--goal', 'Create chapter 2.'])
assert(runChapterCli.json.data.agentRun?.id, 'CLI run-chapter should return an AgentRun.')
assert(runChapterCli.json.data.job?.id, 'CLI run-chapter should return a job.')
const saved = JSON.parse(await readFile(fixturePath, 'utf-8'))
assert(saved.agentRuns?.length === 1, 'CLI run-chapter should persist agentRuns to JSON fallback.')
assert(saved.chapterGenerationJobs?.some((job) => job.id === runChapterCli.json.data.job.id), 'CLI run-chapter should persist job.')
assert(!JSON.stringify(saved).includes('TEST_AGENT_P1_SECRET_SHOULD_NOT_APPEAR'), 'Agent save path must sanitize API keys.')
assert(!existsSync(join(outDir, 'novel-director-data.sqlite')), 'Agent JSON command should not create sibling SQLite.')

console.log('Agent Runtime P1 validation passed.')
