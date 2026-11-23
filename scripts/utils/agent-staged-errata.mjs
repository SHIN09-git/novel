import assert from 'node:assert/strict'

export async function verifyStagedErrata({ call, snapshot, projectId, storage, buildRequest, makeVersion, commands, modelRequests }) {
  const state = await snapshot()
  const find = (data, order) => data.chapters.find(c => c.projectId === projectId && c.order === order)
  const a = find(state.data, 4), b = find(state.data, 5)
  const old = '第 30 分钟，林澄', fixed = '第 31 分钟，林澄'
  assert.ok(a.body.includes(old))
  a.summary = '旧复盘凭据：' + old + '比对记录。'
  await storage.saveIfCurrent(state.data, state.revision)
  const batch = (await call('startBookRevisionBatch', { projectId, operationId: 'joint', goal: '校对邻章。',
    stageNeighbors: true, chapterIds: [a.id, b.id] })).data
  const scope = { projectId, agentRunId: batch.agentRunId }
  const stage = async (chapter, body, key) => {
    const { hashes, request } = await buildRequest(chapter, key, scope)
    const v = (await makeVersion(request, hashes, key + '-v', body, scope)).data
    return commands(v, hashes, scope)
  }
  const review = async (cmd, operationId, mode = 'full') => (await call('reviewRevisionVersion', { ...cmd, operationId, mode })).data
  const preview = async (cmd, report, operationId, extra = {}) => (await call('previewRevisionCommit',
    { ...cmd, operationId, expectedQualityGateReportId: report.reportId, ...extra })).data
  const apply = async p => (await call('applyApprovedRevisionCommit',
    { ...scope, previewId: p.preview.id, expectedPreviewHash: p.previewHash })).data

  const b1 = await stage(b, '门外的铃声停了。' + b.body, 'stage-b1')
  await assert.rejects(review(b1, 'early-review'), /先完成第 4 章/)
  const a1 = await stage(a, a.body.replace(old, fixed), 'stage-a')
  const first = await review(a1, 'joint-review-1', 'surgical_errata')
  assert.equal(first.passed, true)
  assert.equal(first.stagedNeighbors[0].versionId, b1.versionId)
  const prompt = modelRequests.at(-1).prompt
  assert.ok(prompt.includes('门外的铃声停了。') && prompt.includes('系统计算的实际差异') && !prompt.includes('旧复盘凭据'))
  const stale = await preview(a1, first, 'joint-preview-1')
  const b2 = await stage(b, '楼道里有人敲门。' + b.body, 'stage-b2')
  await assert.rejects(apply(stale), /重审/)
  assert.equal(find((await snapshot()).data, 5).body, b.body)
  const refreshed = await review(a1, 'joint-review-2', 'surgical_errata')
  assert.equal(refreshed.stagedNeighbors[0].versionId, b2.versionId)
  const fresh = await preview(a1, refreshed, 'joint-preview-2', { updateSummaryIfAffected: true })
  assert.equal(fresh.binding.summaryEdit.before, a.summary)
  const editSummary = async value => {
    const s = await snapshot()
    find(s.data, 4).summary = value
    await storage.saveIfCurrent(s.data, s.revision)
  }
  await editSummary('另一次编辑保存的摘要。')
  await assert.rejects(apply(fresh), /摘要在预览后已变化/)
  assert.equal(find((await snapshot()).data, 4).body, a.body)
  await editSummary('第 40 分钟，林澄比对记录。')
  const unrelated = await preview(a1, refreshed, 'other-minute', { updateSummaryIfAffected: true })
  assert.equal(unrelated.binding.summaryEdit, undefined, 'A different minute with the same last digit must not change.')
  await editSummary(a.summary)
  assert.equal((await apply(fresh)).workItem.stagedSeams[0].status, 'awaiting_commit')
  assert.equal(find((await snapshot()).data, 4).summary, a.summary.replace(old, fixed))
  const b3 = await stage(b, '走廊灯灭了。' + b.body, 'stage-b3')
  const count = modelRequests.length
  await assert.rejects(review(b3, 'opening-is-not-errata', 'surgical_errata'), /全章审稿/)
  assert.equal(modelRequests.length, count)
  const rejected = await stage(b, b.body.replace(old, '这是专供模拟审稿退回的末段标记。'), 'stage-b-reject')
  const bad = await review(rejected, 'regression-in-middle', 'surgical_errata')
  assert.equal(bad.passed, false)
  await assert.rejects(preview(rejected, bad, 'reject-b-preview'), /未通过质量门禁/)
  const final = await apply(await preview(b3, await review(b3, 'full-final'), 'final-preview'))
  assert.equal(final.workItem.state, 'complete')
  assert.equal(final.workItem.stagedSeams[0].status, 'needs_recheck')
  assert.equal(find((await snapshot()).data, 5).body, '走廊灯灭了。' + b.body)
  console.log('PASS staged neighbors, stale preview, ordered commits, scoped errata, summary mirror and changed-seam notification')
}
