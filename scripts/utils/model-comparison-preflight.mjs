import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const COMPARISON_RECIPES = ['standard', 'fast']
export const comparisonHash = (value) => createHash('sha256').update(value).digest('hex')

// Run the actual first three pipeline steps, stopping before the first model step.
// Nothing here opens storage, loads author settings or persists a cancelled job.
export async function prepareComparisonContext(api, scenario, recipeId) {
  assert(COMPARISON_RECIPES.includes(recipeId), 'Unsupported comparison recipe')
  const seed = api.normalizeAppData(structuredClone(scenario.appData))
  assert.equal(seed.settings.apiKey, '')
  assert.equal(seed.settings.hasApiKey, false)
  const prepared = api.AgentRunService.prepareSingleChapterRun({
    appData: seed, projectId: scenario.projectId, targetChapterOrder: scenario.targetChapterOrder,
    chapterTaskSnapshot: scenario.chapterTask,
    safetyMode: recipeId === 'fast' ? 'experimental' : 'standard'
  })
  const job = prepared.job
  assert.equal(job.pipelineRecipeId, recipeId)
  const project = seed.projects.find((item) => item.id === scenario.projectId)
  assert(project)
  const options = {
    targetChapterOrder: scenario.targetChapterOrder, pipelineMode: job.pipelineMode,
    estimatedWordCount: scenario.chapterTask.targetWordCount,
    readerEmotionTarget: scenario.chapterTask.readerEmotion, budgetMode: 'standard', budgetMaxTokens: 8000
  }
  let current = prepared.appData
  let reachedBoundary = false
  let modelBoundaryCalls = 0
  const stopped = new Error('Offline preparation reached the model boundary')
  const env = {
    ...options, data: current, project, scoped: api.projectData(current, project.id),
    aiSettings: seed.settings, runId: job.id,
    getAiSettings: () => seed.settings,
    getAiService: async () => { modelBoundaryCalls++; throw new Error('Offline preparation must not obtain an AI service') },
    shouldCancel: () => {
      reachedBoundary = current.chapterGenerationSteps.some((step) =>
        step.jobId === job.id && step.type === 'build_context' && step.status === 'completed')
      if (reachedBoundary) throw stopped
      return false
    },
    persistWorking: async (next) => { current = next; return next },
    updateStepInData: (data, stepId, patch, jobPatch) => ({
      ...data,
      chapterGenerationSteps: data.chapterGenerationSteps.map((step) => step.id === stepId ? { ...step, ...patch } : step),
      chapterGenerationJobs: jobPatch
        ? data.chapterGenerationJobs.map((item) => item.id === job.id ? { ...item, ...jobPatch } : item)
        : data.chapterGenerationJobs
    })
  }
  try {
    await api.runPipelineFromStepEngine(current, job.id, 'context_need_planning', options, env)
  } catch (error) {
    if (error !== stopped) throw error
  }
  assert(reachedBoundary, 'Pipeline did not finish context preparation')
  assert.equal(modelBoundaryCalls, 0)
  const steps = current.chapterGenerationSteps.filter((step) => step.jobId === job.id)
  assert.deepEqual(steps.filter((step) => step.status === 'completed').map((step) => step.type),
    ['context_need_planning', 'context_budget_selection', 'build_context'])
  assert(steps.slice(3).every((step) => step.status === 'pending'))
  assert.equal(current.generatedChapterDrafts.length, seed.generatedChapterDrafts.length)
  const trace = current.generationRunTraces.find((item) => item.jobId === job.id)
  const prompt = api.pipelineContextFromStepOutput(steps.find((step) => step.type === 'build_context').output)
  assert(trace && prompt.trim())
  const coverage = [
    ...scenario.expected.characterIds.map((id) => ({ kind: 'character', id, included: trace.selectedCharacterIds.includes(id) })),
    ...scenario.expected.stateFactIds.map((id) => ({ kind: 'character_state', id, included: trace.includedCharacterStateFactIds.includes(id) })),
    ...scenario.expected.hardCanonItemIds.map((id) => ({ kind: 'hard_canon', id, included: trace.includedHardCanonItemIds.includes(id) })),
    ...scenario.expected.timelineEventIds.map((id) => ({ kind: 'timeline', id, included: trace.selectedTimelineEventIds.includes(id) })),
    ...Object.entries(scenario.expected.foreshadowingModes).map(([id, mode]) => ({
      kind: 'foreshadowing', id, expectedMode: mode,
      included: trace.selectedForeshadowingIds.includes(id) && trace.foreshadowingTreatmentModes[id] === mode
    })),
    ...scenario.expected.bridgeFragments.map((text, i) => ({ kind: 'bridge', id: `fragment-${i + 1}`, included: prompt.includes(text) }))
  ]
  return {
    seed, prompt,
    report: {
      caseId: scenario.id, recipeId, recipeVersion: job.pipelineRecipeVersion,
      inputSha256: comparisonHash(JSON.stringify({ data: seed, task: scenario.chapterTask })),
      contextSha256: comparisonHash(prompt),
      targetChapterOrder: scenario.targetChapterOrder,
      task: scenario.chapterTask,
      stage: 'before_generate_chapter_plan', modelBoundaryCalls,
      promptTokenEstimate: trace.finalPromptTokenEstimate,
      coverage,
      promptBlockOrder: trace.promptBlockOrder,
      warnings: trace.contextWarnings,
      unmetNeeds: trace.contextSelectionTrace?.unmetNeeds ?? [],
      recipe: job.pipelineRecipe
    }
  }
}

export function comparisonReviewSheet(scenarios) {
  return {
    schemaVersion: 1, purpose: 'Author blind comparison; no scores inferred from quality gates',
    configurationRevealed: false,
    cases: scenarios.map((scenario) => ({
      caseId: scenario.id, title: scenario.title,
      rubric: scenario.rubric.map((item) => ({ ...item, candidateA: null, candidateB: null, evidence: '' })),
      preferredCandidate: null, reason: '', willingToAccept: null,
      repairInstructions: '', humanReviewMinutes: null,
      afterRevisionPreference: null, finalAcceptedVersionId: null,
      totalKnownCost: null, costCurrency: null, costCompleteness: 'unknown',
      knownCalls: null, failedCalls: null, retryCount: null, missingUsageCallIds: [],
      wallTimeMs: null
    }))
  }
}
