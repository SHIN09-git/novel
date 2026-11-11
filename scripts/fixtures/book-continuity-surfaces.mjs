// Synthetic books with overlapping chapter numbers. No text, IDs or credentials from a real library.
export const auditBook = 'audit-a', oldBook = 'audit-b'
export const firstQuote = '顾宁数清袋里的余额，一共10文钱。'
export const laterQuote = '顾宁支出3文钱，账本上却记着余额11文钱。'
export const promiseQuote = '顾宁答应明日归还铜钥匙。'
export const oldQuote = '另一册的账上只剩27文钱。'
export const oldCountdown = '渡口的期限还剩137天。'
const at = '2026-10-01T00:00:00.000Z'
const dates = { createdAt: at, updatedAt: at }
const chapter = (projectId, order, body) => ({ id: projectId + '-' + order, projectId, order,
  title: '渡口手记 ' + order, body, ...dates })

export function continuitySurfaceFixture() {
  const projectId = auditBook, characterId = 'keeper'
  const chapters = Array.from({ length: 96 }, (_, i) => chapter(projectId, i + 1, '渡口的灯照常亮起。'))
  chapters[1].body = firstQuote + '\n木桌上压着一页封存附记。'
  chapters[4].body = laterQuote + '\n' + promiseQuote + '\n门外有人叩了三声。'
  const fact = (id, n, evidence, patch) => ({ id, projectId, characterId, key: id, label: '现金',
    category: 'resource', valueType: 'number', value: 10, unit: '文', status: 'active',
    sourceChapterId: chapters[n - 1].id, sourceChapterOrder: n, evidence, ...dates, ...patch })
  const tx = (id, factId, n, evidence, patch) => ({ id, projectId, characterId, factId, chapterId: chapters[n - 1].id,
    chapterOrder: n, transactionType: 'decrement', beforeValue: 10, afterValue: 11, delta: -3, evidence,
    status: 'accepted', ...dates, ...patch })
  const characterStateFacts = [fact('cash', 2, firstQuote),
    fact('return-key', 5, promiseQuote, { category: 'promise', label: '归还铜钥匙', valueType: 'text', value: '尚未归还', unit: '' })]
  const characterStateTransactions = [tx('spent', 'cash', 5, laterQuote)]
  for (let n = 10; n <= 24; n++) {
    const quote = `第${n}袋钱支出2文钱。`
    chapters[n - 1].body = quote + '账页的背面是空的。'
    characterStateFacts.push(fact('cash-' + n, n, quote, { value: 8, label: '钱袋 ' + n }))
    characterStateTransactions.push(tx('spent-' + n, 'cash-' + n, n, quote, { afterValue: 8, delta: -2 }))
  }
  chapters[25].body = '归档陷阱剩下99文钱。'; chapters[25].archivedAt = at
  chapters.push(chapter(oldBook, 2, oldQuote), chapter(oldBook, 5, oldCountdown))
  const version = { id: 'current-v5', projectId, chapterId: chapters[4].id, title: chapters[4].title,
    body: chapters[4].body, source: 'accept_draft', createdAt: at, note: '' }
  return {
    projects: [{ id: auditBook, name: '渡口核对样书', ...dates }, { id: oldBook, name: '无账本旧书', ...dates }],
    chapters, characters: [{ id: characterId, projectId, name: '顾宁', ...dates }],
    characterStateFacts, characterStateTransactions,
    chapterVersions: [version, { ...version, id: 'superseded-v5', body: '旧版陷阱余额999文钱。' }],
    generatedChapterDrafts: [{ id: 'draft-trap', projectId, jobId: 'spare', chapterId: chapters[4].id, title: '候选',
      body: '草稿陷阱余额555文钱。', status: 'draft', ...dates }]
  }
}
