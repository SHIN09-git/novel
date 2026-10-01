import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'generation-run-bundle-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

async function loadService() {
  const source = await read('src/services/GenerationRunBundleService.ts')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove
    }
  })
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, 'GenerationRunBundleService.mjs')
  await writeFile(outPath, compiled.outputText, 'utf-8')
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

function baseData() {
  return {
    schemaVersion: 1,
    projects: [],
    storyBibles: [],
    chapters: [],
    characters: [],
    characterStateLogs: [],
    characterStateFacts: [],
    characterStateTransactions: [],
    characterStateChangeCandidates: [],
    foreshadowings: [],
    timelineEvents: [],
    stageSummaries: [],
    promptVersions: [],
    promptContextSnapshots: [],
    storyDirectionGuides: [],
    contextNeedPlans: [],
    chapterContinuityBridges: [],
    chapterGenerationJobs: [],
    chapterGenerationSteps: [],
    generatedChapterDrafts: [],
    memoryUpdateCandidates: [],
    consistencyReviewReports: [],
    contextBudgetProfiles: [],
    qualityGateReports: [],
    generationRunTraces: [],
    redundancyReports: [],
    editorialVerdicts: [],
    revisionCandidates: [],
    revisionSessions: [],
    revisionRequests: [],
    revisionVersions: [],
    chapterVersions: [],
    settings: {}
  }
}

function fixtureData() {
  const data = baseData()
  const job = {
    id: 'job-1',
    projectId: 'project-1',
    targetChapterOrder: 12,
    promptContextSnapshotId: null,
    contextSource: 'auto',
    status: 'completed',
    currentStep: 'await_user_confirmation',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
    errorMessage: ''
  }
  const step = {
    id: 'step-1',
    jobId: job.id,
    type: 'generate_chapter_draft',
    status: 'completed',
    inputSnapshot: '{}',
    output: '{}',
    errorMessage: '',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
  const contextNeedPlan = {
    id: 'context-plan-1',
    projectId: job.projectId,
    targetChapterOrder: job.targetChapterOrder,
    source: 'generation_pipeline',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
  const contextBudgetProfile = {
    id: 'budget-profile-1',
    projectId: job.projectId,
    name: '第 12 章流水线预算',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
  const planningStep = {
    ...step,
    id: 'step-context-plan',
    type: 'context_need_planning',
    output: JSON.stringify(contextNeedPlan)
  }
  const budgetStep = {
    ...step,
    id: 'step-context-budget',
    type: 'context_budget_selection',
    output: JSON.stringify({ profile: contextBudgetProfile })
  }
  const draft = {
    id: 'draft-1',
    projectId: job.projectId,
    chapterId: null,
    jobId: job.id,
    title: '第十二章',
    body: '正文',
    summary: '摘要',
    status: 'draft',
    tokenEstimate: 20,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
  const consistency = {
    id: 'consistency-1',
    projectId: job.projectId,
    jobId: job.id,
    chapterId: null,
    promptContextSnapshotId: null,
    issues: [],
    suggestions: '',
    severitySummary: 'low',
    createdAt: job.createdAt
  }
  const quality = {
    id: 'quality-1',
    projectId: job.projectId,
    jobId: job.id,
    chapterId: null,
    draftId: draft.id,
    promptContextSnapshotId: null,
    overallScore: 86,
    pass: true,
    dimensions: {},
    issues: [],
    requiredFixes: [],
    optionalSuggestions: [],
    createdAt: job.createdAt
  }
  const memory = {
    id: 'memory-1',
    projectId: job.projectId,
    jobId: job.id,
    type: 'chapter_review',
    targetId: null,
    proposedPatch: { schemaVersion: 1, kind: 'legacy_raw', summary: '候选', rawText: '{}' },
    evidence: '证据',
    confidence: 0.5,
    status: 'pending',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
  const trace = {
    id: 'trace-1',
    projectId: job.projectId,
    jobId: job.id,
    targetChapterOrder: job.targetChapterOrder,
    contextSource: 'auto',
    promptContextSnapshotId: null,
    generatedDraftId: draft.id,
    consistencyReviewReportId: consistency.id,
    qualityGateReportId: quality.id,
    editorialVerdictId: 'editorial-verdict-1',
    contextNeedPlanId: contextNeedPlan.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
  const stateCandidate = {
    id: 'state-candidate-1',
    projectId: job.projectId,
    jobId: job.id,
    characterId: 'character-1',
    chapterId: null,
    chapterOrder: job.targetChapterOrder,
    candidateType: 'create_fact',
    targetFactId: null,
    proposedFact: null,
    proposedTransaction: null,
    beforeValue: null,
    afterValue: '右臂灼痛',
    evidence: '证据',
    confidence: 0.8,
    riskLevel: 'medium',
    status: 'pending',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
  const redundancy = {
    id: 'redundancy-1',
    projectId: job.projectId,
    jobId: job.id,
    chapterId: null,
    draftId: draft.id,
    repeatedPhrases: [],
    repeatedSceneDescriptions: [],
    repeatedExplanations: [],
    overusedIntensifiers: [],
    redundantParagraphs: [],
    compressionSuggestions: [],
    overallRedundancyScore: 0,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
  const editorialVerdict = {
    id: 'editorial-verdict-1',
    projectId: job.projectId,
    chapterId: null,
    jobId: job.id,
    draftId: draft.id,
    draftContentHash: 'draft-hash-1',
    draftRevision: draft.updatedAt,
    status: 'approved',
    canAccept: true,
    summary: '当前草稿可接受。',
    blockers: [],
    advisories: [],
    actions: [{ actionType: 'accept_draft', label: '接受草稿', reason: '诊断通过。', priority: 1 }],
    sourceRefs: {
      qualityGateReportId: quality.id,
      consistencyReviewReportId: consistency.id,
      redundancyReportId: redundancy.id,
      noveltyAuditTraceId: null,
      generationRunTraceId: trace.id,
      characterStateIssueIds: [],
      ignoredStaleReportIds: []
    },
    schemaVersion: 1,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
  return {
    ...data,
    chapterGenerationJobs: [job],
    chapterGenerationSteps: [planningStep, budgetStep, step],
    contextNeedPlans: [contextNeedPlan],
    contextBudgetProfiles: [contextBudgetProfile],
    generatedChapterDrafts: [draft],
    consistencyReviewReports: [consistency],
    qualityGateReports: [quality],
    memoryUpdateCandidates: [memory],
    characterStateChangeCandidates: [stateCandidate],
    redundancyReports: [redundancy],
    editorialVerdicts: [editorialVerdict],
    generationRunTraces: [trace]
  }
}

function hasForbiddenPersistenceKey(value) {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasForbiddenPersistenceKey)
  const forbidden = new Set(['body', 'draftBody', 'fullPrompt', 'apiKey', 'secret', 'token'])
  return Object.entries(value).some(([key, nested]) => forbidden.has(key) || hasForbiddenPersistenceKey(nested))
}

async function main() {
  const checks = []
  const service = await loadService()
  const runnerSource = [
    await read('src/renderer/src/views/generation/usePipelineRunner.ts'),
    await read('src/renderer/src/views/generation/usePipelineRunnerCore.ts'),
    await read('src/renderer/src/views/generation/pipelineRunnerEngine.ts'),
    await read('src/renderer/src/views/generation/pipelineSteps/contextPlanning.ts'),
    await read('src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts'),
    await read('src/renderer/src/views/generation/pipelineSteps/postDraftAnalysis.ts'),
    await read('src/renderer/src/views/generation/pipelineSteps/memoryExtraction.ts'),
    await read('src/renderer/src/views/generation/pipelineSteps/consistencyReview.ts'),
    await read('src/renderer/src/views/generation/pipelineSteps/qualityCheck.ts')
  ].join('\n')
  const typesSource = [
    await read('src/shared/types.ts'),
    await read('src/shared/types/trace.ts')
  ].join('\n')
  const normalizerSource = await read('src/shared/normalizers/runTrace.ts')
  const runTests = await read('scripts/run-tests.mjs')
  const data = fixtureData()

  checks.push(
    assert(
      typesSource.includes('export interface GenerationRunBundle') &&
        typesSource.includes('job: ChapterGenerationJob') &&
        typesSource.includes('editorialVerdicts?: EditorialVerdict[]') &&
        typesSource.includes('editorialVerdictId?: ID | null') &&
        typesSource.includes('runTrace?: GenerationRunTrace'),
      'GenerationRunBundle type is declared in shared types'
    )
  )

  const bundle = service.buildGenerationRunBundle(data, 'job-1')
  checks.push(
    assert(
      bundle.job.id === 'job-1' &&
        bundle.schemaVersion === 1 &&
        bundle.jobId === 'job-1' &&
        bundle.projectId === 'project-1' &&
        bundle.steps.length === 3 &&
        bundle.contextNeedPlans?.[0]?.id === 'context-plan-1' &&
        bundle.contextBudgetProfiles?.[0]?.id === 'budget-profile-1' &&
        bundle.generatedDrafts[0]?.id === 'draft-1' &&
        bundle.qualityGateReports[0]?.id === 'quality-1' &&
        bundle.consistencyReviewReports[0]?.id === 'consistency-1' &&
        bundle.memoryUpdateCandidates[0]?.id === 'memory-1' &&
        bundle.characterStateChangeCandidates[0]?.id === 'state-candidate-1' &&
        bundle.redundancyReports[0]?.id === 'redundancy-1' &&
        bundle.editorialVerdicts?.[0]?.id === 'editorial-verdict-1' &&
        bundle.runTrace?.id === 'trace-1',
      'a complete GenerationRunBundle groups job-related pipeline records'
    )
  )

  checks.push(
    assert(
      normalizerSource.includes('editorialVerdictId: stringValue(trace.editorialVerdictId) || null'),
      'legacy traces normalize a missing editorial verdict reference to null'
    )
  )

  checks.push(
    assert(
      !hasForbiddenPersistenceKey(bundle.editorialVerdicts),
      'editorial verdict records contain references and compact evidence, not prose copies or credentials'
    )
  )

  const unrelatedVerdict = {
    ...bundle.editorialVerdicts[0],
    id: 'editorial-verdict-other-job',
    jobId: 'job-other',
    draftId: 'draft-other',
    draftContentHash: 'draft-hash-other',
    sourceRefs: {
      ...bundle.editorialVerdicts[0].sourceRefs,
      generationRunTraceId: null,
      qualityGateReportId: null,
      consistencyReviewReportId: null,
      redundancyReportId: null
    }
  }
  const applied = service.applyGenerationRunBundleToAppData(
    { ...baseData(), editorialVerdicts: [unrelatedVerdict] },
    bundle
  )
  const appliedTwice = service.applyGenerationRunBundleToAppData(applied, bundle)
  checks.push(
    assert(
      appliedTwice.chapterGenerationJobs.length === 1 &&
        appliedTwice.chapterGenerationSteps.length === 3 &&
        appliedTwice.contextNeedPlans.length === 1 &&
        appliedTwice.contextBudgetProfiles.length === 1 &&
        appliedTwice.generatedChapterDrafts.length === 1 &&
        appliedTwice.qualityGateReports.length === 1 &&
        appliedTwice.consistencyReviewReports.length === 1 &&
        appliedTwice.memoryUpdateCandidates.length === 1 &&
        appliedTwice.characterStateChangeCandidates.length === 1 &&
        appliedTwice.redundancyReports.length === 1 &&
        appliedTwice.editorialVerdicts.length === 2 &&
        appliedTwice.editorialVerdicts.filter((item) => item.id === 'editorial-verdict-1').length === 1 &&
        appliedTwice.editorialVerdicts.some((item) => item.id === 'editorial-verdict-other-job') &&
        appliedTwice.generationRunTraces.length === 1,
      'applying the same bundle repeatedly is idempotent and does not duplicate records'
    )
  )

  checks.push(
    assert(
      applied.generationRunTraces[0]?.generatedDraftId === applied.generatedChapterDrafts[0]?.id &&
        applied.generationRunTraces[0]?.qualityGateReportId === applied.qualityGateReports[0]?.id &&
        applied.generationRunTraces[0]?.consistencyReviewReportId === applied.consistencyReviewReports[0]?.id &&
        applied.generationRunTraces[0]?.editorialVerdictId === applied.editorialVerdicts.find((item) => item.jobId === 'job-1')?.id &&
        applied.generatedChapterDrafts[0]?.jobId === applied.chapterGenerationJobs[0]?.id,
      'draft, reports, editorial verdict and run trace remain linkable through jobId and trace ids'
    )
  )

  const { editorialVerdicts: _legacyVerdicts, ...legacyBundle } = bundle
  const legacyApplied = service.applyGenerationRunBundleToAppData(baseData(), {
    ...legacyBundle,
    runTrace: legacyBundle.runTrace ? { ...legacyBundle.runTrace, editorialVerdictId: undefined } : undefined
  })
  checks.push(
    assert(
      legacyApplied.chapterGenerationJobs.length === 1 && legacyApplied.editorialVerdicts.length === 0,
      'bundles written before editorial verdict persistence remain compatible'
    )
  )

  let missingJobIdFailed = false
  try {
    service.validateGenerationRunBundle({
      ...bundle,
      generatedDrafts: [{ ...bundle.generatedDrafts[0], jobId: '' }]
    })
  } catch (error) {
    missingJobIdFailed = String(error).includes('missing jobId')
  }
  checks.push(assert(missingJobIdFailed, 'bundle validation rejects records that are missing jobId'))

  let missingChapterIdFailed = false
  try {
    const { chapterId, ...qualityWithoutChapterId } = bundle.qualityGateReports[0]
    service.validateGenerationRunBundle({
      ...bundle,
      qualityGateReports: [qualityWithoutChapterId]
    })
  } catch (error) {
    missingChapterIdFailed = String(error).includes('missing chapterId')
  }
  checks.push(assert(missingChapterIdFailed, 'bundle validation rejects reports that omit the chapterId field'))

  let missingProjectIdFailed = false
  try {
    service.validateGenerationRunBundle({
      ...bundle,
      redundancyReports: [{ ...bundle.redundancyReports[0], projectId: '' }]
    })
  } catch (error) {
    missingProjectIdFailed = String(error).includes('missing projectId')
  }
  checks.push(assert(missingProjectIdFailed, 'bundle validation rejects related records that are missing projectId'))

  let mismatchedVerdictJobFailed = false
  try {
    service.validateGenerationRunBundle({
      ...bundle,
      editorialVerdicts: [{ ...bundle.editorialVerdicts[0], jobId: 'job-other' }]
    })
  } catch (error) {
    mismatchedVerdictJobFailed = String(error).includes('editorialVerdicts') && String(error).includes('job-other')
  }
  checks.push(assert(mismatchedVerdictJobFailed, 'bundle validation rejects an editorial verdict from another job'))

  let verdictCopyFailed = false
  try {
    service.validateGenerationRunBundle({
      ...bundle,
      editorialVerdicts: [{ ...bundle.editorialVerdicts[0], body: 'forbidden draft copy', apiKey: 'forbidden-secret' }]
    })
  } catch (error) {
    verdictCopyFailed = String(error).includes('forbidden persistence field')
  }
  checks.push(assert(verdictCopyFailed, 'bundle validation rejects prose copies and credentials inside editorial verdicts'))

  checks.push(
    assert(
      runnerSource.includes('buildGenerationRunBundle') &&
        runnerSource.includes('applyGenerationRunBundleToAppData') &&
        runnerSource.includes('saveGenerationRunBundle') &&
        (runnerSource.includes('persistWorking(working, jobId)') || runnerSource.includes('persistWorking(state.working, jobId)')),
      'usePipelineRunner persists pipeline records through GenerationRunBundle utilities'
    )
  )

  checks.push(
    assert(
      runTests.includes('validate-generation-run-bundle.mjs'),
      'npm test runs validate-generation-run-bundle.mjs'
    )
  )

  const failed = checks.filter((check) => !check.ok)
  console.log(JSON.stringify({ ok: failed.length === 0, totalChecks: checks.length, failed }, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
