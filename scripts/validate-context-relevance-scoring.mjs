import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'context-relevance-scoring-test')
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
    'src/shared/foreshadowingTreatment.ts',
    'src/services/TokenEstimator.ts',
    'src/services/StageSummaryService.ts',
    'src/services/ContextCompressionService.ts',
    'src/services/contextBudget/types.ts',
    'src/services/contextBudget/scoringEngine.ts',
    'src/services/contextBudget/selectionEngine.ts',
    'src/services/contextBudget/selectionFinalizer.ts',
    'src/services/contextBudget/traceBuilder.ts',
    'src/services/ChapterLifecycleService.ts',
    'src/services/ContextBudgetManager.ts'
  ])
  return import(`${pathToFileURL(join(outDir, 'src/services/ContextBudgetManager.mjs')).href}?t=${Date.now()}`)
}

function makeProject() {
  return {
    id: 'project-1',
    name: 'Context Relevance Test',
    genre: '悬疑',
    description: '上下文相关性测试',
    targetReaders: '',
    coreAppeal: '',
    style: '冷峻',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function makeCharacter(id, name, overrides = {}) {
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
    lastChangedChapter: '',
    isMain: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function makeForeshadowing(id, title, overrides = {}) {
  return {
    id,
    projectId: 'project-1',
    title,
    firstChapterId: null,
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
    actualPayoffChapterId: null,
    actualPayoffChapterOrder: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function makeChapter(order, summary) {
  return {
    id: `chapter-${order}`,
    projectId: 'project-1',
    order,
    title: `第 ${order} 章`,
    body: '',
    summary,
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '',
    riskWarnings: '',
    includedInStageSummary: false,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function makeProfile(maxTokens) {
  return {
    id: `profile-${maxTokens}`,
    projectId: 'project-1',
    name: '相关性测试预算',
    maxTokens,
    mode: 'standard',
    includeRecentChaptersCount: 2,
    includeStageSummariesCount: 0,
    includeMainCharacters: false,
    includeRelatedCharacters: true,
    includeForeshadowingWeights: ['low', 'medium', 'high', 'payoff'],
    includeTimelineEventsCount: 0,
    styleSampleMaxChars: 400,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function makeData() {
  const task = {
    goal: '林默必须调查钟楼密室，并推进银色钥匙的异常。',
    conflict: '林默与守门人的交易变成正面冲突。',
    suspenseToKeep: '保留黑塔真相。',
    allowedPayoffs: '钟楼密钥',
    forbiddenPayoffs: '黑塔真相',
    endingHook: '',
    readerEmotion: '紧张、怀疑',
    targetWordCount: '3200',
    styleRequirement: '冷峻克制'
  }
  return {
    task,
    data: {
      project: makeProject(),
      bible: null,
      chapters: [
        makeChapter(1, '旧城区铺垫。'),
        makeChapter(2, '林默得到银色钥匙。'),
        makeChapter(3, '无关支线。')
      ],
      characters: [
        makeCharacter('char-lin', '林默', { role: '调查员，正在调查钟楼密室。' }),
        makeCharacter('char-keeper', '守门人', { role: '掌握钟楼密室入口。' }),
        makeCharacter('char-passenger', '路人', { role: '无关角色。' })
      ],
      foreshadowings: [
        makeForeshadowing('fs-key', '银色钥匙', {
          description: '银色钥匙会打开钟楼密室。',
          weight: 'medium',
          treatmentMode: 'advance',
          relatedCharacterIds: ['char-lin']
        }),
        makeForeshadowing('fs-tower', '黑塔真相', {
          description: '黑塔真相是主谜团，不应在本章推进。'.repeat(160),
          weight: 'high',
          treatmentMode: 'pause',
          relatedCharacterIds: ['char-passenger']
        }),
        makeForeshadowing('fs-payoff', '钟楼密钥', {
          description: '钟楼密钥将在本章允许回收。',
          weight: 'payoff',
          treatmentMode: 'payoff',
          expectedPayoff: '第4章',
          relatedCharacterIds: ['char-keeper']
        })
      ],
      timelineEvents: [],
      stageSummaries: []
    }
  }
}

function makeCharacterNeedPlan() {
  return {
    id: 'plan-character-certainty',
    projectId: 'project-1',
    targetChapterOrder: 4,
    source: 'auto',
    chapterIntent: '林默进入钟楼，路人只在旧记录中被提及。',
    expectedSceneType: 'investigation',
    expectedCharacters: [
      {
        characterId: 'char-lin',
        roleInChapter: 'protagonist',
        expectedPresence: 'onstage',
        involvement: 'must_act',
        stateCheckRequired: false,
        uncertain: false,
        reason: '任务契约要求林默行动。'
      },
      {
        characterId: 'char-passenger',
        roleInChapter: 'mentioned',
        expectedPresence: 'referenced',
        involvement: 'mentioned',
        stateCheckRequired: false,
        uncertain: true,
        reason: '路人只在旧记录中被提及。'
      }
    ],
    requiredCharacterCardFields: { 'char-lin': ['decisionLogic'] },
    requiredStateFactCategories: {},
    requiredForeshadowingIds: [],
    forbiddenForeshadowingIds: [],
    requiredTimelineEventIds: [],
    requiredWorldbuildingKeys: [],
    mustCheckContinuity: ['knowledge'],
    retrievalPriorities: [
      { type: 'character_card', id: 'char-lin', priority: 96, reason: '必须行动。' },
      { type: 'character_card', id: 'char-passenger', priority: 70, reason: '推测性提及。' }
    ],
    exclusionRules: [],
    contextNeeds: [
      {
        id: 'need-lin',
        needType: 'character_card',
        sourceHint: 'character',
        sourceId: 'char-lin',
        priority: 'high',
        reason: '林默必须行动。',
        uncertain: false
      },
      {
        id: 'need-passenger',
        needType: 'character_card',
        sourceHint: 'character',
        sourceId: 'char-passenger',
        priority: 'medium',
        reason: '路人可能只作为背景提及。',
        uncertain: true
      }
    ],
    warnings: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

async function main() {
  const checks = []
  const { ContextBudgetManager } = await loadModules()
  const { data, task } = makeData()

  const selection = ContextBudgetManager.selectContext(data, 4, makeProfile(12000), { chapterTask: task })
  checks.push(
    assert(
      selection.selectedForeshadowingIds.includes('fs-key') && selection.selectedForeshadowingIds.includes('fs-payoff'),
      'task-matched advance/payoff foreshadowings are selected',
      selection.selectedForeshadowingIds
    )
  )

  const openingTimelinePlan = makeCharacterNeedPlan()
  openingTimelinePlan.targetChapterOrder = 1
  openingTimelinePlan.requiredTimelineEventIds = ['timeline-unscoped-future']
  openingTimelinePlan.contextNeeds.push({
    id: 'need-opening-unscoped-timeline',
    needType: 'timeline_anchor',
    sourceHint: 'timeline',
    sourceId: 'timeline-unscoped-future',
    priority: 'must',
    reason: '模拟旧计划错误强选了空章序时间线。',
    uncertain: false
  })
  const openingTimelineSelection = ContextBudgetManager.selectContext(
    {
      ...data,
      chapters: [],
      timelineEvents: [
        {
          id: 'timeline-unscoped-future',
          projectId: 'project-1',
          title: '晚饭后的未来真相',
          chapterOrder: null,
          storyTime: '',
          narrativeOrder: 99,
          participantCharacterIds: ['char-lin'],
          result: '未来章节结果',
          downstreamImpact: '未来章节后效',
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ]
    },
    1,
    makeProfile(12000),
    {
      contextNeedPlan: openingTimelinePlan,
      isolateOpeningLegacyContext: true
    }
  )
  checks.push(assert(
    openingTimelineSelection.selectedTimelineEventIds.length === 0,
    'authoritative opening isolation rejects chapter-unscoped timeline events even when an old need plan forces them',
    openingTimelineSelection
  ))

  const futurePlan = makeCharacterNeedPlan()
  futurePlan.requiredForeshadowingIds = ['fs-future']
  futurePlan.retrievalPriorities.push({ type: 'foreshadowing', id: 'fs-future', priority: 100, reason: '计划强制要求未来伏笔。' })
  futurePlan.contextNeeds.push({ id: 'need-future', needType: 'foreshadowing', sourceHint: 'foreshadowing', sourceId: 'fs-future', priority: 'must', reason: '计划强制要求未来伏笔。', uncertain: false })
  const scheduledData = {
    ...data,
    chapters: [],
    foreshadowings: [
      makeForeshadowing('fs-future', '未来门禁线索', { firstChapterOrder: 8, treatmentMode: 'payoff', weight: 'payoff' }),
      makeForeshadowing('fs-current', '本章线索', { firstChapterOrder: 4, treatmentMode: 'advance' }),
      makeForeshadowing('fs-unscheduled', '未排期线索', { firstChapterOrder: null, treatmentMode: 'advance' })
    ]
  }
  const scheduledSelection = ContextBudgetManager.selectContext(scheduledData, 4, makeProfile(12000), { contextNeedPlan: futurePlan })
  checks.push(assert(
    !scheduledSelection.selectedForeshadowingIds.includes('fs-future') &&
      scheduledSelection.selectedForeshadowingIds.includes('fs-current') &&
      scheduledSelection.selectedForeshadowingIds.includes('fs-unscheduled') &&
      scheduledSelection.omittedItems.some((item) => item.id === 'fs-future' && item.reasonCode === 'not_available') &&
      scheduledSelection.contextSelectionTrace?.droppedBlocks.some((block) => block.sourceId === 'fs-future' && block.forced),
    'future foreshadowing is gated even when planner-required while current/null schedules remain available',
    scheduledSelection
  ))
  const manualFutureSelection = ContextBudgetManager.selectContext(scheduledData, 4, makeProfile(12000), {
    foreshadowingIds: ['fs-future'], contextNeedPlan: futurePlan, selectionMode: 'explicit'
  })
  checks.push(assert(
    manualFutureSelection.selectedForeshadowingIds.includes('fs-future') &&
      manualFutureSelection.warnings.some((warning) => warning.includes('手动强选')) &&
      manualFutureSelection.contextSelectionTrace?.selectedBlocks.some((block) => block.sourceId === 'fs-future' && block.forced && block.reasonCode === 'manual_selection'),
    'manual future selection bypasses the schedule gate with warning and forced/manual trace evidence',
    manualFutureSelection
  ))

  const certaintyData = {
    ...data,
    chapters: [],
    foreshadowings: [],
    characters: [
      makeCharacter('char-lin', '林默', { role: '主角调查钟楼。' }),
      makeCharacter('char-passenger', '路人', { role: '无关背景。'.repeat(600) })
    ]
  }
  const certaintySelection = ContextBudgetManager.selectContext(
    certaintyData,
    4,
    { ...makeProfile(220), includeRecentChaptersCount: 0, includeRelatedCharacters: false },
    { chapterTask: task, contextNeedPlan: makeCharacterNeedPlan() }
  )
  checks.push(
    assert(
      certaintySelection.selectedCharacterIds.includes('char-lin') && !certaintySelection.selectedCharacterIds.includes('char-passenger'),
      'tight budget preserves confirmed must-act character even without a state-ledger lookup and drops uncertain reference-only character',
      certaintySelection.selectedCharacterIds
    )
  )
  checks.push(
    assert(
      certaintySelection.contextSelectionTrace?.droppedBlocks.some(
        (block) => block.sourceId === 'char-passenger' && block.uncertain === true
      ),
      'dropped uncertain character remains visible as advisory trace evidence',
      certaintySelection.contextSelectionTrace
    )
  )
  checks.push(
    assert(
      certaintySelection.omittedItems.some(
        (item) => item.id === 'char-passenger' && item.reasonCode === 'budget_exceeded' && item.uncertain === true
      ),
      'budget omission keeps a structured reason code and uncertainty metadata',
      certaintySelection.omittedItems
    )
  )

  const exclusionPlan = makeCharacterNeedPlan()
  exclusionPlan.exclusionRules = [
    { type: 'character', id: 'char-lin', reason: '用户明确取消本章角色切片。', source: 'user' }
  ]
  const exclusionSelection = ContextBudgetManager.selectContext(
    certaintyData,
    4,
    { ...makeProfile(12000), includeRecentChaptersCount: 0 },
    { chapterTask: task, contextNeedPlan: exclusionPlan, selectionMode: 'explicit' }
  )
  checks.push(
    assert(
      !exclusionSelection.selectedCharacterIds.includes('char-lin') &&
        exclusionSelection.omittedItems.some((item) => item.id === 'char-lin' && item.reasonCode === 'manual_exclusion') &&
        exclusionSelection.contextSelectionTrace?.unmetNeeds.some(
          (need) => need.sourceId === 'char-lin' && need.reasonCode === 'manual_exclusion'
        ),
      'manual character exclusion wins over task mention and remains visible in omission and unmet-need trace',
      exclusionSelection
    )
  )
  checks.push(
    assert(
      !selection.selectedForeshadowingIds.includes('fs-tower') &&
        selection.omittedItems.some(
          (item) => item.id === 'fs-tower' && item.reason.includes('禁止') && item.reasonCode === 'forbidden'
        ),
      'task-forbidden or paused foreshadowing is omitted with an explanatory reason',
      { selected: selection.selectedForeshadowingIds, omitted: selection.omittedItems }
    )
  )

  const cappedForeshadowings = Array.from({ length: 11 }, (_, index) =>
    makeForeshadowing(`fs-cap-${index + 1}`, `钟楼线索 ${index + 1}`, {
      description: `林默调查钟楼密室的关键线索 ${index + 1}。`,
      weight: index < 3 ? 'high' : 'medium',
      treatmentMode: 'advance',
      relatedCharacterIds: ['char-lin']
    })
  )
  const cappedSelection = ContextBudgetManager.selectContext(
    { ...data, chapters: [], foreshadowings: cappedForeshadowings },
    4,
    { ...makeProfile(20000), includeRecentChaptersCount: 0 },
    { chapterTask: task }
  )
  checks.push(
    assert(
      cappedSelection.selectedForeshadowingIds.length === 10 &&
        cappedSelection.omittedItems.some((item) => item.type === 'foreshadowing' && item.reasonCode === 'prompt_limit'),
      'foreshadowing cap keeps ten ranked items and records prompt_limit for the remainder',
      cappedSelection
    )
  )
  checks.push(
    assert(
      selection.selectedCharacterIds.includes('char-lin') && selection.selectedCharacterIds.includes('char-keeper'),
      'planned/related characters are selected even when they are not marked main',
      selection.selectedCharacterIds
    )
  )

  const payoffScore = ContextBudgetManager.evaluateContext(
    { type: 'foreshadowing', id: 'fs-payoff', text: '钟楼密钥将在本章允许回收。' },
    { targetChapterOrder: 4, task, treatmentMode: 'payoff', weight: 'payoff', expectedPayoff: '第4章' }
  )
  const hintScore = ContextBudgetManager.evaluateContext(
    { type: 'foreshadowing', id: 'fs-hint', text: '普通暗示。' },
    { targetChapterOrder: 4, task, treatmentMode: 'hint', weight: 'low' }
  )
  checks.push(assert(payoffScore > hintScore, 'payoff and task-aligned foreshadowing scores above low hint', { payoffScore, hintScore }))

  const tightSelection = ContextBudgetManager.selectContext(data, 4, makeProfile(260), { chapterTask: task })
  checks.push(
    assert(
      tightSelection.selectedForeshadowingIds.includes('fs-payoff') && !tightSelection.selectedForeshadowingIds.includes('fs-tower'),
      'when budget is tight, low-relevance/forbidden context is omitted before task-critical payoff context',
      { selected: tightSelection.selectedForeshadowingIds, omitted: tightSelection.omittedItems }
    )
  )

  const chapterSelection = ContextBudgetManager.selectContext(
    {
      ...data,
      chapters: [
        makeChapter(1, '无关旧案。'.repeat(50)),
        makeChapter(2, '林默得到银色钥匙并接近钟楼密室。'),
        makeChapter(3, '无关支线。'.repeat(50))
      ],
      foreshadowings: []
    },
    4,
    { ...makeProfile(12000), includeRecentChaptersCount: 1 },
    { chapterTask: task }
  )
  checks.push(
    assert(
      chapterSelection.selectedChapterIds.includes('chapter-2'),
      'chapter selection prefers task-relevant chapter over merely latest unrelated chapter when recent budget is limited',
      chapterSelection.selectedChapterIds
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
