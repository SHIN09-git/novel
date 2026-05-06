import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve('.')
const sourcePath = join(root, 'src', 'renderer', 'src', 'utils', 'revisionWriteback.ts')
const outDir = join(root, 'tmp', 'revision-writeback-test')
const outPath = join(outDir, 'revisionWriteback.mjs')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function loadModule() {
  const source = await readFile(sourcePath, 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: true
    }
  })
  await mkdir(outDir, { recursive: true })
  await writeFile(outPath, compiled.outputText, 'utf-8')
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

function makeData() {
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
    chapterGenerationJobs: [],
    chapterGenerationSteps: [],
    generatedChapterDrafts: [draftOnly, linkedDraft],
    memoryUpdateCandidates: [],
    consistencyReviewReports: [],
    contextBudgetProfiles: [],
    qualityGateReports: [],
    generationRunTraces: [],
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
  return { appData, project, chapter1, chapter2, draftOnly, linkedDraft, baseVersion }
}

async function main() {
  const { applyAcceptedRevisionWriteback, resolveDraftLinkedChapter } = await loadModule()
  const checks = []
  const fixture = makeData()

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
        draftOnlyResult.data.generatedChapterDrafts.find((draft) => draft.id === fixture.draftOnly.id)?.status === 'accepted',
      '接受 draft.chapterId=null 的修订时更新对应草稿 body/status/updatedAt'
    )
  )

  const linkedVersion = { ...fixture.baseVersion, id: 'version-2', body: '关联草稿修订正文' }
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

  const chapterVersion = { ...fixture.baseVersion, id: 'version-3', body: '第一章修订正文' }
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

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
