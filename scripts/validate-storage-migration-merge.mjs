import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'storage-migration-merge-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

async function bundleTsModule(relativePath, outfileName) {
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, outfileName)
  await build({
    entryPoints: [join(root, relativePath)],
    outfile: outPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3'],
    logLevel: 'silent'
  })
  return outPath
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

function contextNeedPlan(id, projectId, characterId) {
  return {
    id,
    projectId,
    targetChapterOrder: 2,
    source: 'generation_pipeline',
    chapterIntent: '需要源角色',
    expectedSceneType: 'custom',
    expectedCharacters: [
      { characterId, roleInChapter: 'protagonist', expectedPresence: 'onstage', reason: '出场' }
    ],
    requiredCharacterCardFields: { [characterId]: ['surfaceGoal'] },
    requiredStateFactCategories: { [characterId]: ['physical'] },
    requiredForeshadowingIds: [],
    forbiddenForeshadowingIds: [],
    requiredTimelineEventIds: [],
    requiredWorldbuildingKeys: [],
    mustCheckContinuity: ['injury'],
    retrievalPriorities: [
      { type: 'character_card', id: characterId, priority: 90, reason: '测试角色引用映射' }
    ],
    exclusionRules: [],
    contextNeeds: [
      {
        id: `need-item-${id}`,
        needType: 'character_hard_state',
        sourceHint: 'character',
        sourceId: characterId,
        priority: 'must',
        reason: '测试需求来源映射',
        uncertain: false
      }
    ],
    warnings: [],
    createdAt: now(),
    updatedAt: now()
  }
}

function contextBudgetProfile(id, projectId) {
  return {
    id,
    projectId,
    name: '测试预算',
    maxTokens: 16000,
    mode: 'standard',
    includeRecentChaptersCount: 3,
    includeStageSummariesCount: 2,
    includeMainCharacters: true,
    includeRelatedCharacters: true,
    includeForeshadowingWeights: ['high'],
    includeTimelineEventsCount: 5,
    styleSampleMaxChars: 1200,
    createdAt: now(),
    updatedAt: now()
  }
}

function contextSelection(characterId) {
  return {
    selectedStoryBibleFields: [],
    selectedChapterIds: [],
    selectedStageSummaryIds: [],
    selectedCharacterIds: [characterId],
    selectedForeshadowingIds: [],
    selectedTimelineEventIds: [],
    estimatedTokens: 100,
    omittedItems: [],
    compressionRecords: [],
    contextSelectionTrace: null,
    warnings: []
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
    characterStateFacts: [],
    characterStateTransactions: [],
    characterStateChangeCandidates: [],
    foreshadowings: [],
    timelineEvents: [],
    stageSummaries: [],
    promptVersions: [],
    promptContextSnapshots: [],
    storyDirectionGuides: [],
    hardCanonPacks: [],
    contextNeedPlans: [],
    chapterContinuityBridges: [],
    chapterGenerationJobs: [],
    chapterGenerationSteps: [],
    generatedChapterDrafts: [],
    memoryUpdateCandidates: [],
    consistencyReviewReports: [],
    contextBudgetProfiles: [],
    qualityGateReports: [],
    generationRunTraces: [],
    runTraceAuthorSummaries: [],
    redundancyReports: [],
    revisionCandidates: [],
    revisionSessions: [],
    revisionRequests: [],
    revisionVersions: [],
    chapterVersions: [],
    chapterCommitBundles: [],
    revisionCommitBundles: [],
    agentRuns: [],
    agentActionPreviews: [],
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
  const settingsSource = [
    await read('src/renderer/src/views/SettingsView.tsx'),
    await read('src/renderer/src/views/settings/SettingsDataPanels.tsx'),
    await read('src/renderer/src/views/settings/useSettingsStorage.ts')
  ].join('\n')
  const mainSource = await read('src/main/ipc/registerIpcHandlers.ts')
  const storageManagementSource = await read('src/main/ipc/storageManagementIpcHandlers.ts')
  const storageOpsSource = await read('src/main/ipc/storageDataOperations.ts')
  const appDataTypesSource = await read('src/shared/types/appData.ts')
  const appDataCollectionsSource = await read('src/shared/appDataCollections.ts')

  const appDataBody = appDataTypesSource.match(/export interface AppData \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const appDataArrayKeys = [...appDataBody.matchAll(/^\s*(\w+):\s*\w+(?:<[^>]+>)?\[\]/gm)].map((match) => match[1])
  const projectScopedBody = appDataCollectionsSource.match(/const PROJECT_SCOPED_COLLECTIONS = \[([\s\S]*?)\] as const/)?.[1] ?? ''
  const dependentBody = appDataCollectionsSource.match(/const DEPENDENT_COLLECTIONS = \[([\s\S]*?)\] as const/)?.[1] ?? ''
  const mergeCollectionKeys = new Set([
    'projects',
    ...[...projectScopedBody.matchAll(/'([^']+)'/g)].map((match) => match[1]),
    ...[...dependentBody.matchAll(/'([^']+)'/g)].map((match) => match[1])
  ])
  const missingMergeCollections = appDataArrayKeys.filter((key) => !mergeCollectionKeys.has(key))

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
      storageOpsSource.includes('needsMerge: true') &&
        storageOpsSource.includes('backupFileForOverwrite') &&
        storageOpsSource.includes('createMigrationMergePreview(oldPath, targetPath)'),
      'migration handler returns merge preview and backs up overwrite target'
    )
  )
  checks.push(
    assert(
      mainSource.includes('registerStorageManagementIpcHandlers(context)') &&
        storageManagementSource.includes('APP_MIGRATE_STORAGE_PATH') &&
        storageManagementSource.includes('APP_CONFIRM_MIGRATION_MERGE') &&
        storageManagementSource.includes('APP_OPEN_STORAGE_FOLDER'),
      'main IPC delegates validated storage path management to a dedicated handler module'
    )
  )
  checks.push(
    assert(
      missingMergeCollections.length === 0,
      'DataMergeService covers every AppData array collection',
      { missingMergeCollections, appDataArrayKeys, mergeCollectionKeys: [...mergeCollectionKeys].sort() }
    )
  )

  const mergeModulePath = await bundleTsModule('src/main/DataMergeService.ts', 'data-merge.mjs')
  const mergeModule = await import(`${pathToFileURL(mergeModulePath).href}?t=${Date.now()}`)

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

  const generatedHardCanonSource = minimalData({
    projects: [project('canon-project', '硬设定项目')],
    hardCanonPacks: [
      {
        id: 'hard-canon-pack-canon-project',
        projectId: 'canon-project',
        title: '不可违背设定包',
        description: '自动生成的空硬设定包',
        items: [],
        maxPromptTokens: 900,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        schemaVersion: 1
      }
    ]
  })
  const generatedHardCanonTarget = minimalData({
    projects: [{ ...generatedHardCanonSource.projects[0] }],
    hardCanonPacks: [
      {
        id: 'hard-canon-pack-canon-project',
        projectId: 'canon-project',
        title: '不可违背设定包',
        description: '自动生成的空硬设定包',
        items: [],
        maxPromptTokens: 900,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        schemaVersion: 1
      }
    ]
  })
  const hardCanonTimestampDedupe = mergeModule.mergeAppData(generatedHardCanonSource, generatedHardCanonTarget, {
    sourcePath: 'source.json',
    targetPath: 'target.json'
  })
  checks.push(
    assert(
      hardCanonTimestampDedupe.preview.canAutoMerge &&
        hardCanonTimestampDedupe.mergedData.hardCanonPacks.filter((pack) => pack.id === 'hard-canon-pack-canon-project').length === 1 &&
        hardCanonTimestampDedupe.preview.operations.some(
          (operation) => operation.action === 'dedupe_same_id' && String(operation.collection).includes('硬设定')
        ),
      'generated empty HardCanonPack timestamp differences are deduped'
    )
  )

  const targetConflictProject = minimalData({
    projects: [project('project-1', '目标同 ID 项目')],
    chapters: [chapter('chapter-target', 'project-1', 1, '目标章节')]
  })
  const sourceNeedPlan = contextNeedPlan('need-source', 'project-1', 'character-source')
  const sourceBudgetProfile = contextBudgetProfile('budget-source', 'project-1')
  const sourceChapterVersion = {
    id: 'version-source',
    projectId: 'project-1',
    chapterId: 'chapter-source',
    title: '源版本',
    body: '修订后',
    note: '',
    source: 'manual_revision',
    createdAt: now()
  }
  const sourceRevisionSession = {
    id: 'session-source',
    projectId: 'project-1',
    chapterId: 'chapter-source',
    sourceDraftId: null,
    status: 'completed',
    createdAt: now(),
    updatedAt: now()
  }
  const sourceRevisionVersion = {
    id: 'revision-version-source',
    sessionId: 'session-source',
    requestId: 'revision-request-source',
    title: '源修订版本',
    body: '修订后',
    changedSummary: '',
    risks: '',
    preservedFacts: '',
    status: 'accepted',
    createdAt: now(),
    updatedAt: now()
  }
  const sourceConflictProject = minimalData({
    projects: [project('project-1', '源同 ID 项目')],
    chapters: [chapter('chapter-source', 'project-1', 1, '源章节')],
    characters: [character('character-source', 'project-1', '源角色')],
    characterStateLogs: [stateLog('log-source', 'project-1', 'character-source', 'chapter-source')],
    storyDirectionGuides: [
      {
        id: 'direction-source',
        projectId: 'project-1',
        title: '后续方向',
        status: 'active',
        source: 'ai_generated',
        horizonChapters: 5,
        startChapterOrder: 2,
        endChapterOrder: 6,
        userRawIdea: '',
        userPolishedIdea: '',
        aiGuidance: '推进源项目剧情',
        strategicTheme: '',
        coreDramaticPromise: '',
        emotionalCurve: '',
        characterArcDirectives: '',
        foreshadowingDirectives: '',
        constraints: '',
        forbiddenTurns: '',
        chapterBeats: [],
        generatedFromStageSummaryIds: [],
        generatedFromChapterIds: ['chapter-source'],
        warnings: [],
        createdAt: now(),
        updatedAt: now()
      }
    ],
    promptContextSnapshots: [
      {
        id: 'snapshot-source',
        projectId: 'project-1',
        targetChapterOrder: 2,
        mode: 'standard',
        budgetProfileId: 'budget-source',
        budgetProfile: sourceBudgetProfile,
        contextSelectionResult: contextSelection('character-source'),
        selectedCharacterIds: ['character-source'],
        selectedForeshadowingIds: [],
        foreshadowingTreatmentOverrides: {},
        chapterTask: {
          goal: '继续源项目',
          conflict: '',
          suspenseToKeep: '',
          allowedPayoffs: '',
          forbiddenPayoffs: '',
          endingHook: '',
          readerEmotion: '',
          targetWordCount: '3000-5000',
          styleRequirement: ''
        },
        contextNeedPlan: sourceNeedPlan,
        storyDirectionGuide: null,
        finalPrompt: '源 Prompt',
        estimatedTokens: 100,
        source: 'manual',
        note: '',
        createdAt: now(),
        updatedAt: now()
      }
    ],
    hardCanonPacks: [
      {
        id: 'hard-source',
        projectId: 'project-1',
        title: '硬设定',
        items: [],
        maxPromptTokens: 900,
        createdAt: now(),
        updatedAt: now(),
        schemaVersion: 1
      }
    ],
    contextNeedPlans: [sourceNeedPlan],
    contextBudgetProfiles: [sourceBudgetProfile],
    runTraceAuthorSummaries: [
      {
        id: 'summary-source',
        projectId: 'project-1',
        chapterId: 'chapter-source',
        createdAt: now(),
        summaryVersion: 1,
        overallStatus: 'good',
        oneLineDiagnosis: '源摘要',
        likelyProblemSources: [],
        nextActions: [],
        sourceRefs: {}
      }
    ],
    chapterCommitBundles: [
      {
        id: 'chapter-commit-source',
        commitId: 'chapter-commit-source',
        schemaVersion: 1,
        projectId: 'project-1',
        chapterId: 'chapter-source',
        acceptedAt: now(),
        acceptedBy: 'user',
        chapter: chapter('chapter-source', 'project-1', 1, '源章节')
      }
    ],
    revisionSessions: [sourceRevisionSession],
    chapterVersions: [sourceChapterVersion],
    revisionCommitBundles: [
      {
        id: 'revision-commit-source',
        revisionCommitId: 'revision-commit-source',
        schemaVersion: 1,
        projectId: 'project-1',
        chapterId: 'chapter-source',
        newChapterVersionId: 'version-source',
        revisionSessionId: 'session-source',
        revisionVersionId: 'revision-version-source',
        revisedAt: now(),
        revisedBy: 'user',
        afterText: '修订后',
        chapter: chapter('chapter-source', 'project-1', 1, '源章节'),
        chapterVersion: sourceChapterVersion,
        revisionSession: sourceRevisionSession,
        revisionVersion: sourceRevisionVersion
      }
    ],
    revisionRequests: [
      {
        id: 'revision-request-source',
        sessionId: 'session-source',
        type: 'rewrite_section',
        targetRange: '',
        instruction: '修订',
        createdAt: now()
      }
    ],
    revisionVersions: [sourceRevisionVersion],
    agentRuns: [
      {
        id: 'agent-run-source',
        projectId: 'project-1',
        goal: '继续写',
        mode: 'single_chapter',
        safetyMode: 'autonomous',
        targetChapterOrders: [2],
        status: 'completed',
        createdJobIds: [],
        createdDraftIds: [],
        createdCommitIds: [],
        pendingHumanReviewItemIds: [],
        decisions: [],
        summary: '',
        warnings: [],
        startedAt: now(),
        updatedAt: now(),
        schemaVersion: 1
      }
    ],
    agentActionPreviews: [
      {
        id: 'agent-preview-source',
        agentRunId: 'agent-run-source',
        projectId: 'project-1',
        chapterId: 'chapter-source',
        actionType: 'chapter_commit',
        status: 'pending',
        summary: '预览',
        riskLevel: 'low',
        diffSummary: [],
        affectedIds: ['chapter-source'],
        requiresHumanApproval: true,
        recommendation: 'accept',
        reason: '',
        evidence: [],
        createdAt: now(),
        updatedAt: now(),
        schemaVersion: 1
      }
    ]
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
  const importedStoryDirection = projectConflict.mergedData.storyDirectionGuides.find((item) => item.id.startsWith('direction-source'))
  const importedSnapshot = projectConflict.mergedData.promptContextSnapshots.find((item) => item.id.startsWith('snapshot-source'))
  const importedHardCanon = projectConflict.mergedData.hardCanonPacks.find((item) => item.id.startsWith('hard-source'))
  const importedNeedPlan = projectConflict.mergedData.contextNeedPlans.find((item) => item.id.startsWith('need-source'))
  const importedBudgetProfile = projectConflict.mergedData.contextBudgetProfiles.find((item) => item.id.startsWith('budget-source'))
  const importedAuthorSummary = projectConflict.mergedData.runTraceAuthorSummaries.find((item) => item.id.startsWith('summary-source'))
  const importedChapterVersion = projectConflict.mergedData.chapterVersions.find((item) => item.id.startsWith('version-source'))
  const importedRevisionSession = projectConflict.mergedData.revisionSessions.find((item) => item.id.startsWith('session-source'))
  const importedRevisionRequest = projectConflict.mergedData.revisionRequests.find((item) => item.id.startsWith('revision-request-source'))
  const importedRevisionVersion = projectConflict.mergedData.revisionVersions.find((item) => item.id.startsWith('revision-version-source'))
  const importedChapterCommit = projectConflict.mergedData.chapterCommitBundles.find((item) => item.id.startsWith('chapter-commit-source'))
  const importedRevisionCommit = projectConflict.mergedData.revisionCommitBundles.find((item) => item.id.startsWith('revision-commit-source'))
  const importedAgentRun = projectConflict.mergedData.agentRuns.find((item) => item.id.startsWith('agent-run-source'))
  const importedAgentPreview = projectConflict.mergedData.agentActionPreviews.find((item) => item.id.startsWith('agent-preview-source'))
  checks.push(
    assert(
      projectConflict.preview.canAutoMerge &&
        importedProject &&
        importedChapter?.projectId === importedProject.id &&
        importedCharacter?.projectId === importedProject.id &&
        importedLog?.projectId === importedProject.id &&
        importedLog?.characterId === importedCharacter.id &&
        importedLog?.chapterId === importedChapter.id &&
        importedStoryDirection?.projectId === importedProject.id &&
        importedStoryDirection?.generatedFromChapterIds?.[0] === importedChapter.id &&
        importedSnapshot?.projectId === importedProject.id &&
        importedSnapshot?.budgetProfileId === importedBudgetProfile?.id &&
        importedSnapshot?.budgetProfile?.id === importedBudgetProfile?.id &&
        importedSnapshot?.budgetProfile?.projectId === importedProject.id &&
        importedSnapshot?.contextNeedPlan?.id === importedNeedPlan?.id &&
        importedSnapshot?.contextNeedPlan?.projectId === importedProject.id &&
        importedSnapshot?.contextNeedPlan?.expectedCharacters?.[0]?.characterId === importedCharacter.id &&
        Object.keys(importedSnapshot?.contextNeedPlan?.requiredCharacterCardFields ?? {})[0] === importedCharacter.id &&
        importedSnapshot?.selectedCharacterIds?.[0] === importedCharacter.id &&
        importedHardCanon?.projectId === importedProject.id &&
        importedNeedPlan?.projectId === importedProject.id &&
        importedNeedPlan?.expectedCharacters?.[0]?.characterId === importedCharacter.id &&
        Object.keys(importedNeedPlan?.requiredCharacterCardFields ?? {})[0] === importedCharacter.id &&
        Object.keys(importedNeedPlan?.requiredStateFactCategories ?? {})[0] === importedCharacter.id &&
        importedNeedPlan?.retrievalPriorities?.[0]?.id === importedCharacter.id &&
        importedNeedPlan?.contextNeeds?.[0]?.sourceId === importedCharacter.id &&
        importedBudgetProfile?.projectId === importedProject.id &&
        importedAuthorSummary?.projectId === importedProject.id &&
        importedAuthorSummary?.chapterId === importedChapter.id &&
        importedChapterVersion?.projectId === importedProject.id &&
        importedChapterVersion?.chapterId === importedChapter.id &&
        importedRevisionSession?.projectId === importedProject.id &&
        importedRevisionSession?.chapterId === importedChapter.id &&
        importedRevisionRequest?.sessionId === importedRevisionSession.id &&
        importedRevisionVersion?.sessionId === importedRevisionSession.id &&
        importedRevisionVersion?.requestId === importedRevisionRequest.id &&
        importedChapterCommit?.projectId === importedProject.id &&
        importedChapterCommit?.chapterId === importedChapter.id &&
        importedChapterCommit?.chapter?.projectId === importedProject.id &&
        importedChapterCommit?.chapter?.id === importedChapter.id &&
        importedRevisionCommit?.projectId === importedProject.id &&
        importedRevisionCommit?.chapterId === importedChapter.id &&
        importedRevisionCommit?.chapter?.projectId === importedProject.id &&
        importedRevisionCommit?.chapter?.id === importedChapter.id &&
        importedRevisionCommit?.newChapterVersionId === importedChapterVersion.id &&
        importedRevisionCommit?.chapterVersion?.id === importedChapterVersion.id &&
        importedRevisionCommit?.chapterVersion?.chapterId === importedChapter.id &&
        importedRevisionCommit?.revisionSessionId === importedRevisionSession.id &&
        importedRevisionCommit?.revisionSession?.id === importedRevisionSession.id &&
        importedRevisionCommit?.revisionVersionId === importedRevisionVersion.id &&
        importedRevisionCommit?.revisionVersion?.id === importedRevisionVersion.id &&
        importedRevisionCommit?.revisionVersion?.requestId === importedRevisionRequest.id &&
        importedAgentRun?.projectId === importedProject.id &&
        importedAgentPreview?.projectId === importedProject.id &&
        importedAgentPreview?.agentRunId === importedAgentRun.id &&
        importedAgentPreview?.chapterId === importedChapter.id,
      'different project with same ID imports source as copy and remaps all project-scoped records and references',
      {
        importedProject,
        importedChapter,
        importedCharacter,
        importedLog,
        importedStoryDirection,
        importedSnapshot,
        importedHardCanon,
        importedNeedPlan,
        importedBudgetProfile,
        importedAuthorSummary,
        importedChapterVersion,
        importedRevisionSession,
        importedRevisionRequest,
        importedRevisionVersion,
        importedChapterCommit,
        importedRevisionCommit,
        importedAgentRun,
        importedAgentPreview
      }
    )
  )
  const untouchedTargetChapter = projectConflict.mergedData.chapters.find((item) => item.id === 'chapter-target')
  checks.push(
    assert(
      untouchedTargetChapter?.projectId === 'project-1' && untouchedTargetChapter?.title === '目标章节',
      'final reference pass only remaps imported source records and leaves target records untouched',
      { untouchedTargetChapter }
    )
  )

  const reusedIdSource = minimalData({
    projects: [project('reused-project', '复用 ID 源项目')],
    chapters: [chapter('reused-entity-id', 'reused-project', 1, '复用 ID 源章节')],
    characters: [character('reused-entity-id', 'reused-project', '复用 ID 源角色')],
    characterStateLogs: [stateLog('reused-log', 'reused-project', 'reused-entity-id', 'reused-entity-id')],
    contextNeedPlans: [contextNeedPlan('reused-need-plan', 'reused-project', 'reused-entity-id')]
  })
  const reusedIdTarget = minimalData({
    projects: [project('reused-project', '复用 ID 目标项目')]
  })
  const reusedIdMerge = mergeModule.mergeAppData(reusedIdSource, reusedIdTarget, {
    sourcePath: 'reused-source.json',
    targetPath: 'reused-target.json'
  })
  const reusedImportedProject = reusedIdMerge.mergedData.projects.find(
    (item) => item.id !== 'reused-project' && item.name.includes('导入副本')
  )
  const reusedImportedChapter = reusedIdMerge.mergedData.chapters.find((item) => item.title === '复用 ID 源章节')
  const reusedImportedCharacter = reusedIdMerge.mergedData.characters.find((item) => item.name === '复用 ID 源角色')
  const reusedImportedLog = reusedIdMerge.mergedData.characterStateLogs.find((item) => item.id.startsWith('reused-log'))
  const reusedImportedNeedPlan = reusedIdMerge.mergedData.contextNeedPlans.find((item) => item.id.startsWith('reused-need-plan'))
  checks.push(
    assert(
      reusedIdMerge.preview.canAutoMerge &&
        reusedImportedProject &&
        reusedImportedChapter?.projectId === reusedImportedProject.id &&
        reusedImportedCharacter?.projectId === reusedImportedProject.id &&
        reusedImportedChapter.id !== reusedImportedCharacter.id &&
        reusedImportedLog?.chapterId === reusedImportedChapter.id &&
        reusedImportedLog?.characterId === reusedImportedCharacter.id &&
        reusedImportedNeedPlan?.expectedCharacters?.[0]?.characterId === reusedImportedCharacter.id &&
        Object.keys(reusedImportedNeedPlan?.requiredCharacterCardFields ?? {})[0] === reusedImportedCharacter.id &&
        reusedImportedNeedPlan?.retrievalPriorities?.[0]?.id === reusedImportedCharacter.id,
      'typed references remain correct when legacy data reuses the same ID across collections',
      { reusedImportedProject, reusedImportedChapter, reusedImportedCharacter, reusedImportedLog, reusedImportedNeedPlan }
    )
  )

  const ambiguousGenericSource = minimalData({
    projects: [project('ambiguous-project', '混合引用源项目')],
    chapters: [chapter('ambiguous-shared-id', 'ambiguous-project', 1, '混合引用章节')],
    characters: [character('ambiguous-shared-id', 'ambiguous-project', '混合引用角色')],
    agentRuns: [
      {
        id: 'ambiguous-agent-run',
        projectId: 'ambiguous-project',
        goal: '检查混合引用',
        mode: 'single_chapter',
        safetyMode: 'autonomous',
        targetChapterOrders: [2],
        status: 'completed',
        createdJobIds: [],
        createdDraftIds: [],
        createdCommitIds: [],
        pendingHumanReviewItemIds: [],
        decisions: [],
        summary: '',
        warnings: [],
        startedAt: now(),
        updatedAt: now(),
        schemaVersion: 1
      }
    ],
    agentActionPreviews: [
      {
        id: 'ambiguous-preview',
        agentRunId: 'ambiguous-agent-run',
        projectId: 'ambiguous-project',
        chapterId: 'ambiguous-shared-id',
        actionType: 'chapter_commit',
        status: 'pending',
        summary: '无法判断 affectedIds 的实体类型',
        riskLevel: 'medium',
        diffSummary: [],
        affectedIds: ['ambiguous-shared-id'],
        requiresHumanApproval: true,
        recommendation: 'wait',
        reason: '',
        evidence: [],
        createdAt: now(),
        updatedAt: now(),
        schemaVersion: 1
      }
    ]
  })
  const ambiguousGenericMerge = mergeModule.mergeAppData(
    ambiguousGenericSource,
    minimalData({ projects: [project('ambiguous-project', '混合引用目标项目')] }),
    { sourcePath: 'ambiguous-source.json', targetPath: 'ambiguous-target.json' }
  )
  checks.push(
    assert(
      !ambiguousGenericMerge.preview.canAutoMerge &&
        ambiguousGenericMerge.preview.conflicts.some((item) => item.collection === '全局引用'),
      'ambiguous untyped references block automatic merge instead of guessing a cross-collection target',
      { conflicts: ambiguousGenericMerge.preview.conflicts, warnings: ambiguousGenericMerge.preview.warnings }
    )
  )

  const duplicateEntitySource = minimalData({
    projects: [project('duplicate-source-project', '重复实体源项目')],
    chapters: [
      chapter('duplicate-chapter', 'duplicate-source-project', 1, '重复章节 A'),
      chapter('duplicate-chapter', 'duplicate-source-project', 2, '重复章节 B')
    ],
    storyBibles: [
      { projectId: 'duplicate-source-project', worldbuilding: '版本 A', updatedAt: now() },
      { projectId: 'duplicate-source-project', worldbuilding: '版本 B', updatedAt: now() }
    ]
  })
  const duplicateEntityTarget = minimalData({
    projects: [project('duplicate-source-project', '重复实体目标项目')]
  })
  const duplicateEntityMerge = mergeModule.mergeAppData(duplicateEntitySource, duplicateEntityTarget, {
    sourcePath: 'duplicate-entity-source.json',
    targetPath: 'duplicate-entity-target.json'
  })
  checks.push(
    assert(
      !duplicateEntityMerge.preview.canAutoMerge &&
        duplicateEntityMerge.preview.conflicts.filter((item) => item.reason.includes('源文件自身')).length >= 2,
      'conflicting duplicate entities inside the source file block automatic merge',
      { conflicts: duplicateEntityMerge.preview.conflicts }
    )
  )

  const duplicateProjectSource = minimalData({
    projects: [project('duplicate-project', '重复项目 A'), project('duplicate-project', '重复项目 B')]
  })
  const duplicateProjectMerge = mergeModule.mergeAppData(duplicateProjectSource, minimalData(), {
    sourcePath: 'duplicate-project-source.json',
    targetPath: 'empty-target.json'
  })
  checks.push(
    assert(
      !duplicateProjectMerge.preview.canAutoMerge &&
        duplicateProjectMerge.preview.conflicts.some((item) => item.reason.includes('源文件自身')),
      'conflicting duplicate project IDs inside the source file block automatic merge',
      { conflicts: duplicateProjectMerge.preview.conflicts }
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
        mergedDisk.projects.length === 2 &&
        confirmed.sourceBackupPath.endsWith('.bak') &&
        confirmed.targetBackupPath.endsWith('.bak') &&
        !confirmed.sourceBackupPath.endsWith('.json.bak') &&
        !confirmed.targetBackupPath.endsWith('.json.bak'),
      'confirm merge creates source/target backups and writes merged data atomically'
    )
  )

  const staleSourcePath = join(outDir, 'stale-source.json')
  const staleTargetPath = join(outDir, 'stale-target.json')
  const staleSourceBefore = JSON.stringify(sourceOnly, null, 2)
  await writeFile(staleSourcePath, staleSourceBefore, 'utf-8')
  await writeFile(staleTargetPath, JSON.stringify(targetOnly, null, 2), 'utf-8')
  const staleExpectedRevision = createHash('sha256').update(staleSourceBefore).digest('hex')
  await writeFile(
    staleSourcePath,
    JSON.stringify(minimalData({ projects: [project('newer-source-project', '更新后的源项目')] }), null, 2),
    'utf-8'
  )
  const staleTargetBefore = await readFile(staleTargetPath, 'utf-8')
  let staleMergeBlocked = false
  try {
    await mergeModule.confirmMigrationMerge(staleSourcePath, staleTargetPath, staleExpectedRevision)
  } catch (error) {
    staleMergeBlocked = error?.code === 'STORAGE_REVISION_CONFLICT'
  }
  checks.push(
    assert(
      staleMergeBlocked && (await readFile(staleTargetPath, 'utf-8')) === staleTargetBefore,
      'confirm merge rejects a stale source revision without modifying the target'
    )
  )

  const overwriteTarget = join(outDir, 'overwrite-target.json')
  await writeFile(overwriteTarget, JSON.stringify(targetOnly, null, 2), 'utf-8')
  const overwriteBackup = await mergeModule.backupFileForOverwrite(overwriteTarget)
  checks.push(
    assert(
      (await exists(overwriteBackup)) && overwriteBackup.endsWith('.bak') && !overwriteBackup.endsWith('.json.bak'),
      'overwrite path creates a generic target backup before replacing data'
    )
  )

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
  for (const collection of [
    'projects',
    'chapters',
    'characters',
    'characterStateLogs',
    'storyDirectionGuides',
    'hardCanonPacks',
    'contextNeedPlans',
    'runTraceAuthorSummaries',
    'chapterCommitBundles',
    'revisionCommitBundles',
    'agentRuns',
    'agentActionPreviews'
  ]) {
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
