import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const types = [
  read('src/shared/types.ts'),
  read('src/shared/types/context.ts'),
  read('src/shared/types/trace.ts')
].join('\n')
const defaults = [
  read('src/shared/defaults.ts'),
  read('src/shared/normalizers/context.ts'),
  read('src/shared/normalizers/appData.ts'),
  read('src/shared/normalizers/runTrace.ts')
].join('\n')
const planner = read('src/services/ContextNeedPlannerService.ts')
const gapAnalyzer = read('src/services/PlanContextGapAnalyzerService.ts')
const budget = [
  read('src/services/ContextBudgetManager.ts'),
  read('src/services/contextBudget/scoringEngine.ts'),
  read('src/services/contextBudget/selectionEngine.ts'),
  read('src/services/contextBudget/traceBuilder.ts')
].join('\n')
const runner = [
  read('src/renderer/src/views/generation/usePipelineRunner.ts'),
  read('src/renderer/src/views/generation/usePipelineRunnerCore.ts'),
  read('src/renderer/src/views/generation/pipelineRunnerEngine.ts'),
  read('src/renderer/src/views/generation/pipelineSteps/contextPlanning.ts'),
  read('src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts'),
  read('src/renderer/src/views/generation/pipelineUtils.ts')
].join('\n')
const authorSummary = read('src/services/RunTraceAuthorSummaryService.ts')
const runTests = read('scripts/run-tests.mjs')

assert(types.includes('export interface ContextNeedItem'), 'ContextNeedItem type is missing')
assert(types.includes('contextNeeds: ContextNeedItem[]'), 'ContextNeedPlan must expose contextNeeds')
assert(types.includes('export interface ContextSelectionTrace'), 'ContextSelectionTrace type is missing')
assert(types.includes('selectedBlocks: ContextSelectionTraceBlock[]'), 'ContextSelectionTrace.selectedBlocks is missing')
assert(types.includes('droppedBlocks: ContextSelectionTraceDroppedBlock[]'), 'ContextSelectionTrace.droppedBlocks is missing')
assert(types.includes('unmetNeeds: ContextSelectionTraceUnmetNeed[]'), 'ContextSelectionTrace.unmetNeeds is missing')
assert(types.includes('contextSelectionTrace: ContextSelectionTrace | null'), 'ContextSelectionResult / RunTrace must persist contextSelectionTrace')

assert(defaults.includes('normalizeContextNeedItem'), 'normalizeAppData must normalize ContextNeedItem')
assert(defaults.includes('normalizeContextSelectionTrace'), 'normalizeAppData must normalize ContextSelectionTrace')
assert(defaults.includes('contextNeeds: arrayOrEmpty'), 'normalizeContextNeedPlan must fill contextNeeds for old data')
assert(defaults.includes('contextSelectionTrace: normalizeContextSelectionTrace'), 'normalize must preserve contextSelectionTrace')

assert(planner.includes("'character_state',"), 'ContextNeedPlanner must emit character state needs')
assert(planner.includes("'foreshadowing',"), 'ContextNeedPlanner must emit foreshadowing needs')
assert(planner.includes("'timeline',"), 'ContextNeedPlanner must emit timeline needs')
assert(planner.includes("'hardCanon',"), 'ContextNeedPlanner must emit hard canon needs')
assert(planner.includes("'storyDirection',"), 'ContextNeedPlanner must emit story direction needs')
assert(planner.includes('hardCanonItems?: HardCanonItem[]'), 'ContextNeedPlanner must accept HardCanon items as explicit need sources')
assert(planner.includes('hardCanonNeedPriority'), 'ContextNeedPlanner must assign priority to HardCanon needs')
assert(planner.includes('hardCanonNeedReason'), 'ContextNeedPlanner must explain HardCanon need reasons')
assert(planner.includes('storyDirectionBeat'), 'ContextNeedPlanner must distinguish exact Story Direction beats')
assert(planner.includes('stateCategoryPriority'), 'ContextNeedPlanner must prioritize character state categories')
assert(planner.includes('stateCategoryReason'), 'ContextNeedPlanner must explain character state needs')
assert(planner.includes('foreshadowingNeedPriority'), 'ContextNeedPlanner must prioritize foreshadowing needs')
assert(planner.includes('timelineNeedReason'), 'ContextNeedPlanner must explain timeline anchor needs')
assert(planner.includes('priorityLevel('), 'ContextNeedPlanner needs deterministic need priorities')
assert(planner.includes('prioritizedContextNeeds'), 'ContextNeedPlanner build result must include prioritized contextNeeds')

assert(gapAnalyzer.includes('ContextNeedItem'), 'Plan gap analyzer must update structured context needs')
assert(gapAnalyzer.includes('need-plan-character-state'), 'Plan gap analyzer must add post-plan character state needs')
assert(gapAnalyzer.includes('need-plan-foreshadowing'), 'Plan gap analyzer must add post-plan foreshadowing needs')
assert(gapAnalyzer.includes('need-plan-timeline'), 'Plan gap analyzer must add post-plan timeline needs')

assert(budget.includes('buildContextSelectionTrace'), 'ContextBudgetManager must build ContextSelectionTrace')
assert(budget.includes('selection.contextSelectionTrace = buildContextSelectionTrace'), 'ContextBudgetManager must attach ContextSelectionTrace to selection')
assert(budget.includes('contextNeedPriorityScore'), 'ContextBudget scoring must convert contextNeed priority into numeric weight')
assert(budget.includes('needMatchesRetrievalType'), 'ContextBudget scoring must map contextNeeds to candidate types')
assert(budget.includes("planPriority(context, 'character_state'"), 'Character scoring must include character_state needs')
assert(budget.includes("planPriority(context, 'timeline'"), 'Timeline scoring must include timeline needs')
assert(budget.includes("planPriority(context, 'stage_summary'"), 'Stage summary scoring must include explicit plan needs')
assert(budget.includes('reasonWithNeed'), 'ContextSelectionTrace selected reasons must include need reasons')
assert(budget.includes('未满足需求'), 'ContextSelectionTrace dropped reasons must explain unmet need reasons')
assert(budget.includes("blockType === 'stageSummary'"), 'ContextSelectionTrace must account for stage summary blocks')
assert(budget.includes("blockType === 'foreshadowing'"), 'ContextSelectionTrace must account for foreshadowing blocks')
assert(budget.includes("blockType === 'hard_canon'") || budget.includes("blockType === 'hardCanon'"), 'ContextSelectionTrace must account for HardCanon blocks')
assert(budget.includes("blockType === 'story_direction'") || budget.includes("blockType === 'storyDirection'"), 'ContextSelectionTrace must account for Story Direction blocks')
assert(budget.includes('unmetNeeds'), 'ContextBudgetManager must record unmet needs')
assert(budget.includes('token 预算不足，优先省略低相关远期阶段摘要'), 'Budget trimming should drop low-value distant summaries before critical context')
assert(budget.includes('!planRequiredForeshadowingIds.has(item.id)'), 'Budget trimming must protect plan-required foreshadowings')
assert(budget.includes('requiredTimelineEventIds'), 'Budget trimming must protect plan-required timeline anchors')

const stageTrimIndex = budget.indexOf('token 预算不足，优先省略低相关远期阶段摘要')
const foreshadowingTrimIndex = budget.indexOf('const low = byId(data.foreshadowings')
assert(stageTrimIndex > 0 && foreshadowingTrimIndex > 0 && stageTrimIndex < foreshadowingTrimIndex, 'StageSummary trimming must happen before foreshadowing trimming')

assert(runner.includes('enrichContextSelectionTrace'), 'Pipeline runner must enrich ContextSelectionTrace with forced/final context blocks')
assert(runner.includes('hardCanonItems:'), 'Pipeline runner must pass HardCanon items into ContextNeedPlanner')
assert(runner.includes("blockType: 'character_state_fact'"), 'Pipeline runner must trace included character state facts')
assert(runner.includes("blockType: 'hard_canon'"), 'Pipeline runner must trace HardCanonPack entries')
assert(runner.includes('需求理由'), 'Pipeline trace enrichment must preserve author-facing need reasons')
assert(runner.includes('contextSelectionTrace'), 'Pipeline runner must write contextSelectionTrace into Run Trace')

assert(authorSummary.includes('trace.contextSelectionTrace?.unmetNeeds'), 'Author summary must read unmet context needs')
assert(authorSummary.includes('trace.contextSelectionTrace?.droppedBlocks'), 'Author summary must read dropped context blocks')
assert(authorSummary.includes('stageSummaryTokenShare'), 'Author summary must explain noisy stage summary budget pressure')
assert(authorSummary.includes('budgetPressure: tracePressure ?? pressure'), 'Author summary must prefer structured ContextSelectionTrace budget pressure')

assert(!authorSummary.includes('finalPrompt:'), 'Author summary must not copy full prompt text')
assert(!types.includes('contextSelectionTracePromptText'), 'ContextSelectionTrace must stay structural and avoid prompt/body payload storage')
assert(runTests.includes('validate-context-budget-planner.mjs'), 'npm test must run validate-context-budget-planner.mjs')

console.log('validate-context-budget-planner: ok')
