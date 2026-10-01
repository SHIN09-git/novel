#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const tempRoot = join(repoRoot, 'tmp')
await mkdir(tempRoot, { recursive: true })
const dir = await mkdtemp(join(tempRoot, 'agent-grant-workflow-'))
let checks = 0
async function check(label, run) { await run(); checks++; console.log(`  ok - ${label}`) }
try {
  const output = join(dir, 'api.mjs')
  await build({ stdin: { contents: `
    export {AgentToolService} from './src/agent/tools/AgentToolService';
    export {AgentAuthorizationService} from './src/main/services/AgentAuthorizationService';
    export {loadAgentRuntimeData} from './src/agent/AgentRuntime';
    export {JsonStorageService} from './src/storage/JsonStorageService';
    export {SqliteStorageService} from './src/storage/SqliteStorageService';
    export {normalizeAppData} from './src/shared/defaults';
    export {draftContentHash} from './src/services/DraftDiagnosticBindingService';
    export {createIdRemaps, rememberId, remapReferencesDeep} from './src/main/dataMerge/referenceRemapping';
  `, resolveDir: repoRoot, loader: 'ts' }, outfile: output, bundle: true, platform: 'node', format: 'esm',
    target: 'node22', external: ['better-sqlite3', 'electron'], logLevel: 'silent' })
  const api = await import(pathToFileURL(output).href)
  await check('world receipt import resolves entity IDs even when collections reuse the same original ID', async () => {
    const remaps = api.createIdRemaps()
    api.rememberId(remaps, 'characters', 'same', 'character-imported')
    api.rememberId(remaps, 'foreshadowings', 'same', 'foreshadowing-imported')
    api.rememberId(remaps, 'projects', 'p', 'p-imported')
    const receipt = api.remapReferencesDeep({ projectId: 'p', entity: 'character', targetId: 'same',
      commandFingerprint: 'historical-command', previewFingerprint: 'historical-preview',
      before: { id: 'same', projectId: 'p', name: '原名' }, after: { id: 'same', projectId: 'p', name: '新名' } }, remaps)
    assert.equal(receipt.targetId, 'character-imported')
    assert.equal(receipt.before.id, 'character-imported')
    assert.equal(receipt.after.projectId, 'p-imported')
    assert.equal(receipt.commandFingerprint, 'historical-command')
    assert.equal(remaps.unresolvedGenericReferences.size, 0)
  })
  const time = '2026-09-07T00:00:00.000Z'
  const body = '这是用于授权验收的虚构正文。主角在雨中等待回信，没有新增规则。'
  function fixture(reviewed = false) {
    return api.normalizeAppData({
      projects: ['p', 'foreign'].map(id => ({ id, name: id, createdAt: time, updatedAt: time })),
      chapters: [{ id: 'chapter', projectId: 'p', order: 2, title: '原稿', body: '原稿内容保留。', createdAt: time, updatedAt: time }],
      characters: [{ id: 'character', projectId: 'p', name: '林宁', createdAt: time, updatedAt: time }],
      chapterGenerationJobs: [{ id: 'job', projectId: 'p', targetChapterOrder: 2, status: 'completed', createdAt: time, updatedAt: time }],
      generatedChapterDrafts: [{ id: 'draft', jobId: 'job', projectId: 'p', chapterId: 'chapter', title: '新稿', body, status: 'draft', createdAt: time, updatedAt: time }],
      agentRuns: [{ id: 'run', projectId: 'p', createdJobIds: ['job'], targetChapterOrders: [2], status: 'running', startedAt: time, updatedAt: time }],
      characterStateChangeCandidates: [{ id: 'candidate', projectId: 'p', jobId: 'job', chapterId: 'chapter', chapterOrder: 2,
        characterId: 'character', candidateType: 'create_fact', status: 'pending', riskLevel: 'high', evidence: '明确角色身体变化。',
        proposedFact: { id: 'fact', projectId: 'p', characterId: 'character', category: 'physical', key: 'injury', label: '右手伤势', valueType: 'text', value: '右手结晶化', trackingLevel: 'hard' },
        createdAt: time, updatedAt: time }],
      qualityGateReports: reviewed ? [{ id: 'quality', projectId: 'p', chapterId: 'chapter', jobId: 'job', draftId: 'draft',
        draftContentHash: api.draftContentHash(body), overallScore: 20, passed: false, createdAt: time }] : []
    })
  }
  let counter = 0
  async function harness(sqlite, reviewed = false) {
    const userDataPath = join(dir, `case-${++counter}`)
    await mkdir(userDataPath)
    const storagePath = join(userDataPath, sqlite ? 'data.sqlite' : 'data.json')
    const storage = sqlite ? new api.SqliteStorageService(storagePath) : new api.JsonStorageService(storagePath)
    await storage.save(fixture(reviewed))
    const authority = new api.AgentAuthorizationService(userDataPath)
    const call = async (name, args = {}) => (await api.AgentToolService.callTool({ name: `agent.${name}`,
      arguments: { storagePath, userDataPath, projectId: 'p', ...args } })).data
    const grant = (actions, range = {}) => authority.grant({ storagePath, projectId: 'p', actions, ...range })
    const data = async () => (await storage.loadSnapshot()).data
    const edit = async change => { const current = await storage.loadSnapshot(); change(current.data); await storage.saveIfCurrent(current.data, current.revision) }
    const preview = (extra = {}) => call('previewChapterAcceptance', { operationId: 'accept', agentRunId: 'run', jobId: 'job', draftId: 'draft',
      mode: reviewed ? 'reviewed' : 'unreviewed', reason: '导演读过正文后决定保留这个结尾。', ...extra })
    const accept = p => call('applyChapterAcceptance', { previewId: p.preview.id, expectedPreviewHash: p.previewHash })
    return { storage, authority, storagePath, grant, call, data, edit, preview, accept }
  }
  for (const sqlite of [false, true]) {
    const label = sqlite ? 'SQLite' : 'JSON'
    await check(`${label}: high-risk candidate preview and transactional apply use real author grant; revoke blocks the next operation`, async () => {
      const h = await harness(sqlite)
      try {
        const request = { decisions: [{ kind: 'character_state', candidateId: 'candidate', decision: 'accept' }] }
        let preview = await h.call('previewCandidateDecisions', request)
        assert.equal(preview.agentCanApply, false)
        // Only executable fields from the preview are submitted.
        const executable = p => p.items.map(({ kind, candidateId, decision, expectedFingerprint }) => ({ kind, candidateId, decision, expectedFingerprint }))
        const doApply = () => h.call('applyCandidateDecisions', { operationId: 'decide', reason: '确认文本证据。', decisions: executable(preview), confirm: true })
        await assert.rejects(doApply, /grant|trusted human/i)
        const grant = await h.grant(['accept_high_risk_candidates'], { chapterStart: 2, chapterEnd: 2 })
        preview = await h.call('previewCandidateDecisions', request)
        assert.equal(preview.agentCanApply, true)
        assert.equal(preview.authorizationGrantId, grant.id)
        const saved = await doApply()
        assert.equal(saved.receipt.actor.kind, 'agent')
        assert.equal(saved.receipt.authorizationGrantId, grant.id)
        assert.equal((await h.data()).characterStateFacts.length, 1)
        await h.authority.revoke(grant.id, h.storagePath, 'p')
        assert.equal((await doApply()).replayed, true)
        const undo = await h.call('previewCandidateDecisionUndo', { receiptId: 'decide' })
        await assert.rejects(() => h.call('undoCandidateDecision', { operationId: 'undo', receiptId: 'decide', expectedFingerprint: undo.expectedFingerprint,
          confirm: true, reason: '尝试撤销' }), /grant|trusted human/i)
        assert.equal((await h.data()).characterStateFacts.length, 1)
      } finally { h.storage.close?.() }
    })
    await check(`${label}: unreviewed acceptance requires both grants, keeps old version/candidates and records the Agent actor`, async () => {
      const h = await harness(sqlite)
      try {
        const p = await h.preview()
        await assert.rejects(() => h.call('applyApprovedChapterCommit', { previewId: p.preview.id, confirm: true }), /applyChapterAcceptance/)
        await h.grant(['accept_draft'])
        await assert.rejects(() => h.accept(p), /grant/i)
        const grant = await h.grant(['accept_draft', 'accept_unreviewed_draft'], { chapterStart: 2, chapterEnd: 2 })
        const saved = await h.accept(p)
        const current = await h.data()
        assert.equal(saved.review.mode, 'unreviewed')
        assert.equal(current.chapters[0].body, body)
        assert(current.chapterVersions.some(v => v.body === '原稿内容保留。'))
        assert.equal(current.characterStateChangeCandidates[0].status, 'pending')
        assert.equal(current.characterStateFacts.length, 0)
        assert.equal(current.chapterCommitBundles[0].acceptedBy, 'agent')
        assert.equal(current.chapterCommitBundles[0].actor.authorizationGrantId, grant.id)
        assert.equal(current.agentRuns[0].createdCommitIds.length, 1)
        await h.authority.revoke(grant.id, h.storagePath, 'p')
        assert.equal((await h.accept(p)).replayed, true)
        assert.equal((await h.data()).chapterCommitBundles.length, 1)
        assert.deepEqual(current.projects.find(p => p.id === 'foreign'), fixture().projects.find(p => p.id === 'foreign'))
      } finally { h.storage.close?.() }
    })
    await check(`${label}: changed prose/target/reports cannot reuse a stale acceptance preview`, async () => {
      for (const change of [
        d => { d.generatedChapterDrafts[0].body += '新正文。' },
        d => { d.chapters[0].body += '作者同时编辑。' },
        d => { d.qualityGateReports = fixture(true).qualityGateReports }
      ]) {
        const h = await harness(sqlite)
        try {
          await h.grant(['accept_draft', 'accept_unreviewed_draft'])
          const p = await h.preview()
          await h.edit(change)
          await assert.rejects(() => h.accept(p), /变化|审稿/)
          assert.equal((await h.data()).chapterCommitBundles.length, 0)
        } finally { h.storage.close?.() }
      }
    })
    await check(`${label}: director can disagree with a failed review without falsifying its result`, async () => {
      const h = await harness(sqlite, true)
      try {
        await h.grant(['accept_draft'])
        const p = await h.preview()
        const saved = await h.accept(p)
        assert.equal(saved.review.mode, 'reviewed')
        assert.equal(saved.review.qualityStatus, 'blocked')
        assert.equal((await h.data()).qualityGateReports[0].passed, false)
      } finally { h.storage.close?.() }
    })
    await check(`${label}: chapter range and revocation are checked when committing, not when previewing`, async () => {
      const h = await harness(sqlite)
      try {
        const p = await h.preview()
        await h.grant(['accept_draft', 'accept_unreviewed_draft'], { chapterStart: 3, chapterEnd: 5 })
        await assert.rejects(() => h.accept(p), /grant/i)
        const valid = await h.grant(['accept_draft', 'accept_unreviewed_draft'])
        await h.authority.revoke(valid.id, h.storagePath, 'p')
        await assert.rejects(() => h.accept(p), /grant/i)
        assert.equal((await h.data()).chapterCommitBundles.length, 0)
      } finally { h.storage.close?.() }
    })
    await check(`${label}: retry repairs metadata after a durable commit without overwriting a later author edit`, async () => {
      const h = await harness(sqlite)
      const prototype = (sqlite ? api.SqliteStorageService : api.JsonStorageService).prototype
      const save = prototype.saveIfCurrent
      try {
        const grant = await h.grant(['accept_draft', 'accept_unreviewed_draft'])
        const p = await h.preview()
        prototype.saveIfCurrent = async function (data, ...rest) {
          if (data.agentActionPreviews.some(item => item.id === p.preview.id && item.status === 'applied')) {
            throw new Error('Injected metadata save failure')
          }
          return save.call(this, data, ...rest)
        }
        await assert.rejects(() => h.accept(p), /Injected metadata/)
        prototype.saveIfCurrent = save
        const committed = await h.data()
        assert.equal(committed.chapterCommitBundles.length, 1)
        assert.equal(committed.chapters[0].body, body)
        assert.equal(committed.agentActionPreviews[0].status, 'pending')
        const versionCount = committed.chapterVersions.length
        await h.authority.revoke(grant.id, h.storagePath, 'p')
        await h.edit(data => { data.chapters[0].body = '作者后来独立保存的新正文。' })
        assert.equal((await h.accept(p)).replayed, true)
        const repaired = await h.data()
        assert.equal(repaired.chapters[0].body, '作者后来独立保存的新正文。')
        assert.equal(repaired.chapterCommitBundles.length, 1)
        assert.equal(repaired.chapterVersions.length, versionCount)
        assert.equal(repaired.agentActionPreviews[0].status, 'applied')
        assert.equal(repaired.agentRuns[0].createdCommitIds.length, 1)
      } finally { prototype.saveIfCurrent = save; h.storage.close?.() }
    })
    await check(`${label}: chapter archive/restore accepts a scoped grant and remains blocked without grant or explicit acknowledgement`, async () => {
      const h = await harness(sqlite)
      try {
        await assert.rejects(() => h.call('archiveChapter', { chapterId: 'chapter' }), /grant/i)
        const grant = await h.grant(['manage_chapters'], { chapterStart: 2, chapterEnd: 2 })
        await h.call('archiveChapter', { chapterId: 'chapter' })
        assert((await h.data()).chapters[0].archivedAt)
        await h.authority.revoke(grant.id, h.storagePath, 'p')
        await assert.rejects(() => h.call('restoreArchivedChapter', { chapterId: 'chapter' }), /grant/i)
        await h.call('restoreArchivedChapter', { chapterId: 'chapter', confirm: true })
        assert.equal((await h.data()).chapters[0].archivedAt, null)
      } finally { h.storage.close?.() }
    })
  }
  console.log(`Agent project grant workflow passed (${checks} integration groups).`)
} finally {
  const target = relative(tempRoot, dir)
  if (!target || target.startsWith('..') || isAbsolute(target)) throw new Error('Unsafe test cleanup path.')
  await rm(dir, { recursive: true, force: true })
}
