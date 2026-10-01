#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const tempRoot = join(repoRoot, 'tmp')
await mkdir(tempRoot, { recursive: true })
const outDir = await mkdtemp(join(tempRoot, 'agent-world-tools-'))
const timestamp = '2026-09-07T08:00:00.000Z'
let nativeDatabase = null
let checks = 0

async function test(label, run) {
  await run()
  checks += 1
  console.log(`PASS ${label}`)
}

try {
  try {
    const Database = createRequire(import.meta.url)('better-sqlite3')
    const probe = new Database(':memory:')
    try { assert.ok(probe.prepare('SELECT 1 AS ok').get().ok) } finally { probe.close() }
    nativeDatabase = Database
  } catch (error) {
    console.log(`SKIP native SQLite: ${error instanceof Error ? error.message : String(error)}. No rebuild or fallback.`)
  }

  const outfile = join(outDir, 'api.mjs')
  await build({
    stdin: { contents: `
      export { normalizeAppData } from './src/shared/defaults';
      export { WorldManagementService } from './src/services/WorldManagementService';
      export { handleAgentWorldReadTool, handleAgentWorldWriteTool } from './src/agent/tools/agentWorldTools';
      export { AGENT_WORLD_TOOL_DEFINITIONS } from './src/agent/tools/agentWorldDefinitions';
      export { AgentAuthorizationService } from './src/main/services/AgentAuthorizationService';
      export { loadAgentRuntimeData } from './src/agent/AgentRuntime';
      export { JsonStorageService } from './src/storage/JsonStorageService';
      export { SqliteStorageService } from './src/storage/SqliteStorageService';
    `, resolveDir: repoRoot, loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['better-sqlite3', 'electron'], logLevel: 'silent',
    plugins: [{ name: 'world-tools-no-ai', setup(builder) {
      builder.onResolve({ filter: /AgentPipelineExecutor$/ }, () => ({ path: 'no-ai', namespace: 'world-tools' }))
      builder.onLoad({ filter: /.*/, namespace: 'world-tools' }, () => ({
        contents: 'export const executeAgentChapterPipeline = () => { throw new Error("AI must not run in world fixtures.") }', loader: 'js'
      }))
    }}]
  })
  const api = await import(pathToFileURL(outfile).href)

  function fixture() {
    return api.normalizeAppData({
      projects: ['p1', 'p2'].map((id) => ({ id, name: id, createdAt: timestamp, updatedAt: timestamp })),
      // Deliberately old/minimal records prove the current normalizers remain readable.
      characters: [{ id: 'c1', projectId: 'p1', name: '旧角色', createdAt: timestamp, updatedAt: timestamp }],
      foreshadowings: [{ id: 'f1', projectId: 'p1', title: '旧伏笔', description: '旧描述', status: 'unresolved', weight: 'medium', createdAt: timestamp, updatedAt: timestamp }],
      timelineEvents: [{ id: 't1', projectId: 'p1', title: '旧事件', narrativeOrder: 1, participantCharacterIds: ['c1'], createdAt: timestamp, updatedAt: timestamp }]
      ,agentRuns: ['p1', 'p2'].map((projectId) => ({ id: `run-${projectId}`, projectId, goal: 'World fixture', mode: 'single_chapter', safetyMode: 'conservative',
        targetChapterOrders: [], status: 'running', createdJobIds: [], createdDraftIds: [], createdCommitIds: [], pendingHumanReviewItemIds: [],
        decisions: [], summary: '', warnings: [], startedAt: timestamp, updatedAt: timestamp, schemaVersion: 1 }))
    })
  }

  async function harness(kind, data = fixture()) {
    const dir = await mkdtemp(join(outDir, `${kind}-`))
    const storagePath = join(dir, kind === 'json' ? 'world.json' : 'world.sqlite')
    const storage = kind === 'json' ? new api.JsonStorageService(storagePath) : new api.SqliteStorageService(storagePath)
    try { await storage.save(data) } finally { storage.close?.() }
    const paths = { storagePath, userDataPath: dir }
    let grant = null
    const authorize = async () => {
      if (!grant) grant = await new api.AgentAuthorizationService(dir).grant({
        storagePath, projectId: 'p1', actions: ['edit_world'], chapterStart: null, chapterEnd: null
      })
      return grant
    }
    const runtime = () => api.loadAgentRuntimeData(paths)
    const read = async (name, args = {}) => {
      const current = await runtime()
      const result = api.handleAgentWorldReadTool(`agent.${name}`, { ...paths, projectId: 'p1', ...args }, current.data)
      assert.equal(result.handled, true)
      return result.payload
    }
    const preview = (args) => read('previewWorldAction', args)
    const apply = async (args, authorized = true) => {
      const current = await runtime()
      if (authorized) await authorize()
      const result = await api.handleAgentWorldWriteTool('agent.applyWorldAction', { ...paths, projectId: 'p1', ...args }, current.data, current)
      assert.equal(result.handled, true)
      return result.payload
    }
    return { paths, runtime, read, preview, apply, authorize }
  }

  await test('definitions are strict, bounded to world actions, and never offer deletion', async () => {
    assert.equal(api.AGENT_WORLD_TOOL_DEFINITIONS.length, 6)
    for (const definition of api.AGENT_WORLD_TOOL_DEFINITIONS) {
      assert.equal(definition.inputSchema.additionalProperties, false)
      assert.ok(!definition.name.toLowerCase().includes('delete'))
    }
    assert.equal(api.AGENT_WORLD_TOOL_DEFINITIONS.find((item) => item.name === 'agent.applyWorldAction').riskLevel, 'write_commit')
    assert.deepEqual(
      api.AGENT_WORLD_TOOL_DEFINITIONS.find((item) => item.name === 'agent.applyWorldAction').inputSchema.properties.source.required,
      ['kind', 'reason']
    )
    const patchHelp = api.AGENT_WORLD_TOOL_DEFINITIONS.find((item) => item.name === 'agent.applyWorldAction').inputSchema.properties.patch['x-worldEditableFieldsByEntity']
    assert.ok(patchHelp.character.fields.includes('roleFunction'))
    assert.ok(patchHelp.character.cardFields.includes('abilitiesAndResources'))
    assert.deepEqual(patchHelp.foreshadowing.enums.status, ['unresolved', 'partial', 'resolved', 'abandoned'])
  })

  for (const kind of ['json', ...(nativeDatabase ? ['sqlite'] : [])]) {
    await test(`${kind}: compact/full paging is project-scoped and preserves legacy records`, async () => {
      const h = await harness(kind)
      const compact = await h.read('getWorldRecords', { entity: 'character', limit: 1 })
      assert.equal(compact.total, 1)
      assert.equal(compact.records[0].name, '旧角色')
      assert.equal(compact.records[0].deepDesire, '')
      const full = await h.read('getWorldRecord', { entity: 'character', id: 'c1', detail: 'full' })
      assert.equal(full.record.roleFunction, '', 'Old records must receive explicit empty card fields, not hidden extras.')
      const foreign = api.handleAgentWorldReadTool('agent.getWorldRecords', { entity: 'character', projectId: 'p2' }, (await h.runtime()).data)
      assert.equal(foreign.payload.total, 0)
      await assert.rejects(h.read('getWorldRecords', { entity: 'character', offset: -1 }))
    })

    await test(`${kind}: compact output redacts text, keeps identifiers intact, and identifies its full-read path`, async () => {
      const data = fixture()
      const secret = ['sk', 'proj', 'compactfixture123456789'].join('-')
      data.characters[0].knownInformation = `${'长文本'.repeat(220)} ${secret}`
      const h = await harness(kind, data)
      const compact = await h.read('getWorldRecords', { entity: 'character' })
      assert.equal(compact.records[0].id, 'c1')
      assert.equal(compact.records[0].projectId, 'p1')
      assert.equal(compact.truncated, true)
      assert.ok(compact.truncatedFields.includes('record.knownInformation'))
      assert.equal(compact.fullRead.tool, 'agent.getWorldRecord')
      assert.ok(!JSON.stringify(compact).includes(secret))
      const full = await h.read('getWorldRecord', { entity: 'character', id: 'c1', detail: 'full' })
      assert.equal(full.truncated, false)
      assert.ok(!JSON.stringify(full).includes(secret))
      assert.ok(String(full.record.knownInformation).includes('[REDACTED]'))
      const source = { kind: 'agent_director', reason: '展示脱敏动作快照。', requestedAt: timestamp }
      const action = { entity: 'character', action: 'create', operationId: 'redacted-action', patch: { name: '脱敏角色', knownInformation: secret }, source }
      const preview = await h.preview(action)
      assert.equal(typeof preview.fingerprint, 'string')
      assert.ok(!JSON.stringify(preview.before).includes(secret))
      assert.ok(!JSON.stringify(preview.after).includes(secret))
      const applied = await h.apply({ ...action, expectedFingerprint: preview.fingerprint })
      assert.equal(typeof applied.fingerprint, 'string')
      assert.ok(!JSON.stringify(applied.before).includes(secret))
      assert.ok(!JSON.stringify(applied.after).includes(secret))
      assert.equal((await h.runtime()).data.characters.find((item) => item.id === applied.id).knownInformation, secret, 'Display redaction must not alter the persisted command content.')
    })

    await test(`${kind}: explicit director actions create each world entity and persist through the handler`, async () => {
      const h = await harness(kind)
      const source = { kind: 'agent_director', agentRunId: 'run-p1', reason: '导演明确决定：建立本章世界资料。', requestedAt: timestamp }
      const create = async (entity, operationId, patch) => {
        const input = { entity, action: 'create', operationId, patch, source }
        const p = await h.preview(input)
        return h.apply({ ...input, expectedFingerprint: p.fingerprint })
      }
      const character = await create('character', 'create-character', { name: '新角色', role: '盟友', isMain: true })
      const characterId = character.id
      const state = await create('character_state', 'create-state', { characterId, label: '持有钥匙', key: 'key', category: 'inventory', value: ['黑钥匙'] })
      const foreshadowing = await create('foreshadowing', 'create-foreshadowing', { title: '门后的回声', description: '走廊尽头的回声。', relatedCharacterIds: [characterId], weight: 'high' })
      const timeline = await create('timeline_event', 'create-timeline', { title: '进入旧塔', narrativeOrder: 2, participantCharacterIds: [characterId] })
      const canon = await create('hard_canon', 'create-canon', { title: '黑钥匙规则', content: '黑钥匙只能开启一次。', category: 'world_rule', relatedCharacterIds: [characterId] })
      const guide = await create('story_direction', 'create-guide', { title: '旧塔五章导向', startChapterOrder: 2, generatedFromChapterIds: [] })
      const update = async (entity, id, operationId, patch) => {
        const input = { entity, action: 'update', operationId, id, patch, source }
        const p = await h.preview(input)
        return h.apply({ ...input, expectedFingerprint: p.fingerprint })
      }
      await update('character', characterId, 'update-character', { role: '关键盟友', roleFunction: '秘密引路人', abilitiesAndResources: '熟悉旧塔机关。', futureHooks: '会在门后失踪。' })
      await update('character_state', state.id, 'update-state', { value: ['黑钥匙', '塔钥匙'], evidence: '导演确认：钥匙仍在角色手中。' })
      await update('foreshadowing', foreshadowing.id, 'update-foreshadowing', { notes: '第二章推进。' })
      await update('timeline_event', timeline.id, 'update-timeline', { result: '旧塔入口开启。' })
      await update('hard_canon', canon.id, 'update-canon', { priority: 'must' })
      await update('story_direction', guide.id, 'update-guide', { strategicTheme: '门后的代价' })
      const activateGuide = { entity: 'story_direction', action: 'set_status', operationId: 'activate-guide', id: guide.id, patch: { status: 'active' }, source }
      const activePreview = await h.preview(activateGuide)
      await h.apply({ ...activateGuide, expectedFingerprint: activePreview.fingerprint })
      const pauseCanon = { entity: 'hard_canon', action: 'set_status', operationId: 'pause-canon', id: canon.id, patch: { status: 'inactive' }, source }
      const canonPreview = await h.preview(pauseCanon)
      await h.apply({ ...pauseCanon, expectedFingerprint: canonPreview.fingerprint })
      const saved = await h.runtime()
      assert.equal(saved.data.characters.find((item) => item.id === characterId).role, '关键盟友')
      assert.equal(saved.data.characters.find((item) => item.id === characterId).roleFunction, '秘密引路人')
      assert.deepEqual(saved.data.characterStateFacts.find((item) => item.id === state.id).value, ['黑钥匙', '塔钥匙'])
      assert.equal(saved.data.characterStateFacts.find((item) => item.id === state.id).evidence, '导演确认：钥匙仍在角色手中。')
      assert.equal(saved.data.foreshadowings.find((item) => item.id === foreshadowing.id).notes, '第二章推进。')
      assert.equal(saved.data.timelineEvents.find((item) => item.id === timeline.id).result, '旧塔入口开启。')
      assert.equal(saved.data.hardCanonPacks.flatMap((pack) => pack.items).find((item) => item.id === canon.id).status, 'inactive')
      assert.equal(saved.data.storyDirectionGuides.find((item) => item.id === guide.id).status, 'active')
      assert.equal(canon.audit.source.kind, 'agent_director')
      assert.equal(typeof canon.audit.authorizationGrantId, 'string', 'Applied writes retain the real authorization grant ID.')
      assert.equal(saved.data.worldManagementReceipts.some((item) => item.operationId === 'pause-canon'), true)
      const history = await h.read('getWorldActionHistory', { limit: 2 })
      assert.equal(history.total >= 1, true)
      assert.equal(history.fullRead.tool, 'agent.getWorldActionReceipt')
      const receipt = await h.read('getWorldActionReceipt', { operationId: 'pause-canon', detail: 'full' })
      assert.equal(receipt.receipt.operationId, 'pause-canon')
      assert.equal(receipt.receipt.before.status, 'active')
      assert.equal(receipt.receipt.after.status, 'inactive')
    })

    await test(`${kind}: standalone director edits need no AgentRun, but a foreign run is rejected`, async () => {
      const h = await harness(kind)
      const source = { kind: 'agent_director', reason: '作者 Agent 的独立导演编辑。', requestedAt: timestamp }
      const create = async (entity, operationId, patch) => {
        const input = { entity, action: 'create', operationId, patch, source }
        const preview = await h.preview(input)
        return h.apply({ ...input, expectedFingerprint: preview.fingerprint })
      }
      const character = await create('character', 'standalone-character', { name: '独立角色', roleFunction: '旁观者' })
      const canon = await create('hard_canon', 'standalone-canon', { title: '独立规则', content: '独立导演操作也需授权。' })
      const saved = await h.runtime()
      assert.equal(saved.data.agentRuns.length, 2, 'A standalone world edit must not manufacture an AgentRun.')
      assert.equal(saved.data.worldManagementReceipts.find((item) => item.operationId === 'standalone-character').source.agentRunId, undefined)
      assert.equal(saved.data.hardCanonPacks.flatMap((pack) => pack.items).some((item) => item.id === canon.id), true)
      await assert.rejects(h.preview({
        entity: 'character', action: 'update', operationId: 'foreign-run-edit', id: character.id, patch: { role: '不应通过' },
        source: { ...source, agentRunId: 'run-p2' }
      }), /AgentRun does not belong/)
    })

    await test(`${kind}: state chapter provenance and active direction ranges remain project-consistent`, async () => {
      const data = fixture()
      data.chapters.push(
        { id: 'chapter-p1', projectId: 'p1', order: 3 },
        { id: 'chapter-p2', projectId: 'p2', order: 3 }
      )
      const h = await harness(kind, data)
      const source = { kind: 'agent_director', reason: '验证来源章节与导向范围。', requestedAt: timestamp }
      const state = {
        entity: 'character_state', action: 'create', operationId: 'state-with-source',
        patch: {
          characterId: 'c1', label: '已确认位置', key: 'location', category: 'location', value: '旧塔',
          sourceChapterId: 'chapter-p1', sourceChapterOrder: 3, evidence: '第 3 章正文明确交代。'
        }, source
      }
      const statePreview = await h.preview(state)
      await h.apply({ ...state, expectedFingerprint: statePreview.fingerprint })
      assert.equal((await h.runtime()).data.characterStateFacts.find((item) => item.id.startsWith('world-character_state-state-with-source')).evidence, '第 3 章正文明确交代。')
      await assert.rejects(h.preview({
        ...state, operationId: 'state-with-foreign-source', patch: { ...state.patch, sourceChapterId: 'chapter-p2' }
      }), /missing or foreign chapter/)
      await assert.rejects(h.preview({
        entity: 'story_direction', action: 'create', operationId: 'bad-active-range',
        patch: { title: '错误范围', status: 'active', startChapterOrder: 5, horizonChapters: 5, endChapterOrder: 8 }, source
      }), /must cover exactly/)
      await assert.rejects(h.preview({
        entity: 'story_direction', action: 'create', operationId: 'bad-active-beat',
        patch: {
          title: '错误节拍', status: 'active', startChapterOrder: 5, horizonChapters: 5, endChapterOrder: 9,
          chapterBeats: [{ id: 'beat-outside', chapterOffset: 1, chapterOrder: 7 }]
        }, source
      }), /beats must stay within/)
    })

    await test(`${kind}: revision conflicts, cross-project references, untrusted apply and repeated operations are controlled`, async () => {
      const h = await harness(kind)
      const source = { kind: 'agent_director', agentRunId: 'run-p1', reason: '导演明确决定：添加受控角色。', requestedAt: timestamp }
      const input = { entity: 'character', action: 'create', operationId: 'retry-character', patch: { name: '可重试角色' }, source }
      const preview = await h.preview(input)
      await assert.rejects(h.apply({ ...input, expectedFingerprint: preview.fingerprint }, false), (error) => error?.code === 'AGENT_AUTHORIZATION_REQUIRED')
      await assert.rejects(h.apply({ ...input, expectedFingerprint: 'wrong-preview' }), /changed since preview/)
      const first = await h.apply({ ...input, expectedFingerprint: preview.fingerprint })
      const repeated = await h.apply({ ...input, expectedFingerprint: preview.fingerprint })
      assert.equal(first.changed, true)
      assert.equal(repeated.replayed, true)
      const state = await h.runtime()
      assert.equal(state.data.characters.filter((item) => item.id === first.id).length, 1)
      const noOp = { entity: 'character', action: 'update', operationId: 'noop-character', id: first.id, patch: { role: '' }, source }
      const noOpPreview = await h.preview(noOp)
      const noOpFirst = await h.apply({ ...noOp, expectedFingerprint: noOpPreview.fingerprint })
      assert.equal(noOpFirst.changed, false)
      assert.equal(noOpFirst.replayed, false)
      assert.notEqual(noOpFirst.saved, null, 'A new no-op operation must persist its receipt.')
      const noOpRetry = await h.apply({ ...noOp, expectedFingerprint: noOpPreview.fingerprint })
      assert.equal(noOpRetry.replayed, true)
      assert.equal(noOpRetry.saved, null)
      assert.equal((await h.runtime()).data.worldManagementReceipts.some((item) => item.operationId === 'noop-character'), true)
      const later = await h.preview({ entity: 'character', action: 'update', operationId: 'later-edit', id: first.id, patch: { role: '后来编辑' }, source })
      await h.apply({ entity: 'character', action: 'update', operationId: 'later-edit', id: first.id, patch: { role: '后来编辑' }, source, expectedFingerprint: later.fingerprint })
      const oldReplay = await h.apply({ ...input, expectedFingerprint: preview.fingerprint })
      assert.equal(oldReplay.replayed, true, 'An older operation replays from its immutable receipt after later edits.')
      await assert.rejects(h.apply({ ...input, patch: { name: '不同内容' }, expectedFingerprint: preview.fingerprint }), /already used/)

      const staleRuntime = await h.runtime()
      const stale = api.handleAgentWorldReadTool('agent.previewWorldAction', {
        ...h.paths, projectId: 'p1', entity: 'character', action: 'update', operationId: 'rename', id: first.id,
        patch: { role: '守门人' }, source
      }, staleRuntime.data).payload
      const competing = await h.preview({ entity: 'character', action: 'update', operationId: 'competing-rename', id: first.id, patch: { role: '竞争编辑' }, source })
      await h.apply({ entity: 'character', action: 'update', operationId: 'competing-rename', id: first.id, patch: { role: '竞争编辑' }, source, expectedFingerprint: competing.fingerprint })
      await assert.rejects(
        api.handleAgentWorldWriteTool('agent.applyWorldAction', {
          ...h.paths, projectId: 'p1', entity: 'character', action: 'update', operationId: 'rename', id: first.id,
          patch: { role: '守门人' }, source, expectedFingerprint: stale.fingerprint
        }, staleRuntime.data, staleRuntime),
        /changed since preview/
      )
      const refreshed = await h.preview({ entity: 'character', action: 'update', operationId: 'rename', id: first.id, patch: { role: '守门人' }, source })
      await h.apply({ entity: 'character', action: 'update', operationId: 'rename', id: first.id, patch: { role: '守门人' }, source, expectedFingerprint: refreshed.fingerprint })
      await assert.rejects(h.preview({ entity: 'timeline_event', action: 'create', operationId: 'foreign-reference', patch: { title: '错误事件', participantCharacterIds: ['foreign-character'] }, source }), /missing or foreign/)
      await assert.rejects(h.preview({ entity: 'hard_canon', action: 'create', operationId: 'detected-canon', patch: { title: '检测项', content: '不应自动 canon。' }, source: { kind: 'ai_detection', agentRunId: 'run-p1', reason: '模型检测到。' } }), /agent_director/)
    })

    await test(`${kind}: an exact unreceipted stable create ID is adopted once, then replays from its receipt`, async () => {
      const data = fixture()
      data.characters.push({ ...data.characters[0], id: 'world-character-adopt-existing', name: '既有接管角色' })
      const h = await harness(kind, data)
      const source = { kind: 'agent_director', reason: '为已有角色补建受控操作记录。', requestedAt: timestamp }
      const input = { entity: 'character', action: 'create', operationId: 'adopt-existing', patch: { name: '既有接管角色' }, source }
      const preview = await h.preview(input)
      await assert.rejects(h.apply({ ...input, expectedFingerprint: 'wrong-create-preview' }), /changed since preview/)
      const first = await h.apply({ ...input, expectedFingerprint: preview.fingerprint })
      assert.equal(first.changed, false)
      assert.equal(first.replayed, false)
      assert.notEqual(first.saved, null)
      assert.equal((await h.runtime()).data.worldManagementReceipts.some((item) => item.operationId === 'adopt-existing'), true)
      const retry = await h.apply({ ...input, expectedFingerprint: preview.fingerprint })
      assert.equal(retry.replayed, true)
    })

    await test(`${kind}: HardCanon sourced duplicates require an explicit update and never change the receipt target`, async () => {
      const h = await harness(kind)
      const source = { kind: 'agent_director', reason: '导演明确确认来源硬设定。', requestedAt: timestamp }
      const create = async (operationId, patch) => {
        const input = { entity: 'hard_canon', action: 'create', operationId, patch, source }
        const preview = await h.preview(input)
        return h.apply({ ...input, expectedFingerprint: preview.fingerprint })
      }
      const first = await create('canon-source-first', {
        title: ' 来源规则 ', content: ' 同一来源的规则。 ', category: 'world_rule', sourceId: 'chapter-source-1'
      })
      const savedFirst = (await h.runtime()).data.hardCanonPacks.flatMap((pack) => pack.items).find((item) => item.id === first.id)
      assert.equal(first.id, 'world-hard_canon-canon-source-first')
      assert.equal(first.after.id, first.id)
      assert.equal(savedFirst?.id, first.id)
      assert.equal(first.after.title, '来源规则')
      assert.equal(first.after.content, '同一来源的规则。')
      assert.equal(first.after.updatedAt, savedFirst.updatedAt)
      const firstReceipt = (await h.runtime()).data.worldManagementReceipts.find((item) => item.operationId === 'canon-source-first')
      assert.equal(firstReceipt.after.content, savedFirst.content)
      assert.equal(firstReceipt.after.updatedAt, savedFirst.updatedAt)
      const duplicate = {
        entity: 'hard_canon', action: 'create', operationId: 'canon-source-duplicate',
        patch: { title: '重复来源规则', content: '同一来源的规则。', category: 'world_rule', sourceId: 'chapter-source-1' }, source
      }
      await assert.rejects(h.preview(duplicate), new RegExp(`already exists.*${first.id}.*update`))
      assert.equal((await h.runtime()).data.worldManagementReceipts.some((item) => item.operationId === duplicate.operationId), false)

      const other = await create('canon-source-other', {
        title: '另一条规则', content: '另一条内容。', category: 'world_rule', sourceId: 'chapter-source-2'
      })
      await assert.rejects(h.preview({
        entity: 'hard_canon', action: 'update', operationId: 'canon-source-update-duplicate', id: other.id,
        patch: { content: '同一来源的规则。', sourceId: 'chapter-source-1' }, source
      }), new RegExp(`already exists.*${first.id}.*update`))
      assert.equal((await h.runtime()).data.hardCanonPacks.flatMap((pack) => pack.items).find((item) => item.id === other.id)?.content, '另一条内容。')
    })

    await test(`${kind}: HardCanon reads and writes use the same project pack when legacy data contains multiple packs`, async () => {
      const data = fixture()
      const firstPack = data.hardCanonPacks.find((pack) => pack.projectId === 'p1')
      data.hardCanonPacks = [
        { ...firstPack, items: [{
          id: 'canon-primary-pack', projectId: 'p1', category: 'other', title: '主包规则', content: '主包内容。', priority: 'medium', status: 'active',
          sourceType: 'manual', sourceId: null, relatedCharacterIds: [], relatedForeshadowingIds: [], relatedTimelineEventIds: [], createdAt: timestamp, updatedAt: timestamp
        }] },
        { ...firstPack, id: 'legacy-extra-pack-p1', items: [{
          id: 'canon-secondary-pack', projectId: 'p1', category: 'other', title: '旧副包规则', content: '副包内容。', priority: 'medium', status: 'active',
          sourceType: 'manual', sourceId: null, relatedCharacterIds: [], relatedForeshadowingIds: [], relatedTimelineEventIds: [], createdAt: timestamp, updatedAt: timestamp
        }] },
        ...data.hardCanonPacks.filter((pack) => pack.projectId !== 'p1')
      ]
      const h = await harness(kind, data)
      const listed = await h.read('getWorldRecords', { entity: 'hard_canon', detail: 'full' })
      assert.deepEqual(listed.records.map((item) => item.id), ['canon-primary-pack'])
      const source = { kind: 'agent_director', reason: '验证遗留多包边界。', requestedAt: timestamp }
      await assert.rejects(h.preview({
        entity: 'hard_canon', action: 'update', operationId: 'edit-secondary-pack', id: 'canon-secondary-pack', patch: { content: '不得误改。' }, source
      }), /not found in project/)
      const input = { entity: 'hard_canon', action: 'update', operationId: 'edit-primary-pack', id: 'canon-primary-pack', patch: { content: ' 主包已更新。 ' }, source }
      const preview = await h.preview(input)
      const applied = await h.apply({ ...input, expectedFingerprint: preview.fingerprint })
      const saved = await h.runtime()
      assert.equal(applied.id, 'canon-primary-pack')
      assert.equal(saved.data.hardCanonPacks[0].items[0].content, '主包已更新。')
      assert.equal(applied.after.content, saved.data.hardCanonPacks[0].items[0].content)
      assert.equal(applied.after.updatedAt, saved.data.hardCanonPacks[0].items[0].updatedAt)
    })

    await test(`${kind}: archive and status transitions retain records instead of deleting them`, async () => {
      const h = await harness(kind)
      const source = { kind: 'agent_director', agentRunId: 'run-p1', reason: '导演明确决定：归档旧资料。', requestedAt: timestamp }
      const archive = async (entity, id, operationId) => {
        const input = { entity, action: 'archive', operationId, id, patch: {}, source }
        const preview = await h.preview(input)
        return h.apply({ ...input, expectedFingerprint: preview.fingerprint })
      }
      await archive('foreshadowing', 'f1', 'archive-foreshadowing')
      await assert.rejects(h.preview({ entity: 'character', action: 'archive', operationId: 'archive-character', id: 'c1', patch: {}, source }), /no supported archive lifecycle/)
      await assert.rejects(h.preview({ entity: 'timeline_event', action: 'set_status', operationId: 'pause-timeline', id: 't1', patch: { status: 'inactive' }, source }), /no supported status lifecycle/)
      const data = (await h.runtime()).data
      assert.equal(data.characters.some((item) => item.id === 'c1'), true)
      assert.equal(data.foreshadowings.find((item) => item.id === 'f1').status, 'abandoned')
      assert.equal(data.timelineEvents.some((item) => item.id === 't1'), true)
      const visible = await h.read('getWorldRecords', { entity: 'character' })
      assert.equal(visible.total, 1)
    })
  }

  console.log(`Agent world tools validation passed (${checks} checks).`)
} finally {
  await rm(outDir, { recursive: true, force: true })
}
