import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'prompt-priority-stack-test')

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
    'src/services/contextBudget/types.ts',
    'src/services/contextBudget/scoringEngine.ts',
    'src/services/contextBudget/selectionEngine.ts',
    'src/services/contextBudget/traceBuilder.ts',
    'src/services/ContextBudgetManager.ts',
    'src/services/StoryDirectionService.ts',
    'src/services/HardCanonPackService.ts',
    'src/services/promptFormatters/chapterFormatters.ts',
    'src/services/promptFormatters/characterFormatters.ts',
    'src/services/promptFormatters/foreshadowingFormatters.ts',
    'src/services/promptFormatters/promptUtils.ts',
    'src/services/PromptBuilderService.ts'
  ])
  return import(`${pathToFileURL(join(outDir, 'src/services/PromptBuilderService.mjs')).href}?t=${Date.now()}`)
}

const timestamp = '2026-01-01T00:00:00.000Z'

function makeProject() {
  return {
    id: 'project-priority',
    name: '优先级测试稿',
    genre: '规则怪谈',
    description: '测试 Prompt 优先级栈。',
    targetReaders: '喜欢强悬疑和规则解谜的读者',
    coreAppeal: '悬疑压迫、规则反转、角色互信危机',
    style: '冷静、克制、动作清晰',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function makeBible(projectId) {
  return {
    projectId,
    worldbuilding: '山城副本由旧交通系统和匿名评分机制构成。',
    corePremise: '人在规则与自保之间选择代价。',
    protagonistDesire: '找到离开副本的方法。',
    protagonistFear: '自己也是规则的一部分。',
    mainConflict: '幸存者必须在互信和贡献值规则之间做选择。',
    powerSystem: '贡献值只能通过已公告规则变化，不得临时集中分配。',
    bannedTropes: '禁止机械降神式系统补丁。',
    styleSample: '雨水沿着站牌往下滑，广播像从墙体里渗出来。',
    narrativeTone: '冷峻、压迫、低解释。',
    immutableFacts: '未知管理员不能直接干预现实空间。',
    updatedAt: timestamp
  }
}

function makeChapter(order, summary) {
  return {
    id: `chapter-${order}`,
    projectId: 'project-priority',
    order,
    title: `第 ${order} 章标题`,
    body: '',
    summary,
    newInformation: `第 ${order} 章新增事实`,
    characterChanges: `第 ${order} 章角色变化`,
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: order === 2 ? '门后传来第二个人的呼吸声。' : '',
    riskWarnings: '',
    includedInStageSummary: false,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function makeCharacter() {
  return {
    id: 'char-main',
    projectId: 'project-priority',
    name: '林默',
    role: '主角',
    surfaceGoal: '打开站台后的门。',
    deepDesire: '证明自己不是被系统预设的牺牲者。',
    coreFear: '被同伴发现他与副本核心有关。',
    selfDeception: '相信自己只是在求生。',
    knownInformation: '知道门牌编号会改变贡献值。',
    unknownInformation: '不知道女主看见了旧管理员记录。',
    protagonistRelationship: '与女主互信但已有裂缝。',
    emotionalState: '警惕、疲惫、强压恐惧。',
    nextActionTendency: '先保护同伴，再质问规则漏洞。',
    forbiddenWriting: '不得突然完全信任系统提示。',
    lastChangedChapter: 2,
    isMain: true,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function makeStateFact(category, label, value) {
  return {
    id: `fact-${category}`,
    projectId: 'project-priority',
    characterId: 'char-main',
    category,
    key: category,
    label,
    valueType: Array.isArray(value) ? 'list' : 'text',
    value,
    unit: '',
    linkedCardFields: ['abilitiesAndResources'],
    trackingLevel: 'hard',
    promptPolicy: 'always',
    status: 'active',
    sourceChapterId: 'chapter-2',
    sourceChapterOrder: 2,
    evidence: '测试证据',
    confidence: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function makeForeshadowing(id, title, treatmentMode, weight = 'high') {
  return {
    id,
    projectId: 'project-priority',
    title,
    firstChapterOrder: 1,
    description: `${title} 描述`,
    status: 'unresolved',
    weight,
    treatmentMode,
    expectedPayoff: '第 6 章',
    payoffMethod: '用已铺垫规则兑现。',
    relatedCharacterIds: ['char-main'],
    relatedMainPlot: '主线规则谜团',
    notes: '',
    actualPayoffChapter: null,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function makeInput(PromptBuilderService) {
  const project = makeProject()
  const chapters = [makeChapter(1, '第一章建立规则。'), makeChapter(2, '第二章以门后呼吸声收束。')]
  const bridge = {
    id: 'bridge-2-3',
    projectId: project.id,
    fromChapterId: 'chapter-2',
    toChapterOrder: 3,
    lastSceneLocation: '旧站台门口',
    lastPhysicalState: '右臂刺痛，衣服被雨水浸透',
    lastEmotionalState: '震惊、警惕',
    lastUnresolvedAction: '刚握住门把手',
    lastDialogueOrThought: '门后为什么有第二个人的呼吸声？',
    immediateNextBeat: '第 3 章开头必须接住门后呼吸声。',
    mustContinueFrom: '从门被推开前后的数秒开始。',
    mustNotReset: '不要重新介绍山城副本规则。',
    openMicroTensions: '林默尚未告诉女主他听见了呼吸声。',
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const config = {
    projectId: project.id,
    targetChapterOrder: 3,
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
      goal: '打开门并确认呼吸声来源。',
      conflict: '主角想保护同伴，但规则逼迫他先做选择。',
      suspenseToKeep: '门后的人是否真实存在。',
      allowedPayoffs: '允许回收黑票副作用。',
      forbiddenPayoffs: '禁止解释管理员真实身份。',
      endingHook: '门后的人叫出主角旧名。',
      readerEmotion: '紧张、怀疑',
      targetWordCount: '3000',
      styleRequirement: '冷静克制，少解释。'
    },
    selectedCharacterIds: ['char-main'],
    selectedForeshadowingIds: ['fs-hidden', 'fs-payoff', 'fs-hint'],
    foreshadowingTreatmentOverrides: {},
    useContinuityBridge: true
  }
  const explicitContextSelection = {
    selectedStoryBibleFields: ['immutableFacts', 'powerSystem'],
    selectedChapterIds: chapters.map((chapter) => chapter.id),
    selectedStageSummaryIds: [],
    selectedCharacterIds: ['char-main'],
    selectedForeshadowingIds: ['fs-hidden', 'fs-payoff', 'fs-hint'],
    selectedTimelineEventIds: [],
    estimatedTokens: 1600,
    omittedItems: [],
    compressionRecords: [],
    warnings: []
  }
  return PromptBuilderService.buildResult({
    project,
    bible: makeBible(project.id),
    chapters,
    characters: [makeCharacter()],
    characterStateLogs: [],
    characterStateFacts: [
      makeStateFact('location', '当前位置', '旧站台门口'),
      makeStateFact('inventory', '持有物品', ['黑票', '旧钥匙']),
      makeStateFact('knowledge', '已知秘密', ['门牌编号会改变贡献值'])
    ],
    foreshadowings: [
      makeForeshadowing('fs-hidden', '管理员真实身份', 'hidden', 'payoff'),
      makeForeshadowing('fs-payoff', '黑票副作用', 'payoff', 'payoff'),
      makeForeshadowing('fs-hint', '门牌编号', 'hint', 'high')
    ],
    timelineEvents: [],
    stageSummaries: [],
    chapterContinuityBridges: [bridge],
    hardCanonPack: {
      id: 'hard-canon-pack-project-priority',
      projectId: project.id,
      title: '不可违背设定包',
      description: '测试硬设定',
      maxPromptTokens: 500,
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      items: [
        {
          id: 'hard-canon-1',
          projectId: project.id,
          category: 'system_rule',
          title: '副本规则不得临时救命',
          content: '系统不得临时弹出刚好救命的无代价补充条款。',
          priority: 'must',
          status: 'active',
          sourceType: 'manual',
          sourceId: null,
          relatedCharacterIds: [],
          relatedForeshadowingIds: [],
          relatedTimelineEventIds: [],
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ]
    },
    explicitContextSelection,
    config
  })
}

function indexOfSection(prompt, title) {
  if (title.includes('HardCanonPack')) return prompt.indexOf('HardCanonPack')
  return prompt.indexOf(`## ${title}`)
}

async function main() {
  const checks = []
  const { PromptBuilderService } = await loadPromptBuilder()
  const result = makeInput(PromptBuilderService)
  const prompt = result.finalPrompt
  const frontHalf = prompt.slice(0, Math.floor(prompt.length / 2))

  checks.push(assert(prompt.includes('如果上下文之间存在冲突，必须按以下优先级处理'), 'final prose prompt begins with conflict priority declaration'))
  checks.push(assert(indexOfSection(prompt, '不可违背设定 HardCanonPack') > indexOfSection(prompt, '0.'), 'HardCanonPack appears immediately after priority rules as a high-priority hard-canon block'))
  checks.push(assert(indexOfSection(prompt, '不可违背设定 HardCanonPack') < indexOfSection(prompt, '7. 最近章节详细回顾'), 'HardCanonPack appears before ordinary chapter recaps'))
  checks.push(assert(indexOfSection(prompt, '4. 当前角色硬状态') < indexOfSection(prompt, '7. 最近章节详细回顾'), 'character hard state appears before recent chapter recap'))
  checks.push(assert(indexOfSection(prompt, '5. 本章伏笔操作规则') < indexOfSection(prompt, '7. 最近章节详细回顾'), 'foreshadowing operation rules appear before recent chapter recap'))
  checks.push(assert(indexOfSection(prompt, '11. 风格要求 StyleEnvelope') > Math.floor(prompt.length / 2), 'style envelope is placed in the latter half of the prompt'))
  checks.push(assert(!frontHalf.includes('目标读者：') && !frontHalf.includes('核心爽点/情绪体验：'), 'target readers and core appeal are not long front-half context blocks'))
  checks.push(assert(prompt.includes('允许暗示 hint') && prompt.includes('允许回收 payoff') && prompt.includes('禁止提及 hidden / pause'), 'foreshadowing entries are grouped by treatmentMode operation table'))
  checks.push(assert(prompt.includes('管理员真实身份') && prompt.includes('不得主动出现'), 'hidden/payoff-weight foreshadowing is placed in a forbidden mention group'))
  checks.push(assert(prompt.includes('黑票副作用') && prompt.includes('允许回收 payoff'), 'payoff foreshadowing is placed in allowed payoff group'))
  checks.push(assert(prompt.includes('不得让角色使用未持有物品') && prompt.includes('不得让角色知道尚未记录为已知的信息'), 'character hard-state constraints are present'))
  checks.push(assert(prompt.includes('NoveltyPolicy') && prompt.includes('不得新增未授权命名角色') && prompt.includes('系统面板补充条款'), 'NoveltyPolicy hard constraints are present in forbidden block'))
  checks.push(assert(Array.isArray(result.promptBlockOrder) && result.promptBlockOrder.length >= 13, 'BuildPromptResult includes promptBlockOrder'))
  const styleBlock = result.promptBlockOrder.find((block) => block.kind === 'style')
  const noveltyBlock = result.promptBlockOrder.find((block) => block.kind === 'forbidden_and_novelty')
  const outputBlock = result.promptBlockOrder.find((block) => block.kind === 'output_format')
  checks.push(
    assert(
      Boolean(styleBlock && noveltyBlock && outputBlock && styleBlock.priority < noveltyBlock.priority && noveltyBlock.priority < outputBlock.priority),
      'NoveltyPolicy block is after StyleEnvelope and before output format',
      { styleBlock, noveltyBlock, outputBlock }
    )
  )
  checks.push(
    assert(
      result.promptBlockOrder.filter((block) => block.included).map((block) => block.title).join('|') ===
        [...prompt.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1]).join('|'),
      'promptBlockOrder order matches final prompt section order'
    )
  )
  checks.push(
    assert(
      result.promptBlockOrder.every((block) => typeof block.priority === 'number' && typeof block.tokenEstimate === 'number' && block.source && block.reason),
      'each promptBlockOrder item records priority, tokenEstimate, source, and reason',
      result.promptBlockOrder
    )
  )
  checks.push(assert(/[。！？.!?]$/.test(prompt.trim()), 'prompt does not end with a half sentence'))

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
