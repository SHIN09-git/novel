import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'context-budget-consistency-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function loadTsModule(relativePath) {
  const source = await readFile(join(root, relativePath), 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: true
    }
  })
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `${relativePath.replace(/[\\/.:]/g, '-')}.mjs`)
  await writeFile(outPath, compiled.outputText, 'utf-8')
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

async function main() {
  const checks = []
  const { createPipelinePromptConfigFromSelection } = await loadTsModule('src/renderer/src/utils/contextSelectionConfig.ts')
  const promptContextSource = await readFile(join(root, 'src', 'renderer', 'src', 'utils', 'promptContext.ts'), 'utf-8')
  const promptBuilderSource = await readFile(join(root, 'src', 'services', 'PromptBuilderService.ts'), 'utf-8')
  const pipelineRunnerSource = await readFile(
    join(root, 'src', 'renderer', 'src', 'views', 'generation', 'usePipelineRunner.ts'),
    'utf-8'
  )
  const typesSource = await readFile(join(root, 'src', 'shared', 'types.ts'), 'utf-8')
  const budgetManagerSource = await readFile(join(root, 'src', 'services', 'ContextBudgetManager.ts'), 'utf-8')

  const modules = {
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
  }
  const selection = {
    selectedCharacterIds: ['manual-character', 'budget-character'],
    selectedForeshadowingIds: ['manual-foreshadowing'],
    selectedChapterIds: ['chapter-2'],
    selectedStageSummaryIds: ['stage-1'],
    selectedTimelineEventIds: [],
    selectedStoryBibleFields: [],
    estimatedTokens: 1200,
    omittedItems: [{ type: 'character', id: 'auto-character', reason: 'budget omitted', estimatedTokensSaved: 200 }],
    compressionRecords: [],
    warnings: ['budget warning']
  }
  const config = createPipelinePromptConfigFromSelection({
    projectId: 'project-1',
    targetChapterOrder: 4,
    emotion: '紧张',
    wordCount: '3200',
    projectStyle: '冷峻',
    modules,
    selection
  })

  checks.push(
    assert(
      JSON.stringify(config.selectedCharacterIds) === JSON.stringify(selection.selectedCharacterIds) &&
        JSON.stringify(config.selectedForeshadowingIds) === JSON.stringify(selection.selectedForeshadowingIds),
      'pipeline prompt config is derived exactly from budget selection ids',
      config
    )
  )

  checks.push(
    assert(
      !config.selectedCharacterIds.includes('auto-character') && !config.selectedForeshadowingIds.includes('auto-foreshadowing'),
      'automatic recommendations cannot enter pipeline prompt config outside budget selection',
      config
    )
  )

  checks.push(
    assert(
      config.selectedCharacterIds.includes('manual-character') && config.selectedForeshadowingIds.includes('manual-foreshadowing'),
      'manual choices are preserved when they are part of the explicit selection and therefore traceable',
      config
    )
  )

  checks.push(
    assert(
      typesSource.includes('explicitContextSelection?: ContextSelectionResult') &&
        promptBuilderSource.includes('input.explicitContextSelection') &&
        promptBuilderSource.includes('selectionIsExplicit') &&
        promptBuilderSource.includes('? new Set(budgetSelection.selectedCharacterIds)') &&
        promptBuilderSource.includes('? new Set(budgetSelection.selectedForeshadowingIds)') &&
        promptBuilderSource.includes('const recentChapters = selectionIsExplicit ? previousChapters') &&
        promptBuilderSource.includes('const selectedSummaries = selectionIsExplicit ? summaries'),
      'PromptBuilderService supports explicit context selection without privately merging or re-slicing extra context'
    )
  )

  checks.push(
    assert(
      promptContextSource.includes('buildPipelineContextFromSelection') &&
        promptContextSource.includes('createPipelinePromptConfigFromSelection') &&
        promptContextSource.includes('explicitContextSelection: selection'),
      'pipeline context builder passes explicit selection through to PromptBuilderService'
    )
  )

  checks.push(
    assert(
      pipelineRunnerSource.includes('buildPipelineContextFromSelection(') &&
        pipelineRunnerSource.includes('budgetSelection') &&
        pipelineRunnerSource.includes('const selectedCharacterIds = snapshot ? snapshot.selectedCharacterIds : budgetSelection?.selectedCharacterIds') &&
        pipelineRunnerSource.includes('selectedForeshadowingIds,'),
      'GenerationPipelineView builds prompt context and Run Trace from the same budget selection'
    )
  )

  checks.push(
    assert(
      budgetManagerSource.includes('!forcedCharacterIds.has(character.id)'),
      'manual character selections are not trimmed by the non-main character compression pass'
    )
  )

  checks.push(
    assert(
      budgetManagerSource.includes('compressChapterRecapsForBudget') &&
        budgetManagerSource.includes('replacementTextForCompressedChapter') &&
        promptBuilderSource.includes('formatCompressedChapterRecap'),
      'budget selection can compress old chapter recaps and PromptBuilderService renders the compressed replacement'
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
