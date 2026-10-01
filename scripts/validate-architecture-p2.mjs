#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot

function read(path) {
  return readFileSync(join(root, path), 'utf-8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function contains(text, pattern, message) {
  const ok = pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)
  assert(ok, message)
}

const rateLimiterPath = 'src/main/RateLimiter.ts'
assert(existsSync(join(root, rateLimiterPath)), 'RateLimiter.ts must exist.')
const rateLimiter = read(rateLimiterPath)
contains(rateLimiter, 'TokenBucketRateLimiter', 'TokenBucketRateLimiter class must be defined.')
contains(rateLimiter, 'async acquire', 'Rate limiter must expose async acquire().')
contains(rateLimiter, 'getAvailableTokens', 'Rate limiter must expose getAvailableTokens().')

const validationPath = 'src/shared/validation.ts'
assert(existsSync(join(root, validationPath)), 'shared validation helper must exist.')
const validation = read(validationPath)
for (const symbol of ['ValidationError', 'validateString', 'validateNumber', 'validateApiKey', 'validateUrl', 'validateFilePath']) {
  contains(validation, symbol, `validation helper must export ${symbol}.`)
}
contains(validation, 'trim?: boolean', 'validateString must support preserving prompt/export text whitespace.')

const mainIndex = read('src/main/index.ts')
contains(mainIndex, "import { TokenBucketRateLimiter } from './RateLimiter'", 'main process must import TokenBucketRateLimiter.')
contains(mainIndex, "import { AIService } from './services/AIService'", 'main process must import AIService.')
contains(mainIndex, 'aiRateLimiters', 'main process must create AI rate limiters.')
contains(mainIndex, /openai:\s*new TokenBucketRateLimiter/, 'OpenAI provider must have a limiter.')
contains(mainIndex, /compatible:\s*new TokenBucketRateLimiter/, 'Compatible provider must have a limiter.')
contains(mainIndex, 'new AIService(credentialService, aiRateLimiters)', 'main process must instantiate AIService with credentials and rate limiters.')
contains(mainIndex, 'registerIpcHandlers({', 'main process must register IPC handlers.')
contains(mainIndex, 'aiService', 'IPC context must receive AIService.')

const ipcHandlers = read('src/main/ipc/registerIpcHandlers.ts')
const aiIpcHandlers = read('src/main/ipc/aiIpcHandlers.ts')
const backupIpcHandlers = read('src/main/ipc/backupIpcHandlers.ts')
const credentialIpcHandlers = read('src/main/ipc/credentialIpcHandlers.ts')
const dataIpcHandlers = read('src/main/ipc/dataIpcHandlers.ts')
const aiChatValidation = read('src/main/ipc/aiChatValidation.ts')
const storagePathHelper = read('src/main/ipc/storagePath.ts')
const storageDataOperations = read('src/main/ipc/storageDataOperations.ts')
const appDataCredentialSanitizer = read('src/main/ipc/appDataCredentialSanitizer.ts')
const storageManagementIpcHandlers = read('src/main/ipc/storageManagementIpcHandlers.ts')
const diagnosticsIpcHandlers = read('src/main/ipc/diagnosticsIpcHandlers.ts')
const utilityIpcHandlers = read('src/main/ipc/utilityIpcHandlers.ts')
contains(ipcHandlers, "import type { IAIService } from '../services/AIService'", 'IPC handlers must depend on the AI service interface.')
contains(ipcHandlers, 'aiService: IAIService', 'IPC context must include AIService instead of AI HTTP internals.')
contains(ipcHandlers, "from './aiIpcHandlers'", 'IPC handlers must delegate AI chat registration to a helper.')
contains(aiIpcHandlers, "from './aiChatValidation'", 'AI IPC handlers must delegate AI chat request validation to a helper.')
contains(aiChatValidation, 'validateChatCompletionRequest', 'AI request validator must be present.')
contains(aiChatValidation, 'validateChatMessages', 'AI message validator must be present.')
contains(utilityIpcHandlers, "trim: false", 'Export/clipboard text validation must preserve meaningful whitespace.')
contains(ipcHandlers, "from './credentialIpcHandlers'", 'IPC handlers must delegate credential registration to a helper.')
contains(credentialIpcHandlers, 'validateApiKey', 'API key validation must be used in credential IPC handlers.')
contains(aiChatValidation, 'validateUrl', 'Base URL validation must be used.')
contains(aiChatValidation, 'validateNumber', 'Numeric AI setting validation must be used.')
contains(ipcHandlers, "from './storageManagementIpcHandlers'", 'IPC handlers must delegate storage path management to a helper.')
contains(storageManagementIpcHandlers, "from './storagePath'", 'Storage management IPC must delegate path validation to a helper.')
contains(storagePathHelper, 'validateFilePath(rawPath', 'Storage path validation must be used.')
contains(storageManagementIpcHandlers, "from './storageDataOperations'", 'Storage management IPC must delegate migration operations to a helper.')
contains(dataIpcHandlers, "from './appDataCredentialSanitizer'", 'Data IPC must delegate AppData credential sanitization to a pure helper.')
contains(dataIpcHandlers, "from './storageDataOperations'", 'Data IPC must delegate automatic backups to a storage helper.')
contains(appDataCredentialSanitizer, 'secureAndSanitizeAppData', 'Credential sanitizer must own AppData credential sanitization.')
contains(storageDataOperations, 'migrateStoragePath', 'Storage data helper must own storage migration.')
contains(storageDataOperations, 'backupFileForOverwrite', 'Storage migration must preserve overwrite backups.')
assert(!ipcHandlers.includes('async function secureAndSanitizeAppData'), 'IPC handlers should not inline AppData credential sanitization.')
assert(!ipcHandlers.includes('async function migrateStoragePath'), 'IPC handlers should not inline storage migration implementation.')
contains(ipcHandlers, "from './diagnosticsIpcHandlers'", 'IPC handlers must delegate diagnostics registrations to a helper.')
contains(diagnosticsIpcHandlers, 'DIAGNOSTICS_ANALYZE_REDUNDANCY', 'Diagnostics IPC helper must register redundancy diagnostics.')
contains(diagnosticsIpcHandlers, 'DIAGNOSTICS_AUDIT_NOVELTY', 'Diagnostics IPC helper must register novelty diagnostics.')
contains(diagnosticsIpcHandlers, 'DIAGNOSTICS_EVALUATE_QUALITY_GATE', 'Diagnostics IPC helper must register quality gate diagnostics.')
assert(!ipcHandlers.includes('IPC_CHANNELS.DIAGNOSTICS_ANALYZE_REDUNDANCY'), 'IPC handlers should not inline diagnostics channels.')
contains(ipcHandlers, 'registerAiIpcHandlers(context.aiService)', 'Main IPC must register AI IPC handlers with AIService.')
contains(ipcHandlers, 'registerCredentialIpcHandlers(context.credentialService)', 'Main IPC must register credential IPC handlers with secure storage.')
contains(aiIpcHandlers, 'const validated = validateChatCompletionRequest(request)', 'AI chat completion IPC must validate the request before delegation.')
contains(aiIpcHandlers, 'aiService.chatCompletion(validateChatRequestCallId(request, validated))', 'AI chat completion IPC must delegate validated request and call identity to AIService.')
assert(!ipcHandlers.includes('IPC_CHANNELS.AI_CHAT_COMPLETION'), 'Main IPC should not inline AI chat completion.')
assert(!ipcHandlers.includes('IPC_CHANNELS.CREDENTIALS_SET_API_KEY'), 'Main IPC should not inline credential handlers.')
contains(ipcHandlers, "from './backupIpcHandlers'", 'IPC handlers must delegate backup registrations to a helper.')
contains(ipcHandlers, 'registerBackupIpcHandlers(context)', 'Main IPC must register backup handlers with storage context.')
for (const channel of ['BACKUP_CREATE', 'BACKUP_LIST', 'BACKUP_RESTORE', 'BACKUP_DELETE', 'BACKUP_OPEN_FOLDER']) {
  contains(backupIpcHandlers, `IPC_CHANNELS.${channel}`, `Backup IPC helper must register ${channel}.`)
  assert(!ipcHandlers.includes(`IPC_CHANNELS.${channel}`), `Main IPC should not inline ${channel}.`)
}
contains(ipcHandlers, "from './utilityIpcHandlers'", 'IPC handlers must delegate desktop utility registrations to a helper.')
contains(ipcHandlers, 'registerUtilityIpcHandlers()', 'Main IPC must register desktop utility handlers.')
for (const channel of ['LOGS_GET_PATH', 'LOGS_OPEN', 'EXPORT_SAVE_TEXT_FILE', 'EXPORT_SAVE_MARKDOWN_FILE', 'CLIPBOARD_WRITE_LEGACY', 'CLIPBOARD_WRITE_TEXT']) {
  contains(utilityIpcHandlers, `IPC_CHANNELS.${channel}`, `Utility IPC helper must register ${channel}.`)
  assert(!ipcHandlers.includes(`IPC_CHANNELS.${channel}`), `Main IPC should not inline ${channel}.`)
}
contains(ipcHandlers, "from './dataIpcHandlers'", 'IPC handlers must delegate data persistence registrations to a helper.')
contains(ipcHandlers, 'registerDataIpcHandlers(context)', 'Main IPC must register data persistence handlers.')
for (const channel of ['STORAGE_GET', 'STORAGE_SAVE', 'STORAGE_EXPORT', 'STORAGE_IMPORT', 'DATA_SAVE_GENERATION_RUN_BUNDLE', 'DATA_SAVE_CHAPTER_COMMIT_BUNDLE', 'DATA_SAVE_REVISION_COMMIT_BUNDLE']) {
  contains(dataIpcHandlers, `IPC_CHANNELS.${channel}`, `Data IPC helper must register ${channel}.`)
  assert(!ipcHandlers.includes(`IPC_CHANNELS.${channel}`), `Main IPC should not inline ${channel}.`)
}
contains(dataIpcHandlers, 'createBackup(currentSnapshot.data, false)', 'JSON import must back up the coherent current snapshot before replacement or merge.')
contains(ipcHandlers, 'registerStorageManagementIpcHandlers(context)', 'Main IPC must register storage management handlers.')
for (const channel of ['APP_GET_STORAGE_PATH', 'APP_SELECT_STORAGE_PATH', 'APP_MIGRATE_STORAGE_PATH', 'APP_CREATE_MIGRATION_MERGE_PREVIEW', 'APP_CONFIRM_MIGRATION_MERGE', 'APP_RESET_STORAGE_PATH', 'APP_OPEN_STORAGE_FOLDER']) {
  contains(storageManagementIpcHandlers, `IPC_CHANNELS.${channel}`, `Storage management IPC helper must register ${channel}.`)
  assert(!ipcHandlers.includes(`IPC_CHANNELS.${channel}`), `Main IPC should not inline ${channel}.`)
}
assert(!ipcHandlers.includes('ipcMain.handle'), 'Main IPC entry should remain a pure registration orchestrator.')

const aiService = read('src/main/services/AIService.ts')
contains(aiService, 'limiter.acquire()', 'AIService must acquire a rate limiter token.')
contains(aiService, 'providerUsesApiKey(settings.apiProvider) ? this.rateLimiters[settings.apiProvider] : null', 'Local and Codex CLI providers must bypass remote API rate limiting.')
assert(/sanitizeAiErrorText\(\s*message\s*,\s*apiKey\s*(?:,|\))/.test(aiService), 'AI errors must be redacted with the request key after validation/network failures.')
contains(aiService, 'retryWithBackoff', 'AIService must own AI retry behavior.')

const aiHttpClient = read('src/main/services/AIHttpClient.ts')
contains(aiHttpClient, 'postWithFallback', 'AIHttpClient must own response_format fallback behavior.')
contains(aiHttpClient, 'AbortController', 'AIHttpClient must apply request timeout control.')

const errorBoundaryPath = 'src/renderer/src/components/ErrorBoundary.tsx'
assert(existsSync(join(root, errorBoundaryPath)), 'React ErrorBoundary component must exist.')
const errorBoundary = read(errorBoundaryPath)
contains(errorBoundary, 'componentDidCatch', 'ErrorBoundary must implement componentDidCatch.')
contains(errorBoundary, 'getDerivedStateFromError', 'ErrorBoundary must implement getDerivedStateFromError.')

const rendererMain = read('src/renderer/src/main.tsx')
contains(rendererMain, "import { ErrorBoundary } from './components/ErrorBoundary'", 'Renderer entry must import ErrorBoundary.')
contains(rendererMain, '<ErrorBoundary>', 'Renderer tree must be wrapped by ErrorBoundary.')

const app = read('src/renderer/src/App.tsx')
contains(app, "import { ErrorBoundary } from './components/ErrorBoundary'", 'App must import ErrorBoundary for lazy views.')
contains(app, '<ErrorBoundary', 'Current view rendering must be wrapped by ErrorBoundary.')
contains(app, '<Suspense', 'Lazy views must still be rendered inside Suspense.')

const useProjectDataHookPath = 'src/renderer/src/hooks/useProjectData.ts'
assert(existsSync(join(root, useProjectDataHookPath)), 'useProjectData hook must exist for memoized project-scoped render data.')
const useProjectDataHook = read(useProjectDataHookPath)
contains(useProjectDataHook, 'useMemo', 'useProjectData must memoize project-scoped data.')
contains(useProjectDataHook, 'projectData(data, projectId)', 'useProjectData must delegate to the canonical projectData selector.')

const projectScopedRenderViews = [
  'src/renderer/src/views/BibleView.tsx',
  'src/renderer/src/views/DashboardView.tsx',
  'src/renderer/src/views/CharactersView.tsx',
  'src/renderer/src/views/ChaptersView.tsx',
  'src/renderer/src/views/ForeshadowingView.tsx',
  'src/renderer/src/views/TimelineView.tsx',
  'src/renderer/src/views/StageSummaryView.tsx',
  'src/renderer/src/views/GenerationPipelineView.tsx',
  'src/renderer/src/views/PromptBuilderView.tsx',
  'src/renderer/src/views/RevisionStudioView.tsx',
  'src/renderer/src/views/StoryDirectionView.tsx',
  'src/renderer/src/views/ReadingView.tsx',
  'src/renderer/src/views/HardCanonView.tsx',
  'src/renderer/src/views/AgentRunsView.tsx'
]
for (const file of projectScopedRenderViews) {
  const source = read(file)
  contains(source, 'useProjectData(data, project.id)', `${file} must use memoized project-scoped data during render.`)
  assert(!source.includes('projectData(data, project.id)'), `${file} must not rescan project data directly during render.`)
}

const generationPipelineView = read('src/renderer/src/views/GenerationPipelineView.tsx')
const memoryCandidatesHook = read('src/renderer/src/views/generation/useMemoryCandidates.ts')
const pipelineRunnerCore = read('src/renderer/src/views/generation/usePipelineRunnerCore.ts')
const pipelineConfigState = read('src/renderer/src/views/generation/usePipelineConfigState.ts')
assert(existsSync(join(root, 'src/renderer/src/views/generation/usePipelineRevisionActions.ts')), 'Pipeline revision actions hook must exist.')
assert(existsSync(join(root, 'src/renderer/src/views/generation/usePipelineTraceActions.ts')), 'Pipeline trace actions hook must exist.')
assert(existsSync(join(root, 'src/renderer/src/views/generation/useSelectedPipelineJob.ts')), 'Pipeline selected job hook must exist.')
assert(existsSync(join(root, 'src/renderer/src/views/generation/usePipelineConfigState.ts')), 'Pipeline config state hook must exist.')
assert(existsSync(join(root, 'src/renderer/src/views/generation/usePipelinePrimaryAction.ts')), 'Pipeline primary action hook must exist.')
assert(existsSync(join(root, 'src/renderer/src/views/generation/memoryCandidateActions.ts')), 'Memory candidate action helper must exist.')
contains(generationPipelineView, 'usePipelineRevisionActions', 'GenerationPipelineView must delegate revision actions to a hook.')
contains(generationPipelineView, 'usePipelineTraceActions', 'GenerationPipelineView must delegate Run Trace actions to a hook.')
contains(generationPipelineView, 'useSelectedPipelineJob', 'GenerationPipelineView must delegate selected job derivation to a hook.')
contains(generationPipelineView, 'usePipelineConfigState', 'GenerationPipelineView must delegate config and snapshot state to a hook.')
contains(generationPipelineView, 'usePipelinePrimaryAction', 'GenerationPipelineView must delegate primary action routing to a hook.')
assert(!generationPipelineView.includes('AIService'), 'GenerationPipelineView should not import or construct AIService directly.')
contains(pipelineConfigState, 'previousProjectIdRef', 'Pipeline config state must detect project switches.')
contains(pipelineConfigState, 'setTargetChapterOrder(nextChapter)', 'Pipeline config state must reset target chapter when switching projects.')
contains(pipelineConfigState, "setContextSource(initialSnapshotId ? 'prompt_snapshot' : 'auto')", 'Pipeline config state must reset context source when switching projects.')
contains(pipelineConfigState, 'selectedSnapshotId && !snapshots.some', 'Pipeline config state must clear stale snapshot selections.')
contains(pipelineConfigState, 'selectedJobId && !jobs.some', 'Pipeline config state must clear stale job selections.')
assert(!pipelineRunnerCore.includes("import { AIService }"), 'Pipeline runner core should lazy-load AIService instead of statically importing it.')
contains(pipelineRunnerCore, "await import('../../../../services/AIService')", 'Pipeline runner core must lazy-load AIService for actual pipeline execution.')
contains(pipelineRunnerCore, 'getAiService', 'Pipeline runner core must pass a lazy AI service provider into step handlers.')
assert(!generationPipelineView.includes('resolveRevisionCandidateContext'), 'GenerationPipelineView should not own revision candidate context rebuilding.')
assert(!generationPipelineView.includes('buildRunTraceAuthorSummary'), 'GenerationPipelineView should not own author summary construction.')
assert(!generationPipelineView.includes('scoped.generatedChapterDrafts.filter'), 'GenerationPipelineView should not derive selected drafts directly.')
assert(!generationPipelineView.includes('scoped.memoryUpdateCandidates.filter'), 'GenerationPipelineView should not derive selected memory candidates directly.')
assert(!generationPipelineView.includes('scoped.consistencyReviewReports.filter'), 'GenerationPipelineView should not derive selected consistency reports directly.')
assert(!generationPipelineView.includes('scoped.qualityGateReports.filter'), 'GenerationPipelineView should not derive selected quality reports directly.')
assert(!generationPipelineView.includes('scoped.generationRunTraces.find'), 'GenerationPipelineView should not derive selected Run Trace directly.')
assert(!generationPipelineView.includes('new Map(selectedReports.flatMap'), 'GenerationPipelineView should not build consistency issue lookup maps directly.')
assert(!generationPipelineView.includes('loadReaderEmotionState'), 'GenerationPipelineView should not own reader emotion preset storage.')
assert(!generationPipelineView.includes('rememberReaderEmotionTarget'), 'GenerationPipelineView should not own reader emotion preset persistence.')
assert(!generationPipelineView.includes('addReaderEmotionPreset('), 'GenerationPipelineView should not own reader emotion preset creation.')
assert(!generationPipelineView.includes('setSelectedSnapshotId'), 'GenerationPipelineView should not own prompt snapshot selection state.')
assert(!generationPipelineView.includes('function firstFailedStep'), 'GenerationPipelineView should not own primary action failed-step lookup.')
assert(!generationPipelineView.includes('function pendingMemoryCandidateCount'), 'GenerationPipelineView should not own primary action memory candidate counting.')
assert(!generationPipelineView.includes('function primaryActionLabel'), 'GenerationPipelineView should not own primary action label routing.')
assert(!generationPipelineView.includes('function runPrimaryAction'), 'GenerationPipelineView should not own primary action execution routing.')
contains(memoryCandidatesHook, 'resolveApplicableMemoryPatch', 'useMemoryCandidates must delegate patch parsing to memoryCandidateActions.')
contains(memoryCandidatesHook, 'applyMemoryCandidatePatchToData', 'useMemoryCandidates must delegate candidate persistence patching to memoryCandidateActions.')
contains(memoryCandidatesHook, 'rejectMemoryCandidateInData', 'useMemoryCandidates must delegate candidate rejection patching to memoryCandidateActions.')
assert(!memoryCandidatesHook.includes('normalizeMemoryUpdatePatch'), 'useMemoryCandidates should not normalize legacy patches directly.')
assert(!memoryCandidatesHook.includes('normalizeTreatmentMode'), 'useMemoryCandidates should not construct foreshadowing treatment directly.')
assert(!memoryCandidatesHook.includes('projectData('), 'useMemoryCandidates should not scan scoped project data directly.')
assert(!memoryCandidatesHook.includes('chapterContinuityBridges:'), 'useMemoryCandidates should not construct continuity bridge data directly.')
assert(!memoryCandidatesHook.includes('stageSummaries:'), 'useMemoryCandidates should not construct stage summary data directly.')
assert(!memoryCandidatesHook.includes('timelineEvents:'), 'useMemoryCandidates should not construct timeline event data directly.')

const pipelineRevisionActions = read('src/renderer/src/views/generation/usePipelineRevisionActions.ts')
const pipelineRevisionActionHandlers = read('src/renderer/src/views/generation/pipelineRevisionActionHandlers.ts')
assert(!pipelineRevisionActions.includes("import { AIService }"), 'Pipeline revision actions hook must stay free of a static AIService dependency.')
contains(pipelineRevisionActions, "import('./pipelineRevisionActionHandlers')", 'Pipeline revision actions hook must lazy-load its action implementation.')
contains(pipelineRevisionActionHandlers, "await import('../../../../services/AIService')", 'Pipeline revision action handlers must lazy-load AIService for revision candidate generation.')
contains(pipelineRevisionActionHandlers, "resolvePipelineRoleSettings(sourceJob?.aiRunConfig, data.settings, 'revision')", 'Pipeline revision action handlers must resolve the frozen revision-role settings.')
contains(pipelineRevisionActionHandlers, 'new AIService(runSettings', 'Pipeline revision action handlers must use the source run settings.')

const chapterGenerationSteps = read('src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts')
const memoryExtractionSteps = read('src/renderer/src/views/generation/pipelineSteps/memoryExtraction.ts')
const qualityCheckSteps = read('src/renderer/src/views/generation/pipelineSteps/qualityCheck.ts')
const consistencyReviewSteps = read('src/renderer/src/views/generation/pipelineSteps/consistencyReview.ts')
contains(chapterGenerationSteps, "await env.getAiService('prose')", 'Chapter generation must resolve the prose role lazily.')
contains(memoryExtractionSteps, "await env.getAiService('extraction')", 'Memory extraction must resolve the extraction role lazily.')
contains(consistencyReviewSteps, "await env.getAiService('reviewer')", 'Independent consistency review must resolve the reviewer role lazily.')
assert(!chapterGenerationSteps.includes('env.aiService'), 'Chapter generation steps should not use a statically provided AIService.')
assert(!memoryExtractionSteps.includes('env.aiService'), 'Memory extraction steps should not use a statically provided AIService.')
assert(!qualityCheckSteps.includes('env.aiService'), 'Quality check steps should not use a statically provided AIService.')
assert(!consistencyReviewSteps.includes('env.aiService'), 'Consistency review steps should not use a statically provided AIService.')

const revisionStudio = read('src/renderer/src/views/RevisionStudioView.tsx')
const revisionStudioActions = read('src/renderer/src/views/revision/revisionStudioActionHandlers.ts')
const revisionGenerationActions = read('src/renderer/src/views/revision/revisionGenerationActions.ts')
const revisionVersionActions = read('src/renderer/src/views/revision/revisionVersionActions.ts')
const revisionStudioHook = read('src/renderer/src/views/revision/useRevisionStudioActions.ts')
const revisionStudioSidebar = read('src/renderer/src/views/revision/RevisionStudioSidebar.tsx')
const revisionComparisonPanel = read('src/renderer/src/views/revision/RevisionComparisonPanel.tsx')
const revisionSessionModel = read('src/renderer/src/views/revision/revisionSessionModel.ts')
assert(existsSync(join(root, 'src/renderer/src/views/revision/revisionAiContext.ts')), 'Revision AI context helper must exist.')
contains(revisionStudio, 'buildRevisionAiContext', 'RevisionStudioView must delegate revision AI context construction to a helper.')
contains(revisionStudio, 'selectedChapterId && !chapters.some', 'RevisionStudioView must reset stale selected chapter ids.')
contains(revisionStudio, 'selectedDraftId && !drafts.some', 'RevisionStudioView must reset stale selected draft ids.')
contains(revisionStudio, 'useRevisionStudioActions', 'RevisionStudioView must delegate persistence and AI actions to a lazy action hook.')
contains(revisionStudio, 'RevisionStudioSidebar', 'RevisionStudioView must delegate source controls to a sidebar component.')
contains(revisionStudio, 'RevisionComparisonPanel', 'RevisionStudioView must delegate revision comparison UI to a panel component.')
contains(revisionStudioHook, "import('./revisionGenerationActions')", 'Revision action hook must lazy-load AI generation actions.')
contains(revisionStudioHook, "import('./revisionVersionActions')", 'Revision action hook must lazy-load version actions independently.')
contains(revisionStudioActions, "export * from './revisionGenerationActions'", 'Revision action compatibility facade must preserve generation exports.')
contains(revisionStudioActions, "export * from './revisionVersionActions'", 'Revision action compatibility facade must preserve version exports.')
contains(revisionGenerationActions, 'selectRevisionSession(', 'Revision generation actions must delegate reusable session selection to a pure helper.')
contains(revisionGenerationActions, 'resolveRevisionResponseSession(', 'Late revision responses must resolve against the current session state.')
contains(revisionVersionActions, 'buildRevisionCommitBundle', 'Revision version actions must preserve formal revision commit construction.')
contains(revisionGenerationActions, 'mergeLocalRevisionSafely', 'Revision generation actions must preserve safe local revision merging.')
contains(revisionVersionActions, 'await persistEditedVersionBody(context)', 'Revision version actions must flush edited text before accept or version navigation.')
assert(!revisionGenerationActions.includes('RevisionCommitBundleService'), 'Revision generation must not load formal commit dependencies.')
assert(!revisionVersionActions.includes('generateRevision('), 'Revision version actions must not load AI generation behavior.')
contains(revisionStudio, "selectedDraft: sourceKind === 'draft' ? selectedDraft : null", 'Chapter revision context must not include an unrelated generated draft.')
contains(revisionSessionModel, "session.status === 'active'", 'Revision session helper must only reuse active sessions.')
assert(!revisionGenerationActions.includes('?? activeSessions[0]'), 'Revision actions must not reactivate completed or cancelled revision sessions.')
assert(!revisionStudio.includes('function meaningfulText('), 'RevisionStudioView should not own revision AI context placeholder filtering.')
assert(!revisionStudio.includes('function contextBlock('), 'RevisionStudioView should not own revision AI context block formatting.')
assert(!revisionStudio.includes('buildRevisionCommitBundle'), 'RevisionStudioView should not own formal revision persistence implementation.')
assert(!revisionStudio.includes('mergeLocalRevisionSafely'), 'RevisionStudioView should not own local merge implementation.')
assert(revisionStudioSidebar.includes('latestQualityReport'), 'Revision sidebar must preserve quality issue routing.')
assert(revisionComparisonPanel.includes('RevisionDiffView'), 'Revision comparison panel must preserve original/revised/diff presentation.')

const chaptersView = read('src/renderer/src/views/ChaptersView.tsx')
const chapterBodyDraft = read('src/renderer/src/views/chapters/useChapterBodyDraft.ts')
const chapterAiDrafts = read('src/renderer/src/views/chapters/useChapterAiDrafts.ts')
const charactersView = read('src/renderer/src/views/CharactersView.tsx')
const foreshadowingView = read('src/renderer/src/views/ForeshadowingView.tsx')
const agentRunsView = read('src/renderer/src/views/AgentRunsView.tsx')
const promptBuilderView = read('src/renderer/src/views/PromptBuilderView.tsx')
const storyDirectionView = read('src/renderer/src/views/StoryDirectionView.tsx')
const characterFocusCard = read('src/renderer/src/views/characters/CharacterFocusCard.tsx')
const characterListPane = read('src/renderer/src/views/characters/CharacterListPane.tsx')
const characterProfilePanels = read('src/renderer/src/views/characters/CharacterProfilePanels.tsx')
const characterStateLedgerPanel = read('src/renderer/src/views/characters/CharacterStateLedgerPanel.tsx')
const characterStateLogPanel = read('src/renderer/src/views/characters/CharacterStateLogPanel.tsx')
const characterStateUi = read('src/renderer/src/views/characters/characterStateUi.ts')
const promptBudgetPanel = read('src/renderer/src/views/promptBuilder/PromptBudgetPanel.tsx')
const promptChapterTaskPanel = read('src/renderer/src/views/promptBuilder/PromptChapterTaskPanel.tsx')
const promptControlPanel = read('src/renderer/src/views/promptBuilder/PromptControlPanel.tsx')
const promptEditorPanel = read('src/renderer/src/views/promptBuilder/PromptEditorPanel.tsx')
const promptHistoryPanels = read('src/renderer/src/views/promptBuilder/PromptHistoryPanels.tsx')
const promptManualForeshadowingPanel = read('src/renderer/src/views/promptBuilder/PromptManualForeshadowingPanel.tsx')
const promptBuilderNeedPlan = read('src/renderer/src/views/promptBuilder/promptBuilderNeedPlan.ts')
assert(existsSync(join(root, 'src/renderer/src/views/chapters/useChapterCharacterActions.ts')), 'Chapter character actions hook must exist.')
assert(existsSync(join(root, 'src/renderer/src/views/chapters/useChapterContinuityActions.ts')), 'Chapter continuity actions hook must exist.')
assert(existsSync(join(root, 'src/renderer/src/views/chapters/useChapterExportActions.ts')), 'Chapter export actions hook must exist.')
assert(existsSync(join(root, 'src/renderer/src/views/chapters/useChapterForeshadowingActions.ts')), 'Chapter foreshadowing actions hook must exist.')
assert(existsSync(join(root, 'src/renderer/src/views/chapters/chapterAiCandidateActionHandlers.ts')), 'Chapter AI candidate action handlers must exist.')
assert(existsSync(join(root, 'src/renderer/src/views/chapters/chapterVersionActionHandlers.ts')), 'Chapter version action handlers must exist.')
assert(existsSync(join(root, 'src/renderer/src/views/chapters/useChapterBodyDraft.ts')), 'Chapter body draft hook must exist.')
assert(existsSync(join(root, 'src/renderer/src/views/chapters/useChapterAiDrafts.ts')), 'Chapter AI draft coordinator must exist.')
contains(chaptersView, 'useChapterCharacterActions', 'ChaptersView must delegate character state review actions to a hook.')
contains(chaptersView, 'useChapterContinuityActions', 'ChaptersView must delegate continuity bridge actions to a hook.')
contains(chaptersView, 'useChapterExportActions', 'ChaptersView must delegate chapter copy/export actions to a hook.')
contains(chaptersView, 'useChapterForeshadowingActions', 'ChaptersView must delegate foreshadowing candidate actions to a hook.')
contains(chaptersView, "import('./chapters/ChapterAIDraftPanels')", 'ChaptersView must lazy-load AI result panels.')
contains(chaptersView, "import('./chapters/ChapterVersionHistoryPanel')", 'ChaptersView must lazy-load version history.')
contains(chapterBodyDraft, 'stateRef.current.draftBody', 'Chapter body hook must retain the latest debounced body write across navigation.')
contains(chapterBodyDraft, 'void persistBody(state.chapterId, state.draftBody)', 'Chapter body hook must flush a pending body write when the editor unmounts.')
contains(chaptersView, 'if (saved) setSelectedId(chapter.id)', 'Chapter switching must wait for the pending body save to succeed.')
contains(chaptersView, "chapterText: () => (selected ? bodyDraft : '')", 'AI chapter actions must preserve an intentionally empty body draft instead of reusing stale prose.')
contains(chapterAiDrafts, 'selectedIdRef.current !== chapterId', 'Chapter AI coordination must discard responses after the selected chapter changes.')
assert(!chaptersView.includes('getNovelDirectorExportApi'), 'ChaptersView should not call export bridge APIs directly.')
assert(!chaptersView.includes('getNovelDirectorClipboardApi'), 'ChaptersView should not call clipboard bridge APIs directly.')
assert(!chaptersView.includes('function selectedChapterWithDraft('), 'ChaptersView should not own chapter export draft composition.')
assert(!chaptersView.includes('normalizeTreatmentMode'), 'ChaptersView should not own foreshadowing treatment normalization.')
assert(!chaptersView.includes('async function applyForeshadowingCandidate'), 'ChaptersView should not own foreshadowing candidate persistence.')
assert(!chaptersView.includes('CharacterStateChangeCandidate'), 'ChaptersView should not construct character state change candidates directly.')
assert(!chaptersView.includes('CharacterStateTransaction'), 'ChaptersView should not construct character state transactions directly.')
assert(!chaptersView.includes('ChapterContinuityBridge,'), 'ChaptersView should not construct continuity bridge records directly.')
assert(!chaptersView.includes('async function saveContinuityBridge'), 'ChaptersView should not own continuity bridge persistence.')
contains(charactersView, 'selectedId && !characters.some', 'CharactersView must reset stale selected character ids after data changes.')
contains(charactersView, 'CharacterListPane', 'CharactersView must delegate the character list pane to a child component.')
contains(characterListPane, 'character-list-pane', 'CharacterListPane must own the character list pane markup.')
contains(characterListPane, '未记录情绪', 'CharacterListPane must use a clean fallback for missing emotional state.')
assert(!charactersView.includes('className="list-pane"'), 'CharactersView should not inline the character list pane.')
contains(charactersView, 'CharacterFocusCard', 'CharactersView must delegate the character focus summary card to a child component.')
contains(characterFocusCard, 'character-focus-card', 'CharacterFocusCard must own the character focus card markup.')
assert(!charactersView.includes('className="panel character-focus-card"'), 'CharactersView should not inline the character focus card.')
contains(charactersView, 'CharacterProfilePanels', 'CharactersView must delegate profile/current-state forms to a child component.')
contains(characterProfilePanels, '基础设定', 'CharacterProfilePanels must own base profile fields.')
contains(characterProfilePanels, '当前状态', 'CharacterProfilePanels must own current state fields.')
assert(!charactersView.includes('<h2>基础设定</h2>'), 'CharactersView should not inline base profile fields.')
assert(!charactersView.includes('<h2>当前状态</h2>'), 'CharactersView should not inline current state fields.')
contains(charactersView, "from './characters/characterStateUi'", 'CharactersView must delegate character state UI constants and formatting to a helper.')
contains(characterStateUi, 'STATE_TEMPLATES', 'characterStateUi helper must own state ledger templates.')
contains(characterStateUi, 'factDisplayValue', 'characterStateUi helper must own state fact display formatting.')
assert(!charactersView.includes('const STATE_TEMPLATES'), 'CharactersView should not own state ledger templates directly.')
assert(!charactersView.includes('function factDisplayValue'), 'CharactersView should not own state fact display formatting directly.')
contains(charactersView, 'CharacterStateLedgerPanel', 'CharactersView must delegate the dynamic state ledger to a child component.')
contains(characterStateLedgerPanel, 'character-state-ledger-panel', 'CharacterStateLedgerPanel must own the dynamic state ledger panel markup.')
contains(characterStateLedgerPanel, 'StateFactCard', 'CharacterStateLedgerPanel must own repeated state fact card rendering.')
contains(characterStateLedgerPanel, '待确认状态变化候选', 'CharacterStateLedgerPanel must own pending state candidate rendering.')
assert(!charactersView.includes('className="panel character-state-ledger-panel"'), 'CharactersView should not inline the dynamic state ledger panel.')
assert(!charactersView.includes('factDisplayValue'), 'CharactersView should not format state fact display values directly.')
contains(charactersView, 'CharacterStateLogPanel', 'CharactersView must delegate state log rendering and conversion forms.')
contains(characterStateLogPanel, '状态日志 / 历史记录', 'CharacterStateLogPanel must own state log rendering.')
assert(!charactersView.includes('className="panel character-log-panel"'), 'CharactersView should not inline the state log panel.')
contains(charactersView, 'useCharacterWorkspaceDraft', 'CharactersView must scope unsubmitted forms and save receipts by character.')
contains(foreshadowingView, 'foreshadowings.find((item) => item.id === selectedId)', 'ForeshadowingView detail selection must follow the filtered foreshadowing list.')
contains(foreshadowingView, 'selectedId && !foreshadowings.some', 'ForeshadowingView must reset stale selected ids when filters hide or remove an item.')
contains(agentRunsView, 'selectedRunId && !runs.some', 'AgentRunsView must reset stale selected run ids after data changes.')
contains(promptBuilderView, 'previousProjectIdRef', 'PromptBuilderView must detect project switches.')
contains(promptBuilderView, 'setTargetChapterOrder(nextChapter)', 'PromptBuilderView must reset target chapter when switching projects.')
contains(promptBuilderView, 'setTask(createEmptyChapterTask())', 'PromptBuilderView must reset chapter task when switching projects.')
contains(promptBuilderView, 'ids.filter((id) => characterIds.has(id))', 'PromptBuilderView must prune stale selected character ids.')
contains(promptBuilderView, 'ids.filter((id) => foreshadowingIds.has(id))', 'PromptBuilderView must prune stale selected foreshadowing ids.')
contains(promptBuilderView, "from './promptBuilder/promptBuilderNeedPlan'", 'PromptBuilderView must delegate ContextNeedPlan edit mutations to a helper.')
contains(promptBuilderNeedPlan, 'toggleNeedPlanCharacter', 'promptBuilderNeedPlan helper must own character need toggling.')
contains(promptBuilderNeedPlan, 'toggleNeedPlanForeshadowing', 'promptBuilderNeedPlan helper must own foreshadowing need toggling.')
contains(promptBuilderView, 'PromptBudgetPanel', 'PromptBuilderView must delegate budget selection summary UI to a child component.')
contains(promptBudgetPanel, 'ContextBudgetManager.explainSelection', 'PromptBudgetPanel must own the budget selection explanation.')
contains(promptBudgetPanel, 'TokenBudgetMeter', 'PromptBudgetPanel must own the context budget meter.')
contains(promptBudgetPanel, 'StatCard', 'PromptBudgetPanel must own the budget metric cards.')
assert(!promptBuilderView.includes('ContextBudgetManager.explainSelection'), 'PromptBuilderView should not inline the budget selection explanation.')
contains(promptBuilderView, 'PromptChapterTaskPanel', 'PromptBuilderView must delegate chapter task editing UI to a child component.')
contains(promptChapterTaskPanel, '当前章节任务书', 'PromptChapterTaskPanel must own chapter task rendering.')
contains(promptChapterTaskPanel, 'onTaskChange', 'PromptChapterTaskPanel must emit chapter task updates.')
assert(!promptBuilderView.includes('<h2>当前章节任务书</h2>'), 'PromptBuilderView should not inline the chapter task panel.')
contains(promptBuilderView, 'PromptControlPanel', 'PromptBuilderView must delegate the left control sidebar to a child component.')
contains(promptControlPanel, 'moduleLabels', 'PromptControlPanel must own prompt module labels.')
contains(promptControlPanel, 'TokenBudgetMeter', 'PromptControlPanel must own the final prompt budget meter.')
contains(promptControlPanel, 'NumberInput', 'PromptControlPanel must own numeric prompt controls.')
assert(!promptBuilderView.includes('const moduleLabels'), 'PromptBuilderView should not own prompt module labels.')
assert(!promptBuilderView.includes('className="panel prompt-controls"'), 'PromptBuilderView should not inline the prompt controls sidebar.')
contains(promptBuilderView, 'PromptEditorPanel', 'PromptBuilderView must delegate final prompt editor UI to a child component.')
contains(promptEditorPanel, '最终 Prompt', 'PromptEditorPanel must own final prompt rendering.')
contains(promptEditorPanel, 'prompt-editor', 'PromptEditorPanel must own the large prompt textarea.')
assert(!promptBuilderView.includes('<h2>最终 Prompt</h2>'), 'PromptBuilderView should not inline the final prompt editor.')
contains(promptBuilderView, 'PromptHistoryPanels', 'PromptBuilderView must delegate prompt snapshot/version history UI to a child component.')
contains(promptHistoryPanels, '上下文快照', 'PromptHistoryPanels must own snapshot history rendering.')
contains(promptHistoryPanels, '已保存版本', 'PromptHistoryPanels must own saved version rendering.')
contains(promptHistoryPanels, 'safeModeLabel', 'PromptHistoryPanels must own context snapshot mode labels.')
assert(!promptBuilderView.includes('safeModeLabel'), 'PromptBuilderView should not own context snapshot mode labels.')
assert(!promptBuilderView.includes('scoped.promptContextSnapshots.map'), 'PromptBuilderView should not inline context snapshot rows.')
assert(!promptBuilderView.includes('scoped.promptVersions.map'), 'PromptBuilderView should not inline saved prompt version rows.')
contains(promptBuilderView, 'PromptManualForeshadowingPanel', 'PromptBuilderView must delegate manual foreshadowing selection UI to a child component.')
contains(promptManualForeshadowingPanel, 'FORESHADOWING_TREATMENT_OPTIONS', 'PromptManualForeshadowingPanel must own treatment mode controls.')
contains(promptManualForeshadowingPanel, 'effectiveTreatmentMode', 'PromptManualForeshadowingPanel must own effective treatment display.')
assert(!promptBuilderView.includes('function renderManualForeshadowingPanel'), 'PromptBuilderView should not inline the manual foreshadowing panel.')
assert(!promptBuilderView.includes('new Set(contextNeedPlan.requiredForeshadowingIds)'), 'PromptBuilderView should not directly mutate required/forbidden foreshadowing sets.')
assert(!promptBuilderView.includes('requiredCharacterCardFields: Object.fromEntries'), 'PromptBuilderView should not directly rebuild need-plan character field maps.')
contains(storyDirectionView, 'previousProjectIdRef', 'StoryDirectionView must detect project switches.')
contains(storyDirectionView, 'setStartChapterOrder(nextStartChapterOrder)', 'StoryDirectionView must reset start chapter when switching projects.')
contains(storyDirectionView, 'setDraftGuide(StoryDirectionService.getActiveGuideForChapter', 'StoryDirectionView must load the active guide for the new project.')

const bridgePath = 'src/renderer/src/platform/novelDirectorBridge.ts'
assert(existsSync(join(root, bridgePath)), 'renderer bridge accessor must exist.')
const bridge = read(bridgePath)
contains(bridge, 'getNovelDirectorBridge', 'renderer bridge accessor must expose getNovelDirectorBridge().')
contains(bridge, '应用桥接未加载', 'renderer bridge accessor must provide a user-readable missing bridge error.')
contains(bridge, 'getNovelDirectorDataApi', 'renderer bridge accessor must expose grouped data API access.')
contains(bridge, 'getNovelDirectorAppApi', 'renderer bridge accessor must expose grouped app API access.')
contains(bridge, 'getNovelDirectorClipboardApi', 'renderer bridge accessor must expose grouped clipboard API access.')
contains(bridge, 'getNovelDirectorExportApi', 'renderer bridge accessor must expose grouped export API access.')
contains(bridge, 'getNovelDirectorDiagnosticsApi', 'renderer bridge accessor must expose grouped diagnostics API access.')

const settingsApiPath = 'src/renderer/src/settings/settingsApi.ts'
assert(existsSync(join(root, settingsApiPath)), 'Settings IPC facade must exist.')
const settingsApi = read(settingsApiPath)
contains(settingsApi, "from '../platform/novelDirectorBridge'", 'Settings IPC facade must use the guarded bridge accessor.')
for (const symbol of ['exportAppData', 'importAppData', 'migrateStoragePath', 'createBackup', 'restoreBackup', 'getLogPath']) {
  contains(settingsApi, `function ${symbol}`, `Settings IPC facade must export ${symbol}().`)
}

const credentialApi = read('src/renderer/src/settings/credentialApi.ts')
contains(credentialApi, 'getNovelDirectorCredentialsApi', 'Credential API must use the guarded bridge accessor.')

const settingsView = [
  read('src/renderer/src/views/SettingsView.tsx'),
  read('src/renderer/src/views/settings/useSettingsStorage.ts'),
  read('src/renderer/src/views/settings/useSettingsBackupAndLogs.ts'),
  read('src/renderer/src/views/settings/useSettingsCredentials.ts')
].join('\n')
assert(!settingsView.includes('window.novelDirector'), 'SettingsView must not call window.novelDirector directly.')
contains(settingsView, "from '../../settings/settingsApi'", 'Settings controllers must depend on settingsApi facade.')
contains(settingsView, 'getNovelDirectorClipboardApi', 'SettingsView must use guarded clipboard access.')

const guardedRendererFiles = [
  'src/renderer/src/views/HomeView.tsx',
  'src/renderer/src/views/ChaptersView.tsx',
  'src/renderer/src/views/PromptBuilderView.tsx',
  'src/renderer/src/views/RevisionStudioView.tsx',
  'src/renderer/src/views/ReadingView.tsx',
  'src/renderer/src/views/GenerationPipelineView.tsx',
  'src/renderer/src/views/generation/usePipelineTraceActions.ts',
  'src/renderer/src/utils/diagnosticsApi.ts',
  'src/renderer/src/hooks/useAppData.ts'
]
for (const file of guardedRendererFiles) {
  assert(!read(file).includes('window.novelDirector'), `${file} must use guarded bridge facades instead of window.novelDirector directly.`)
}

const styles = read('src/renderer/src/styles/components.css')
contains(styles, '.error-boundary', 'ErrorBoundary styles must exist.')
contains(styles, '.view-error-boundary', 'View-level ErrorBoundary styles must exist.')

const runner = read('scripts/run-tests.mjs')
contains(runner, "['validate-architecture-p2.mjs']", 'P2 architecture validation must be included in npm test runner.')

console.log('Architecture P2 validation passed.')
