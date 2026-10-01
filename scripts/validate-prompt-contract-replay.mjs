import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'prompt-contract-replay-test')

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

function block(id, title, kind, priority, tokenEstimate, extra = {}) {
  return {
    id,
    title,
    kind,
    priority,
    tokenEstimate,
    source: 'test',
    sourceIds: [],
    included: true,
    compressed: false,
    forced: false,
    omittedReason: null,
    reason: `测试 ${title}`,
    ...extra
  }
}

function trace(overrides = {}) {
  return {
    id: 'trace-1',
    targetChapterOrder: 2,
    contextSource: 'auto_build',
    finalPromptTokenEstimate: 420,
    promptBlockOrder: [
      block('priority', '0. 上下文冲突优先级规则', 'priority_rules', 0, 80),
      block('writing', '1. 写作任务声明', 'writing_task', 1, 80),
      block('bridge', '2. 上一章结尾衔接 Bridge', 'continuity_bridge', 2, 100, {
        forced: true,
        sourceIds: ['bridge-1']
      }),
      block('task', '3. 本章任务契约', 'chapter_task', 3, 120),
      block('legacy', '10. 最小硬设定 HardCanonPack', 'story_bible_reference', 10, 0, {
        included: false,
        omittedReason: '已迁移到 HardCanonPack。'
      }),
      block('output', '13. 输出格式要求', 'output_format', 13, 40)
    ],
    forcedContextBlocks: [{ kind: 'continuity_bridge', sourceId: 'bridge-1', title: '上一章结尾衔接', tokenEstimate: 100 }],
    compressionRecords: [],
    contextSelectionTrace: {
      selectedBlocks: [{ blockType: 'chapter', sourceId: 'bridge-1', priority: 'must', uncertain: false, reasonCode: 'required_need', forced: true, compressed: false, tokenEstimate: 100, reason: '上一章衔接' }],
      droppedBlocks: [],
      unmetNeeds: [],
      budgetSummary: { totalBudget: 2000, usedTokens: 420, reservedTokens: 0, pressure: 'low' }
    },
    truncatedHardCanonItemIds: [],
    promptLintIssueCount: 0,
    promptLintWarnings: [],
    ...overrides
  }
}

async function main() {
  await compileTsTree([
    'src/services/TokenEstimator.ts',
    'src/services/PromptContractReplayService.ts',
    'src/services/OpeningChapterSnapshotPolicy.ts'
  ])
  const service = await import(
    `${pathToFileURL(join(outDir, 'src/services/PromptContractReplayService.mjs')).href}?t=${Date.now()}`
  )
  const snapshotPolicy = await import(
    `${pathToFileURL(join(outDir, 'src/services/OpeningChapterSnapshotPolicy.mjs')).href}?t=${Date.now()}`
  )
  const checks = []

  const openingSnapshotJob = {
    id: 'job-opening-snapshot',
    projectId: 'project-1',
    targetChapterOrder: 1,
    chapterTaskSnapshot: { goal: '从普通周六自然开场。' },
    promptContextSnapshotId: 'legacy-snapshot-1',
    contextSource: 'prompt_snapshot',
    aiRunConfig: {},
    status: 'paused',
    currentStep: 'generate_chapter_draft',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    errorMessage: ''
  }
  const isolatedOpeningJob = snapshotPolicy.enforceOpeningChapterSnapshotPolicy(openingSnapshotJob)
  checks.push(assert(
    isolatedOpeningJob.job.contextSource === 'auto' &&
      isolatedOpeningJob.job.promptContextSnapshotId === null &&
      isolatedOpeningJob.ignoredPromptContextSnapshotId === 'legacy-snapshot-1' &&
      isolatedOpeningJob.mustRebuildFromStart,
    'authoritative chapter 1 ignores legacy prompt snapshots and rebuilds clean-room context from the first step'
  ))
  const laterSnapshotJob = snapshotPolicy.enforceOpeningChapterSnapshotPolicy({ ...openingSnapshotJob, targetChapterOrder: 2 })
  checks.push(assert(
    laterSnapshotJob.job.contextSource === 'prompt_snapshot' && !laterSnapshotJob.mustRebuildFromStart,
    'later chapters keep explicit prompt snapshot behavior'
  ))

  const oldPrompt = [
    '# 第 2 章写作 Prompt',
    '## 0. 上下文冲突优先级规则',
    '1. 上一章结尾衔接 Bridge',
    '## 1. 写作任务声明',
    '续写本章。',
    '## 3. 本章任务契约',
    '推进冲突。',
    '## 13. 输出格式要求',
    '直接输出正文。'
  ].join('\n')
  checks.push(assert(!service.hasContinuityBridgeSection(oldPrompt), 'priority declaration text cannot masquerade as a continuity section'))

  const ensured = service.ensureContinuityBridgeInPrompt({
    finalPrompt: oldPrompt,
    promptBlockOrder: [
      block('priority', '0. 上下文冲突优先级规则', 'priority_rules', 0, 20),
      block('writing', '1. 写作任务声明', 'writing_task', 1, 20),
      block('task', '3. 本章任务契约', 'chapter_task', 3, 20),
      block('output', '13. 输出格式要求', 'output_format', 13, 20)
    ],
    bridgeBody: '必须接住上一章门锁正在打开的动作。',
    bridgeId: 'bridge-1',
    source: 'saved_bridge',
    reason: '测试前置补入。'
  })
  const bridgeHeadingIndex = ensured.finalPrompt.indexOf('## 2. 上一章结尾衔接 Bridge')
  const taskHeadingIndex = ensured.finalPrompt.indexOf('## 3. 本章任务契约')
  const bridgeBlockIndex = ensured.promptBlockOrder.findIndex((item) => item.kind === 'continuity_bridge')
  const taskBlockIndex = ensured.promptBlockOrder.findIndex((item) => item.kind === 'chapter_task')
  checks.push(assert(bridgeHeadingIndex >= 0 && bridgeHeadingIndex < taskHeadingIndex, 'forced continuity section is inserted before chapter task'))
  checks.push(assert(bridgeBlockIndex >= 0 && bridgeBlockIndex < taskBlockIndex, 'forced continuity block order matches final prompt order'))
  checks.push(assert(ensured.promptBlockOrder[bridgeBlockIndex].priority === 2, 'forced continuity keeps its authority priority instead of using append position'))

  const ensuredTwice = service.ensureContinuityBridgeInPrompt({
    finalPrompt: ensured.finalPrompt,
    promptBlockOrder: ensured.promptBlockOrder,
    bridgeBody: '必须接住上一章门锁正在打开的动作。',
    bridgeId: 'bridge-1',
    source: 'saved_bridge',
    reason: '测试前置补入。'
  })
  checks.push(assert((ensuredTwice.finalPrompt.match(/## 2\. 上一章结尾衔接 Bridge/g) ?? []).length === 1, 'continuity insertion is idempotent'))
  checks.push(assert(ensuredTwice.promptBlockOrder.filter((item) => item.kind === 'continuity_bridge').length === 1, 'continuity block insertion is idempotent'))

  const tailBridgePrompt = `${oldPrompt}\n\n## 上一章结尾衔接\n旧快照把 Bridge 放到了末尾。`
  const tailBridgeOrder = [
    block('priority', '0. 上下文冲突优先级规则', 'priority_rules', 0, 20),
    block('writing', '1. 写作任务声明', 'writing_task', 1, 20),
    block('task', '3. 本章任务契约', 'chapter_task', 3, 20),
    block('bridge-old', '上一章结尾衔接', 'continuity_bridge', 9, 20, { forced: true })
  ]
  const repairedTailBridge = service.ensureContinuityBridgeInPrompt({
    finalPrompt: tailBridgePrompt,
    promptBlockOrder: tailBridgeOrder,
    bridgeBody: '旧快照把 Bridge 放到了末尾。',
    bridgeId: 'bridge-1',
    source: 'prompt_context_snapshot',
    reason: '修复旧快照顺序。'
  })
  checks.push(assert(repairedTailBridge.finalPrompt.indexOf('## 上一章结尾衔接') < repairedTailBridge.finalPrompt.indexOf('## 3. 本章任务契约'), 'legacy tail-appended bridge section is moved before chapter task'))
  checks.push(assert(repairedTailBridge.promptBlockOrder.findIndex((item) => item.kind === 'continuity_bridge') < repairedTailBridge.promptBlockOrder.findIndex((item) => item.kind === 'chapter_task'), 'legacy tail-appended bridge trace order is repaired'))

  const completeReplay = service.buildPromptContractReplay(trace())
  checks.push(assert(completeReplay.status === 'complete', 'well-formed final prompt contract replays as complete', completeReplay))
  checks.push(assert(completeReplay.includedBlocks.map((item) => item.kind).join('|') === 'priority_rules|writing_task|continuity_bridge|chapter_task|output_format', 'replay preserves actual array order'))
  checks.push(assert(completeReplay.omittedBlocks.length === 1 && completeReplay.omittedBlocks[0].omittedReason, 'replay exposes omitted prompt blocks and reasons'))
  checks.push(assert(completeReplay.includedBlocks.some((item) => item.decisionReasonCodes.includes('required_need')), 'replay links structured selection reasons to prompt blocks'))

  const missingBridge = service.buildPromptContractReplay(trace({
    promptBlockOrder: trace().promptBlockOrder.filter((item) => item.kind !== 'continuity_bridge'),
    forcedContextBlocks: [],
    finalPromptTokenEstimate: 320
  }))
  checks.push(assert(missingBridge.status === 'incomplete' && missingBridge.issues.some((item) => item.code === 'missing_continuity_bridge'), 'missing bridge is a critical contract gap'))

  const highUnmet = service.buildPromptContractReplay(trace({
    contextSelectionTrace: {
      ...trace().contextSelectionTrace,
      unmetNeeds: [{ needType: 'character_state_physical', priority: 'must', uncertain: false, reasonCode: 'budget_exceeded', reason: '主角伤势未进入上下文', sourceId: 'char-1' }]
    }
  }))
  checks.push(assert(highUnmet.status === 'needs_attention' && highUnmet.issues.some((item) => item.code === 'confirmed_need_unmet'), 'confirmed must/high unmet needs are surfaced'))

  const uncertainUnmet = service.buildPromptContractReplay(trace({
    contextSelectionTrace: {
      ...trace().contextSelectionTrace,
      unmetNeeds: [{ needType: 'character_mention', priority: 'high', uncertain: true, reasonCode: 'low_relevance', reason: '角色可能只被提及', sourceId: 'char-2' }]
    }
  }))
  checks.push(assert(!uncertainUnmet.issues.some((item) => item.code === 'confirmed_need_unmet'), 'uncertain mention-only needs do not become confirmed contract warnings'))

  const opaqueSnapshot = service.buildPromptContractReplay(trace({
    contextSource: 'prompt_snapshot',
    promptBlockOrder: [block('snapshot', 'Prompt 快照全文', 'prompt_snapshot', 1, 500)],
    forcedContextBlocks: [],
    finalPromptTokenEstimate: 500
  }))
  checks.push(assert(opaqueSnapshot.status === 'needs_attention' && opaqueSnapshot.issues.some((item) => item.code === 'opaque_snapshot'), 'unstructured snapshots degrade to an explicit opaque replay instead of false missing-section errors'))

  const untrackedForced = service.buildPromptContractReplay(trace({
    forcedContextBlocks: [{ kind: 'quality_gate_issue', sourceId: 'issue-1', title: '质量修订约束', tokenEstimate: 30 }]
  }))
  checks.push(assert(untrackedForced.status === 'incomplete' && untrackedForced.issues.some((item) => item.code === 'forced_context_untracked'), 'untracked forced context is detected'))

  const compressedReplay = service.buildPromptContractReplay(trace({
    promptBlockOrder: [
      ...trace().promptBlockOrder,
      block('recent', '7. 最近章节详细回顾', 'recent_chapters', 7, 40, { compressed: true })
    ],
    compressionRecords: [{ id: 'compression-1', originalChapterOrder: 1, replacementKind: 'summary_excerpt' }],
    finalPromptTokenEstimate: 460
  }))
  checks.push(assert(!compressedReplay.issues.some((item) => item.code === 'compression_untracked'), 'tracked compression is represented without a false warning'))

  const replayJson = JSON.stringify(completeReplay)
  checks.push(assert(!replayJson.includes('"finalPrompt":') && !replayJson.includes('"generatedText":') && !replayJson.includes('bridgeBody') && !replayJson.includes('正文全文'), 'replay does not copy the full prompt or draft body'))

  const panelSource = await readFile(join(root, 'src/renderer/src/components/pipeline/PromptContractReplayPanel.tsx'), 'utf-8')
  const activeTraceSource = await readFile(join(root, 'src/renderer/src/components/pipeline/PipelineTracePanel.tsx'), 'utf-8')
  const contextPlanningSource = await readFile(join(root, 'src/renderer/src/views/generation/pipelineSteps/contextPlanning.ts'), 'utf-8')
  const chapterGenerationSource = await readFile(join(root, 'src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts'), 'utf-8')
  checks.push(assert(panelSource.includes('模型实际收到的指令') && panelSource.includes('查看最终区块顺序'), 'active UI exposes the prompt contract replay'))
  checks.push(assert(activeTraceSource.includes('<PromptContractReplayPanel trace={trace} />') && activeTraceSource.includes('高级 / 调试信息'), 'active trace panel keeps replay and advanced JSON together'))
  checks.push(assert(contextPlanningSource.includes('ensureContinuityBridgeInPrompt') && chapterGenerationSource.includes('ensureContinuityBridgeInPrompt'), 'initial and post-plan context builds share the same continuity insertion helper'))
  checks.push(assert(!contextPlanningSource.includes('state.context = `${state.context}\\n\\n## 上一章结尾衔接') && !chapterGenerationSource.includes('state.context = `${state.context}\\n\\n## 上一章结尾衔接'), 'pipeline no longer appends a missing bridge to the prompt tail'))

  let deadPanelExists = false
  try {
    await access(join(root, 'src/renderer/src/views/generation/RunTracePanel.tsx'))
    deadPanelExists = true
  } catch {
    deadPanelExists = false
  }
  checks.push(assert(!deadPanelExists, 'unused duplicate RunTracePanel has been removed'))

  const runTests = await readFile(join(root, 'scripts/run-tests.mjs'), 'utf-8')
  checks.push(assert(runTests.includes('validate-prompt-contract-replay.mjs'), 'npm test runs prompt contract replay validation'))

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
