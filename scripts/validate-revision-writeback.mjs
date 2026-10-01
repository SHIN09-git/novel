import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const sourcePath = join(root, 'src', 'renderer', 'src', 'utils', 'revisionWriteback.ts')
const outDir = join(root, 'tmp', 'revision-writeback-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function bundle(relativePath, outfileName) {
  await mkdir(outDir, { recursive: true })
  const outfile = join(outDir, outfileName)
  await build({
    entryPoints: [relativePath],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

async function loadModules() {
  const [writeback, defaults, diagnostics] = await Promise.all([
    bundle(sourcePath, 'revision-writeback.mjs'),
    bundle(join(root, 'src', 'shared', 'defaults.ts'), 'defaults.mjs'),
    bundle(join(root, 'src', 'services', 'DraftDiagnosticBindingService.ts'), 'draft-diagnostics.mjs')
  ])
  return { ...writeback, ...defaults, ...diagnostics }
}

function makeData(normalizeAppData) {
  const project = { id: 'project-1', name: '测试项目', genre: '', description: '', targetReaders: '', coreAppeal: '', style: '', createdAt: 't0', updatedAt: 't0' }
  const chapter1 = {
    id: 'chapter-1',
    projectId: project.id,
    order: 1,
    title: '第一章',
    body: '第一章原文',
    summary: '',
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '',
    riskWarnings: '',
    includedInStageSummary: false,
    createdAt: 't0',
    updatedAt: 't0'
  }
  const chapter2 = { ...chapter1, id: 'chapter-2', order: 2, title: '第二章', body: '第二章原文' }
  const draftOnly = {
    id: 'draft-null',
    projectId: project.id,
    chapterId: null,
    jobId: 'job-1',
    title: '新章草稿',
    body: '草稿原文',
    summary: '',
    status: 'draft',
    tokenEstimate: 10,
    createdAt: 't0',
    updatedAt: 't0'
  }
  const linkedDraft = { ...draftOnly, id: 'draft-linked', chapterId: chapter2.id, body: '关联草稿原文' }
  const baseVersion = {
    id: 'version-1',
    sessionId: 'session-1',
    requestId: 'request-1',
    title: '修订版',
    body: '修订正文',
    changedSummary: '',
    risks: '',
    preservedFacts: '',
    status: 'pending',
    createdAt: 't0',
    updatedAt: 't0'
  }
  const appData = {
    schemaVersion: 2,
    projects: [project],
    storyBibles: [],
    chapters: [chapter1, chapter2],
    characters: [],
    characterStateLogs: [],
    foreshadowings: [],
    timelineEvents: [],
    stageSummaries: [],
    promptVersions: [],
    promptContextSnapshots: [],
    chapterContinuityBridges: [],
    chapterGenerationJobs: [{
      id: 'job-1', projectId: project.id, targetChapterOrder: 1, contextSource: 'auto', status: 'completed',
      currentStep: 'await_user_confirmation', createdAt: 't0', updatedAt: 't0', errorMessage: ''
    }],
    chapterGenerationSteps: [
      { id: 'step-review', jobId: 'job-1', type: 'generate_chapter_review', status: 'completed', inputSnapshot: '', output: '旧审稿', errorMessage: '', createdAt: 't0', updatedAt: 't0' },
      { id: 'step-quality', jobId: 'job-1', type: 'quality_gate', status: 'completed', inputSnapshot: '', output: '旧质量报告', errorMessage: '', createdAt: 't0', updatedAt: 't0' },
      { id: 'step-confirm', jobId: 'job-1', type: 'await_user_confirmation', status: 'completed', inputSnapshot: '', output: '', errorMessage: '', createdAt: 't0', updatedAt: 't0' }
    ],
    generatedChapterDrafts: [draftOnly, linkedDraft],
    memoryUpdateCandidates: [],
    consistencyReviewReports: [],
    contextBudgetProfiles: [],
    qualityGateReports: [{
      id: 'quality-old', projectId: project.id, jobId: 'job-1', chapterId: null, draftId: draftOnly.id,
      draftContentHash: 'old-draft-hash', overallScore: 88, pass: true, dimensions: {}, issues: [],
      requiredFixes: [], optionalSuggestions: [], createdAt: 't0'
    }],
    generationRunTraces: [{
      id: 'trace-1', projectId: project.id, jobId: 'job-1', targetChapterOrder: 1,
      generatedDraftId: draftOnly.id, qualityGateReportId: 'quality-old', consistencyReviewReportId: null,
      redundancyReportId: null, noveltyAuditResult: null, createdAt: 't0', updatedAt: 't0'
    }],
    runTraceAuthorSummaries: [{
      id: 'summary-1', projectId: project.id, jobId: 'job-1', generatedDraftId: draftOnly.id,
      chapterId: null, createdAt: 't0', updatedAt: 't0'
    }],
    redundancyReports: [],
    revisionCandidates: [],
    revisionSessions: [{ id: 'session-1', projectId: project.id, chapterId: '', sourceDraftId: draftOnly.id, status: 'active', createdAt: 't0', updatedAt: 't0' }],
    revisionRequests: [],
    revisionVersions: [baseVersion],
    chapterVersions: [],
    settings: {
      apiProvider: 'openai',
      apiKey: '',
      baseUrl: '',
      modelName: '',
      temperature: 0.7,
      maxTokens: 4000,
      enableAutoSummary: false,
      enableChapterDiagnostics: false,
      defaultTokenBudget: 16000,
      defaultPromptMode: 'standard',
      theme: 'system'
    }
  }
  const normalized = normalizeAppData(appData)
  return {
    appData: normalized,
    project: normalized.projects.find((item) => item.id === project.id),
    chapter1: normalized.chapters.find((item) => item.id === chapter1.id),
    chapter2: normalized.chapters.find((item) => item.id === chapter2.id),
    draftOnly: normalized.generatedChapterDrafts.find((item) => item.id === draftOnly.id),
    linkedDraft: normalized.generatedChapterDrafts.find((item) => item.id === linkedDraft.id),
    baseVersion: normalized.revisionVersions.find((item) => item.id === baseVersion.id)
  }
}

async function main() {
  const { applyAcceptedRevisionWriteback, resolveDraftLinkedChapter, normalizeAppData, draftContentHash, qualityReportMatchesDraft } = await loadModules()
  const checks = []
  const fixture = makeData(normalizeAppData)
  fixture.baseVersion = {
    ...fixture.baseVersion,
    sourceContentHash: draftContentHash(fixture.draftOnly.body)
  }
  fixture.appData.revisionVersions = fixture.appData.revisionVersions.map((version) =>
    version.id === fixture.baseVersion.id ? fixture.baseVersion : version
  )

  checks.push(
    assert(
      resolveDraftLinkedChapter(fixture.draftOnly, fixture.appData.chapters) === null,
      'draft.chapterId=null 时不会 fallback 到第一章'
    )
  )

  const draftOnlyResult = applyAcceptedRevisionWriteback(
    fixture.appData,
    fixture.project.id,
    { kind: 'draft', draft: fixture.draftOnly, linkedChapter: null },
    fixture.baseVersion,
    't1'
  )
  checks.push(
    assert(
      draftOnlyResult.data.chapters.every((chapter) => chapter.body.endsWith('原文')),
      '接受 draft.chapterId=null 的修订时不改变任何已有章节'
    )
  )
  checks.push(
    assert(
      draftOnlyResult.data.generatedChapterDrafts.find((draft) => draft.id === fixture.draftOnly.id)?.body === fixture.baseVersion.body &&
        draftOnlyResult.data.generatedChapterDrafts.find((draft) => draft.id === fixture.draftOnly.id)?.status === 'draft',
      '未关联章节的修订更新草稿正文但保持 draft 状态'
    )
  )
  checks.push(
    assert(
      draftOnlyResult.data.chapterVersions.length === 0 &&
        draftOnlyResult.data.generationRunTraces.find((trace) => trace.id === 'trace-1')?.qualityGateReportId === null &&
        !qualityReportMatchesDraft(
          draftOnlyResult.data.qualityGateReports.find((report) => report.id === 'quality-old'),
          draftOnlyResult.data.generatedChapterDrafts.find((draft) => draft.id === fixture.draftOnly.id)
        ),
      '写回草稿后旧质量报告不能参与当前采纳，且旧诊断绑定已失效'
    )
  )

  const linkedVersion = {
    ...fixture.baseVersion,
    id: 'version-2',
    body: '关联草稿修订正文',
    sourceContentHash: draftContentHash(fixture.linkedDraft.body),
    sourceChapterContentHash: draftContentHash(fixture.chapter2.body)
  }
  const linkedResult = applyAcceptedRevisionWriteback(
    fixture.appData,
    fixture.project.id,
    { kind: 'draft', draft: fixture.linkedDraft, linkedChapter: fixture.chapter2 },
    linkedVersion,
    't2'
  )
  checks.push(
    assert(
      linkedResult.data.generatedChapterDrafts.find((draft) => draft.id === fixture.linkedDraft.id)?.body === linkedVersion.body &&
        linkedResult.data.generatedChapterDrafts.find((draft) => draft.id === fixture.linkedDraft.id)?.status === 'accepted' &&
        linkedResult.data.chapters.find((chapter) => chapter.id === fixture.chapter2.id)?.body === linkedVersion.body,
      '接受 draft.chapterId 存在的草稿修订时同步更新草稿和关联章节'
    )
  )

  const chapterVersion = {
    ...fixture.baseVersion,
    id: 'version-3',
    body: '第一章修订正文',
    sourceContentHash: draftContentHash(fixture.chapter1.body)
  }
  const chapterResult = applyAcceptedRevisionWriteback(
    fixture.appData,
    fixture.project.id,
    { kind: 'chapter', chapter: fixture.chapter1 },
    chapterVersion,
    't3'
  )
  checks.push(
    assert(
      chapterResult.data.chapters.find((chapter) => chapter.id === fixture.chapter1.id)?.body === chapterVersion.body &&
        chapterResult.data.generatedChapterDrafts.find((draft) => draft.id === fixture.draftOnly.id)?.body === fixture.draftOnly.body,
      '接受章节修订时仍然正常写入章节且不误改草稿'
    )
  )

  const mismatchedVersion = {
    ...fixture.baseVersion,
    id: 'version-stale-source',
    sourceContentHash: 'draft-v1-stale-source'
  }
  const beforeMismatch = JSON.stringify(fixture.appData)
  let mismatchRejected = false
  try {
    applyAcceptedRevisionWriteback(
      fixture.appData,
      fixture.project.id,
      { kind: 'draft', draft: fixture.draftOnly, linkedChapter: null },
      mismatchedVersion,
      't4'
    )
  } catch {
    mismatchRejected = true
  }
  checks.push(
    assert(mismatchRejected && JSON.stringify(fixture.appData) === beforeMismatch,
      'sourceContentHash 不匹配时拒绝写回且不修改数据')
  )

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
