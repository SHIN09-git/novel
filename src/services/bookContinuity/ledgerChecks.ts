import { auditInventory } from './ledgerInventory'
import { readLedger, type Ledger, type LedgerKind } from './ledgerEntries'
import { auditQuantities } from './ledgerQuantities'
import { auditPresence } from './presenceChecks'
import { cashAmounts, crewNumber, excerptAt, ownership, promiseWord, whereaboutsWord } from './ledgerText'
import type { BookAuditContext, BookAuditFinding } from './types'

function legacyClues(ctx: BookAuditContext, { rows, lines }: Ledger): BookAuditFinding[] {
  const covered = new Map<string, Set<LedgerKind>>()
  for (const r of rows) {
    if (!r.passage) continue
    const key = JSON.stringify([r.chapter.id, r.passage.at])
    const kinds = covered.get(key) ?? new Set()
    kinds.add(r.kind)
    covered.set(key, kinds)
  }
  const findings: BookAuditFinding[] = []
  for (const ch of ctx.chapters) {
    for (const line of lines.get(ch.id)!) {
      const { text, at } = line
      const confirmed = covered.get(JSON.stringify([ch.id, at]))
      function hint(kind: LedgerKind, index: number | undefined, title: string, missing: string) {
        if (index !== undefined && !confirmed?.has(kind)) findings.push({ kind, status: 'needs_evidence', title,
          reason: missing, evidence: [ctx.evidence(ch, excerptAt(ch, line, index))] })
      }
      hint('money', cashAmounts(text)[0]?.index, '正文中的金额', '有金额原句，尚无对应的已确认账目，不能计入余额。')
      hint('headcount', crewNumber.exec(text)?.index, '正文中的人数', '有明确人数原句，队伍和计数口径仍需确认；不按姓名推算人数。')
      hint('inventory', ownership.exec(text)?.index, '正文中的物件归属', '有物件归属原句，尚未确认物件身份和持有人。')
      if (!/(?:没有|从未|不曾|从不|不肯|并未|拒绝|不|没)[^，。！？]{0,3}(?:承诺|答应|约定|许诺|应允)|履行了|兑现了|已兑现/u.test(text)) {
        hint('promise', promiseWord.exec(text)?.index, '正文中的承诺线索', '尚未确认承诺的责任人和办理状态，不列作未结承诺。')
      }
      hint('whereabouts', whereaboutsWord.exec(text)?.index, '正文中的下落线索', '尚未确认是否需要交代，不因缺席章数报警。')
    }
  }
  return findings
}

export function auditBookLedger(ctx: BookAuditContext): BookAuditFinding[] {
  const ledger = readLedger(ctx)
  const missing: BookAuditFinding[] = ledger.rows.filter(r => r.missing).map(r => ({ kind: r.kind, status: 'needs_evidence',
    title: r.fact.label, reason: r.missing!, evidence: [], atChapterOrder: r.chapter.order, characterIds: [r.fact.characterId] }))
  return [...auditQuantities(ledger), ...auditInventory(ledger), ...auditPresence(ctx, ledger), ...missing, ...legacyClues(ctx, ledger)]
}
