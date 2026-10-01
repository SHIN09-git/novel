#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function pathFromRoot(relativePath) {
  return join(root, relativePath)
}

function read(relativePath) {
  return readFileSync(pathFromRoot(relativePath), 'utf8')
}

function lineCount(relativePath) {
  return read(relativePath).split(/\r?\n/).length
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertExists(relativePath) {
  assert(existsSync(pathFromRoot(relativePath)), `Expected ${relativePath} to exist.`)
}

function assertLineLimit(relativePath, maxLines) {
  const lines = lineCount(relativePath)
  assert(lines <= maxLines, `${relativePath} has ${lines} lines; expected <= ${maxLines}.`)
}

function assertIncludes(relativePath, expectedText) {
  const content = read(relativePath)
  assert(content.includes(expectedText), `Expected ${relativePath} to include ${expectedText}.`)
}

function assertDoesNotInclude(relativePath, unexpectedText) {
  const content = read(relativePath)
  assert(!content.includes(unexpectedText), `Expected ${relativePath} not to include ${unexpectedText}.`)
}

const requiredFiles = [
  'src/shared/defaults.ts',
  'src/shared/chapterText.ts',
  'src/shared/appDataCollections.ts',
  'src/shared/noveltyReview.ts',
  'src/shared/defaults/index.ts',
  'src/shared/normalizers/index.ts',
  'src/shared/normalizers/appData.ts',
  'src/shared/normalizers/memoryUpdate.ts',
  'src/shared/normalizers/characterState.ts',
  'src/shared/normalizers/foreshadowing.ts',
  'src/shared/normalizers/context.ts',
  'src/shared/normalizers/contextBudget.ts',
  'src/shared/normalizers/contextNeedPlan.ts',
  'src/shared/normalizers/contextPrimitives.ts',
  'src/shared/normalizers/contextSelection.ts',
  'src/shared/normalizers/storyDirection.ts',
  'src/shared/normalizers/reports.ts',
  'src/shared/normalizers/runTrace.ts',
  'src/shared/types.ts',
  'src/shared/types/index.ts',
  'src/shared/types/project.ts',
  'src/shared/types/character.ts',
  'src/shared/types/foreshadowing.ts',
  'src/shared/types/context.ts',
  'src/shared/types/generation.ts',
  'src/shared/types/memory.ts',
  'src/shared/types/quality.ts',
  'src/shared/types/revision.ts',
  'src/shared/types/trace.ts',
  'src/services/promptFormatters/chapterFormatters.ts',
  'src/services/promptFormatters/characterFormatters.ts',
  'src/services/promptFormatters/foreshadowingFormatters.ts',
  'src/services/promptFormatters/promptUtils.ts',
  'src/services/contextBudget/scoringEngine.ts',
  'src/services/contextBudget/selectionEngine.ts',
  'src/services/contextBudget/selectionFinalizer.ts',
  'src/services/contextBudget/traceBuilder.ts',
  'src/services/contextBudget/types.ts',
  'src/services/commitBundles/commitBundleUtils.ts',
  'src/services/commitBundles/chapterCommitValidation.ts',
  'src/services/commitBundles/revisionCommitValidation.ts',
  'src/services/commitBundles/revisionCommitActor.ts',
  'src/renderer/src/views/generation/contextSelectionTraceRuntime.ts',
  'src/services/contextNeedPlanner/characterInference.ts',
  'src/services/contextNeedPlanner/characterNeeds.ts',
  'src/renderer/src/views/generation/usePipelineRunner.ts',
  'src/renderer/src/views/generation/usePipelineRunnerCore.ts',
  'src/renderer/src/views/generation/pipelineRunnerEngine.ts',
  'src/renderer/src/views/generation/pipelineStateRestore.ts',
  'src/renderer/src/views/generation/pipelineEditorialVerdict.ts',
  'src/renderer/src/views/generation/pipelineRunnerTypes.ts',
  'src/renderer/src/views/generation/pipelineRuntimeBasics.ts',
  'src/renderer/src/views/generation/pipelineStepDefinitions.ts',
  'src/renderer/src/views/generation/pipelineSteps/contextPlanning.ts',
  'src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts',
  'src/renderer/src/views/generation/pipelineSteps/postDraftAnalysis.ts',
  'src/renderer/src/views/generation/pipelineSteps/memoryExtraction.ts',
  'src/renderer/src/views/generation/pipelineSteps/consistencyReview.ts',
  'src/renderer/src/views/generation/pipelineSteps/qualityCheck.ts',
  'src/renderer/src/views/generation/GenerationPipelineConsole.tsx',
  'src/renderer/src/views/generation/generationPipelineHelpers.ts',
  'src/renderer/src/views/generation/usePipelineRevisionActions.ts',
  'src/renderer/src/views/generation/pipelineRevisionActionHandlers.ts',
  'src/renderer/src/views/generation/usePipelineTraceActions.ts',
  'src/renderer/src/views/generation/runTraceSummary.ts',
  'src/renderer/src/components/pipeline/PipelineTracePanel.tsx',
  'src/renderer/src/components/pipeline/PromptContractReplayPanel.tsx',
  'src/services/PromptContractReplayService.ts',
  'src/renderer/src/views/chapters/chapterAiCandidateActionHandlers.ts',
  'src/renderer/src/views/chapters/chapterVersionActionHandlers.ts',
  'src/renderer/src/views/chapters/chapterBodyDraftModel.ts',
  'src/renderer/src/views/chapters/useChapterBodyDraft.ts',
  'src/renderer/src/views/chapters/useChapterAiDrafts.ts',
  'src/renderer/src/views/reading/readerText.ts',
  'src/renderer/src/views/reading/readerContext.ts',
  'src/renderer/src/views/reading/useReaderNavigation.ts',
  'src/renderer/src/views/reading/ReaderChapterRail.tsx',
  'src/renderer/src/views/reading/ReaderChapterArticle.tsx',
  'src/renderer/src/views/characters/CharacterStateLogPanel.tsx',
  'src/renderer/src/components/AiRewriteMenuPortal.tsx',
  'src/renderer/src/components/aiRewriteMenuModel.ts',
  'src/renderer/src/views/revision/revisionTypeCatalog.ts',
  'src/renderer/src/views/revision/revisionStudioActionHandlers.ts',
  'src/renderer/src/views/revision/revisionStudioActionTypes.ts',
  'src/renderer/src/views/revision/revisionGenerationActions.ts',
  'src/renderer/src/views/revision/revisionVersionActions.ts',
  'src/renderer/src/views/revision/useRevisionStudioActions.ts',
  'src/renderer/src/views/revision/RevisionStudioSidebar.tsx',
  'src/renderer/src/views/revision/RevisionComparisonPanel.tsx',
  'src/renderer/src/views/promptBuilder/PromptCharacterSelectionPanel.tsx',
  'src/renderer/src/views/promptBuilder/PromptContextNeedPanel.tsx',
  'src/renderer/src/views/promptBuilder/PromptContinuityPanel.tsx',
  'src/renderer/src/views/promptBuilder/promptBuilderHistoryState.ts',
  'src/renderer/src/views/promptBuilder/usePromptBuilderHistoryActions.ts',
  'src/renderer/src/views/settings/SettingsCorePanels.tsx',
  'src/renderer/src/views/settings/SettingsDataPanels.tsx',
  'src/renderer/src/views/settings/useSettingsCredentials.ts',
  'src/renderer/src/views/settings/useSettingsStorage.ts',
  'src/renderer/src/views/settings/useSettingsBackupAndLogs.ts',
  'src/main/dataMerge/mergeCollections.ts',
  'src/main/dataMerge/mergeEntityUtils.ts',
  'src/main/dataMerge/dataFileStorage.ts',
  'src/main/dataMerge/referenceRemapping.ts',
  'src/main/ipc/appDataCredentialSanitizer.ts',
  'src/storage/sqlite/sqliteTypes.ts',
  'src/storage/sqlite/sqliteEntityMapper.ts',
  'src/storage/sqlite/sqliteBundleEntries.ts',
  'src/storage/sqlite/sqliteSchema.ts',
  'src/agent/agentReadableSummaryTypes.ts',
  'src/agent/agentProjectSummaries.ts',
  'src/agent/agentChapterSummaries.ts',
  'src/agent/agentVersionReaders.ts',
  'src/agent/agentContentReaders.ts',
  'src/agent/tools/agentToolTypes.ts',
  'src/agent/tools/agentToolDefinitions.ts',
  'src/agent/tools/agentToolArguments.ts',
  'src/agent/tools/agentToolReadHandlers.ts',
  'src/agent/tools/agentToolWriteHandlers.ts',
  'src/services/novelty/noveltyNames.ts',
  'src/services/novelty/noveltyPolicy.ts',
  'src/services/novelty/noveltyKeywords.ts',
  'src/services/novelty/noveltyText.ts',
  'src/services/novelty/noveltySemantics.ts',
  'src/services/novelty/noveltyFindings.ts',
  'src/renderer/src/utils/foreshadowingRecommendations.ts',
  'src/services/characterState/logInference.ts',
  'src/services/characterState/stateMutations.ts',
  'src/services/characterState/stateSelection.ts',
  'src/services/characterState/stateValidation.ts',
  'src/services/characterState/stateValue.ts',
  'src/services/qualityGate/evaluationMergers.ts',
  'src/services/qualityGate/localQualityRules.ts',
  'src/services/ProjectLifecycleService.ts',
  'src/services/runTraceAuthorSummary/sourceLookup.ts',
  'src/services/runTraceAuthorSummary/summaryHelpers.ts',
  'src/services/runTraceAuthorSummary/contextDiagnosis.ts',
  'src/services/ai/responseNormalizers/primitives.ts',
  'src/services/ai/responseNormalizers/characterState.ts',
  'src/services/ai/responseNormalizers/chapter.ts',
  'src/services/ai/responseNormalizers/quality.ts'
]

for (const file of requiredFiles) {
  assertExists(file)
}

assertLineLimit('src/shared/defaults.ts', 20)
assertLineLimit('src/shared/chapterText.ts', 120)
assertLineLimit('src/shared/appDataCollections.ts', 120)
assertLineLimit('src/shared/noveltyReview.ts', 120)
assertLineLimit('src/shared/types.ts', 20)
assertLineLimit('src/services/PromptBuilderService.ts', 450)
assertLineLimit('src/services/ContextBudgetManager.ts', 320)
assertLineLimit('src/services/contextBudget/selectionFinalizer.ts', 360)
assertLineLimit('src/services/ContextNeedPlannerService.ts', 370)
assertLineLimit('src/services/commitBundles/commitBundleUtils.ts', 100)
// The coordinator also records explicit review provenance; validation remains in its own module.
assertLineLimit('src/services/ChapterCommitBundleService.ts', 320)
assertLineLimit('src/services/commitBundles/chapterAcceptanceReviewValidation.ts', 120)
assertLineLimit('src/services/RevisionCommitBundleService.ts', 280)
assertLineLimit('src/services/commitBundles/chapterCommitValidation.ts', 360)
assertLineLimit('src/services/commitBundles/revisionCommitValidation.ts', 280)
assertLineLimit('src/services/commitBundles/revisionCommitActor.ts', 100)
assertLineLimit('src/services/contextNeedPlanner/characterInference.ts', 210)
assertLineLimit('src/services/contextNeedPlanner/characterNeeds.ts', 180)
assertLineLimit('src/shared/normalizers/context.ts', 20)
assertLineLimit('src/shared/normalizers/contextBudget.ts', 100)
assertLineLimit('src/shared/normalizers/contextNeedPlan.ts', 260)
assertLineLimit('src/shared/normalizers/contextPrimitives.ts', 100)
assertLineLimit('src/shared/normalizers/contextSelection.ts', 240)
assertLineLimit('src/renderer/src/views/generation/usePipelineRunner.ts', 20)
assertLineLimit('src/renderer/src/views/generation/usePipelineRunnerCore.ts', 350)
assertLineLimit('src/renderer/src/views/generation/pipelineRunnerEngine.ts', 260)
assertLineLimit('src/renderer/src/views/generation/pipelineStateRestore.ts', 120)
assertLineLimit('src/renderer/src/views/generation/pipelineEditorialVerdict.ts', 80)
assertLineLimit('src/renderer/src/views/generation/pipelineSteps/contextPlanning.ts', 320)
assertLineLimit('src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts', 450)
assertLineLimit('src/renderer/src/views/generation/pipelineSteps/postDraftAnalysis.ts', 240)
assertLineLimit('src/renderer/src/views/generation/pipelineSteps/memoryExtraction.ts', 260)
assertLineLimit('src/renderer/src/views/generation/pipelineSteps/qualityCheck.ts', 140)
assertLineLimit('src/renderer/src/views/generation/pipelineSteps/consistencyReview.ts', 80)
assertLineLimit('src/renderer/src/views/generation/pipelineUtils.ts', 180)
assertLineLimit('src/renderer/src/views/generation/contextSelectionTraceRuntime.ts', 220)
assertLineLimit('src/renderer/src/components/pipeline/PipelineTracePanel.tsx', 220)
assertLineLimit('src/renderer/src/components/pipeline/PromptContractReplayPanel.tsx', 110)
assertLineLimit('src/services/PromptContractReplayService.ts', 380)
// Includes editor receipt and navigation guards; persistence remains in the action module.
assertLineLimit('src/renderer/src/views/RevisionStudioView.tsx', 360)
// Includes snapshot binding and save feedback; history persistence remains delegated.
assertLineLimit('src/renderer/src/views/PromptBuilderView.tsx', 520)
assertLineLimit('src/renderer/src/views/ReadingView.tsx', 300)
assertLineLimit('src/renderer/src/views/CharactersView.tsx', 420)
assertLineLimit('src/renderer/src/views/ChaptersView.tsx', 490)
assertLineLimit('src/renderer/src/views/chapters/useChapterBodyDraft.ts', 290)
assertLineLimit('src/renderer/src/views/chapters/useChapterAiDrafts.ts', 170)
assertLineLimit('src/renderer/src/views/characters/CharacterStateLogPanel.tsx', 220)
assertLineLimit('src/renderer/src/views/SettingsView.tsx', 100)
assertLineLimit('src/renderer/src/views/settings/useSettingsStorage.ts', 300)
assertLineLimit('src/renderer/src/views/revision/revisionStudioActionHandlers.ts', 20)
assertLineLimit('src/renderer/src/views/revision/revisionStudioActionTypes.ts', 80)
assertLineLimit('src/renderer/src/views/revision/revisionGenerationActions.ts', 220)
assertLineLimit('src/renderer/src/views/revision/revisionVersionActions.ts', 300)
assertLineLimit('src/main/DataMergeService.ts', 380)
assertLineLimit('src/main/ipc/appDataCredentialSanitizer.ts', 90)
assertLineLimit('src/storage/SqliteStorageService.ts', 420)
assertLineLimit('src/agent/AgentReadableSummaryService.ts', 180)
assertLineLimit('src/agent/tools/AgentToolService.ts', 80)
assertLineLimit('src/services/NoveltyDetector.ts', 340)
assertLineLimit('src/services/novelty/noveltyKeywords.ts', 320)
assertLineLimit('src/services/novelty/noveltyText.ts', 140)
assertLineLimit('src/services/novelty/noveltySemantics.ts', 220)
assertLineLimit('src/services/novelty/noveltyFindings.ts', 230)
assertLineLimit('src/renderer/src/utils/foreshadowingRecommendations.ts', 60)
assertLineLimit('src/services/CharacterStateService.ts', 100)
assertLineLimit('src/services/QualityGateService.ts', 180)
assertLineLimit('src/services/ProjectLifecycleService.ts', 180)
assertLineLimit('src/services/RunTraceAuthorSummaryService.ts', 380)
assertLineLimit('src/services/runTraceAuthorSummary/contextDiagnosis.ts', 160)
assertLineLimit('src/services/ai/AIResponseNormalizer.ts', 20)

assertIncludes('src/shared/defaults.ts', "export * from './defaults/index'")
assertIncludes('src/shared/defaults.ts', "export * from './normalizers'")
assertIncludes('src/shared/types.ts', "export * from './types/index'")
assertIncludes('src/services/ContextNeedPlannerService.ts', "from './contextNeedPlanner/characterNeeds'")
assertIncludes('src/services/ChapterCommitBundleService.ts', "from './commitBundles/commitBundleUtils'")
assertIncludes('src/services/RevisionCommitBundleService.ts', "from './commitBundles/commitBundleUtils'")
assertIncludes('src/services/ChapterCommitBundleService.ts', "from './commitBundles/chapterCommitValidation'")
assertIncludes('src/services/RevisionCommitBundleService.ts', "from './commitBundles/revisionCommitValidation'")
assertIncludes('src/services/contextNeedPlanner/characterNeeds.ts', "from './characterInference'")
assertIncludes('src/shared/normalizers/context.ts', "export * from './contextBudget'")
assertIncludes('src/shared/normalizers/context.ts', "export * from './contextNeedPlan'")
assertIncludes('src/shared/normalizers/context.ts', "export * from './contextSelection'")
assertDoesNotInclude('src/services/ContextNeedPlannerService.ts', 'const OFFSCREEN_TERMS')
assertIncludes('src/renderer/src/views/generation/usePipelineRunner.ts', "export { usePipelineRunner } from './usePipelineRunnerCore'")
assertIncludes('src/renderer/src/views/generation/usePipelineRunner.ts', "from './pipelineStepDefinitions'")
assertIncludes('src/renderer/src/views/generation/usePipelineRunnerCore.ts', "from './pipelineRuntimeBasics'")
assertDoesNotInclude('src/renderer/src/views/generation/usePipelineRunnerCore.ts', "from './pipelineUtils'")
assertIncludes('src/renderer/src/views/generation/usePipelineRunnerCore.ts', "import('./pipelineRunnerEngine')")
assertDoesNotInclude('src/renderer/src/views/generation/usePipelineRunnerCore.ts', "from './pipelineRunnerEngine'")
assertIncludes('src/renderer/src/views/generation/pipelineRunnerEngine.ts', "import('./pipelineSteps/contextPlanning')")
assertIncludes('src/renderer/src/views/generation/pipelineRunnerEngine.ts', "import('./pipelineSteps/chapterGeneration')")
assertIncludes('src/renderer/src/views/generation/pipelineRunnerEngine.ts', "import('./pipelineSteps/memoryExtraction')")
assertIncludes('src/renderer/src/views/generation/pipelineRunnerEngine.ts', "import('./pipelineSteps/qualityCheck')")
assertIncludes('src/renderer/src/views/generation/pipelineRunnerEngine.ts', "import('./pipelineSteps/consistencyReview')")
assertDoesNotInclude('src/renderer/src/views/generation/pipelineRunnerEngine.ts', "from './pipelineSteps/qualityCheck'")
assertIncludes('src/renderer/src/views/GenerationPipelineView.tsx', "from './generation/GenerationPipelineConsole'")
assertIncludes('src/renderer/src/views/GenerationPipelineView.tsx', "from './generation/usePipelineRevisionActions'")
assertIncludes('src/renderer/src/views/GenerationPipelineView.tsx', "from './generation/usePipelineTraceActions'")
assertIncludes('src/renderer/src/views/generation/usePipelineRevisionActions.ts', "import('./pipelineRevisionActionHandlers')")
assertIncludes('src/renderer/src/views/generation/pipelineRevisionActionHandlers.ts', "from './generationPipelineHelpers'")
assertIncludes('src/renderer/src/views/generation/pipelineRevisionActionHandlers.ts', "import('./revisionCandidateContext')")
assertIncludes('src/renderer/src/views/generation/usePipelineTraceActions.ts', "from './runTraceSummary'")
assertIncludes('src/renderer/src/components/pipeline/PipelineTracePanel.tsx', "from './PromptContractReplayPanel'")
assertIncludes('src/renderer/src/components/pipeline/PipelineTracePanel.tsx', "from '../../views/generation/runTraceSummary'")
assertIncludes('src/renderer/src/views/ChaptersView.tsx', "import('./chapters/ChapterAIDraftPanels')")
assertIncludes('src/renderer/src/views/ChaptersView.tsx', "import('./chapters/ChapterVersionHistoryPanel')")
assertIncludes('src/renderer/src/views/ChaptersView.tsx', "import('./chapters/ChapterReviewPanel')")
assertIncludes('src/renderer/src/views/ChaptersView.tsx', "from './chapters/useChapterBodyDraft'")
assertIncludes('src/renderer/src/views/ChaptersView.tsx', "from './chapters/useChapterAiDrafts'")
assertIncludes('src/renderer/src/views/chapters/useChapterVersionActions.ts', "import('./chapterVersionActionHandlers')")
assertIncludes('src/renderer/src/views/chapters/useChapterCharacterActions.ts', "import('./chapterAiCandidateActionHandlers')")
assertIncludes('src/renderer/src/views/chapters/useChapterForeshadowingActions.ts', "import('./chapterAiCandidateActionHandlers')")
assertIncludes('src/renderer/src/views/ReadingView.tsx', "from './reading/useReaderNavigation'")
assertIncludes('src/renderer/src/views/ReadingView.tsx', 'ReaderChapterRail')
assertIncludes('src/renderer/src/views/ReadingView.tsx', 'ReaderChapterArticle')
assertIncludes('src/renderer/src/views/ReadingView.tsx', 'AiRewriteMenuPortal')
assertDoesNotInclude('src/renderer/src/views/ReadingView.tsx', 'createPortal')
assertIncludes('src/renderer/src/views/CharactersView.tsx', 'CharacterStateLogPanel')
assertDoesNotInclude('src/renderer/src/views/CharactersView.tsx', 'className="panel character-log-panel"')
assertIncludes('src/renderer/src/views/RevisionStudioView.tsx', "from './revision/useRevisionStudioActions'")
assertIncludes('src/renderer/src/views/RevisionStudioView.tsx', "from './revision/RevisionStudioSidebar'")
assertIncludes('src/renderer/src/views/RevisionStudioView.tsx', "from './revision/RevisionComparisonPanel'")
assertIncludes('src/renderer/src/views/revision/useRevisionStudioActions.ts', "import('./revisionGenerationActions')")
assertIncludes('src/renderer/src/views/revision/useRevisionStudioActions.ts', "import('./revisionVersionActions')")
assertIncludes('src/renderer/src/views/revision/revisionStudioActionHandlers.ts', "export * from './revisionGenerationActions'")
assertIncludes('src/renderer/src/views/revision/revisionStudioActionHandlers.ts', "export * from './revisionVersionActions'")
assertIncludes('src/renderer/src/views/revision/revisionVersionActions.ts', 'await persistEditedVersionBody(context)')
assertDoesNotInclude('src/renderer/src/views/revision/revisionGenerationActions.ts', 'RevisionCommitBundleService')
assertDoesNotInclude('src/renderer/src/views/revision/revisionVersionActions.ts', 'generateRevision(')
assertDoesNotInclude('src/renderer/src/views/RevisionStudioView.tsx', 'buildRevisionCommitBundle')
assertDoesNotInclude('src/renderer/src/views/RevisionStudioView.tsx', 'mergeLocalRevisionSafely')
assertIncludes('src/renderer/src/views/PromptBuilderView.tsx', "from './promptBuilder/PromptContextNeedPanel'")
assertIncludes('src/renderer/src/views/PromptBuilderView.tsx', "from './promptBuilder/PromptContinuityPanel'")
assertIncludes('src/renderer/src/views/PromptBuilderView.tsx', "from './promptBuilder/PromptCharacterSelectionPanel'")
assertIncludes('src/renderer/src/views/PromptBuilderView.tsx', 'restorePromptBuilderFromSnapshot')
assertIncludes('src/renderer/src/views/PromptBuilderView.tsx', 'usePromptBuilderHistoryActions')
assertIncludes('src/renderer/src/views/PromptBuilderView.tsx', 'setSelectedCharacterIds((current) => toggleId(current, characterId, checked))')
assertIncludes('src/renderer/src/views/PromptBuilderView.tsx', "role === 'forbidden' && checked")
assertIncludes('src/renderer/src/views/promptBuilder/PromptHistoryPanels.tsx', 'onLoadSnapshot(snapshot)')
assertIncludes('src/renderer/src/views/promptBuilder/PromptHistoryPanels.tsx', 'onLoadPromptVersion(version)')
assertDoesNotInclude('src/renderer/src/views/promptBuilder/PromptContextNeedPanel.tsx', '.slice(0, 12)')
assertIncludes('src/renderer/src/views/promptBuilder/usePromptBuilderHistoryActions.ts', 'await persistPromptContextSnapshot(prepared.snapshot, options.saveData)')
assertIncludes('src/renderer/src/views/promptBuilder/promptBuilderSnapshotConsistency.ts', 'promptContextSnapshots: [snapshot, ...current.promptContextSnapshots]')
assertIncludes('src/renderer/src/views/promptBuilder/usePromptBuilderHistoryActions.ts', 'task: binding.chapterTask')
assertIncludes('src/renderer/src/views/promptBuilder/usePromptBuilderHistoryActions.ts', 'chapterTask: options.promptVersionSource?.task ?? options.task')
assertIncludes('src/renderer/src/views/SettingsView.tsx', "from './settings/useSettingsStorage'")
assertIncludes('src/renderer/src/views/SettingsView.tsx', "from './settings/useSettingsCredentials'")
assertIncludes('src/renderer/src/views/SettingsView.tsx', "from './settings/useSettingsBackupAndLogs'")
assertIncludes('src/renderer/src/views/settings/useSettingsStorage.ts', 'runPersistedStorageOperation(')
assertIncludes('src/renderer/src/views/settings/useSettingsStorage.ts', '{ persistCurrentFirst: true }')
assertDoesNotInclude('src/renderer/src/views/settings/useSettingsStorage.ts', 'await options.replaceData(result.data')
assertIncludes('src/renderer/src/views/settings/useSettingsStorage.ts', 'setTransferMessage(`导入失败：')
assertIncludes('src/renderer/src/views/settings/SettingsDataPanels.tsx', 'disabled={storage.storageBusy}')
assertIncludes('src/main/DataMergeService.ts', "from './dataMerge/mergeCollections'")
assertIncludes('src/main/DataMergeService.ts', "from './dataMerge/mergeEntityUtils'")
assertIncludes('src/main/DataMergeService.ts', "from './dataMerge/dataFileStorage'")
assertDoesNotInclude('src/main/DataMergeService.ts', 'new SqliteStorageService')
assertDoesNotInclude('src/main/DataMergeService.ts', 'new JsonStorageService')
assertIncludes('src/storage/SqliteStorageService.ts', "from './sqlite/sqliteBundleEntries'")
assertIncludes('src/storage/SqliteStorageService.ts', "from './sqlite/sqliteEntityMapper'")
assertIncludes('src/storage/SqliteStorageService.ts', "from './sqlite/sqliteSchema'")
assertIncludes('src/storage/SqliteStorageService.ts', 'private async saveEntityBundle<TContext>(')
assertIncludes('src/storage/SqliteStorageService.ts', 'entries = buildEntries(existing)')
assertDoesNotInclude('src/storage/SqliteStorageService.ts', 'function bundleEntityEntries(')
assertDoesNotInclude('src/storage/SqliteStorageService.ts', 'CREATE TABLE IF NOT EXISTS entities')
assertIncludes('src/agent/AgentReadableSummaryService.ts', "from './agentProjectSummaries'")
assertIncludes('src/agent/AgentReadableSummaryService.ts', "from './agentChapterSummaries'")
assertIncludes('src/agent/AgentReadableSummaryService.ts', "from './agentVersionReaders'")
assertIncludes('src/agent/AgentReadableSummaryService.ts', "from './agentContentReaders'")
assertDoesNotInclude('src/agent/AgentReadableSummaryService.ts', 'data.qualityGateReports.filter')
assertIncludes('src/agent/tools/AgentToolService.ts', "from './agentToolReadHandlers'")
assertIncludes('src/agent/tools/AgentToolService.ts', "from './agentToolWriteHandlers'")
assertDoesNotInclude('src/agent/tools/AgentToolService.ts', 'saveAgentChapterCommitBundle')
assertIncludes('src/services/NoveltyDetector.ts', "from './novelty/noveltyPolicy'")
assertIncludes('src/services/NoveltyDetector.ts', "from './novelty/noveltySemantics'")
assertIncludes('src/services/NoveltyDetector.ts', "from './novelty/noveltyFindings'")
assertDoesNotInclude('src/renderer/src/views/ForeshadowingView.tsx', "from '../utils/promptContext'")
assertIncludes('src/renderer/src/views/ForeshadowingView.tsx', "from '../utils/foreshadowingRecommendations'")
assertIncludes('src/services/CharacterStateService.ts', "from './characterState/stateMutations'")
assertIncludes('src/services/QualityGateService.ts', "from './qualityGate/localQualityRules'")
assertIncludes('src/services/RunTraceAuthorSummaryService.ts', "from './runTraceAuthorSummary/sourceLookup'")
assertIncludes('src/services/RunTraceAuthorSummaryService.ts', "from './runTraceAuthorSummary/summaryHelpers'")
assertIncludes('src/services/RunTraceAuthorSummaryService.ts', "from './runTraceAuthorSummary/contextDiagnosis'")
assertIncludes('src/services/ai/AIResponseNormalizer.ts', "from './responseNormalizers/chapter'")
assertIncludes('src/services/ai/AIResponseNormalizer.ts', "from './responseNormalizers/quality'")

assertIncludes('src/services/PromptBuilderService.ts', "from './promptFormatters/chapterFormatters'")
assertIncludes('src/services/PromptBuilderService.ts', "from './promptFormatters/characterFormatters'")
assertIncludes('src/services/PromptBuilderService.ts', "from './promptFormatters/foreshadowingFormatters'")
assertIncludes('src/services/ContextBudgetManager.ts', "from './contextBudget/scoringEngine'")
assertIncludes('src/services/ContextBudgetManager.ts', "from './contextBudget/selectionEngine'")
assertIncludes('src/services/ContextBudgetManager.ts', "from './contextBudget/selectionFinalizer'")
assertIncludes('src/services/contextBudget/selectionFinalizer.ts', "from './traceBuilder'")
assertIncludes('src/renderer/src/views/generation/pipelineUtils.ts', "from './contextSelectionTraceRuntime'")

assertDoesNotInclude('src/renderer/src/views/generation/usePipelineRunner.ts', 'runPipelineFromStep')
assertIncludes('src/main/services/AIService.ts', 'AITransportService')
assertIncludes('src/services/AIService.ts', 'AIWorkflowService')

console.log('Core modularization validation passed.')
