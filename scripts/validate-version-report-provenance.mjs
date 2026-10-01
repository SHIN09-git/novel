import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const outDir = join(repoRoot, 'tmp', 'version-report-provenance-test')
const createdAt = '2026-09-22T00:00:00.000Z'

async function bundle(entryPoint, outfileName) {
  const outfile = join(outDir, outfileName)
  await build({
    entryPoints: [join(repoRoot, entryPoint)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}-${Math.random()}`)
}

function qualityReport(id, bodyHash, overrides = {}) {
  return {
    id,
    projectId: 'project-1',
    jobId: 'job-1',
    chapterId: 'chapter-1',
    draftId: 'draft-a',
    draftContentHash: bodyHash,
    overallScore: 90,
    pass: true,
    dimensions: {},
    issues: [],
    requiredFixes: [],
    optionalSuggestions: [],
    createdAt,
    ...overrides
  }
}

function consistencyReport(id, bodyHash, overrides = {}) {
  return {
    id,
    projectId: 'project-1',
    jobId: 'job-1',
    chapterId: 'chapter-1',
    draftId: 'draft-a',
    draftContentHash: bodyHash,
    issues: [],
    suggestions: '',
    severitySummary: 'low',
    createdAt,
    ...overrides
  }
}

function trace(id, qualityGateReportId, consistencyReviewReportId, overrides = {}) {
  return {
    id,
    projectId: 'project-1',
    jobId: 'job-1',
    targetChapterOrder: 1,
    generatedDraftId: 'draft-a',
    qualityGateReportId,
    consistencyReviewReportId,
    ...overrides
  }
}

function baseData(bodyHashA, bodyHashB) {
  const reportA = qualityReport('quality-a', bodyHashA)
  const consistencyA = consistencyReport('consistency-a', bodyHashA)
  const reportB = qualityReport('quality-b', bodyHashB, { draftId: 'draft-b' })
  const consistencyB = consistencyReport('consistency-b', bodyHashB, { draftId: 'draft-b' })
  return {
    chapters: [{
      id: 'chapter-1', projectId: 'project-1', order: 1, title: 'Chapter 1', body: 'Current body',
      createdAt, updatedAt: createdAt
    }],
    chapterVersions: [
      {
        id: 'version-a', projectId: 'project-1', chapterId: 'chapter-1', source: 'generated_draft',
        title: 'Chapter 1', body: 'Accepted body A', note: '', createdAt,
        linkedChapterCommitId: 'commit-a', linkedGenerationRunTraceId: 'trace-shared'
      },
      {
        id: 'version-revision', projectId: 'project-1', chapterId: 'chapter-1', source: 'ai_revision',
        title: 'Chapter 1', body: 'Revised body', note: '', createdAt,
        linkedChapterCommitId: 'commit-a', linkedRevisionCommitId: 'revision-1', linkedGenerationRunTraceId: 'trace-shared'
      },
      {
        id: 'version-restore', projectId: 'project-1', chapterId: 'chapter-1', source: 'manual_revision',
        title: 'Chapter 1', body: 'Restored body', note: 'restore', createdAt,
        linkedChapterCommitId: 'commit-a', linkedRevisionCommitId: 'restore-1', linkedGenerationRunTraceId: 'trace-shared'
      }
    ],
    chapterCommitBundles: [{
      schemaVersion: 1,
      id: 'commit-a',
      commitId: 'commit-a',
      projectId: 'project-1',
      chapterId: 'chapter-1',
      jobId: 'job-1',
      generatedDraftId: 'draft-a',
      acceptedAt: createdAt,
      acceptedBy: 'user',
      chapter: { id: 'chapter-1', projectId: 'project-1', title: 'Chapter 1', body: 'Accepted body A' },
      chapterVersion: {
        id: 'version-a', projectId: 'project-1', chapterId: 'chapter-1', source: 'generated_draft',
        title: 'Chapter 1', body: 'Accepted body A', note: '', createdAt
      },
      qualityGateReportId: 'quality-a',
      consistencyReviewReportId: 'consistency-a',
      generationRunTraceId: 'trace-shared',
      qualityGateReports: [reportA],
      consistencyReviewReports: [consistencyA]
    }],
    revisionCommitBundles: [
      {
        id: 'revision-1', revisionCommitId: 'revision-1', projectId: 'project-1', chapterId: 'chapter-1',
        newChapterVersionId: 'version-revision', linkedChapterCommitId: 'commit-a',
        linkedGenerationRunTraceId: 'trace-shared', beforeText: 'Accepted body A', afterText: 'Revised body', revisedAt: createdAt
      },
      {
        id: 'restore-1', revisionCommitId: 'restore-1', projectId: 'project-1', chapterId: 'chapter-1',
        newChapterVersionId: 'version-restore', linkedChapterCommitId: 'commit-a',
        linkedGenerationRunTraceId: 'trace-shared', beforeText: 'Revised body', afterText: 'Restored body', revisedAt: createdAt
      }
    ],
    generationRunTraces: [trace('trace-shared', 'quality-b', 'consistency-b', { generatedDraftId: 'draft-b' })],
    qualityGateReports: [reportA, reportB],
    consistencyReviewReports: [consistencyA, consistencyB]
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const [{ getChapterVersionDetail }, { draftContentHash }] = await Promise.all([
    bundle('src/services/ChapterVersionChainService.ts', 'version-chain.mjs'),
    bundle('src/services/DraftDiagnosticBindingService.ts', 'draft-binding.mjs')
  ])

  const hashA = draftContentHash('Accepted body A')
  const hashB = draftContentHash('Later body B')
  const data = baseData(hashA, hashB)

  const currentBody = data.chapters[0].body
  const currentHash = draftContentHash(currentBody)
  const unrelatedCurrentQuality = qualityReport('quality-unrelated-current', currentHash, { draftId: 'draft-current' })
  const unrelatedCurrentData = {
    ...data,
    chapterCommitBundles: [...data.chapterCommitBundles, {
      schemaVersion: 1, id: 'commit-old-without-version', commitId: 'commit-old-without-version',
      projectId: 'project-1', chapterId: 'chapter-1', jobId: 'job-1', acceptedAt: createdAt, acceptedBy: 'user',
      chapter: { id: 'chapter-1', projectId: 'project-1', title: 'Chapter 1', body: 'Unrelated old body' },
      generationRunTraceId: 'trace-unrelated-current'
    }],
    generationRunTraces: [
      ...data.generationRunTraces,
      trace('trace-unrelated-current', unrelatedCurrentQuality.id, null, { generatedDraftId: 'draft-current' })
    ],
    qualityGateReports: [...data.qualityGateReports, unrelatedCurrentQuality]
  }
  const current = getChapterVersionDetail(unrelatedCurrentData, 'current:chapter-1')
  assert.equal(current?.chapterCommitBundle, null, 'an unassociated current entry must not pick a legacy commit without a version id')
  assert.equal(current?.qualityGateReport, null, 'an unassociated current entry must not expose that legacy commit trace report')

  const accepted = getChapterVersionDetail(data, 'version-a')
  assert.equal(accepted?.qualityGateReport?.id, 'quality-a', 'commit quality evidence must win over a later same-job trace')
  assert.equal(accepted?.consistencyReviewReport?.id, 'consistency-a', 'commit consistency evidence must win over a later same-job trace')

  for (const versionId of ['version-revision', 'version-restore']) {
    const detail = getChapterVersionDetail(data, versionId)
    assert.equal(detail?.qualityGateReport, null, `${versionId} must not inherit the source draft quality report`)
    assert.equal(detail?.consistencyReviewReport, null, `${versionId} must not inherit the source draft consistency report`)
  }

  const fallbackBody = 'Trace-bound historical body'
  const fallbackHash = draftContentHash(fallbackBody)
  const fallbackVersion = {
    id: 'version-fallback', projectId: 'project-1', chapterId: 'chapter-1', source: 'generated_draft',
    title: 'Chapter 1', body: fallbackBody, note: '', createdAt, linkedGenerationRunTraceId: 'trace-fallback'
  }
  const fallbackQuality = qualityReport('quality-fallback', fallbackHash, { draftId: 'draft-fallback' })
  const fallbackConsistency = consistencyReport('consistency-fallback', fallbackHash, { draftId: 'draft-fallback' })
  const fallbackData = {
    ...data,
    chapterVersions: [...data.chapterVersions, fallbackVersion],
    generationRunTraces: [
      ...data.generationRunTraces,
      trace('trace-fallback', fallbackQuality.id, fallbackConsistency.id, { generatedDraftId: 'draft-fallback' })
    ],
    qualityGateReports: [...data.qualityGateReports, fallbackQuality],
    consistencyReviewReports: [...data.consistencyReviewReports, fallbackConsistency]
  }
  const fallback = getChapterVersionDetail(fallbackData, fallbackVersion.id)
  assert.equal(fallback?.qualityGateReport?.id, fallbackQuality.id, 'a fully bound trace quality report should remain visible')
  assert.equal(fallback?.consistencyReviewReport?.id, fallbackConsistency.id, 'a fully bound trace consistency report should remain visible')

  const missingHashData = structuredClone(fallbackData)
  delete missingHashData.qualityGateReports.find((report) => report.id === fallbackQuality.id).draftContentHash
  delete missingHashData.consistencyReviewReports.find((report) => report.id === fallbackConsistency.id).draftContentHash
  assert.equal(getChapterVersionDetail(missingHashData, fallbackVersion.id)?.qualityGateReport, null, 'trace fallback without a body hash must be hidden')
  assert.equal(getChapterVersionDetail(missingHashData, fallbackVersion.id)?.consistencyReviewReport, null, 'trace fallback consistency without a body hash must be hidden')

  const staleHashData = structuredClone(fallbackData)
  staleHashData.qualityGateReports.find((report) => report.id === fallbackQuality.id).draftContentHash = hashB
  staleHashData.consistencyReviewReports.find((report) => report.id === fallbackConsistency.id).draftContentHash = hashB
  assert.equal(getChapterVersionDetail(staleHashData, fallbackVersion.id)?.qualityGateReport, null, 'trace fallback for another body must be hidden')
  assert.equal(getChapterVersionDetail(staleHashData, fallbackVersion.id)?.consistencyReviewReport, null, 'stale consistency fallback must be hidden')

  const wrongScopeData = structuredClone(fallbackData)
  wrongScopeData.qualityGateReports.find((report) => report.id === fallbackQuality.id).chapterId = 'chapter-other'
  wrongScopeData.consistencyReviewReports.find((report) => report.id === fallbackConsistency.id).jobId = 'job-other'
  assert.equal(getChapterVersionDetail(wrongScopeData, fallbackVersion.id)?.qualityGateReport, null, 'trace fallback from another chapter must be hidden')
  assert.equal(getChapterVersionDetail(wrongScopeData, fallbackVersion.id)?.consistencyReviewReport, null, 'trace fallback from another job must be hidden')

  const wrongProjectData = structuredClone(fallbackData)
  wrongProjectData.qualityGateReports.find((report) => report.id === fallbackQuality.id).projectId = 'project-other'
  wrongProjectData.consistencyReviewReports.find((report) => report.id === fallbackConsistency.id).projectId = 'project-other'
  assert.equal(getChapterVersionDetail(wrongProjectData, fallbackVersion.id)?.qualityGateReport, null, 'trace fallback from another project must be hidden')
  assert.equal(getChapterVersionDetail(wrongProjectData, fallbackVersion.id)?.consistencyReviewReport, null, 'cross-project consistency fallback must be hidden')

  const legacyBody = 'Legacy accepted body'
  const legacyVersion = {
    id: 'version-legacy', projectId: 'project-1', chapterId: 'chapter-1', source: 'generated_draft',
    title: 'Chapter 1', body: legacyBody, note: '', createdAt, linkedChapterCommitId: 'commit-legacy'
  }
  const legacyQuality = qualityReport('quality-legacy', undefined, { chapterId: null, draftId: 'draft-legacy' })
  const legacyConsistency = consistencyReport('consistency-legacy', undefined, { chapterId: null, draftId: 'draft-legacy' })
  const legacyData = {
    ...data,
    chapterVersions: [...data.chapterVersions, legacyVersion],
    chapterCommitBundles: [...data.chapterCommitBundles, {
      schemaVersion: 1, id: 'commit-legacy', commitId: 'commit-legacy', projectId: 'project-1', chapterId: 'chapter-1',
      jobId: 'job-1', generatedDraftId: 'draft-legacy', acceptedAt: createdAt, acceptedBy: 'user',
      chapter: { id: 'chapter-1', projectId: 'project-1', title: 'Chapter 1', body: legacyBody },
      qualityGateReportId: legacyQuality.id, consistencyReviewReportId: legacyConsistency.id
    }],
    qualityGateReports: [...data.qualityGateReports, legacyQuality],
    consistencyReviewReports: [...data.consistencyReviewReports, legacyConsistency]
  }
  const legacy = getChapterVersionDetail(legacyData, legacyVersion.id)
  assert.equal(legacy?.qualityGateReport?.id, legacyQuality.id, 'an explicit legacy commit report reference must work without a hash')
  assert.equal(legacy?.consistencyReviewReport?.id, legacyConsistency.id, 'legacy consistency provenance must not be hidden wholesale')

  console.log('version report provenance validation passed')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await rm(outDir, { recursive: true, force: true })
  })
