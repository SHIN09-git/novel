import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

// Only pure services and invented, in-memory records. Nothing opens an application database.
const { outputFiles } = await build({
  stdin: { resolveDir: repoRoot, contents: "export * from './src/services/bookContinuity/ledgerChecks'; export { applyStateChangeCandidate } from './src/services/characterState/stateMutations'; export { draftContentHash } from './src/services/DraftDiagnosticBindingService'" },
  write: false, bundle: true, platform: 'node', format: 'esm', target: 'node22'
})
const { auditBookLedger, applyStateChangeCandidate, draftContentHash } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'))
const p = 'invented-book'
const ch = (n, body, extra) => ({ id: 'c' + n, order: n, projectId: p, body, ...extra })
const data = (...texts) => ({
  chapters: texts.map((body, i) => ch(i + 1, body)), chapterVersions: [],
  characters: [['a', '林岫'], ['b', '赵久'], ['c', '周未']].map(([id, name]) => ({ projectId: p, id, name })),
  characterStateFacts: [], characterStateTransactions: [], characterStateChangeCandidates: []
})
function fact(d, id, n, evidence, extra = {}) {
  const f = { id, projectId: p, characterId: 'a', category: 'resource', key: 'cash', label: '个人现金',
    unit: '文', status: 'active', valueType: 'number', value: 10, sourceChapterId: 'c' + n, sourceChapterOrder: n, evidence,
    ...extra }
  d.characterStateFacts.push(f)
  return f
}
function tx(d, f, n, evidence, type, before, after, delta = null, extra = {}) {
  const t = { id: 'tx-' + d.characterStateTransactions.length, projectId: p, characterId: f.characterId, factId: f.id,
    chapterId: 'c' + n, chapterOrder: n, transactionType: type, beforeValue: before, afterValue: after, delta,
    evidence, source: 'manual', reason: '', status: 'accepted', ...extra }
  d.characterStateTransactions.push(t)
  return t
}
function audit(d, to = 999, from = 1) {
  const chapters = d.chapters.filter(c => c.projectId === p && !c.archivedAt && c.order <= to && c.body.trim()).sort((a, b) => a.order - b.order)
  const before = structuredClone(d)
  const result = auditBookLedger({ data: d, projectId: p, chapters, from, to,
    chapterFor(id, n) {
      if (id) return chapters.find(c => c.id === id)
      const at = chapters.filter(c => c.order === n)
      return at.length === 1 ? at[0] : undefined
    },
    evidence(c, excerpt) {
      assert(chapters.includes(c) && excerpt && c.body.includes(excerpt), 'evidence must quote the current manuscript')
      return { chapterId: c.id, chapterOrder: c.order, excerpt: Array.from(excerpt).slice(0, 160).join(''),
        versionId: d.chapterVersions.findLast(v => v.chapterId === c.id && v.body === c.body && v.projectId === p)?.id ?? null,
        contentHash: draftContentHash(c.body) }
    } })
  assert.deepEqual(d, before, 'read-only audit')
  for (const f of result) {
    assert(f.evidence.length || (f.status === 'needs_evidence' && chapters.some(c => c.order === f.atChapterOrder)))
    assert(f.evidence.every(e => chapters.some(c => c.id === e.chapterId && c.body.includes(e.excerpt) && e.excerpt !== c.body)))
  }
  return result
}
const select = (result, kind, status) => result.filter(f => f.kind === kind && f.status === status)
const conflicts = r => r.filter(f => f.status === 'conflict')
const orders = finding => finding.evidence.map(e => e.chapterOrder)
const version = (c, id) => ({ id, chapterId: c.id, projectId: p, body: c.body })
const inv = (d, id, n, owner, evidence, value, extra) => fact(d, id, n, evidence,
  { category: 'inventory', key: 'pack', label: '随身物件', unit: '', characterId: owner, valueType: 'list', value, ...extra })
const state = (d, id, n, key, value, extra) => fact(d, id, n, d.chapters[n - 1].body,
  { category: 'status', key, label: key, valueType: 'string', value, unit: '', ...extra })

test('历史投影不重复入账；当前版本、换序、归档、拒绝项和跨书隔离', () => {
  const d = data('林岫数过现金，只有十文。', '风吹过空院。', '林岫花了三文，账面却写余八文。')
  const [first, middle, last] = d.chapters
  const wallet = fact(d, 'wallet', 3, last.body, { value: 8 })
  tx(d, wallet, 1, first.body, 'create', null, 10)
  tx(d, wallet, 3, last.body, 'decrement', 10, 8, 3)
  for (const status of ['pending', 'rejected']) tx(d, wallet, 2, middle.body, 'increment', 700, 999, 299, { status })
  tx(d, wallet, 2, middle.body, 'increment', 700, 999, 299, { projectId: 'foreign' })
  tx(d, wallet, 2, middle.body, 'increment', 700, 999, 299, { characterId: 'b' })
  d.generatedChapterDrafts = [{ projectId: p, body: '草稿承诺转出三百文。' }]
  d.characterStateChangeCandidates.push({ status: 'rejected', proposedFact: { ...wallet, value: 9000 } })
  d.chapters.push(ch(2, '归档内容余额四百文。', { id: 'archived', archivedAt: '2000-01-01' }), ch(2, '外书许诺付钱。', { projectId: 'foreign', id: 'other' }))
  tx(d, wallet, 2, '归档内容余额四百文。', 'increment', 1, 400, 399, { chapterId: 'archived' })
  d.chapterVersions.push(version(first, 'base'), version(last, 'v3'), { ...version(last, 'obsolete'), body: '旧版付出九百文。' })
  const report = audit(d, 3, 3)
  assert.equal(report.length, 1)
  assert.deepEqual([report[0].kind, report[0].status, report[0].characterIds], ['money', 'conflict', ['a']])
  assert.deepEqual(report[0].evidence.map(e => [e.chapterId, e.versionId, e.excerpt]), [['c1', 'base', first.body.slice(0, -1)], ['c3', 'v3', last.body.slice(0, -1)]])
  assert.match(report[0].reason, /应为 7文.*相差 1文/u)
  const original = first.body
  first.body = '林岫说，账本从未打开。'
  assert.equal(conflicts(audit(d)).length, 0)
  assert(select(audit(d), 'money', 'needs_evidence').some(f => /基线/u.test(f.reason)))
  first.body = original
  first.order = 2
  d.chapterVersions.push(version(first, 'restored'))
  assert.deepEqual(orders(conflicts(audit(d))[0]), [2, 3])
  assert.equal(conflicts(audit(d))[0].evidence[0].versionId, 'restored')
  first.archivedAt = '2001-02-03'
  assert.equal(conflicts(audit(d)).length, 0)
  assert.deepEqual(audit(d, 2), [])
})

test('缺基线、未知或不同单位、不同角色及个人与各队账均不产生冲突', () => {
  const d = data('林岫有十文。', '林岫支出八文，余二十文。', '林岫手头又有十两银子。', '账本没有填写单位。')
  const wallet = fact(d, 'wallet', 1, d.chapters[0].body)
  for (const [i, extra] of [
    { label: '白帆队现金' }, { label: '青帆队现金' }, { characterId: 'b' }
  ].entries()) {
    const other = fact(d, 'other-' + i, 2, d.chapters[1].body, { value: 20, ...extra })
    tx(d, other, 2, d.chapters[1].body, 'decrement', null, 20, 8)
  }
  fact(d, 'taels', 3, d.chapters[2].body, { unit: '两', value: 10 })
  fact(d, 'unknown', 4, d.chapters[3].body, { unit: '', value: 100 })
  const r = audit(d)
  assert.equal(conflicts(r).length, 0)
  assert.equal(r.filter(f => /基线/u.test(f.reason)).length, 3)
  assert(r.some(f => /单位不同/u.test(f.reason) && orders(f).join() === '1,3'))
  assert(r.some(f => /单位/u.test(f.reason) && f.evidence.at(-1).chapterOrder === 4))
  wallet.unit = '元'
  assert(select(audit(d, 1), 'money', 'needs_evidence').some(f => /单位/u.test(f.reason)))
})

test('真实采纳保留下来的期初事实可用；删除历史流水的旧书不借未来值', () => {
  const d = data('林岫的账上有十文。', '林岫花去七文。')
  const wallet = fact(d, 'wallet', 1, d.chapters[0].body, { linkedCardFields: [] })
  d.characterStateChangeCandidates.push({ id: 'candidate', projectId: p, characterId: 'a', targetFactId: wallet.id,
    chapterId: 'c2', chapterOrder: 2, status: 'pending', candidateType: 'transaction', afterValue: 3,
    proposedTransaction: { transactionType: 'decrement', delta: 7 }, evidence: d.chapters[1].body })
  const accepted = applyStateChangeCandidate('candidate', d)
  assert.equal(accepted.characterStateFacts[0].value, 3)
  assert.deepEqual(audit(accepted), [])
  const legacy = { ...accepted, characterStateTransactions: accepted.characterStateTransactions.filter(t => !t.preservedPriorFact) }
  assert.equal(conflicts(audit(legacy)).length, 0)
  assert(select(audit(legacy), 'money', 'needs_evidence').some(f => /基线/u.test(f.reason)))
  assert.deepEqual(select(audit(legacy, 1), 'money', 'needs_evidence').map(f => orders(f)), [[1]])
})

test('双端转账同单位同金额才可对账；相同金额或单边转出不是配对依据', () => {
  const d = data('林岫手里有十文。赵久有一文。', '林岫给赵久转账四文。', '林岫手头少了四文。')
  const a = fact(d, 'a-wallet', 1, '林岫手里有十文。')
  const b = fact(d, 'b-wallet', 1, '赵久有一文。', { characterId: 'b', value: 1 })
  tx(d, a, 2, d.chapters[1].body, 'decrement', 10, 6, 4)
  assert.match(select(audit(d), 'money', 'needs_evidence')[0].reason, /转入/u)
  const credit = tx(d, b, 2, d.chapters[1].body, 'increment', 1, 5, 4)
  assert.equal(select(audit(d, 2), 'money', 'needs_evidence').length, 0)
  credit.delta = 3
  assert.equal(select(audit(d, 2), 'money', 'needs_evidence').length, 2)
  assert.equal(conflicts(audit(d, 2)).length, 0)
  credit.delta = 4
  credit.status = 'rejected'
  assert.equal(select(audit(d, 2), 'money', 'needs_evidence').length, 1)
  credit.status = 'accepted'
  credit.chapterId = 'c3'
  credit.evidence = d.chapters[2].body = '一张收据记着转入四文。'
  assert.equal(select(audit(d), 'money', 'needs_evidence').length, 2)
  credit.evidence = d.chapters[2].body = '赵久的账上记明林岫转入四文。'
  assert.deepEqual(audit(d), [])
})

test('仅核同队明确人数：差值、合法减员、断档、无流水的两次点名', () => {
  const d = data('白帆队点名共五人。', '白帆队走了两人，清点却有四人。', '全队始终是六人。', '林岫与赵久并肩走着。')
  const crew = fact(d, 'crew', 1, d.chapters[0].body, { key: 'crew_size', label: '白帆队人数', unit: '人', value: 5 })
  const change = tx(d, crew, 2, d.chapters[1].body, 'decrement', 5, 4, -2)
  let r = audit(d, 2)
  assert.deepEqual(orders(select(r, 'headcount', 'conflict')[0]), [1, 2])
  assert.match(conflicts(r)[0].reason, /应为 3人.*相差 1人/u)
  change.afterValue = 3
  change.evidence = d.chapters[1].body = '白帆队走了两人，只剩三人。'
  assert.deepEqual(audit(d, 2), [])
  fact(d, 'crew-again', 3, d.chapters[2].body, { key: 'crew_size', label: '白帆队人数', unit: '人', value: 6 })
  assert.match(select(audit(d), 'headcount', 'conflict')[0].reason, /明确说数量未变/u)
  d.characterStateFacts[1].evidence = d.chapters[2].body = '白帆队又点名，有六人。'
  r = audit(d)
  assert.equal(conflicts(r).length, 0)
  assert(select(r, 'headcount', 'needs_evidence').some(f => /增减依据/u.test(f.reason)))
  change.evidence = '修订前写的是全队消失。'
  assert.equal(conflicts(audit(d)).length, 0)
  assert(!audit(d).some(f => f.evidence.some(e => e.chapterOrder === 4)))
})

test('唯一物件两主有双端证据；普通同名物品、不同编号不等于两主', () => {
  const d = data('林岫持有唯一一枚霜印，行囊中还有一支笔。', '赵久的物件清单中也有霜印和笔。')
  inv(d, 'a-pack', 1, 'a', d.chapters[0].body, ['霜印', '笔'])
  inv(d, 'b-pack', 2, 'b', d.chapters[1].body, ['霜印', '笔'])
  let r = audit(d)
  assert.equal(conflicts(r).length, 1)
  assert.deepEqual([conflicts(r)[0].title, orders(conflicts(r)[0]), conflicts(r)[0].characterIds], ['霜印', [1, 2], ['a', 'b']])
  assert.equal(select(r, 'inventory', 'needs_evidence')[0].title, '笔')
  for (const [i, f] of d.characterStateFacts.entries()) Object.assign(f, { key: 'item:' + i, label: '霜印', value: true })
  assert.deepEqual(audit(d), [])
  d.characterStateFacts[1].key = 'item:0'
  r = audit(d)
  assert.equal(conflicts(r).length, 1)
  d.characterStateFacts[1].status = 'retconned'
  assert.equal(conflicts(audit(d)).length, 0)
})

test('物件列表交易使用前后差集；正常交接不出现短暂两主，缺任一端只待核', () => {
  const d = data('林岫独自保管唯一的霜印和灯。赵久随身带笔。', '林岫把霜印交给赵久。')
  const a = inv(d, 'a-pack', 1, 'a', '林岫独自保管唯一的霜印和灯。', ['霜印', '灯'])
  const b = inv(d, 'b-pack', 1, 'b', '赵久随身带笔。', ['笔'])
  const into = tx(d, b, 2, d.chapters[1].body, 'add_item', ['笔'], ['笔', '霜印'])
  assert.match(select(audit(d), 'inventory', 'needs_evidence')[0].reason, /缺少.*转出/u)
  assert.equal(conflicts(audit(d)).length, 0)
  tx(d, a, 2, d.chapters[1].body, 'remove_item', ['灯', '霜印'], ['灯'])
  assert.deepEqual(audit(d), [])
  into.status = 'pending'
  assert.match(select(audit(d), 'inventory', 'needs_evidence')[0].reason, /缺少.*转入/u)
})

test('实际出场与提及分开；暂缓、留白、兑现分项处理，死亡不抹去别的承诺', () => {
  const d = data('林岫进门，把湿衣搭在椅背上。', '林岫答应替人还印。', '旧信里只提到林岫。', '此后林岫的下落待交代。',
    '印信的事暂缓。', '林岫答应把名册带回来。', '信上确认了林岫的死讯。', '名册后事有意留白。')
  const appearance = state(d, 'appearance', 7, 'presence', '死亡')
  tx(d, appearance, 1, d.chapters[0].body, 'create', null, 'onstage')
  tx(d, appearance, 3, d.chapters[2].body, 'update', 'onstage', 'mentioned')
  tx(d, appearance, 7, d.chapters[6].body, 'update', 'mentioned', '死亡')
  const promise = state(d, 'promise-1', 5, 'return-seal', '暂缓', { category: 'promise', label: '还印' })
  tx(d, promise, 2, d.chapters[1].body, 'create', null, '答应还印')
  state(d, 'where', 4, 'whereabouts', '待交代')
  const second = state(d, 'promise-2', 8, 'return-list', '有意留白', { category: 'promise', label: '送回名册', status: 'resolved' })
  tx(d, second, 6, d.chapters[5].body, 'create', null, '送回名册')
  let r = audit(d, 3)
  assert.equal(select(r, 'promise', 'open').length, 1)
  assert.match(r[0].reason, /实际出场在第 1 章.*第 3 章有提及/u)
  assert.deepEqual(orders(r[0]), [1, 2, 3])
  assert.equal(select(audit(d, 4), 'whereabouts', 'open').length, 1)
  assert.equal(select(audit(d, 5), 'promise', 'open').length, 0)
  r = audit(d, 7)
  assert.equal(select(r, 'whereabouts', 'open').length, 0)
  assert.equal(select(r, 'promise', 'open').length, 1)
  assert.match(select(r, 'promise', 'open')[0].reason, /送回名册.*实际出场在第 1 章.*死亡/u)
  assert.deepEqual(audit(d), [])
  // None of the 88 silent chapters confers an obligation on a supporting character.
  d.chapters.push(...Array.from({ length: 88 }, (_, i) => ch(9 + i, '远处的钟响了一声。')))
  assert.deepEqual(audit(d, 96), [])
})

test('旧书明确原句只作待核，姓名清单、计划出场、未答应、空壳、旧版本均不入账', () => {
  const d = data('箱底还有二十文。全队只剩五人。', '林岫答应送回名册。那把刀归赵久保管。', '林岫、赵久和周未的名字在纸上。', '林岫从未答应此事。', '')
  d.chapters[4].summary = '林岫发誓付出五百文。'
  d.chapterVersions.push({ ...version(d.chapters[4], 'old'), body: '林岫有一千文。' })
  d.contextNeedPlans = [{ projectId: p, targetChapterOrder: 4, expectedCharacters: [{ characterId: 'b', expectedPresence: 'onstage' }] }]
  const r = audit(d)
  assert.deepEqual(r.map(f => f.kind).sort(), ['headcount', 'inventory', 'money', 'promise'])
  assert(r.every(f => f.status === 'needs_evidence' && f.evidence[0].versionId === null))
  state(d, 'where', 3, 'whereabouts', '待交代', { characterId: 'b' })
  const w = select(audit(d), 'whereabouts', 'open')[0]
  assert.match(w.reason, /没有可定位的已确认实际出场/u)
  assert.match(w.reason, /第 3 章有提及/u)
})

test('原句仍在但来源指纹已过期，交易及其改过说明的事实镜像均不能作证', () => {
  const d = data('林岫现有十文。', '林岫付了三文，却记为余八文。另一人关上门。', '林岫又付三文，余五文。')
  const short = '付了三文'
  const wallet = fact(d, 'cash', 2, '却记为余八文', { value: 8 })
  tx(d, wallet, 1, d.chapters[0].body, 'create', null, 10)
  const t = tx(d, wallet, 2, short, 'decrement', 10, 8, -3, { source: 'pipeline', sourceBodyHash: draftContentHash(d.chapters[1].body) })
  assert.equal(conflicts(audit(d, 2)).length, 1)
  d.chapters[1].body = d.chapters[1].body.replace('另一人关上门', '这是另一份账簿上的旧话')
  const r = audit(d, 2, 2)
  assert.equal(conflicts(r).length, 0)
  assert(r.some(f => f.atChapterOrder === 2 && !f.evidence.length && /指纹/u.test(f.reason)))
  tx(d, wallet, 3, d.chapters[2].body, 'decrement', 8, 5, -3)
  assert(select(audit(d), 'money', 'needs_evidence').some(f => /基线/u.test(f.reason) && orders(f).join() === '3'))
  t.evidence = '旧版本并无此句'
  assert.equal(conflicts(audit(d)).length, 0)
})

test('撤销和被撤销的交易及其镜像不参与对账；旧式撤销不能猜被撤销的是哪一笔', () => {
  const d = data('林岫的钱袋里有十文。', '林岫花掉三文，账上却记八文。', '林岫回来核账。')
  const wallet = fact(d, 'cash', 2, d.chapters[1].body, { value: 8 })
  tx(d, wallet, 1, d.chapters[0].body, 'create', null, 10)
  const removed = tx(d, wallet, 2, d.chapters[1].body, 'decrement', 10, 8, 3)
  const undo = tx(d, wallet, 3, d.chapters[2].body, 'update', 900, 500, null, { reversesTransactionIds: [removed.id] })
  assert.equal(conflicts(audit(d)).length, 0)
  assert.equal(conflicts(audit(d, 2)).length, 0, 'editorial undo is not a future story event')
  undo.status = 'rejected'
  assert.equal(conflicts(audit(d)).length, 1)
  undo.status = 'accepted'
  delete undo.reversesTransactionIds
  undo.reason = '撤销候选决定 R1；补偿记录 C1'
  assert.equal(conflicts(audit(d)).length, 0)
})

test('流水使用生效时的名称、类别和单位；后来改名、改用两银不改写早期的文钱', () => {
  const d = data('白帆队的经费有十文。', '白帆队花了三文，仍记余八文。', '新账改用银两，记了四两银子。')
  const current = fact(d, 'fund', 3, d.chapters[2].body, { key: 'taels', label: '新银两账', unit: '两', value: 4 })
  const def = { category: 'resource', key: 'crew_funds', label: '白帆队经费', unit: '文', status: 'active' }
  tx(d, current, 1, d.chapters[0].body, 'create', null, 10, null, { factDefinition: def })
  const change = tx(d, current, 2, d.chapters[1].body, 'decrement', 10, 8, 3, { factDefinition: def })
  let r = audit(d, 2)
  assert.equal(conflicts(r).length, 1)
  assert.match(conflicts(r)[0].title, /白帆队经费/u)
  assert.match(conflicts(r)[0].reason, /7文/u)
  delete change.factDefinition
  r = audit(d)
  assert.equal(conflicts(r).length, 0)
  assert(r.some(f => /当时的账户定义/u.test(f.reason) && f.atChapterOrder === 2))
})

test('长句中的金额、专物、承诺留在有界原文引文内，按 Unicode 码点裁剪', () => {
  const prefix = '𠮷字'.repeat(130)
  const d = data(prefix + '，林岫持有唯一的霜印。', prefix + '，赵久也持有霜印。', prefix + '，林岫花了三十文。',
    prefix + '，林岫答应归还灯芯。', prefix + '，那封信归林岫保管。')
  inv(d, 'a-pack', 1, 'a', d.chapters[0].body, ['霜印'])
  inv(d, 'b-pack', 2, 'b', d.chapters[1].body, ['霜印'])
  const r = audit(d)
  assert(conflicts(r)[0].evidence.every(e => e.excerpt.includes('霜印')))
  for (const [kind, text] of [['money', '三十文'], ['promise', '答应归还灯芯'], ['inventory', '归林岫保管']]) {
    const e = select(r, kind, 'needs_evidence')[0].evidence[0]
    assert(e.excerpt.includes(text))
    assert(Array.from(e.excerpt).length <= 160 && !e.excerpt.includes('\ufffd'))
  }
})

test('姓名清单不证明人数，无金额的泛引文也不证明余额', () => {
  const d = data('白帆队有五人。林岫有十文钱。', '林岫、赵久在名册上。掌柜翻开账簿。')
  const crew = fact(d, 'crew', 1, '白帆队有五人。', { key: 'headcount', label: '白帆队人数', unit: '人', value: 5 })
  const cash = fact(d, 'cash', 1, '林岫有十文钱。')
  tx(d, crew, 2, '林岫、赵久在名册上。', 'decrement', 5, 1, 2)
  tx(d, cash, 2, '掌柜翻开账簿。', 'decrement', 10, 80, 10)
  const r = audit(d)
  assert.equal(conflicts(r).length, 0)
  assert(select(r, 'headcount', 'needs_evidence').some(f => /没有明确人数/u.test(f.reason)))
  assert(select(r, 'money', 'needs_evidence').some(f => /没有可定位的金额/u.test(f.reason)))
})

test('转出点明了对方但缺收款记录，不拿其旧余额跟后账制造第二个冲突', () => {
  const d = data('林岫有十文。赵久有一文。', '林岫转给赵久四文。', '赵久付出三文，余二文。')
  const a = fact(d, 'src', 1, '林岫有十文。')
  const b = fact(d, 'dst', 1, '赵久有一文。', { characterId: 'b', value: 1 })
  tx(d, a, 2, d.chapters[1].body, 'decrement', 10, 6, 4)
  tx(d, b, 3, d.chapters[2].body, 'decrement', 5, 2, 3)
  const r = audit(d)
  assert.equal(conflicts(r).length, 0)
  assert(select(r, 'money', 'needs_evidence').some(f => /转入/u.test(f.reason)))
  assert(select(r, 'money', 'needs_evidence').some(f => /基线/u.test(f.reason) && orders(f).join() === '3'))
})

test('期初数值必须有对应原句；账目含另一笔金额时长引文仍聚焦实际数值', () => {
  const d = data('林岫花了两文。', '林岫另花三文，账页写余八文。')
  const wallet = fact(d, 'cash', 1, d.chapters[0].body)
  const t = tx(d, wallet, 2, d.chapters[1].body, 'decrement', 10, 8, 3)
  assert.equal(conflicts(audit(d)).length, 0)
  assert(select(audit(d), 'money', 'needs_evidence').some(f => /基线/u.test(f.reason)))
  d.chapters[0].body = wallet.evidence = '林岫钱包里有十文。'
  d.chapters[1].body = t.evidence = '林岫花去三文，账上记为余八文，' + '𠮷'.repeat(220) + '，别家收银九十九文。'
  const issue = conflicts(audit(d))[0]
  assert(issue.evidence[1].excerpt.includes('余八文'))
  assert(!issue.evidence[1].excerpt.includes('九十九文'))
})

test('明确的作者暂缓无需虚构正文，不能据此证明已经履约或死亡', () => {
  const d = data('林岫许诺送回石灯。', '茶水放凉了。')
  const obligation = state(d, 'lamp', 1, 'return-lamp', '送回石灯', { category: 'promise', label: '送回石灯' })
  const hold = tx(d, obligation, 2, '作者决定在番外处理。', 'update', '送回石灯', '暂缓')
  assert.equal(select(audit(d, 1), 'promise', 'open').length, 1)
  assert.deepEqual(audit(d), [])
  hold.afterValue = '有意留白'
  assert.deepEqual(audit(d), [])
  hold.afterValue = '已履行'
  const unproven = audit(d)
  assert.equal(select(unproven, 'promise', 'open').length, 1)
  assert(unproven.some(f => f.atChapterOrder === 2 && f.evidence.length === 0))
  hold.afterValue = '暂缓'
  hold.sourceBodyHash = draftContentHash('旧正文。')
  assert.equal(select(audit(d), 'promise', 'open').length, 1)
})

test('正数不能给负余额作证，旧短引文不能取自新数词的内部', () => {
  const d = data('林岫的余额为十文。', '林岫花去三文，仍有八文。')
  const wallet = fact(d, 'cash', 1, d.chapters[0].body, { value: -10 })
  const outgoing = tx(d, wallet, 2, d.chapters[1].body, 'decrement', -10, 8, 3)
  assert.equal(conflicts(audit(d)).length, 0)
  wallet.value = 10
  d.chapters[1].body = '林岫买画花去十二文，却记余八文。'
  outgoing.evidence = '二文'
  outgoing.beforeValue = 10
  outgoing.delta = 2
  const r = audit(d)
  assert.equal(conflicts(r).length, 0)
  assert(r.some(f => f.atChapterOrder === 2 && /原句/u.test(f.reason)))
})
