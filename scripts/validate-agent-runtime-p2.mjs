#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'agent-runtime-p2-test')

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

function baseFixture(options = {}) {
  const timestamp = now()
  const noveltySeverity = options.noveltySeverity ?? 'pass'
  const qualityPass = options.qualityPass ?? true
  const qualityScore = options.qualityScore ?? (qualityPass ? 90 : 42)
  const requiredFixes = options.requiredFixes ?? (qualityPass ? [] : ['Revise required.'])
  const consistencyHigh = options.consistencyHigh ?? false
  return {
    schemaVersion: 3,
    projects: [
      {
        id: 'project-1',
        name: 'Agent P2 Fixture',
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
        body: 'Current chapter body.',
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
        type: 'await_user_confirmation',
        status: 'completed',
        inputSnapshot: '',
        output: '',
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
        body: 'Draft body.',
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
        overallScore: qualityScore,
        pass: qualityPass,
        dimensions: {
          plotCoherence: qualityScore,
          characterConsistency: qualityScore,
          characterStateConsistency: qualityScore,
          foreshadowingControl: qualityScore,
          chapterContinuity: qualityScore,
          redundancyControl: qualityScore,
          styleMatch: qualityScore,
          pacing: qualityScore,
          emotionalPayoff: qualityScore,
          originality: qualityScore,
          promptCompliance: qualityScore,
          contextRelevanceCompliance: qualityScore
        },
        issues: qualityPass ? [] : [{ severity: 'high', type: 'quality', description: 'bad', evidence: 'bad', suggestedFix: 'fix' }],
        requiredFixes,
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
        issues: consistencyHigh
          ? [
              {
                id: 'issue-1',
                type: 'continuity_gap',
                severity: 'high',
                title: 'High issue',
                description: 'High consistency issue.',
                evidence: 'evidence',
                relatedChapterIds: [],
                relatedCharacterIds: [],
                relatedForeshadowingIds: [],
                suggestedFix: 'fix',
                revisionInstruction: 'fix',
                status: 'open'
              }
            ]
          : [],
        suggestions: '',
        severitySummary: consistencyHigh ? 'high' : 'low',
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
        noveltyAuditResult: noveltySeverity === 'pass'
          ? { severity: 'pass', summary: 'ok', newNamedCharacters: [], newWorldRules: [], newSystemMechanics: [], newOrganizationsOrRanks: [], majorLoreReveals: [], suspiciousDeusExRules: [], untracedNames: [] }
          : { severity: noveltySeverity, summary: '未授权救命规则。', newNamedCharacters: [], newWorldRules: [], newSystemMechanics: [], newOrganizationsOrRanks: [], majorLoreReveals: [], suspiciousDeusExRules: [], untracedNames: [] },
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
        overallStatus: qualityPass && !consistencyHigh && noveltySeverity === 'pass' ? 'good' : 'risky',
        oneLineDiagnosis: qualityPass && !consistencyHigh && noveltySeverity === 'pass' ? 'No major risk.' : 'Needs attention.',
        likelyProblemSources: [],
        nextActions: qualityPass && !consistencyHigh && noveltySeverity === 'pass' ? [] : [{ label: 'Revise draft', actionType: 'revise_chapter', reason: 'risk' }],
        sourceRefs: { generationRunTraceId: 'trace-1' }
      }
    ],
    redundancyReports: [],
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
      apiKey: 'TEST_AGENT_P2_SECRET_SHOULD_NOT_APPEAR',
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

const agentTypes = read('src/shared/types/agent.ts')
const appDataTypes = read('src/shared/types/appData.ts')
const defaults = read('src/shared/defaults/index.ts')
const normalizer = read('src/shared/normalizers/appData.ts')
const cli = read('src/agent/cli.ts')
const runTests = read('scripts/run-tests.mjs')
const plan = read('docs/AGENT_RUNTIME_PLAN.md')

assert(agentTypes.includes('AgentActionPreview'), 'AgentActionPreview type must exist.')
assert(appDataTypes.includes('agentActionPreviews: AgentActionPreview[]'), 'AppData must include agentActionPreviews.')
assert(defaults.includes('agentActionPreviews: []'), 'EMPTY_APP_DATA must default agentActionPreviews to [].')
assert(normalizer.includes('normalizeAgentActionPreview'), 'normalizeAppData must normalize agentActionPreviews.')
assert(cli.includes("case 'continue'"), 'Agent CLI must expose continue command.')
assert(cli.includes('record-acceptance-decision'), 'Agent CLI must expose record-acceptance-decision command.')
assert(read('src/agent/AgentDecisionService.ts').includes('noveltyAuditResult'), 'AgentDecisionService must inspect novelty risk.')
assert(!/batchDraft|batch-draft|batchChapterDraft/i.test(plan + cli), 'P2 must not introduce one-shot multi-chapter drafting.')
assert(runTests.includes('validate-agent-runtime-p2.mjs'), 'npm test must include P2 agent validation.')

const { normalizeAppData } = await bundle('src/shared/normalizers/appData.ts', 'normalizer.mjs')
const { draftContentHash } = await bundle('src/services/DraftDiagnosticBindingService.ts', 'draft-binding.mjs')
const { AgentRunService } = await bundle('src/agent/AgentRunService.ts', 'agent-run-service.mjs')
const { AgentDecisionService } = await bundle('src/agent/AgentDecisionService.ts', 'agent-decision-service.mjs')
const { AuthorDecisionPolicyService } = await bundle('src/services/AuthorDecisionPolicyService.ts', 'author-decision-policy.mjs')
const { QualityGateService } = await bundle('src/services/QualityGateService.ts', 'quality-gate-service.mjs')

function currentDiagnosticFixture(options = {}) {
  const normalized = normalizeAppData(baseFixture(options))
  const hash = draftContentHash(normalized.generatedChapterDrafts[0].body)
  return {
    ...normalized,
    qualityGateReports: normalized.qualityGateReports.map((report) => ({ ...report, draftContentHash: hash })),
    consistencyReviewReports: normalized.consistencyReviewReports.map((report) => ({
      ...report,
      draftId: 'draft-1',
      draftContentHash: hash
    })),
    generationRunTraces: normalized.generationRunTraces.map((trace) => ({
      ...trace,
      noveltyAuditResult: trace.noveltyAuditResult
        ? { ...trace.noveltyAuditResult, sourceDraftId: 'draft-1', sourceContentHash: hash, auditedAt: now() }
        : null
    }))
  }
}

const fixture = currentDiagnosticFixture()
const prepared = AgentRunService.prepareSequentialChapterRun({
  appData: fixture,
  projectId: 'project-1',
  targetChapterOrder: 2,
  chapterCount: 5,
  goal: 'Produce five chapters through standard per-chapter flow.'
})
assert(prepared.agentRun.mode === 'multi_chapter', 'Sequential chapter run should use multi_chapter mode.')
assert(prepared.agentRun.targetChapterOrders.join(',') === '2,3,4,5,6', 'Sequential run should record all target chapter orders.')
assert(prepared.agentRun.createdJobIds.length === 1, 'Sequential run must only create the current chapter job.')
assert(prepared.job.targetChapterOrder === 2, 'Sequential run should start with the first target chapter.')
assert(prepared.warning.includes('one complete chapter workflow'), 'Sequential run warning should explain per-chapter workflow.')

const goodRecommendation = AgentDecisionService.buildAcceptanceRecommendation(fixture, 'job-1')
assert(goodRecommendation.recommendation === 'accept', 'Passing diagnostics should recommend accept.')
assert(goodRecommendation.requiresHumanApproval === false, 'Low risk accept recommendation may proceed without mandatory human approval.')
const withDecision = AgentDecisionService.recordAcceptanceDecision({ appData: fixture, agentRunId: 'agent-run-1', jobId: 'job-1' })
assert(withDecision.appData.agentActionPreviews.length === 1, 'recordAcceptanceDecision should create an action preview.')
assert(withDecision.preview.actionType === 'chapter_commit', 'Accept recommendation should preview a chapter commit.')
assert(withDecision.appData.agentRuns[0].decisions.length === 1, 'recordAcceptanceDecision should append AgentDecision.')

const riskyFixture = currentDiagnosticFixture({ noveltySeverity: 'fail' })
const riskyRecommendation = AgentDecisionService.buildAcceptanceRecommendation(riskyFixture, 'job-1')
assert(riskyRecommendation.recommendation !== 'accept', 'Novelty fail must not recommend direct accept.')
assert(riskyRecommendation.riskLevel === 'high', 'Novelty fail should be high risk.')
const riskyDecision = AgentDecisionService.recordAcceptanceDecision({ appData: riskyFixture, agentRunId: 'agent-run-1', jobId: 'job-1' })
assert(riskyDecision.preview.requiresHumanApproval === true, 'Risky previews must require human approval.')
assert(riskyDecision.appData.agentRuns[0].pendingHumanReviewItemIds.includes(riskyDecision.preview.id), 'Risky preview should be tracked as pending human review.')

const reviewThresholdFixture = currentDiagnosticFixture({ qualityPass: true, qualityScore: 70 })
const reviewThresholdRecommendation = AgentDecisionService.buildAcceptanceRecommendation(reviewThresholdFixture, 'job-1')
assert(reviewThresholdRecommendation.recommendation !== 'accept', 'A 50-79 quality score must not bypass the desktop human-review threshold.')
assert(reviewThresholdRecommendation.requiresHumanApproval === true, 'A passing score below 80 must still require author approval for Agent commits.')

const legacyRequiredFix = 'Remove the prematurely revealed clue before acceptance.'
const legacyRequiredFixFixture = currentDiagnosticFixture({ qualityPass: true, qualityScore: 90, requiredFixes: [legacyRequiredFix] })
const legacyRequiredFixReport = legacyRequiredFixFixture.qualityGateReports[0]
assert(
  AuthorDecisionPolicyService.assessQualityGate(legacyRequiredFixReport).status === 'blocked',
  'A legacy report with pass=true and required fixes must be blocked by current author-decision policy.'
)
const legacyRequiredFixRecommendation = AgentDecisionService.buildAcceptanceRecommendation(legacyRequiredFixFixture, 'job-1')
assert(legacyRequiredFixRecommendation.recommendation === 'revise', 'Legacy required fixes must force an Agent revision recommendation.')
assert(legacyRequiredFixRecommendation.riskLevel === 'high', 'Legacy required fixes must be treated as high risk.')
assert(legacyRequiredFixRecommendation.nextActions.includes(legacyRequiredFix), 'Agent recommendation must surface the required fix text.')

const historicalContractFixture = currentDiagnosticFixture()
historicalContractFixture.chapterGenerationJobs[0].chapterTaskSnapshot = {
  goal: 'Write an ordinary opening.',
  conflict: '',
  suspenseToKeep: '',
  allowedPayoffs: '',
  forbiddenPayoffs: '',
  endingHook: '',
  readerEmotion: '',
  targetWordCount: '1000-1200',
  styleRequirement: '陈航第一人称限知。'
}
const historicalContractRecommendation = AgentDecisionService.buildAcceptanceRecommendation(historicalContractFixture, 'job-1')
assert(historicalContractRecommendation.recommendation === 'revise', 'A historical passing report must not bypass the current ChapterTask contract.')
assert(historicalContractRecommendation.riskLevel === 'high', 'A current high-confidence ChapterTask violation must be high risk.')
assert(historicalContractRecommendation.reasons.some((reason) => reason.includes('ChapterTask contract failed')), 'Agent recommendation must disclose the live ChapterTask contract failure.')

const strongDimensions = Object.fromEntries(
  Object.keys(legacyRequiredFixReport.dimensions).map((key) => [key, 92])
)
const rawPassWithRequiredFix = await QualityGateService.evaluateChapterDraft({
  projectId: 'project-1',
  jobId: 'job-quality-required-fix',
  chapterId: null,
  draftId: null,
  chapterDraft: { title: 'Ordinary Day', body: '他沿着街道处理日常琐事，和邻居聊了几句。'.repeat(300) },
  context: '',
  chapterPlan: null,
  noveltyAuditResult: {
    severity: 'pass',
    summary: 'pass',
    newNamedCharacters: [],
    newWorldRules: [],
    newSystemMechanics: [],
    newOrganizationsOrRanks: [],
    majorLoreReveals: [],
    suspiciousDeusExRules: [],
    untracedNames: []
  },
  aiService: {
    async generateQualityGateReport() {
      return {
        ok: true,
        usedAI: true,
        data: {
          overallScore: 92,
          pass: true,
          dimensions: strongDimensions,
          issues: [],
          requiredFixes: [legacyRequiredFix],
          optionalSuggestions: []
        }
      }
    }
  }
})
assert(rawPassWithRequiredFix.overallScore >= 50, 'Required-fix raw-pass regression needs an otherwise passing score.')
assert(!rawPassWithRequiredFix.issues.some((issue) => issue.severity === 'high'), 'Required-fix raw-pass regression must not rely on a high issue.')
assert(rawPassWithRequiredFix.pass === false, 'A newly generated report with required fixes must not raw-pass.')

const fixturePath = join(outDir, 'novel-director-data.json')
await writeFile(fixturePath, JSON.stringify(fixture, null, 2), 'utf-8')
const continueCli = await runCli(['continue', '--storage', fixturePath, '--project-id', 'project-1', '--start-chapter', '2', '--chapters', '5'])
assert(continueCli.json.data.agentRun.targetChapterOrders.length === 5, 'CLI continue should record all requested target chapters.')
assert(continueCli.json.data.createdJobCount === 1, 'CLI continue should create only one current chapter job.')
let saved = JSON.parse(await readFile(fixturePath, 'utf-8'))
assert(saved.agentRuns?.length === 2, 'CLI continue should persist a new AgentRun.')
const newRun = saved.agentRuns.find((run) => run.id === continueCli.json.data.agentRun.id)
assert(newRun?.targetChapterOrders.join(',') === '2,3,4,5,6', 'Persisted AgentRun should keep the target queue.')

const decisionCli = await runCli(['record-acceptance-decision', '--storage', fixturePath, '--agent-run-id', 'agent-run-1', '--job-id', 'job-1'])
assert(decisionCli.json.data.preview.actionType === 'chapter_commit', 'CLI record-acceptance-decision should return preview.')
saved = JSON.parse(await readFile(fixturePath, 'utf-8'))
assert(saved.agentActionPreviews?.length === 1, 'CLI record-acceptance-decision should persist action preview.')
assert(!JSON.stringify(saved).includes('TEST_AGENT_P2_SECRET_SHOULD_NOT_APPEAR'), 'Agent P2 save path must sanitize API keys.')
const summaryCli = await runCli(['agent-run-summary', '--storage', fixturePath, '--agent-run-id', 'agent-run-1'])
assert(summaryCli.json.data.pendingPreviewCount === 1, 'agent-run-summary should expose pending preview count.')
const previewsCli = await runCli(['action-previews', '--storage', fixturePath, '--agent-run-id', 'agent-run-1'])
assert(previewsCli.json.data.length === 1, 'action-previews should list previews for an AgentRun.')

console.log('Agent Runtime P2 validation passed.')
