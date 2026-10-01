import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const outDir = join(repoRoot, 'tmp', 'chapter-archive-validation')

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function bundle(entryPoint, outputName) {
  const outfile = join(outDir, outputName)
  await build({
    entryPoints: [join(repoRoot, entryPoint)],
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

async function source(relativePath) {
  return readFile(join(repoRoot, relativePath), 'utf8')
}

const project = {
  id: 'project-1',
  name: 'Archive test',
  genre: '',
  description: '',
  targetReaders: '',
  coreAppeal: '',
  style: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function chapter(id, order, archivedAt = null) {
  return {
    id,
    projectId: project.id,
    order,
    title: `Chapter ${order}`,
    body: `Body ${order}`,
    summary: '',
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '',
    riskWarnings: '',
    includedInStageSummary: false,
    archivedAt,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const lifecycle = await bundle('src/services/ChapterLifecycleService.ts', 'chapter-lifecycle.mjs')
  const defaults = await bundle('src/shared/defaults.ts', 'defaults.mjs')
  const projectDataModule = await bundle('src/renderer/src/utils/projectData.ts', 'project-data.mjs')
  const chapterCommit = await bundle('src/services/ChapterCommitBundleService.ts', 'chapter-commit.mjs')
  const revisionCommit = await bundle('src/services/RevisionCommitBundleService.ts', 'revision-commit.mjs')
  const agentTools = await bundle('src/agent/tools/AgentToolService.ts', 'agent-tools.mjs')

  const normalized = defaults.normalizeAppData({ projects: [project], chapters: [chapter('chapter-1', 1)] })
  assert(normalized.chapters[0].archivedAt === null, 'old chapters normalize with archivedAt=null')

  const withHistory = {
    ...normalized,
    chapterVersions: [
      {
        id: 'version-1',
        projectId: project.id,
        chapterId: 'chapter-1',
        source: 'generated_draft',
        title: 'Chapter 1',
        body: 'Body 1',
        note: '',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
  }
  const archived = lifecycle.archiveChapterInAppData(withHistory, 'chapter-1', '2026-02-01T00:00:00.000Z')
  assert(archived.chapters.length === 1 && lifecycle.isChapterArchived(archived.chapters[0]), 'archive preserves the chapter entity and marks it archived')
  assert(archived.chapterVersions.length === 1, 'archive preserves the formal version chain')
  assert(lifecycle.activeChapters(archived.chapters).length === 0, 'archived chapters are excluded from active chapter selection')
  assert(lifecycle.archivedChapters(archived.chapters).length === 1, 'archived chapters remain discoverable for restore')

  const scoped = projectDataModule.projectData(archived, project.id)
  assert(scoped.chapters.length === 0 && scoped.archivedChapters.length === 1, 'projectData separates active and archived chapters')
  assert(scoped.allChapters.length === 1, 'projectData retains an all-chapters view for order allocation')
  assert(lifecycle.nextChapterOrder(archived.chapters, project.id) === 2, 'next chapter order does not reuse an archived chapter order')

  const restored = lifecycle.restoreArchivedChapterInAppData(archived, 'chapter-1', '2026-02-02T00:00:00.000Z')
  assert(!lifecycle.isChapterArchived(restored.chapter) && restored.chapter.order === 1, 'restore reactivates an unoccupied chapter order')
  assert(restored.data.chapterVersions.length === 1, 'restore keeps existing history intact')

  const collisionData = {
    ...archived,
    chapters: [...archived.chapters, chapter('chapter-active-1', 1)]
  }
  const collisionRestore = lifecycle.restoreArchivedChapterInAppData(collisionData, 'chapter-1', '2026-02-03T00:00:00.000Z')
  assert(collisionRestore.orderChanged && collisionRestore.chapter.order === 2, 'restore moves a chapter to the end when its old order is occupied')

  const archivedWithDraft = {
    ...archived,
    generatedChapterDrafts: [
      {
        id: 'draft-1',
        projectId: project.id,
        chapterId: null,
        jobId: 'job-1',
        title: 'Replacement',
        body: 'Replacement body',
        summary: '',
        status: 'draft',
        tokenEstimate: 10,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z'
      }
    ]
  }
  let chapterCommitBlocked = false
  try {
    chapterCommit.buildAcceptedDraftCommitBundle({
      appData: archivedWithDraft,
      projectId: project.id,
      draftId: 'draft-1',
      targetChapterOrder: 1,
      commitId: 'commit-1',
      chapterId: 'replacement-1',
      acceptedAt: '2026-02-04T00:00:00.000Z'
    })
  } catch (error) {
    chapterCommitBlocked = String(error).includes('已归档')
  }
  assert(chapterCommitBlocked, 'accepted drafts cannot silently overwrite an archived chapter')

  let revisionCommitBlocked = false
  try {
    revisionCommit.buildRevisionCommitBundle({
      appData: archived,
      projectId: project.id,
      chapterId: 'chapter-1',
      revisionCommitId: 'revision-commit-1',
      newChapterVersionId: 'revision-version-1',
      revisedAt: '2026-02-04T00:00:00.000Z',
      afterText: 'Revised archived body'
    })
  } catch (error) {
    revisionCommitBlocked = String(error).includes('归档章节')
  }
  assert(revisionCommitBlocked, 'revision commits require restoring an archived chapter first')

  const agentDataPath = join(outDir, 'agent-archive-data.json')
  await writeFile(agentDataPath, JSON.stringify(archived, null, 2), 'utf8')
  const archivedSummary = await agentTools.AgentToolService.callTool({
    name: 'agent.getArchivedChapters',
    arguments: { storagePath: agentDataPath, projectId: project.id }
  })
  assert(archivedSummary.data.chapters.length === 1, 'Agent Tool API can inspect archived chapters without reading the UI')
  const archivedDigest = await agentTools.AgentToolService.callTool({
    name: 'agent.getProjectDigest',
    arguments: { storagePath: agentDataPath, projectId: project.id }
  })
  assert(archivedDigest.data.nextChapterOrder === 2, 'Agent project digest does not reuse an archived chapter order')
  let unconfirmedRestoreBlocked = false
  try {
    await agentTools.AgentToolService.callTool({
      name: 'agent.restoreArchivedChapter',
      arguments: { storagePath: agentDataPath, userDataPath: outDir, projectId: project.id, chapterId: 'chapter-1' }
    })
  } catch (error) {
    unconfirmedRestoreBlocked = error?.code === 'AGENT_AUTHORIZATION_REQUIRED'
  }
  assert(unconfirmedRestoreBlocked, 'Agent restore requires explicit acknowledgement or a trusted project grant')
  await agentTools.AgentToolService.callTool({
    name: 'agent.restoreArchivedChapter',
    arguments: { storagePath: agentDataPath, projectId: project.id, chapterId: 'chapter-1', confirm: true }
  })
  const afterAgentRestore = await agentTools.AgentToolService.callTool({
    name: 'agent.getArchivedChapters',
    arguments: { storagePath: agentDataPath, projectId: project.id }
  })
  assert(afterAgentRestore.data.chapters.length === 0, 'Agent restore persists through the revision-protected storage path')
  await agentTools.AgentToolService.callTool({
    name: 'agent.archiveChapter',
    arguments: { storagePath: agentDataPath, projectId: project.id, chapterId: 'chapter-1', confirm: true }
  })
  const afterAgentArchive = await agentTools.AgentToolService.callTool({
    name: 'agent.getArchivedChapters',
    arguments: { storagePath: agentDataPath, projectId: project.id }
  })
  assert(afterAgentArchive.data.chapters.length === 1, 'Agent archive preserves UI/Agent lifecycle parity')

  const chaptersView = await source('src/renderer/src/views/ChaptersView.tsx')
  const chapterList = await source('src/renderer/src/views/chapters/ChapterListPanel.tsx')
  const editor = await source('src/renderer/src/views/chapters/ChapterEditorPanel.tsx')
  const promptBuilder = await source('src/services/PromptBuilderService.ts')
  const budgetManager = await source('src/services/ContextBudgetManager.ts')
  const agentRun = await source('src/agent/AgentRunService.ts')
  assert(chaptersView.includes('archiveChapterInAppData') && chaptersView.includes('restoreArchivedChapterInAppData'), 'chapter UI uses the shared archive/restore service')
  assert(chapterList.includes('已归档章节') && chapterList.includes('onRestoreChapter'), 'chapter list exposes a compact restore surface')
  assert(editor.includes('归档章节') && !editor.includes('删除章节'), 'destructive chapter deletion is replaced by reversible archive copy')
  assert(promptBuilder.includes('activeChapters(input.chapters)'), 'PromptBuilder excludes archived chapters')
  assert(budgetManager.includes('activeChapters(data.chapters)'), 'ContextBudgetManager excludes archived chapters')
  assert(agentRun.includes('isChapterArchived(existingChapter)'), 'Agent Runtime refuses to generate over an archived chapter')

  const runTests = await source('scripts/run-tests.mjs')
  assert(runTests.includes('validate-chapter-archive.mjs'), 'npm test includes chapter archive validation')

  console.log('Chapter archive validation passed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
