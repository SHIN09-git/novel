import assert from 'node:assert/strict'

async function change(call, projectId, operationId, action, options = {}) {
  const args = { projectId, operationId, action, reason: '用隔离样书验证全库管理权。', ...options }
  const preview = (await call('previewProjectAction', args)).data
  assert.equal(preview.authorized, true)
  const applyArgs = { ...args, expectedFingerprint: preview.fingerprint }
  return { args, applyArgs, applied: (await call('applyProjectAction', applyArgs)).data }
}

async function changeBible(call, projectId, text, operationId = 'library-bible') {
  const args = { projectId, operationId, reason: '核对该书资料。', entity: 'story_bible', patch: { corePremise: text } }
  const preview = (await call('previewBookReferenceEdit', args)).data
  return (await call('applyBookReferenceEdit', { ...args, expectedFingerprint: preview.fingerprint })).data.receipt
}

export async function openLibraryWithOneGrant({ call, authority, storagePath, otherProjectId, otherStoragePath, otherProfile, snapshot }) {
  const create = { operationId: 'library-create-a', name: '隔离样书甲', reason: '验证一条授权创建多部作品。',
    storyBible: { worldbuilding: '普通公寓。', immutableFacts: '蓝色信封来源尚未确认。' } }
  const update = { projectId: otherProjectId, operationId: 'library-unauthorized', action: 'update',
    patch: { description: '不能在未经授权时写入。' }, reason: '验证没有授权。' }
  const noGrant = (await call('getLibraryAuthorization')).data
  assert.equal(noGrant.active, false)
  const unauthorized = (await call('previewProjectAction', update)).data
  assert.equal(unauthorized.authorized, false)
  await assert.rejects(call('applyProjectAction', { ...update, expectedFingerprint: unauthorized.fingerprint }),
    { code: 'AGENT_AUTHORIZATION_REQUIRED' })
  await assert.rejects(call('createProject', create), /没有可用的开书授权/)

  const grant = await authority.grantLibrary(storagePath)
  assert.equal(grant.purpose, 'library_manager')
  assert.equal((await authority.grantLibrary(storagePath)).id, grant.id)
  assert.equal((await call('getLibraryAuthorization')).data.grantId, grant.id)
  assert.equal((await call('getLibraryAuthorization', { storagePath: otherStoragePath })).data.active, false)
  assert.equal((await call('getLibraryAuthorization', { userDataPath: otherProfile })).data.active, false)
  for (const scope of [{ storagePath: otherStoragePath }, { userDataPath: otherProfile }]) {
    const out = { ...update, ...scope }
    const preview = (await call('previewProjectAction', out)).data
    await assert.rejects(call('applyProjectAction', { ...out, expectedFingerprint: preview.fingerprint }),
      { code: 'AGENT_AUTHORIZATION_REQUIRED' })
  }

  const newBook = (await call('createProject', create)).data
  const { projectId } = newBook
  const another = (await call('createProject', { ...create, operationId: 'library-create-b', name: '隔离样书乙' })).data
  assert.notEqual(another.projectId, projectId)
  assert.equal(newBook.authorizationGrantId, grant.id)
  assert.equal(another.authorizationGrantId, grant.id)
  assert.equal((await call('createProject', create)).data.replayed, true)
  await assert.rejects(call('createProject', { ...create, name: '编号已用' }), /内容不一致/)
  await assert.rejects(call('createProject', { ...create, projectId: otherProjectId }), { code: 'AGENT_AUTHORIZATION_REQUIRED' })
  assert.equal((await call('listBookCreationSlots')).data.slots.length, 0)
  for (const id of [otherProjectId, projectId, another.projectId]) {
    const { data } = await call('getProjectAuthorization', { projectId: id })
    assert.deepEqual(data.grants, [])
    assert.equal(data.libraryGrant.id, grant.id)
    assert.equal((await changeBible(call, id, `来自 ${id} 的纲领。`)).authorizationGrantId, grant.id)
  }

  const character = { projectId, entity: 'character', action: 'create', operationId: 'library-cast',
    source: { kind: 'agent_director', reason: '登记既定主角。' }, patch: { name: '林澄', isMain: true, role: '主角' } }
  const appearance = (await call('previewWorldAction', character)).data
  assert.equal((await call('applyWorldAction', { ...character, expectedFingerprint: appearance.fingerprint })).data.audit.authorizationGrantId, grant.id)
  const before = (await snapshot()).data.projects.find(item => item.id === otherProjectId)
  const draft = { projectId: otherProjectId, operationId: 'library-stale-preview', action: 'update', reason: '模拟旧预览。',
    patch: { name: '新资料不应被旧预览覆盖' } }
  const stale = (await call('previewProjectAction', draft)).data
  const edited = await change(call, otherProjectId, 'library-edit-name', 'update', { patch: { name: '隔离样书乙' } })
  await assert.rejects(call('applyProjectAction', { ...draft, expectedFingerprint: stale.fingerprint }), /项目资料有变化/)
  await assert.rejects(call('getStoryBible', { project: '隔离样书乙' }), /同名作品/)
  await change(call, otherProjectId, 'library-edit-genre', 'update', { patch: { genre: '新题材' } })
  const reverted = await change(call, otherProjectId, 'library-undo-name', 'revert', { restoreOperationId: edited.args.operationId })
  assert.equal(reverted.applied.receipt.source.restoredFromOperationId, edited.args.operationId)
  assert.equal(reverted.applied.receipt.after.name, before.name)
  assert.equal(reverted.applied.receipt.after.genre, '新题材')
  assert.equal((await call('applyProjectAction', edited.applyArgs)).data.replayed, true)
  assert.equal((await snapshot()).data.projects.find(item => item.id === otherProjectId).name, before.name)
  assert.equal((await call('getProjectDigest', { projectId: another.projectId })).data.project.name, '隔离样书乙')
  return { projectId, otherProjectId, anotherId: another.projectId, grant }
}

export async function verifyArchiveAndHistory({ call, snapshot, projectId, otherProjectId, anotherId, modelRequests }) {
  const initial = (await snapshot()).data
  const first = initial.chapters.find(item => item.projectId === projectId && item.order === 1)
  const completedRun = initial.agentRuns.find(item => item.projectId === projectId && item.mode === 'multi_chapter')
  const modelCount = modelRequests.length
  const archive = await change(call, projectId, 'library-archive-manuscript', 'archive')
  assert.ok(archive.applied.receipt.after.archivedAt)
  assert.ok(!(await call('listProjects')).data.some(item => item.id === projectId))
  assert.deepEqual((await call('listProjects', { status: 'archived' })).data.map(item => item.id), [projectId])
  assert.equal((await call('listProjects', { status: 'all' })).data.length, 3)
  assert.equal((await call('getChapterText', { projectId, chapterOrder: 1, detail: 'full' })).data.text, first.body)
  assert.equal((await call('getChapterWorkItem', { projectId })).data.state, 'project_archived')
  await assert.rejects(call('runChapterPipeline', { projectId, chapterOrder: 6 }), /请先恢复项目/)
  await assert.rejects(call('retryChapterPipeline', { jobId: completedRun.createdJobIds[0], agentRunId: completedRun.id,
    projectId: otherProjectId }), /请先恢复项目/)
  await assert.rejects(call('startBookRevisionBatch', { projectId, chapterIds: [first.id], goal: '不得修改归档书。', operationId: 'archived-revision' }),
    /请先恢复项目/)
  await assert.rejects(call('previewChapterTitleRename', { projectId, operationId: 'archived-title', prefixMode: 'manual',
    edits: [{ chapterId: first.id, title: '不能重命名' }] }), /请先恢复项目/)
  await assert.rejects(changeBible(call, projectId, '归档状态不得改章。', 'archived-bible'), /请先恢复项目/)
  assert.equal(modelRequests.length, modelCount)
  const archived = (await snapshot()).data
  for (const key of ['chapters', 'chapterVersions', 'chapterCommitBundles', 'revisionCommitBundles', 'chapterGenerationJobs',
    'chapterGenerationSteps', 'qualityGateReports', 'storyBibles', 'stageSummaries']) assert.deepEqual(archived[key], initial[key], key)
  assert.equal((await call('applyProjectAction', archive.applyArgs)).data.replayed, true)
  const restored = await change(call, projectId, 'library-restore-manuscript', 'revert', { restoreOperationId: archive.args.operationId })
  assert.equal(restored.applied.receipt.after.archivedAt, null)
  await change(call, anotherId, 'library-archive-secondary', 'archive')
  const unarchived = await change(call, anotherId, 'library-restore-secondary', 'restore')
  assert.equal(unarchived.applied.receipt.after.archivedAt, null)
  assert.equal((await call('listProjects', { status: 'archived' })).data.length, 0)
  const page = (await call('getLibraryActionHistory', { limit: 4 })).data
  assert.equal(page.nextOffset, 4)
  const rest = (await call('getLibraryActionHistory', { offset: 4 })).data
  assert.equal(page.total, page.receipts.length + rest.receipts.length)
  assert.equal(new Set([...page.receipts, ...rest.receipts].map(item => item.projectId)).size, 3)
  const operation = [...page.receipts, ...rest.receipts].find(item => item.operationId === restored.args.operationId)
  assert.ok(operation)
  const history = (await call('getWorldActionReceipt', operation.read.arguments)).data.receipt
  assert.equal(history.before.archivedAt, archive.applied.receipt.after.archivedAt)
  assert.equal(history.after.archivedAt, null)
  assert.equal((await call('getChapterWorkItem', { projectId, agentRunId: completedRun.id })).data.state, 'complete')
  return { projectsManaged: 3, projectsOpened: 2, archivedAndRestored: 2, projectHistoryReceipts: page.total }
}
