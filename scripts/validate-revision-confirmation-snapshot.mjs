#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'revision-confirmation-snapshot-test')
const timestamp = '2026-09-06T12:00:00.000Z'

function check(condition, message, details = {}) {
  if (!condition) {
    const suffix = Object.keys(details).length ? `\n${JSON.stringify(details, null, 2)}` : ''
    throw new Error(`FAIL: ${message}${suffix}`)
  }
  console.log(`  ok - ${message}`)
}

async function bundle(entryPoint, fileName) {
  const outfile = join(outDir, fileName)
  await build({
    entryPoints: [join(root, entryPoint)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}-${fileName}`)
}

function project() {
  return {
    id: 'project-1',
    name: 'Revision confirmation fixture',
    genre: 'mystery',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: '',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function chapter() {
  return {
    id: 'chapter-1',
    projectId: 'project-1',
    order: 1,
    title: 'Chapter One',
    body: 'Original chapter body.',
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
  }
}

function draft() {
  return {
    id: 'draft-1',
    projectId: 'project-1',
    chapterId: null,
    jobId: 'job-1',
    title: 'Unlinked draft',
    body: 'Draft source body.',
    summary: '',
    status: 'draft',
    tokenEstimate: 10,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function session(sourceDraftId = null, chapterId = '') {
  return {
    id: 'session-1',
    projectId: 'project-1',
    chapterId,
    sourceDraftId,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function version() {
  return {
    id: 'version-1',
    sessionId: 'session-1',
    requestId: 'request-1',
    title: 'Revision A',
    body: 'Accepted revision A.',
    changedSummary: '',
    risks: '',
    preservedFacts: '',
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function rawData({ formal = false } = {}) {
  const currentChapter = chapter()
  const currentDraft = draft()
  const currentSession = formal ? session(null, currentChapter.id) : session(currentDraft.id, '')
  return {
    schemaVersion: 3,
    projects: [project()],
    storyBibles: [],
    chapters: [currentChapter],
    characters: [],
    characterStateLogs: [],
    characterStateFacts: [],
    characterStateTransactions: [],
    characterStateChangeCandidates: [],
    foreshadowings: [],
    timelineEvents: [],
    stageSummaries: [],
    promptVersions: [],
    promptContextSnapshots: [],
    storyDirectionGuides: [],
    hardCanonPacks: [],
    contextNeedPlans: [],
    chapterContinuityBridges: [],
    chapterGenerationJobs: [],
    chapterGenerationSteps: [],
    generatedChapterDrafts: formal ? [] : [currentDraft],
    memoryUpdateCandidates: [],
    consistencyReviewReports: [],
    contextBudgetProfiles: [],
    qualityGateReports: [],
    generationRunTraces: [],
    runTraceAuthorSummaries: [],
    redundancyReports: [],
    editorialVerdicts: [],
    revisionCandidates: [],
    revisionSessions: [currentSession],
    revisionRequests: [],
    revisionVersions: [version()],
    chapterVersions: [],
    chapterCommitBundles: [],
    revisionCommitBundles: [],
    agentRuns: [],
    agentActionPreviews: [],
    candidateDecisionReceipts: [],
    settings: {
      apiProvider: 'openai',
      apiKey: '',
      hasApiKey: false,
      baseUrl: '',
      modelName: '',
      temperature: 0.8,
      maxTokens: 8000,
      enableAutoSummary: false,
      enableChapterDiagnostics: false,
      defaultTokenBudget: 16000,
      defaultPromptMode: 'standard',
      theme: 'system'
    }
  }
}

function clone(value) {
  return structuredClone(value)
}

function makeContext(data, mode, mutateBeforeSave, latestQualityReports = [], editableVersionBody = null) {
  const persistedVersion = data.revisionVersions.find((item) => item.id === 'version-1')
  const requestedVersion = editableVersionBody === null
    ? persistedVersion
    : { ...persistedVersion, body: editableVersionBody }
  const selectedChapter = data.chapters.find((item) => item.id === 'chapter-1') ?? null
  const selectedDraft = data.generatedChapterDrafts.find((item) => item.id === 'draft-1') ?? null
  let current = clone(data)
  let confirmationCount = 0
  let effectiveWriteCount = 0
  let saveAttempt = 0
  const writeSnapshots = []
  const messages = []

  const context = {
    project: current.projects[0],
    saveData: async (input) => {
      saveAttempt += 1
      if (mutateBeforeSave) current = mutateBeforeSave(current, saveAttempt)
      try {
        const next = typeof input === 'function' ? input(current) : input
        if (JSON.stringify(next) !== JSON.stringify(current)) {
          effectiveWriteCount += 1
          writeSnapshots.push(clone(next))
        }
        current = next
        return { ok: true }
      } catch (error) {
        return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) }
      }
    },
    confirmAction: async () => {
      confirmationCount += 1
      return true
    },
    sourceKind: mode,
    selectedChapter: mode === 'chapter' ? selectedChapter : null,
    selectedDraft: mode === 'draft' ? selectedDraft : null,
    linkedDraftChapter: null,
    sourceTitle: mode === 'chapter' ? selectedChapter?.title ?? '' : selectedDraft?.title ?? '',
    sourceBody: mode === 'chapter' ? selectedChapter?.body ?? '' : selectedDraft?.body ?? '',
    sourceDraftId: selectedDraft?.id ?? null,
    activeSessions: current.revisionSessions,
    revisionType: 'custom',
    targetRange: '',
    instruction: 'Apply the reviewed revision.',
    latestQualityReports,
    selectedVersion: persistedVersion,
    editableVersionBody: editableVersionBody ?? persistedVersion.body,
    setRevisionType: () => {},
    setInstruction: () => {},
    setSelectedVersionId: () => {},
    setRevisionViewMode: () => {},
    setEditableVersionBody: () => {},
    setLoading: () => {},
    setMessage: (message) => messages.push(message),
    getAiService: async () => {
      throw new Error('AI must not be called by acceptVersion')
    },
    buildRevisionContext: () => ''
  }

  return {
    context,
    requestedVersion,
    current: () => current,
    confirmationCount: () => confirmationCount,
    effectiveWriteCount: () => effectiveWriteCount,
    writeSnapshots: () => writeSnapshots,
    messages
  }
}

async function expectScenario(name, setup, predicate) {
  const harness = setup()
  await harness.action(harness.context, harness.requestedVersion)
  check(predicate(harness), name, {
    messages: harness.messages,
    current: harness.current(),
    effectiveWriteCount: harness.effectiveWriteCount()
  })
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const [actions, defaults, binding] = await Promise.all([
    bundle('src/renderer/src/views/revision/revisionVersionActions.ts', 'revision-version-actions.mjs'),
    bundle('src/shared/defaults.ts', 'defaults.mjs'),
    bundle('src/services/DraftDiagnosticBindingService.ts', 'draft-diagnostic-binding.mjs')
  ])
  const { acceptVersion } = actions
  const { normalizeAppData } = defaults
  const { draftContentHash } = binding
  check(typeof acceptVersion === 'function', 'revisionVersionActions exports acceptVersion')

  function setup(formal, mutateBeforeSave, latestQualityReports = [], editableVersionBody = null) {
    const data = normalizeAppData(rawData({ formal }))
    const harness = makeContext(data, formal ? 'chapter' : 'draft', mutateBeforeSave, latestQualityReports, editableVersionBody)
    return { ...harness, action: acceptVersion }
  }

  await expectScenario(
    'normal formal chapter acceptance succeeds',
    () => setup(true),
    (harness) => harness.confirmationCount() === 1 &&
      harness.effectiveWriteCount() === 1 &&
      harness.current().chapters[0].body === 'Accepted revision A.' &&
      harness.current().revisionVersions[0].status === 'accepted' &&
      harness.current().revisionSessions[0].status === 'completed' &&
      harness.current().chapterVersions.length === 1
  )

  await expectScenario(
    'normal unlinked draft acceptance succeeds without writing a formal chapter',
    () => setup(false),
    (harness) => harness.confirmationCount() === 1 &&
      harness.effectiveWriteCount() === 1 &&
      harness.current().generatedChapterDrafts[0].body === 'Accepted revision A.' &&
      harness.current().generatedChapterDrafts[0].status === 'draft' &&
      harness.current().chapters[0].body === 'Original chapter body.' &&
      harness.current().revisionVersions[0].status === 'accepted' &&
      harness.current().chapterVersions.length === 0
  )

  const editedBody = 'Accepted revision from the edit buffer.'
  await expectScenario(
    'accepting an unsaved edit persists the buffer before the final formal commit',
    () => setup(true, undefined, [], editedBody),
    (harness) => harness.confirmationCount() === 1 &&
      harness.effectiveWriteCount() === 2 &&
      harness.writeSnapshots()[0].revisionVersions[0].body === editedBody &&
      harness.writeSnapshots()[0].revisionVersions[0].status === 'pending' &&
      harness.writeSnapshots()[0].chapters[0].body === 'Original chapter body.' &&
      harness.writeSnapshots()[1].revisionVersions[0].body === editedBody &&
      harness.writeSnapshots()[1].revisionVersions[0].status === 'accepted' &&
      harness.writeSnapshots()[1].chapters[0].body === editedBody
  )

  await expectScenario(
    'a concurrent candidate body change during edit persistence is rejected without overwrite',
    () => setup(true, (current, attempt) => attempt === 1
      ? {
          ...current,
          revisionVersions: current.revisionVersions.map((item) =>
            item.id === 'version-1' ? { ...item, body: 'Concurrent candidate body.' } : item
          )
        }
      : current, [], editedBody),
    (harness) => harness.confirmationCount() === 0 &&
      harness.effectiveWriteCount() === 0 &&
      harness.current().revisionVersions[0].body === 'Concurrent candidate body.' &&
      harness.current().revisionVersions[0].status === 'pending' &&
      harness.current().chapters[0].body === 'Original chapter body.' &&
      harness.messages.some((message) => message.includes('另一处更新'))
  )

  await expectScenario(
    'a pure updatedAt change during edit persistence does not reject the edit',
    () => setup(true, (current, attempt) => attempt === 1
      ? {
          ...current,
          revisionVersions: current.revisionVersions.map((item) =>
            item.id === 'version-1' ? { ...item, updatedAt: '2026-09-06T12:01:00.000Z' } : item
          )
        }
      : current, [], editedBody),
    (harness) => harness.confirmationCount() === 1 &&
      harness.effectiveWriteCount() === 2 &&
      harness.current().revisionVersions[0].body === editedBody &&
      harness.current().chapters[0].body === editedBody
  )

  const lowScoreReport = {
    id: 'quality-current-low',
    projectId: 'project-1',
    jobId: 'job-1',
    chapterId: 'chapter-1',
    draftId: null,
    draftContentHash: draftContentHash('Accepted revision A.'),
    overallScore: 70,
    pass: true,
    dimensions: {},
    issues: [],
    requiredFixes: [],
    optionalSuggestions: [],
    createdAt: timestamp
  }
  const oldReport = {
    ...lowScoreReport,
    id: 'quality-old-body',
    draftContentHash: draftContentHash('Revision A old body.'),
    overallScore: 40,
    pass: false
  }
  await expectScenario(
    'matching low-score report plus an old report uses one confirmation and still succeeds',
    () => setup(true, undefined, [lowScoreReport, oldReport]),
    (harness) => harness.confirmationCount() === 1 &&
      harness.effectiveWriteCount() === 1 &&
      harness.current().chapters[0].body === 'Accepted revision A.' &&
      harness.current().revisionVersions[0].status === 'accepted' &&
      harness.current().chapterVersions.length === 1
  )

  await expectScenario(
    'formal acceptance rejects a revisionVersion body race after confirmation',
    () => setup(true, (current) => ({
      ...current,
      revisionVersions: current.revisionVersions.map((item) =>
        item.id === 'version-1' ? { ...item, body: 'Revision B from a concurrent save.' } : item
      )
    })),
    (harness) => harness.confirmationCount() === 1 &&
      harness.effectiveWriteCount() === 0 &&
      harness.current().chapters[0].body === 'Original chapter body.' &&
      harness.current().revisionVersions[0].body === 'Revision B from a concurrent save.' &&
      harness.current().revisionVersions[0].status === 'pending' &&
      harness.current().chapterVersions.length === 0
  )

  await expectScenario(
    'unlinked draft rejects becoming chapter-linked after confirmation without changing the chapter',
    () => setup(false, (current) => ({
      ...current,
      generatedChapterDrafts: current.generatedChapterDrafts.map((item) =>
        item.id === 'draft-1' ? { ...item, chapterId: 'chapter-1' } : item
      )
    })),
    (harness) => harness.confirmationCount() === 1 &&
      harness.effectiveWriteCount() === 0 &&
      harness.current().generatedChapterDrafts[0].chapterId === 'chapter-1' &&
      harness.current().generatedChapterDrafts[0].body === 'Draft source body.' &&
      harness.current().chapters[0].body === 'Original chapter body.' &&
      harness.current().revisionVersions[0].status === 'pending' &&
      harness.current().chapterVersions.length === 0
  )

  await expectScenario(
    'version identity change after confirmation is rejected',
    () => setup(false, (current) => ({
      ...current,
      revisionVersions: current.revisionVersions.map((item) =>
        item.id === 'version-1' ? { ...item, id: 'version-other' } : item
      )
    })),
    (harness) => harness.effectiveWriteCount() === 0 &&
      harness.current().generatedChapterDrafts[0].body === 'Draft source body.' &&
      harness.current().revisionVersions[0].id === 'version-other' &&
      harness.current().chapters[0].body === 'Original chapter body.'
  )

  await expectScenario(
    'session identity change after confirmation is rejected',
    () => setup(false, (current) => ({
      ...current,
      revisionSessions: current.revisionSessions.map((item) =>
        item.id === 'session-1' ? { ...item, id: 'session-other' } : item
      )
    })),
    (harness) => harness.effectiveWriteCount() === 0 &&
      harness.current().generatedChapterDrafts[0].body === 'Draft source body.' &&
      harness.current().revisionVersions[0].status === 'pending' &&
      harness.current().chapters[0].body === 'Original chapter body.'
  )

  await expectScenario(
    'version status change after confirmation is rejected',
    () => setup(false, (current) => ({
      ...current,
      revisionVersions: current.revisionVersions.map((item) =>
        item.id === 'version-1' ? { ...item, status: 'accepted' } : item
      )
    })),
    (harness) => harness.effectiveWriteCount() === 0 &&
      harness.current().generatedChapterDrafts[0].body === 'Draft source body.' &&
      harness.current().revisionVersions[0].status === 'accepted' &&
      harness.current().chapters[0].body === 'Original chapter body.'
  )

  console.log('validate-revision-confirmation-snapshot: ok')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
