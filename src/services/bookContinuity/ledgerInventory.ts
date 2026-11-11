import type { CharacterStateFactValue } from '../../shared/types'
import { entryValue, isClosed, proofs, type Ledger, type LedgerEntry } from './ledgerEntries'
import { isTransfer, pairedLegs, type TransferLeg } from './ledgerTransfers'
import type { BookAuditFinding } from './types'

interface Item { id: string; name: string; unique: boolean }
interface ItemOp extends TransferLeg { item: Item; side: 'out' | 'in'; transfer: boolean }

function items(row: LedgerEntry, value: CharacterStateFactValue | null): Item[] | undefined {
  // An author can track one specific object with an existing inventory key, e.g. item:seal-7 + true.
  const serial = /^(?:item|unique_item|物件编号|唯一物件)[:：](.+)$/iu.exec(row.fact.key)?.[1]
  if (serial && (typeof value === 'boolean' || typeof value === 'number' && [0, 1].includes(value) ||
      typeof value === 'string' && /^(?:持有|已持有|不持有|未持有|已转出|已失去)$/u.test(value))) {
    return [true, 1, '持有', '已持有'].includes(value) ? [{ id: 'id:' + serial, name: row.fact.label, unique: true }] : []
  }
  const list = Array.isArray(value) ? value : typeof value === 'string' && value && !/[。！？；]/u.test(value)
    ? value.split(/[、，,\n]/u) : undefined
  if (!list) return
  return [...new Set(list.map(s => s.trim()).filter(Boolean))].map(name => {
    const base = name.replace(/^唯一(?:的|一[枚把张件本块支面座只])?/u, '')
    const text = row.passage?.text ?? ''
    const unique = name !== base || [base, '的' + base, ...Array.from('枚把张件本块支面座只', c => '一' + c + base)]
      .some(term => text.includes('唯一' + term) || text.includes('独一无二' + term) || text.includes('仅此' + term))
    return { id: 'name:' + base, name: base, unique }
  })
}

export function auditInventory({ rows, names, proofFor }: Ledger): BookAuditFinding[] {
  const local = new Map<string, Item[]>()
  const ops: ItemOp[] = []
  const findings: BookAuditFinding[] = []
  const gaps = new Set<ItemOp>()
  for (const row of rows.filter(r => r.kind === 'inventory')) {
    const account = JSON.stringify([row.fact.characterId, row.fact.key || row.fact.label])
    const before = items(row, row.tx?.beforeValue ?? null) ?? local.get(account) ?? []
    const after = row.proof && !isClosed(row) ? items(row, entryValue(row)) : []
    const prior = local.get(account) ?? []
    const transfer = !!row.proof && !isClosed(row) && isTransfer(row)
    const start = ops.length
    const changed = (item: Item, side: 'in' | 'out', uncertain = false) => {
      const op: ItemOp = { row: { ...row, proof: proofFor(row, item.name) }, account, asset: item.id, item, side, transfer }
      ops.push(op)
      if (uncertain) gaps.add(op)
    }
    if (!after || !row.proof || isClosed(row)) {
      for (const item of prior) changed(item, 'out', true)
      local.delete(account)
      if (row.proof && !isClosed(row) && !after) findings.push({ kind: 'inventory', status: 'needs_evidence',
        title: row.fact.label, reason: '此条记录没有可辨认的物件或持有状态，不能推断归属。', evidence: [row.proof], characterIds: [row.fact.characterId] })
      continue
    }
    for (const item of before) if (!after.some(i => i.id === item.id)) changed(item, 'out')
    for (const item of after) if (!before.some(i => i.id === item.id)) changed(item, 'in')
    // afterValue is the full post-transaction list, not the operand of add_item/remove_item.
    for (const item of prior) if (!after.some(i => i.id === item.id) && !before.some(i => i.id === item.id)) changed(item, 'out', true)
    if (transfer && ops.length === start) findings.push({ kind: 'inventory', status: 'needs_evidence', title: row.fact.label,
      reason: '交接记录未能定位转出或转入的物件，不能确定归属。', evidence: [row.proof], characterIds: [row.fact.characterId] })
    local.set(account, after)
  }
  const pairs = pairedLegs(ops.filter(op => op.transfer && !gaps.has(op)), names)
  const holders = new Map<string, Map<string, ItemOp>>()
  for (const op of ops) {
    const { row, item, account } = op
    const claims = holders.get(item.id) ?? new Map<string, ItemOp>()
    holders.set(item.id, claims)
    if (gaps.has(op)) { claims.delete(account); continue }
    const characterId = row.fact.characterId
    if (op.transfer && !pairs.has(op)) {
      findings.push({ kind: 'inventory', status: 'needs_evidence', title: item.name,
        reason: `${names.get(characterId) || characterId}的${op.side === 'in' ? '转入' : '转出'}记录缺少可对应的${op.side === 'in' ? '转出' : '转入'}一端，不能判作两人同时持有。`,
        evidence: proofs(row), characterIds: [characterId] })
      claims.clear()
      continue
    }
    if (op.side === 'out') { claims.delete(account); continue }
    const peer = pairs.get(op)
    if (peer) claims.delete(peer.account)
    for (const prior of claims.values()) {
      const other = prior.row.fact.characterId
      if (other === characterId) continue
      const unique = prior.item.unique || item.unique
      const receivedOnly = row.tx?.transactionType === 'add_item' && !peer
      const named = [prior, op].every(o => o.row.proof!.excerpt.includes(o.item.name) ||
        (o.asset.startsWith('id:') && o.row.proof!.excerpt.includes(o.asset.slice(3))))
      findings.push({ kind: 'inventory', status: unique && named && !receivedOnly ? 'conflict' : 'needs_evidence', title: item.name,
        reason: `第 ${prior.row.chapter.order} 章记由${names.get(other) || other}持有；第 ${row.chapter.order} 章又记由${names.get(characterId) || characterId}持有。` +
          (!named ? '至少一处引文未指明这件物品，不能确证两主。' : receivedOnly ? '新增持有记录缺少对应的转出依据。' :
            unique ? '两笔有效持有记录指向同一件唯一物件。' : '仅凭同名不能断定是同一件，缺少唯一标识或交接依据。'),
        evidence: proofs(prior.row, row), characterIds: [other, characterId] })
    }
    claims.set(account, op)
  }
  return findings
}
