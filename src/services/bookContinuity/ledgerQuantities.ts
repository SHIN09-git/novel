import { resourceAccountScope } from '../../shared/characterStateDefinition'
import { entryValue, isClosed, proofs, type Ledger, type LedgerEntry } from './ledgerEntries'
import { isTransfer, pairedLegs, type TransferLeg } from './ledgerTransfers'
import { quantitiesIn } from './ledgerText'
import type { BookAuditFinding } from './types'

function numberOf(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v :
    typeof v === 'string' && /^-?\d+(?:\.\d+)?$/u.test(v.trim()) ? Number(v) : NaN
  return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : undefined
}

function accountOf({ fact, kind }: LedgerEntry) {
  // A steward's own purse and the crew's funds can have the same old key ("cash").
  const scope = kind === 'money' ? resourceAccountScope(fact.key, fact.label) :
    /队|团|集体|team|party|crew|group/i.test(fact.label + ' ' + fact.key) ? fact.label.trim() : ''
  return JSON.stringify([kind, fact.characterId, fact.key.trim() || fact.label.trim(), scope])
}

const same = (a: number, b: number) => Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 2
const display = (n: number) => String(Number(n.toPrecision(15)))
const unitSpelling = (u: string) => ({ 文钱: '文', 两银子: '两', 两白银: '两', 两银: '两' })[u] ?? u
const unchanged = /(?:余额|账上|账面|经费|现金|人数|全队|队伍|队里|一行)(?:从头到尾|从出发起)?(?:一直|始终|仍旧|仍然|仍)(?:是|为|有|只有)|(?:人数|余额)(?:从未|未曾|没有|丝毫未)(?:变动|变化|增减)|无人(?:入队或离队|进出队伍)/u

function movement(row: LedgerEntry) {
  const tx = row.tx
  const before = numberOf(tx?.beforeValue)
  const after = numberOf(entryValue(row))
  const rawDelta = numberOf(tx?.delta)
  const arithmetic = tx?.transactionType === 'increment' || tx?.transactionType === 'decrement'
  const delta = rawDelta === undefined ? undefined :
    tx?.transactionType === 'decrement' ? -Math.abs(rawDelta) : tx?.transactionType === 'increment' ? Math.abs(rawDelta) : rawDelta
  const unit = row.fact.unit.trim()
  const text = row.passage?.text ?? ''
  const amounts = quantitiesIn(text, row.kind === 'headcount' ? 'headcount' : 'money', unit)
  const units = amounts.map(m => m.unit)
  const supports = (n: number | undefined, magnitude = false) => n !== undefined &&
    amounts.some(m => magnitude ? same(Math.abs(m.value), Math.abs(n)) : same(m.value, n))
  const observedAfter = supports(after)
  const explicit = observedAfter || (!!tx && tx.transactionType !== 'create' && (supports(before) || supports(delta, true)))
  const usable = !!unit && !/^(?:未知|不明|无|待定|[?？-])$/u.test(unit) &&
    (row.kind === 'headcount' ? /^(?:人|名|位|员)$/u.test(unit) && [before, after, delta].every(n => n === undefined || Number.isInteger(n)) :
      units.every(u => unitSpelling(u) === unitSpelling(unit)))
  const account = accountOf(row)
  const change = delta ?? (before !== undefined && after !== undefined ? after - before : undefined)
  const leg: TransferLeg | undefined = row.proof && !isClosed(row) && isTransfer(row) ? {
    row, account, asset: usable && explicit && change ? JSON.stringify([row.kind, unit, Math.abs(change)]) : '',
    side: change ? (change > 0 ? 'in' : 'out') : undefined
  } : undefined
  return { row, account, arithmetic, before, after, delta, unit, usable, explicit, observedAfter, leg }
}

export function auditQuantities({ rows, names }: Ledger): BookAuditFinding[] {
  const events = rows.filter(r => r.kind === 'money' || r.kind === 'headcount').map(movement)
  const pairs = pairedLegs(events.flatMap(e => e.leg ? [e.leg] : []), names)
  const state = new Map<string, { amount: number; unit: string; basis: LedgerEntry[] }>()
  const position = (r: LedgerEntry, account: string) => JSON.stringify([account, r.chapter.id, r.offset])
  const slots = new Map<string, number>()
  for (const { row, account } of events) if (row.proof) {
    const key = position(row, account)
    slots.set(key, (slots.get(key) ?? 0) + 1)
  }
  const findings: BookAuditFinding[] = []
  for (const { row, account, arithmetic, before, after, delta, unit, usable, explicit, observedAfter, leg } of events) {
    const prev = state.get(account)
    const { fact, tx } = row
    const label = fact.label || fact.key
    const title = `${names.get(fact.characterId) || fact.characterId} · ${label}`
    const add = (status: BookAuditFinding['status'], reason: string, basis: LedgerEntry[] = []) => {
      findings.push({ kind: row.kind, status, title, reason, evidence: proofs(...basis, row), characterIds: [fact.characterId] })
    }
    state.delete(account)
    if (!row.proof || isClosed(row)) continue
    if (!usable || (prev && prev.unit !== unit)) {
      add('needs_evidence', prev && prev.unit !== unit ? `单位不同（${prev.unit} / ${unit || '未记'}），不能直接比对。` :
        '缺少明确且与原句一致的计量单位或有效数量，不能直接比对。', prev?.basis)
      if (usable && observedAfter && !leg && after !== undefined) state.set(account, { amount: after, unit, basis: [row] })
      continue
    }
    if (!explicit) {
      add('needs_evidence', row.kind === 'headcount' ? '原句没有明确人数与本笔记录对应，不能从出场姓名推算。' : '原句没有可定位的金额与本笔数值对应，不能确证这笔账。')
      continue
    }
    const key = position(row, account)
    if ((slots.get(key) ?? 0) > 1) {
      add('needs_evidence', '同一账户的多笔流水指向同一位置，无法按原文确定先后。')
      slots.set(key, -1)
      continue
    }
    if (slots.get(key) === -1) continue
    if (prev?.basis.some(p => p.chapter.order === row.chapter.order && p.chapter.id !== row.chapter.id)) {
      add('needs_evidence', '两章的章号相同，不能确定流水的先后。', prev.basis)
      continue
    }
    if (leg && !pairs.has(leg)) {
      add('needs_evidence', `转移缺少${leg.side === 'out' ? '可与转出对应的转入' : leg.side === 'in' ? '可与转入对应的转出' : '可区分转出和转入的两端'}记录，不据此推算差额。`)
      // A later entry in the named counterparty's account may already reflect this unposted leg.
      for (const [other, balance] of state) {
        const last = balance.basis.at(-1)!
        const peer = names.get(last.fact.characterId)
        if (last.kind === row.kind && balance.unit === unit &&
          (last.fact.characterId !== fact.characterId ? peer && row.passage!.text.includes(peer) :
            last.fact.label && row.passage!.text.includes(last.fact.label))) state.delete(other)
      }
      continue
    }
    if (!prev && tx && tx.transactionType !== 'create') {
      add('needs_evidence', `这笔变化之前没有可定位的${row.kind === 'money' ? '余额' : '人数'}基线，不能用当前值倒推。`)
      if (!observedAfter || (delta !== undefined && after !== undefined && same(Math.abs(delta), Math.abs(after)) &&
        !/还剩|只剩|剩余|结余|余额|余下|合计|实到/u.test(row.passage!.text))) continue
    } else if (prev) {
      const start = `第 ${prev.basis.at(-1)!.chapter.order} 章核得 ${display(prev.amount)}${unit}`
      if (before !== undefined && !same(prev.amount, before)) {
        add('conflict', `${start}；本笔交易记载的变动前值为 ${display(before)}${unit}，相差 ${display(Math.abs(prev.amount - before))}${unit}。`, prev.basis)
        continue
      }
      if (delta !== undefined) {
        const expected = prev.amount + delta
        const calc = `${start}，本笔${delta < 0 ? '减少' : '增加'} ${display(Math.abs(delta))}${unit}，应为 ${display(expected)}${unit}`
        if (after !== undefined && !same(expected, after)) {
          add('conflict', `${calc}，却记为 ${display(after)}${unit}，相差 ${display(Math.abs(expected - after))}${unit}。`, prev.basis)
          continue
        }
        if (expected < 0 && !same(expected, 0) && (row.kind === 'headcount' ||
          /现金|现钱|盘缠|铜钱|cash/i.test(fact.key + fact.label) && !/赊|透支|借贷|欠款/u.test(row.passage!.text))) {
          add('conflict', `${calc}，超过已确认的可用${row.kind === 'money' ? '现款' : '人数'}。`, prev.basis)
          continue
        }
        if (after === undefined) {
          state.set(account, { unit, amount: expected, basis: [...prev.basis, row] })
          continue
        }
      } else if (arithmetic) {
        add('needs_evidence', '流水没有记明增减量，不能核对变动后值。', prev.basis)
      } else if (before === undefined && after !== undefined && !same(prev.amount, after)) {
        const constant = unchanged.test(row.passage!.text)
        add(constant ? 'conflict' : 'needs_evidence', `${start}；本次记为 ${display(after)}${unit}，相差 ${display(Math.abs(after - prev.amount))}${unit}。` +
          (constant ? '原句明确说数量未变。' : '两次记录之间缺少增减依据，不能断定写错。'), prev.basis)
      }
    }
    if (after !== undefined) state.set(account, { unit, amount: after, basis: [row] })
    else if (!arithmetic || !prev) add('needs_evidence', '缺少可核对的变动后数值。')
  }
  return findings
}
