#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'candidate-decisions-regression')
const timestamp = '2026-09-06T00:00:00.000Z'

function check(condition, message, details = {}) {
  if (!condition) {
    const suffix = Object.keys(details).length ? `\n${JSON.stringify(details, null, 2)}` : ''
    throw new Error(`FAIL: ${message}${suffix}`)
  }
  console.log(`  ok - ${message}`)
}

async function bundle(entryPoint, outfileName) {
  const outfile = join(outDir, outfileName)
  await build({
    entryPoints: [join(root, entryPoint)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

async function readSource(relativePath) {
  return readFile(join(root, relativePath), 'utf8')
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

function chapter(id, projectId, order = 3) {
  return {
    id,
    projectId,
    order,
    title: `Chapter ${order}`,
    body: 'An unrelated preserved chapter body.',
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

function character(id, projectId) {
  return {
    id,
    projectId,
    name: 'Lin',
    role: 'protagonist',
    surfaceGoal: '',
    deepDesire: '',
    coreFear: '',
    selfDeception: '',
    knownInformation: '',
    unknownInformation: '',
    protagonistRelationship: '',
    emotionalState: 'guarded',
    nextActionTendency: 'observe',
    forbiddenWriting: '',
    lastChangedChapter: null,
    isMain: true,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function timelineCandidate(overrides = {}) {
  return {
    id: 'memory-timeline-1',
    projectId: 'project-1',
    jobId: 'job-1',
    type: 'timeline_event',
    targetId: null,
    proposedPatch: {
      schemaVersion: 1,
      kind: 'timeline_event_create',
      summary: 'The signal begins at the observatory.',
      sourceChapterOrder: 3,
      warnings: [],
      event: {
        id: 'timeline-event-1',
        projectId: 'project-1',
        title: 'The observatory signal begins',
        chapterOrder: 3,
        storyTime: 'night',
        narrativeOrder: 3,
        participantCharacterIds: ['character-1'],
        result: 'The locked observatory activates.',
        downstreamImpact: 'The team must return before dawn.',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    },
    evidence: 'The same signal is seen from the observatory and in the physical ledger.',
    confidence: 0.91,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function stateCandidate(overrides = {}) {
  return {
    id: 'state-physical-1',
    projectId: 'project-1',
    jobId: 'job-1',
    characterId: 'character-1',
    chapterId: 'chapter-1',
    chapterOrder: 3,
    candidateType: 'create_fact',
    targetFactId: null,
    proposedFact: {
      id: 'fact-physical-1',
      projectId: 'project-1',
      characterId: 'character-1',
      category: 'physical',
      key: 'left-palm-scar',
      label: 'A scar appears on the left palm',
      valueType: 'text',
      value: 'A thin silver scar appears on the left palm.',
      unit: '',
      linkedCardFields: ['weaknessAndCost'],
      trackingLevel: 'hard',
      promptPolicy: 'when_relevant',
      status: 'active',
      sourceChapterId: 'chapter-1',
      sourceChapterOrder: 3,
      evidence: 'A thin silver scar appears on the left palm.',
      confidence: 0.88,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    proposedTransaction: null,
    beforeValue: null,
    afterValue: 'A thin silver scar appears on the left palm.',
    evidence: 'The same signal is seen from the observatory and in the physical ledger.',
    confidence: 0.88,
    riskLevel: 'high',
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function makeData(overrides = {}) {
  return {
    schemaVersion: 3,
    projects: [project('project-1', 'Target novel'), project('project-2', 'Unrelated novel')],
    storyBibles: [],
    chapters: [chapter('chapter-1', 'project-1'), chapter('chapter-foreign', 'project-2', 1)],
    characters: [character('character-1', 'project-1')],
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
    chapterGenerationJobs: [{
      id: 'job-1',
      projectId: 'project-1',
      targetChapterOrder: 3,
      promptContextSnapshotId: null,
      contextSource: 'auto',
      status: 'completed',
      currentStep: 'await_user_confirmation',
      createdAt: timestamp,
      updatedAt: timestamp,
      errorMessage: ''
    }],
    chapterGenerationSteps: [],
    generatedChapterDrafts: [],
    memoryUpdateCandidates: [timelineCandidate()],
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
    candidateDecisionReceipts: [],
    settings: settings(),
    ...overrides
  }
}

function selection(kind, candidateId, decision = 'accept') {
  return { kind, candidateId, decision }
}

function commandFromPreview(preview, overrides = {}) {
  return {
    id: 'decision-command-1',
    projectId: preview.projectId,
    actor: { kind: 'user' },
    reason: 'Author confirmed the grouped candidates.',
    decidedAt: timestamp,
    schemaVersion: 1,
    confirmedHighRisk: true,
    decisions: preview.items.map(({ kind, candidateId, decision, expectedFingerprint, amendment }) => ({
      kind,
      candidateId,
      decision,
      expectedFingerprint,
      ...(amendment ? { amendment } : {})
    })),
    ...overrides
  }
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

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const pureOnly = process.argv.includes('--pure')
  const [serviceModule, referenceModule] = await Promise.all([
    bundle('src/services/CandidateDecisionService.ts', 'candidate-decision-service.mjs'),
    bundle('src/main/dataMerge/referenceRemapping.ts', 'reference-remapping.mjs')
  ])
  const {
    previewCandidateDecisions,
    applyCandidateDecisionCommand,
    applyCandidateDecisionChanges
  } = serviceModule
  const { createIdRemaps, rememberId, remapReferencesDeep } = referenceModule

  check(typeof previewCandidateDecisions === 'function', 'CandidateDecisionService exports previewCandidateDecisions')
  check(typeof applyCandidateDecisionCommand === 'function', 'CandidateDecisionService exports applyCandidateDecisionCommand')
  check(typeof applyCandidateDecisionChanges === 'function', 'CandidateDecisionService exports applyCandidateDecisionChanges')

  const referenceRemaps = createIdRemaps()
  rememberId(referenceRemaps, 'memoryUpdateCandidates', 'same-old-id', 'memory-new-id')
  rememberId(referenceRemaps, 'characterStateChangeCandidates', 'same-old-id', 'state-new-id')
  const remappedReceiptRefs = remapReferencesDeep({
    decisions: [
      { kind: 'memory', candidateId: 'same-old-id' },
      { kind: 'character_state', candidateId: 'same-old-id' }
    ],
    changedRecords: [
      { collection: 'memoryUpdateCandidates', ids: ['same-old-id'] },
      { collection: 'characterStateChangeCandidates', ids: ['same-old-id'] }
    ]
  }, referenceRemaps)
  check(
    remappedReceiptRefs.decisions[0].candidateId === 'memory-new-id' &&
      remappedReceiptRefs.decisions[1].candidateId === 'state-new-id' &&
      remappedReceiptRefs.changedRecords[0].ids[0] === 'memory-new-id' &&
      remappedReceiptRefs.changedRecords[1].ids[0] === 'state-new-id',
    'reference remapping preserves typed candidate and changed-record IDs when collections share an old ID'
  )

  const initial = makeData({
    memoryUpdateCandidates: [timelineCandidate()],
    characterStateChangeCandidates: [stateCandidate()]
  })
  const selectionInput = {
    projectId: 'project-1',
    decisions: [
      selection('memory', 'memory-timeline-1'),
      selection('character_state', 'state-physical-1')
    ]
  }
  const preview = previewCandidateDecisions(initial, selectionInput)
  check(preview.projectId === 'project-1' && preview.items.length === 2, 'preview returns both candidates in the requested project')
  check(
    preview.items.every((item) =>
      item.expectedFingerprint && item.title && item.summary && item.evidence && item.risk && Array.isArray(item.warnings)
    ),
    'preview items contain fingerprint, author-facing summary, evidence, risk, and warnings'
  )
  check(preview.requiresConfirmation === true, 'the grouped timeline plus hard physical state decision requires confirmation')
  check(preview.items.every((item) => item.amendment === undefined && item.amendmentPreview === undefined),
    'legacy selections without amendment retain their original preview shape')

  const command = commandFromPreview(preview)
  const beforePureApply = JSON.stringify(initial)
  const applied = applyCandidateDecisionCommand(initial, command)
  check(applied.data !== initial && applied.receipt?.id === command.id && applied.replayed === false, 'apply returns a new data snapshot, receipt, and first-write marker')
  check(applied.data.timelineEvents.some((event) => event.id === 'timeline-event-1'), 'accepting a timeline memory candidate creates the timeline event')
  check(applied.data.characterStateFacts.some((fact) => fact.id === 'fact-physical-1'), 'accepting a physical state candidate creates the state fact')
  check(applied.data.memoryUpdateCandidates.every((candidate) => candidate.status === 'accepted'), 'accepting the grouped candidates marks both source candidates accepted')
  check(JSON.stringify(initial) === beforePureApply, 'pure preview and apply do not mutate the input AppData')

  const originalWarning = 'Original novelty warning must survive author edits.'
  const editableMemory = timelineCandidate({
    proposedPatch: { ...timelineCandidate().proposedPatch, warnings: [originalWarning] }
  })
  const memoryEditData = makeData({ memoryUpdateCandidates: [editableMemory] })
  const memoryAmendment = {
    kind: 'memory',
    patch: {
      kind: 'timeline_event_create',
      summary: 'Author-edited timeline summary.',
      event: {
        title: 'Author-edited signal',
        storyTime: 'just before dawn',
        participantCharacterIds: ['character-1'],
        result: 'The author keeps the signal dormant.',
        downstreamImpact: 'The return is delayed.'
      }
    }
  }
  const memoryEditSelection = {
    projectId: 'project-1',
    decisions: [{ ...selection('memory', editableMemory.id), amendment: memoryAmendment }]
  }
  const plainMemoryPreview = previewCandidateDecisions(memoryEditData, {
    projectId: 'project-1', decisions: [selection('memory', editableMemory.id)]
  })
  const memoryEditPreview = previewCandidateDecisions(memoryEditData, memoryEditSelection)
  check(memoryEditPreview.items[0].summary.includes('Author-edited signal') &&
    memoryEditPreview.items[0].summary.includes('keeps the signal dormant'),
  'edited memory preview shows the actual author content')
  check(memoryEditPreview.items[0].warnings.includes(originalWarning) && memoryEditPreview.items[0].risk === 'high',
    'edited memory preview retains the original risk warning and gate')
  check(memoryEditPreview.items[0].expectedFingerprint !== plainMemoryPreview.items[0].expectedFingerprint,
    'memory amendment participates in the preview fingerprint')
  check(memoryEditPreview.items[0].amendmentPreview.before.patch.event.title === 'The observatory signal begins' &&
    memoryEditPreview.items[0].amendmentPreview.after.patch.event.title === 'Author-edited signal',
  'edited preview returns structured before/after values for callers')
  const staleMemoryEditCommand = structuredClone(commandFromPreview(memoryEditPreview, { id: 'stale-memory-edit-command' }))
  staleMemoryEditCommand.decisions[0].amendment.patch.event.title = 'Changed after preview'
  await expectReject(() => applyCandidateDecisionCommand(memoryEditData, staleMemoryEditCommand),
    'changing an amendment after preview invalidates its expected fingerprint')
  const memoryEdited = applyCandidateDecisionCommand(memoryEditData,
    commandFromPreview(memoryEditPreview, { id: 'memory-edit-command-1' }))
  const persistedMemoryCandidate = memoryEdited.data.memoryUpdateCandidates[0]
  const persistedTimeline = memoryEdited.data.timelineEvents[0]
  check(persistedTimeline.title === 'Author-edited signal' && persistedTimeline.result === 'The author keeps the signal dormant.',
    'edited memory content is accepted through the normal persistence calculation')
  check(persistedTimeline.id === 'timeline-event-1' && persistedTimeline.projectId === 'project-1' &&
    persistedTimeline.chapterOrder === 3 && persistedTimeline.narrativeOrder === 3,
  'memory edit preserves generated identity, project, and chapter targets')
  check(persistedMemoryCandidate.id === editableMemory.id && persistedMemoryCandidate.jobId === editableMemory.jobId &&
    persistedMemoryCandidate.status === 'accepted' && persistedMemoryCandidate.proposedPatch.warnings.includes(originalWarning),
  'accepted edited candidate preserves source identity and original warnings')
  check(memoryEdited.receipt.decisions[0].amendment?.kind === 'memory' &&
    memoryEdited.receipt.amendments?.[0].before.patch.event.title === 'The observatory signal begins' &&
    memoryEdited.receipt.amendments?.[0].after.patch.event.title === 'Author-edited signal',
  'receipt records the normalized amendment and before/after proposal')

  await expectReject(() => previewCandidateDecisions(memoryEditData, {
    projectId: 'project-1',
    decisions: [{ ...selection('memory', editableMemory.id), amendment: {
      kind: 'memory', patch: { kind: 'timeline_event_create', event: { title: 'Forged target', chapterOrder: 99 } }
    } }]
  }), 'memory amendment rejects chapter target fields outside the author contract')
  await expectReject(() => previewCandidateDecisions(memoryEditData, {
    projectId: 'project-1',
    decisions: [{ ...selection('memory', editableMemory.id), amendment: {
      kind: 'memory', projectId: 'project-2', patch: { kind: 'timeline_event_create', event: { title: 'Forged project' } }
    } }]
  }), 'memory amendment rejects project identity fields outside the author contract')
  await expectReject(() => previewCandidateDecisions(memoryEditData, {
    projectId: 'project-1',
    decisions: [{ ...selection('memory', editableMemory.id), amendment: {
      kind: 'memory', patch: { kind: 'timeline_event_create', warnings: [], event: { title: 'Clear warning' } }
    } }]
  }), 'memory amendment cannot submit a replacement warning list')
  await expectReject(() => previewCandidateDecisions(memoryEditData, {
    projectId: 'project-1',
    decisions: [{ ...selection('memory', editableMemory.id), amendment: {
      kind: 'memory', patch: { kind: 'timeline_event_create', event: { participantCharacterIds: ['foreign-character'] } }
    } }]
  }), 'memory amendment rejects character attachments outside the current project')
  await expectReject(() => previewCandidateDecisions(memoryEditData, {
    projectId: 'project-1',
    decisions: [{ ...selection('memory', editableMemory.id, 'reject'), amendment: memoryAmendment }]
  }), 'rejection cannot carry an amendment')
  await expectReject(() => previewCandidateDecisions(memoryEditData, {
    projectId: 'project-1',
    decisions: [{ ...selection('memory', editableMemory.id), amendment: {
      kind: 'memory', patch: { kind: 'timeline_event_create', event: { title: 'The observatory signal begins' } }
    } }]
  }), 'preview rejects an amendment that produces no actual change')

  const reviewCandidate = timelineCandidate({
    id: 'memory-review-edit', type: 'chapter_review', targetId: 'chapter-1',
    proposedPatch: {
      schemaVersion: 1, kind: 'chapter_review_update', summary: 'Original review', sourceChapterOrder: 3, warnings: [],
      targetChapterId: 'chapter-1', targetChapterOrder: 3,
      review: { summary: 'Original chapter summary', newInformation: '', characterChanges: '', newForeshadowing: '',
        resolvedForeshadowing: '', endingHook: 'Old hook', riskWarnings: '' },
      continuityBridgeSuggestion: null
    }
  })
  const reviewData = makeData({ memoryUpdateCandidates: [reviewCandidate] })
  const reviewEditPreview = previewCandidateDecisions(reviewData, { projectId: 'project-1', decisions: [{
    ...selection('memory', reviewCandidate.id), amendment: {
      kind: 'memory', patch: { kind: 'chapter_review_update', summary: 'Edited review',
        review: { summary: 'Edited chapter summary', endingHook: 'Edited hook' } }
    }
  }] })
  const reviewEdited = applyCandidateDecisionCommand(reviewData,
    commandFromPreview(reviewEditPreview, { id: 'review-edit-command' })).data
  check(reviewEditPreview.items[0].amendmentPreview.after.patch.review.endingHook === 'Edited hook',
    'chapter review preview exposes edited fields that are not represented by its compact summary')
  check(reviewEdited.chapters[0].summary === 'Edited chapter summary' && reviewEdited.chapters[0].endingHook === 'Edited hook',
    'chapter review amendment accepts edited author prose without changing its chapter target')

  const characterMemoryCandidate = timelineCandidate({
    id: 'memory-character-edit', type: 'character', targetId: 'character-1',
    proposedPatch: {
      schemaVersion: 1, kind: 'character_state_update', summary: 'Original character update', sourceChapterOrder: 3, warnings: [],
      characterId: 'character-1', relatedChapterId: 'chapter-1', relatedChapterOrder: 3,
      changeSummary: 'Original change', newCurrentEmotionalState: 'guarded',
      newRelationshipWithProtagonist: 'uncertain', newNextActionTendency: 'observe'
    }
  })
  const characterMemoryData = makeData({ memoryUpdateCandidates: [characterMemoryCandidate] })
  const characterMemoryPreview = previewCandidateDecisions(characterMemoryData, { projectId: 'project-1', decisions: [{
    ...selection('memory', characterMemoryCandidate.id), amendment: {
      kind: 'memory', patch: { kind: 'character_state_update', changeSummary: 'Author change',
        newCurrentEmotionalState: 'resolved', newNextActionTendency: 'act before dawn' }
    }
  }] })
  const characterMemoryEdited = applyCandidateDecisionCommand(characterMemoryData,
    commandFromPreview(characterMemoryPreview, { id: 'character-memory-edit-command' })).data
  check(characterMemoryEdited.characters[0].emotionalState === 'resolved' &&
    characterMemoryEdited.characters[0].nextActionTendency === 'act before dawn',
  'character memory amendment accepts edited state prose on the original character and chapter')

  const foreshadowCreateCandidate = timelineCandidate({
    id: 'memory-foreshadow-create-edit', type: 'foreshadowing', targetId: null,
    proposedPatch: {
      schemaVersion: 1, kind: 'foreshadowing_create', summary: 'Original planted clue', sourceChapterOrder: 3, warnings: [],
      candidate: { title: 'Old clue', description: 'Old description', firstChapterOrder: 3, suggestedWeight: 'medium',
        recommendedTreatmentMode: 'hint', expectedPayoff: 'Old payoff', relatedCharacterIds: ['character-1'], notes: '' }
    }
  })
  const foreshadowCreateData = makeData({ memoryUpdateCandidates: [foreshadowCreateCandidate] })
  const foreshadowCreatePreview = previewCandidateDecisions(foreshadowCreateData, { projectId: 'project-1', decisions: [{
    ...selection('memory', foreshadowCreateCandidate.id), amendment: {
      kind: 'memory', patch: { kind: 'foreshadowing_create', candidate: {
        title: 'Author clue', description: 'Author description', suggestedWeight: 'high', expectedPayoff: 'Author payoff'
      } }
    }
  }] })
  const foreshadowCreated = applyCandidateDecisionCommand(foreshadowCreateData,
    commandFromPreview(foreshadowCreatePreview, { id: 'foreshadow-create-edit-command' })).data.foreshadowings[0]
  check(foreshadowCreated.title === 'Author clue' && foreshadowCreated.weight === 'high' && foreshadowCreated.firstChapterOrder === 3,
    'foreshadowing creation amendment edits author fields while preserving the source chapter')

  const existingForeshadowing = {
    id: 'foreshadowing-1', projectId: 'project-1', title: 'Signal clue', firstChapterOrder: 1,
    description: 'A recurring signal.', status: 'unresolved', weight: 'medium', treatmentMode: 'hint',
    expectedPayoff: '', payoffMethod: '', relatedCharacterIds: ['character-1'], relatedMainPlot: '', notes: '',
    actualPayoffChapter: null, createdAt: timestamp, updatedAt: timestamp
  }
  const foreshadowStatusCandidate = timelineCandidate({
    id: 'memory-foreshadow-status-edit', type: 'foreshadowing', targetId: existingForeshadowing.id,
    proposedPatch: { schemaVersion: 1, kind: 'foreshadowing_status_update', summary: 'Originally resolve clue',
      sourceChapterOrder: 3, warnings: [], foreshadowingId: existingForeshadowing.id, suggestedStatus: 'resolved',
      recommendedTreatmentMode: 'payoff', actualPayoffChapter: 3, evidenceText: 'Original evidence', notes: 'Original note' }
  })
  const foreshadowStatusData = makeData({ foreshadowings: [existingForeshadowing], memoryUpdateCandidates: [foreshadowStatusCandidate] })
  const foreshadowStatusPreview = previewCandidateDecisions(foreshadowStatusData, { projectId: 'project-1', decisions: [{
    ...selection('memory', foreshadowStatusCandidate.id), amendment: {
      kind: 'memory', patch: { kind: 'foreshadowing_status_update', suggestedStatus: 'partial',
        recommendedTreatmentMode: 'advance', evidenceText: 'Author evidence', notes: 'Author note' }
    }
  }] })
  check(foreshadowStatusPreview.items[0].warnings.some((warning) => warning.includes('回收或放弃')) &&
    foreshadowStatusPreview.items[0].risk === 'high',
  'editing a destructive foreshadowing proposal cannot clear its original intrinsic risk')
  const foreshadowUpdated = applyCandidateDecisionCommand(foreshadowStatusData,
    commandFromPreview(foreshadowStatusPreview, { id: 'foreshadow-status-edit-command' })).data.foreshadowings[0]
  check(foreshadowUpdated.status === 'partial' && foreshadowUpdated.treatmentMode === 'advance' &&
    foreshadowUpdated.notes.includes('Author note'),
  'foreshadowing status amendment applies the edited target value to the original target record')

  const stageCandidate = timelineCandidate({
    id: 'memory-stage-edit', type: 'stage_summary', targetId: null,
    proposedPatch: { schemaVersion: 1, kind: 'stage_summary_create', summary: 'Original stage summary',
      sourceChapterOrder: 3, warnings: [], stageSummary: { id: 'stage-summary-1', projectId: 'project-1',
        chapterStart: 1, chapterEnd: 3, compressedPlotSummary: 'Old compressed plot', irreversibleChanges: 'Old change',
        endingCarryoverState: '', emotionalAftertaste: '', pacingState: '', createdAt: timestamp, updatedAt: timestamp } }
  })
  const stageData = makeData({ memoryUpdateCandidates: [stageCandidate] })
  const stagePreview = previewCandidateDecisions(stageData, { projectId: 'project-1', decisions: [{
    ...selection('memory', stageCandidate.id), amendment: { kind: 'memory', patch: { kind: 'stage_summary_create',
      stageSummary: { compressedPlotSummary: 'Author compressed plot', irreversibleChanges: 'The signal cannot be undone.',
        endingCarryoverState: 'The team remains separated.', emotionalAftertaste: 'Uneasy resolve', pacingState: 'accelerating' } } }
  }] })
  const stageCreated = applyCandidateDecisionCommand(stageData,
    commandFromPreview(stagePreview, { id: 'stage-edit-command' })).data.stageSummaries[0]
  check(stageCreated.id === 'stage-summary-1' && stageCreated.chapterStart === 1 && stageCreated.chapterEnd === 3 &&
    stageCreated.compressedPlotSummary === 'Author compressed plot' && stageCreated.pacingState === 'accelerating',
  'stage summary amendment edits compressed author fields while preserving identity and chapter range')

  const editableFact = { ...stateCandidate().proposedFact, id: 'fact-edit-target', valueType: 'number', value: 10,
    label: 'Old resource label', category: 'resource', linkedCardFields: ['abilitiesAndResources'] }
  const editableState = stateCandidate({
    id: 'state-edit-1', targetFactId: editableFact.id, candidateType: 'transaction', proposedFact: null,
    beforeValue: 10, afterValue: null,
    proposedTransaction: { transactionType: 'decrement', delta: 2, source: 'chapter_review', reason: 'Original extraction' }
  })
  const stateEditData = makeData({ characterStateFacts: [editableFact], characterStateChangeCandidates: [editableState] })
  const stateEditSelection = {
    projectId: 'project-1',
    decisions: [{ ...selection('character_state', editableState.id), amendment: {
      kind: 'character_state', label: 'Remaining signal charges', category: 'inventory', targetValue: 7,
      linkedCardFields: ['abilitiesAndResources', 'futureHooks']
    } }]
  }
  const stateEditPreview = previewCandidateDecisions(stateEditData, stateEditSelection)
  check(stateEditPreview.items[0].summary.includes('Remaining signal charges') && stateEditPreview.items[0].summary.endsWith('→ 7'),
    'state amendment preview shows the edited label and final target value')
  check(stateEditPreview.items[0].risk === 'high' &&
    stateEditPreview.items[0].warnings.some((warning) => warning.includes('高风险')),
  'state target-value amendment cannot reduce or clear the original candidate risk')
  const stateEditCommand = commandFromPreview(stateEditPreview, { id: 'state-edit-command-1' })
  const stateEdited = applyCandidateDecisionCommand(stateEditData, stateEditCommand)
  const editedFact = stateEdited.data.characterStateFacts.find((fact) => fact.id === editableFact.id)
  check(editedFact?.value === 7 && editedFact.label === 'Remaining signal charges' && editedFact.category === 'inventory' &&
    JSON.stringify(editedFact.linkedCardFields) === JSON.stringify(['abilitiesAndResources', 'futureHooks']),
  'state amendment atomically persists final value, label, category, and card attachments')
  check(stateEdited.data.characterStateTransactions[0].transactionType === 'update' &&
    stateEdited.data.characterStateTransactions[0].delta === null &&
    stateEdited.data.characterStateTransactions[0].afterValue === 7 &&
    stateEdited.data.characterStateTransactions[0].source === 'chapter_review',
  'state final-value edit preserves source provenance and cannot apply the old decrement twice')
  check(stateEdited.data.characterStateChangeCandidates[0].id === editableState.id &&
    stateEdited.data.characterStateChangeCandidates[0].projectId === editableState.projectId &&
    stateEdited.data.characterStateChangeCandidates[0].chapterId === editableState.chapterId &&
    stateEdited.data.characterStateChangeCandidates[0].status === 'accepted',
  'state edit preserves candidate, project, and source chapter identity')
  check(stateEdited.receipt.amendments?.[0].before.targetValue === 8 &&
    stateEdited.receipt.amendments?.[0].after.targetValue === 7,
  'state receipt traces the original calculated proposal and edited final value')
  const stateEditReplay = applyCandidateDecisionCommand(stateEdited.data, stateEditCommand)
  check(stateEditReplay.replayed && stateEditReplay.data.characterStateFacts.find((fact) => fact.id === editableFact.id)?.value === 7 &&
    stateEditReplay.data.characterStateTransactions.length === 1,
  'replaying an edited final value neither reapplies delta nor appends another transaction')

  function typedStateFixture(id, valueType, value) {
    const fact = { ...stateCandidate().proposedFact, id: `fact-${id}`, key: `key-${id}`,
      label: `Typed ${id}`, valueType, value }
    const candidate = stateCandidate({ id: `candidate-${id}`, targetFactId: fact.id, candidateType: 'update_fact',
      proposedFact: null, proposedTransaction: null, beforeValue: value, afterValue: value, riskLevel: 'medium' })
    return { fact, candidate, data: makeData({ characterStateFacts: [fact], characterStateChangeCandidates: [candidate] }) }
  }

  function typedStatePreview(fixture, targetValue) {
    return previewCandidateDecisions(fixture.data, { projectId: 'project-1', decisions: [{
      ...selection('character_state', fixture.candidate.id), amendment: { kind: 'character_state', targetValue }
    }] })
  }

  const numberFixture = typedStateFixture('number', 'number', 10)
  for (const invalidNumber of ['', '   ', null, 'not-a-number']) {
    await expectReject(() => typedStatePreview(numberFixture, invalidNumber),
      `number target rejects ${invalidNumber === null ? 'null' : JSON.stringify(invalidNumber)} instead of coercing it to zero`)
  }
  const numberPreview = typedStatePreview(numberFixture, '7.5')
  check(numberPreview.items[0].amendmentPreview.after.targetValue === 7.5,
    'number target normalizes a non-empty numeric string to a finite number during preview')
  const numberApplied = applyCandidateDecisionCommand(numberFixture.data,
    commandFromPreview(numberPreview, { id: 'typed-number-command' })).data.characterStateFacts[0]
  check(numberApplied.value === 7.5 && numberApplied.valueType === 'number',
    'number target persists the same numeric value and original valueType shown in preview')

  const booleanFixture = typedStateFixture('boolean', 'boolean', true)
  await expectReject(() => typedStatePreview(booleanFixture, 'false'),
    'boolean target rejects string lookalikes instead of changing value type')
  const booleanPreview = typedStatePreview(booleanFixture, false)
  const booleanApplied = applyCandidateDecisionCommand(booleanFixture.data,
    commandFromPreview(booleanPreview, { id: 'typed-boolean-command' })).data.characterStateFacts[0]
  check(booleanPreview.items[0].amendmentPreview.after.targetValue === false &&
    booleanApplied.value === false && booleanApplied.valueType === 'boolean',
  'boolean target remains boolean in preview and persistence')

  const listFixture = typedStateFixture('list', 'list', ['key'])
  await expectReject(() => typedStatePreview(listFixture, 7),
    'list target rejects non-list scalar values')
  const listPreview = typedStatePreview(listFixture, 'key， coin\nmap,key')
  const listApplied = applyCandidateDecisionCommand(listFixture.data,
    commandFromPreview(listPreview, { id: 'typed-list-command' })).data.characterStateFacts[0]
  check(JSON.stringify(listPreview.items[0].amendmentPreview.after.targetValue) === JSON.stringify(['key', 'coin', 'map']) &&
    JSON.stringify(listApplied.value) === JSON.stringify(['key', 'coin', 'map']) && listApplied.valueType === 'list',
  'list target is normalized once and persists exactly as previewed')

  const textFixture = typedStateFixture('text', 'text', 'Old prose')
  await expectReject(() => typedStatePreview(textFixture, 7),
    'text target rejects numeric values instead of changing value type')
  const textPreview = typedStatePreview(textFixture, 'Author-edited prose')
  const textApplied = applyCandidateDecisionCommand(textFixture.data,
    commandFromPreview(textPreview, { id: 'typed-text-command' })).data.characterStateFacts[0]
  check(textPreview.items[0].amendmentPreview.after.targetValue === 'Author-edited prose' &&
    textApplied.value === 'Author-edited prose' && textApplied.valueType === 'text',
  'text target remains text and persists exactly as previewed')

  await expectReject(() => previewCandidateDecisions(stateEditData, { projectId: 'project-1', decisions: [{
    ...selection('character_state', editableState.id),
    amendment: { kind: 'character_state', targetValue: 7, riskLevel: 'low' }
  }] }), 'state amendment cannot submit a replacement risk level')

  const existingFact = {
    ...stateCandidate().proposedFact,
    id: 'fact-existing-1',
    label: 'Existing scar fact',
    value: 'Existing current value'
  }
  const sameKeyCandidate = stateCandidate({
    beforeValue: 'Existing current value',
    proposedFact: { ...stateCandidate().proposedFact, id: 'fact-proposed-2' }
  })
  const sameKeyData = makeData({
    characterStateFacts: [existingFact],
    characterStateChangeCandidates: [sameKeyCandidate]
  })
  check(sameKeyCandidate.targetFactId === null, 'same-key existing-fact fixture uses a null targetFactId')
  const sameKeySelection = {
    projectId: 'project-1',
    decisions: [selection('character_state', sameKeyCandidate.id)]
  }
  const sameKeyPreview = previewCandidateDecisions(sameKeyData, sameKeySelection)
  check(
    sameKeyPreview.items[0].summary.includes('Existing current value') &&
      sameKeyPreview.items[0].summary.includes('A thin silver scar appears on the left palm.'),
    'same-key state preview shows the existing fact current value before the proposed value'
  )
  const sameKeyApplied = applyCandidateDecisionCommand(
    sameKeyData,
    commandFromPreview(sameKeyPreview, { id: 'same-key-command-1' })
  )
  check(
    sameKeyApplied.data.characterStateFacts.some((fact) => fact.id === 'fact-existing-1' && fact.value === 'A thin silver scar appears on the left palm.') &&
      !sameKeyApplied.data.characterStateFacts.some((fact) => fact.id === 'fact-proposed-2'),
    'same-key state acceptance updates the existing fact instead of creating a second fact'
  )
  const mismatchedSameKeyData = makeData({
    characterStateFacts: [{ ...existingFact, value: 'Changed current value' }],
    characterStateChangeCandidates: [sameKeyCandidate]
  })
  const mismatchedSameKeyPreview = previewCandidateDecisions(mismatchedSameKeyData, sameKeySelection)
  await expectReject(
    () => applyCandidateDecisionCommand(
      mismatchedSameKeyData,
      commandFromPreview(mismatchedSameKeyPreview, { id: 'same-key-stale-command-1' })
    ),
    'same-key state acceptance rejects a beforeValue that no longer matches the current fact'
  )

  for (const kind of ['chapter_review_update', 'character_state_update']) {
    const targetByOrderCandidate = timelineCandidate({
      id: `target-by-order-${kind}`, type: kind === 'chapter_review_update' ? 'chapter_review' : 'character',
      targetId: kind === 'chapter_review_update' ? 'chapter-2' : 'character-1',
      proposedPatch: kind === 'chapter_review_update'
        ? { schemaVersion: 1, kind, summary: 'Review chapter four', warnings: [], targetChapterId: null,
          targetChapterOrder: 4, review: { summary: 'Chapter four reviewed' } }
        : { schemaVersion: 1, kind, summary: 'Change in chapter four', warnings: [], characterId: 'character-1',
          relatedChapterId: null, relatedChapterOrder: 4, changeSummary: 'Now confident',
          newCurrentEmotionalState: 'confident', newRelationshipWithProtagonist: '', newNextActionTendency: '' }
    })
    const orderData = makeData({ memoryUpdateCandidates: [targetByOrderCandidate] })
    orderData.chapters.push(chapter('chapter-2', 'project-1', 4))
    const orderSelection = { projectId: 'project-1', decisions: [selection('memory', targetByOrderCandidate.id)] }
    const orderPreview = previewCandidateDecisions(orderData, orderSelection)
    const orderCommand = commandFromPreview(orderPreview, { id: `order-command-${kind}` })
    const changedOrderData = structuredClone(orderData)
    changedOrderData.chapters.find((item) => item.id === 'chapter-2').body = 'Updated target body'
    await expectReject(() => applyCandidateDecisionCommand(changedOrderData, orderCommand),
      `${kind}: actual order-based target change invalidates the preview`)
    const unrelatedChange = structuredClone(orderData)
    unrelatedChange.chapters.find((item) => item.id === 'chapter-1').body = 'Unrelated job chapter changed'
    check(previewCandidateDecisions(unrelatedChange, orderSelection).items[0].expectedFingerprint === orderPreview.items[0].expectedFingerprint,
      `${kind}: preview uses the explicit patch order instead of the job fallback order`)
    const orderApplied = applyCandidateDecisionCommand(orderData, orderCommand).data
    check(kind === 'chapter_review_update'
      ? orderApplied.chapters.find((item) => item.id === 'chapter-2').summary === 'Chapter four reviewed'
      : orderApplied.characterStateLogs.some((item) => item.chapterId === 'chapter-2' && item.chapterOrder === 4),
    `${kind}: persistence targets the same chapter as preview`)
  }

  for (const operation of [
    { type: 'remove_item', before: ['key', 'coin'], operand: ['key'], delta: null, expected: ['coin'] },
    { type: 'add_item', before: ['coin'], operand: ['key'], delta: null, expected: ['coin', 'key'] },
    { type: 'decrement', before: 10000, operand: null, delta: 5000, expected: 5000 }
  ]) {
    const operationFact = { ...existingFact, value: operation.before }
    const operationCandidate = stateCandidate({ candidateType: 'transaction', targetFactId: operationFact.id,
      proposedFact: null, beforeValue: operation.before, afterValue: operation.operand,
      proposedTransaction: { transactionType: operation.type, delta: operation.delta } })
    const operationData = makeData({ characterStateFacts: [operationFact], characterStateChangeCandidates: [operationCandidate] })
    const operationPreview = previewCandidateDecisions(operationData, {
      projectId: 'project-1', decisions: [selection('character_state', operationCandidate.id)]
    })
    const expectedText = Array.isArray(operation.expected) ? operation.expected.join('、') : String(operation.expected)
    check(operationPreview.items[0].summary.endsWith(`→ ${expectedText}`),
      `${operation.type}: preview displays the resulting value, not the transaction operand`)
    const operationResult = applyCandidateDecisionCommand(operationData, commandFromPreview(operationPreview, { id: `operation-${operation.type}` })).data
    check(JSON.stringify(operationResult.characterStateFacts[0].value) === JSON.stringify(operation.expected),
      `${operation.type}: persisted state equals the value shown in preview`)
    check(operationData.characterStateTransactions.length === 0 && operationData.characterStateChangeCandidates[0].status === 'pending',
      `${operation.type}: preview does not mutate the ledger or candidate`)
  }

  const rejectData = makeData({ memoryUpdateCandidates: [timelineCandidate()] })
  const rejectPreview = previewCandidateDecisions(rejectData, {
    projectId: 'project-1',
    decisions: [selection('memory', 'memory-timeline-1', 'reject')]
  })
  const rejected = applyCandidateDecisionCommand(rejectData, commandFromPreview(rejectPreview, { id: 'reject-command-1' }))
  check(rejected.data.memoryUpdateCandidates[0].status === 'rejected', 'rejecting a candidate records the rejection')
  check(
    rejected.data.timelineEvents.length === 0 &&
      rejected.data.characterStateFacts.length === 0 &&
      rejected.data.characterStateTransactions.length === 0,
    'rejecting a candidate writes no timeline event or state ledger records'
  )

  const replayed = applyCandidateDecisionCommand(applied.data, command)
  check(replayed.replayed === true, 'exact command replay is reported as replayed')
  check(replayed.data.candidateDecisionReceipts.length === 1, 'exact replay does not append a second receipt')
  check(replayed.data.characterStateFacts.filter((fact) => fact.id === 'fact-physical-1').length === 1, 'exact replay does not duplicate the state fact')
  check(replayed.data.timelineEvents.filter((event) => event.id === 'timeline-event-1').length === 1, 'exact replay does not duplicate the timeline event')

  await expectReject(
    () => applyCandidateDecisionCommand(initial, { ...command, decisions: command.decisions.map((item) => ({ ...item, expectedFingerprint: 'stale' })) }),
    'stale candidate fingerprint is rejected'
  )
  const changedCandidate = makeData({
    memoryUpdateCandidates: [timelineCandidate()],
    characterStateChangeCandidates: [stateCandidate()]
  })
  changedCandidate.memoryUpdateCandidates[0] = {
    ...changedCandidate.memoryUpdateCandidates[0],
    evidence: 'The source evidence changed after the author previewed it.'
  }
  await expectReject(
    () => applyCandidateDecisionCommand(changedCandidate, command),
    'changing the candidate source record after preview is rejected'
  )
  const changedSourceTarget = makeData({
    memoryUpdateCandidates: [timelineCandidate()],
    characterStateChangeCandidates: [stateCandidate()]
  })
  changedSourceTarget.chapters[0] = {
    ...changedSourceTarget.chapters[0],
    body: 'The source chapter changed after the author previewed it.'
  }
  await expectReject(
    () => applyCandidateDecisionCommand(changedSourceTarget, command),
    'changing the candidate source target after preview is rejected'
  )
  await expectReject(
    () => previewCandidateDecisions(initial, { projectId: 'project-1', decisions: [selection('memory', 'missing-candidate')] }),
    'missing candidate target is rejected'
  )
  const foreignData = makeData({
    memoryUpdateCandidates: [
      timelineCandidate(),
      timelineCandidate({ id: 'foreign-memory', projectId: 'project-2', proposedPatch: { ...timelineCandidate().proposedPatch, event: { ...timelineCandidate().proposedPatch.event, id: 'foreign-event', projectId: 'project-2' } } })
    ]
  })
  await expectReject(
    () => previewCandidateDecisions(foreignData, { projectId: 'project-1', decisions: [selection('memory', 'foreign-memory')] }),
    'cross-project candidate target is rejected'
  )

  const atomicInput = makeData({
    memoryUpdateCandidates: [timelineCandidate()],
    characterStateChangeCandidates: [stateCandidate()]
  })
  const atomicBefore = JSON.stringify(atomicInput)
  await expectReject(
    () => applyCandidateDecisionCommand(atomicInput, { ...command, decisions: [...command.decisions, selection('memory', 'missing-candidate', 'accept')] }),
    'a multi-item command with one invalid target is rejected as a whole'
  )
  check(JSON.stringify(atomicInput) === atomicBefore, 'a failed multi-item command leaves the input snapshot unchanged')

  await expectReject(
    () => applyCandidateDecisionCommand(applied.data, { ...command, reason: 'altered payload' }),
    'same command ID with altered payload is rejected'
  )
  await expectReject(
    () => applyCandidateDecisionCommand(applied.data, {
      ...command,
      actor: { kind: 'agent', agentRunId: 'agent-1' }
    }),
    'same command ID with altered actor is rejected'
  )
  await expectReject(
    () => previewCandidateDecisions(makeData({ memoryUpdateCandidates: [timelineCandidate({ status: 'rejected' })] }), {
      projectId: 'project-1', decisions: [selection('memory', 'memory-timeline-1', 'accept')]
    }),
    'accepting a memory candidate already rejected is refused'
  )
  await expectReject(
    () => applyCandidateDecisionCommand(makeData({ memoryUpdateCandidates: [timelineCandidate({ status: 'rejected' })] }), {
      ...command,
      decisions: [command.decisions[0]]
    }),
    'apply also refuses accepting a memory candidate already rejected'
  )
  await expectReject(
    () => previewCandidateDecisions(makeData({ characterStateChangeCandidates: [stateCandidate({ status: 'accepted' })] }), {
      projectId: 'project-1', decisions: [selection('character_state', 'state-physical-1', 'reject')]
    }),
    'rejecting a state candidate already accepted is refused'
  )
  await expectReject(
    () => applyCandidateDecisionCommand(makeData({ characterStateChangeCandidates: [stateCandidate({ status: 'accepted' })] }), {
      ...command,
      decisions: [command.decisions[1]]
    }),
    'apply also refuses rejecting a state candidate already accepted'
  )

  const storageSource = await readSource('src/storage/StorageService.ts')
  check(storageSource.includes('executeCandidateDecision'), 'StorageService declares executeCandidateDecision')
  if (pureOnly) {
    console.log('validate-candidate-decisions: pure checks passed')
    return
  }
  const [databaseModule, sqliteModule, jsonModule, queueModule] = await Promise.all([
    import('better-sqlite3'),
    bundle('src/storage/SqliteStorageService.ts', 'sqlite-storage.mjs'),
    bundle('src/storage/JsonStorageService.ts', 'json-storage.mjs'),
    bundle('src/renderer/src/utils/saveQueue.ts', 'save-queue.mjs')
  ])
  const Database = databaseModule.default
  const { SqliteStorageService } = sqliteModule
  const { JsonStorageService } = jsonModule
  const { createOperationQueue } = queueModule

  const sqlitePath = join(outDir, 'candidate-decisions.sqlite')
  const sqlite = new SqliteStorageService(sqlitePath)
  const secretData = makeData({
    memoryUpdateCandidates: [timelineCandidate()],
    characterStateChangeCandidates: [stateCandidate()],
    settings: { ...settings(), apiKey: 'do-not-persist', hasApiKey: true }
  })
  await sqlite.save(secretData)
  const sqliteSnapshot = await sqlite.loadSnapshot()
  const persistedEditInput = { projectId: 'project-1', decisions: [
    { ...selection('memory', 'memory-timeline-1'), amendment: memoryAmendment },
    selection('character_state', 'state-physical-1')
  ] }
  const sqliteCommand = commandFromPreview(previewCandidateDecisions(sqliteSnapshot.data, persistedEditInput), { id: 'decision-command-sqlite-1' })
  const sqliteResult = await sqlite.executeCandidateDecision(sqliteCommand, sqliteSnapshot.revision)
  check(sqliteResult.receipt?.id === sqliteCommand.id && sqliteResult.replayed === false, 'SQLite executeCandidateDecision returns a receipt and first-write marker')
  check(!Object.prototype.hasOwnProperty.call(sqliteResult.changes, 'settings'), 'candidate decision changes exclude raw settings')
  check(!JSON.stringify(sqliteResult.changes).includes('do-not-persist'), 'candidate decision changes do not leak the known API key')
  const sqliteAfter = await sqlite.load()
  check(sqliteAfter.timelineEvents.some((event) => event.id === 'timeline-event-1') && sqliteAfter.characterStateFacts.some((fact) => fact.id === 'fact-physical-1'), 'SQLite atomically persists timeline and state acceptance')
  check(sqliteAfter.timelineEvents.some((event) => event.title === 'Author-edited signal') &&
    sqliteAfter.candidateDecisionReceipts[0].amendments?.[0].after.patch.event.title === 'Author-edited signal',
  'SQLite roundtrip preserves edited content and receipt audit')
  check(sqliteAfter.projects.some((item) => item.id === 'project-2') && sqliteAfter.chapters.some((item) => item.id === 'chapter-foreign'), 'SQLite preserves unrelated project data')
  check(sqliteAfter.settings.apiKey === '', 'SQLite persistence sanitizes API keys')
  const sqliteRevisionAfterFirst = (await sqlite.loadSnapshot()).revision
  const sqliteReplay = await sqlite.executeCandidateDecision(sqliteCommand, sqliteRevisionAfterFirst)
  check(sqliteReplay.replayed === true && sqliteReplay.revision === sqliteRevisionAfterFirst, 'exact SQLite replay preserves revision and does not write again')
  check((await sqlite.load()).candidateDecisionReceipts.length === 1, 'exact SQLite replay does not duplicate the receipt')
  await expectReject(
    () => sqlite.executeCandidateDecision({ ...sqliteCommand, reason: 'altered persisted reason' }, sqliteRevisionAfterFirst),
    'persisted receipt rejects the same ID with an altered reason'
  )
  await expectReject(
    () => sqlite.executeCandidateDecision({ ...sqliteCommand, actor: { kind: 'agent', agentRunId: 'agent-2' } }, sqliteRevisionAfterFirst),
    'persisted receipt rejects the same ID with an altered actor'
  )
  const ledgerUpdate = await sqlite.load()
  ledgerUpdate.characterStateFacts = [
    ...ledgerUpdate.characterStateFacts,
    {
      ...stateCandidate().proposedFact,
      id: 'fact-added-after-decision',
      key: 'later-ledger-entry',
      label: 'A later ledger entry'
    }
  ]
  const ledgerRevision = await sqlite.saveIfCurrent(ledgerUpdate, sqliteRevisionAfterFirst)
  const replayAfterLedger = await sqlite.executeCandidateDecision(sqliteCommand, ledgerRevision.revision)
  const afterLedgerReplay = await sqlite.load()
  check(replayAfterLedger.replayed === true && replayAfterLedger.revision === ledgerRevision.revision, 'same command ID replays after a later ledger update without changing revision')
  check(afterLedgerReplay.characterStateFacts.some((fact) => fact.id === 'fact-added-after-decision') && afterLedgerReplay.candidateDecisionReceipts.length === 1, 'same command ID replay preserves the later ledger update and single receipt')
  sqlite.close()

  const failurePath = join(outDir, 'candidate-decisions-failure.sqlite')
  const failureSeed = new SqliteStorageService(failurePath)
  await failureSeed.save(makeData({
    memoryUpdateCandidates: [timelineCandidate()],
    characterStateChangeCandidates: [stateCandidate()],
    settings: { ...settings(), apiKey: 'failure-secret', hasApiKey: true }
  }))
  const failureSeedSnapshot = await failureSeed.loadSnapshot()
  const failureCommand = commandFromPreview(previewCandidateDecisions(failureSeedSnapshot.data, persistedEditInput), { id: 'decision-command-failure-1' })
  const failureRevision = failureSeedSnapshot.revision
  failureSeed.close()
  const failureDb = new Database(failurePath)
  failureDb.exec(`
    CREATE TRIGGER fail_candidate_receipt_insert
    BEFORE INSERT ON entities
    WHEN NEW.collection = 'candidateDecisionReceipts'
    BEGIN
      SELECT RAISE(FAIL, 'simulated receipt insertion failure');
    END;
  `)
  failureDb.close()
  const failingStorage = new SqliteStorageService(failurePath)
  await expectReject(
    () => failingStorage.executeCandidateDecision(failureCommand, failureRevision),
    'SQLite receipt insertion failure rejects the command'
  )
  failingStorage.close()
  const failureCheck = new SqliteStorageService(failurePath)
  const afterFailureSnapshot = await failureCheck.loadSnapshot()
  check(afterFailureSnapshot.revision === failureRevision, 'SQLite receipt failure rolls back the revision')
  check(afterFailureSnapshot.data.memoryUpdateCandidates.every((candidate) => candidate.status === 'pending'), 'SQLite receipt failure rolls back candidate status changes')
  check(afterFailureSnapshot.data.memoryUpdateCandidates[0].proposedPatch.event.title === 'The observatory signal begins',
    'SQLite receipt failure leaves no half-persisted candidate amendment')
  check(afterFailureSnapshot.data.timelineEvents.length === 0 && afterFailureSnapshot.data.characterStateFacts.length === 0 && afterFailureSnapshot.data.candidateDecisionReceipts.length === 0, 'SQLite receipt failure rolls back all related records')
  failureCheck.close()

  const jsonPath = join(outDir, 'roundtrip', 'novel-director-data.json')
  const json = new JsonStorageService(jsonPath)
  await json.save(secretData)
  const jsonSnapshot = await json.loadSnapshot()
  const jsonCommand = commandFromPreview(previewCandidateDecisions(jsonSnapshot.data, persistedEditInput), { id: 'decision-command-json-1' })
  const jsonResult = await json.executeCandidateDecision(jsonCommand, jsonSnapshot.revision)
  const jsonAfter = await json.load()
  check(jsonResult.receipt?.id === jsonCommand.id && jsonAfter.candidateDecisionReceipts.length === 1, 'JSON executeCandidateDecision persists the receipt')
  check(jsonAfter.timelineEvents.some((event) => event.id === 'timeline-event-1') && jsonAfter.characterStateFacts.some((fact) => fact.id === 'fact-physical-1'), 'JSON export/import roundtrip preserves accepted timeline and state records')
  check(jsonAfter.candidateDecisionReceipts[0].decisions[0].amendment?.kind === 'memory' &&
    jsonAfter.candidateDecisionReceipts[0].amendments?.[0].before.patch.event.title === 'The observatory signal begins',
  'JSON roundtrip preserves normalized amendment and before/after audit')
  check(jsonAfter.settings.apiKey === '', 'JSON export/import roundtrip sanitizes API keys')

  const queuePath = join(outDir, 'queue', 'candidate-decisions.sqlite')
  const queuedStorage = new SqliteStorageService(queuePath)
  await queuedStorage.save(makeData({
    memoryUpdateCandidates: [timelineCandidate()],
    characterStateChangeCandidates: [stateCandidate()]
  }))
  const queue = createOperationQueue()
  let queuedLocalData = await queuedStorage.load()
  const queuedSnapshot = await queuedStorage.loadSnapshot()
  const queuedCommand = commandFromPreview(previewCandidateDecisions(queuedSnapshot.data, selectionInput), { id: 'decision-command-queue-1' })
  const queuedResult = await queue.enqueue(() => queuedStorage.executeCandidateDecision(queuedCommand, queuedSnapshot.revision))
  queuedLocalData = applyCandidateDecisionChanges(queuedLocalData, queuedResult.changes)
  await queue.enqueue(() => queuedStorage.save(queuedLocalData))
  const queuedAfter = await queuedStorage.load()
  check(queuedAfter.candidateDecisionReceipts.length === 1, 'a later queued full save retains the candidate decision receipt')
  check(queuedAfter.timelineEvents.length === 1 && queuedAfter.characterStateFacts.length === 1, 'a later queued full save retains both accepted records')
  queuedStorage.close()

  console.log('validate-candidate-decisions: ok')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
