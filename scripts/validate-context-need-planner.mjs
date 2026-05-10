import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'context-need-planner-test')
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

async function loadPlanner() {
  await compileTsTree(['src/services/StageSummaryService.ts', 'src/services/StoryDirectionService.ts', 'src/services/ContextNeedPlannerService.ts'])
  return import(`${pathToFileURL(join(outDir, 'src/services/ContextNeedPlannerService.mjs')).href}?t=${Date.now()}`)
}

function character(id, name, overrides = {}) {
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
    updatedAt: timestamp,
    ...overrides
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

function baseInput(task) {
  return {
    project: {
      id: 'project-1',
      name: 'Need Planner Test',
      genre: '',
      description: '',
      targetReaders: '',
      coreAppeal: '',
      style: '',
      createdAt: timestamp,
      updatedAt: timestamp
    },
    storyBible: {
      projectId: 'project-1',
      worldbuilding: '悬浮城市与地下禁书库。',
      corePremise: '',
      protagonistDesire: '',
      protagonistFear: '',
      mainConflict: '王室谎言与地下反抗。',
      powerSystem: '银灰色能量会消耗身体。',
      bannedTropes: '',
      styleSample: '',
      narrativeTone: '',
      immutableFacts: '右臂异变不会无代价恢复。',
      updatedAt: timestamp
    },
    targetChapterOrder: 4,
    chapterTaskDraft: task,
    previousChapter: {
      id: 'chapter-3',
      projectId: 'project-1',
      order: 3,
      title: '门后的呼吸',
      body: '',
      summary: '',
      newInformation: '',
      characterChanges: '',
      newForeshadowing: '',
      resolvedForeshadowing: '',
      endingHook: '',
      riskWarnings: '',
      includedInStageSummary: false,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    continuityBridge: {
      id: 'bridge-1',
      projectId: 'project-1',
      fromChapterId: 'chapter-3',
      toChapterOrder: 4,
      lastSceneLocation: '押解通道尽头',
      lastPhysicalState: '右臂灼痛',
      lastEmotionalState: '怀疑',
      lastUnresolvedAction: '刚打开门',
      lastDialogueOrThought: '',
      immediateNextBeat: '接住门后的呼吸声',
      mustContinueFrom: '',
      mustNotReset: '',
      openMicroTensions: '主角没有回答同伴的问题',
      createdAt: timestamp,
      updatedAt: timestamp
    },
    characters: [
      character('char-hero', '林克', { role: '主角', isMain: true, protagonistRelationship: '与塞尔达互相信任但出现裂缝' }),
      character('char-zelda', '塞尔达', { role: '盟友', isMain: true }),
      character('char-merchant', '商人')
    ],
    characterStateFacts: [],
    foreshadowing: [
      foreshadowing('fs-payoff', '银灰钥匙', { weight: 'payoff', treatmentMode: 'payoff', relatedCharacterIds: ['char-hero'] }),
      foreshadowing('fs-hidden', '王室禁令', { weight: 'high', treatmentMode: 'hidden', relatedCharacterIds: ['char-zelda'] })
    ],
    timelineEvents: [
      {
        id: 'event-1',
        projectId: 'project-1',
        title: '林克得到银灰钥匙',
        chapterOrder: 2,
        storyTime: '',
        narrativeOrder: 2,
        participantCharacterIds: ['char-hero'],
        result: '',
        downstreamImpact: '',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    stageSummaries: [],
    source: 'manual'
  }
}

async function main() {
  const checks = []
  const { ContextNeedPlannerService } = await loadPlanner()

  const relationPlan = ContextNeedPlannerService.buildFromChapterIntent(
    baseInput({
      goal: '林克和塞尔达必须谈清互相隐瞒的秘密。',
      conflict: '信任关系出现裂缝。',
      suspenseToKeep: '',
      allowedPayoffs: '',
      forbiddenPayoffs: '王室禁令',
      endingHook: '',
      readerEmotion: '心疼、紧张',
      targetWordCount: '3000',
      styleRequirement: ''
    })
  )
  checks.push(assert(relationPlan.expectedSceneType === 'dialogue' || relationPlan.expectedSceneType === 'relationship', 'relationship/dialogue chapter infers relationship-oriented scene type', relationPlan.expectedSceneType))
  checks.push(assert((relationPlan.requiredCharacterCardFields['char-hero'] ?? []).includes('relationshipTension'), 'relationship chapter requests relationshipTension', relationPlan.requiredCharacterCardFields))
  checks.push(assert((relationPlan.requiredStateFactCategories['char-hero'] ?? []).includes('relationship'), 'relationship chapter requests relationship state facts', relationPlan.requiredStateFactCategories))
  checks.push(assert(relationPlan.forbiddenForeshadowingIds.includes('fs-hidden'), 'hidden/forbidden foreshadowing is marked forbidden', relationPlan.forbiddenForeshadowingIds))

  const actionPlan = ContextNeedPlannerService.buildFromChapterIntent(
    baseInput({
      goal: '林克必须逃出通道并用银灰钥匙打开门。',
      conflict: '追兵袭击，右臂伤势恶化。',
      suspenseToKeep: '',
      allowedPayoffs: '银灰钥匙',
      forbiddenPayoffs: '',
      endingHook: '',
      readerEmotion: '紧张',
      targetWordCount: '3000',
      styleRequirement: ''
    })
  )
  checks.push(assert(actionPlan.expectedSceneType === 'action', 'combat/action chapter infers action scene type', actionPlan.expectedSceneType))
  checks.push(assert((actionPlan.requiredCharacterCardFields['char-hero'] ?? []).includes('abilitiesAndResources'), 'action chapter requests abilities/resources', actionPlan.requiredCharacterCardFields))
  checks.push(assert((actionPlan.requiredStateFactCategories['char-hero'] ?? []).includes('physical'), 'action chapter requests physical state', actionPlan.requiredStateFactCategories))
  checks.push(assert(actionPlan.requiredForeshadowingIds.includes('fs-payoff'), 'payoff foreshadowing is required when allowed', actionPlan.requiredForeshadowingIds))

  const sourceFiles = {
    types: await readFile(join(root, 'src/shared/types.ts'), 'utf-8'),
    defaults: await readFile(join(root, 'src/shared/defaults.ts'), 'utf-8'),
    promptBuilder: await readFile(join(root, 'src/services/PromptBuilderService.ts'), 'utf-8'),
    runner: await readFile(join(root, 'src/renderer/src/views/generation/usePipelineRunner.ts'), 'utf-8'),
    promptView: await readFile(join(root, 'src/renderer/src/views/PromptBuilderView.tsx'), 'utf-8')
  }
  checks.push(assert(sourceFiles.types.includes('contextNeedPlans: ContextNeedPlan[]'), 'AppData includes contextNeedPlans'))
  checks.push(assert(sourceFiles.defaults.includes('contextNeedPlans: arrayOrEmpty<ContextNeedPlan>'), 'normalizeAppData normalizes contextNeedPlans'))
  checks.push(assert(sourceFiles.types.includes("context_need_planning"), 'pipeline step type includes context_need_planning'))
  checks.push(assert(sourceFiles.runner.includes("context_need_planning"), 'pipeline runner includes context_need_planning step'))
  checks.push(assert(sourceFiles.promptBuilder.includes('formatCharacterNeedSlice'), 'PromptBuilderService formats role slices from ContextNeedPlan'))
  checks.push(assert(sourceFiles.promptView.includes('generateContextNeedPlan'), 'PromptBuilderView exposes context need plan generation'))

  const failed = checks.filter((check) => !check.ok)
  for (const check of checks) {
    console.log(`${check.ok ? '✓' : '✗'} ${check.message}`)
    if (!check.ok) console.log(JSON.stringify(check.details, null, 2))
  }
  if (failed.length) {
    throw new Error(`${failed.length} context need planner validation checks failed`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
