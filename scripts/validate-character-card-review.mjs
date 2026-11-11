import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const base = join(repoRoot, 'tmp')
await mkdir(base, { recursive: true })
const dir = await mkdtemp(join(base, 'card-review-'))
const at = '2026-03-10T12:00:00Z', later = '2026-03-12T12:00:00Z'
const p = 'book-a', who = 'hero'
const oldQuote = '她清点了十文钱。', newQuote = '她只剩下七文钱。'
const chapter = (id, order, body, projectId = p) => ({ id, projectId, order, title: id, body, createdAt: at, updatedAt: at })
const tx = (id, factId, chapterId, chapterOrder, evidence, afterValue, more = {}) => ({
  id, factId, projectId: p, characterId: who, chapterId, chapterOrder, evidence, afterValue, beforeValue: null,
  status: 'accepted', transactionType: 'update', source: 'manual', reason: '', createdAt: at, updatedAt: at, ...more
})
function fixture(api) {
  const chapters = [chapter('a14', 14, '她关上房门。'), chapter('b99', 99, '别部书保密正文。', 'book-b'),
    chapter('a12', 12, '雨停了。\r\n\r\n' + newQuote + '\n她收起钱袋。'), chapter('a10', 10, oldQuote),
    chapter('empty', 15, '   '), { ...chapter('archived', 16, '归档。'), archivedAt: at }]
  const cash = { id: 'cash', projectId: p, characterId: who, category: 'resource', key: 'cash', label: '余额',
    value: 7, valueType: 'number', unit: '文', evidence: newQuote, sourceChapterId: 'a12', sourceChapterOrder: 12,
    status: 'active', createdAt: at, updatedAt: at }
  return api.normalizeAppData({
    projects: [p, 'book-b'].map(id => ({ id, name: id, createdAt: at, updatedAt: at })), chapters,
    characters: [{ id: who, projectId: p, name: '沈宁', abilitiesAndResources: '钱袋里有十文钱。', isMain: true,
      lastChangedChapter: 3, createdAt: at, updatedAt: at },
    { id: 'other', projectId: 'book-b', name: '另一角色', createdAt: at, updatedAt: at }],
    chapterVersions: [{ id: 'v12', projectId: p, chapterId: 'a12', title: 'a12', source: 'manual_revision',
      body: chapters[2].body, createdAt: later }],
    characterStateFacts: [cash, { ...cash, id: 'draft-only', key: 'draft', evidence: '草稿私句。', sourceChapterId: 'empty' }],
    characterStateTransactions: [
      tx('t12', 'cash', 'a12', 12, newQuote, 7, { beforeValue: 10, source: 'chapter_review', sourceBodyHash: api.draftContentHash(chapters[2].body) }),
      tx('t10', 'cash', 'a10', 10, oldQuote, 10),
      tx('pending', 'cash', 'a14', 14, '她关上房门。', 400, { status: 'pending' }),
      tx('rejected', 'cash', 'a14', 14, '她关上房门。', 500, { status: 'rejected' }),
      tx('foreign', 'cash', 'a12', 12, newQuote, 600, { projectId: 'book-b' }),
      tx('wrong-owner', 'cash', 'a12', 12, newQuote, 700, { characterId: 'other' })],
    generatedChapterDrafts: [{ id: 'draft', projectId: p, chapterId: 'empty', jobId: 'j', body: '草稿私句。', status: 'draft' }],
    characterStateChangeCandidates: ['pending', 'rejected'].map(status => ({ id: status, projectId: p, characterId: who,
      status, chapterId: 'a14', chapterOrder: 14, proposedFact: { ...cash, id: status, value: 80 }, evidence: '未采纳的提议。' }))
  })
}
const withCard = (data, card) => ({ ...data, characters: data.characters.map(c => c.projectId === card.projectId && c.id === card.id ? card : c) })
const read = (api, data, n) => api.getCharacterCardReview(data, p, who, n)
function command(api, data, n, patch) {
  const r = read(api, data, n)
  return { projectId: p, characterId: who, chapterId: r.currentChapter.chapterId, chapterOrder: n,
    expectedFingerprint: r.previewFingerprint, ...(patch ? { decision: 'update', patch } : { decision: 'keep' }) }
}

function verifyDomain(api, data) {
  const untouched = structuredClone(data)
  assert.deepEqual(api.createCharacterCardReviewReader(data, p).chapters.map(c => c.order), [10, 12, 14])
  assert.equal(read(api, data).status, 'unreviewed')
  assert.equal(read(api, data).chaptersSinceReview, null)
  assert.equal(read(api, data, 10).latestConfirmedFactChapter.chapterId, 'a10')
  assert.deepEqual(read(api, data, 10).evidence.map(r => r.after), [10])
  assert.deepEqual(read(api, data).evidence.map(r => r.transactionId), ['t10', 't12'])
  const keep = command(api, data, 10)
  const kept = api.applyCharacterCardReview(data, keep, later), checked = withCard(data, kept)
  const { lastCardReview, ...rest } = kept
  assert.deepEqual(rest, data.characters[0], 'keep does not change the content or last-change metadata')
  assert.equal(lastCardReview.chapterId, 'a10')
  const r = read(api, checked)
  assert.equal(read(api, withCard(checked, { ...kept, lastChangedChapter: 12 })).status, 'reviewed', 'a change-log date alone is not a card edit')
  assert.deepEqual([r.status, r.chaptersSinceReview, r.lastChangedChapter, r.latestConfirmedFactChapter.chapterOrder], ['reviewed', 4, 3, 12])
  assert.deepEqual(r.evidence.map(v => [v.transactionId, v.before, v.after, v.chapter.chapterVersionId]), [['t12', 10, 7, 'v12']])
  const loc = r.evidence[0].location, body = data.chapters.find(c => c.id === 'a12').body
  assert.equal(loc.paragraph, 2); assert.equal(body.slice(loc.start, loc.end), newQuote)
  assert.equal(read(api, checked, 10).evidence.length, 0)
  const separate = read(api, { ...checked, characterStateTransactions: checked.characterStateTransactions.filter(t => t.id !== 't12') })
  assert.deepEqual(separate.evidence.map(e => [e.factId, e.transactionId, e.after]), [['cash', null, 7]])
  const changed = api.applyCharacterCardReview(checked, command(api, checked, 14, { abilitiesAndResources: '七文' }), later)
  const updated = withCard(checked, changed)
  assert.equal(changed.abilitiesAndResources, '七文'); assert.equal(changed.lastChangedChapter, 3)
  assert.equal(read(api, updated).status, 'reviewed')
  assert.equal(read(api, updated, 10).lastCardReview, null)
  assert.throws(() => api.applyCharacterCardReview(updated, command(api, updated, 12), at), /更早/)
  assert.throws(() => api.applyCharacterCardReview(checked, keep, at), /已变化/)
  for (const bad of [{ projectId: 'book-b' }, { characterId: 'other' }, { chapterId: 'b99' }, { chapterId: 'empty', chapterOrder: 15 },
    { chapterId: 'draft' }, { chapterId: 'archived', chapterOrder: 16 }, { chapterOrder: 0 }, { chapterOrder: 11 },
    { patch: { name: '伪改' } }, { decision: 'update', patch: { projectId: 'book-b' } },
    { decision: 'update', patch: { lastCardReview } }, { decision: 'update', patch: {} }]) {
    assert.throws(() => api.applyCharacterCardReview(data, { ...keep, ...bad }, at))
  }
  const moved = { ...checked, chapters: checked.chapters.map(c => c.id === 'a10' ? { ...c, order: 11 } : c) }
  assert.deepEqual([read(api, moved).lastReviewedChapter.chapterId, read(api, moved).lastReviewedChapter.chapterOrder,
    read(api, moved).status, read(api, moved).chaptersSinceReview], ['a10', 11, 'stale', 3])
  assert.throws(() => api.applyCharacterCardReview(moved, keep, at))
  const duplicate = { ...data, chapters: [...data.chapters, chapter('duplicate', 10, oldQuote)] }
  assert.throws(() => api.applyCharacterCardReview(duplicate, keep, later))
  const replaced = { ...checked, chapters: checked.chapters.map(c => c.id === 'a10' ? { ...c, id: 'substitute' } : c) }
  assert.equal(read(api, replaced).status, 'stale'); assert.equal(read(api, replaced).lastReviewedChapter, null)
  const revised = { ...updated, chapters: updated.chapters.map(c => c.id === 'a12' ? { ...c, body: '手改开头。' + c.body } : c) }
  assert.equal(read(api, revised).status, 'stale')
  assert.ok(!read(api, revised).evidence.some(row => row.transactionId === 't12'), 'superseded extraction cannot borrow the same quote')
  const pasted = { ...data, chapterVersions: [...data.chapterVersions, { ...data.chapterVersions[0],
    id: 'v12-newer', createdAt: '2026-08-01T00:00:00Z', body: '较晚的正式版本。' }] }
  assert.equal(read(api, pasted, 12).currentChapter.chapterVersionId, null, 'pasting old prose is not restoring the old version id')
  const retro = { ...updated, characterStateTransactions: [...updated.characterStateTransactions,
    tx('late-proof', 'cash', 'a14', 14, '她关上房门。', 4)] }
  assert.equal(read(api, retro).status, 'stale'); assert.ok(read(api, retro).evidence.some(e => e.transactionId === 'late-proof'))
  const undone = { ...checked, characterStateTransactions: [...checked.characterStateTransactions,
    tx('undo', 'cash', 'a12', 12, newQuote, 10, { reversesTransactionIds: ['t12'] })] }
  assert.equal(read(api, undone).latestConfirmedFactChapter.chapterOrder, 10)
  const withoutId = { ...data, characterStateTransactions: data.characterStateTransactions.map(t => t.id === 't12' ? { ...t, chapterId: null } : t) }
  assert.equal(read(api, withoutId).latestConfirmedFactChapter.chapterOrder, 12)
  const foreignId = { ...data, characterStateTransactions: data.characterStateTransactions.map(t => t.id === 't12' ? { ...t, chapterId: 'b99' } : t) }
  assert.equal(read(api, foreignId).latestConfirmedFactChapter.chapterOrder, 10)
  const draftOrigin = { ...data, characterStateChangeCandidates: [...data.characterStateChangeCandidates,
    { ...data.characterStateChangeCandidates[0], id: 'draft-origin', targetFactId: 'cash', jobId: 'j', chapterId: 'a12',
      chapterOrder: 12, afterValue: 7, status: 'accepted', evidence: newQuote }] }
  assert.equal(read(api, draftOrigin).latestConfirmedFactChapter.chapterOrder, 10, 'an accepted proposal from an uncommitted job is not formal evidence')
  const posted = { ...draftOrigin, chapterCommitBundles: [{ id: 'receipt', projectId: p, jobId: 'j', chapterId: 'a12',
    chapter: data.chapters.find(c => c.id === 'a12'), chapterVersion: data.chapterVersions[0], acceptedAt: later }] }
  assert.equal(read(api, posted).latestConfirmedFactChapter.chapterOrder, 12)
  const otherDraft = { ...posted, characterStateTransactions: posted.characterStateTransactions.map(t =>
    t.id === 't12' ? { ...t, sourceBodyHash: undefined } : t) }
  assert.equal(read(api, otherDraft).latestConfirmedFactChapter.chapterOrder, 10, 'job identity cannot prove which draft was accepted')
  const locked12 = withCard(data, api.applyCharacterCardReview(data, command(api, data, 12), later))
  const restored = { ...locked12, chapterVersions: [...locked12.chapterVersions, { ...locked12.chapterVersions[0],
    id: 'restored', baseChapterVersionId: 'v12', createdAt: '2026-05-01T00:00:00Z' }] }
  assert.equal(read(api, restored).status, 'stale', 'a same-text restore must not inherit the superseded version review')
  const shadow = { ...data, characters: [...data.characters, { ...data.characters[0], projectId: 'book-b', name: '同号外书' }] }
  assert.deepEqual(api.applyCharacterCardReview(shadow, keep, later), kept)
  const untouchedOther = withCard(shadow, kept).characters.at(-1)
  assert.ok(!untouchedOther.lastCardReview && untouchedOther.name === '同号外书')
  const secret = ['sk', 'proj', 'fixtureCardReview1234567890'].join('-')
  const classified = { ...data, characters: [{ ...data.characters[0], costUsd: 'fixture-cost-private' }],
    characterStateFacts: data.characterStateFacts.map(f => f.id === 'cash' ? { ...f, label: secret } : f) }
  const publicReply = JSON.stringify(api.getAgentWorldRecord(classified, { entity: 'character', id: who, projectId: p, detail: 'full' }))
  assert.ok(publicReply.includes('[REDACTED]') && !publicReply.includes(secret) && !publicReply.includes('fixture-cost-private'))
  assert.deepEqual(data, untouched, 'all projections and rejected commands are pure')
  assert.equal(api.normalizeAppData(withCard(data, { ...kept, lastCardReview: { chapterOrder: 10 } })).characters[0].lastCardReview, undefined)
  console.log('PASS scoped chapters, located facts, explicit decisions, old versions, undone and late facts, reorder and stale previews')
}

async function verifyStorage(api, data, format, Store) {
  const home = join(dir, format)
  await mkdir(home)
  const path = join(home, 'novel-director-data.' + format)
  const store = new Store(path)
  try {
    await store.save(data)
    const initial = await store.loadSnapshot()
    store.saveIfCurrent = () => { throw new Error('Bare full save is forbidden in card review') }
    const keep = command(api, initial.data, 10)
    const result = await store.reviewCharacterCard(keep, initial.revision)
    assert.deepEqual(result.savedCollections, ['characters'])
    const current = await store.loadSnapshot()
    assert.deepEqual(current.data, withCard(initial.data, result.character))
    await assert.rejects(store.reviewCharacterCard(keep, initial.revision), e => e.code === 'STORAGE_REVISION_CONFLICT')
    await assert.rejects(store.reviewCharacterCard(keep, undefined), e => e.code === 'STORAGE_REVISION_CONFLICT')
    await assert.rejects(store.reviewCharacterCard(keep, current.revision), /已变化/)
    const args = { storagePath: path, userDataPath: home, projectId: p, entity: 'character', id: who }
    const world = async (extra = {}) => (await api.AgentToolService.callTool({
      name: 'agent.getWorldRecord', arguments: { ...args, ...extra }
    })).data
    const compact = await world()
    const full = await world({ detail: 'full' })
    assert.deepEqual([compact.cardReview.status, compact.cardReview.lastReviewedChapterOrder, compact.cardReview.lastChangedChapter,
      compact.cardReview.latestConfirmedFactChapterOrder, compact.cardReview.chaptersSinceReview, compact.cardReview.evidenceCount],
    ['reviewed', 10, 3, 12, 4, 1])
    assert.ok(!('evidence' in compact.cardReview)); assert.ok(!JSON.stringify(compact).includes(newQuote))
    assert.deepEqual(full.cardReview.evidence[0].location, read(api, current.data).evidence[0].location)
    assert.equal(full.cardReview.evidence[0].excerpt, newQuote)
    const short = await world({ detail: 'full', asOfChapterOrder: 10 })
    assert.equal(short.cardReview.latestConfirmedFact.location.start, 0)
    assert.ok(!JSON.stringify(short).includes(oldQuote), 'a one-sentence official chapter is never returned as an excerpt in full')
    assert.ok(!JSON.stringify(full).includes('草稿私句') && !JSON.stringify(full).includes('别部书保密正文'))
    assert.doesNotMatch(JSON.stringify(full), /"(?:usage|cost|costUsd|promptContext|chapterCommitBundles|apiKey|previewFingerprint|basisFingerprint)":/i)
    await assert.rejects(world({ projectId: 'book-b' }), /not found/)
    await assert.rejects(world({ asOfChapterOrder: -1 }))
    assert.equal((await store.loadSnapshot()).revision, current.revision, 'all world reads and failures are read-only')
    const edited = await store.reviewCharacterCard(command(api, current.data, 14, { abilitiesAndResources: '只剩七文。' }), current.revision)
    assert.equal(edited.character.lastCardReview.decision, 'update')
    assert.equal((await world()).cardReview.evidenceCount, 0)
    assert.equal((await world({ detail: 'full' })).record.abilitiesAndResources, '只剩七文。')
    console.log('PASS ' + format + ': atomic keep/update, conflict rollback, read-only compact/full Agent parity and chapter locators')
  } finally { store.close?.() }
}

async function verifyUI() {
  const qa = window.qa
  const find = text => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text))
  async function until(fn, msg) {
    for (let i = 0; i < 120; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 20)) }
    throw new Error(msg)
  }
  async function click(text) {
    await until(() => find(text) && !find(text).disabled, '按钮不可用：' + text)
    find(text).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  function check(value, msg) { if (!value) throw new Error(msg) }
  await until(() => document.querySelector('.character-card-review'), '角色页未加载')
  const choose = (id) => {
    const el = document.querySelector('.character-card-review select')
    el.value = id; el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const text = () => document.querySelector('.character-card-review').textContent
  check(text().includes('未核对') && !qa.data.characters[0].lastCardReview, '打开页面不应标记核对')
  choose('a10'); await click('保留原卡，核对到第 10 章')
  await until(() => qa.data.characters[0].lastCardReview?.chapterId === 'a10', '保留原卡未保存')
  choose('a14'); await until(() => text().includes('相差 4 章'), '未显示距当前章数')
  document.querySelector('.character-review-evidence summary').click()
  await click('打开第 12 章')
  check(qa.opened === 'a12' && text().includes('第 2 段') && text().includes('她只剩下七文钱。'), '证据定位不正确')
  await click('编辑卡片后核对')
  async function typeValue(value) {
    const areaForResources = () => [...document.querySelectorAll('.character-review-form label')]
      .find(l => l.querySelector('.field-label')?.textContent === '能力与资源')?.querySelector('textarea')
    await until(areaForResources, '未找到能力与资源编辑框')
    const area = areaForResources()
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, value)
    area.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await typeValue('本次取消的修改'); await click('取消本次编辑')
  check(!JSON.stringify(qa.data).includes('本次取消的修改'), '取消编辑不能写入')
  await click('编辑卡片后核对'); await typeValue('手工确认七文')
  await click('确认更新并核对到第 14 章')
  await until(() => text().includes('合成写入失败'), '没有显示保存失败')
  check(qa.data.characters[0].lastCardReview.chapterId === 'a10', '写入失败仍更新了核对')
  await click('确认更新并核对到第 14 章')
  await until(() => qa.data.characters[0].lastCardReview.chapterId === 'a14', '重试没有更新')
  check(qa.data.characters[0].abilitiesAndResources === '手工确认七文', '表单与核对未原子保存')
  check(text().includes('上次核对范围内的最近一条') && text().includes('她只剩下七文钱。'), '完成核对后仍应能查看最近证据')
  choose('a10'); await until(() => text().includes('不会回退记录'), '早章不能回退核对')
  check(find('保留原卡').disabled, '早章误开放写入')
  return 'PASS renderer + IPC: evidence navigation, explicit keep, dedicated fields, cancel, failed save and retry without full save'
}

async function runUI(data) {
  const fixturePath = join(dir, 'index.html')
  await build({ stdin: { resolveDir: repoRoot, loader: 'tsx', contents: `
    import {createRoot} from 'react-dom/client';
    import {ConfirmProvider} from './src/renderer/src/components/ConfirmDialog';
    import {CharactersView} from './src/renderer/src/views/CharactersView';
    import {useAppData} from './src/renderer/src/hooks/useAppData';
    const qa = window.qa = {data:null,opened:null};
    function Page(){const {data,saveData,runPersistedStorageOperation}=useAppData(); qa.data=data;
      return data && <ConfirmProvider><CharactersView data={data} project={data.projects[0]}
        saveData={saveData} onOpenChapter={id=>{qa.opened=id}} runPersistedStorageOperation={runPersistedStorageOperation}/></ConfirmProvider>}
    createRoot(document.querySelector('main')).render(<Page/>);
  ` }, jsx: 'automatic', bundle: true, format: 'iife', platform: 'browser', loader: { '.png': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(dir, 'ui.js') })
  await writeFile(fixturePath, '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'none\'"><main></main><script src="ui.js"></script>')
  await build({ entryPoints: [join(repoRoot, 'src/preload/index.ts')], bundle: true, platform: 'node', format: 'cjs',
    external: ['electron'], outfile: join(dir, 'preload.cjs') })
  await build({ stdin: { resolveDir: repoRoot, contents: `
    export {registerDataIpcHandlers} from './src/main/ipc/dataIpcHandlers';
    export {JsonStorageService} from './src/storage/JsonStorageService';
  ` }, bundle: true, platform: 'node', format: 'esm', external: ['electron', 'better-sqlite3'], outfile: join(dir, 'ipc.mjs') })
  await writeFile(join(dir, 'ui-book.json'), JSON.stringify(data))
  await writeFile(join(dir, 'verify.cjs'), `const {app,BrowserWindow}=require('electron'); app.disableHardwareAcceleration();
    app.whenReady().then(async()=>{const {JsonStorageService,registerDataIpcHandlers}=await import('./ipc.mjs');
    const storage=new JsonStorageService(require('node:path').join(__dirname,'ui-book.json'));
    let writes=0,raw=0,fail=true;const persist=storage.reviewCharacterCard.bind(storage);
    storage.saveIfCurrent=()=>{raw++;throw new Error('Bare full save is forbidden')};
    storage.reviewCharacterCard=async(c,r)=>{if(c.decision==='update'&&fail){fail=false;throw new Error('合成写入失败')}
      const saved=await persist(c,r);writes++;return saved};
    registerDataIpcHandlers({getStorage:()=>storage,backupService:{maybeCreateAutomaticBackup:async()=>null},
      credentialService:{hasApiKey:async()=>false}});
    const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,backgroundThrottling:false,preload:require('node:path').join(__dirname,'preload.cjs')}});
    await w.loadFile(${JSON.stringify(fixturePath)});console.log(await w.webContents.executeJavaScript(${JSON.stringify('(' + verifyUI.toString() + ')()')}));
    require('node:assert/strict').deepEqual([writes,raw],[2,0]);app.exit(0)}).catch(e=>{console.error(e);app.exit(1)})`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [join(dir, 'verify.cjs'),
    '--user-data-dir=' + join(dir, 'browser'), '--disable-background-networking'], { env, windowsHide: true, timeout: 35000 })
  assert.match(stdout, /PASS renderer/); console.log(stdout.trim())
}

try {
  const outfile = join(dir, 'domain.mjs')
  const modules = ['shared/defaults', 'services/DraftDiagnosticBindingService', 'services/characterState/cardReview',
    'storage/SqliteStorageService', 'storage/JsonStorageService', 'agent/tools/AgentToolService', 'agent/tools/agentWorldTools']
  await build({ stdin: { contents: modules.map(m => `export * from './src/${m}'`).join('\n'), resolveDir: repoRoot },
    bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['better-sqlite3', 'electron'], outfile })
  const api = await import(pathToFileURL(outfile))
  const data = fixture(api)
  verifyDomain(api, data)
  await verifyStorage(api, data, 'json', api.JsonStorageService)
  await verifyStorage(api, data, 'sqlite', api.SqliteStorageService)
  await runUI(data)
} finally {
  assert.equal(dirname(resolve(dir)), resolve(base))
  await rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 120 })
}
