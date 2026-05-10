import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = resolve('.')
const outDir = join(root, 'tmp', 'hard-canon-pack-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function bundle(entryPoint, outfileName) {
  const outfile = join(outDir, outfileName)
  await build({
    entryPoints: [join(root, entryPoint)],
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

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

function now() {
  return '2026-05-10T00:00:00.000Z'
}

function makeProject() {
  return {
    id: 'project-1',
    name: '硬设定测试',
    genre: '规则怪谈',
    description: '测试项目',
    targetReaders: '测试读者',
    coreAppeal: '连续性',
    style: '冷静、克制',
    createdAt: now(),
    updatedAt: now()
  }
}

function makeBible() {
  return {
    projectId: 'project-1',
    worldbuilding: 'SHOULD_NOT_COPY_FULL_STORY_BIBLE_WORLD',
    corePremise: 'SHOULD_NOT_COPY_FULL_STORY_BIBLE_PREMISE',
    protagonistDesire: '',
    protagonistFear: '',
    mainConflict: '',
    powerSystem: 'SHOULD_NOT_COPY_FULL_STORY_BIBLE_POWER_SYSTEM',
    bannedTropes: '',
    styleSample: '',
    narrativeTone: '',
    immutableFacts: 'SHOULD_NOT_COPY_FULL_STORY_BIBLE_IMMUTABLE',
    updatedAt: now()
  }
}

function makePack(overrides = {}) {
  return {
    id: 'hard-canon-pack-project-1',
    projectId: 'project-1',
    title: '不可违背设定包',
    description: '短规则',
    maxPromptTokens: 220,
    schemaVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    items: [
      {
        id: 'canon-must',
        projectId: 'project-1',
        category: 'system_rule',
        title: '副本规则不可无代价救命',
        content: '系统不得临时弹出刚好救命的无代价补充条款。',
        priority: 'must',
        status: 'active',
        sourceType: 'manual',
        sourceId: null,
        relatedCharacterIds: [],
        relatedForeshadowingIds: [],
        relatedTimelineEventIds: [],
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: 'canon-high',
        projectId: 'project-1',
        category: 'character_identity',
        title: '主角身份不可替换',
        content: '主角不能被写成另一个已经死亡的人。',
        priority: 'high',
        status: 'active',
        sourceType: 'manual',
        sourceId: null,
        relatedCharacterIds: [],
        relatedForeshadowingIds: [],
        relatedTimelineEventIds: [],
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: 'canon-inactive',
        projectId: 'project-1',
        category: 'world_rule',
        title: '停用规则',
        content: 'INACTIVE_CANON_SHOULD_NOT_APPEAR',
        priority: 'must',
        status: 'inactive',
        sourceType: 'manual',
        sourceId: null,
        relatedCharacterIds: [],
        relatedForeshadowingIds: [],
        relatedTimelineEventIds: [],
        createdAt: now(),
        updatedAt: now()
      }
    ],
    ...overrides
  }
}

function makeData(emptyData) {
  return {
    ...emptyData,
    projects: [makeProject()],
    storyBibles: [makeBible()],
    hardCanonPacks: [makePack()],
    settings: { ...emptyData.settings, apiKey: 'TEST_KEY_SHOULD_NOT_PERSIST' }
  }
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const checks = []
const defaults = await bundle('src/shared/defaults.ts', 'defaults.mjs')
const service = await bundle('src/services/HardCanonPackService.ts', 'hard-canon-service.mjs')
const prompt = await bundle('src/services/PromptBuilderService.ts', 'prompt-builder.mjs')
const sqlite = await bundle('src/storage/SqliteStorageService.ts', 'sqlite-storage.mjs')
const json = await bundle('src/storage/JsonStorageService.ts', 'json-storage.mjs')

const normalizedEmpty = defaults.normalizeAppData({ projects: [makeProject()] })
checks.push(assert(Array.isArray(normalizedEmpty.hardCanonPacks), 'normalizeAppData initializes hardCanonPacks as an array'))
checks.push(assert(normalizedEmpty.hardCanonPacks.some((pack) => pack.projectId === 'project-1'), 'old projects get an empty HardCanonPack during normalize'))

let data = makeData(defaults.EMPTY_APP_DATA)
const pack = service.HardCanonPackService.getHardCanonPackForProject(data, 'project-1')
checks.push(assert(pack.items.length === 3, 'getHardCanonPackForProject returns the project pack'))

const compressed = service.HardCanonPackService.compressHardCanonPackForPrompt(pack)
checks.push(assert(compressed.body.includes('副本规则不可无代价救命'), 'active must item enters HardCanon prompt block'))
checks.push(assert(compressed.body.includes('主角身份不可替换'), 'active high item enters HardCanon prompt block when budget allows'))
checks.push(assert(!compressed.body.includes('INACTIVE_CANON_SHOULD_NOT_APPEAR'), 'inactive item does not enter HardCanon prompt block'))
checks.push(assert(!compressed.body.includes('SHOULD_NOT_COPY_FULL_STORY_BIBLE'), 'HardCanon prompt block does not copy full Story Bible text'))
checks.push(assert(compressed.includedItemIds[0] === 'canon-must', 'must priority is kept before lower-priority items'))

const tinyPack = makePack({ maxPromptTokens: 12 })
const tiny = service.HardCanonPackService.compressHardCanonPackForPrompt(tinyPack)
checks.push(assert(tiny.includedItemIds.includes('canon-must'), 'over budget keeps must items first'))

data = service.HardCanonPackService.upsertHardCanonItem(data, {
  ...pack.items[1],
  content: '主角身份不可被复制体无解释替换。',
  updatedAt: now()
})
checks.push(assert(data.hardCanonPacks[0].items.find((item) => item.id === 'canon-high')?.content.includes('复制体'), 'can edit/upsert HardCanonItem'))
data = service.HardCanonPackService.deactivateHardCanonItem(data, 'canon-high')
checks.push(assert(data.hardCanonPacks[0].items.find((item) => item.id === 'canon-high')?.status === 'inactive', 'can deactivate HardCanonItem'))

const promptResult = prompt.PromptBuilderService.buildResult({
  project: makeProject(),
  bible: makeBible(),
  chapters: [],
  characters: [],
  characterStateLogs: [],
  characterStateFacts: [],
  foreshadowings: [],
  timelineEvents: [],
  stageSummaries: [],
  chapterContinuityBridges: [],
  hardCanonPack: makePack(),
  config: {
    projectId: 'project-1',
    targetChapterOrder: 1,
    mode: 'standard',
    modules: defaults.defaultModulesForMode('standard'),
    task: defaults.createEmptyChapterTask(),
    selectedCharacterIds: [],
    selectedForeshadowingIds: []
  }
})
checks.push(assert(promptResult.finalPrompt.includes('HardCanonPack'), 'PromptBuilder final prompt contains HardCanonPack block'))
checks.push(assert(promptResult.finalPrompt.includes('系统不得临时弹出刚好救命'), 'PromptBuilder final prompt includes active hard canon content'))
checks.push(assert(!promptResult.finalPrompt.includes('INACTIVE_CANON_SHOULD_NOT_APPEAR'), 'PromptBuilder final prompt excludes inactive hard canon content'))
checks.push(assert(!promptResult.finalPrompt.includes('SHOULD_NOT_COPY_FULL_STORY_BIBLE_WORLD'), 'PromptBuilder does not copy full Story Bible into hard canon block'))
checks.push(assert(promptResult.promptBlockOrder.some((block) => block.kind === 'hard_canon' && block.included), 'promptBlockOrder records included hard_canon block'))
checks.push(assert(promptResult.hardCanonPrompt?.includedItemIds.includes('canon-must'), 'BuildPromptResult exposes hardCanonPrompt trace data'))

const runTraceSource = await read('src/renderer/src/views/generation/usePipelineRunner.ts')
checks.push(assert(runTraceSource.includes('hardCanonPackItemCount') && runTraceSource.includes('includedHardCanonItemIds'), 'pipeline runner writes HardCanon trace fields'))
const tracePanelSource = await read('src/renderer/src/views/generation/RunTracePanel.tsx')
checks.push(assert(tracePanelSource.includes('hardCanonPackItemCount'), 'Run Trace summary can copy HardCanon trace fields'))
const hardCanonViewSource = await read('src/renderer/src/views/HardCanonView.tsx')
checks.push(assert(hardCanonViewSource.includes('这里放不能被 AI 改写的硬设定'), 'HardCanon UI explains author-facing purpose'))

const normalized = defaults.sanitizeAppDataForPersistence(makeData(defaults.EMPTY_APP_DATA))
checks.push(assert(normalized.settings.apiKey === '', 'sanitizeAppDataForPersistence clears apiKey before storage'))
checks.push(assert(!JSON.stringify(normalized.hardCanonPacks).includes('TEST_KEY_SHOULD_NOT_PERSIST'), 'HardCanonPack does not contain model/API keys'))

const sqlitePath = join(outDir, 'novel-director-data.sqlite')
const sqliteService = new sqlite.SqliteStorageService(sqlitePath)
await sqliteService.save(normalized)
const sqliteLoaded = await sqliteService.load()
checks.push(assert(sqliteLoaded.hardCanonPacks[0]?.items[0]?.id === 'canon-must', 'SQLite backend round-trips HardCanonPack entities'))

const jsonPath = join(outDir, 'novel-director-data.json')
const jsonService = new json.JsonStorageService(jsonPath)
await jsonService.save(normalized)
const jsonLoaded = await jsonService.load()
checks.push(assert(jsonLoaded.hardCanonPacks[0]?.items.length === normalized.hardCanonPacks[0].items.length, 'JSON backend round-trips HardCanonPack entities'))

const runTests = await read('scripts/run-tests.mjs')
checks.push(assert(runTests.includes('validate-hard-canon-pack.mjs'), 'npm test runs validate-hard-canon-pack.mjs'))

const failed = checks.filter((check) => !check.ok)
for (const check of checks) {
  console.log(`${check.ok ? '✓' : '✗'} ${check.message}`)
  if (!check.ok) console.log(JSON.stringify(check.details, null, 2))
}

if (failed.length) {
  console.error(`validate-hard-canon-pack failed: ${failed.length} check(s) failed`)
  process.exit(1)
}

console.log(`validate-hard-canon-pack passed: ${checks.length} checks`)
