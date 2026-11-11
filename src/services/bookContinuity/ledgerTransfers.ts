import type { Ledger, LedgerEntry } from './ledgerEntries'

export interface TransferLeg {
  row: LedgerEntry
  account: string
  asset: string
  side?: 'in' | 'out'
}

export function isTransfer(row: LedgerEntry): boolean {
  return row.tx?.transactionType === 'move' || /转[账帐入出给交来]|划[拨入出给]|拨给|调[入出]|移交|交[给还接]|递给|转手|接过|转让|transfer/i
    .test(`${row.passage?.text ?? ''} ${row.tx?.reason ?? ''}`)
}

// There is no transfer ID in the old ledger. Pair a unique debit/credit at the
// same passage, or two uniquely identifiable parties naming each other. Amount alone is not an ID.
export function pairedLegs<T extends TransferLeg>(legs: T[], names: Ledger['names']): Map<T, T> {
  const pairs = new Map<T, T>()
  const uniqueNames = new Set(names.values())
  const seen = new Set<string>()
  for (const name of names.values()) {
    if (seen.has(name) || !name) uniqueNames.delete(name)
    seen.add(name)
  }
  function match(key: (leg: T) => string | undefined) {
    const groups = new Map<string, T[]>()
    for (const leg of legs) {
      if (pairs.has(leg) || !leg.row.proof || !leg.side || !leg.asset) continue
      const id = key(leg)
      if (!id) continue
      const group = groups.get(id) ?? []
      group.push(leg)
      groups.set(id, group)
    }
    for (const group of groups.values()) {
      if (group.length !== 2) continue
      const [a, b] = group
      if (a.side === b.side || a.account === b.account) continue
      const [out, into] = a.side === 'out' ? [a, b] : [b, a]
      if (out.row.chapter.order > into.row.chapter.order) continue
      pairs.set(a, b)
      pairs.set(b, a)
    }
  }
  match(l => {
    const line = l.row.passage!.text
    if ([...uniqueNames].filter(name => line.includes(name)).length > 2) return
    return JSON.stringify([l.row.chapter.id, l.row.offset, l.asset])
  })
  match(l => {
    const people = [...uniqueNames].filter(name => l.row.passage!.text.includes(name)).sort()
    if (people.length === 2 && people.includes(names.get(l.row.fact.characterId) ?? '')) {
      return JSON.stringify([people, l.asset])
    }
  })
  return pairs
}
