#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createLongNovelFixture, LONG_NOVEL_PROJECT_ID } from './fixtures/long-novel-performance.mjs'
import { repoRoot } from './utils/repo-root.mjs'

const tempRoot = join(repoRoot, 'tmp')
await mkdir(tempRoot, { recursive: true })
const outDir = await mkdtemp(join(tempRoot, 'accepted-chapter-cost-'))
let checks = 0

function test(label, run) {
  run()
  checks++
  console.log(`PASS ${label}`)
}

function fixture() {
  const data = createLongNovelFixture(2)
  for (const trace of data.generationRunTraces) {
    for (const call of trace.aiCalls) call.stepId = `${trace.jobId}-${call.stepType}`
  }
  return Object.assign(data, {
    revisionSessions: [],
    revisionRequests: [],
    revisionVersions: [],
    revisionCandidates: [],
    revisionCommitBundles: []
  })
}

function warningCodes(result) {
  return new Set(result.warnings.map((warning) => warning.code))
}

try {
  const outfile = join(outDir, 'accepted-chapter-cost.mjs')
  await build({
    stdin: {
      contents: `
        export { measureAcceptedChapterCost } from './src/services/AcceptedChapterCostService';
        export { deriveConsistencyReviewFromQualityGate } from './src/services/CombinedSemanticReviewService';
      `,
      resolveDir: repoRoot,
      loader: 'ts'
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  const { measureAcceptedChapterCost, deriveConsistencyReviewFromQualityGate } = await import(pathToFileURL(outfile).href)

  test('deduplicates stored and commit trace snapshots by callId', () => {
    const result = measureAcceptedChapterCost({ data: fixture(), projectId: LONG_NOVEL_PROJECT_ID, chapterId: 'perf-chapter-1' })
    assert.equal(result.status, 'complete')
    assert.equal(result.callCount, 4)
    assert.equal(result.observedTelemetryRecordCount, 8)
    assert.equal(result.promptTokens.known, 26_000)
    assert.equal(result.completionTokens.known, 4_800)
    assert.equal(result.totalTokens.known, 30_800)
    assert.deepEqual(result.includedJobIds, ['perf-job-1'])
    assert.deepEqual(result.warnings, [])
  })

  test('uses an immutable legacy chapter commit when chapterVersion is absent', () => {
    const data = fixture()
    data.chapterVersions = []
    delete data.chapterCommitBundles[0].chapterVersion
    const result = measureAcceptedChapterCost({ data, projectId: LONG_NOVEL_PROJECT_ID, chapterId: 'perf-chapter-1' })
    assert.equal(result.status, 'complete')
    assert.equal(result.currentVersionId, 'chapter-commit:perf-commit-1')
    assert.equal(result.callCount, 4)
  })

  test('uses an optional caller-supplied fixed rate without inventing prices', () => {
    const unpriced = measureAcceptedChapterCost({ data: fixture(), projectId: LONG_NOVEL_PROJECT_ID, chapterId: 'perf-chapter-1' })
    assert.equal(unpriced.monetaryCost, null)
    const priced = measureAcceptedChapterCost({
      data: fixture(), projectId: LONG_NOVEL_PROJECT_ID, chapterId: 'perf-chapter-1',
      fixedRate: { currency: 'TEST', inputPerMillionTokens: 1, outputPerMillionTokens: 2 }
    })
    assert.deepEqual(priced.monetaryCost, { currency: 'TEST', status: 'complete', knownAmount: 0.0356, unknownCallCount: 0 })
  })

  test('deduplicates one transport call reused by the unified review report across workflow steps', () => {
    for (const traceStep of ['generate_chapter_review', 'consistency_review']) {
      const data = fixture()
      const traceCall = data.generationRunTraces[0].aiCalls.find((call) => call.stepType === traceStep)
      const sourceReport = { ...data.qualityGateReports[0], aiTelemetry: {
        callId: traceCall.callId, runId: traceCall.runId, provider: traceCall.provider, model: traceCall.model,
        durationMs: traceCall.durationMs, attempts: traceCall.attempts,
        responseFormatFallback: traceCall.responseFormatFallback, terminationCategory: traceCall.terminationCategory,
        usage: structuredClone(traceCall.usage)
      } }
      const combined = deriveConsistencyReviewFromQualityGate(sourceReport, data.generatedChapterDrafts[0])
      assert.equal(combined.qualityGateReport.aiTelemetry.callId, traceCall.callId)
      assert.equal(combined.consistencyReviewReport.id, `combined-consistency-${sourceReport.id}`)
      data.qualityGateReports[0] = combined.qualityGateReport
      data.chapterCommitBundles[0].qualityGateReports = [combined.qualityGateReport]
      const result = measureAcceptedChapterCost({ data, projectId: LONG_NOVEL_PROJECT_ID, chapterId: 'perf-chapter-1' })
      assert.equal(result.callCount, 4)
      assert.equal(result.totalTokens.known, 30_800)
      assert.equal(result.calls.find((call) => call.callId === traceCall.callId).stepType, traceStep)
      assert.ok(!warningCodes(result).has('CALL_ID_CONFLICT'))
    }
  })

  test('follows task-edit source jobs and only includes unrelated failures explicitly', () => {
    const data = fixture()
    data.chapterGenerationJobs.find((job) => job.id === 'perf-job-1').taskEdit = { sourceJobId: 'source-job' }
    data.chapterGenerationJobs.push(
      { id: 'source-job', projectId: LONG_NOVEL_PROJECT_ID, targetChapterOrder: 1, status: 'completed' },
      { id: 'failed-job', projectId: LONG_NOVEL_PROJECT_ID, targetChapterOrder: 1, status: 'failed' },
      { id: 'foreign-job', projectId: 'perf-second-project', targetChapterOrder: 1, status: 'failed' }
    )
    const sourceCall = { ...data.generationRunTraces[0].aiCalls[0], id: 'source-call', callId: 'source-call', stepId: 'source-step' }
    const failedCall = { ...data.generationRunTraces[0].aiCalls[0], id: 'failed-call', callId: 'failed-call', stepId: 'failed-step', outcome: 'failed', attempts: 2, usage: undefined }
    data.generationRunTraces.push(
      { ...data.generationRunTraces[0], id: 'source-trace', jobId: 'source-job', aiCalls: [sourceCall] },
      { ...data.generationRunTraces[0], id: 'failed-trace', jobId: 'failed-job', aiCalls: [failedCall] }
    )
    const implicit = measureAcceptedChapterCost({ data, projectId: LONG_NOVEL_PROJECT_ID, chapterId: 'perf-chapter-1' })
    assert.deepEqual(implicit.includedJobIds, ['perf-job-1', 'source-job'])
    assert.equal(implicit.callCount, 5)
    assert.ok(warningCodes(implicit).has('UNATTRIBUTED_FAILED_JOB'))
    const explicit = measureAcceptedChapterCost({
      data, projectId: LONG_NOVEL_PROJECT_ID, chapterId: 'perf-chapter-1',
      relatedJobIds: ['failed-job', 'foreign-job']
    })
    assert.deepEqual(explicit.includedJobIds, ['perf-job-1', 'source-job', 'failed-job'])
    assert.equal(explicit.callCount, 6)
    assert.equal(explicit.failedCallCount, 1)
    assert.equal(explicit.retryCount, 1)
    assert.equal(explicit.status, 'partial')
    assert.ok(warningCodes(explicit).has('REJECTED_RELATED_JOB'))
    assert.ok(warningCodes(explicit).has('RETRY_USAGE_MAY_BE_INCOMPLETE'))
  })

  test('does not turn missing usage or callId into zero', () => {
    const data = fixture()
    data.generationRunTraces[0].aiCalls[0].usage = undefined
    data.generationRunTraces[0].aiCalls[1].callId = undefined
    const result = measureAcceptedChapterCost({ data, projectId: LONG_NOVEL_PROJECT_ID, chapterId: 'perf-chapter-1' })
    assert.equal(result.status, 'partial')
    assert.equal(result.callCount, 3)
    assert.equal(result.unidentifiedTelemetryRecordCount, 2)
    assert.equal(result.promptTokens.known, 13_000)
    assert.equal(result.promptTokens.unknownCallCount, 1)
    assert.ok(warningCodes(result).has('MISSING_CALL_ID'))
  })

  test('excludes conflicting duplicate callId values from totals', () => {
    const data = fixture()
    data.chapterCommitBundles[0].generationRunTrace = structuredClone(data.generationRunTraces[0])
    data.chapterCommitBundles[0].generationRunTrace.aiCalls[0].durationMs = 9_999
    const result = measureAcceptedChapterCost({ data, projectId: LONG_NOVEL_PROJECT_ID, chapterId: 'perf-chapter-1' })
    assert.equal(result.status, 'partial')
    assert.equal(result.callCount, 4)
    assert.equal(result.promptTokens.known, 19_500)
    assert.equal(result.promptTokens.unknownCallCount, 1)
    assert.ok(result.calls.find((call) => call.callId === 'perf-job-1-planner').conflicted)
    assert.ok(warningCodes(result).has('CALL_ID_CONFLICT'))
  })

  test('reports accepted AI revision telemetry as missing instead of zero', () => {
    const data = fixture()
    const chapter = data.chapters[0]
    const generatedVersion = data.chapterVersions.find((version) => version.id === 'perf-chapter-1-v1')
    const revisedVersion = {
      id: 'revision-version-1', projectId: LONG_NOVEL_PROJECT_ID, chapterId: chapter.id,
      source: 'user_with_ai_revision', title: chapter.title, body: 'Synthetic revised body.', note: 'Synthetic revision.',
      linkedRevisionCommitId: 'revision-commit-1', linkedGenerationRunTraceId: 'perf-trace-1',
      linkedChapterCommitId: 'perf-commit-1', baseChapterVersionId: generatedVersion.id, createdAt: '2026-09-07T01:00:00.000Z'
    }
    chapter.body = revisedVersion.body
    data.chapterVersions.push(revisedVersion)
    data.revisionSessions.push({ id: 'revision-session-1', projectId: LONG_NOVEL_PROJECT_ID, chapterId: chapter.id, sourceDraftId: 'perf-draft-1', status: 'completed' })
    data.revisionVersions.push({ id: 'revision-candidate-1', sessionId: 'revision-session-1', status: 'accepted' })
    data.revisionCommitBundles.push({
      schemaVersion: 1, id: 'revision-commit-1', revisionCommitId: 'revision-commit-1', projectId: LONG_NOVEL_PROJECT_ID,
      chapterId: chapter.id, baseChapterVersionId: generatedVersion.id, newChapterVersionId: revisedVersion.id,
      revisionSessionId: 'revision-session-1', revisionVersionId: 'revision-candidate-1', revisedAt: revisedVersion.createdAt,
      revisedBy: 'user_with_ai', beforeText: generatedVersion.body, afterText: revisedVersion.body, chapter,
      chapterVersion: revisedVersion, linkedGenerationRunTraceId: 'perf-trace-1', linkedChapterCommitId: 'perf-commit-1'
    })
    const result = measureAcceptedChapterCost({ data, projectId: LONG_NOVEL_PROJECT_ID, chapterId: chapter.id })
    assert.equal(result.status, 'partial')
    assert.deepEqual(result.revisionCommitIds, ['revision-commit-1'])
    assert.ok(warningCodes(result).has('MISSING_REVISION_TELEMETRY'))
    assert.equal(result.callCount, 4)
  })

  test('reports an accepted draft revision candidate with no persisted telemetry', () => {
    const data = fixture()
    const commit = data.chapterCommitBundles[0]
    data.revisionCandidates.push({
      id: 'draft-revision-1', projectId: LONG_NOVEL_PROJECT_ID, jobId: commit.jobId,
      draftId: commit.generatedDraftId, sourceReportId: 'perf-quality-1', targetIssue: 'Synthetic issue.',
      revisionInstruction: 'Synthetic instruction.', revisedText: commit.chapter.body,
      status: 'accepted', createdAt: '2026-09-07T00:30:00.000Z', updatedAt: '2026-09-07T00:30:00.000Z'
    })
    const result = measureAcceptedChapterCost({ data, projectId: LONG_NOVEL_PROJECT_ID, chapterId: 'perf-chapter-1' })
    assert.equal(result.status, 'partial')
    assert.ok(warningCodes(result).has('MISSING_REVISION_TELEMETRY'))
    assert.equal(result.callCount, 4)
  })

  test('warns about a same-chapter failed run with no trace and does not guess attribution', () => {
    const data = fixture()
    data.chapterGenerationJobs.push({ id: 'orphan-failure', projectId: LONG_NOVEL_PROJECT_ID, targetChapterOrder: 1, status: 'failed' })
    const result = measureAcceptedChapterCost({ data, projectId: LONG_NOVEL_PROJECT_ID, chapterId: 'perf-chapter-1' })
    assert.equal(result.status, 'partial')
    assert.equal(result.callCount, 4)
    assert.ok(warningCodes(result).has('UNATTRIBUTED_FAILED_JOB'))
  })

  test('rejects a task-edit source job from another chapter', () => {
    const data = fixture()
    data.chapterGenerationJobs.find((job) => job.id === 'perf-job-1').taskEdit = { sourceJobId: 'perf-job-2' }
    const result = measureAcceptedChapterCost({ data, projectId: LONG_NOVEL_PROJECT_ID, chapterId: 'perf-chapter-1' })
    assert.deepEqual(result.includedJobIds, ['perf-job-1'])
    assert.ok(warningCodes(result).has('JOB_SCOPE_MISMATCH'))
    assert.equal(result.callCount, 4)
  })

  console.log(`Accepted chapter cost validation passed: ${checks} focused checks (synthetic fixture; mock usage only).`)
} finally {
  await rm(outDir, { recursive: true, force: true })
}
