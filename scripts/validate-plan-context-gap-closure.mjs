import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'plan-context-gap-test')
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

async function loadAnalyzer() {
  await compileTsTree(['src/services/PlanContextGapAnalyzerService.ts'])
  return import(`${pathToFileURL(join(outDir, 'src/services/PlanContextGapAnalyzerService.mjs')).href}?t=${Date.now()}`)
}

function character(id, name) {
  return {
    id,
    projectId: 'project-1',
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
    isMain: false,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function foreshadowing(id, title, overrides = {}) {
  return {
    id,
    projectId: 'project-1',
    title,
    firstChapterOrder: 1,
    description: '',
    status: 'unresolved',
    weight: 'medium',
    treatmentMode: 'hint',
    expectedPayoff: '',
    payoffMethod: '',
    relatedCharacterIds: [],
    relatedMainPlot: '',
    notes: '',
    actualPayoffChapter: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function timelineEvent(id, title) {
  return {
    id,
    projectId: 'project-1',
    title,
    chapterOrder: 17,
    storyTime: '',
    narrativeOrder: 17,
    participantCharacterIds: [],
    result: '',
    downstreamImpact: '',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function baseContextNeedPlan() {
  return {
    id: 'base-plan',
    projectId: 'project-1',
    targetChapterOrder: 18,
    source: 'generation_pipeline',
    chapterIntent: '第18章需要接住上一章结尾。',
    expectedSceneType: 'action',
    expectedCharacters: [
      {
        characterId: 'char-zhou',
        roleInChapter: 'protagonist',
        expectedPresence: 'onstage',
        reason: '主角在场。'
      }
    ],
    requiredCharacterCardFields: {},
    requiredStateFactCategories: {},
    requiredForeshadowingIds: [],
    forbiddenForeshadowingIds: ['fs-mirror'],
    requiredTimelineEventIds: [],
    requiredWorldbuildingKeys: [],
    mustCheckContinuity: [],
    retrievalPriorities: [],
    exclusionRules: [],
    warnings: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function chapterPlan() {
  return {
    chapterTitle: '第18章',
    chapterGoal: '周烬必须带韩笑颜穿过站台。',
    conflictToPush: '推进站台追击。',
    characterBeats: '韩笑颜必须在场，她和周烬的信任发生变化。',
    foreshadowingToUse: '允许暗示对向站台的注视代价。',
    foreshadowingNotToReveal: '镜面裂痕不得解释。',
    endingHook: '回应第17章镜面告警。',
    readerEmotionTarget: '紧张',
    estimatedWordCount: '3000-5000',
    openingContinuationBeat: '从闸机口继续奔逃。',
    carriedPhysicalState: '周烬右臂仍在出血。',
    carriedEmotionalState: '韩笑颜对周烬仍有怀疑。',
    unresolvedMicroTensions: '韩笑颜知道一条秘密但没有说出口。',
    forbiddenResets: '不得让伤势、位置、钥匙、秘密和承诺被重置。',
    allowedNovelty: '',
    forbiddenNovelty: ''
  }
}

const checks = []
const { PlanContextGapAnalyzerService } = await loadAnalyzer()
const project = { id: 'project-1', name: '山城副本加载中', genre: '', description: '', targetReaders: '', coreAppeal: '', style: '', createdAt: timestamp, updatedAt: timestamp }
const result = PlanContextGapAnalyzerService.buildFromChapterPlan({
  project,
  targetChapterOrder: 18,
  baseContextNeedPlan: baseContextNeedPlan(),
  plan: chapterPlan(),
  characters: [character('char-zhou', '周烬'), character('char-han', '韩笑颜')],
  foreshadowings: [
    foreshadowing('fs-gaze', '对向站台的注视代价'),
    foreshadowing('fs-mirror', '镜面裂痕')
  ],
  timelineEvents: [timelineEvent('tl-warning', '第17章镜面告警')],
  characterStateFacts: []
})

checks.push(assert(result.newlyRequiredCharacterIds.includes('char-han'), 'Plan gap analyzer recognizes a new character from characterBeats', result))
checks.push(assert(result.newlyRequiredForeshadowingIds.includes('fs-gaze'), 'Plan gap analyzer recognizes foreshadowingToUse as required', result))
checks.push(assert(!result.derivedContextNeedPlan.requiredForeshadowingIds.includes('fs-mirror'), 'Forbidden foreshadowing is not re-added as required', result))
checks.push(assert(result.derivedContextNeedPlan.forbiddenForeshadowingIds.includes('fs-mirror'), 'Forbidden foreshadowing remains forbidden', result))
checks.push(assert(result.newlyRequiredTimelineEventIds.includes('tl-warning'), 'Plan gap analyzer recognizes timeline event mention', result))
const stateCategories = result.derivedContextNeedPlan.requiredStateFactCategories['char-han'] ?? []
checks.push(assert(['physical', 'status', 'mental', 'relationship', 'location', 'goal', 'promise', 'knowledge', 'secret', 'inventory'].some((item) => stateCategories.includes(item)), 'Plan-derived need plan adds state fact categories for matched/onstage characters', { stateCategories }))

const runnerSource = await readFile(join(root, 'src/renderer/src/views/generation/usePipelineRunner.ts'), 'utf-8')
const typesSource = await readFile(join(root, 'src/shared/types.ts'), 'utf-8')
const orderIndex = (needle) => runnerSource.indexOf(`'${needle}'`)
checks.push(assert(typesSource.includes("'context_need_planning_from_plan'") && typesSource.includes('PlanContextGapAnalysisResult'), 'shared types include new plan-closure step types and result type'))
checks.push(
  assert(
    orderIndex('generate_chapter_plan') < orderIndex('context_need_planning_from_plan') &&
      orderIndex('context_need_planning_from_plan') < orderIndex('context_budget_selection_delta') &&
      orderIndex('context_budget_selection_delta') < orderIndex('rebuild_context_with_plan') &&
      orderIndex('rebuild_context_with_plan') < orderIndex('generate_chapter_draft'),
    'pipeline step order inserts plan closure before draft generation'
  )
)
checks.push(assert(runnerSource.includes('PlanContextGapAnalyzerService.buildFromChapterPlan'), 'pipeline runner uses PlanContextGapAnalyzerService'))
checks.push(assert(runnerSource.includes('deltaFromPreviousSelection'), 'pipeline runner records delta selection output'))
checks.push(assert(runnerSource.includes('缺少计划后重建上下文，无法生成正文'), 'pipeline runner prevents draft generation without rebuilt context'))
checks.push(assert(runnerSource.includes('buildPipelineContextResultFromSelection') && runnerSource.includes('contextNeedPlanFromPlan ?? contextNeedPlan'), 'pipeline runner rebuilds final prompt from explicit selection and derived need plan'))
checks.push(assert(typesSource.includes('selectedTimelineEventIds: ID[]'), 'Run Trace records selected timeline event ids'))

const failed = checks.filter((check) => !check.ok)
for (const check of checks) {
  console.log(`${check.ok ? '✓' : '✗'} ${check.message}`)
  if (!check.ok) console.log(JSON.stringify(check.details, null, 2))
}

if (failed.length > 0) {
  console.error(`\n${failed.length} plan context gap closure checks failed.`)
  process.exit(1)
}

console.log('\nPlan context gap closure validation passed.')
