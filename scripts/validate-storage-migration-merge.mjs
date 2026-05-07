import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'storage-migration-merge-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

async function compileTsModule(relativePath, replacements = []) {
  let source = await read(relativePath)
  for (const [from, to] of replacements) source = source.replace(from, to)
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
  return outPath
}

async function loadTsModule(relativePath, replacements = []) {
  const outPath = await compileTsModule(relativePath, replacements)
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

function now() {
  return '2026-01-01T00:00:00.000Z'
}

function project(id, name) {
  return {
    id,
    name,
    genre: '悬疑',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: '',
    createdAt: now(),
    updatedAt: now()
  }
}

function chapter(id, projectId, order, title) {
  return {
    id,
    projectId,
    order,
    title,
    body: title,
    summary: '',
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '',
    riskWarnings: '',
    includedInStageSummary: false,
    createdAt: now(),
    updatedAt: now()
  }
}

function character(id, projectId, name) {
  return {
    id,
    projectId,
    name,
    role: '',
    surfaceGoal: '',
    deepDesire: '',
    coreFear: '',
    selfDeception: '',
    knownInformation: '',
    unknownInformation: '',
    protagonistRelationship: '',
    emotionalState: '',
    nextActionTendency: '',
    forbiddenWriting: '',
    lastChangedChapter: null,
    isMain: true,
    createdAt: now(),
    updatedAt: now()
  }
}

function stateLog(id, projectId, characterId, chapterId) {
  return {
    id,
    projectId,
    characterId,
    chapterId,
    chapterOrder: 1,
    note: '变化',
    createdAt: now()
  }
}

function minimalData(overrides = {}) {
  return {
    schemaVersion: 3,
    projects: [],
    storyBibles: [],
    chapters: [],
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
    settings: {
      apiProvider: 'openai',
      apiKey: '',
      hasApiKey: false,
      baseUrl: '',
      modelName: '',
      temperature: 0.8,
      maxTokens: 8000,
      enableAutoSummary: false,
      enableChapterDiagnostics: false,
      defaultTokenBudget: 16000,
      defaultPromptMode: 'standard',
      theme: 'system'
    },
    ...overrides
  }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const checks = []

  const channelsSource = await read('src/shared/ipc/ipcChannels.ts')
  const preloadSource = await read('src/preload/index.ts')
  const settingsSource = await read('src/renderer/src/views/SettingsView.tsx')
  const mainSource = await read('src/main/ipc/registerIpcHandlers.ts')

  checks.push(
    assert(
      channelsSource.includes('APP_CREATE_MIGRATION_MERGE_PREVIEW') &&
        channelsSource.includes('APP_CONFIRM_MIGRATION_MERGE'),
      'IPC channels include merge preview and confirm merge'
    )
  )
  checks.push(
    assert(
      preloadSource.includes('createMigrationMergePreview') &&
        preloadSource.includes('confirmMigrationMerge') &&
        !preloadSource.includes('fs.'),
      'preload exposes only whitelisted merge APIs and no fs access'
    )
  )
  checks.push(
    assert(
      settingsSource.includes('合并已有数据') &&
        settingsSource.includes('覆盖目标数据') &&
        settingsSource.includes('取消迁移') &&
        settingsSource.includes('mergePreview.canAutoMerge'),
      'settings migration UI offers merge / overwrite / cancel and gates unsafe merge'
    )
  )
  checks.push(
    assert(
      mainSource.includes('needsMerge: true') &&
        mainSource.includes('backupFileForOverwrite') &&
        mainSource.includes('createMigrationMergePreview(oldPath, targetPath)'),
      'migration handler returns merge preview and backs up overwrite target'
    )
  )

  const treatmentPath = await compileTsModule('src/shared/foreshadowingTreatment.ts')
  const defaultsPath = await compileTsModule('src/shared/defaults.ts', [
    ["from './foreshadowingTreatment'", `from '${pathToFileURL(treatmentPath).href}'`]
  ])
  const storagePath = await compileTsModule('src/storage/JsonStorageService.ts', [
    ["from '../shared/defaults'", `from '${pathToFileURL(defaultsPath).href}'`]
  ])
  const mergeModule = await loadTsModule('src/main/DataMergeService.ts', [
    ["from '../shared/defaults'", `from '${pathToFileURL(defaultsPath).href}'`],
    ["from '../storage/JsonStorageService'", `from '${pathToFileURL(storagePath).href}'`]
  ])

  const targetOnly = minimalData({ projects: [project('target-project', '目标项目')] })
  const sourceOnly = minimalData({
    projects: [project('source-project', '源项目')],
    chapters: [chapter('source-chapter', 'source-project', 1, '源章节')],
    characters: [character('source-character', 'source-project', '源角色')]
  })
  const noConflict = mergeModule.mergeAppData(sourceOnly, targetOnly, {
    sourcePath: 'source.json',
    targetPath: 'target.json'
  })
  checks.push(
    assert(
      noConflict.preview.canAutoMerge &&
        noConflict.mergedData.projects.length === 2 &&
        noConflict.mergedData.chapters.some((item) => item.projectId === 'source-project'),
      'no-conflict merge keeps target and appends source project data'
    )
  )

  const sameProject = minimalData({ projects: [project('same-project', '同一项目')] })
  const dedupe = mergeModule.mergeAppData(sameProject, sameProject, {
    sourcePath: 'source.json',
    targetPath: 'target.json'
  })
  checks.push(
    assert(
      dedupe.preview.canAutoMerge &&
        dedupe.mergedData.projects.length === 1 &&
        dedupe.preview.operations.some((operation) => operation.action === 'dedupe_same_id'),
      'same ID with same content is deduped'
    )
  )

  const targetConflictProject = minimalData({
    projects: [project('project-1', '目标同 ID 项目')],
    chapters: [chapter('chapter-target', 'project-1', 1, '目标章节')]
  })
  const sourceConflictProject = minimalData({
    projects: [project('project-1', '源同 ID 项目')],
    chapters: [chapter('chapter-source', 'project-1', 1, '源章节')],
    characters: [character('character-source', 'project-1', '源角色')],
    characterStateLogs: [stateLog('log-source', 'project-1', 'character-source', 'chapter-source')]
  })
  const projectConflict = mergeModule.mergeAppData(sourceConflictProject, targetConflictProject, {
    sourcePath: 'source.json',
    targetPath: 'target.json'
  })
  const importedProject = projectConflict.mergedData.projects.find(
    (item) => item.id !== 'project-1' && item.name.includes('导入副本')
  )
  const importedChapter = projectConflict.mergedData.chapters.find((item) => item.title === '源章节')
  const importedCharacter = projectConflict.mergedData.characters.find((item) => item.name === '源角色')
  const importedLog = projectConflict.mergedData.characterStateLogs.find((item) => item.note === '变化')
  checks.push(
    assert(
      projectConflict.preview.canAutoMerge &&
        importedProject &&
        importedChapter?.projectId === importedProject.id &&
        importedCharacter?.projectId === importedProject.id &&
        importedLog?.projectId === importedProject.id &&
        importedLog?.characterId === importedCharacter.id &&
        importedLog?.chapterId === importedChapter.id,
      'different project with same ID imports source as copy and remaps project/chapter/character references',
      { importedProject, importedChapter, importedCharacter, importedLog }
    )
  )

  const childConflictSource = minimalData({
    projects: [project('project-a', '项目 A')],
    characters: [character('character-1', 'project-a', '源角色')]
  })
  const childConflictTarget = minimalData({
    projects: [project('project-a', '项目 A')],
    characters: [character('character-1', 'project-a', '目标角色')]
  })
  const childConflict = mergeModule.mergeAppData(childConflictSource, childConflictTarget, {
    sourcePath: 'source.json',
    targetPath: 'target.json'
  })
  checks.push(
    assert(
      !childConflict.preview.canAutoMerge && childConflict.preview.conflicts.length > 0,
      'same child ID with different content and no safe remap is blocked as conflict'
    )
  )

  const sourcePath = join(outDir, 'source.json')
  const targetPath = join(outDir, 'target.json')
  await writeFile(sourcePath, JSON.stringify(sourceOnly, null, 2), 'utf-8')
  await writeFile(targetPath, JSON.stringify(targetOnly, null, 2), 'utf-8')
  const confirmed = await mergeModule.confirmMigrationMerge(sourcePath, targetPath)
  const mergedDisk = JSON.parse(await readFile(targetPath, 'utf-8'))
  checks.push(
    assert(
      (await exists(confirmed.sourceBackupPath)) &&
        (await exists(confirmed.targetBackupPath)) &&
        mergedDisk.projects.length === 2,
      'confirm merge creates source/target backups and writes merged data atomically'
    )
  )

  const overwriteTarget = join(outDir, 'overwrite-target.json')
  await writeFile(overwriteTarget, JSON.stringify(targetOnly, null, 2), 'utf-8')
  const overwriteBackup = await mergeModule.backupFileForOverwrite(overwriteTarget)
  checks.push(assert(await exists(overwriteBackup), 'overwrite path creates a target backup before replacing data'))

  const conflictSourcePath = join(outDir, 'conflict-source.json')
  const conflictTargetPath = join(outDir, 'conflict-target.json')
  await writeFile(conflictSourcePath, JSON.stringify(childConflictSource, null, 2), 'utf-8')
  await writeFile(conflictTargetPath, JSON.stringify(childConflictTarget, null, 2), 'utf-8')
  const beforeConflictTarget = await readFile(conflictTargetPath, 'utf-8')
  let conflictBlocked = false
  try {
    await mergeModule.confirmMigrationMerge(conflictSourcePath, conflictTargetPath)
  } catch {
    conflictBlocked = true
  }
  const afterConflictTarget = await readFile(conflictTargetPath, 'utf-8')
  checks.push(
    assert(
      conflictBlocked && beforeConflictTarget === afterConflictTarget,
      'canAutoMerge=false confirm merge is blocked and does not change source/target files'
    )
  )

  const oldVersionMerge = mergeModule.mergeAppData({ projects: [project('old-project', '旧数据项目')] }, targetOnly, {
    sourcePath: 'old-source.json',
    targetPath: 'target.json'
  })
  checks.push(
    assert(
      oldVersionMerge.preview.canAutoMerge && oldVersionMerge.mergedData.projects.some((item) => item.id === 'old-project'),
      'old/incomplete data is normalized before merge'
    )
  )

  const allIds = []
  for (const collection of ['projects', 'chapters', 'characters', 'characterStateLogs']) {
    for (const item of projectConflict.mergedData[collection]) if (item.id) allIds.push(item.id)
  }
  checks.push(assert(new Set(allIds).size === allIds.length, 'merged data does not contain duplicate IDs in primary collections'))

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
