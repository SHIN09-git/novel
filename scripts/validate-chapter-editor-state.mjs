import { mkdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const outDir = join(repoRoot, 'tmp', 'chapter-editor-state-validation')

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
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8')
}

function chapter(id, order, projectId = 'project-1') {
  return {
    id,
    projectId,
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
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const model = await bundle(
    'src/renderer/src/views/chapters/chapterBodyDraftModel.ts',
    'chapter-body-draft-model.mjs'
  )
  const lifecycle = await bundle('src/services/ChapterLifecycleService.ts', 'chapter-lifecycle.mjs')

  assert(
    model.decideChapterBodySync({ incomingBody: 'new', baseBody: 'old', draftBody: 'old', dirty: false }) === 'adopt-external',
    'clean editor adopts an externally updated body'
  )
  assert(
    model.decideChapterBodySync({ incomingBody: 'old', baseBody: 'old', draftBody: 'local', dirty: true }) === 'unchanged',
    'local draft stays active while persisted body still matches its base'
  )
  assert(
    model.decideChapterBodySync({ incomingBody: 'local', baseBody: 'old', draftBody: 'local', dirty: true }) === 'acknowledge-save',
    'matching persisted body acknowledges the local save'
  )
  assert(
    model.decideChapterBodySync({ incomingBody: 'external', baseBody: 'old', draftBody: 'local', dirty: true }) === 'conflict',
    'divergent local and external bodies produce an explicit conflict'
  )

  const timestamp = '2026-02-01T00:00:00.000Z'
  const appData = {
    projects: [
      { id: 'project-1', updatedAt: 'old' },
      { id: 'project-2', updatedAt: 'other' }
    ],
    chapters: [chapter('chapter-1', 1), chapter('chapter-2', 2), chapter('other-chapter', 2, 'project-2')],
    chapterContinuityBridges: [
      { id: 'bridge-1', fromChapterId: 'chapter-1', toChapterOrder: 2, updatedAt: 'old' },
      { id: 'bridge-2', fromChapterId: 'chapter-2', toChapterOrder: 3, updatedAt: 'old' }
    ]
  }
  const reordered = lifecycle.reorderChapterInAppData(appData, 'chapter-1', 2, timestamp)
  assert(reordered.chapters.find((item) => item.id === 'chapter-1').order === 2, 'requested chapter receives the target order')
  assert(reordered.chapters.find((item) => item.id === 'chapter-2').order === 1, 'occupied order swaps instead of creating a duplicate')
  assert(reordered.chapters.find((item) => item.id === 'other-chapter').order === 2, 'reorder does not affect another project')
  assert(reordered.chapterContinuityBridges.find((item) => item.id === 'bridge-1').toChapterOrder === 3, 'source bridge follows the reordered chapter')
  assert(reordered.chapterContinuityBridges.find((item) => item.id === 'bridge-2').toChapterOrder === 2, 'swapped chapter bridge follows its new order')

  const chaptersView = read('src/renderer/src/views/ChaptersView.tsx')
  const bodyHook = read('src/renderer/src/views/chapters/useChapterBodyDraft.ts')
  const aiHook = read('src/renderer/src/views/chapters/useChapterAiDrafts.ts')
  const editor = read('src/renderer/src/views/chapters/ChapterEditorPanel.tsx')
  assert(chaptersView.includes('useChapterBodyDraft') && chaptersView.includes('useChapterAiDrafts'), 'chapter view delegates persistence and AI coordination')
  assert(chaptersView.includes('if (!(await flushBody())) return'), 'chapter-changing actions flush the active body first')
  assert(bodyHook.includes('currentChapter.body !== expectedBaseBody'), 'body save uses compare-before-write conflict protection')
  assert(bodyHook.includes("setSaveStatus('conflict')"), 'body conflict pauses normal autosave')
  assert(aiHook.includes('actionTokenRef') && aiHook.includes('selectedIdRef.current !== chapterId'), 'late AI responses cannot populate another chapter')
  assert(editor.includes('正文出现版本冲突') && editor.includes('保留本地并覆盖'), 'authors receive explicit conflict choices')
  assert(editor.includes('chapter-body-save-state'), 'chapter editor exposes a stable save-state indicator')

  const runTests = read('scripts/run-tests.mjs')
  assert(runTests.includes('validate-chapter-editor-state.mjs'), 'npm test includes chapter editor state validation')
  console.log('Chapter editor state validation passed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
