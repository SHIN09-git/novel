import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
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
  const pipelineDraftPanelSource = await readFile(
    join(root, 'src', 'renderer', 'src', 'components', 'pipeline', 'PipelineDraftPanel.tsx'),
    'utf-8'
  )
  const pipelineStepRailSource = await readFile(
    join(root, 'src', 'renderer', 'src', 'components', 'pipeline', 'PipelineStepRail.tsx'),
    'utf-8'
  )
  const pipelineMemoryPanelSource = await readFile(
    join(root, 'src', 'renderer', 'src', 'components', 'pipeline', 'PipelineMemoryCandidatesPanel.tsx'),
    'utf-8'
  )
  const pipelineUtilsSource = [
    await readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'pipelineUtils.ts'), 'utf-8'),
    await readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'pipelineStepDefinitions.ts'), 'utf-8')
  ].join('\n')
  const pipelineRevisionActionsSource = [
    await readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'usePipelineRevisionActions.ts'), 'utf-8'),
    await readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'pipelineRevisionActionHandlers.ts'), 'utf-8')
  ].join('\n')
  const draftAcceptanceSource = await readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'useDraftAcceptance.ts'), 'utf-8')
  const useAppDataSource = await readFile(join(root, 'src', 'renderer', 'src', 'hooks', 'useAppData.ts'), 'utf-8')
  const homeViewSource = await readFile(join(root, 'src', 'renderer', 'src', 'views', 'HomeView.tsx'), 'utf-8')
  const settingsViewSource = [
    await readFile(join(root, 'src', 'renderer', 'src', 'views', 'SettingsView.tsx'), 'utf-8'),
    await readFile(
      join(root, 'src', 'renderer', 'src', 'views', 'settings', 'useSettingsStorage.ts'),
      'utf-8'
    ),
    await readFile(
      join(root, 'src', 'renderer', 'src', 'views', 'settings', 'useSettingsBackupAndLogs.ts'),
      'utf-8'
    )
  ].join('\n')

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

  checks.push(
    assert(
      pipelineRunnerCoreSource.match(/tryAcquirePipelineRunLock/g)?.length >= 3 &&
        pipelineRunnerCoreSource.includes("currentStep.status !== 'failed'") &&
        pipelineRunnerCoreSource.includes('canSkipPipelineStep(currentStep.type)') &&
        pipelineRunnerCoreSource.includes('await runPipelineFromStep(working, job.id, nextStepType, options)') &&
        pipelineUtilsSource.includes("'generate_chapter_review'") &&
        pipelineUtilsSource.includes("'consistency_review'"),
      'retry and optional-step skip share the pipeline run lock, while skip resumes the next step'
    )
  )

  checks.push(
    assert(
      pipelineDraftPanelSource.includes("disabled={isRunning || draft.status !== 'draft'}") &&
        pipelineStepRailSource.includes('disabled={isRunning}') &&
        pipelineMemoryPanelSource.includes('disabled={disabled}') &&
        pipelineSource.includes('disabled: isPipelineRunning'),
      'draft decisions, step controls, and memory candidate writes are disabled while a pipeline is running'
    )
  )

  checks.push(
    assert(
      pipelineRevisionActionsSource.includes('async function startDraftRevision') &&
        pipelineRevisionActionsSource.includes("type: 'custom'") &&
        pipelineSource.includes('revisionActions.startDraftRevision'),
      'generated drafts expose a working revision entry that creates a revision session before navigation'
    )
  )

  const replaceEvents = []
  let replaceDiskValue = ''
  const replaceQueue = createSaveQueue(async (next) => {
    replaceEvents.push(`start-${next.name}`)
    await delay(next.delay)
    replaceDiskValue = next.name
    replaceEvents.push(`end-${next.name}`)
    return { storagePath: `path-${next.name}` }
  })
  const staleSave = replaceQueue.enqueue({ name: 'stale-full-save', delay: 25 })
  const replacementSave = replaceQueue.enqueue({ name: 'imported-replacement', delay: 0 })
  await Promise.all([staleSave, replacementSave])
  checks.push(
    assert(
      replaceEvents.join('|') ===
        'start-stale-full-save|end-stale-full-save|start-imported-replacement|end-imported-replacement' &&
        replaceDiskValue === 'imported-replacement',
      '已持久化的数据替换操作会排在旧保存之后，避免旧 AppData 反向覆盖新数据',
      { replaceEvents, replaceDiskValue }
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

  checks.push(
    assert(
      /const runPersistedStorageOperation: RunPersistedStorageOperation/.test(useAppDataSource) &&
        /const persisted = await operation\(current\)[\s\S]*?if \(persisted\.data\) commitPersistedData\(persisted\.data\)/.test(
          useAppDataSource
        ) &&
        useAppDataSource.includes('return saveQueueRef.current.enqueue(operation)'),
      'already-persisted operations share the renderer queue and adopt returned data without a second full save'
    )
  )

  checks.push(
    assert(
      useAppDataSource.includes("import { getNovelDirectorDataApi } from '../platform/novelDirectorBridge'") &&
        !/const bridge = window\.novelDirector/.test(useAppDataSource),
      'useAppData reads preload data APIs through the guarded bridge accessor'
    )
  )

  checks.push(
    assert(
      /function getCurrentData\(\): AppData\s*\{\s*return latestDataRef\.current\s*\}/.test(useAppDataSource) &&
        /getCurrentData: \(\) => AppData/.test(settingsViewSource),
      'SettingsView can read the latest AppData ref after queued saves flush'
    )
  )

  checks.push(
    assert(
      settingsViewSource.includes('await exportAppData(options.getCurrentData())') &&
        settingsViewSource.includes('(current) => migrateStoragePathRequest(targetPath, current, overwrite)') &&
        settingsViewSource.includes('(current) => resetStoragePathRequest(current, false)') &&
        settingsViewSource.includes('{ persistCurrentFirst: true }') &&
        !settingsViewSource.includes('await exportAppData(data)') &&
        !settingsViewSource.includes('await migrateStoragePathRequest(targetPath, data, overwrite)') &&
        !settingsViewSource.includes('await resetStoragePathRequest(data, false)'),
      'settings export/migration/reset use latest AppData and serialize migration with ordinary saves'
    )
  )

  checks.push(
    assert(
      homeViewSource.includes('await importData(strategy)') && !homeViewSource.includes('replaceData'),
      'importing existing data adopts the queued IPC result without a second full save'
    )
  )

  checks.push(
    assert(
      settingsViewSource.includes('runPersistedStorageOperation(() => restoreBackupRequest(backup.path))') &&
        settingsViewSource.includes('runPersistedStorageOperation(() =>') &&
        settingsViewSource.includes('confirmMigrationMergeRequest(mergeSourcePath, mergeTargetPath)') &&
        !settingsViewSource.includes('await replaceData(result.data, result.storagePath)'),
      'backup restore and migration merge adopt main-process results without redundant renderer persistence'
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
