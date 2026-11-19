import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './repo-root.mjs'

export async function validateChapterWorkItemReconnect({ api, directory, projectId, data, agentRunId }) {
  const executable = join(directory, 'work-item-mcp.mjs')
  await build({
    entryPoints: [join(repoRoot, 'src/agent/mcp/server.ts')],
    outfile: executable, bundle: true, format: 'esm', platform: 'node', target: 'node22',
    external: ['better-sqlite3', 'electron'], logLevel: 'silent',
    banner: { js: 'globalThis.fetch = () => { throw new Error("Network not allowed in this read-only test.") }' }
  })
  const storagePath = join(directory, 'reconnect.sqlite')
  const userDataPath = join(directory, 'reconnect-profile')
  await mkdir(userDataPath)
  const storage = new api.SqliteStorageService(storagePath)
  let checks = 0
  const rpc = (method, params) => {
    const proc = spawnSync(process.execPath, [executable], {
      cwd: repoRoot, encoding: 'utf8', input: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n',
      timeout: 10000, windowsHide: true
    })
    assert.ifError(proc.error)
    assert.equal(proc.status, 0, proc.stderr)
    checks++
    return JSON.parse(proc.stdout)
  }
  const request = (name, args = {}) => rpc('tools/call', { name, arguments: { storagePath, userDataPath, ...args } })
  const call = (name, args) => {
    const response = request(name, args)
    assert.equal(response.error, undefined, JSON.stringify(response.error))
    assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent)
    return response.result.structuredContent
  }
  const read = args => call('agent.getChapterWorkItem', { projectId, ...args })

  try {
    const tools = rpc('tools/list', {}).result.tools
    for (const name of ['agent.getChapterWorkItem', 'agent.getDraftReviewReport', 'agent.getRevisionReview',
      'agent.listBookCreationSlots', 'agent.previewBookReferenceEdit', 'agent.getLibraryAuthorization',
      'agent.previewProjectAction', 'agent.getLibraryActionHistory']) {
      assert.equal(tools.find(tool => tool.name === name)?.annotations.readOnlyHint, true)
    }
    for (const name of ['agent.applyRevisionToDraft', 'agent.recordDraftDecision', 'agent.createProject',
      'agent.applyBookReferenceEdit', 'agent.startBookRevisionBatch', 'agent.reviewRevisionVersion', 'agent.applyProjectAction']) {
      const tool = tools.find(item => item.name === name)
      assert.ok(tool)
      assert.notEqual(tool.annotations?.readOnlyHint, true)
      assert.equal(tool.inputSchema.additionalProperties, false)
    }

    const draft = data.generatedChapterDrafts.find(item => item.status === 'draft')
    const quality = data.qualityGateReports.find(item => item.draftId === draft.id)
    const longEvidence = '这是可按需读取的审稿原句。'.repeat(40)
    const replacement = {
      ...quality, id: 'work-item-quality-current',
      issues: [{ severity: 'low', type: 'pacing', description: '可选调整这个节拍', evidence: longEvidence, suggestedFix: '检查这一段的节奏' }]
    }
    const stale = { ...quality, id: 'work-item-quality-stale', draftContentHash: 'previous-content-hash',
      createdAt: '2099-01-01T00:00:00.000Z', pass: false, overallScore: 2 }
    // Reuse a persisted five-chapter fixture checkpoint, not any real book.
    await storage.save({ ...data, qualityGateReports: [replacement, stale],
      editorialVerdicts: data.editorialVerdicts.map(item => item.draftId === draft.id
        ? { ...item, sourceRefs: { ...item.sourceRefs, qualityGateReportId: replacement.id } } : item) })
    const revisionBeforeReads = (await storage.loadSnapshot()).revision

    const first = read()
    assert.equal(first.data.state, 'review_draft')
    assert.equal(first.data.agentRunId, agentRunId)
    assert.equal(first.data.draft.id, draft.id)
    assert.equal(first.data.acceptance.state, 'needs_authorization')
    assert.equal(first.data.review.score, quality.overallScore)
    assert.deepEqual(Object.keys(first.data.task), ['read'])
    const savedTask = data.chapterGenerationJobs.find(job => job.id === draft.jobId).chapterTaskSnapshot
    const taskRead = call(first.data.task.read.tool, first.data.task.read.arguments)
    assert.equal(taskRead.data.source.jobId, draft.jobId)
    assert.deepEqual(taskRead.data.task, savedTask)
    assert(!JSON.stringify(first.data).includes(draft.body))
    assert(!JSON.stringify(first.data).includes(longEvidence))
    const selected = first.data.review.reports.find(item => item.kind === 'quality_gate')
    assert.deepEqual(selected, { kind: 'quality_gate', reportId: replacement.id })

    // Each call starts a new server. Recovery does not depend on cached IDs or a
    // still-connected MCP client.
    const reopened = read()
    assert.deepEqual(reopened, first)
    const readArgs = reopened.data.review.readReport.arguments
    const full = call('agent.getDraftReviewReport', { ...readArgs, ...selected })
    assert.equal(full.data.report.issues[0].evidence, longEvidence)
    assert.deepEqual(call('agent.getDraftText', reopened.data.draft.read.arguments).data.text, draft.body)
    assert.equal(request('agent.getDraftReviewReport', { ...readArgs, kind: 'quality_gate', reportId: stale.id })
      .error.data.code, 'DRAFT_REPORT_CHANGED')
    assert.equal((await storage.loadSnapshot()).revision, revisionBeforeReads)

    const authority = new api.AgentAuthorizationService(userDataPath)
    await authority.grant({ storagePath, projectId, actions: ['accept_draft'], chapterStart: 1, chapterEnd: 1 })
    const authorized = read().data
    assert.equal(authorized.acceptance.state, 'available')
    assert.equal(request('agent.previewChapterAcceptance', { ...authorized.acceptance.preview.arguments,
      expectedQualityGateReportId: stale.id, operationId: 'stale-review-fixture',
      reason: 'A newer report must not be substituted during preview.'
    }).error.data.code, 'DRAFT_REPORT_CHANGED')

    const beforeRule = await storage.loadSnapshot()
    await storage.saveIfCurrent({ ...beforeRule.data, hardCanonPacks: beforeRule.data.hardCanonPacks.map(pack =>
      pack.projectId !== projectId ? pack : { ...pack, items: [...pack.items, {
        id: 'work-item-blocking-rule', projectId, title: '禁写纸条', content: '禁写纸条。', category: 'prohibition',
        priority: 'must', status: 'active', createdAt: draft.createdAt, updatedAt: draft.createdAt,
        check: { kind: 'literal', mode: 'terms', terms: ['纸条'], enforcement: 'block', maxPerChapter: 0 }
      }] }) }, beforeRule.revision)
    const blocked = read().data
    assert.equal(blocked.acceptance.state, 'hard_canon_blocked')
    assert.equal(blocked.acceptance.preview, undefined)
    assert(blocked.review.findings.some(item => item.kind === 'hard_canon' && item.excerpt))
    const canon = blocked.review.reports.find(item => item.kind === 'hard_canon')
    assert(call('agent.getDraftReviewReport', { ...readArgs, ...canon }).data.report.findings[0].end > 0)

    const beforeEdit = await storage.loadSnapshot()
    const edited = api.invalidateDraftDiagnosticsAfterChange(
      { ...beforeEdit.data, hardCanonPacks: beforeRule.data.hardCanonPacks }, draft.id,
      `${draft.body}\n林澄把新纸条留在了桌上。`, '2099-06-01T00:00:00.000Z')
    await storage.saveIfCurrent(edited, beforeEdit.revision)
    const changed = read().data
    assert.equal(changed.draft.id, draft.id)
    assert.notEqual(changed.draft.draftContentHash, first.data.draft.draftContentHash)
    assert.equal(changed.review.complete, false)
    assert(!changed.review.reports.some(item => item.kind === 'quality_gate'))
    assert.equal(changed.job.resumeFrom, 'generate_chapter_review')
    assert.equal(changed.resume.arguments.jobId, first.data.job.id)
    assert.equal(request('agent.getDraftText', first.data.draft.read.arguments).error.data.code, 'DRAFT_VERSION_CHANGED')
    assert.equal(request('agent.getDraftReviewReport', { ...readArgs, ...selected }).error.data.code, 'DRAFT_VERSION_CHANGED')
    assert.equal(request('agent.previewChapterAcceptance', {
      projectId, jobId: first.data.job.id, draftId: draft.id, agentRunId,
      expectedDraftContentHash: first.data.draft.draftContentHash, mode: 'reviewed',
      operationId: 'stale-preview-fixture', reason: 'A stale decision must not become a preview for another body.'
    }).error.data.code, 'DRAFT_VERSION_CHANGED')

    const renewed = await api.AgentToolService.callTool({
      name: changed.resume.tool, arguments: { storagePath, userDataPath, ...changed.resume.arguments }
    })
    assert.equal(renewed.data.workItem.review.complete, true)
    assert.equal(renewed.data.workItem.draft.draftContentHash, changed.draft.draftContentHash)
    const afterReview = await storage.loadSnapshot()
    const proseStep = snapshot => snapshot.chapterGenerationSteps.find(step =>
      step.jobId === draft.jobId && step.type === 'generate_chapter_draft')
    assert.deepEqual(proseStep(afterReview.data), proseStep(beforeEdit.data), 'Rechecking the draft must not rerun prose.')

    const { data: current, revision } = await storage.loadSnapshot()
    await storage.saveIfCurrent({ ...current, agentRuns: [...current.agentRuns, {
      ...current.agentRuns[0], id: 'second-eligible-run', createdJobIds: [], createdDraftIds: [], targetChapterOrders: [7]
    }] }, revision)
    const choose = read().data
    assert.equal(choose.state, 'select_run')
    assert.equal(choose.runs.length, 2)
    const currentItem = read({ agentRunId }).data
    assert.equal(currentItem.draft.id, draft.id)
    const reject = { ...currentItem.decide.arguments, operationId: 'mcp-fixture-reject',
      reason: '保留样稿作证据，但这份不进入正式章节。', decision: 'reject' }
    const rejected = call('agent.recordDraftDecision', reject).data
    assert.equal(rejected.workItem.state, 'draft_rejected')
    assert.equal(rejected.workItem.directorDecision.reason, reject.reason)
    assert.equal(rejected.workItem.nextAction.tool, 'agent.previewChapterTaskEdit')
    assert.equal(read({ agentRunId }).data.directorDecision.id, rejected.decisionId)
    const savedRejection = await storage.loadSnapshot()
    assert.equal(savedRejection.data.chapters.length, 0)
    assert.equal(savedRejection.data.chapterCommitBundles.length, 0)
    assert.equal(call(rejected.workItem.readRejectedDraft.tool,
      rejected.workItem.readRejectedDraft.arguments).data.text, edited.generatedChapterDrafts.find(item => item.id === draft.id).body)
    assert.equal(call('agent.recordDraftDecision', reject).data.replayed, true)
    assert.equal((await storage.loadSnapshot()).revision, savedRejection.revision)
    const refusedRetry = request('agent.retryChapterPipeline', { agentRunId, jobId: draft.jobId })
    assert.match(refusedRetry.error.message, /草稿已拒绝/)
    const libraryGrant = await authority.grantLibrary(storagePath)
    const apply = (input) => {
      const preview = call('agent.previewProjectAction', input).data
      assert.equal(preview.authorized, true)
      return call('agent.applyProjectAction', { ...input, expectedFingerprint: preview.fingerprint }).data
    }
    assert.equal(call('agent.getLibraryAuthorization').data.grantId, libraryGrant.id)
    const archive = { projectId, operationId: 'mcp-fixture-archive', action: 'archive', reason: '归档检查。' }
    assert.equal(apply(archive).receipt.authorizationGrantId, libraryGrant.id)
    assert.equal(read().data.state, 'project_archived')
    const restored = apply({ ...archive, operationId: 'mcp-fixture-restore', action: 'restore' })
    assert.equal(restored.receipt.after.archivedAt, null)
    const history = call('agent.getLibraryActionHistory', { projectId }).data
    assert.ok(history.receipts.some(item => item.operationId === 'mcp-fixture-archive'))
    assert.ok(history.receipts.some(item => item.operationId === 'mcp-fixture-restore'))
    assert.equal((await storage.loadSnapshot()).data.generatedChapterDrafts.find(item => item.id === draft.id).status, 'rejected')
    return checks
  } finally {
    storage.close()
  }
}
