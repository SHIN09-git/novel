import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'prompt-compression-replacement-test')

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

async function loadModules() {
  await compileTsTree([
    'src/shared/foreshadowingTreatment.ts',
    'src/services/TokenEstimator.ts',
    'src/services/ContinuityService.ts',
    'src/services/CharacterStateService.ts',
    'src/services/ContextCompressionService.ts',
    'src/services/ContextBudgetManager.ts',
    'src/services/PromptBuilderService.ts'
  ])
  const contextBudget = await import(`${pathToFileURL(join(outDir, 'src/services/ContextBudgetManager.mjs')).href}?t=${Date.now()}`)
  const promptBuilder = await import(`${pathToFileURL(join(outDir, 'src/services/PromptBuilderService.mjs')).href}?t=${Date.now()}`)
  const compression = await import(`${pathToFileURL(join(outDir, 'src/services/ContextCompressionService.mjs')).href}?t=${Date.now()}`)
  return { ...contextBudget, ...promptBuilder, ...compression }
}

const timestamp = '2026-01-01T00:00:00.000Z'

function makeProject() {
  return {
    id: 'project-1',
    name: 'Compression Test',
    genre: '悬疑',
    description: '用于验证上下文压缩。',
    targetReaders: '',
    coreAppeal: '',
    style: '冷峻',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function makeChapter(order, overrides = {}) {
  return {
    id: `chapter-${order}`,
    projectId: 'project-1',
    order,
    title: `标题 ${order}`,
    body: '',
    summary: `普通摘要 ${order}`,
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '',
    riskWarnings: '',
    includedInStageSummary: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function makeStageSummary() {
  return {
    id: 'stage-1-3',
    projectId: 'project-1',
    chapterStart: 1,
    chapterEnd: 3,
    plotProgress: 'STAGE_SUMMARY_1_3：主角发现雾城旧案与钟楼信号有关。',
    characterRelations: '',
    secrets: '',
    foreshadowingPlanted: '',
    foreshadowingResolved: '',
    unresolvedQuestions: '',
    nextStageDirection: '',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function makeProfile(maxTokens) {
  return {
    id: `budget-${maxTokens}`,
    projectId: 'project-1',
    name: 'test budget',
    maxTokens,
    mode: 'standard',
    includeRecentChaptersCount: 6,
    includeStageSummariesCount: 0,
    includeMainCharacters: false,
    includeRelatedCharacters: false,
    includeForeshadowingWeights: ['medium', 'high', 'payoff'],
    includeTimelineEventsCount: 0,
    styleSampleMaxChars: 100,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function makePromptInput(project, chapters, stageSummaries, selection, profile) {
  return {
    project,
    bible: null,
    chapters,
    characters: [],
    characterStateLogs: [],
    foreshadowings: [],
    timelineEvents: [],
    stageSummaries,
    chapterContinuityBridges: [],
    budgetProfile: profile,
    explicitContextSelection: selection,
    config: {
      projectId: project.id,
      targetChapterOrder: 7,
      mode: 'standard',
      modules: {
        bible: true,
        progress: true,
        recentChapters: true,
        characters: true,
        foreshadowing: true,
        chapterTask: true,
        forbidden: true,
        outputFormat: true,
        stageSummaries: true,
        timeline: false
      },
      task: {
        goal: '继续追查',
        conflict: '',
        suspenseToKeep: '',
        allowedPayoffs: '',
        forbiddenPayoffs: '',
        endingHook: '',
        readerEmotion: '紧张',
        targetWordCount: '3000',
        styleRequirement: '冷峻'
      },
      selectedCharacterIds: [],
      selectedForeshadowingIds: [],
      foreshadowingTreatmentOverrides: {},
      continuityInstructions: '',
      useContinuityBridge: false
    }
  }
}

async function main() {
  const checks = []
  const {
    ContextBudgetManager,
    PromptBuilderService,
    compressChapterRecapsForBudget,
    detailedChapterRecapText
  } = await loadModules()

  const project = makeProject()
  const longDetail = 'DETAIL_CH2_LONG '.repeat(260)
  const chapters = [
    makeChapter(1, { summary: '短摘要一。' }),
    makeChapter(2, { summary: longDetail }),
    makeChapter(3, { summary: '短摘要三。' }),
    makeChapter(4, { summary: '短摘要四。' }),
    makeChapter(5, { summary: '最近章节五。' }),
    makeChapter(6, { summary: '最近章节六。' })
  ]
  const stageSummaries = [makeStageSummary()]
  const ampleProfile = makeProfile(20000)
  const ampleSelection = ContextBudgetManager.selectContext(
    { project, bible: null, chapters, characters: [], foreshadowings: [], timelineEvents: [], stageSummaries },
    7,
    ampleProfile
  )
  checks.push(assert(ampleSelection.compressionRecords.length === 0, 'budget-rich selection does not compress chapter recaps', ampleSelection))

  const tightProfile = makeProfile(950)
  const tightSelection = ContextBudgetManager.selectContext(
    { project, bible: null, chapters, characters: [], foreshadowings: [], timelineEvents: [], stageSummaries },
    7,
    tightProfile
  )
  const stageRecord = tightSelection.compressionRecords.find((record) => record.originalChapterId === 'chapter-2')
  checks.push(
    assert(
      stageRecord?.replacementKind === 'stage_summary' &&
        stageRecord.originalTokenEstimate > stageRecord.replacementTokenEstimate &&
        stageRecord.savedTokenEstimate > 0,
      'budget pressure replaces old detailed recap with covering stage summary',
      { records: tightSelection.compressionRecords }
    )
  )
  checks.push(
    assert(
      !tightSelection.compressionRecords.some((record) => record.originalChapterOrder >= 5),
      'recent chapters are not compressed by the old-recap replacement pass',
      tightSelection.compressionRecords
    )
  )

  const stagePrompt = PromptBuilderService.build(makePromptInput(project, chapters, stageSummaries, tightSelection, tightProfile))
  checks.push(assert(!stagePrompt.includes('DETAIL_CH2_LONG'), 'final prompt does not include replaced detailed recap source text'))
  checks.push(assert(stagePrompt.includes('STAGE_SUMMARY_1_3'), 'final prompt includes stage summary replacement text'))

  const oneLineChapters = chapters.map((chapter) =>
    chapter.id === 'chapter-2'
      ? { ...chapter, oneLineSummary: 'ONE_LINE_CH2：钟楼信号指向旧警署。' }
      : chapter
  )
  const oneLineSelection = ContextBudgetManager.selectContext(
    { project, bible: null, chapters: oneLineChapters, characters: [], foreshadowings: [], timelineEvents: [], stageSummaries: [] },
    7,
    tightProfile
  )
  const oneLineRecord = oneLineSelection.compressionRecords.find((record) => record.originalChapterId === 'chapter-2')
  const oneLinePrompt = PromptBuilderService.build(makePromptInput(project, oneLineChapters, [], oneLineSelection, tightProfile))
  checks.push(assert(oneLineRecord?.replacementKind === 'chapter_one_line_summary', 'fallback uses existing one-line summary when no stage summary exists', oneLineRecord))
  checks.push(assert(oneLinePrompt.includes('ONE_LINE_CH2') && !oneLinePrompt.includes('DETAIL_CH2_LONG'), 'one-line replacement is used in final prompt'))

  const excerptSelection = ContextBudgetManager.selectContext(
    { project, bible: null, chapters, characters: [], foreshadowings: [], timelineEvents: [], stageSummaries: [] },
    7,
    tightProfile
  )
  const excerptRecord = excerptSelection.compressionRecords.find((record) => record.originalChapterId === 'chapter-2')
  const excerptPrompt = PromptBuilderService.build(makePromptInput(project, chapters, [], excerptSelection, tightProfile))
  checks.push(assert(excerptRecord?.replacementKind === 'summary_excerpt', 'fallback uses summary excerpt when no stage or one-line summary exists', excerptRecord))
  checks.push(assert(!excerptPrompt.includes(longDetail), 'summary excerpt replacement avoids full detailed recap text'))

  const emptyChapter = makeChapter(2, { summary: '', endingHook: '', newInformation: 'UNREPLACEABLE_DETAIL '.repeat(220) })
  const dropSelection = ContextBudgetManager.selectContext(
    { project, bible: null, chapters: [makeChapter(1), emptyChapter, makeChapter(5), makeChapter(6)], characters: [], foreshadowings: [], timelineEvents: [], stageSummaries: [] },
    7,
    makeProfile(120)
  )
  checks.push(
    assert(
      dropSelection.compressionRecords.some((record) => record.originalChapterId === 'chapter-2' && record.replacementKind === 'dropped'),
      'chapter recap without replacement source produces dropped compression record',
      dropSelection.compressionRecords
    )
  )

  const manualBase = {
    selectedStoryBibleFields: [],
    selectedChapterIds: ['chapter-2'],
    selectedStageSummaryIds: [],
    selectedCharacterIds: [],
    selectedForeshadowingIds: [],
    selectedTimelineEventIds: [],
    estimatedTokens: 9999,
    omittedItems: [],
    compressionRecords: [],
    warnings: []
  }
  const manualSelection = compressChapterRecapsForBudget({
    chapters,
    stageSummaries,
    selection: manualBase,
    targetChapterOrder: 7,
    budgetProfile: makeProfile(100),
    estimateSelectionTokens: (selection) =>
      selection.selectedChapterIds.includes('chapter-2') && !selection.compressionRecords.length
        ? 9999
        : 50,
    manualChapterIds: ['chapter-2']
  })
  checks.push(
    assert(
      manualSelection.selectedChapterIds.includes('chapter-2') &&
        manualSelection.compressionRecords.length === 0 &&
        manualSelection.warnings.some((warning) => warning.includes('手动强选章节')),
      'manual chapter selection is not silently compressed',
      manualSelection
    )
  )

  const compressionSource = await readFile(join(root, 'src/services/ContextCompressionService.ts'), 'utf-8')
  const promptBuilderSource = await readFile(join(root, 'src/services/PromptBuilderService.ts'), 'utf-8')
  const runnerSource = await readFile(join(root, 'src/renderer/src/views/generation/usePipelineRunner.ts'), 'utf-8')
  const generationViewSource = await readFile(join(root, 'src/renderer/src/views/GenerationPipelineView.tsx'), 'utf-8')
  const tracePanelSource = await readFile(join(root, 'src/renderer/src/views/generation/RunTracePanel.tsx'), 'utf-8')

  checks.push(assert(compressionSource.includes('compressChapterRecapsForBudget'), 'compression service exposes deterministic chapter recap compression'))
  checks.push(assert(promptBuilderSource.includes('formatCompressedChapterRecap') && promptBuilderSource.includes('compressionByChapterId'), 'PromptBuilderService renders compressed replacements in explicit selection mode'))
  checks.push(
    assert(
      promptBuilderSource.includes('promptBlockOrder') &&
        promptBuilderSource.includes('compressed: recentChapters.some') &&
        promptBuilderSource.includes('compressed: Boolean(budgetSelection?.compressionRecords.length)'),
      'compressed recap replacements are represented in promptBlockOrder without becoming forced context blocks'
    )
  )
  checks.push(assert(runnerSource.includes('compressionRecords: budgetSelection?.compressionRecords'), 'Run Trace records compressionRecords from the same budget selection'))
  checks.push(assert(runnerSource.includes('promptBlockOrder,'), 'Run Trace records promptBlockOrder alongside compressionRecords'))
  checks.push(
    assert(
      generationViewSource.includes('upsertGenerationRunTraceByJobId') &&
        generationViewSource.includes('compressionRecords: revisionContext.compressionRecords') &&
        generationViewSource.includes('buildPipelineContextFromSelection(project, data, targetOrder'),
      'quality gate revision candidate context rebuild uses explicit selection and records compressionRecords when rebuilt'
    )
  )
  checks.push(assert(tracePanelSource.includes('compressionRecords') && tracePanelSource.includes('上下文压缩'), 'Run Trace UI exposes compressionRecords'))
  checks.push(assert(detailedChapterRecapText(chapters[1]).includes('DETAIL_CH2_LONG'), 'test fixture uses detailed recap source text before compression'))

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
