import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
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
  return {
    ...data,
    chapterGenerationJobs: [job],
    chapterGenerationSteps: [step],
    generatedChapterDrafts: [draft],
    consistencyReviewReports: [consistency],
    qualityGateReports: [quality],
    memoryUpdateCandidates: [memory],
    characterStateChangeCandidates: [stateCandidate],
    redundancyReports: [redundancy],
    generationRunTraces: [trace]
  }
}

async function main() {
  const checks = []
  const service = await loadService()
  const runnerSource = await read('src/renderer/src/views/generation/usePipelineRunner.ts')
  const typesSource = await read('src/shared/types.ts')
  const packageJson = JSON.parse(await read('package.json'))
  const data = fixtureData()

  checks.push(
    assert(
      typesSource.includes('export interface GenerationRunBundle') &&
        typesSource.includes('job: ChapterGenerationJob') &&
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
        bundle.steps.length === 1 &&
        bundle.generatedDrafts[0]?.id === 'draft-1' &&
        bundle.qualityGateReports[0]?.id === 'quality-1' &&
        bundle.consistencyReviewReports[0]?.id === 'consistency-1' &&
        bundle.memoryUpdateCandidates[0]?.id === 'memory-1' &&
        bundle.characterStateChangeCandidates[0]?.id === 'state-candidate-1' &&
        bundle.redundancyReports[0]?.id === 'redundancy-1' &&
        bundle.runTrace?.id === 'trace-1',
      'a complete GenerationRunBundle groups job-related pipeline records'
    )
  )

  const applied = service.applyGenerationRunBundleToAppData(baseData(), bundle)
  const appliedTwice = service.applyGenerationRunBundleToAppData(applied, bundle)
  checks.push(
    assert(
      appliedTwice.chapterGenerationJobs.length === 1 &&
        appliedTwice.chapterGenerationSteps.length === 1 &&
        appliedTwice.generatedChapterDrafts.length === 1 &&
        appliedTwice.qualityGateReports.length === 1 &&
        appliedTwice.consistencyReviewReports.length === 1 &&
        appliedTwice.memoryUpdateCandidates.length === 1 &&
        appliedTwice.characterStateChangeCandidates.length === 1 &&
        appliedTwice.redundancyReports.length === 1 &&
        appliedTwice.generationRunTraces.length === 1,
      'applying the same bundle repeatedly is idempotent and does not duplicate records'
    )
  )

  checks.push(
    assert(
      applied.generationRunTraces[0]?.generatedDraftId === applied.generatedChapterDrafts[0]?.id &&
        applied.generationRunTraces[0]?.qualityGateReportId === applied.qualityGateReports[0]?.id &&
        applied.generationRunTraces[0]?.consistencyReviewReportId === applied.consistencyReviewReports[0]?.id &&
        applied.generatedChapterDrafts[0]?.jobId === applied.chapterGenerationJobs[0]?.id,
      'draft, quality report, consistency report and run trace remain linkable through jobId and trace ids'
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

  checks.push(
    assert(
      runnerSource.includes('buildGenerationRunBundle') &&
        runnerSource.includes('applyGenerationRunBundleToAppData') &&
        runnerSource.includes('saveGenerationRunBundle') &&
        runnerSource.includes('persistWorking(working, jobId)'),
      'usePipelineRunner persists pipeline records through GenerationRunBundle utilities'
    )
  )

  checks.push(
    assert(
      packageJson.scripts.test.includes('validate-generation-run-bundle.mjs'),
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
