import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const outDir = join(repoRoot, 'tmp', 'renderer-save-consistency')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function loadTsModule(relativePath) {
  const source = await readFile(join(repoRoot, relativePath), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  })
  await mkdir(outDir, { recursive: true })
  const outputPath = join(outDir, relativePath.replace(/[\\/.:]/g, '-') + '.mjs')
  await writeFile(outputPath, compiled.outputText, 'utf8')
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`)
}

async function main() {
  const checks = []
  const { createSaveQueue } = await loadTsModule('src/renderer/src/utils/saveQueue.ts')
  const hookSource = await readFile(join(repoRoot, 'src/renderer/src/hooks/useAppData.ts'), 'utf8')
  const pipelineSource = await readFile(
    join(repoRoot, 'src/renderer/src/views/generation/usePipelineRunnerCore.ts'),
    'utf8'
  )
  const promptBuilderSource = [
    await readFile(join(repoRoot, 'src/renderer/src/views/PromptBuilderView.tsx'), 'utf8'),
    await readFile(
      join(repoRoot, 'src/renderer/src/views/promptBuilder/usePromptBuilderHistoryActions.ts'),
      'utf8'
    )
  ].join('\n')
  const promptSnapshotSource = await readFile(
    join(repoRoot, 'src/renderer/src/views/promptBuilder/promptBuilderSnapshotConsistency.ts'), 'utf8'
  )
  const settingsSource = [
    await readFile(join(repoRoot, 'src/renderer/src/views/SettingsView.tsx'), 'utf8'),
    await readFile(join(repoRoot, 'src/renderer/src/views/settings/useSettingsStorage.ts'), 'utf8'),
    await readFile(join(repoRoot, 'src/renderer/src/views/settings/useSettingsBackupAndLogs.ts'), 'utf8')
  ].join('\n')
  const revisionSource = [
    await readFile(join(repoRoot, 'src/renderer/src/views/RevisionStudioView.tsx'), 'utf8'),
    await readFile(
      join(repoRoot, 'src/renderer/src/views/revision/revisionVersionActions.ts'),
      'utf8'
    )
  ].join('\n')
  const appSource = await readFile(join(repoRoot, 'src/renderer/src/App.tsx'), 'utf8')
  const componentStyles = await readFile(join(repoRoot, 'src/renderer/src/styles/components.css'), 'utf8')

  let memory = { accepted: 0, later: 0 }
  let disk = { ...memory }
  const queue = createSaveQueue((operation) => operation())

  async function modeledSave(update, shouldFail = false) {
    try {
      await queue.enqueue(async () => {
        const next = update(memory)
        if (shouldFail) throw new Error('simulated persistence failure')
        disk = { ...next }
        memory = next
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) }
    }
  }

  const failedSave = modeledSave((current) => ({ ...current, accepted: current.accepted + 1 }), true)
  const laterSave = modeledSave((current) => ({ ...current, later: current.later + 1 }))
  const [failedOutcome, laterOutcome] = await Promise.all([failedSave, laterSave])
  checks.push(
    assert(
      !failedOutcome.ok && laterOutcome.ok && memory.accepted === 0 && disk.accepted === 0 && disk.later === 1,
      'failed queued writes do not leak optimistic state into later functional saves',
      { failedOutcome, laterOutcome, memory, disk }
    )
  )

  checks.push(
    assert(
      hookSource.includes('const [hasStorageConflict, setHasStorageConflict]') &&
        hookSource.includes('async function reloadData()') &&
        hookSource.includes("setStatus('正在重新加载最新本地数据...')") &&
        hookSource.includes('const loaded = await getNovelDirectorDataApi().load()') &&
        appSource.includes('StorageConflictNotice') &&
        appSource.includes('reloadAfterStorageConflict') &&
        appSource.includes('请先复制当前页面中尚未保存的重要文本') &&
        componentStyles.includes('.storage-conflict-notice'),
      'revision conflicts expose a confirmed, queued reload path without silently overwriting local edits'
    )
  )

  const saveDataStart = hookSource.indexOf('const saveData: SaveDataHandler')
  const saveDataEnd = hookSource.indexOf('async function saveGenerationRunBundle', saveDataStart)
  const saveDataBlock = hookSource.slice(saveDataStart, saveDataEnd)
  const persistenceIndex = saveDataBlock.indexOf('await getNovelDirectorDataApi().save(next)')
  const commitIndex = saveDataBlock.indexOf('commitPersistedData(next)')
  checks.push(
    assert(
      saveDataStart >= 0 && persistenceIndex >= 0 && commitIndex > persistenceIndex,
      'ordinary saveData commits renderer memory only after persistence succeeds',
      { persistenceIndex, commitIndex }
    )
  )
  checks.push(
    assert(
      saveDataBlock.includes('return { ok: false, errorMessage }') &&
        saveDataBlock.includes('return { ok: true }'),
      'ordinary saveData exposes an explicit success/failure outcome'
    )
  )
  checks.push(
    assert(
      hookSource.includes('const { next, bundle } = buildCommit(latestDataRef.current)') &&
        hookSource.includes('persisted = await dataApi.saveRevisionCommitBundle(bundle)') &&
        hookSource.includes('persisted = await dataApi.saveChapterCommitBundle(bundle)') &&
        !hookSource.includes('save failed; falling back to full AppData save'),
      'chapter and revision commits resolve current data inside the shared queue and never bypass a rejected bundle write with full save'
    )
  )
  checks.push(
    assert(
      pipelineSource.includes('if (!saved.ok) throw new Error(saved.errorMessage)') &&
        promptBuilderSource.includes('await persistPromptContextSnapshotAndSend(') &&
        promptBuilderSource.includes('if (!saved.ok) throw new Error(saved.errorMessage)') &&
        /const saved = await persistPromptContextSnapshot\(snapshot, saveData\)\s+if \(saved.ok\) \{\s+onPersisted\?\.\(\)\s+onSendToPipeline\?\.\(snapshot.id\)\s+\}/.test(promptSnapshotSource) &&
        settingsSource.includes('已取消迁移') &&
        revisionSource.includes('修订版本保存失败'),
      'high-risk workflows stop after an ordinary persistence failure'
    )
  )

  checks.push(
    assert(
      hookSource.includes('const runPersistedStorageOperation: RunPersistedStorageOperation') &&
        hookSource.includes('const persisted = await operation(current)') &&
        hookSource.includes('if (persisted.data) commitPersistedData(persisted.data)') &&
        settingsSource.includes('runPersistedStorageOperation(() => restoreBackupRequest(backup.path))') &&
        settingsSource.includes('(current) => migrateStoragePathRequest(targetPath, current, overwrite)') &&
        !settingsSource.includes('await replaceData(result.data, result.storagePath)'),
      'main-persisted restore and migration operations share the save queue without a redundant full save'
    )
  )

  const failed = checks.filter((check) => !check.ok)
  console.log(JSON.stringify({ ok: failed.length === 0, totalChecks: checks.length, failed }, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
