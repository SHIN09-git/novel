import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const oldEnding = '第 2 号纸条从门缝滑了进来。'
export const revisedEnding = '林澄数了数钱袋，里面还剩三枚铜钱。其中一枚有道横刻。他的左腕仍有些酸痛。'

const proseStep = (data, jobId) => data.chapterGenerationSteps.find(step =>
  step.jobId === jobId && step.type === 'generate_chapter_draft')

export async function assertStaleCandidates(call, snapshot, projectId, agentRunId, candidates) {
  const ids = candidates.map(([kind, candidateId]) => ({ kind, candidateId, decision: 'accept' }))
  const before = await snapshot()
  const preview = await call('previewCandidateDecisions', { projectId, decisions: ids })
  assert.equal(preview.data.authorization, 'stale_source')
  assert.equal(preview.data.agentCanApply, false)
  assert.ok(preview.data.items.every(item => item.sourceStatus === 'stale'))
  await assert.rejects(call('applyCandidateDecisions', {
    projectId, agentRunId, operationId: 'try-stale-' + candidates[0][1], reason: 'Even a project grant cannot accept stale evidence.',
    expectedRevision: before.revision, confirmedHighRisk: true,
    decisions: ids.map(item => ({ ...item,
      expectedFingerprint: preview.data.items.find(source => source.candidateId === item.candidateId).expectedFingerprint
    }))
  }), { code: 'CANDIDATE_SOURCE_STALE' })
  assert.equal((await snapshot()).revision, before.revision, 'A stale acceptance must not write anything.')
}

export async function verifyDraftRevisionLoop({ api, call, snapshot, projectId, agentRunId, item, modelRequests }) {
  const { id: draftId, draftContentHash } = item.draft
  const before = await snapshot()
  const draft = before.data.generatedChapterDrafts.find(candidate => candidate.id === draftId)
  const originalReport = item.review.reports.find(report => report.kind === 'quality_gate').reportId
  const oldMemory = before.data.memoryUpdateCandidates.find(candidate =>
    candidate.jobId === item.job.id && candidate.proposedPatch.kind === 'chapter_review_update')
  const oldState = before.data.characterStateChangeCandidates.find(candidate => candidate.jobId === item.job.id)
  assert.ok(oldMemory, 'The original review must produce a persisted memory candidate.')
  assert.ok(oldState, 'The original review must produce a persisted character state candidate.')
  for (const candidate of [oldMemory, oldState]) {
    assert.equal(candidate.sourceDraftId, draftId)
    assert.equal(candidate.sourceDraftContentHash, draftContentHash)
  }
  const replacement = { ...draft, id: 'replacement-fixture', createdAt: '2099-01-01T00:00:00.000Z' }
  const superseded = { ...before.data, generatedChapterDrafts: [...before.data.generatedChapterDrafts, replacement] }
  assert.equal(api.readCandidateDraftSource(superseded, oldMemory).status, 'stale')
  assert.equal(api.readCandidateDraftSource(before.data, oldMemory).status, 'current_draft')
  const count = modelRequests.length
  const reason = '先停在当前稿，核对是否保留纸条。'
  const scope = { projectId, agentRunId }
  const decision = { ...scope, draftId, expectedDraftContentHash: draftContentHash,
    operationId: 'journey-defer-ch2', decision: 'defer', reason }
  await call('recordDraftDecision', decision)
  const deferred = (await call('getChapterWorkItem', scope)).data
  assert.equal(deferred.state, 'draft_deferred')
  assert.equal(deferred.directorDecision.reason, reason)
  assert.equal(deferred.draft.id, draftId)
  assert.equal((await call('recordDraftDecision', decision)).data.replayed, true)
  await assert.rejects(call('recordDraftDecision', { ...decision, reason: 'different decision' }), /不同的草稿决定/)
  const hashes = { expectedSourceHash: draftContentHash, expectedChapterHash: null }
  const { data: request } = await call('createRevisionRequest', { ...scope, ...hashes, draftId,
    operationId: 'journey-request-ch2', reason: '更换结尾，保留其他正文。', type: 'custom', instruction: '把纸条换成盘点钱袋。' })
  const body = draft.body.replace(oldEnding, revisedEnding)
  assert.notEqual(body, draft.body)
  const { data: version } = await call('createManualRevisionVersion', {
    ...scope, ...hashes, requestId: request.requestId, expectedRequestHash: request.requestHash, body,
    operationId: 'journey-version-ch2', reason: '将手写的整章修订作为候选。'
  })
  const apply = { ...scope, ...hashes, versionId: version.version.id, expectedVersionHash: version.versionHash,
    operationId: 'journey-apply-ch2', reason: '仅应用到原草稿并重审。' }
  await assert.rejects(call('applyRevisionToDraft', { ...apply, expectedVersionHash: 'wrong' }), /修订候选已变化/)
  const { data: applied } = await call('applyRevisionToDraft', apply)
  const after = await snapshot()
  assert.equal(applied.appliedToDraft, true)
  assert.equal(applied.formalCommit, false)
  assert.equal(applied.draftId, draftId)
  assert.equal(applied.workItem.draft.id, draftId)
  assert.equal(applied.workItem.directorDecision, undefined)
  assert.equal(applied.workItem.job.resumeFrom, 'generate_chapter_review')
  assert.equal(applied.workItem.review.complete, false)
  assert.equal(applied.workItem.acceptance.preview, undefined)
  assert.deepEqual(after.data.chapters, before.data.chapters)
  assert.deepEqual(after.data.chapterCommitBundles, before.data.chapterCommitBundles)
  assert.deepEqual(after.data.revisionCommitBundles, before.data.revisionCommitBundles)
  assert.equal(after.data.revisionSessions.find(session => session.id === version.version.sessionId).status, 'completed')
  assert.equal(after.data.revisionVersions.find(candidate => candidate.id === version.version.id).status, 'accepted')
  assert.deepEqual(proseStep(after.data, item.job.id), proseStep(before.data, item.job.id))
  assert.equal((await call('applyRevisionToDraft', apply)).data.replayed, true)
  assert.equal((await snapshot()).revision, after.revision)
  assert.equal(modelRequests.length, count)
  await assert.rejects(call('getDraftReviewReport', { ...item.review.readReport.arguments, reportId: originalReport,
    kind: 'quality_gate' }), { code: 'DRAFT_VERSION_CHANGED' })
  await assert.rejects(call('recordDraftDecision', { ...decision, operationId: 'reject-with-obsolete-hash', decision: 'reject' }),
    { code: 'DRAFT_VERSION_CHANGED' })

  await assertStaleCandidates(call, snapshot, projectId, agentRunId, [['memory', oldMemory.id], ['character_state', oldState.id]])
  const reject = { kind: 'memory', candidateId: oldMemory.id, decision: 'reject' }
  const preview = await call('previewCandidateDecisions', { projectId, decisions: [reject] })
  const receipt = await call('applyCandidateDecisions', { ...scope, operationId: 'close-stale-memory',
    reason: '纸条线索已从当前正文删除。', expectedRevision: preview.storage.revision,
    decisions: [{ ...reject, expectedFingerprint: preview.data.items[0].expectedFingerprint }]
  })
  assert.ok(receipt.data.receipt)

  const { data: renewed } = await call('retryChapterPipeline', applied.workItem.resume.arguments)
  const reviewed = await snapshot()
  const latest = renewed.workItem
  assert.equal(latest.review.complete, true)
  assert.equal(latest.draft.id, draftId)
  assert.notEqual(latest.draft.draftContentHash, draftContentHash)
  assert.notEqual(latest.review.reports.find(report => report.kind === 'quality_gate').reportId, originalReport)
  assert.deepEqual(proseStep(reviewed.data, item.job.id), proseStep(before.data, item.job.id))
  assert.equal(reviewed.data.generatedChapterDrafts.find(candidate => candidate.id === draftId).body, body)
  const requests = modelRequests.slice(count)
  assert.ok(requests.length > 0)
  assert(!requests.some(request => /You are (planning the target chapter|drafting a novel chapter)/.test(request.prompt)))
  assert(requests.some(request => request.prompt.includes(revisedEnding)))
  return { item: latest, reReviewCalls: requests.length }
}

export async function leaveStoppedClaim({ directory, storage, storagePath, jobId }) {
  const bundle = pathToFileURL(join(directory, 'api.mjs')).href
  // Exit as a crashed executor would: close the process without releasing its job claim.
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const api = await import(${JSON.stringify(bundle)}); await api.claimAgentJobExecution(process.argv[1], process.argv[2]);`,
    storagePath, jobId], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stderr)
  const { data, revision } = await storage.loadSnapshot()
  data.chapterGenerationJobs.find(job => job.id === jobId).status = 'running'
  proseStep(data, jobId).status = 'running'
  await storage.saveIfCurrent(data, revision)
}
