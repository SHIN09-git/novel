import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

// Compile in memory. No defaults, project storage, API clients or credentials are loaded.
const { outputFiles } = await build({ entryPoints: [join(repoRoot, 'src/services/HardCanonAuditService.ts')],
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' })
const { auditHardCanon } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'))
const projectId = 'paper-lantern', other = 'second-paper-book', timestamp = '2020-01-01T00:00:00Z'
const person = (id, name, project = projectId) => ({ projectId: project, id, name })
const cast = [person('a', '阿满'), person('b', '云舟'), person('c', 'Nora'), person('d', '霁記')]
const chapter = (id, order, body, rest = {}) => ({ projectId, id, order, body, updatedAt: timestamp, ...rest })
const fact = (rest = {}) => ({ projectId, characterId: 'a', id: 'fact', key: 'consciousness', label: '意识',
  value: '昏迷', category: 'physical', trackingLevel: 'hard', status: 'active',
  sourceChapterOrder: 2, sourceChapterId: null, ...rest })
const item = (id, check, rest = {}) => ({ id, projectId, title: '虚构条件 ' + id, content: '仅为说明，不参与推理。',
  status: 'active', updatedAt: timestamp, check, ...rest })
const pack = (items, id = 'pack', project = projectId) => ({ projectId: project, id, items, maxPromptTokens: 0 })
const literal = (terms, rest = {}) => ({ kind: 'literal', mode: 'terms', terms, enforcement: 'block', ...rest })
const actor = (actions, rest = {}) => ({ kind: 'actor_action', actor: '阿满', characterId: 'a', aliases: ['小满'],
  actions, effect: 'forbid', enforcement: 'block', ...rest })
const hold = actor(['持', '握住', '握', '提起'], { side: '右', objects: ['灯', '短刀'] })
const wake = actor(['醒来', '苏醒'], { state: '昏迷' })
const speak = actor(['开口', '说话'], { state: '昏迷' })
const data = (items, extra = {}) => ({ hardCanonPacks: [pack(items)], characters: cast, characterStateFacts: [], chapters: [], ...extra })
const run = (d, body, extra = {}) => auditHardCanon(d, { projectId, chapterOrder: 3, body, ...extra })
const one = (check, body, extra = {}) => run(data([item('r', check)], extra), body)
let passed = 0, failed = 0
function test(label, fn) {
  try { fn(); passed++ } catch (err) { failed++; console.error('FAIL:', label, '\n', err.message) }
}
function expect(result, severity, body) {
  for (const f of result.findings) {
    assert.ok(f.start >= 0 && f.end > f.start && f.end <= body.length)
    assert.equal(body.slice(f.start, f.end), f.excerpt)
    assert.ok(f.ruleId && f.ruleTitle && f.ruleVersion && f.reason)
  }
  if (severity === 'none') assert.deepEqual(result.findings, [])
  else {
    assert.ok(result.findings.length > 0, '缺少 ' + severity + ' 证据')
    assert.deepEqual([...new Set(result.findings.map((f) => f.severity))], [severity])
  }
}
function cases(check, expected, bodies, extra) {
  for (const body of bodies) test(expected + ' / ' + body, () => expect(one(check, body, extra), expected, body))
}

cases(hold, 'block', ['阿满右手持灯。', '小满用右手握住了那把短刀。', '阿满把那柄短刀握在右手里。', '阿满用右手提起一盏灯。'])
cases(hold, 'none', ['阿满没有用右手持灯。', '阿满右手没能握住灯。', '阿满不再用右手提起灯。', '阿满差点用右手持灯。',
  '阿满左手持灯。', '阿满右手持伞。', '阿满右手碰了灯。', '阿满看见云舟右手持灯。', '阿满看见陌生人右手持灯。',
  '阿满让学徒右手持灯。', '云舟右手持灯走向阿满。', '阿满的妹妹右手持灯。', '阿满的右手在灯旁。', '阿满扶住云舟的右手。'])
cases(hold, 'review', ['他右手持灯。', '阿满持灯。', '阿满走到门前，右手持灯。', '“阿满右手持灯。”', '「我记得『阿满右手持灯』。」',
  '云舟转述：阿满右手持灯。', '云舟说，阿满右手持灯。', '如果阿满右手持灯，会被认出来。', '阿满右手持灯吗？',
  '阿满右手持灯，那只是传闻。', '云舟回忆起旧事。\n阿满右手持灯。', '十年前，阿满右手持灯。', '云舟转述：\r\n阿满右手持灯。'])
cases(hold, 'block', ['云舟回忆起旧事。\n回到现实，阿满右手持灯。'])
cases(hold, 'review', ['阿满右手持灯。'], { characters: [...cast, person('e', '阿满')] })
cases(hold, 'block', ['阿满右手持灯。'], { characters: [...cast, person('x', '阿满', other)] })
cases({ ...hold, aliases: ['他'] }, 'review', ['他右手持灯。'])
cases(actor(['持刀'], { side: '右', objects: ['刀'] }), 'block', ['阿满的右手持刀。'])
cases({ ...hold, enforcement: 'review' }, 'review', ['阿满右手持灯。'])
cases(actor(['按住'], { objects: ['右手'] }), 'none', ['阿满用右手按住了门板。'])
cases(actor(['受伤', '骨折'], { side: '右', objects: ['手', '臂'] }), 'block', ['阿满的右手受伤了。', '阿满右臂骨折。'])
cases(actor(['受伤', '骨折'], { side: '右', objects: ['手', '臂'] }), 'none', ['阿满的左手受伤了。', '阿满看见云舟右臂骨折。',
  '云舟扶着阿满，云舟的右臂骨折了。', '阿满的右手未曾受伤。'])
cases(actor(['抬起'], { side: '右', objects: ['手'] }), 'block', ['阿满抬起右手。'])
cases(actor(['抬起'], { side: '右', objects: ['手'] }), 'none', ['云舟抬起阿满的右手。', '阿满抬起左手。'])

const asleep = { characterStateFacts: [fact()] }
cases(wake, 'block', ['阿满醒来。', '阿满苏醒。', '阿满终于醒来了。'], asleep)
cases(wake, 'none', ['阿满没有醒来。', '阿满未曾苏醒。', '云舟苏醒。', '阿满仍在昏迷。'], asleep)
cases(wake, 'review', ['阿满醒来。'])
cases(wake, 'review', ['云舟说，阿满醒来。', '“阿满苏醒。”'], asleep)
cases(wake, 'review', ['阿满已经清醒。阿满苏醒。'], asleep)
for (const first of ['阿满没有醒来。', '阿满望见云舟醒来。', '“阿满已经醒来了。”', '阿满可能已经醒来了。']) {
  test('只有先前确属该角色的实然证据才能削弱下一次裁定 / ' + first, () => {
    const body = first + '阿满苏醒。'
    const findings = one(wake, body, asleep).findings.filter((f) => f.start >= first.length)
    assert.deepEqual(findings.map((f) => f.severity), ['block'])
  })
}
cases(speak, 'block', ['阿满开口。'], asleep)
cases(speak, 'review', ['阿满先醒来。阿满开口。'], asleep)
cases(speak, 'none', ['阿满始终没有开口。', '阿满听到云舟说话。', '阿满躺着。'])
for (const [label, f] of Object.entries({ '未来章': fact({ sourceChapterOrder: 4 }), '无章号': fact({ sourceChapterOrder: null }),
  '其他项目': fact({ projectId: other }), '他人状态': fact({ characterId: 'b' }), '已撤销': fact({ status: 'retconned' }),
  '软注记': fact({ trackingLevel: 'note' }), '否定不是肯定': fact({ value: '无法判断是否昏迷' }),
  '仅备注提及': fact({ value: '未知', evidence: '听说阿满昏迷' }) })) {
  test(label + '不能证实昏迷', () => expect(one(wake, '阿满醒来。', { characterStateFacts: [f] }), 'review', '阿满醒来。'))
}
cases(speak, 'none', ['阿满开口。'], { characterStateFacts: [fact(), fact({ sourceChapterOrder: 3, value: '清醒' })] })
cases(speak, 'block', ['阿满开口。'], { characterStateFacts: [fact(), fact({ sourceChapterOrder: 4, value: '清醒' })] })
cases(speak, 'review', ['阿满开口。'], { characterStateFacts: [fact(), fact({ value: '清醒' })] })
cases(wake, 'block', ['阿满苏醒。'], { characterStateFacts: [fact(), fact({ sourceChapterOrder: null })] })
cases(wake, 'review', ['阿满苏醒。'], { characterStateFacts: [fact(), fact({ sourceChapterOrder: null, value: '清醒' })] })
cases(speak, 'block', ['阿满开口。'], { characterStateFacts: [fact({ key: '昏迷', label: '昏迷', value: true, sourceChapterOrder: 3 })] })
cases(speak, 'none', ['阿满开口。'], { characterStateFacts: [fact({ key: '昏迷', label: '昏迷', value: false })] })
cases(speak, 'review', ['阿满开口。'], { ...asleep, characters: [person('b', '云舟')] })
cases(speak, 'block', ['阿满开口。'], { chapters: [chapter('origin', 2, '旧钟报时。')],
  characterStateFacts: [fact({ sourceChapterOrder: null, sourceChapterId: 'origin' })] })
cases(speak, 'review', ['阿满开口。'], { chapters: [chapter('origin', 2, '旧钟报时。', { archivedAt: timestamp })],
  characterStateFacts: [fact({ sourceChapterOrder: 2, sourceChapterId: 'origin' })] })
cases(speak, 'review', ['阿满开口。'], { chapters: [chapter('foreign', 2, '他书。', { projectId: other })],
  characterStateFacts: [fact({ sourceChapterOrder: 2, sourceChapterId: 'foreign' })] })

test('允许并非强制；只把同一动作的相反条件转为复核', () => {
  const allow = { ...hold, actions: ['持灯'], effect: 'allow', objects: ['灯'] }
  const body = '阿满右手持灯。阿满右手持短刀。'
  expect(one(allow, body), 'none', body)
  const result = run(data([item('forbid', hold), item('allow', allow)]), body)
  assert.deepEqual(result.findings.map((f) => [f.ruleId, f.severity]), [['forbid', 'review'], ['forbid', 'block']])
  assert.match(result.findings[0].reason, /allow/)
  for (const change of [{ side: '左' }, { fromChapter: 4 }, { actor: '云舟', characterId: 'b', aliases: [] }]) {
    expect(run(data([item('f', hold), item('a', { ...allow, ...change })]), body), 'block', body)
  }
})

test('原字形、受保护名字/标题/对白、精确例外与 UTF-16 位置', () => {
  const body = '🧭序。\r\n霁記读《灯記》说：“記。”\n門牌記号。记。記。'
  const result = one(literal(['記'], { exceptions: ['門牌記号'] }), body)
  expect(result, 'block', body)
  assert.deepEqual(result.findings.map((f) => [f.start, f.end, f.excerpt]), [[body.lastIndexOf('記'), body.lastIndexOf('記') + 1, '記']])
})
test('Latin：普通词计数；姓名型号、作者例外、带引号和无引号对白不计', () => {
  const body = 'Nora看着Nova和ZX-19型。型号为abc。她说：quiet。例外 spare。笺上留着quiet。'
  const r = one(literal([], { mode: 'latin', exceptions: ['spare'] }), body)
  assert.deepEqual(r.findings.map((f) => [f.excerpt, f.start]), [['quiet', body.lastIndexOf('quiet')]])
})
test('选定外文词不匹配其他单词、型号内的子串或英文缩写中的句点', () => {
  const body = 'badger遇到X-bad-9。bad。beta。'
  assert.deepEqual(one(literal(['bad'], { mode: 'latin' }), body).findings.map((f) => f.excerpt), ['bad'])
})
test('逐字匹配不是正则；最长的不重叠命中计一次；交叠例外取并集', () => {
  const body = '甲乙丙。浮灯。灯。[+]。'
  const r = one(literal(['丙', '浮灯', '灯', '[+]'], { exceptions: ['甲乙', '乙丙'] }), body)
  assert.deepEqual(r.findings.map((f) => f.excerpt), ['浮灯', '灯', '[+]'])
})
const ledger = [chapter('p1', 1, '潮音。潮音。'), chapter('p3', 3, '潮音。潮音。'), chapter('p5', 5, '潮音。'),
  chapter('archived', 2, '潮音。'.repeat(20), { archivedAt: timestamp }), chapter('foreign', 6, '潮音。'.repeat(8), { projectId: other }),
  chapter('shell', 7, ''), chapter('p3', 3, '潮音。'.repeat(9), { updatedAt: '2019-01-01' })]
const book = (check, body, extra) => run(data([item('word', check)], { chapters: ledger,
  generatedChapterDrafts: [{ projectId, id: 'draft', chapterId: 'p3', status: 'draft', body: '潮音。'.repeat(9) }],
  chapterVersions: [{ projectId, id: 'history', chapterId: 'p3', body: '潮音。'.repeat(8) }],
  revisionVersions: [{ id: 'candidate', sessionId: 'edit', status: 'candidate', body: '潮音。'.repeat(7) }] }), body, extra)
const count = (r) => [r.counts[0].chapterCount, r.counts[0].bookCount, r.counts[0].projectedBookCount, r.counts[0].delta]
test('单设全书限额；只替换当前正文章，计入范围外和后章的正式正文', () => {
  const c = literal(['潮音'], { maxPerBook: 5, fromChapter: 3, toChapter: 3 })
  for (const opts of [{ chapterId: 'p3' }, { chapterId: null }]) {
    const r = book(c, '潮音。', opts)
    assert.deepEqual(count(r), [1, 5, 4, -1]); assert.deepEqual(r.findings, [])
  }
  const excess = book(c, '潮音。'.repeat(3))
  assert.deepEqual(count(excess), [3, 5, 6, 1]); assert.deepEqual(excess.findings.map((f) => f.start), [6])
})
test('新增、减少、已超全书限额但本稿无证据；两种阈值只标实际超额处', () => {
  const c = literal(['潮音'], { maxPerBook: 5, maxPerChapter: 1 })
  assert.deepEqual(count(book(c, '潮音。', { chapterOrder: 9 })), [1, 5, 6, 1])
  assert.deepEqual(count(book(c, '潮音。', { chapterId: 'archived' })), [1, 5, 6, 1])
  assert.deepEqual(book(c, '潮音。'.repeat(3)).findings.map((f) => f.start), [3, 6])
  const empty = book(literal(['潮音'], { maxPerBook: 0 }), '翻页。')
  assert.deepEqual(count(empty), [0, 5, 3, -2]); assert.deepEqual(empty.findings, [])
})
test('只执行本章启用的结构化条件，包括零 Prompt 预算的第二个包', () => {
  const c = literal(['潮音'])
  const d = data([], { hardCanonPacks: [pack([
    item('off', c, { status: 'inactive' }), item('old', c, { status: 'deprecated' }), item('other', c, { projectId: other }),
    item('next', { ...c, fromChapter: 4 }), item('past', { ...c, toChapter: 2 }), item('free', undefined, { content: '绝不能写潮音' }),
    item('invalid', { ...c, maxPerBook: -1 }), item('typo', { ...c, maxPerBok: 1 }), item('a', { ...c, fromChapter: 3, toChapter: 3 })
  ]), pack([item('b', { ...c, enforcement: 'review' })], 'second'), pack([item('x', c)], 'foreign', other)] })
  const r = run(d, '潮音。')
  assert.deepEqual(r.checkedRuleIds, ['a', 'b']); assert.deepEqual(r.findings.map((f) => f.severity), ['block', 'review'])
})
test('正文、规则版本及依赖变更失效；恢复原文复算；规则、集合、章和角色排序不影响指纹', () => {
  const c = literal(['潮音', '舊'], { exceptions: ['手記', '雨記'] })
  const rows = [item('w', c), item('a', hold)]
  const d = data(rows, { chapters: ledger })
  const body = '🧭序。\r\n阿满右手持灯。潮音。'
  const r = run(d, body)
  const reordered = data([rows[1], item('w', { ...c, terms: [...c.terms].reverse(), exceptions: [...c.exceptions].reverse() })],
    { characters: [...cast].reverse(), chapters: [...ledger].reverse() })
  assert.deepEqual(run(reordered, body), r)
  const fixed = run(d, '🧭序。\r\n阿满左手持灯。')
  assert.notEqual(r.draftContentHash, fixed.draftContentHash); assert.deepEqual(fixed.findings, [])
  assert.deepEqual(run(d, body), r)
  const lf = run(d, body.replace('\r\n', '\n'))
  assert.equal(r.draftContentHash, lf.draftContentHash); assert.notEqual(r.rawBodyFingerprint, lf.rawBodyFingerprint)
  assert.deepEqual(r.findings.map((f) => f.start - 1), lf.findings.map((f) => f.start))
  const changed = run(data([item('w', { ...c, maxPerBook: 2 }), rows[1]], { chapters: ledger }), body)
  assert.notEqual(r.rulesFingerprint, changed.rulesFingerprint)
  assert.notEqual(r.findings.at(-1).ruleVersion, changed.findings.at(-1).ruleVersion)
  assert.notEqual(r.rulesFingerprint, run({ ...d, chapters: [chapter('new', 8, '潮音。'), ...ledger] }, body).rulesFingerprint)
  assert.notEqual(one(wake, body).rulesFingerprint, one(wake, body, asleep).rulesFingerprint)
})

if (!failed) {
  const body = '雨幕里，值夜人给灯罩擦去一圈水痕。长廊尽头又响起潮音。\n'.repeat(66) + '阿满右手持灯。'
  const fixture = data([item('a', hold), item('b', speak), item('w1', literal(['潮音'], { maxPerBook: 10000 })),
    item('w2', literal(['舊'])), item('w3', literal([], { mode: 'latin' }))],
  { chapters: Array.from({ length: 100 }, (_, i) => chapter('bench-' + i, i + 1, body)), ...asleep })
  const sample = () => { const at = performance.now(); const r = run(fixture, body); assert.equal(r.checkedRuleIds.length, 5); return performance.now() - at }
  sample()
  const times = Array.from({ length: 9 }, sample).sort((a, b) => a - b)
  console.log(`Warm audit: 100 chapters x ${body.length} UTF-16 units, 5 rules; 9 runs, median ${times[4].toFixed(1)} ms, max ${times.at(-1).toFixed(1)} ms (no process startup).`)
}
console.log(`Mechanical HardCanon: ${passed} passed, ${failed} failed.`)
if (failed) process.exitCode = 1
