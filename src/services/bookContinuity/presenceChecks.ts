import type { ID } from '../../shared/types'
import { authorHoldValue, entryValue, isClosed, proofs, type Ledger, type LedgerEntry } from './ledgerEntries'
import { excerptAt } from './ledgerText'
import type { BookAuditContext, BookAuditEvidence, BookAuditFinding } from './types'

const onstage = /^(?:onstage|present|实际出场|出场|在场|登场)$/iu
const mention = /^(?:mentioned|referenced|offscreen|被提及|仅提及|提及|场外)$/iu
const terminal = /^(?:departed|exited|deceased|dead|已退场|退场|已死亡|死亡|已故|已离场)$/iu
const pending = /^(?:open|pending|待交代|尚待交代|下落待交代|未交代)$/iu
const handled = /^(?:resolved|fulfilled|closed|已交代|已有交代|已履行|已兑现|已了结|已完成|已解决)$/iu

export function auditPresence(ctx: BookAuditContext, { rows, lines, names }: Ledger): BookAuditFinding[] {
  const appearances = new Map<ID, LedgerEntry>()
  const mentions = new Map<ID, LedgerEntry>()
  const departures = new Map<ID, LedgerEntry>()
  const whereabouts = new Map<ID, LedgerEntry>()
  const promises = new Map<string, LedgerEntry>()
  for (const r of rows) {
    if ((!r.proof && !r.authorHold) || (r.kind !== 'whereabouts' && r.kind !== 'promise')) continue
    const id = r.fact.characterId
    const value = String(entryValue(r) ?? '').trim()
    if (r.kind === 'promise') {
      const key = JSON.stringify([id, r.fact.key.trim() || r.fact.id])
      if (isClosed(r) || authorHoldValue(value) || handled.test(value) || !value) promises.delete(key)
      else promises.set(key, r)
    } else {
      if (isClosed(r) || authorHoldValue(value) || handled.test(value)) whereabouts.delete(id)
      else if (onstage.test(value)) { appearances.set(id, r); departures.delete(id) }
      else if (mention.test(value)) mentions.set(id, r)
      else if (terminal.test(value)) { departures.set(id, r); whereabouts.delete(id) }
      else if (pending.test(value)) whereabouts.set(id, r)
    }
  }
  const unresolved = [...whereabouts.values(), ...promises.values()]
  const rawMentions = new Map<ID, BookAuditEvidence>()
  const uniqueNames = new Map<string, number>()
  for (const name of names.values()) uniqueNames.set(name, (uniqueNames.get(name) ?? 0) + 1)
  // A bare name can locate a mention for an already-open question, never establish an appearance or a new question.
  for (const id of new Set(unresolved.map(r => r.fact.characterId))) {
    const name = names.get(id)
    if (!name || uniqueNames.get(name) !== 1) continue
    for (let i = ctx.chapters.length - 1; i >= 0; i--) {
      const ch = ctx.chapters[i]
      const line = lines.get(ch.id)!.find(p => p.text.includes(name))
      if (line) { rawMentions.set(id, ctx.evidence(ch, excerptAt(ch, line, line.text.indexOf(name)))); break }
    }
  }
  return unresolved.map(r => {
    const id = r.fact.characterId
    const who = names.get(id) || id
    const appeared = appearances.get(id)
    const left = departures.get(id)
    const explicitMention = mentions.get(id)?.proof
    const raw = rawMentions.get(id)
    const latest = raw && (!explicitMention || raw.chapterOrder > explicitMention.chapterOrder) ? raw : explicitMention
    const isPromise = r.kind === 'promise'
    const summary = isPromise ? `承诺「${r.fact.label || r.fact.key}」仍待处理。` : '作者已标记此人的下落待交代。'
    const known = appeared ? `最后一次已确认的实际出场在第 ${appeared.chapter.order} 章。` : '没有可定位的已确认实际出场。'
    const cited = proofs(r, ...[appeared, left].filter((e): e is LedgerEntry => !!e))
    const laterMention = latest && (!appeared || latest.chapterOrder > appeared.chapter.order)
    if (laterMention && !cited.some(e => e.chapterId === latest.chapterId && e.excerpt === latest.excerpt)) cited.push(latest)
    return { kind: r.kind, status: 'open', title: isPromise ? `${who} · ${r.fact.label}` : `${who}的下落`,
      reason: summary + known + (laterMention ? `第 ${latest.chapterOrder} 章有提及，不据此更新出场章。` : '') +
        (left ? `第 ${left.chapter.order} 章已标记「${String(entryValue(left))}」。` : ''),
      evidence: cited.sort((a, b) => a.chapterOrder - b.chapterOrder), characterIds: [id] }
  })
}
