#!/usr/bin/env node
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

async function bundle(relativePath) {
  const result = await build({
    entryPoints: [join(repoRoot, relativePath)],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['electron'],
    logLevel: 'silent'
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}

function deferred() {
  let resolve
  const promise = new Promise((next) => {
    resolve = next
  })
  return { promise, resolve }
}

const timestamp = '2026-09-06T00:00:00.000Z'

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

function chapter(body = 'Chapter source') {
  return {
    id: 'chapter-1',
    projectId: 'project-1',
    order: 1,
    title: 'Chapter 1',
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

function draft(chapterId = null, body = 'Draft source') {
  return {
    id: 'draft-1',
    projectId: 'project-1',
    jobId: 'job-1',
    chapterId,
    title: 'Draft 1',
    body,
    summary: '',
    status: 'draft',
    tokenEstimate: 3,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function session({ sourceDraftId = null, chapterId = 'chapter-1' } = {}) {
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

async function runLateResponse(generateRevisionFromCurrent, options = {}) {
  const sourceKind = options.sourceKind ?? 'chapter'
  const selectedChapter = options.selectedChapter === undefined ? chapter() : options.selectedChapter
  const selectedDraft = options.selectedDraft ?? null
  const linkedDraftChapter = options.linkedDraftChapter ?? null
  const sourceBody = sourceKind === 'draft' ? selectedDraft.body : selectedChapter.body
  const sourceSession = options.sourceSession ?? session({
    sourceDraftId: sourceKind === 'draft' ? selectedDraft.id : null,
    chapterId: selectedChapter?.id ?? ''
  })
  const started = deferred()
  const release = deferred()
  const messages = []
  let selectedVersionId = null
  let current = {
    projects: [project()],
    chapters: selectedChapter ? [selectedChapter] : [],
    generatedChapterDrafts: selectedDraft ? [selectedDraft] : [],
    revisionSessions: [sourceSession],
    revisionRequests: [],
    revisionVersions: []
  }
  const context = {
    project: project(),
    saveData: async (input) => {
      try {
        current = typeof input === 'function' ? input(current) : input
        return { ok: true }
      } catch (error) {
        return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) }
      }
    },
    confirmAction: async () => true,
    getAiService: async () => ({
      generateRevision: async () => {
        started.resolve()
        await release.promise
        return {
          data: {
            revisedText: 'Late but valid revision',
            changedSummary: 'late response',
            risks: '',
            preservedFacts: ''
          },
          usedAI: true
        }
      }
    }),
    buildRevisionContext: () => 'context',
    sourceKind,
    selectedChapter,
    selectedDraft,
    linkedDraftChapter,
    sourceTitle: sourceKind === 'draft' ? selectedDraft.title : selectedChapter.title,
    sourceBody,
    sourceDraftId: sourceKind === 'draft' ? selectedDraft.id : null,
    activeSessions: [sourceSession],
    sourceRequest: null,
    revisionType: 'custom',
    targetRange: '',
    instruction: 'Revise the source.',
    latestQualityReports: [],
    selectedVersion: null,
    editableVersionBody: '',
    setRevisionType: () => {},
    setInstruction: () => {},
    setSelectedVersionId: (id) => {
      selectedVersionId = id
    },
    setRevisionViewMode: () => {},
    setEditableVersionBody: () => {},
    setLoading: () => {},
    setMessage: (message) => messages.push(message)
  }

  const operation = generateRevisionFromCurrent(context)
  await started.promise
  current = options.mutateWhileRunning ? options.mutateWhileRunning(current) : current
  release.resolve()
  await operation
  return { current, messages, selectedVersionId, sourceSession, sourceBody }
}

async function test(name, operation) {
  await operation()
  console.log(`PASS ${name}`)
}

async function main() {
  const [{ generateRevisionFromCurrent }, { draftContentHash }] = await Promise.all([
    bundle('src/renderer/src/views/revision/revisionGenerationActions.ts'),
    bundle('src/services/DraftDiagnosticBindingService.ts')
  ])

  for (const terminalStatus of ['completed', 'cancelled']) {
    await test(`${terminalStatus} source session remains terminal and the result moves to a new session`, async () => {
      const result = await runLateResponse(generateRevisionFromCurrent, {
        mutateWhileRunning: (current) => ({
          ...current,
          revisionSessions: current.revisionSessions.map((item) => ({
            ...item,
            status: terminalStatus,
            updatedAt: `terminal-${terminalStatus}`
          }))
        })
      })
      const original = result.current.revisionSessions.find((item) => item.id === result.sourceSession.id)
      const replacement = result.current.revisionSessions.find((item) => item.id !== result.sourceSession.id)
      const request = result.current.revisionRequests[0]
      const version = result.current.revisionVersions[0]

      assert.equal(original.status, terminalStatus)
      assert.equal(original.updatedAt, `terminal-${terminalStatus}`)
      assert.ok(replacement)
      assert.equal(replacement.status, 'active')
      assert.equal(replacement.projectId, original.projectId)
      assert.equal(replacement.chapterId, original.chapterId)
      assert.equal(replacement.sourceDraftId, original.sourceDraftId)
      assert.equal(request.sessionId, replacement.id)
      assert.equal(version.sessionId, replacement.id)
      assert.equal(version.sourceContentHash, draftContentHash(result.sourceBody))
      assert.equal(result.selectedVersionId, version.id)
      assert.match(result.messages.at(-1), /原修订会话在生成期间已结束.*新的修订会话/)
    })
  }

  await test('linked draft hashes survive moving a late result away from a cancelled session', async () => {
    const linkedChapter = chapter('Linked chapter source')
    const selectedDraft = draft(linkedChapter.id, 'Linked draft source')
    const result = await runLateResponse(generateRevisionFromCurrent, {
      sourceKind: 'draft',
      selectedChapter: linkedChapter,
      selectedDraft,
      linkedDraftChapter: linkedChapter,
      mutateWhileRunning: (current) => ({
        ...current,
        revisionSessions: current.revisionSessions.map((item) => ({ ...item, status: 'cancelled' }))
      })
    })
    const version = result.current.revisionVersions[0]
    assert.equal(version.sourceContentHash, draftContentHash(selectedDraft.body))
    assert.equal(version.sourceChapterContentHash, draftContentHash(linkedChapter.body))
  })

  await test('changed session ownership is not overwritten and the result is isolated', async () => {
    const result = await runLateResponse(generateRevisionFromCurrent, {
      mutateWhileRunning: (current) => ({
        ...current,
        revisionSessions: current.revisionSessions.map((item) => ({
          ...item,
          projectId: 'project-2',
          chapterId: 'foreign-chapter',
          sourceDraftId: 'foreign-draft',
          updatedAt: 'foreign-update'
        }))
      })
    })
    const original = result.current.revisionSessions.find((item) => item.id === result.sourceSession.id)
    const replacement = result.current.revisionSessions.find((item) => item.id !== result.sourceSession.id)
    assert.deepEqual(
      { projectId: original.projectId, chapterId: original.chapterId, sourceDraftId: original.sourceDraftId, updatedAt: original.updatedAt },
      { projectId: 'project-2', chapterId: 'foreign-chapter', sourceDraftId: 'foreign-draft', updatedAt: 'foreign-update' }
    )
    assert.deepEqual(
      { projectId: replacement.projectId, chapterId: replacement.chapterId, sourceDraftId: replacement.sourceDraftId },
      { projectId: 'project-1', chapterId: 'chapter-1', sourceDraftId: null }
    )
    assert.match(result.messages.at(-1), /项目或来源关联在生成期间已变化.*新的修订会话/)
  })

  await test('draft linkage drift preserves the result without extending the old source session', async () => {
    const selectedDraft = draft(null)
    const sourceSession = session({ sourceDraftId: selectedDraft.id, chapterId: '' })
    const result = await runLateResponse(generateRevisionFromCurrent, {
      sourceKind: 'draft',
      selectedChapter: null,
      selectedDraft,
      sourceSession,
      mutateWhileRunning: (current) => ({
        ...current,
        chapters: [chapter()],
        generatedChapterDrafts: current.generatedChapterDrafts.map((item) => ({
          ...item,
          chapterId: 'chapter-1'
        }))
      })
    })
    const original = result.current.revisionSessions.find((item) => item.id === sourceSession.id)
    const replacement = result.current.revisionSessions.find((item) => item.id !== sourceSession.id)
    const version = result.current.revisionVersions[0]
    assert.equal(original.chapterId, '')
    assert.equal(original.status, 'active')
    assert.equal(replacement.chapterId, '')
    assert.equal(replacement.sourceDraftId, selectedDraft.id)
    assert.equal(version.sessionId, replacement.id)
    assert.equal(version.sourceContentHash, draftContentHash(selectedDraft.body))
    assert.equal(version.sourceChapterContentHash, undefined)
    assert.match(result.messages.at(-1), /原文或章节关联也已变化.*重新生成后再接受/)
  })

  await test('changed source text keeps the old hash in an isolated comparison-only version', async () => {
    const result = await runLateResponse(generateRevisionFromCurrent, {
      mutateWhileRunning: (current) => ({
        ...current,
        chapters: current.chapters.map((item) => ({ ...item, body: 'Chapter changed while AI was running' }))
      })
    })
    const original = result.current.revisionSessions.find((item) => item.id === result.sourceSession.id)
    const replacement = result.current.revisionSessions.find((item) => item.id !== result.sourceSession.id)
    const version = result.current.revisionVersions[0]
    assert.equal(original.status, 'active')
    assert.ok(replacement)
    assert.equal(version.sessionId, replacement.id)
    assert.equal(version.sourceContentHash, draftContentHash(result.sourceBody))
    assert.notEqual(version.sourceContentHash, draftContentHash(result.current.chapters[0].body))
    assert.match(result.messages.at(-1), /该版本仅供对照.*重新生成后再接受/)
  })

  await test('an unchanged active source session is reused without duplication', async () => {
    const result = await runLateResponse(generateRevisionFromCurrent)
    assert.equal(result.current.revisionSessions.length, 1)
    assert.equal(result.current.revisionSessions[0].id, result.sourceSession.id)
    assert.equal(result.current.revisionSessions[0].status, 'active')
    assert.equal(result.current.revisionRequests[0].sessionId, result.sourceSession.id)
    assert.equal(result.current.revisionVersions[0].sessionId, result.sourceSession.id)
    assert.doesNotMatch(result.messages.at(-1), /新的修订会话/)
  })

  console.log('Revision late-response validation passed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
