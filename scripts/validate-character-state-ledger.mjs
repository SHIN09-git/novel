import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'character-state-ledger-test')
const timestamp = '2026-01-01T00:00:00.000Z'

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

function rewriteRelativeImports(source) {
  return source.replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(['"])/g, (_match, prefix, specifier, suffix) => {
    if (/\.(mjs|js|json)$/.test(specifier)) return `${prefix}${specifier}${suffix}`
    return `${prefix}${specifier}.mjs${suffix}`
  })
}

async function compileTsTree(files) {
  await rm(outDir, { recursive: true, force: true })
  for (const relativePath of files) {
    const source = await readFile(join(root, relativePath), 'utf-8')
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        useDefineForClassFields: true
      }
    })
    const outPath = join(outDir, relativePath).replace(/\.tsx?$/, '.mjs')
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, rewriteRelativeImports(compiled.outputText), 'utf-8')
  }
}

async function loadModules() {
  await compileTsTree([
    'src/services/CharacterStateService.ts',
    'src/shared/defaults.ts',
    'src/shared/foreshadowingTreatment.ts'
  ])
  const service = await import(`${pathToFileURL(join(outDir, 'src/services/CharacterStateService.mjs')).href}?t=${Date.now()}`)
  const defaults = await import(`${pathToFileURL(join(outDir, 'src/shared/defaults.mjs')).href}?t=${Date.now()}`)
  return { ...service, ...defaults }
}

function baseData(overrides = {}) {
  return {
    schemaVersion: 3,
    projects: [{ id: 'project-1', name: '测试', genre: '', description: '', targetReaders: '', coreAppeal: '', style: '', createdAt: timestamp, updatedAt: timestamp }],
    storyBibles: [],
    chapters: [{ id: 'chapter-1', projectId: 'project-1', order: 1, title: '第一章', body: '', summary: '', newInformation: '', characterChanges: '', newForeshadowing: '', resolvedForeshadowing: '', endingHook: '', riskWarnings: '', includedInStageSummary: false, createdAt: timestamp, updatedAt: timestamp }],
    characters: [{ id: 'character-1', projectId: 'project-1', name: '林克', role: '', surfaceGoal: '', deepDesire: '', coreFear: '', selfDeception: '', knownInformation: '', unknownInformation: '', protagonistRelationship: '', emotionalState: '', nextActionTendency: '', forbiddenWriting: '', lastChangedChapter: null, isMain: true, createdAt: timestamp, updatedAt: timestamp }],
    characterStateLogs: [],
    characterStateFacts: [],
    characterStateTransactions: [],
    characterStateChangeCandidates: [],
    foreshadowings: [],
    timelineEvents: [],
    stageSummaries: [],
    promptVersions: [],
    promptContextSnapshots: [],
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
    redundancyReports: [],
    revisionCandidates: [],
    revisionSessions: [],
    revisionRequests: [],
    revisionVersions: [],
    chapterVersions: [],
    settings: {},
    ...overrides
  }
}

function cashFact(value = 10000) {
  return {
    id: 'fact-cash',
    projectId: 'project-1',
    characterId: 'character-1',
    category: 'resource',
    key: 'cash',
    label: '现金余额',
    valueType: 'number',
    value,
    unit: '元',
    linkedCardFields: ['abilitiesAndResources'],
    trackingLevel: 'hard',
    promptPolicy: 'when_relevant',
    status: 'active',
    sourceChapterId: 'chapter-1',
    sourceChapterOrder: 1,
    evidence: '初始资金',
    confidence: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function candidate(overrides = {}) {
  return {
    id: 'candidate-1',
    projectId: 'project-1',
    characterId: 'character-1',
    chapterId: 'chapter-1',
    chapterOrder: 1,
    candidateType: 'transaction',
    targetFactId: 'fact-cash',
    proposedFact: null,
    proposedTransaction: {
      id: 'tx-pending',
      projectId: 'project-1',
      characterId: 'character-1',
      factId: 'fact-cash',
      chapterId: 'chapter-1',
      chapterOrder: 1,
      transactionType: 'decrement',
      beforeValue: 10000,
      afterValue: 5000,
      delta: -5000,
      reason: '购买装备',
      evidence: '花费 5000',
      source: 'chapter_review',
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp
    },
    beforeValue: 10000,
    afterValue: 5000,
    evidence: '花费 5000',
    confidence: 0.9,
    riskLevel: 'medium',
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

async function main() {
  const { CharacterStateService, normalizeAppData } = await loadModules()
  const checks = []

  const data = normalizeAppData(baseData({ characterStateFacts: [cashFact()], characterStateChangeCandidates: [candidate()] }))
  const accepted = CharacterStateService.applyStateChangeCandidate('candidate-1', data)
  checks.push(assert(accepted.characterStateFacts.find((fact) => fact.id === 'fact-cash')?.value === 5000, '接受支出候选后现金从 10000 变为 5000'))
  checks.push(assert(accepted.characterStateTransactions.length === 1, '接受候选会创建 CharacterStateTransaction'))
  const acceptedAgain = CharacterStateService.applyStateChangeCandidate('candidate-1', accepted)
  checks.push(assert(acceptedAgain.characterStateTransactions.length === 1, '同一个状态候选不能重复接受'))

  const rejectedData = normalizeAppData(baseData({ characterStateFacts: [cashFact()], characterStateChangeCandidates: [candidate({ id: 'candidate-reject' })] }))
  const rejected = CharacterStateService.rejectStateChangeCandidate('candidate-reject', rejectedData)
  checks.push(assert(rejected.characterStateFacts.find((fact) => fact.id === 'fact-cash')?.value === 10000, '拒绝候选不改变状态事实'))
  checks.push(assert(rejected.characterStateChangeCandidates.find((item) => item.id === 'candidate-reject')?.status === 'rejected', '拒绝候选会更新状态'))

  const plan = {
    id: 'plan-1',
    projectId: 'project-1',
    targetChapterOrder: 2,
    source: 'manual',
    chapterIntent: '购买装备并准备战斗',
    expectedSceneType: 'action',
    expectedCharacters: [],
    requiredCharacterCardFields: { 'character-1': ['abilitiesAndResources'] },
    requiredStateFactCategories: { 'character-1': ['resource', 'physical', 'ability'] },
    requiredForeshadowingIds: [],
    forbiddenForeshadowingIds: [],
    requiredTimelineEventIds: [],
    requiredWorldbuildingKeys: [],
    mustCheckContinuity: ['money', 'inventory', 'ability'],
    retrievalPriorities: [],
    exclusionRules: [],
    warnings: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const manualOnly = { ...cashFact(999), id: 'fact-manual', key: 'private-note', label: '私人备注', promptPolicy: 'manual_only' }
  const relevant = CharacterStateService.getRelevantCharacterStatesForPrompt(['character-1'], plan, 2, [cashFact(5000), manualOnly])
  checks.push(assert(relevant.some((fact) => fact.id === 'fact-cash'), 'PromptBuilder 在交易场景中纳入 resource 状态'))
  checks.push(assert(!relevant.some((fact) => fact.id === 'fact-manual'), 'PromptBuilder 不默认纳入 manual_only 状态'))

  const inventoryFact = { ...cashFact(), id: 'fact-inventory', category: 'inventory', key: 'inventory', label: '持有物品', valueType: 'list', value: ['旧地图'], linkedCardFields: ['abilitiesAndResources'] }
  const issues = CharacterStateService.validateCharacterStateInText('林克花费 8000 买下装备，然后使用黑色钥匙打开门。', [cashFact(5000), inventoryFact], data.characters)
  checks.push(assert(issues.some((issue) => issue.type === 'resource_underflow'), '现金不足时质量规则生成 resource_underflow'))
  checks.push(assert(issues.some((issue) => issue.type === 'missing_inventory'), '使用未持有物品时质量规则生成 missing_inventory'))

  const normalizedOld = normalizeAppData(baseData({ characterStateFacts: undefined }))
  checks.push(assert(Array.isArray(normalizedOld.characterStateFacts), '旧项目缺 characterStateFacts 时正常补空数组'))

  const sourceFiles = {
    types: await readFile(join(root, 'src', 'shared', 'types.ts'), 'utf-8'),
    prompt: await readFile(join(root, 'src', 'services', 'PromptBuilderService.ts'), 'utf-8'),
    quality: await readFile(join(root, 'src', 'services', 'QualityGateService.ts'), 'utf-8'),
    runner: await readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'usePipelineRunner.ts'), 'utf-8'),
    chapters: await readFile(join(root, 'src', 'renderer', 'src', 'views', 'ChaptersView.tsx'), 'utf-8'),
    characters: await readFile(join(root, 'src', 'renderer', 'src', 'views', 'CharactersView.tsx'), 'utf-8')
  }
  checks.push(assert(sourceFiles.types.includes('linkedCardFields: CharacterCardField[]'), 'CharacterStateFact 挂接到 9 项角色卡字段'))
  checks.push(assert(sourceFiles.prompt.includes('角色状态账本切片'), 'PromptBuilder 输出角色状态账本切片'))
  checks.push(assert(sourceFiles.quality.includes('characterStateConsistency'), '质量门禁包含 characterStateConsistency 维度'))
  checks.push(assert(sourceFiles.runner.includes('includedCharacterStateFactIds'), 'Run Trace 记录 includedCharacterStateFactIds'))
  checks.push(assert(sourceFiles.chapters.includes('characterStateChangeSuggestions'), '章节复盘 UI 接收状态变化候选'))
  checks.push(assert(sourceFiles.characters.includes('动态状态账本'), '角色页展示动态状态账本'))

  for (const check of checks) {
    if (!check.ok) console.error('✗', check.message, check.details)
    else console.log('✓', check.message)
  }
  const failed = checks.filter((check) => !check.ok)
  if (failed.length) {
    console.error(JSON.stringify({ ok: false, failed }, null, 2))
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
