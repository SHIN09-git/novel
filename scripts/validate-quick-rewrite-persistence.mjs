import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

await mkdir(join(repoRoot, 'tmp'), { recursive: true })
const directory = await mkdtemp(join(repoRoot, 'tmp', 'quick-rewrite-persistence-'))
let sqlite
let checks = 0
const test = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`) }
try {
  const outfile = join(directory, 'api.mjs')
  await build({ stdin: { contents: `
    export * from './src/services/QuickRewriteDraftService';
    export * from './src/renderer/src/components/quickRewriteDraftStore';
    export * from './src/renderer/src/components/quickRewriteDraftAdapter';
    export * from './src/shared/defaults';
    export * from './src/storage/JsonStorageService';
    export * from './src/storage/SqliteStorageService';
  `, resolveDir: repoRoot, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'esm', external: ['better-sqlite3'], logLevel: 'silent' })
  const api = await import(pathToFileURL(outfile).href)
  const timestamp = '2026-09-06T00:00:00.000Z'
  const target = { projectId: 'p1', kind: 'chapter', targetId: 'c1' }
  const sourceBody = '门口的钟没有响。她把纸条收进衣袋。远处有人关上了窗。'
  const text = '她把纸条收进衣袋。'
  const candidate = { targetKey: 'c1', sourceBody, selection: { start: sourceBody.indexOf(text), end: sourceBody.indexOf(text) + text.length, text },
    text: '她折好纸条，塞进衣袋。', scope: 'selection', label: '空白重写', usedAI: true, context: 'PROMPT_NOT_TO_STORE' }
  const draft = api.toQuickRewriteDraft(candidate, target, null)
  const data = api.normalizeAppData({ ...api.EMPTY_APP_DATA,
    projects: ['p1', 'p2'].map(id => ({ id, name: id, createdAt: timestamp, updatedAt: timestamp })),
    chapters: [{ id: 'c1', projectId: 'p1', order: 1, body: sourceBody }, { id: 'c2', projectId: 'p2', order: 1, body: '另一项目正文。' }],
    revisionSessions: [{ id: 's1', projectId: 'p1', chapterId: 'c1', status: 'active' }],
    revisionVersions: [{ id: 'v1', sessionId: 's1', body: sourceBody, status: 'draft' }]
  })
  await test('legacy and malformed collections normalize to safe empty arrays', () => {
    assert.deepEqual(api.normalizeAppData({}).quickRewriteDrafts, [])
    assert.deepEqual(api.normalizeAppData({ quickRewriteDrafts: [null, {}, { ...draft, selection: { ...draft.selection, start: -1 } }] }).quickRewriteDrafts, [])
  })
  let stored = api.upsertQuickRewriteDraft(data, draft)
  await test('candidate storage never modifies chapter, versions, canon or memory', () => {
    assert.equal(stored.chapters, data.chapters)
    assert.equal(stored.chapterVersions, data.chapterVersions)
    assert.equal(stored.characterStateFacts, data.characterStateFacts)
    assert.equal(stored.memoryUpdateCandidates, data.memoryUpdateCandidates)
    assert.equal(stored.quickRewriteDrafts.length, 1)
    assert.ok(!JSON.stringify(stored.quickRewriteDrafts).includes('PROMPT_NOT_TO_STORE'))
  })
  await test('edits reuse one durable candidate, preserving its creation ID', () => {
    stored = api.upsertQuickRewriteDraft(stored, { ...draft, id: 'new-id', text: '编辑后的候选。' })
    assert.equal(stored.quickRewriteDrafts.length, 1)
    assert.equal(stored.quickRewriteDrafts[0].id, draft.id)
    assert.equal(api.restoreQuickRewriteCandidate(stored.quickRewriteDrafts[0], 'fresh context').context, 'fresh context')
  })
  await test('projects, chapter editors, inline reader edits and revision versions remain isolated', () => {
    assert.equal(api.getQuickRewriteDraft(stored, { ...target, projectId: 'p2' }), null)
    assert.throws(() => api.upsertQuickRewriteDraft(stored, { ...draft, projectId: 'p2' }))
    assert.throws(() => api.upsertQuickRewriteDraft(stored, { ...draft, chapterId: 'missing' }))
    const revision = api.toQuickRewriteDraft(candidate, { projectId: 'p1', kind: 'revision_version', targetId: 'v1' }, null)
    const inline = api.toQuickRewriteDraft(candidate, { ...target, kind: 'reader_edit' }, null)
    const combined = api.upsertQuickRewriteDraft(api.upsertQuickRewriteDraft(stored, revision), inline)
    assert.equal(combined.quickRewriteDrafts.length, 3)
    assert.equal(api.removeQuickRewriteDraft(combined, target).quickRewriteDrafts.length, 2)
  })
  await test('malformed or extra persistence fields cannot smuggle a prompt or credential member', () => {
    const clean = api.normalizeAppData({ ...data, quickRewriteDrafts: [{ ...draft, apiKey: 'PRIVATE_TEST_SENTINEL', context: 'FULL_PROMPT' }] })
    assert.ok(!JSON.stringify(clean.quickRewriteDrafts).includes('PRIVATE_TEST_SENTINEL'))
    assert.ok(!JSON.stringify(clean.quickRewriteDrafts).includes('FULL_PROMPT'))
  })
  await test('JSON export/import and SQLite preserve candidate ranges and keep settings secrets out', async () => {
    const jsonPath = join(directory, 'export.json')
    const json = new api.JsonStorageService(jsonPath)
    await json.save({ ...stored, settings: { ...stored.settings, apiKey: 'PRIVATE_TEST_SENTINEL' } })
    const exported = JSON.parse(await readFile(jsonPath, 'utf8'))
    assert.ok(!(await readFile(jsonPath, 'utf8')).includes('PRIVATE_TEST_SENTINEL'))
    sqlite = new api.SqliteStorageService(join(directory, 'data.sqlite'))
    await sqlite.save(api.normalizeAppData(exported))
    const loaded = await sqlite.load()
    assert.deepEqual(loaded.quickRewriteDrafts, exported.quickRewriteDrafts)
    assert.equal(loaded.chapters[0].body, sourceBody)
    assert.equal(loaded.settings.apiKey, '')
  })
  await test('shared functional saves retain newer edits during an older in-flight candidate save', async () => {
    let current = data, release
    const hold = new Promise(resolve => { release = resolve })
    let calls = 0
    const store = api.createQuickRewriteDraftStore(() => current, async update => {
      if (++calls === 1) await hold
      current = update(current)
      return { ok: true }
    })
    store.write(target, draft, true)
    store.write(target, { ...draft, text: 'NEWER' })
    current = { ...current, projects: [...current.projects, { id: 'unrelated-save', name: 'kept' }] }
    release()
    await store.flush()
    assert.equal(current.quickRewriteDrafts[0].text, 'NEWER')
    assert.equal(current.projects.at(-1).id, 'unrelated-save')
    assert.equal(store.status(target), 'saved')
    store.dispose()
  })
  await test('failure retains overlay; retry saves it and discard cannot resurrect an old write', async () => {
    let current = data, fail = true
    const store = api.createQuickRewriteDraftStore(() => current, async update => {
      if (fail) return { ok: false, errorMessage: 'test disk failure' }
      current = update(current); return { ok: true }
    })
    store.write(target, draft, true)
    await store.flush()
    assert.equal(store.status(target), 'failed')
    assert.equal(store.read(target).text, draft.text)
    assert.equal(current.quickRewriteDrafts.length, 0)
    fail = false
    await store.retry(target)
    assert.equal(current.quickRewriteDrafts.length, 1)
    store.write(target, { ...draft, text: 'late edit' }, true)
    store.write(target, null, true)
    await store.flush()
    assert.equal(current.quickRewriteDrafts.length, 0)
    assert.equal(store.hasPending(), false)
    store.dispose()
  })
  await test('failed discard preserves the newest candidate for a remounted reader until retry succeeds', async () => {
    let current = stored, fail = true
    const store = api.createQuickRewriteDraftStore(() => current, async update => {
      if (fail) return { ok: false, errorMessage: 'test disk failure' }
      current = update(current); return { ok: true }
    })
    store.write(target, { ...draft, text: 'Newest unpersisted edit' }, true)
    await store.flush()
    store.write(target, null, true)
    await store.flush()
    assert.equal(store.status(target), 'failed')
    assert.equal(store.read(target).text, 'Newest unpersisted edit')
    assert.deepEqual(current.quickRewriteDrafts, stored.quickRewriteDrafts)
    fail = false
    await store.retry(target)
    assert.equal(store.read(target), null)
    assert.equal(store.hasPending(), false)
    assert.equal(current.quickRewriteDrafts.length, 0)
    store.dispose()
  })
  console.log(`Quick rewrite persistence validation passed (${checks} behavior checks).`)
} finally { sqlite?.close(); await rm(directory, { recursive: true, force: true }) }
