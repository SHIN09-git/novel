import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function loadConsistencyModule() {
  const source = await readFile(
    join(repoRoot, 'src/renderer/src/views/promptBuilder/promptBuilderSnapshotConsistency.ts'),
    'utf8'
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  })
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
}

const modules = {
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
}

function makeSelection(chapterOrder) {
  return {
    selectedStoryBibleFields: ['worldbuilding'],
    selectedChapterIds: [`chapter-${chapterOrder - 1}`],
    selectedStageSummaryIds: [],
    selectedCharacterIds: [`character-${chapterOrder}`],
    selectedForeshadowingIds: [`foreshadowing-${chapterOrder}`],
    selectedTimelineEventIds: [],
    estimatedTokens: 800,
    omittedItems: [],
    compressionRecords: [],
    contextSelectionTrace: null,
    warnings: []
  }
}

function makeBindingInput(chapterOrder, result) {
  return {
    projectId: 'project-1',
    targetChapterOrder: chapterOrder,
    budgetMode: 'standard',
    promptMode: 'standard',
    moduleSelection: modules,
    continuityInstructions: `承接第 ${chapterOrder - 1} 章`,
    useContinuityBridge: true,
    budgetProfile: {
      id: `profile-${chapterOrder}`,
      projectId: 'project-1',
      name: '测试预算',
      maxTokens: 6000,
      mode: 'standard',
      includeRecentChaptersCount: 2,
      includeStageSummariesCount: 2,
      includeMainCharacters: true,
      includeRelatedCharacters: true,
      includeForeshadowingWeights: ['payoff'],
      includeTimelineEventsCount: 4,
      styleSampleMaxChars: 1000,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z'
    },
    budgetSelection: makeSelection(chapterOrder),
    result
  }
}

function makeResult(chapterOrder) {
  return {
    finalPrompt: `生成的第 ${chapterOrder} 章 Prompt`,
    contextSelectionResult: makeSelection(chapterOrder),
    selectedCharacterIds: [`character-${chapterOrder}`],
    selectedForeshadowingIds: [`foreshadowing-${chapterOrder}`],
    foreshadowingTreatmentOverrides: {},
    chapterTask: {
      goal: `完成第 ${chapterOrder} 章目标`,
      conflict: '',
      suspenseToKeep: '',
      allowedPayoffs: '',
      forbiddenPayoffs: '',
      endingHook: '',
      readerEmotion: '',
      targetWordCount: '3000',
      styleRequirement: ''
    },
    contextNeedPlan: null,
    storyDirectionGuide: null
  }
}

async function main() {
  const api = await loadConsistencyModule()
  const checks = []
  const originalResult = makeResult(3)
  const originalBinding = api.createPromptBuilderSnapshotBinding(makeBindingInput(3, originalResult))

  let rebuildCount = 0
  const resolvedEditedDraft = api.resolvePromptBuilderSnapshotDraft({
    ...makeBindingInput(9, makeResult(9)),
    result: undefined,
    prompt: '作者手动修改后的 Prompt',
    promptBinding: originalBinding,
    buildPromptResult: () => {
      rebuildCount += 1
      return makeResult(9)
    }
  })
  checks.push(assert(
    rebuildCount === 0 &&
      resolvedEditedDraft.prompt === '作者手动修改后的 Prompt' &&
      resolvedEditedDraft.binding.targetChapterOrder === 3 &&
      resolvedEditedDraft.binding.chapterTask.goal === '完成第 3 章目标',
    'an edited generated prompt keeps its original chapter metadata without a silent rebuild',
    { rebuildCount, resolvedEditedDraft }
  ))

  const snapshot = api.createBoundPromptContextSnapshot({
    id: 'snapshot-3',
    binding: resolvedEditedDraft.binding,
    finalPrompt: resolvedEditedDraft.prompt,
    estimatedTokens: 42,
    source: 'manual',
    note: '手动修订',
    timestamp: '2026-09-22T00:00:00.000Z'
  })
  checks.push(assert(
    snapshot.targetChapterOrder === 3 &&
      snapshot.finalPrompt === '作者手动修改后的 Prompt' &&
      snapshot.chapterTask.goal === '完成第 3 章目标',
    'snapshot text and metadata come from the same bound draft'
  ))

  let unboundBuildCount = 0
  let unboundError = ''
  try {
    api.resolvePromptBuilderSnapshotDraft({
      ...makeBindingInput(9, makeResult(9)),
      result: undefined,
      prompt: '从旧版本恢复但没有快照绑定的 Prompt',
      promptBinding: null,
      buildPromptResult: () => {
        unboundBuildCount += 1
        return makeResult(9)
      }
    })
  } catch (error) {
    unboundError = error instanceof Error ? error.message : String(error)
  }
  checks.push(assert(
    unboundBuildCount === 0 && unboundError.includes('请重新构建 Prompt'),
    'an old prompt version cannot be paired with newly rebuilt context metadata',
    { unboundBuildCount, unboundError }
  ))

  let emptyBuildCount = 0
  const resolvedEmptyDraft = api.resolvePromptBuilderSnapshotDraft({
    ...makeBindingInput(9, makeResult(9)),
    result: undefined,
    prompt: '',
    promptBinding: null,
    buildPromptResult: () => {
      emptyBuildCount += 1
      return makeResult(9)
    }
  })
  checks.push(assert(
    emptyBuildCount === 1 &&
      resolvedEmptyDraft.builtFromEmptyPrompt &&
      resolvedEmptyDraft.prompt === '生成的第 9 章 Prompt' &&
      resolvedEmptyDraft.binding.targetChapterOrder === 9,
    'an empty prompt may be built and bound once during snapshot save',
    { emptyBuildCount, resolvedEmptyDraft }
  ))

  const restoredBinding = api.createPromptBuilderSnapshotBindingFromSnapshot(snapshot, {
    promptMode: snapshot.promptMode,
    moduleSelection: snapshot.moduleSelection
  })
  checks.push(assert(
    restoredBinding.targetChapterOrder === 3 && restoredBinding.chapterTask.goal === '完成第 3 章目标',
    'snapshot restore recreates the authoritative chapter binding'
  ))

  let failedSendCount = 0
  const failedOutcome = await api.persistPromptContextSnapshotAndSend(
    snapshot,
    async () => ({ ok: false, errorMessage: 'simulated save failure' }),
    () => { failedSendCount += 1 }
  )
  checks.push(assert(
    !failedOutcome.ok && failedSendCount === 0,
    'a failed snapshot save never navigates to the pipeline',
    { failedOutcome, failedSendCount }
  ))

  const runner = api.createExclusivePromptHistoryActionRunner()
  let releaseSave
  const saveGate = new Promise((resolve) => { releaseSave = resolve })
  let saveCount = 0
  let sendCount = 0
  const memory = {
    promptContextSnapshots: [],
    contextNeedPlans: [],
    contextBudgetProfiles: []
  }
  const delayedSave = async (update) => {
    saveCount += 1
    await saveGate
    Object.assign(memory, update(memory))
    return { ok: true }
  }
  const firstRun = runner.run(() => api.persistPromptContextSnapshotAndSend(
    snapshot,
    delayedSave,
    () => { sendCount += 1 }
  ))
  await Promise.resolve()
  const duplicateRun = await runner.run(() => api.persistPromptContextSnapshotAndSend(
    snapshot,
    delayedSave,
    () => { sendCount += 1 }
  ))
  releaseSave()
  const completedRun = await firstRun
  checks.push(assert(
    !duplicateRun.started && completedRun.started && saveCount === 1 && sendCount === 1 &&
      memory.promptContextSnapshots.length === 1,
    'the exclusive action runner prevents duplicate async saves and sends',
    { duplicateRun, completedRun, saveCount, sendCount }
  ))

  const hookSource = await readFile(
    join(repoRoot, 'src/renderer/src/views/promptBuilder/usePromptBuilderHistoryActions.ts'),
    'utf8'
  )
  checks.push(assert(
    hookSource.includes('function clearHistoryFeedback()') &&
      hookSource.includes('clearHistoryFeedback,') &&
      hookSource.includes('historyError,') &&
      hookSource.includes('historyMessage,') &&
      hookSource.includes('isSaving,') &&
      hookSource.includes('persistPromptContextSnapshotAndSend') &&
      hookSource.includes('if (!saved.ok) throw new Error(saved.errorMessage)'),
    'the hook exposes UI status and gates pipeline navigation on persistence success'
  ))

  const failed = checks.filter((check) => !check.ok)
  console.log(JSON.stringify({ ok: failed.length === 0, totalChecks: checks.length, failed }, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
