import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'writing-prompt-hygiene-test')

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
        jsx: ts.JsxEmit.ReactJSX,
        useDefineForClassFields: true
      }
    })
    const outPath = join(outDir, relativePath).replace(/\.tsx?$/, '.mjs')
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, rewriteRelativeImports(compiled.outputText), 'utf-8')
  }
}

async function loadPromptBuilder() {
  await compileTsTree([
    'src/shared/foreshadowingTreatment.ts',
    'src/services/TokenEstimator.ts',
    'src/services/ContinuityService.ts',
    'src/services/CharacterStateService.ts',
    'src/services/StageSummaryService.ts',
    'src/services/ContextCompressionService.ts',
    'src/services/ContextBudgetManager.ts',
    'src/services/StoryDirectionService.ts',
    'src/services/PromptBuilderService.ts'
  ])
  return import(`${pathToFileURL(join(outDir, 'src/services/PromptBuilderService.mjs')).href}?t=${Date.now()}`)
}

const now = '2026-01-01T00:00:00.000Z'
const projectId = 'project-hygiene'
const bridgeFact = 'BRIDGE_ONLY_FACT_DO_NOT_REPEAT'

function makeChapter(order, summary) {
  return {
    id: `chapter-${order}`,
    projectId,
    order,
    title: `第 ${order} 章`,
    body: '',
    summary,
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '',
    riskWarnings: '风险：本章对伏笔进行了超出允许范围的推进。建议后续章节保持克制。',
    includedInStageSummary: false,
    createdAt: now,
    updatedAt: now
  }
}

function makeCharacter(id, name, selected = true) {
  return {
    id,
    projectId,
    name,
    role: selected ? '第18章现场行动者' : '已死亡远期角色',
    surfaceGoal: selected ? '确认镜面裂痕是否仍在扩张' : 'DEAD_CHARACTER_BIO_SHOULD_NOT_APPEAR',
    deepDesire: selected ? 'ENCYCLOPEDIA_SHOULD_NOT_APPEAR' : 'DEAD_CHARACTER_BIO_SHOULD_NOT_APPEAR',
    coreFear: selected ? 'ENCYCLOPEDIA_SHOULD_NOT_APPEAR' : 'DEAD_CHARACTER_BIO_SHOULD_NOT_APPEAR',
    selfDeception: 'ENCYCLOPEDIA_SHOULD_NOT_APPEAR',
    knownInformation: '知道韩笑颜的低存在状态仍未解除',
    unknownInformation: '待补充',
    protagonistRelationship: '与周烬保持临时互信，但存在隐性怀疑',
    emotionalState: '紧绷、疲惫、强行镇定',
    nextActionTendency: '优先稳住现场，再处理镜面裂痕',
    forbiddenWriting: '不得让他无解释知道后台未公开规则',
    lastChangedChapter: 17,
    isMain: selected,
    createdAt: now,
    updatedAt: now
  }
}

function makeForeshadowing(id, title, treatmentMode) {
  return {
    id,
    projectId,
    title,
    firstChapterOrder: 2,
    description: `${title} 描述`,
    status: 'unresolved',
    weight: treatmentMode === 'payoff' ? 'payoff' : 'high',
    treatmentMode,
    expectedPayoff: treatmentMode === 'payoff' ? '第18章允许回收' : '第20章以后',
    payoffMethod: treatmentMode === 'hint' ? '' : '利用已铺垫规则兑现',
    relatedCharacterIds: ['char-zhou'],
    relatedMainPlot: '山城副本规则',
    notes: treatmentMode === 'hint' ? '只能以系统乱码轻轻带过，不能出现实体。' : '',
    actualPayoffChapter: null,
    createdAt: now,
    updatedAt: now
  }
}

function buildInput() {
  const chapters = [
    makeChapter(16, '第16章远期摘要。'),
    makeChapter(17, `${bridgeFact}。周烬时间归零，韩笑颜低存在，沈知予消息仍未确认。`)
  ]
  const contextNeedPlan = {
    id: 'need-18',
    projectId,
    targetChapterOrder: 18,
    source: 'manual',
    chapterIntent: '接住上一章镜面裂痕现场，处理周烬与韩笑颜的状态。',
    expectedSceneType: 'dialogue',
    expectedCharacters: [
      {
        characterId: 'char-zhou',
        roleInChapter: 'protagonist',
        expectedPresence: 'onstage',
        reason: '第18章现场核心行动者'
      }
    ],
    requiredCharacterCardFields: {
      'char-zhou': ['surfaceGoal', 'relationshipTension']
    },
    requiredStateFactCategories: {
      'char-zhou': ['location', 'knowledge']
    },
    requiredForeshadowingIds: ['fs-hint-a', 'fs-hint-b', 'fs-payoff'],
    forbiddenForeshadowingIds: [],
    requiredTimelineEventIds: [],
    requiredWorldbuildingKeys: [],
    mustCheckContinuity: ['location', 'knowledge'],
    retrievalPriorities: [],
    exclusionRules: [],
    warnings: [],
    createdAt: now,
    updatedAt: now
  }

  return {
    project: {
      id: projectId,
      name: '山城副本加载中',
      genre: '规则怪谈',
      description: '测试项目',
      targetReaders: '悬疑读者',
      coreAppeal: '规则压迫',
      style: '克制、紧张',
      createdAt: now,
      updatedAt: now
    },
    bible: {
      projectId,
      worldbuilding: '',
      corePremise: '',
      protagonistDesire: '',
      protagonistFear: '',
      mainConflict: '',
      powerSystem: '系统规则不得临时补丁式救命。',
      bannedTropes: '禁止机械降神。',
      styleSample: '',
      narrativeTone: '冷静、压迫',
      immutableFacts: '不得新增无铺垫管理员层级。',
      updatedAt: now
    },
    chapters,
    characters: [makeCharacter('char-zhou', '周烬'), makeCharacter('char-dead', '苏城', false)],
    characterStateLogs: [
      {
        id: 'log-17',
        projectId,
        characterId: 'char-zhou',
        chapterId: 'chapter-17',
        chapterOrder: 17,
        note: '第17章后仍处在低信任协作关系中',
        createdAt: now
      }
    ],
    characterStateFacts: [
      {
        id: 'fact-location',
        projectId,
        characterId: 'char-zhou',
        category: 'location',
        key: 'location',
        label: '当前位置',
        valueType: 'string',
        value: '镜面裂痕旁',
        unit: '',
        linkedCardFields: ['surfaceGoal'],
        trackingLevel: 'hard',
        promptPolicy: 'always',
        status: 'active',
        sourceChapterId: 'chapter-17',
        sourceChapterOrder: 17,
        evidence: '',
        confidence: 1,
        createdAt: now,
        updatedAt: now
      }
    ],
    foreshadowings: [
      makeForeshadowing('fs-hint-a', '对向站台的注视代价', 'hint'),
      makeForeshadowing('fs-hint-b', '镜面裂痕里的反向脚步', 'hint'),
      makeForeshadowing('fs-payoff', '第九次铃声的真实含义', 'payoff')
    ],
    timelineEvents: [],
    stageSummaries: [],
    chapterContinuityBridges: [
      {
        id: 'bridge-17-18',
        projectId,
        fromChapterId: 'chapter-17',
        toChapterOrder: 18,
        lastSceneLocation: '镜面裂痕旁',
        lastPhysicalState: '周烬刚经历时间归零后的眩晕',
        lastEmotionalState: '韩笑颜低存在状态带来压迫感',
        lastUnresolvedAction: '沈知予的消息尚未确认',
        lastDialogueOrThought: bridgeFact,
        immediateNextBeat: '第18章必须直接接住镜面裂痕旁的停顿',
        mustContinueFrom: '从第17章最后数秒继续',
        mustNotReset: '不得重新介绍山城副本基础规则',
        openMicroTensions: '周烬没有解释他看见的裂痕反光',
        createdAt: now,
        updatedAt: now
      }
    ],
    contextNeedPlan,
    explicitContextSelection: {
      selectedStoryBibleFields: ['powerSystem', 'immutableFacts'],
      selectedChapterIds: chapters.map((chapter) => chapter.id),
      selectedStageSummaryIds: [],
      selectedCharacterIds: ['char-zhou'],
      selectedForeshadowingIds: ['fs-hint-a', 'fs-hint-b', 'fs-payoff'],
      selectedTimelineEventIds: [],
      estimatedTokens: 1600,
      omittedItems: [],
      compressionRecords: [],
      warnings: []
    },
    config: {
      projectId,
      targetChapterOrder: 18,
      mode: 'standard',
      modules: {
        bible: true,
        progress: true,
        recentChapters: true,
        characters: true,
        foreshadowing: true,
        stageSummaries: true,
        timeline: true,
        chapterTask: true,
        forbidden: true,
        outputFormat: true
      },
      task: {
        goal: '待补充',
        conflict: '',
        suspenseToKeep: '镜面裂痕里的反向脚步是否真实',
        allowedPayoffs: '',
        forbiddenPayoffs: '不得回收对向站台的注视代价',
        endingHook: '',
        readerEmotion: '紧张、怀疑',
        targetWordCount: '3000',
        styleRequirement: '待补充'
      },
      selectedCharacterIds: ['char-zhou'],
      selectedForeshadowingIds: ['fs-hint-a', 'fs-hint-b', 'fs-payoff'],
      foreshadowingTreatmentOverrides: {},
      useContinuityBridge: true
    }
  }
}

async function main() {
  const checks = []
  const { PromptBuilderService } = await loadPromptBuilder()
  const result = PromptBuilderService.buildResult(buildInput())
  const prompt = result.finalPrompt

  checks.push(assert(!prompt.includes('待补充') && !prompt.includes('暂无与本章需求匹配') && !prompt.includes('暂无'), 'writing prompt does not include placeholder text'))
  checks.push(assert(result.warnings.some((warning) => warning.includes('章节任务字段缺失')), 'missing core task fields become warnings instead of prompt placeholders', result.warnings))

  const hintHeaderCount = (prompt.match(/允许暗示 hint/g) ?? []).length
  checks.push(assert(hintHeaderCount === 1, 'hint treatment group rules appear once', { hintHeaderCount }))
  checks.push(assert(!prompt.includes('本章允许行为：') && !prompt.includes('本章禁止行为：'), 'per-foreshadowing entries do not repeat generic allow/forbid rules'))
  checks.push(assert(prompt.includes('只能以系统乱码轻轻带过，不能出现实体。'), 'unique foreshadowing notes are preserved'))

  checks.push(assert(!prompt.includes('风险：') && !prompt.includes('建议后续章节') && !prompt.includes('超出允许范围'), 'audit/review wording is excluded from writing prompt'))

  checks.push(assert(prompt.includes('周烬') && prompt.includes('当前位置') && prompt.includes('镜面裂痕旁'), 'selected character hard-state slice is present'))
  checks.push(assert(!prompt.includes('ENCYCLOPEDIA_SHOULD_NOT_APPEAR'), 'unrequested character encyclopedia fields are not included'))
  checks.push(assert(!prompt.includes('DEAD_CHARACTER_BIO_SHOULD_NOT_APPEAR'), 'non-present/dead character full card is not included'))

  const bridgeFactCount = (prompt.match(new RegExp(bridgeFact, 'g')) ?? []).length
  checks.push(assert(bridgeFactCount === 1, 'Bridge fact is kept once and removed from lower-priority chapter recap', { bridgeFactCount }))

  checks.push(assert(!prompt.includes('Novelty guardrail:') && !prompt.includes('Rule horror / infinite-flow constraint:'), 'duplicate English guardrails are removed from final writing prompt'))
  checks.push(assert(prompt.includes('不得新增无铺垫救命规则') || prompt.includes('不得新增无铺垫'), 'Chinese novelty/output constraints remain present'))

  const failed = checks.filter((check) => !check.ok)
  for (const check of checks) {
    console.log(`${check.ok ? '✓' : '✗'} ${check.message}`)
    if (!check.ok) console.log(JSON.stringify(check.details, null, 2))
  }
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
