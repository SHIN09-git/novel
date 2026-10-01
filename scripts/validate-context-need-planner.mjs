import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
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

async function loadPlannerModules() {
  await compileTsTree([
    'src/shared/chapterText.ts',
    'src/shared/foreshadowingTreatment.ts',
    'src/shared/defaults/index.ts',
    'src/services/StageSummaryService.ts',
    'src/services/StoryDirectionService.ts',
    'src/services/contextNeedPlanner/rules.ts',
    'src/services/contextNeedPlanner/characterInference.ts',
    'src/services/contextNeedPlanner/characterNeeds.ts',
    'src/services/ContextNeedPlannerService.ts',
    'src/renderer/src/utils/format.ts',
    'src/renderer/src/views/promptBuilder/promptBuilderNeedPlan.ts',
    'src/renderer/src/views/promptBuilder/promptBuilderHistoryState.ts',
    'src/renderer/src/views/promptBuilder/promptBuilderSnapshotConsistency.ts',
    'src/renderer/src/utils/foreshadowingRecommendations.ts'
  ])
  const cacheKey = Date.now()
  const planner = await import(`${pathToFileURL(join(outDir, 'src/services/ContextNeedPlannerService.mjs')).href}?t=${cacheKey}`)
  const editor = await import(`${pathToFileURL(join(outDir, 'src/renderer/src/views/promptBuilder/promptBuilderNeedPlan.mjs')).href}?t=${cacheKey}`)
  const history = await import(`${pathToFileURL(join(outDir, 'src/renderer/src/views/promptBuilder/promptBuilderHistoryState.mjs')).href}?t=${cacheKey}`)
  const recommendations = await import(`${pathToFileURL(join(outDir, 'src/renderer/src/utils/foreshadowingRecommendations.mjs')).href}?t=${cacheKey}`)
  return { ...planner, ...editor, ...history, ...recommendations }
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
  const {
    ContextNeedPlannerService,
    recommendedForeshadowings,
    restorePromptBuilderFromSnapshot,
    toggleNeedPlanCharacter,
    toggleNeedPlanForeshadowing
  } = await loadPlannerModules()

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
  checks.push(assert(!actionPlan.expectedCharacters.some((item) => item.characterId === 'char-zelda'), 'unmentioned main characters are not automatically treated as onstage', actionPlan.expectedCharacters))

  const scheduledInput = baseInput({
    goal: '林克检查未来钟声的来历。', conflict: '', suspenseToKeep: '', allowedPayoffs: '未来钟声', forbiddenPayoffs: '', endingHook: '', readerEmotion: '', targetWordCount: '3000', styleRequirement: ''
  })
  scheduledInput.foreshadowing.push(foreshadowing('fs-future', '未来钟声', {
    firstChapterOrder: 8, treatmentMode: 'payoff', weight: 'payoff', relatedCharacterIds: ['char-merchant']
  }))
  const scheduledPlan = ContextNeedPlannerService.buildFromChapterIntent(scheduledInput)
  checks.push(assert(
    !scheduledPlan.requiredForeshadowingIds.includes('fs-future') &&
      !scheduledPlan.expectedCharacters.some((item) => item.characterId === 'char-merchant') &&
      scheduledPlan.warnings.some((warning) => warning.includes('章节门禁')),
    'future foreshadowing cannot create a required need or pull related characters before first appearance',
    scheduledPlan
  ))
  const recommendationItems = [
    foreshadowing('fs-future-recommendation', '未来推荐', { firstChapterOrder: 8, treatmentMode: 'advance' }),
    foreshadowing('fs-current-recommendation', '本章推荐', { firstChapterOrder: 4, treatmentMode: 'advance' }),
    foreshadowing('fs-unscheduled-recommendation', '未排期推荐', { firstChapterOrder: null, treatmentMode: 'advance' })
  ]
  const recommendationIds = recommendedForeshadowings(recommendationItems, 4).map((item) => item.id)
  checks.push(assert(!recommendationIds.includes('fs-future-recommendation') && recommendationIds.includes('fs-current-recommendation') && recommendationIds.includes('fs-unscheduled-recommendation'), 'Prompt Builder auto recommendations honor the first-chapter gate', recommendationIds))

  const negativeConstraintPlan = ContextNeedPlannerService.buildFromChapterIntent(
    baseInput({
      goal: '林克检查门后的痕迹；不得出现商人。',
      conflict: '', suspenseToKeep: '', allowedPayoffs: '', forbiddenPayoffs: '商人、银灰钥匙、战斗真相', endingHook: '', readerEmotion: '', targetWordCount: '3000', styleRequirement: ''
    })
  )
  checks.push(assert(
    !negativeConstraintPlan.expectedCharacters.some((item) => item.characterId === 'char-merchant') &&
      !negativeConstraintPlan.requiredForeshadowingIds.includes('fs-payoff') &&
      negativeConstraintPlan.forbiddenForeshadowingIds.includes('fs-payoff') &&
      negativeConstraintPlan.expectedSceneType !== 'action' &&
      negativeConstraintPlan.warnings.some((warning) => warning.includes('自由文本含否定约束')),
    'negative free text and forbiddenPayoffs never become positive character, foreshadowing, or scene-type retrieval signals',
    negativeConstraintPlan
  ))

  const positiveCharacterWithNegativeSecretPlan = ContextNeedPlannerService.buildFromChapterIntent(
    baseInput({
      goal: '林克和塞尔达一起做晚饭。',
      conflict: '只处理两人的生活小摩擦。',
      suspenseToKeep: '',
      allowedPayoffs: '',
      forbiddenPayoffs: '禁止揭示林克的未来身份、塞尔达的未来秘密。',
      endingHook: '',
      readerEmotion: '轻松',
      targetWordCount: '3000',
      styleRequirement: '生活化'
    })
  )
  checks.push(assert(
    positiveCharacterWithNegativeSecretPlan.expectedCharacters.some((item) => item.characterId === 'char-hero') &&
      positiveCharacterWithNegativeSecretPlan.expectedCharacters.some((item) => item.characterId === 'char-zelda'),
    'a character required by positive task text stays selected when only their future secret is forbidden',
    positiveCharacterWithNegativeSecretPlan.expectedCharacters
  ))

  const mixedClausePlan = ContextNeedPlannerService.buildFromChapterIntent(
    baseInput({
      goal: '林克和塞尔达一起做饭，但不要揭示塞尔达的秘密。',
      conflict: '', suspenseToKeep: '', allowedPayoffs: '', forbiddenPayoffs: '', endingHook: '', readerEmotion: '轻松', targetWordCount: '3000', styleRequirement: '生活化'
    })
  )
  checks.push(assert(
    mixedClausePlan.expectedCharacters.some((item) => item.characterId === 'char-hero') &&
      mixedClausePlan.expectedCharacters.some((item) => item.characterId === 'char-zelda') &&
      !mixedClausePlan.exclusionRules.some((rule) => rule.type === 'character' && (rule.id === 'char-hero' || rule.id === 'char-zelda')),
    'positive and negative clauses in one sentence are separated before character exclusion',
    mixedClausePlan
  ))

  const closedForeshadowingPlan = ContextNeedPlannerService.buildFromChapterIntent(
    baseInput({
      goal: '林克和塞尔达做晚饭。',
      conflict: '', suspenseToKeep: '', allowedPayoffs: '', forbiddenPayoffs: '本章不调用任何现有伏笔。', endingHook: '', readerEmotion: '轻松', targetWordCount: '3000', styleRequirement: '生活化'
    })
  )
  checks.push(assert(
    closedForeshadowingPlan.requiredForeshadowingIds.length === 0 &&
      ['fs-payoff', 'fs-hidden'].every((id) => closedForeshadowingPlan.forbiddenForeshadowingIds.includes(id)),
    'a generic closed-scope rule blocks every existing foreshadowing without naming future clues in the model prompt',
    closedForeshadowingPlan
  ))

  const openingInput = baseInput({
    goal: '林克和塞尔达在家做晚饭。',
    conflict: '', suspenseToKeep: '', allowedPayoffs: '', forbiddenPayoffs: '本章不调用任何现有伏笔。', endingHook: '', readerEmotion: '轻松', targetWordCount: '3000', styleRequirement: '生活化'
  })
  openingInput.targetChapterOrder = 1
  openingInput.previousChapter = null
  openingInput.continuityBridge = null
  openingInput.isolateOpeningLegacyContext = true
  openingInput.timelineEvents = [
    {
      id: 'event-unscoped-opening-future',
      projectId: 'project-1',
      title: '晚饭',
      chapterOrder: null,
      storyTime: '',
      narrativeOrder: 99,
      participantCharacterIds: ['char-hero'],
      result: '未来才会确认的结果',
      downstreamImpact: '未来剧情后效',
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ]
  const openingPlan = ContextNeedPlannerService.buildFromChapterIntent(openingInput)
  checks.push(assert(
    !openingPlan.contextNeeds.some((need) => need.needType === 'previous_chapter_ending' || need.sourceHint === 'character_state') &&
      !openingPlan.warnings.some((warning) => warning.includes('缺少上一章')) &&
      Object.keys(openingPlan.requiredStateFactCategories).length === 0 &&
      openingPlan.requiredTimelineEventIds.length === 0,
    'an authoritative opening task requests neither previous-chapter/state context nor chapter-unscoped legacy timeline facts',
    openingPlan
  ))

  const mentionPlan = ContextNeedPlannerService.buildFromChapterIntent(
    baseInput({
      goal: '林克必须打开密室门，档案只提到商人，商人不在场。',
      conflict: '门后的追兵逼近。',
      suspenseToKeep: '',
      allowedPayoffs: '',
      forbiddenPayoffs: '',
      endingHook: '',
      readerEmotion: '紧张',
      targetWordCount: '3000',
      styleRequirement: ''
    })
  )
  const merchantNeed = mentionPlan.expectedCharacters.find((item) => item.characterId === 'char-merchant')
  checks.push(assert(merchantNeed?.involvement === 'mentioned' && merchantNeed.expectedPresence !== 'onstage', 'reference-only character is distinguished from an onstage character', merchantNeed))
  checks.push(assert(merchantNeed?.stateCheckRequired === false, 'reference-only character does not require a full state-ledger lookup', merchantNeed))
  checks.push(assert(!('char-merchant' in mentionPlan.requiredStateFactCategories), 'reference-only character has no forced state categories', mentionPlan.requiredStateFactCategories))

  const directionOnlyInput = baseInput({
    goal: '林克检查门后的痕迹。',
    conflict: '',
    suspenseToKeep: '',
    allowedPayoffs: '',
    forbiddenPayoffs: '',
    endingHook: '',
    readerEmotion: '警惕',
    targetWordCount: '3000',
    styleRequirement: ''
  })
  directionOnlyInput.storyDirectionPromptText = '未来方向可能提到塞尔达，但本章是否让她在场尚未确认。'
  const directionOnlyPlan = ContextNeedPlannerService.buildFromChapterIntent(directionOnlyInput)
  const directionNeed = directionOnlyPlan.expectedCharacters.find((item) => item.characterId === 'char-zelda')
  checks.push(assert(directionNeed?.uncertain === true && directionNeed.involvement === 'mentioned', 'Story Direction-only character remains an uncertain candidate', directionNeed))
  checks.push(assert(directionOnlyPlan.contextNeeds.some((need) => need.sourceId === 'char-zelda' && need.uncertain), 'uncertain character need remains visible in structured trace input', directionOnlyPlan.contextNeeds))

  const withoutHero = toggleNeedPlanCharacter(
    actionPlan,
    baseInput(actionPlan).characters[0],
    baseInput(actionPlan).chapterTaskDraft,
    false
  )
  checks.push(assert(!withoutHero.expectedCharacters.some((item) => item.characterId === 'char-hero'), 'manual need-plan removal removes the expected character'))
  checks.push(assert(!('char-hero' in withoutHero.requiredCharacterCardFields), 'manual need-plan removal clears character field requirements'))
  checks.push(assert(!('char-hero' in withoutHero.requiredStateFactCategories), 'manual need-plan removal clears state category requirements'))

  const forbiddenPayoff = toggleNeedPlanForeshadowing(actionPlan, 'fs-payoff', 'forbidden', true)
  checks.push(assert(!forbiddenPayoff.requiredForeshadowingIds.includes('fs-payoff'), 'forbidden foreshadowing is removed from required needs'))
  checks.push(assert(forbiddenPayoff.forbiddenForeshadowingIds.includes('fs-payoff'), 'forbidden foreshadowing is recorded as forbidden'))
  checks.push(assert(forbiddenPayoff.exclusionRules.some((rule) => rule.id === 'fs-payoff'), 'forbidden foreshadowing creates an explicit exclusion rule'))

  const requiredAgain = toggleNeedPlanForeshadowing(forbiddenPayoff, 'fs-payoff', 'required', true)
  checks.push(assert(requiredAgain.requiredForeshadowingIds.includes('fs-payoff'), 'required foreshadowing can be restored explicitly'))
  checks.push(assert(!requiredAgain.forbiddenForeshadowingIds.includes('fs-payoff'), 'required and forbidden foreshadowing states remain mutually exclusive'))

  const snapshotBase = {
    id: 'snapshot-1',
    projectId: 'project-1',
    targetChapterOrder: 8,
    mode: 'custom',
    budgetProfile: { maxTokens: 12345 },
    selectedCharacterIds: ['char-hero'],
    selectedForeshadowingIds: ['fs-payoff'],
    foreshadowingTreatmentOverrides: { 'fs-payoff': 'payoff' },
    chapterTask: actionPlan,
    contextNeedPlan: actionPlan,
    finalPrompt: 'restored prompt',
    note: 'snapshot note'
  }
  const legacySnapshot = restorePromptBuilderFromSnapshot(snapshotBase, 'standard')
  checks.push(assert(legacySnapshot.promptMode === 'standard', 'legacy custom-budget snapshot falls back to the active prompt mode'))
  checks.push(assert(legacySnapshot.modules.characters === true && legacySnapshot.modules.timeline === false, 'legacy snapshot restores standard module defaults'))
  checks.push(assert(legacySnapshot.useContinuityBridge === true, 'legacy snapshot keeps continuity bridge enabled by default'))

  const restoredSnapshot = restorePromptBuilderFromSnapshot({
    ...snapshotBase,
    promptMode: 'full',
    moduleSelection: {
      bible: false,
      progress: false,
      recentChapters: true,
      characters: true,
      foreshadowing: true,
      stageSummaries: false,
      timeline: true,
      chapterTask: true,
      forbidden: true,
      outputFormat: true
    },
    continuityInstructions: '从门后的呼吸声继续。',
    useContinuityBridge: false
  }, 'standard')
  checks.push(assert(restoredSnapshot.promptMode === 'full' && restoredSnapshot.modules.bible === false, 'new snapshot restores prompt mode and module selection'))
  checks.push(assert(restoredSnapshot.continuityInstructions === '从门后的呼吸声继续。' && restoredSnapshot.useContinuityBridge === false, 'new snapshot restores continuity settings'))
  checks.push(assert(restoredSnapshot.selectedCharacterIds[0] === 'char-hero' && restoredSnapshot.prompt === 'restored prompt', 'new snapshot restores selections and prompt text'))

  const sourceFiles = {
    types: [
      await readFile(join(root, 'src/shared/types.ts'), 'utf-8'),
      await readFile(join(root, 'src/shared/types/appData.ts'), 'utf-8'),
      await readFile(join(root, 'src/shared/types/generation.ts'), 'utf-8')
    ].join('\n'),
    defaults: [
      await readFile(join(root, 'src/shared/defaults.ts'), 'utf-8'),
      await readFile(join(root, 'src/shared/normalizers/appData.ts'), 'utf-8')
    ].join('\n'),
    promptBuilder: [
      await readFile(join(root, 'src/services/PromptBuilderService.ts'), 'utf-8'),
      await readFile(join(root, 'src/services/promptFormatters/characterFormatters.ts'), 'utf-8')
    ].join('\n'),
    runner: [
      await readFile(join(root, 'src/renderer/src/views/generation/usePipelineRunner.ts'), 'utf-8'),
      await readFile(join(root, 'src/renderer/src/views/generation/usePipelineRunnerCore.ts'), 'utf-8'),
      await readFile(join(root, 'src/renderer/src/views/generation/pipelineUtils.ts'), 'utf-8')
    ].join('\n'),
    promptView: await readFile(join(root, 'src/renderer/src/views/PromptBuilderView.tsx'), 'utf-8')
  }
  checks.push(assert(sourceFiles.types.includes('contextNeedPlans: ContextNeedPlan[]'), 'AppData includes contextNeedPlans'))
  checks.push(assert(sourceFiles.defaults.includes('contextNeedPlans: arrayOrEmpty<ContextNeedPlan>'), 'normalizeAppData normalizes contextNeedPlans'))
  checks.push(assert(sourceFiles.types.includes("context_need_planning"), 'pipeline step type includes context_need_planning'))
  checks.push(assert(sourceFiles.runner.includes("context_need_planning"), 'pipeline runner includes context_need_planning step'))
  checks.push(assert(sourceFiles.promptBuilder.includes('formatCharacterNeedSlice'), 'PromptBuilderService formats role slices from ContextNeedPlan'))
  checks.push(assert(sourceFiles.promptView.includes('generateContextNeedPlan'), 'PromptBuilderView exposes context need plan generation'))
  checks.push(assert(sourceFiles.promptView.includes('restorePromptBuilderFromSnapshot'), 'PromptBuilderView restores full context snapshots instead of prompt text only'))
  checks.push(assert(sourceFiles.promptView.includes('setSelectedCharacterIds((current) => toggleId(current, characterId, checked))'), 'need-plan character edits stay aligned with explicit context selection'))
  checks.push(assert(sourceFiles.promptView.includes("role === 'forbidden' && checked"), 'forbidden need-plan foreshadowings are removed from explicit context selection'))
  const plannerRules = await readFile(join(root, 'src/services/contextNeedPlanner/rules.ts'), 'utf-8')
  checks.push(assert(sourceFiles.runner.includes('context_need_planning'), 'pipeline runner keeps context need planning reachable'))
  checks.push(assert(plannerRules.includes('inferRequiredCharacterFields') && plannerRules.includes('inferRequiredStateCategories'), 'ContextNeedPlanner pure field/state inference rules are split into a helper module'))
  checks.push(assert(plannerRules.includes('stateCategoryReason') && plannerRules.includes('hardCanonNeedReason'), 'ContextNeedPlanner helper owns author-facing need reasons'))
  const characterNeedRules = await readFile(join(root, 'src/services/contextNeedPlanner/characterNeeds.ts'), 'utf-8')
  checks.push(assert(characterNeedRules.includes('inferExpectedCharacterNeeds') && characterNeedRules.includes('stateCheckRequired'), 'character presence and state-check inference are isolated in a pure helper'))

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
