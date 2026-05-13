import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'p0-stability-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function loadTsModule(relativePath, replacements = []) {
  const sourcePath = join(root, relativePath)
  let source = await readFile(sourcePath, 'utf-8')
  for (const [from, to] of replacements) {
    source = source.replace(from, to)
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: true
    }
  })
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `${relativePath.replace(/[\\/.:]/g, '-')}.mjs`)
  await writeFile(outPath, compiled.outputText, 'utf-8')
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function main() {
  const checks = []
  const { createSaveQueue } = await loadTsModule('src/renderer/src/utils/saveQueue.ts')
  const { resolveSaveDataInput } = await loadTsModule('src/renderer/src/utils/saveDataState.ts')
  const { tryAcquirePipelineRunLock, releasePipelineRunLock } = await loadTsModule(
    'src/renderer/src/utils/pipelineRunLock.ts'
  )
  const { createChapterVersionBeforeAcceptDraft } = await loadTsModule('src/renderer/src/utils/draftAcceptance.ts', [
    ["import { newId } from './format'", "const newId = () => 'history-id'"]
  ])
  const pipelineSource = await readFile(join(root, 'src', 'renderer', 'src', 'views', 'GenerationPipelineView.tsx'), 'utf-8')
  const pipelineRunnerFacadeSource = await readFile(
    join(root, 'src', 'renderer', 'src', 'views', 'generation', 'usePipelineRunner.ts'),
    'utf-8'
  )
  const pipelineRunnerCoreSource = await readFile(
    join(root, 'src', 'renderer', 'src', 'views', 'generation', 'usePipelineRunnerCore.ts'),
    'utf-8'
  )
  const pipelineRunnerSource = `${pipelineRunnerFacadeSource}\n${pipelineRunnerCoreSource}`
  const pipelineTopStatusSource = await readFile(
    join(root, 'src', 'renderer', 'src', 'components', 'pipeline', 'PipelineTopStatusBar.tsx'),
    'utf-8'
  )
  const pipelineConfigPanelSource = await readFile(
    join(root, 'src', 'renderer', 'src', 'components', 'pipeline', 'PipelineConfigPanel.tsx'),
    'utf-8'
  )
  const draftAcceptanceSource = await readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'useDraftAcceptance.ts'), 'utf-8')

  const events = []
  let diskValue = 0
  const queue = createSaveQueue(async (next) => {
    events.push(`start-${next.version}`)
    await delay(next.delay)
    diskValue = next.version
    events.push(`end-${next.version}`)
    return { storagePath: `path-${next.version}` }
  })
  const saveResults = await Promise.all([
    queue.enqueue({ version: 1, delay: 25 }),
    queue.enqueue({ version: 2, delay: 0 }),
    queue.enqueue({ version: 3, delay: 0 })
  ])
  checks.push(
    assert(
      events.join('|') === 'start-1|end-1|start-2|end-2|start-3|end-3' && diskValue === 3,
      '连续 saveData 会按调用顺序落盘，最终保留最新数据',
      { events, diskValue, saveResults }
    )
  )

  const baseData = {
    projects: [],
    chapters: [],
    chapterVersions: [],
    characterStateLogs: [],
    chapterGenerationJobs: []
  }
  let latestData = baseData
  const saveModel = (input) => {
    latestData = resolveSaveDataInput(latestData, input)
    return latestData
  }
  saveModel({ ...baseData, projects: [{ id: 'project-old-style' }] })
  checks.push(
    assert(
      latestData.projects.some((project) => project.id === 'project-old-style'),
      'saveData(nextData) legacy usage still works'
    )
  )
  saveModel((current) => ({ ...current, chapters: [...current.chapters, { id: 'chapter-functional-1' }] }))
  saveModel((current) => ({ ...current, chapterVersions: [...current.chapterVersions, { id: 'version-functional-1' }] }))
  checks.push(
    assert(
      latestData.chapters.some((chapter) => chapter.id === 'chapter-functional-1') &&
        latestData.chapterVersions.some((version) => version.id === 'version-functional-1'),
      'two functional saveData updates preserve both changes',
      latestData
    )
  )
  const stalePipelineSnapshot = { ...baseData, chapterGenerationJobs: [{ id: 'job-from-stale-snapshot' }] }
  let interleavedData = baseData
  interleavedData = resolveSaveDataInput(interleavedData, (current) => ({
    ...current,
    chapterVersions: [...current.chapterVersions, { id: 'version-created-concurrently' }],
    characterStateLogs: [...current.characterStateLogs, { id: 'log-created-concurrently' }]
  }))
  interleavedData = resolveSaveDataInput(interleavedData, (current) => ({
    ...current,
    chapterGenerationJobs: stalePipelineSnapshot.chapterGenerationJobs,
    chapterVersions: current.chapterVersions,
    characterStateLogs: current.characterStateLogs
  }))
  checks.push(
    assert(
      interleavedData.chapterGenerationJobs.some((job) => job.id === 'job-from-stale-snapshot') &&
        interleavedData.chapterVersions.some((version) => version.id === 'version-created-concurrently') &&
        interleavedData.characterStateLogs.some((log) => log.id === 'log-created-concurrently'),
      'functional high-risk write based on stale snapshot preserves concurrent fields',
      interleavedData
    )
  )

  const lock = { current: false }
  const firstAcquire = tryAcquirePipelineRunLock(lock)
  const duplicateAcquire = tryAcquirePipelineRunLock(lock)
  releasePipelineRunLock(lock)
  const afterReleaseAcquire = tryAcquirePipelineRunLock(lock)
  checks.push(
    assert(
      firstAcquire === true && duplicateAcquire === false && afterReleaseAcquire === true,
      '流水线运行锁会阻止重复启动，并可在结束后释放',
      { firstAcquire, duplicateAcquire, afterReleaseAcquire, lock }
    )
  )

  const existingChapter = {
    id: 'chapter-1',
    projectId: 'project-1',
    order: 1,
    title: '旧标题',
    body: '旧正文',
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
  const history = createChapterVersionBeforeAcceptDraft(existingChapter, 'project-1', 't1')
  checks.push(
    assert(
      history.source === 'before_accept_draft' &&
        history.chapterId === existingChapter.id &&
        history.title === existingChapter.title &&
        history.body === existingChapter.body &&
        history.createdAt === 't1',
      '接受草稿覆盖已有章节前会生成旧正文历史版本',
      history
    )
  )

  checks.push(
    assert(
      pipelineRunnerSource.includes('tryAcquirePipelineRunLock') &&
        pipelineRunnerSource.includes('releasePipelineRunLock') &&
        (pipelineSource.includes('disabled={isPipelineRunning}') ||
          pipelineTopStatusSource.includes('disabled={isRunning') ||
          pipelineConfigPanelSource.includes('disabled={isRunning')) &&
        pipelineRunnerSource.includes('setPipelineMessage'),
      'GenerationPipelineView 使用运行锁并禁用开始按钮'
    )
  )

  checks.push(
    assert(
      draftAcceptanceSource.includes('buildAcceptedDraftCommitBundle') &&
        draftAcceptanceSource.includes('applyChapterCommitBundleToAppData') &&
        draftAcceptanceSource.includes('saveChapterCommitBundle(buildCommit)') &&
        pipelineSource.includes('draftAcceptance.acceptDraft'),
      'acceptDraft 覆盖已有章节时会写入 chapterVersions'
    )
  )

  checks.push(
    assert(
      pipelineRunnerSource.includes('saveGenerationRunBundle') &&
        pipelineRunnerSource.includes('buildGenerationRunBundle') &&
        pipelineRunnerSource.includes('applyGenerationRunBundleToAppData'),
      'pipeline step persistence is merged through functional saveData and GenerationRunBundle'
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
