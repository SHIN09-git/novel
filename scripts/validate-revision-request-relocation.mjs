#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const tempRoot = join(repoRoot, 'tmp')
await mkdir(tempRoot, { recursive: true })
const outDir = await mkdtemp(join(tempRoot, 'revision-request-relocation-'))
const timestamp = '2026-09-06T00:00:00.000Z'

async function test(label, run) {
  await run()
  console.log(`PASS ${label}`)
}

function project(id = 'project-1') {
  return {
    id,
    name: id,
    genre: '',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: '',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function draft(body, overrides = {}) {
  return {
    id: 'draft-1',
    projectId: 'project-1',
    chapterId: null,
    jobId: 'job-1',
    title: 'Draft',
    body,
    summary: '',
    status: 'draft',
    tokenEstimate: 10,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function chapter(id, body, projectId = 'project-1') {
  return {
    id,
    projectId,
    order: id === 'chapter-1' ? 1 : 2,
    title: id,
    body,
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

function session(overrides = {}) {
  return {
    id: 'session-old',
    projectId: 'project-1',
    chapterId: '',
    sourceDraftId: 'draft-1',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function request(oldHash, targetRange = 'The brass key turned.', overrides = {}) {
  return {
    id: 'request-old',
    sessionId: 'session-old',
    type: 'fix_continuity',
    targetRange,
    instruction: 'Explain why the key turns.',
    sourceEditorialVerdictId: 'verdict-old',
    sourceEditorialIssueId: 'issue-old',
    sourceDraftContentHash: oldHash,
    createdAt: timestamp,
    ...overrides
  }
}

function version(oldHash) {
  return {
    id: 'version-old',
    sessionId: 'session-old',
    requestId: 'request-old',
    title: 'Old candidate',
    body: 'An old candidate must remain readable.',
    changedSummary: '',
    risks: '',
    preservedFacts: '',
    sourceContentHash: oldHash,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function relocationInput(overrides = {}) {
  return {
    projectId: 'project-1',
    sourceKind: 'draft',
    chapterId: '',
    sourceDraftId: 'draft-1',
    requestId: 'request-old',
    expectedSourceContentHash: '',
    mode: 'selection',
    targetRange: 'The brass key turned.',
    type: 'improve_dialogue',
    instruction: 'Keep my edited instruction exactly.',
    relocatedRequestId: 'request-relocated',
    createdAt: '2026-09-06T00:01:00.000Z',
    ...overrides
  }
}

function saveHarness(initial) {
  let current = structuredClone(initial)
  let writes = 0
  const messages = []
  return {
    current: () => current,
    writes: () => writes,
    messages,
    setCurrent: (next) => { current = next },
    saveData: async (input) => {
      try {
        const next = typeof input === 'function' ? input(current) : input
        if (JSON.stringify(next) !== JSON.stringify(current)) writes += 1
        current = next
        return { ok: true }
      } catch (error) {
        return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) }
      }
    }
  }
}

function actionContext(data, sourceBody, overrides = {}) {
  const harness = saveHarness(data)
  let aiCalls = 0
  let selectedRequestId = null
  let selectedVersionId = null
  let targetRange = overrides.targetRange ?? 'The brass key turned.'
  const selectedDraft = data.generatedChapterDrafts[0]
  const context = {
    project: data.projects[0],
    saveData: harness.saveData,
    confirmAction: async () => true,
    getAiService: async () => {
      aiCalls += 1
      return {
        generateRevision: async () => ({
          data: {
            revisedText: 'The brass key turned because Mira warmed the lock.',
            changedSummary: 'Clarified the lock.',
            risks: '',
            preservedFacts: 'The key still turns.'
          },
          usedAI: true
        })
      }
    },
    buildRevisionContext: () => 'fixture context',
    sourceKind: 'draft',
    selectedChapter: null,
    selectedDraft,
    linkedDraftChapter: null,
    sourceTitle: selectedDraft.title,
    sourceBody,
    sourceDraftId: selectedDraft.id,
    activeSessions: data.revisionSessions,
    sourceRequest: data.revisionRequests.find((item) => item.id === (overrides.requestId ?? 'request-old')) ?? null,
    revisionType: overrides.revisionType ?? 'improve_dialogue',
    targetRange,
    instruction: overrides.instruction ?? 'Keep my edited instruction exactly.',
    latestQualityReports: [],
    selectedVersion: overrides.selectedVersion ?? null,
    editableVersionBody: overrides.selectedVersion?.body ?? '',
    setRevisionType: () => {},
    setTargetRange: (value) => { targetRange = typeof value === 'function' ? value(targetRange) : value },
    setInstruction: () => {},
    setSourceRequestId: (value) => { selectedRequestId = typeof value === 'function' ? value(selectedRequestId) : value },
    setSelectedVersionId: (value) => { selectedVersionId = typeof value === 'function' ? value(selectedVersionId) : value },
    setRevisionViewMode: () => {},
    setEditableVersionBody: () => {},
    setLoading: () => {},
    setMessage: (message) => harness.messages.push(message)
  }
  return {
    context,
    harness,
    aiCalls: () => aiCalls,
    selectedRequestId: () => selectedRequestId,
    selectedVersionId: () => selectedVersionId,
    targetRange: () => targetRange
  }
}

try {
  const outfile = join(outDir, 'relocation.mjs')
  await build({
    stdin: {
      contents: `
        export * from './src/services/RevisionRequestRelocationService';
        export { draftContentHash } from './src/services/DraftDiagnosticBindingService';
        export { relocateSourceRequest } from './src/renderer/src/views/revision/revisionRequestRelocationActions';
        export { generateRevisionFromCurrent } from './src/renderer/src/views/revision/revisionGenerationActions';
        export { acceptVersion } from './src/renderer/src/views/revision/revisionVersionActions';
        export { normalizeAppData } from './src/shared/defaults';
      `,
      resolveDir: repoRoot,
      loader: 'ts'
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
  const {
    acceptVersion,
    assessRevisionRequestRelocation: assess,
    draftContentHash: hash,
    generateRevisionFromCurrent,
    normalizeAppData,
    relocateRevisionRequest: relocate,
    relocateSourceRequest
  } = await import(pathToFileURL(outfile).href)

  const oldBody = 'Opening. The brass key turned. Closing.'
  const oldHash = hash(oldBody)
  const source = (sourceBody) => ({
    projectId: 'project-1',
    chapterId: '',
    sourceDraftId: 'draft-1',
    sourceBody
  })
  const oldSession = session()
  const oldRequest = request(oldHash)

  await test('unique original selection is suggested on the latest body', () => {
    const result = assess(oldRequest, oldSession, source('New opening. The brass key turned. New closing.'))
    assert.equal(result.status, 'unique')
    assert.equal(result.suggestedTargetRange, 'The brass key turned.')
    assert.equal(result.matchCount, 1)
  })

  await test('missing and repeated selections require author choice', () => {
    const missing = assess(oldRequest, oldSession, source('The lock is gone.'))
    const repeated = assess(oldRequest, oldSession, source('The brass key turned. Again, The brass key turned.'))
    assert.equal(missing.status, 'missing')
    assert.equal(missing.suggestedTargetRange, null)
    assert.equal(repeated.status, 'ambiguous')
    assert.equal(repeated.matchCount, 2)
  })

  await test('full-chapter request remains explicit and requires rebinding', () => {
    const result = assess(request(oldHash, ''), oldSession, source('A wholly new chapter.'))
    assert.equal(result.status, 'full_chapter')
    assert.equal(result.requiresRelocation, true)
  })

  const latestBody = 'New opening. The brass key turned. New closing.'
  const base = normalizeAppData({
    projects: [project(), project('project-2')],
    chapters: [chapter('chapter-1', 'Chapter one.'), chapter('chapter-2', 'Chapter two.')],
    generatedChapterDrafts: [draft(latestBody)],
    revisionSessions: [oldSession],
    revisionRequests: [oldRequest],
    revisionVersions: [version(oldHash)]
  })

  await test('relocation appends a current request while preserving edits and old evidence', () => {
    const before = structuredClone(base)
    const result = relocate(base, relocationInput({ expectedSourceContentHash: hash(latestBody) }))
    assert.equal(result.request.type, 'improve_dialogue')
    assert.equal(result.request.instruction, 'Keep my edited instruction exactly.')
    assert.equal(result.request.targetRange, 'The brass key turned.')
    assert.equal(result.request.sourceDraftContentHash, hash(latestBody))
    assert.equal(result.request.relocatedFromRequestId, 'request-old')
    assert.equal(result.request.sourceEditorialVerdictId, 'verdict-old')
    assert.equal(result.request.sourceEditorialIssueId, 'issue-old')
    assert.deepEqual(result.data.revisionRequests[1], before.revisionRequests[0])
    assert.deepEqual(result.data.revisionVersions, before.revisionVersions)
    assert.equal(base.revisionRequests.length, 1)
  })

  await test('selection relocation rejects missing and repeated new targets', () => {
    assert.throws(() => relocate(base, relocationInput({
      expectedSourceContentHash: hash(latestBody),
      targetRange: 'Missing selection.'
    })), /唯一出现/)
    const duplicateBody = 'Repeat this. Middle. Repeat this.'
    const duplicateData = normalizeAppData({
      ...base,
      generatedChapterDrafts: [draft(duplicateBody)]
    })
    assert.throws(() => relocate(duplicateData, relocationInput({
      expectedSourceContentHash: hash(duplicateBody),
      targetRange: 'Repeat this.'
    })), /唯一出现/)
  })

  await test('explicit full-chapter relocation clears only the new target', () => {
    const result = relocate(base, relocationInput({
      expectedSourceContentHash: hash(latestBody),
      mode: 'full_chapter',
      targetRange: 'ignored for explicit full chapter',
      relocatedRequestId: 'request-full'
    }))
    assert.equal(result.request.targetRange, '')
    assert.equal(result.data.revisionRequests.find((item) => item.id === 'request-old').targetRange, 'The brass key turned.')
  })

  await test('cross-chapter and cross-project sources are isolated', () => {
    const chapterSession = session({ chapterId: 'chapter-1', sourceDraftId: null })
    const chapterRequest = request(oldHash, 'Chapter one.', { sessionId: chapterSession.id })
    const chapterData = normalizeAppData({
      projects: base.projects,
      chapters: base.chapters,
      revisionSessions: [chapterSession],
      revisionRequests: [chapterRequest]
    })
    assert.throws(() => relocate(chapterData, relocationInput({
      sourceKind: 'chapter',
      chapterId: 'chapter-2',
      sourceDraftId: null,
      expectedSourceContentHash: hash('Chapter two.')
    })), /不属于当前项目、章节或草稿/)
    assert.throws(() => relocate(chapterData, relocationInput({
      projectId: 'project-2',
      sourceKind: 'chapter',
      chapterId: 'chapter-1',
      sourceDraftId: null,
      expectedSourceContentHash: hash('Chapter one.')
    })))
  })

  await test('UI action confirms and saves relocation without calling AI', async () => {
    const state = actionContext(base, latestBody)
    await relocateSourceRequest(state.context, 'selection')
    assert.equal(state.aiCalls(), 0)
    assert.equal(state.harness.writes(), 1)
    assert.ok(state.selectedRequestId())
    assert.equal(state.harness.current().revisionRequests.length, 2)
    assert.equal(state.harness.current().revisionVersions[0].id, 'version-old')
  })

  await test('a source change during confirmed relocation leaves no partial request', async () => {
    const state = actionContext(base, latestBody)
    const originalSave = state.context.saveData
    state.context.saveData = async (input) => {
      state.harness.setCurrent({
        ...state.harness.current(),
        generatedChapterDrafts: [draft('Changed again after confirmation.')]
      })
      return originalSave(input)
    }
    await relocateSourceRequest(state.context, 'selection')
    assert.equal(state.aiCalls(), 0)
    assert.equal(state.harness.current().revisionRequests.length, 1)
    assert.match(state.harness.messages.at(-1), /确认期间再次变化/)
  })

  await test('old candidate stays readable but cannot overwrite the latest draft', async () => {
    const state = actionContext(base, latestBody, { selectedVersion: base.revisionVersions[0] })
    const beforeVersion = structuredClone(state.harness.current().revisionVersions[0])
    await acceptVersion(state.context, base.revisionVersions[0])
    assert.deepEqual(state.harness.current().revisionVersions[0], beforeVersion)
    assert.equal(state.harness.current().generatedChapterDrafts[0].body, latestBody)
    assert.equal(state.harness.writes(), 0)
    assert.match(state.harness.messages.at(-1), /修订所依据的正文已变化/)
  })

  await test('relocated request generates a new candidate against the latest body', async () => {
    const relocated = relocate(base, relocationInput({ expectedSourceContentHash: hash(latestBody) }))
    const state = actionContext(relocated.data, latestBody, { requestId: 'request-relocated' })
    await generateRevisionFromCurrent(state.context)
    const generatedVersion = state.harness.current().revisionVersions.find((item) => item.id !== 'version-old')
    const generatedRequest = state.harness.current().revisionRequests.find(
      (item) => item.id === generatedVersion.requestId
    )
    assert.equal(state.aiCalls(), 1)
    assert.ok(generatedVersion.body.includes('because Mira warmed the lock'))
    assert.equal(generatedVersion.sourceContentHash, hash(latestBody))
    assert.equal(generatedRequest.sourceDraftContentHash, hash(latestBody))
    assert.equal(generatedRequest.relocatedFromRequestId, 'request-old')
    assert.equal(generatedRequest.instruction, 'Keep my edited instruction exactly.')
    assert.ok(state.selectedVersionId())
  })

  console.log('validate-revision-request-relocation: ok')
} finally {
  await rm(outDir, { recursive: true, force: true })
}
