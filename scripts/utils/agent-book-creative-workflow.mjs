import assert from 'node:assert/strict'
import { verifyStagedErrata } from './agent-staged-errata.mjs'

export const rejectedRevisionMarker = '这是专供模拟审稿退回的末段标记。'

async function changeReference(call, projectId, operationId, change) {
  const args = { projectId, operationId, reason: '核对本书创作记录后明确调整资料。', ...change }
  const preview = (await call('previewBookReferenceEdit', args)).data
  const applied = (await call('applyBookReferenceEdit', { ...args, expectedFingerprint: preview.fingerprint })).data
  assert.equal(applied.receipt.operationId, operationId)
  return applied
}

export async function openBookWithOneGrant({ call, authority, storagePath, otherProjectId, snapshot }) {
  const create = { operationId: 'creative-open', name: '全书创作权隔离样书', reason: '测试一次授权，从空白开书。',
    storyBible: { worldbuilding: '普通公寓。', immutableFacts: '蓝色信封来源尚未确认。' } }
  assert.deepEqual((await call('listBookCreationSlots')).data.slots, [])
  await assert.rejects(call('createProject', create), /没有可用的开书授权/)
  await assert.rejects(call('createProject', { ...create, confirm: true }), /不支持的创作参数/)
  const grant = await authority.grantBookCreativeRights(storagePath)
  assert.equal(grant.purpose, 'book_creation')
  assert.ok(!grant.actions.includes('accept_unreviewed_draft'))
  const { slots } = (await call('listBookCreationSlots')).data
  assert.deepEqual(slots.map(item => item.projectId), [grant.projectId])
  const opened = (await call('createProject', create)).data
  const projectId = opened.projectId
  assert.equal(projectId, grant.projectId)
  assert.equal(opened.authorizationGrantId, grant.id)
  assert.equal((await call('createProject', create)).data.replayed, true)
  assert.deepEqual((await call('listBookCreationSlots')).data.slots, [])
  await assert.rejects(call('createProject', { ...create, operationId: 'creative-second-book', projectId }), /已使用/)
  await assert.rejects(call('createProject', { ...create, projectId: otherProjectId }), { code: 'AGENT_AUTHORIZATION_REQUIRED' })
  const denied = { projectId: otherProjectId, operationId: 'creative-foreign', reason: '不应能改另一本书。',
    entity: 'story_bible', patch: { worldbuilding: '不能写进另一本书。' } }
  const deniedPreview = (await call('previewBookReferenceEdit', denied)).data
  await assert.rejects(call('applyBookReferenceEdit', { ...denied, expectedFingerprint: deniedPreview.fingerprint }),
    { code: 'AGENT_AUTHORIZATION_REQUIRED' })
  assert.equal((await snapshot()).data.worldManagementReceipts.find(item => item.id === opened.receiptId).entity, 'project')

  const character = { projectId, entity: 'character', action: 'create', operationId: 'creative-cast',
    source: { kind: 'agent_director', reason: '登记既定主角。' }, patch: { name: '林澄', isMain: true, role: '主角' } }
  const appearance = (await call('previewWorldAction', character)).data
  assert.equal((await call('applyWorldAction', { ...character, expectedFingerprint: appearance.fingerprint })).data.audit.authorizationGrantId, grant.id)
  const changed = await changeReference(call, projectId, 'creative-bible-edit',
    { entity: 'story_bible', patch: { worldbuilding: '仍是普通公寓，现补充楼道只连接地面。' } })
  assert.equal(changed.receipt.authorizationGrantId, grant.id)
  const reopened = await changeReference(call, projectId, 'creative-bible-undo', { restoreOperationId: changed.receipt.operationId })
  assert.equal(reopened.receipt.source.restoredFromOperationId, 'creative-bible-edit')
  assert.equal((await call('getStoryBible', { projectId, detail: 'full' })).data.bible.worldbuilding, '普通公寓。')
  return grant
}

export async function checkGenerationGate({ call, snapshot, storage, projectId, agentRunId, item }) {
  const snapshotBefore = await snapshot()
  const fail = structuredClone(snapshotBefore.data)
  const report = fail.qualityGateReports.find(r => r.id === item.acceptance.preview.arguments.expectedQualityGateReportId)
  report.pass = false
  report.overallScore = 25
  await storage.saveIfCurrent(fail, snapshotBefore.revision)
  const current = (await call('getChapterWorkItem', { projectId, agentRunId })).data
  assert.equal(current.acceptance.state, 'needs_passing_review')
  await assert.rejects(call('previewChapterAcceptance', { ...item.acceptance.preview.arguments,
    operationId: 'must-not-accept-failed-gate', reason: '门禁失败不能由授权覆盖。' }), /必须完成审稿并通过质量门禁/)
  const state = await snapshot()
  assert.equal(state.data.chapterCommitBundles.length, 0)
  await storage.saveIfCurrent(snapshotBefore.data, state.revision)
}

export async function verifyBookRevisionBatch({ call, snapshot, projectId, grant, authority, storagePath, modelRequests, stagedErrata, storage }) {
  const modelStart = modelRequests.length
  const original = (await snapshot()).data
  const chapters = original.chapters.filter(item => item.projectId === projectId)
  const first = chapters.find(item => item.order === 1), third = chapters.find(item => item.order === 3)
  const stage = await changeReference(call, projectId, 'creative-stage-create', { entity: 'stage_summary',
    patch: { chapterStart: 1, chapterEnd: 3, compressedPlotSummary: '林澄按章核对记录。' } })
  const summaryId = stage.receipt.targetId
  const revisedStage = await changeReference(call, projectId, 'creative-stage-edit', { entity: 'stage_summary',
    summaryId, patch: { compressedPlotSummary: '林澄核对了前三份记录。' } })
  await assert.rejects(call('previewBookReferenceEdit', { projectId, operationId: 'creative-stale-stage', reason: '不覆盖新稿。',
    restoreOperationId: 'creative-stage-create' }), /后来已改动/)
  await changeReference(call, projectId, 'creative-stage-undo', { restoreOperationId: revisedStage.receipt.operationId })
  assert.equal((await call('getStageSummaries', { projectId, summaryId, detail: 'full' })).data.summaries[0].compressedPlotSummary,
    '林澄按章核对记录。')
  await changeReference(call, projectId, 'creative-stage-remove', { restoreOperationId: stage.receipt.operationId })
  assert.equal((await call('getStageSummaries', { projectId, summaryId })).data.total, 0)
  assert.ok((await snapshot()).data.chapters.filter(item => item.projectId === projectId).every(item => !item.includedInStageSummary))

  const opened = (await call('startBookRevisionBatch', { projectId, operationId: 'creative-revision-batch',
    goal: '分别校订两个不相邻章节，先审先提交。', chapterIds: [third.id, first.id] })).data
  const { agentRunId } = opened
  const scope = { projectId, agentRunId }
  assert.equal(opened.workItem.chapterId, first.id)
  const buildRequest = async (chapter, key, runScope = scope) => {
    const source = (await call('getRevisionSessions', { projectId, chapterId: chapter.id })).data.currentSource
    const hashes = { expectedSourceHash: source.sourceContentHash, expectedChapterHash: source.sourceChapterContentHash }
    const { data: request } = await call('createRevisionRequest', { ...runScope, ...hashes, chapterId: chapter.id,
      operationId: key + '-request', reason: '保持事实，微调节奏。', instruction: '保留原稿，补一个清楚的承接动作。' })
    return { hashes, request }
  }
  await assert.rejects(buildRequest(third, 'creative-too-early'), /先完成第 1 章/)
  const makeVersion = (request, hashes, operationId, body, runScope = scope) => call('createManualRevisionVersion', { ...runScope, ...hashes, operationId,
    reason: '保存完整待审修订。', requestId: request.requestId, expectedRequestHash: request.requestHash, body })
  const commands = (versionData, hashes, runScope = scope) => ({ ...runScope, ...hashes, versionId: versionData.version.id,
    expectedVersionHash: versionData.versionHash, reason: '核对本章当前正文和衔接。' })

  let firstReportId
  for (const chapter of [first, third]) {
    const key = 'creative-revision-' + chapter.order
    const { hashes, request } = await buildRequest(chapter, key)
    const body = chapter.body + '\n林澄合上记录簿，把它放回了桌面。'
    if (chapter.id === first.id) {
      const bad = (await makeVersion(request, hashes, key + '-bad-version', body + rejectedRevisionMarker)).data
      const badCommand = commands(bad, hashes)
      const badReview = (await call('reviewRevisionVersion', { ...badCommand, operationId: key + '-fail-review' })).data
      assert.equal(badReview.passed, false)
      await assert.rejects(call('previewRevisionCommit', { ...badCommand, operationId: key + '-fail-preview',
        expectedQualityGateReportId: badReview.reportId }), /未通过质量门禁/)
      await assert.rejects(buildRequest(third, 'creative-before-first-written'), /先完成第 1 章/)
      assert.equal((await snapshot()).data.chapters.find(item => item.id === chapter.id).body, chapter.body)
    }
    const edited = (await makeVersion(request, hashes, key + '-version', body)).data
    const command = commands(edited, hashes)
    await assert.rejects(call('previewRevisionCommit', { ...command, operationId: key + '-premature' }), /缺少.*审稿报告/)
    const reviewCommand = { ...command, operationId: key + '-review' }
    const review = (await call('reviewRevisionVersion', reviewCommand)).data
    assert.equal(review.passed, true, JSON.stringify(review))
    if (chapter.id === first.id) firstReportId = review.reportId
    else await assert.rejects(call('previewRevisionCommit', { ...command, operationId: key + '-wrong-report',
      expectedQualityGateReportId: firstReportId }), /缺少.*审稿报告/)
    assert.equal((await call('reviewRevisionVersion', reviewCommand)).data.replayed, true)
    const read = (await call('getRevisionReview', review.read.arguments)).data
    assert.equal(read.qualityGateReport.id, review.reportId)
    assert.equal(read.consistencyReviewReport.draftContentHash, read.qualityGateReport.draftContentHash)
    const preview = (await call('previewRevisionCommit', { ...command, operationId: key + '-preview',
      expectedQualityGateReportId: review.reportId })).data
    const accept = { ...scope, previewId: preview.preview.id, expectedPreviewHash: preview.previewHash }
    if (chapter.id === first.id) {
      await changeReference(call, projectId, 'creative-context-change', { entity: 'story_bible', patch: { worldbuilding: '公寓楼已有改动。' } })
      await assert.rejects(call('applyApprovedRevisionCommit', accept), /缺少.*审稿报告/)
      await changeReference(call, projectId, 'creative-context-restore', { restoreOperationId: 'creative-context-change' })
    }
    const applied = (await call('applyApprovedRevisionCommit', accept)).data
    assert.equal(applied.formalCommit, true)
    assert.equal((await call('applyApprovedRevisionCommit', accept)).data.replayed, true)
    assert.equal(applied.workItem.state, chapter.id === first.id ? 'revise_chapter' : 'complete')
    if (chapter.id === first.id) assert.equal(applied.workItem.chapterId, third.id)
    const committed = (await snapshot()).data
    const receipt = committed.revisionCommitBundles.find(item => item.revisionCommitId === applied.revisionCommitId)
    assert.equal(receipt.qualityGateReportId, review.reportId)
    assert.equal(receipt.actor.authorizationGrantId, grant.id)
    assert.equal(receipt.beforeText, chapter.body)
    assert.equal(receipt.afterText, body)
    assert.equal(committed.chapters.find(item => item.id === chapter.id).body, body)
    assert.ok(committed.chapterVersions.some(item => item.chapterId === chapter.id && item.body === chapter.body))
  }
  assert.equal(modelRequests.length - modelStart, 3)
  assert.equal((await snapshot()).data.revisionCommitBundles.filter(item => item.projectId === projectId).length, 2)

  const { data: restoreBatch } = await call('startBookRevisionBatch', { projectId, operationId: 'creative-restore-batch',
    goal: '从版本链恢复第 1 章旧正文。', chapterIds: [first.id] })
  const restoreScope = { projectId, agentRunId: restoreBatch.agentRunId }
  const historical = original.chapterVersions.find(item => item.chapterId === first.id && item.body === first.body)
  const savedText = (await call('getVersionDetail', { projectId, chapterOrder: 1, versionId: historical.id, detail: 'full' })).data.text
  const { request, hashes } = await buildRequest(first, 'creative-restore', restoreScope)
  const restored = (await makeVersion(request, hashes, 'creative-restore-version', savedText, restoreScope)).data
  const restoreCommand = commands(restored, hashes, restoreScope)
  const restoreReview = (await call('reviewRevisionVersion', { ...restoreCommand, operationId: 'creative-restore-review' })).data
  assert.equal(restoreReview.passed, true)
  const restorePreview = (await call('previewRevisionCommit', { ...restoreCommand, operationId: 'creative-restore-preview',
    expectedQualityGateReportId: restoreReview.reportId })).data
  const submitRestore = { ...restoreScope, previewId: restorePreview.preview.id, expectedPreviewHash: restorePreview.previewHash }
  const result = (await call('applyApprovedRevisionCommit', submitRestore)).data
  const afterRestore = (await snapshot()).data
  assert.equal(result.workItem.state, 'complete')
  assert.equal(afterRestore.chapters.find(item => item.id === first.id).body, first.body)
  assert.equal(afterRestore.revisionCommitBundles.filter(item => item.chapterId === first.id).length, 2)
  const restoreCommit = afterRestore.revisionCommitBundles.find(item => item.revisionCommitId === result.revisionCommitId)
  const restoredDetail = (await call('getVersionDetail', { projectId, chapterOrder: 1,
    versionId: restoreCommit.newChapterVersionId, detail: 'full' })).data
  assert.equal(restoredDetail.metadata.revisionReview.arguments.reportId, restoreReview.reportId)

  if (stagedErrata) await verifyStagedErrata({ call, snapshot, projectId, storage, buildRequest, makeVersion, commands, modelRequests })
  if (grant.purpose === 'library_manager') await authority.revokeLibrary(storagePath, grant.id)
  else await authority.revoke(grant.id, storagePath, projectId)
  const denied = { projectId, operationId: 'creative-revoked-edit', reason: '授权已撤回，不能继续写入。',
    entity: 'story_bible', patch: { immutableFacts: '新内容' } }
  const deniedPreview = (await call('previewBookReferenceEdit', denied)).data
  await assert.rejects(call('applyBookReferenceEdit', { ...denied, expectedFingerprint: deniedPreview.fingerprint }),
    { code: 'AGENT_AUTHORIZATION_REQUIRED' })
  await assert.rejects(call('archiveChapter', { projectId, chapterId: first.id, confirm: true }),
    { code: 'AGENT_AUTHORIZATION_REQUIRED' })
  return { revisionChapters: 2, historicalVersionsRestored: 1, revisionReviewMockCalls: modelRequests.length - modelStart, authorGrants: 1 }
}
