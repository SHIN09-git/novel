import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

// Only the pure merge planner is under test. No storage adapter, desktop profile or model is opened.
const { outputFiles } = await build({ stdin: { resolveDir: repoRoot, contents: [
  "export { buildBookContinuityReport } from './src/services/BookContinuityService'",
  "export { normalizeAppData } from './src/shared/normalizers/appData'",
  "export { editTimelineEvent } from './src/shared/normalizers/timeline'",
  "export { normalizeCandidateMemoryPatchAmendment } from './src/shared/normalizers/candidateDecision'",
  "export { WorldManagementService } from './src/services/WorldManagementService'",
  "export { applyMemoryCandidatePatchToData } from './src/services/MemoryCandidateService'",
  "export { reorderChapterInAppData, archiveChapterInAppData, restoreArchivedChapterInAppData } from './src/services/ChapterLifecycleService'",
  "export { draftContentHash } from './src/services/DraftDiagnosticBindingService'",
  "export { mergeAppData } from './src/main/DataMergeService'"
].join('\n') }, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
  plugins: [{ name: 'no-storage', setup(builder) {
    builder.onResolve({ filter: /\/dataMerge\/dataFileStorage$/ }, () => ({ path: 'disabled', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents:
      "const fail = () => { throw new Error('No file storage in this test') }; export { fail as backupBeforeMerge, fail as backupFileForOverwrite, fail as loadDataFileSnapshot, fail as saveDataFile }" }))
  } }] })
const api = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'))
const projectId = 'clock-book', at = '2025-01-01T00:00:00Z', later = '2025-01-02T00:00:00Z'
const project = { id: projectId, name: '虚构的时序样书', createdAt: at, updatedAt: at }
const chapter = (id, order, body, patch = {}) => ({ id, projectId, order, title: id, body, createdAt: at, updatedAt: at, ...patch })
const quoted = (order, quote) => chapter('c' + order, order, '窗纸动了一下。\r\n' + quote + '\n他合上书。')
const version = c => ({ id: 'v-' + c.id, projectId, chapterId: c.id, body: c.body, source: 'accept_draft', createdAt: at })
const event = (order, sourceExcerpt, patch = {}) => ({
  id: 'e' + order, projectId, chapterOrder: order, title: '门楼记录' + order, storyTime: '', narrativeOrder: order,
  participantCharacterIds: [], result: '', downstreamImpact: '', createdAt: at, updatedAt: at,
  timelineKey: '本城', location: '北门', timeAnchor: '封城', elapsedDays: 0, sourceExcerpt, ...patch
})
const book = (chapters, timelineEvents = [], rest = {}) => api.normalizeAppData({
  projects: [project], chapters, chapterVersions: chapters.map(version), timelineEvents, ...rest
})
const spring = '北门正值暮春。', winter = '北门已是严冬。'
const five = '距离启闸还剩五天。', four = '距离启闸只剩四天。', three = '距离启闸只剩三天。'
function seasons(second = {}, first = {}, q = winter) {
  return book([quoted(1, spring), quoted(96, q)], [event(1, spring, { season: 'spring', ...first }),
    event(96, q, { season: 'winter', ...second })])
}
function clock(second = {}, first = {}, q = four) {
  return book([quoted(1, five), quoted(96, q)], [event(1, five, { deadlineKey: '本次启闸', remainingDays: 5, ...first }),
    event(96, q, { deadlineKey: '本次启闸', elapsedDays: 2, remainingDays: 4, ...second })])
}
function read(data, kind, options = {}) {
  const report = api.buildBookContinuityReport(data, projectId, { kind, limit: 200, ...options })
  for (const f of report.findings) {
    for (const e of f.evidence) {
      const c = data.chapters.find(c => c.id === e.chapterId && c.projectId === projectId && !c.archivedAt)
      assert.ok(c && c.body.trim() && e.excerpt && c.body.includes(e.excerpt), 'not a quotation of the live text')
      assert.equal(e.contentHash, api.draftContentHash(c.body))
      assert.equal(e.chapterOrder, c.order)
      if (e.versionId !== null) assert.ok(data.chapterVersions.some(v => v.id === e.versionId && v.chapterId === c.id && v.body === c.body))
    }
    if (f.status === 'conflict') {
      assert.equal(new Set(f.evidence.map(e => e.chapterId)).size, 2)
      assert.equal(f.atChapterOrder, Math.max(...f.evidence.map(e => e.chapterOrder)))
    }
  }
  return report.findings
}
let passed = 0
function test(label, fn) { fn(); passed++; console.log('PASS ' + label) }

test('同线同地同一计时日的两个季节：核对到第96章，能分别定位真实原句和正式版本', () => {
  const data = seasons(), before = structuredClone(data)
  const [f] = read(data, 'season', { from: 96, to: 96 })
  assert.equal(f.status, 'conflict'); assert.equal(f.atChapterOrder, 96)
  assert.deepEqual(f.evidence.map(e => [e.chapterId, e.versionId, e.excerpt]), [['c1', 'v-c1', spring], ['c96', 'v-c96', winter]])
  assert.deepEqual(read(data, 'season', { to: 95 }), [])
  assert.deepEqual(data, before)
})
test('固定截止按共同起点的天数差核对；相符、不同期限和过期后的零均不报', () => {
  const [f] = read(clock(), 'countdown')
  assert.equal(f.status, 'conflict'); assert.match(f.reason, /相隔 2 天.*应剩 3 天.*4 天/)
  assert.deepEqual(f.evidence.map(e => e.excerpt), [five, four])
  assert.deepEqual(read(clock({ remainingDays: 3 }, {}, three), 'countdown'), [])
  assert.deepEqual(read(clock({ deadlineKey: '另一次启闸' }), 'countdown'), [])
  const zero = '距钟响还剩零天。'
  assert.deepEqual(read(book([quoted(1, zero), quoted(96, zero)], [event(1, zero, { deadlineKey: '钟响', remainingDays: 0 }),
    event(96, zero, { deadlineKey: '钟响', elapsedDays: 3, remainingDays: 0 })]), 'countdown'), [])
})
test('异地、支线、显式闪回、跨季以及中间章说明的跳时或改期，不报两章矛盾', () => {
  for (const patch of [{ location: '南港' }, { timelineKey: '另一线' }, { timeShift: 'flashback' },
    { timeShift: 'time_skip' }, { storyTime: '十年前的回忆' }]) {
    assert.deepEqual(read(seasons(patch), 'season'), [])
    assert.deepEqual(read(clock(patch), 'countdown'), [])
  }
  assert.deepEqual(read(seasons({ elapsedDays: 240 }), 'season'), [])
  const turn = seasons()
  turn.chapters[1].body = '今日立冬，' + winter
  assert.deepEqual(read(turn, 'season'), [])
  turn.chapters[1].body = '今日立冬。' + winter
  assert.deepEqual(read(turn, 'season').map(f => [f.status, f.evidence[0].excerpt]), [['needs_evidence', '今日立冬。']])
  turn.chapters[1].body = '他想起十年前。' + winter
  assert.deepEqual(read(turn, 'season'), [])
  for (const [data, kind, transition] of [[seasons(), 'season', '半年后，队伍才回到北门。'],
    [clock(), 'countdown', '启闸日期已经延期。']]) {
    data.chapters.push(quoted(18, transition))
    assert.deepEqual(read(data, kind), [])
  }
})
test('缺共同起点、天数、地点、时间线或截止事项均待核；0天不等于未填', () => {
  for (const [patch, why] of [[{ timeAnchor: '出海' }, /两个起点/], [{ timeAnchor: '' }, /起点/],
    [{ elapsedDays: undefined }, /已过天数/], [{ location: '' }, /地点/],
    [{ timelineKey: '' }, /时间线/], [{ deadlineKey: '' }, /截止事项/]]) {
    const rows = read(clock(patch), 'countdown', { from: 96 })
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'needs_evidence'); assert.match(rows[0].reason, why)
    assert.equal(rows[0].atChapterOrder, 96); assert.ok(rows[0].evidence.some(e => e.excerpt === four))
  }
})
test('第96章引文删掉后只附前章证据；两端都失效时没有证据，仍在96章范围内', () => {
  const d = clock()
  d.chapters[1].body = '这一版没有写期限。'
  for (const quotes of [[five], []]) {
    const [f] = read(d, 'countdown', { from: 96, to: 96 })
    assert.equal(f.status, 'needs_evidence'); assert.equal(f.atChapterOrder, 96)
    assert.deepEqual(f.evidence.map(e => e.excerpt), quotes); assert.match(f.reason, /原句/)
    d.chapters[0].body = '以前的时限删掉了。'
  }
})
test('换序按ID；修订后采用当前哈希和版本；同号替身、归档、草稿及旧版本不能补证', () => {
  const d = seasons()
  delete d.timelineEvents[0].chapterId // Old number-only row in an already-open editor.
  const swapped = api.reorderChapterInAppData(d, 'c1', 96, later)
  assert.deepEqual(swapped.timelineEvents.map(e => [e.chapterId, e.chapterOrder]), [['c1', 96], ['c96', 1]])
  const proof = read(swapped, 'season')[0].evidence
  assert.deepEqual(proof.map(e => [e.chapterId, e.chapterOrder, e.excerpt]), [['c96', 1, winter], ['c1', 96, spring]])
  const oldHash = proof[1].contentHash, c = swapped.chapters.find(c => c.id === 'c1')
  c.body += '新添的门牌。'
  assert.equal(read(swapped, 'season')[0].evidence[1].versionId, null)
  swapped.chapterVersions.push({ ...version(c), id: 'v-revision', source: 'manual_revision', createdAt: later })
  const fresh = read(swapped, 'season')[0].evidence[1]
  assert.notEqual(fresh.contentHash, oldHash); assert.equal(fresh.versionId, 'v-revision')
  const gone = api.archiveChapterInAppData(swapped, c.id, later)
  gone.chapters.push(chapter('replacement', 96, '完全不同的正文。'))
  gone.generatedChapterDrafts.push({ chapterId: 'replacement', body: spring })
  assert.deepEqual(read(gone, 'season'), [])
  const restored = api.restoreArchivedChapterInAppData(gone, c.id, later)
  assert.equal(restored.chapter.order, 97)
  assert.equal(restored.data.timelineEvents.find(e => e.chapterId === c.id).chapterOrder, 97)
  assert.equal(read(restored.data, 'season')[0].atChapterOrder, 97)
})
test('旧书原句只列线索；不拿注释、草稿、历史版、别书或同句重复充当证据', () => {
  const d = book([quoted(1, winter), quoted(96, five), chapter('shell', 12, '', { summary: spring }),
    chapter('retired', 3, winter, { archivedAt: at }), chapter('other', 4, four, { projectId: 'elsewhere' })])
  d.generatedChapterDrafts.push({ body: three })
  const f = [...read(d, 'season'), ...read(d, 'countdown')]
  assert.deepEqual(f.map(x => [x.status, x.atChapterOrder, x.evidence[0].excerpt]), [
    ['needs_evidence', 1, winter], ['needs_evidence', 96, five]])
  const repeated = clock()
  repeated.chapters[1].body += four
  assert.ok(read(repeated, 'countdown').every(f => f.status === 'needs_evidence'))
})
test('对白、回忆、否定、不确定数量和一行多个期限不作为可计算事实', () => {
  for (const q of ['“距离启闸只剩四天。”', '十年前，距离启闸只剩四天。', '并非距离启闸只剩四天。',
    '距离启闸只剩四天左右。', '距离启闸只剩两三天。', '距离启闸只剩四天，距离封桥还剩五天。']) {
    assert.ok(read(clock({}, {}, q), 'countdown').every(f => f.status !== 'conflict'), q)
  }
})
test('长句的可见摘录包含时间词本身，不用章节开头代替命中', () => {
  const q = '灯下'.repeat(150) + four
  const [f] = read(clock({}, {}, q), 'countdown')
  assert.equal(f.status, 'conflict'); assert.ok(f.evidence[1].excerpt.includes('只剩四天'))
})
test('跨句摘录精确定位对应句，其他支线插入章不吞掉原线比较', () => {
  const d = clock({ sourceExcerpt: '窗纸动了一下。\r\n' + four })
  d.chapters.push(quoted(60, three))
  d.timelineEvents.push(event(60, three, { deadlineKey: '本次启闸', remainingDays: 3, timelineKey: '支线' }))
  const [f] = read(d, 'countdown')
  assert.equal(f.status, 'conflict'); assert.deepEqual(f.evidence.map(e => e.excerpt), [five, four])
})
test('旧章号只按项目内唯一映射；归档重号留待核，即使随后移走重号也不猜', () => {
  const d = book([quoted(1, spring), quoted(96, winter), chapter('old96', 96, '旧卷。', { archivedAt: at }),
    chapter('foreign', 1, '别书。', { projectId: 'elsewhere' })], [event(1, spring, { season: 'spring' }), event(96, winter, { season: 'winter' })])
  assert.deepEqual(d.timelineEvents.map(e => e.chapterId), ['c1', null])
  let [f] = read(d, 'season', { from: 96 }).filter(f => f.title.includes('待绑定'))
  assert.equal(f.atChapterOrder, 96); assert.deepEqual(f.evidence, [])
  d.chapters.find(c => c.id === 'old96').order = 99
  assert.equal(api.normalizeAppData(d).timelineEvents[1].chapterId, null)
  const edited = api.editTimelineEvent(d.timelineEvents[1], { chapterId: 'c96' }, d.chapters)
  assert.equal(edited.chapterId, 'c96'); assert.equal(edited.chapterOrder, 96)
  for (const badId of ['missing', 'foreign', 'old96']) assert.throws(() => api.editTimelineEvent(edited, { chapterId: badId }, d.chapters))
  d.timelineEvents[1] = { ...edited, chapterId: 'missing' }
  ;[f] = read(d, 'season', { from: 96 }).filter(f => f.title.includes('待绑定'))
  assert.equal(f.atChapterOrder, 96); assert.deepEqual(f.evidence, [])
})
test('旧形状及未来预留章号仍可编辑；坏校验字段不强制转成0、默认季节或别章', () => {
  const legacy = { id: 'e', projectId, title: '候选', chapterOrder: 37, storyTime: '天光初亮' }
  const partial = api.normalizeAppData({ timelineEvents: [legacy] }).timelineEvents[0]
  assert.equal(partial.chapterId, undefined); assert.deepEqual(partial.participantCharacterIds, [])
  const d = book([quoted(1, spring)], [{ ...legacy, chapterId: 123, chapterOrder: 1, season: 'springtime',
    elapsedDays: '0', remainingDays: -2, sourceExcerpt: ['wrong'], timeShift: 7, timelineKey: '  主线  ' }])
  const [e] = d.timelineEvents
  assert.equal(e.chapterId, null); assert.equal(e.timelineKey, '主线')
  for (const k of ['season', 'elapsedDays', 'remainingDays', 'sourceExcerpt', 'timeShift']) assert.ok(!Object.hasOwn(e, k))
  const bound = api.editTimelineEvent(e, { chapterOrder: 1 }, d.chapters)
  assert.equal(bound.chapterId, 'c1')
  const future = api.editTimelineEvent(bound, { chapterOrder: 37 }, d.chapters)
  assert.equal(future.chapterId, null); assert.equal(future.chapterOrder, 37); assert.equal(future.storyTime, legacy.storyTime)
  assert.deepEqual(api.normalizeAppData(d).timelineEvents, d.timelineEvents)
})

test('Agent时间线预览/写入/编辑用同一组字段；换序后的旧预览不能把事件绑到替身', () => {
  const d = book([quoted(1, five), quoted(96, four), chapter('foreign', 3, '别书。', { projectId: 'other' })])
  const command = (action, operationId, patch, id) => ({ projectId, action, operationId, patch, id, entity: 'timeline_event',
    source: { kind: 'agent_director', requestedAt: at, reason: '隔离样本' } })
  const fields = { title: '闸门计时', chapterOrder: 1, storyTime: '黎明', timelineKey: '主线', location: '南岸',
    timeAnchor: '出发', elapsedDays: 0, deadlineKey: '启闸', remainingDays: 5, sourceExcerpt: five, season: 'spring', timeShift: 'flashback' }
  const world = api.WorldManagementService, create = command('create', 'new-clock', fields)
  const preview = world.preview(d, create)
  const apply = (data, cmd, p = world.preview(data, cmd)) => world.apply(data,
    { ...cmd, expectedFingerprint: p.fingerprint }, { authorizationGrantId: 'isolated-test-grant' })
  assert.equal(preview.after.chapterId, 'c1'); assert.equal(d.timelineEvents.length, 0)
  const swapped = api.reorderChapterInAppData(d, 'c1', 96, later)
  assert.throws(() => apply(swapped, create, preview), /preview/i)
  const saved = apply(d, create), id = saved.result.id
  assert.deepEqual(saved.data.timelineEvents[0], preview.after)
  const edited = apply(saved.data, command('update', 'update-clock', { chapterId: 'c96', elapsedDays: 2,
    remainingDays: 4, timeShift: null, sourceExcerpt: four }, id))
  const e = world.get(edited.data, projectId, 'timeline_event', id)
  assert.equal(e.chapterOrder, 96); assert.equal(e.chapterId, 'c96'); assert.equal(e.sourceExcerpt, four)
  assert.equal(e.timeShift, undefined); assert.equal(e.season, 'spring'); assert.equal(e.elapsedDays, 2)
  for (const patch of [{ chapterId: 'foreign' }, { chapterId: 'gone' }, { remainingDays: '2' }, { elapsedDays: -1 },
    { elapsedDays: 0.5 }, { season: 'wet' }, { timeShift: 'back' }, { location: [] }]) {
    assert.throws(() => world.preview(edited.data, command('update', 'invalid', patch, id)))
  }
  const cleared = apply(edited.data, command('update', 'clear-clock', { chapterId: null }, id)).result.after
  assert.equal(cleared.chapterId, null); assert.equal(cleared.chapterOrder, null)
})
test('接受时间线记忆候选保留标注并绑定稳定章ID；候选编辑不能顺带改来源章节', () => {
  const d = book([quoted(1, five), quoted(96, four)])
  d.chapterGenerationJobs.push({ id: 'job', projectId, targetChapterOrder: 96 })
  const fields = { timeAnchor: '封城', elapsedDays: 2, remainingDays: 4, deadlineKey: '启闸', sourceExcerpt: four, location: '北门', timelineKey: '主线' }
  const amendment = { kind: 'timeline_event_create', event: fields }
  assert.deepEqual(api.normalizeCandidateMemoryPatchAmendment(amendment), amendment)
  for (const bad of [{ chapterId: 'c1' }, { chapterOrder: 1 }, { remainingDays: 0.2 }]) {
    assert.equal(api.normalizeCandidateMemoryPatchAmendment({ ...amendment, event: bad }), undefined)
  }
  const patch = { ...amendment, event: { ...fields, chapterId: 'c96', chapterOrder: 1, title: '记时' }, schemaVersion: 1, warnings: [], summary: '启闸' }
  const candidate = { id: 'candidate', projectId, jobId: 'job', type: 'timeline_event', targetId: null, status: 'pending', proposedPatch: patch }
  d.memoryUpdateCandidates.push(candidate)
  const args = { current: d, projectId, candidate, patch, timestamp: at, targetChapterOrder: 96 }
  const [saved] = api.applyMemoryCandidatePatchToData(args).timelineEvents
  assert.equal(saved.chapterId, 'c96'); assert.equal(saved.chapterOrder, 96)
  for (const [key, value] of Object.entries(fields)) assert.equal(saved[key], value)
  patch.event.chapterId = 'missing'; assert.throws(() => api.applyMemoryCandidatePatchToData(args), /chapterId/)
  assert.deepEqual(d.timelineEvents, [])
})
test('实际导入规划重映章节和参与角色的同名ID，不改作者的时间线、地点和截止标记', () => {
  const source = book([quoted(1, spring)], [event(1, spring, { participantCharacterIds: ['c1'],
    season: 'spring', timeAnchor: 'c1', deadlineKey: 'c1', timelineKey: 'c1' })],
    { characters: [{ id: 'c1', projectId, name: '校时员', createdAt: at, updatedAt: at }] })
  const target = book([chapter('c1', 1, '目标原章。')], [], { projects: [{ ...project, name: '保留的目标书' }] })
  const { mergedData: merged, preview } = api.mergeAppData(source, target, { sourcePath: 'memory-source', targetPath: 'memory-target' })
  assert.ok(preview.canAutoMerge)
  const imported = merged.projects.find(p => p.id !== projectId)
  const [e] = merged.timelineEvents, c = merged.chapters.find(c => c.projectId === imported.id)
  assert.notEqual(c.id, 'c1'); assert.equal(e.chapterId, c.id); assert.equal(e.projectId, imported.id)
  assert.deepEqual(e.participantCharacterIds, [merged.characters.find(ch => ch.projectId === imported.id).id])
  assert.notEqual(e.participantCharacterIds[0], c.id)
  assert.deepEqual([e.timeAnchor, e.deadlineKey, e.timelineKey, e.sourceExcerpt], ['c1', 'c1', 'c1', spring])
})

if (process.argv.includes('--desktop')) {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createRequire } = await import('node:module')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const work = await mkdtemp(join(tmpdir(), 'timeline-renderer-'))
  try {
    const seed = book([quoted(1, spring), quoted(96, four), chapter('duplicate', 96, '同号另一章。')])
    const fixture = `
      import { createRoot } from 'react-dom/client'
      import { ConfirmProvider } from './src/renderer/src/components/ConfirmDialog'
      import { TimelineView } from './src/renderer/src/views/TimelineView'
      import { normalizeAppData } from './src/shared/normalizers/appData'
      let data = ${JSON.stringify(seed)}
      const root = createRoot(document.getElementById('root'))
      function render() { root.render(<ConfirmProvider><TimelineView data={data} project={data.projects[0]}
        saveData={async change => { data = change(data); render(); return { ok: true } }} /></ConfirmProvider>) }
      window.readEvent = () => data.timelineEvents[0]
      window.reloadFixture = () => { data = normalizeAppData(JSON.parse(JSON.stringify(data))); render() }
      render()`
    await build({ stdin: { resolveDir: repoRoot, contents: fixture, loader: 'tsx' }, outfile: join(work, 'view.js'),
      platform: 'browser', bundle: true, jsx: 'automatic', loader: { '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' } })
    await writeFile(join(work, 'index.html'), '<!doctype html><meta charset=utf-8><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"><div id=root></div><script src=view.js></script>')
    async function operate() {
      const until = async predicate => {
        for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 15)) }
        throw Error('Timeout: ' + predicate)
      }
      const field = name => [...document.querySelectorAll('label.field')].find(el => el.querySelector('span')?.textContent === name)?.querySelector('input,select,textarea')
      async function set(name, value) {
        const el = field(name); if (!el) throw Error('Missing field: ' + name)
        el.focus(); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); el.blur()
      }
      await until(() => document.querySelector('button.primary-button'))
      document.querySelector('button.primary-button').click()
      await until(() => field('预留章号'))
      await set('预留章号', '96')
      await until(() => window.readEvent().chapterOrder === 96 && window.readEvent().chapterId === null)
      await set('所属章节', 'c96')
      await until(() => window.readEvent().chapterId === 'c96')
      document.querySelector('.timeline-item details summary').click()
      const entries = [
        ['事件标题', '校时', 'title'], ['故事内时间', '傍晚', 'storyTime'], ['时间线', '北线', 'timelineKey'],
        ['地点', '北门', 'location'], ['共同计时起点', '封城', 'timeAnchor'], ['距起点已过天数', '0', 'elapsedDays'],
        ['季节', 'winter', 'season'], ['截止事项', '启闸', 'deadlineKey'], ['距截止剩余天数', '4', 'remainingDays'],
        ['叙事跳时', 'flashback', 'timeShift'], ['本章正文原句', '距离启闸只剩四天。', 'sourceExcerpt']
      ]
      for (const [name, value, key] of entries) {
        await set(name, value)
        await until(() => String(window.readEvent()[key]) === value)
      }
      window.reloadFixture()
      for (const [name, value] of entries) await until(() => field(name).value === value)
      await set('距起点已过天数', '')
      await until(() => !Object.hasOwn(window.readEvent(), 'elapsedDays'))
      await set('所属章节', 'c1')
      await until(() => window.readEvent().chapterId === 'c1' && window.readEvent().chapterOrder === 1)
      await set('所属章节', '')
      await until(() => window.readEvent().chapterId === null && window.readEvent().chapterOrder === null)
      return 'PASS desktop timeline'
    }
    await writeFile(join(work, 'main.cjs'), [
      "const { app, BrowserWindow, session } = require('electron'); app.disableHardwareAcceleration();",
      "app.whenReady().then(async () => { session.defaultSession.webRequest.onBeforeRequest({ urls:['http://*/*','https://*/*'] }, (_, done) => done({ cancel:true }));",
      "const w = new BrowserWindow({ show:false, webPreferences:{ sandbox:true, backgroundThrottling:false } });",
      "await w.loadFile(require('node:path').join(__dirname,'index.html'));",
      'console.log(await w.webContents.executeJavaScript(' + JSON.stringify('(' + operate.toString() + ')()') + '));',
      "app.exit(0); }).catch(e => { console.error(e); app.exit(1) });"
    ].join('\n'))
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const { stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [
      '--user-data-dir=' + join(work, 'profile'), '--disable-background-networking', join(work, 'main.cjs')
    ], { env, windowsHide: true, timeout: 40000 })
    assert.match(stdout, /PASS desktop timeline/); passed++
    console.log('PASS 真实桌面时间线：新建、重号选章、编辑、重新载入和清空字段（临时配置，禁网）')
  } finally { await rm(work, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }) }
}
console.log(`通过 ${passed} 组时间线隔离检查。`)
