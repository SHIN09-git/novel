#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'opening-context-invariant')
const timestamp = '2026-08-13T00:00:00.000Z'

function assert(condition, message, details = {}) {
  if (!condition) throw new Error(`${message}\n${JSON.stringify(details, null, 2)}`)
}

async function loadHarness() {
  const entry = join(outDir, 'entry.ts')
  const outfile = join(outDir, 'bundle.mjs')
  await writeFile(
    entry,
    [
      "export { normalizeAppData } from '../../src/shared/normalizers/appData'",
      "export { ContextNeedPlannerService } from '../../src/services/ContextNeedPlannerService'",
      "export { ContextBudgetManager } from '../../src/services/ContextBudgetManager'",
      "export { buildPipelineContextResultFromSelection, createContextBudgetProfile } from '../../src/renderer/src/utils/promptContext'"
    ].join('\n'),
    'utf8'
  )
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function character(id, name, isMain, role) {
  return {
    id,
    projectId: 'project-opening-invariant',
    name,
    role,
    surfaceGoal: '旧版目标',
    deepDesire: '旧版深层欲望',
    coreFear: '旧版恐惧',
    selfDeception: '',
    knownInformation: '旧版未来信息',
    unknownInformation: '',
    protagonistRelationship: '旧版关系',
    emotionalState: '旧版高压状态',
    nextActionTendency: '推进旧案件',
    forbiddenWriting: '',
    isMain,
    lastChangedChapter: null,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function rawData() {
  const projectId = 'project-opening-invariant'
  return {
    schemaVersion: 3,
    projects: [
      {
        id: projectId,
        name: '第一章净室不变量测试',
        genre: '旧版悬疑',
        description: '旧版完整剧情。',
        targetReaders: '',
        coreAppeal: '旧案件反转',
        style: '旧版压抑风格',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    storyBibles: [
      {
        projectId,
        worldbuilding: '旧版世界观',
        corePremise: '旧版案件前提',
        protagonistDesire: '旧版欲望',
        protagonistFear: '旧版恐惧',
        mainConflict: '旧版主线',
        powerSystem: '旧版机制',
        bannedTropes: '',
        styleSample: '旧版情节化风格样例',
        narrativeTone: '从开头就持续压抑',
        immutableFacts: '旧版未来真相',
        updatedAt: timestamp
      }
    ],
    characters: [
      character('character-task', '周宁', true, '当前任务点名人物'),
      character('character-fallback-main', '许成', true, '旧版主角'),
      character('character-related-legacy', '赵兰', false, '旧伏笔关联人物')
    ],
    foreshadowings: [
      {
        id: 'foreshadowing-opening-legacy',
        projectId,
        title: '旧钥匙',
        firstChapterOrder: 1,
        description: '旧版中期才会解释的钥匙。',
        status: 'unresolved',
        weight: 'payoff',
        treatmentMode: 'advance',
        expectedPayoff: '第8章',
        payoffMethod: '',
        relatedCharacterIds: ['character-related-legacy'],
        relatedMainPlot: '旧案件主线',
        notes: '',
        actualPayoffChapter: null,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    timelineEvents: [
      {
        id: 'timeline-opening-legacy',
        projectId,
        title: '旧钥匙被交给许成',
        chapterOrder: null,
        storyTime: '',
        narrativeOrder: 99,
        participantCharacterIds: ['character-fallback-main'],
        result: '旧版未来结果',
        downstreamImpact: '旧版未来后效',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    stageSummaries: [
      {
        id: 'stage-opening-null-end',
        projectId,
        chapterStart: 0,
        chapterEnd: null,
        plotProgress: 'LEGACY_NULL_STAGE_SUMMARY_MUST_BE_ISOLATED',
        characterRelations: '',
        secrets: '',
        foreshadowingPlanted: '',
        foreshadowingResolved: '',
        unresolvedQuestions: '',
        nextStageDirection: '',
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: 'stage-opening-zero-end',
        projectId,
        chapterStart: 0,
        chapterEnd: 0,
        plotProgress: 'LEGACY_ZERO_STAGE_SUMMARY_MUST_BE_ISOLATED',
        characterRelations: '',
        secrets: '',
        foreshadowingPlanted: '',
        foreshadowingResolved: '',
        unresolvedQuestions: '',
        nextStageDirection: '',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    hardCanonPacks: [
      {
        id: 'hard-canon-opening',
        projectId,
        title: '旧版硬设定包',
        description: '旧版资料',
        maxPromptTokens: 900,
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        items: [
          {
            id: 'hard-canon-style-boundary',
            projectId,
            category: 'style_boundary',
            title: 'LEGACY_STYLE_BOUNDARY_MUST_BE_ISOLATED',
            content: '旧版要求第一章立刻进入压抑案件。',
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
      }
    ],
    storyDirectionGuides: [
      {
        id: 'story-direction-opening-legacy',
        projectId,
        title: '旧版剧情导向',
        status: 'active',
        source: 'user_polished',
        horizonChapters: 5,
        startChapterOrder: 1,
        endChapterOrder: 5,
        strategicTheme: '让许成立刻追查旧钥匙',
        chapterBeats: [],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]
  }
}

function staleNeed(plan, overrides) {
  return {
    id: `need-stale-${overrides.id}`,
    needType: overrides.needType,
    sourceHint: overrides.sourceHint,
    sourceId: overrides.sourceId,
    priority: 'must',
    reason: '模拟旧计划强选旧资料。',
    uncertain: false
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const h = await loadHarness()
  const data = h.normalizeAppData(rawData())
  const project = data.projects[0]
  const task = {
    goal: '周宁在厨房煮粥，先从找不到盐罐的小事写起。',
    conflict: '粥快溢锅，周宁还没收拾完早餐桌。',
    suspenseToKeep: '',
    allowedPayoffs: '',
    forbiddenPayoffs: '',
    endingHook: '粥盛好后，周宁想起该去买盐。',
    readerEmotion: '轻松、熟悉。',
    targetWordCount: '2400-3000',
    styleRequirement: '日常、自然，不提前渲染压抑。'
  }
  const plannerInput = {
    project,
    storyBible: data.storyBibles[0] ?? null,
    targetChapterOrder: 1,
    chapterTaskDraft: task,
    previousChapter: null,
    continuityBridge: null,
    characters: data.characters,
    characterStateFacts: data.characterStateFacts,
    foreshadowing: data.foreshadowings,
    timelineEvents: data.timelineEvents,
    stageSummaries: data.stageSummaries,
    hardCanonItems: data.hardCanonPacks[0]?.items ?? [],
    storyDirectionPromptText: '旧剧情导向要求许成立刻追查旧钥匙。',
    isolateOpeningLegacyContext: true,
    source: 'generation_pipeline'
  }
  const openingPlan = h.ContextNeedPlannerService.buildFromChapterIntent(plannerInput)
  assert(
    JSON.stringify(openingPlan.expectedCharacters.map((item) => item.characterId)) === JSON.stringify(['character-task']),
    'Authoritative chapter-1 planning may retrieve only characters positively named by the task.',
    openingPlan
  )
  assert(
    openingPlan.requiredForeshadowingIds.length === 0 &&
      openingPlan.requiredTimelineEventIds.length === 0 &&
      !openingPlan.contextNeeds.some((need) => ['foreshadowing', 'stageSummary', 'hardCanon'].includes(need.sourceHint)),
    'Chapter-1 planning must need zero legacy foreshadowing, timeline, stage-summary, or HardCanon records without a magic forbidden sentence.',
    openingPlan
  )
  const unnamedOpeningPlan = h.ContextNeedPlannerService.buildFromChapterIntent({
    ...plannerInput,
    chapterTaskDraft: {
      ...task,
      goal: '从厨房里一次普通的早饭写起。',
      conflict: '',
      endingHook: '早餐做好后，想起该去买盐。'
    },
    storyDirectionPromptText: ''
  })
  assert(unnamedOpeningPlan.expectedCharacters.length === 0, 'Chapter-1 planning must not fall back to the first isMain character.', unnamedOpeningPlan)

  const stalePlan = {
    ...openingPlan,
    expectedCharacters: [
      ...openingPlan.expectedCharacters,
      {
        characterId: 'character-fallback-main',
        roleInChapter: 'protagonist',
        expectedPresence: 'onstage',
        involvement: 'must_act',
        stateCheckRequired: true,
        uncertain: false,
        reason: '模拟旧计划强选旧版主角。'
      },
      {
        characterId: 'character-related-legacy',
        roleInChapter: 'supporting',
        expectedPresence: 'onstage',
        involvement: 'must_act',
        stateCheckRequired: true,
        uncertain: false,
        reason: '模拟旧计划通过伏笔强选关联人物。'
      }
    ],
    requiredForeshadowingIds: ['foreshadowing-opening-legacy'],
    requiredTimelineEventIds: ['timeline-opening-legacy'],
    retrievalPriorities: [
      ...openingPlan.retrievalPriorities,
      { type: 'character_card', id: 'character-fallback-main', priority: 100, reason: '模拟旧计划。' },
      { type: 'foreshadowing', id: 'foreshadowing-opening-legacy', priority: 100, reason: '模拟旧计划。' },
      { type: 'timeline', id: 'timeline-opening-legacy', priority: 100, reason: '模拟旧计划。' }
    ],
    contextNeeds: [
      ...openingPlan.contextNeeds,
      staleNeed(openingPlan, { id: 'character', needType: 'character_card', sourceHint: 'character', sourceId: 'character-fallback-main' }),
      staleNeed(openingPlan, { id: 'foreshadowing', needType: 'foreshadowing', sourceHint: 'foreshadowing', sourceId: 'foreshadowing-opening-legacy' }),
      staleNeed(openingPlan, { id: 'timeline', needType: 'timeline_anchor', sourceHint: 'timeline', sourceId: 'timeline-opening-legacy' }),
      staleNeed(openingPlan, { id: 'stage', needType: 'remote_stage_summary', sourceHint: 'stageSummary', sourceId: 'stage-opening-zero-end' }),
      staleNeed(openingPlan, { id: 'canon', needType: 'hard_canon', sourceHint: 'hardCanon', sourceId: 'hard-canon-style-boundary' })
    ]
  }
  const profile = {
    ...h.createContextBudgetProfile(project.id, 'full', 12000, 'authoritative opening invariant'),
    includeRecentChaptersCount: 3,
    includeStageSummariesCount: 3,
    includeMainCharacters: true,
    includeRelatedCharacters: true,
    includeForeshadowingWeights: ['low', 'medium', 'high', 'payoff'],
    includeTimelineEventsCount: 3
  }
  const selection = h.ContextBudgetManager.selectContext(
    {
      project,
      bible: data.storyBibles[0] ?? null,
      chapters: data.chapters,
      characters: data.characters,
      foreshadowings: data.foreshadowings,
      timelineEvents: data.timelineEvents,
      stageSummaries: data.stageSummaries
    },
    1,
    profile,
    {
      characterIds: ['character-fallback-main', 'character-related-legacy'],
      foreshadowingIds: ['foreshadowing-opening-legacy'],
      chapterTask: task,
      contextNeedPlan: stalePlan,
      selectionMode: 'explicit',
      isolateOpeningLegacyContext: true
    }
  )
  assert(
    JSON.stringify(selection.selectedCharacterIds) === JSON.stringify(['character-task']) &&
      selection.selectedForeshadowingIds.length === 0 &&
      selection.selectedTimelineEventIds.length === 0 &&
      selection.selectedStageSummaryIds.length === 0,
    'ContextBudgetManager must reject stale need-plan and forced legacy IDs at the authoritative chapter-1 boundary.',
    selection
  )

  const promptResult = h.buildPipelineContextResultFromSelection(
    project,
    data,
    1,
    task.readerEmotion,
    task.targetWordCount,
    profile,
    selection,
    stalePlan,
    data.storyDirectionGuides[0] ?? null,
    task,
    true
  )
  assert(
    !promptResult.finalPrompt.includes('LEGACY_STYLE_BOUNDARY_MUST_BE_ISOLATED') &&
      !promptResult.finalPrompt.includes('旧钥匙') &&
      !promptResult.finalPrompt.includes('LEGACY_NULL_STAGE_SUMMARY_MUST_BE_ISOLATED') &&
      !promptResult.finalPrompt.includes('LEGACY_ZERO_STAGE_SUMMARY_MUST_BE_ISOLATED') &&
      !promptResult.finalPrompt.includes('许成') &&
      promptResult.finalPrompt.includes('### 周宁') &&
      (promptResult.hardCanonPrompt?.includedItemIds.length ?? 0) === 0,
    'The final authoritative chapter-1 prompt must preserve the clean-room invariant even when handed a stale allowlist.',
    promptResult
  )

  const laterPlan = h.ContextNeedPlannerService.buildFromChapterIntent({
    ...plannerInput,
    targetChapterOrder: 2,
    isolateOpeningLegacyContext: true
  })
  assert(
    laterPlan.requiredForeshadowingIds.includes('foreshadowing-opening-legacy') &&
      laterPlan.contextNeeds.some((need) => need.sourceHint === 'stageSummary') &&
      laterPlan.contextNeeds.some((need) => need.sourceHint === 'hardCanon'),
    'The opening isolation flag must not change later-chapter retrieval behavior.',
    laterPlan
  )

  console.log('Opening context invariant validation passed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
