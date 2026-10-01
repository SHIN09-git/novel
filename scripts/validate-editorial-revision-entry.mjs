#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'editorial-revision-entry-test')
const timestamp = '2026-09-06T00:00:00.000Z'

function check(condition, message, details = {}) {
  if (!condition) {
    const suffix = Object.keys(details).length ? `\n${JSON.stringify(details, null, 2)}` : ''
    throw new Error(`FAIL: ${message}${suffix}`)
  }
  console.log(`  ok - ${message}`)
}

async function bundle(relativePath, fileName) {
  const outfile = join(outDir, fileName)
  await build({
    entryPoints: [join(root, relativePath)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

async function expectReject(operation, message) {
  let rejected = false
  try {
    await operation()
  } catch {
    rejected = true
  }
  check(rejected, message)
}

function settings() {
  return {
    apiProvider: 'openai',
    apiKey: '',
    hasApiKey: false,
    baseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-4.1',
    codexCliPath: 'codex',
    codexCliModel: '',
    temperature: 0.8,
    maxTokens: 8000,
    retryEnabled: true,
    maxRetries: 3,
    requestTimeoutMs: 300000,
    pipelineModelRoles: {},
    enableAutoSummary: false,
    enableChapterDiagnostics: false,
    defaultTokenBudget: 16000,
    defaultPromptMode: 'standard',
    theme: 'system'
  }
}

function project(id, name = id) {
  return {
    id,
    name,
    genre: 'mystery',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: '',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function draft(body = 'Opening. The blue key turns. Closing.') {
  return {
    id: 'draft-1',
    projectId: 'project-1',
    jobId: 'job-1',
    chapterId: 'chapter-1',
    title: 'Chapter draft',
    body,
    summary: '',
    status: 'draft',
    tokenEstimate: 8,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function editorialIssue(overrides = {}) {
  return {
    id: 'issue-continuity-1',
    level: 'blocker',
    source: 'quality_gate',
    code: 'continuity_gap',
    title: 'The key transition needs repair',
    evidence: ['The blue key turns.'],
    recommendation: 'Clarify why the key can turn here.',
    sourceId: 'quality-1',
    ...overrides
  }
}

function editorialVerdict(draftRecord, issue = editorialIssue(), overrides = {}) {
  return {
    id: 'verdict-1',
    projectId: 'project-1',
    chapterId: draftRecord.chapterId,
    jobId: draftRecord.jobId,
    draftId: draftRecord.id,
    draftContentHash: '',
    draftRevision: draftRecord.updatedAt,
    status: 'blocked',
    coverage: { quality: 'current', consistency: 'current' },
    canAccept: false,
    summary: 'The draft needs revision.',
    blockers: issue.level === 'blocker' ? [issue] : [],
    advisories: issue.level === 'advisory' ? [issue] : [],
    actions: [{ actionType: 'revise_draft', label: 'Revise', reason: 'Fix the issue.', priority: 2 }],
    sourceRefs: {
      qualityGateReportId: 'quality-1',
      consistencyReviewReportId: null,
      redundancyReportId: null,
      noveltyAuditTraceId: null,
      generationRunTraceId: null,
      characterStateIssueIds: [],
      ignoredStaleReportIds: []
    },
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function emptyData(overrides = {}) {
  return {
    schemaVersion: 3,
    projects: [project('project-1', 'Target novel'), project('project-2', 'Other novel')],
    storyBibles: [],
    chapters: [],
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
    generatedChapterDrafts: [],
    memoryUpdateCandidates: [],
    candidateDecisionReceipts: [],
    consistencyReviewReports: [],
    contextBudgetProfiles: [],
    qualityGateReports: [],
    generationRunTraces: [],
    runTraceAuthorSummaries: [],
    redundancyReports: [],
    editorialVerdicts: [],
    revisionCandidates: [],
    revisionSessions: [],
    revisionRequests: [],
    revisionVersions: [],
    chapterVersions: [],
    chapterCommitBundles: [],
    revisionCommitBundles: [],
    agentRuns: [],
    agentActionPreviews: [],
    settings: settings(),
    ...overrides
  }
}

function editorialFixture(draftBody = 'Opening. The blue key turns. Closing.', issue = editorialIssue(), overrides = {}) {
  const draftRecord = draft(draftBody)
  const verdict = editorialVerdict(draftRecord, issue)
  return emptyData({
    generatedChapterDrafts: [draftRecord],
    editorialVerdicts: [verdict],
    ...overrides
  })
}

function editorialInput(draftHash, overrides = {}) {
  return {
    projectId: 'project-1',
    verdictId: 'verdict-1',
    issueId: 'issue-continuity-1',
    expectedDraftHash: draftHash,
    sessionId: 'session-1',
    requestId: 'request-1',
    createdAt: timestamp,
    ...overrides
  }
}

function qualityReport(id, draftRecord, draftHash, projectId = draftRecord.projectId) {
  return {
    id,
    projectId,
    jobId: draftRecord.jobId,
    chapterId: draftRecord.chapterId,
    draftId: draftRecord.id,
    draftContentHash: draftHash,
    overallScore: 72,
    pass: false,
    dimensions: {},
    issues: [],
    requiredFixes: [],
    optionalSuggestions: [],
    createdAt: timestamp
  }
}

function revisionCandidate(overrides = {}) {
  return {
    id: 'revision-candidate-1',
    projectId: 'project-1',
    jobId: 'job-1',
    draftId: 'draft-1',
    sourceReportId: 'quality-1',
    targetIssue: 'continuity_gap',
    revisionInstruction: 'Clarify the transition.',
    revisedText: 'Opening. The revised key turns. Closing.',
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function pipelineFixture(draftBody = 'Opening. Target phrase. Closing.', overrides = {}) {
  const draftRecord = {
    ...draft('Opening. The blue key turns. Closing.'),
    id: 'pipeline-draft-1',
    body: draftBody,
    jobId: 'pipeline-job-1'
  }
  const hash = `draft-v1-placeholder-${draftBody.length}`
  return emptyData({
    projects: [project('project-1', 'Pipeline novel'), project('project-2', 'Other novel')],
    generatedChapterDrafts: [draftRecord],
    chapterGenerationJobs: [{ id: draftRecord.jobId, projectId: 'project-1', status: 'completed', updatedAt: timestamp }],
    qualityGateReports: [qualityReport('quality-1', draftRecord, hash)],
    revisionCandidates: [revisionCandidate({
      draftId: draftRecord.id,
      jobId: draftRecord.jobId,
      sourceDraftContentHash: hash
    })],
    ...overrides
  })
}

function pipelineContext(data, projectId = 'project-1') {
  let current = data
  let aiCalls = 0
  const messages = []
  return {
    context: {
      data,
      project: project(projectId),
      scoped: {},
      selectedJob: null,
      selectedSteps: [],
      selectedTraceSnapshot: null,
      latestDraft: null,
      targetChapterOrder: 1,
      readerEmotionTarget: '',
      estimatedWordCount: '',
      budgetMode: 'standard',
      budgetMaxTokens: 16000,
      saveData: async (input) => {
        current = typeof input === 'function' ? input(current) : input
        return { ok: true }
      },
      setPipelineMessage: (message) => messages.push(message),
      getAiService: async () => {
        aiCalls += 1
        throw new Error('AI must not be called by acceptRevisionCandidate')
      }
    },
    current: () => current,
    aiCalls: () => aiCalls,
    messages
  }
}

function revisionGenerationContext(sourceBody, targetRange) {
  let aiCalls = 0
  let saveCalls = 0
  const messages = []
  const selectedDraft = draft(sourceBody)
  return {
    context: {
      project: project('project-1'),
      saveData: async () => {
        saveCalls += 1
        return { ok: true }
      },
      confirmAction: async () => true,
      getAiService: async () => {
        aiCalls += 1
        throw new Error('AI must not be called for an invalid local selection')
      },
      buildRevisionContext: () => '',
      sourceKind: 'draft',
      selectedChapter: null,
      selectedDraft,
      linkedDraftChapter: null,
      sourceTitle: selectedDraft.title,
      sourceBody,
      sourceDraftId: selectedDraft.id,
      activeSessions: [],
      revisionType: 'custom',
      targetRange,
      instruction: 'Improve this passage.',
      latestQualityReports: [],
      selectedVersion: null,
      editableVersionBody: '',
      setRevisionType: () => {},
      setInstruction: () => {},
      setSelectedVersionId: () => {},
      setRevisionViewMode: () => {},
      setEditableVersionBody: () => {},
      setLoading: () => {},
      setMessage: (message) => messages.push(message)
    },
    aiCalls: () => aiCalls,
    saveCalls: () => saveCalls,
    messages
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const [requestService, hashService, revisionActions, generationActions] = await Promise.all([
    bundle('src/services/EditorialRevisionRequestService.ts', 'editorial-revision-request-service.mjs'),
    bundle('src/services/DraftDiagnosticBindingService.ts', 'draft-diagnostic-binding-service.mjs'),
    bundle('src/renderer/src/views/generation/pipelineRevisionActionHandlers.ts', 'pipeline-revision-action-handlers.mjs'),
    bundle('src/renderer/src/views/revision/revisionGenerationActions.ts', 'revision-generation-actions.mjs')
  ])
  const { buildEditorialRevisionRequest } = requestService
  const { draftContentHash, qualityReportMatchesDraft } = hashService
  const { acceptRevisionCandidate } = revisionActions
  const { generateRevisionFromCurrent } = generationActions

  check(typeof buildEditorialRevisionRequest === 'function', 'EditorialRevisionRequestService exports buildEditorialRevisionRequest')
  check(typeof acceptRevisionCandidate === 'function', 'pipelineRevisionActionHandlers exports acceptRevisionCandidate')
  check(typeof generateRevisionFromCurrent === 'function', 'revisionGenerationActions exports generateRevisionFromCurrent')

  const uniqueData = editorialFixture()
  const uniqueDraft = uniqueData.generatedChapterDrafts[0]
  const uniqueHash = draftContentHash(uniqueDraft.body)
  uniqueData.editorialVerdicts[0].draftContentHash = uniqueHash
  const beforeUnique = JSON.stringify(uniqueData)
  const uniqueResult = buildEditorialRevisionRequest(uniqueData, editorialInput(uniqueHash))
  check(uniqueResult.session.id === 'session-1' && uniqueResult.request.id === 'request-1', 'current verdict issue creates the requested session and request')
  check(uniqueResult.request.targetRange === 'The blue key turns.', 'unique evidence is used as the revision target range')
  check(uniqueResult.request.sourceEditorialVerdictId === 'verdict-1' && uniqueResult.request.sourceEditorialIssueId === 'issue-continuity-1', 'request retains verdict and issue provenance')
  check(JSON.stringify(uniqueData.generatedChapterDrafts) === JSON.stringify(uniqueResult.data.generatedChapterDrafts), 'editorial entry does not modify draft正文')
  check(JSON.stringify(uniqueData) === beforeUnique, 'editorial request builder does not mutate input or call an AI side effect')
  check(uniqueResult.data.revisionSessions.length === 1 && uniqueResult.data.revisionRequests.length === 1, 'editorial entry creates only one session and one request')

  const reused = buildEditorialRevisionRequest(uniqueResult.data, editorialInput(uniqueHash, {
    sessionId: 'session-new',
    requestId: 'request-new',
    createdAt: '2026-09-06T00:01:00.000Z'
  }))
  check(reused.session.id === 'session-1' && reused.request.id === 'request-1', 'repeated entry reuses the existing active session and request')
  check(reused.data.revisionSessions.length === 1 && reused.data.revisionRequests.length === 1, 'repeated entry does not create duplicate active records')

  const ambiguousData = editorialFixture('Opening. The blue key turns. Middle. The blue key turns. Closing.')
  const ambiguousHash = draftContentHash(ambiguousData.generatedChapterDrafts[0].body)
  ambiguousData.editorialVerdicts[0].draftContentHash = ambiguousHash
  const ambiguous = buildEditorialRevisionRequest(ambiguousData, editorialInput(ambiguousHash))
  check(ambiguous.request.targetRange === '', 'non-unique evidence does not silently choose a target range')
  check(ambiguous.request.instruction.includes('参考证据：The blue key turns.'), 'ambiguous evidence remains available as reference in the request')

  const wrongProject = editorialFixture()
  wrongProject.editorialVerdicts[0].draftContentHash = draftContentHash(wrongProject.generatedChapterDrafts[0].body)
  const wrongProjectBefore = JSON.stringify(wrongProject)
  await expectReject(
    () => buildEditorialRevisionRequest(wrongProject, editorialInput(uniqueHash, { projectId: 'project-2' })),
    'wrong project is rejected without creating an editorial revision entry'
  )
  check(JSON.stringify(wrongProject) === wrongProjectBefore, 'wrong project rejection leaves AppData unchanged')

  const staleHashData = editorialFixture()
  staleHashData.editorialVerdicts[0].draftContentHash = draftContentHash(staleHashData.generatedChapterDrafts[0].body)
  const staleHashBefore = JSON.stringify(staleHashData)
  await expectReject(
    () => buildEditorialRevisionRequest(staleHashData, editorialInput('draft-v1-stale-hash')),
    'stale draft hash is rejected without creating an editorial revision entry'
  )
  check(JSON.stringify(staleHashData) === staleHashBefore, 'stale draft hash rejection leaves AppData unchanged')

  const staleVerdictData = editorialFixture()
  const staleDraft = staleVerdictData.generatedChapterDrafts[0]
  const staleDraftHash = draftContentHash(staleDraft.body)
  staleVerdictData.editorialVerdicts[0].draftContentHash = staleDraftHash
  const staleVerdict = editorialVerdict(staleDraft, editorialIssue({ id: 'issue-newer-1' }), {
    id: 'verdict-newer-1',
    draftContentHash: staleDraftHash,
    updatedAt: '2026-09-06T00:02:00.000Z'
  })
  staleVerdictData.editorialVerdicts.push(staleVerdict)
  const staleVerdictBefore = JSON.stringify(staleVerdictData)
  await expectReject(
    () => buildEditorialRevisionRequest(staleVerdictData, editorialInput(draftContentHash(staleDraft.body))),
    'stale verdict is rejected when a newer verdict is current for the draft'
  )
  check(JSON.stringify(staleVerdictData) === staleVerdictBefore, 'stale verdict rejection leaves AppData unchanged')

  const diagnosticData = editorialFixture('Opening. Diagnostic issue. Closing.', editorialIssue({
    source: 'diagnostic_binding',
    code: 'diagnostic_binding_quality_stale'
  }))
  diagnosticData.editorialVerdicts[0].draftContentHash = draftContentHash(diagnosticData.generatedChapterDrafts[0].body)
  const diagnosticBefore = JSON.stringify(diagnosticData)
  await expectReject(
    () => buildEditorialRevisionRequest(diagnosticData, editorialInput(draftContentHash(diagnosticData.generatedChapterDrafts[0].body))),
    'diagnostic_binding issue does not create an editorial revision request'
  )
  check(JSON.stringify(diagnosticData) === diagnosticBefore, 'diagnostic_binding rejection leaves AppData unchanged')

  const pipelineBase = pipelineFixture()
  const pipelineDraft = pipelineBase.generatedChapterDrafts[0]
  const pipelineHash = draftContentHash(pipelineDraft.body)
  pipelineBase.qualityGateReports[0].draftContentHash = pipelineHash
  pipelineBase.revisionCandidates[0].sourceDraftContentHash = pipelineHash
  const accepting = pipelineContext(pipelineBase)
  const originalPipelineBody = pipelineDraft.body
  await acceptRevisionCandidate(accepting.context, pipelineBase.revisionCandidates[0])
  const acceptedData = accepting.current()
  const acceptedDraft = acceptedData.generatedChapterDrafts.find((item) => item.id === pipelineDraft.id)
  check(acceptedDraft.body === 'Opening. The revised key turns. Closing.', 'matching sourceDraftContentHash applies the revision candidate to the draft')
  check(acceptedData.revisionCandidates.find((item) => item.id === 'revision-candidate-1')?.status === 'accepted', 'accepted revision candidate is marked accepted')
  check(originalPipelineBody !== acceptedDraft.body && !qualityReportMatchesDraft(acceptedData.qualityGateReports[0], acceptedDraft), 'applying a revision invalidates the old diagnostic binding for the previous body')
  check(accepting.aiCalls() === 0, 'acceptRevisionCandidate does not call AI')

  const changedBodyData = pipelineFixture('Opening. A newer body. Closing.')
  const changedBodyHash = draftContentHash(changedBodyData.generatedChapterDrafts[0].body)
  changedBodyData.qualityGateReports[0].draftContentHash = pipelineHash
  changedBodyData.revisionCandidates[0].sourceDraftContentHash = pipelineHash
  const changedBodyContext = pipelineContext(changedBodyData)
  const changedBodyBefore = JSON.stringify(changedBodyContext.current())
  await expectReject(
    () => acceptRevisionCandidate(changedBodyContext.context, changedBodyData.revisionCandidates[0]),
    'old sourceDraftContentHash cannot overwrite a changed draft body'
  )
  check(JSON.stringify(changedBodyContext.current()) === changedBodyBefore, 'stale candidate rejection leaves changed draft data untouched')
  check(changedBodyHash !== pipelineHash && changedBodyContext.aiCalls() === 0, 'stale candidate path does not call AI')

  const legacyData = pipelineFixture()
  legacyData.revisionCandidates[0] = revisionCandidate({
    id: 'legacy-revision-candidate-1',
    draftId: legacyData.generatedChapterDrafts[0].id,
    jobId: legacyData.generatedChapterDrafts[0].jobId,
    sourceDraftContentHash: undefined
  })
  legacyData.qualityGateReports[0].draftContentHash = draftContentHash(legacyData.generatedChapterDrafts[0].body)
  const legacyContext = pipelineContext(legacyData)
  await acceptRevisionCandidate(legacyContext.context, legacyData.revisionCandidates[0])
  check(legacyContext.current().generatedChapterDrafts[0].body.includes('revised key'), 'legacy candidate is usable when its source report matches the current draft')

  const legacyStaleData = pipelineFixture('Opening. Legacy body changed. Closing.')
  legacyStaleData.revisionCandidates[0] = revisionCandidate({
    id: 'legacy-stale-candidate-1',
    draftId: legacyStaleData.generatedChapterDrafts[0].id,
    jobId: legacyStaleData.generatedChapterDrafts[0].jobId,
    sourceDraftContentHash: undefined
  })
  legacyStaleData.qualityGateReports[0].draftContentHash = pipelineHash
  const legacyStaleContext = pipelineContext(legacyStaleData)
  const legacyStaleBefore = JSON.stringify(legacyStaleContext.current())
  await expectReject(
    () => acceptRevisionCandidate(legacyStaleContext.context, legacyStaleData.revisionCandidates[0]),
    'legacy candidate is rejected when its source report does not match the current draft'
  )
  check(JSON.stringify(legacyStaleContext.current()) === legacyStaleBefore, 'legacy stale rejection leaves data untouched')

  const foreignData = pipelineFixture()
  foreignData.revisionCandidates.push(revisionCandidate({
    id: 'foreign-revision-candidate-1',
    projectId: 'project-2',
    sourceReportId: 'foreign-quality-1'
  }))
  const foreignContext = pipelineContext(foreignData, 'project-1')
  const foreignBefore = JSON.stringify(foreignContext.current())
  await expectReject(
    () => acceptRevisionCandidate(foreignContext.context, foreignData.revisionCandidates[1]),
    'cross-project revision candidate is rejected with an explicit save error'
  )
  check(JSON.stringify(foreignContext.current()) === foreignBefore, 'cross-project revision candidate does not change data')
  check(foreignContext.aiCalls() === 0, 'cross-project revision candidate does not call AI')

  const missingSelection = revisionGenerationContext('Opening. Target phrase. Closing.', 'Missing phrase.')
  await generateRevisionFromCurrent(missingSelection.context)
  check(missingSelection.aiCalls() === 0, 'missing local selection is rejected before getAiService is called')
  check(missingSelection.saveCalls() === 0 && missingSelection.messages.length > 0, 'missing local selection saves nothing and reports the validation failure')

  const duplicateSelection = revisionGenerationContext('Opening. Target phrase. Middle. Target phrase. Closing.', 'Target phrase.')
  await generateRevisionFromCurrent(duplicateSelection.context)
  check(duplicateSelection.aiCalls() === 0, 'duplicate local selection is rejected before getAiService is called')
  check(duplicateSelection.saveCalls() === 0 && duplicateSelection.messages.length > 0, 'duplicate local selection saves nothing and reports the validation failure')

  console.log('validate-editorial-revision-entry: ok')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
