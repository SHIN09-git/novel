import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'context-selection-trace-runtime-test')

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

async function loadRuntime() {
  await compileTsTree([
    'src/services/TokenEstimator.ts',
    'src/renderer/src/views/generation/contextSelectionTraceRuntime.ts'
  ])
  return import(
    `${pathToFileURL(join(outDir, 'src/renderer/src/views/generation/contextSelectionTraceRuntime.mjs')).href}?t=${Date.now()}`
  )
}

function makeBaseTrace(unmetNeeds) {
  return {
    projectId: 'project-1',
    chapterId: 'chapter-2',
    selectionMode: 'automatic',
    selectedBlocks: [],
    droppedBlocks: [],
    unmetNeeds,
    budgetSummary: {
      totalBudget: 2000,
      usedTokens: 400,
      reservedTokens: 1600,
      pressure: 'low'
    }
  }
}

function makeNeed(needType, sourceHint, sourceId) {
  return {
    id: `need-${sourceId}`,
    needType,
    sourceHint,
    sourceId,
    priority: 'must',
    reason: `必须核对 ${sourceId}`,
    uncertain: false
  }
}

async function main() {
  const checks = []
  const {
    characterStateFactsPresentInPrompt,
    enrichContextSelectionTrace,
    hardCanonTraceFromPrompt
  } = await loadRuntime()

  const stateNeed = makeNeed('character_state_physical', 'character_state', 'char-1')
  const hardCanonNeed = makeNeed('hard_canon', 'hardCanon', 'canon-1')
  const directionNeed = makeNeed('story_direction', 'storyDirection', 'guide-1')
  const plan = {
    contextNeeds: [stateNeed, hardCanonNeed, directionNeed],
    requiredStateFactCategories: { 'char-1': ['physical'] }
  }
  const fact = {
    id: 'fact-1',
    characterId: 'char-1',
    key: 'right_hand_crystal',
    label: '右手结晶化',
    value: '右手已经结晶化，过度使用会灼痛。',
    evidence: '第 1 章结尾确认。',
    trackingLevel: 'hard'
  }
  const hardCanonPack = {
    items: [
      { id: 'canon-1', title: '结晶不可逆', content: '右手结晶化不能无解释恢复。', status: 'active' },
      { id: 'canon-inactive', title: '停用规则', content: '不应进入正文。', status: 'inactive' }
    ]
  }
  const finalPrompt = '【当前角色硬状态】右手结晶化。\n【硬设定包】结晶不可逆。'
  const promptFacts = characterStateFactsPresentInPrompt(finalPrompt, [fact])
  const hardCanonTrace = hardCanonTraceFromPrompt(finalPrompt, hardCanonPack)

  checks.push(
    assert(
      promptFacts.map((item) => item.id).join(',') === 'fact-1',
      'only character state facts actually present in the final prompt are accepted as included',
      promptFacts
    )
  )
  checks.push(
    assert(
      characterStateFactsPresentInPrompt('正文没有状态账本切片。', [fact]).length === 0,
      'ledger facts outside the frozen prompt are not claimed by trace'
    )
  )
  checks.push(
    assert(
      hardCanonTrace.includedItemIds.includes('canon-1') && !hardCanonTrace.includedItemIds.includes('canon-inactive'),
      'hard canon trace detects active items actually present in the prompt',
      hardCanonTrace
    )
  )

  const enriched = enrichContextSelectionTrace(
    makeBaseTrace([
      { needType: stateNeed.needType, priority: 'must', uncertain: false, reasonCode: 'not_available', reason: stateNeed.reason, sourceId: 'char-1' },
      { needType: hardCanonNeed.needType, priority: 'must', uncertain: false, reasonCode: 'not_available', reason: hardCanonNeed.reason, sourceId: 'canon-1' },
      { needType: directionNeed.needType, priority: 'must', uncertain: false, reasonCode: 'not_available', reason: directionNeed.reason, sourceId: 'guide-1' }
    ]),
    {
      jobId: 'job-1',
      contextNeedPlan: plan,
      includedCharacterStateFacts: promptFacts,
      hardCanonTrace,
      storyDirectionGuideId: 'guide-1',
      selectionMode: 'automatic',
      finalPromptTokenEstimate: 600
    }
  )
  checks.push(
    assert(
      enriched?.unmetNeeds.length === 0 &&
        enriched.selectedBlocks.some((block) => block.sourceId === 'fact-1') &&
        enriched.selectedBlocks.some((block) => block.sourceId === 'canon-1'),
      'final prompt enrichment resolves state, hard-canon, and story-direction needs using actual included sources',
      enriched
    )
  )

  const enrichedTwice = enrichContextSelectionTrace(enriched, {
    jobId: 'job-1',
    contextNeedPlan: plan,
    includedCharacterStateFacts: promptFacts,
    hardCanonTrace,
    storyDirectionGuideId: 'guide-1',
    selectionMode: 'automatic',
    finalPromptTokenEstimate: 600
  })
  checks.push(
    assert(
      enrichedTwice?.selectedBlocks.filter((block) => block.sourceId === 'fact-1').length === 1 &&
        enrichedTwice.selectedBlocks.filter((block) => block.sourceId === 'canon-1').length === 1,
      're-enriching a trace is idempotent for selected source blocks',
      enrichedTwice
    )
  )

  const snapshotTrace = enrichContextSelectionTrace(
    makeBaseTrace([
      { needType: stateNeed.needType, priority: 'must', uncertain: false, reasonCode: 'not_available', reason: stateNeed.reason, sourceId: 'char-1' }
    ]),
    {
      jobId: 'job-snapshot',
      contextNeedPlan: plan,
      includedCharacterStateFacts: [],
      hardCanonTrace: { itemCount: 0, tokenEstimate: 0, includedItemIds: [], truncatedItemIds: [] },
      storyDirectionGuideId: null,
      selectionMode: 'prompt_snapshot',
      finalPromptTokenEstimate: 500
    }
  )
  checks.push(
    assert(
      snapshotTrace?.unmetNeeds.some(
        (need) => need.sourceId === 'char-1' && need.reasonCode === 'snapshot_locked'
      ),
      'a missing requirement in frozen snapshot mode is classified as snapshot_locked',
      snapshotTrace
    )
  )
  checks.push(
    assert(
      snapshotTrace?.selectionMode === 'prompt_snapshot' && snapshotTrace.budgetSummary.usedTokens === 500,
      'runtime trace retains final selection mode and actual final prompt token estimate',
      snapshotTrace
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
