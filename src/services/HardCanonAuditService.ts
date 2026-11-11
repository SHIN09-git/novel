import type {
  AppData, Chapter, HardCanonActorActionCheck, HardCanonAuditCount, HardCanonAuditFinding, HardCanonAuditInput, HardCanonAuditResult
} from '../shared/types'
import { isChapterArchived } from './ChapterLifecycleService'
import { characterStatesForProjectAtChapter } from './characterState/stateAsOf'
import { draftContentHash } from './DraftDiagnosticBindingService'
import { actionEvidence, type ActionEvidence } from './hardCanonAudit/actorAction'
import { actorDirectory, stateAtChapter } from './hardCanonAudit/actorState'
import { literalCounter, literalText, protectionPattern, type LiteralText } from './hardCanonAudit/literal'
import { applicableRules, fingerprint, type AuditRule } from './hardCanonAudit/rules'
import { clauses, quotationSpans, type Span } from './hardCanonAudit/text'

export type { HardCanonAuditFinding, HardCanonAuditInput, HardCanonAuditResult } from '../shared/types'
type AuditData = Pick<AppData, 'hardCanonPacks' | 'chapters' | 'characters' | 'characterStateFacts'> &
  Partial<Pick<AppData, 'characterStateTransactions'>>

function currentChapters(rows: Chapter[], projectId: string): Map<string, Chapter> {
  const byId = new Map<string, Chapter>()
  for (const row of rows) {
    if (row.projectId !== projectId) continue
    const old = byId.get(row.id)
    if (!old || row.updatedAt > old.updatedAt) byId.set(row.id, row)
  }
  return byId
}

export function auditHardCanon(data: AuditData, input: HardCanonAuditInput): HardCanonAuditResult {
  const { projectId, chapterOrder, chapterId, body } = input
  const rules = applicableRules(data.hardCanonPacks, projectId, chapterOrder)
  const actors = rules.flatMap((r) => r.check.kind === 'actor_action' ? [{ ...r, check: r.check }] : [])
  const dir = actorDirectory(data.characters.filter((c) => c.projectId === projectId), actors.map((r) => r.check))
  const rows = currentChapters(data.chapters, projectId)
  const official = [...rows.values()].filter((c) => !isChapterArchived(c) && c.body)
  const target = chapterId ? official.find((c) => c.id === chapterId) : official.find((c) => c.order === chapterOrder)
  const names = dir.names.length ? protectionPattern(dir.names) : undefined
  const quotes = quotationSpans(body)
  const officialText = new Map<string, LiteralText>()
  let draftText: LiteralText | undefined
  const counts: HardCanonAuditCount[] = [], findings: HardCanonAuditFinding[] = []
  const bindings: unknown[] = []

  function finding(rule: AuditRule, span: Span, severity: HardCanonAuditFinding['severity'], reason: string) {
    findings.push({ ruleId: rule.id, ruleTitle: rule.title, ruleVersion: rule.version, severity, reason,
      start: span.start, end: span.end, excerpt: body.slice(span.start, span.end) })
  }

  for (const rule of rules) {
    const c = rule.check
    if (c.kind !== 'literal') continue
    const count = literalCounter(c)
    const hits: Span[] = []
    draftText ??= literalText(body, names, quotes)
    const chapterCount = count(draftText, (span) => hits.push(span))
    let bookCount = 0, replaced = 0
    // The chapter range selects when to audit; a book limit counts the entire current book.
    for (const chapter of official) {
      let surface = officialText.get(chapter.id)
      if (!surface) {
        surface = literalText(chapter.body, names)
        officialText.set(chapter.id, surface)
      }
      const n = count(surface)
      if (chapter === target) replaced = n
      bookCount += n
    }
    const delta = chapterCount - replaced, projectedBookCount = bookCount + delta
    counts.push({ ruleId: rule.id, chapterCount, bookCount, projectedBookCount, delta })
    bindings.push([rule.id, bookCount, replaced])
    const perChapter = c.maxPerChapter ?? (c.maxPerBook === undefined ? 0 : Infinity)
    const available = c.maxPerBook === undefined ? Infinity : Math.max(0, c.maxPerBook - (bookCount - replaced))
    hits.forEach((span, i) => {
      const limits: string[] = []
      if (i >= perChapter) limits.push(`本章 ${chapterCount} 次，上限 ${perChapter} 次`)
      if (i >= available) limits.push(`替换本章后全书 ${projectedBookCount} 次，上限 ${c.maxPerBook} 次`)
      if (limits.length) finding(rule, span, c.enforcement, limits.join('；') + '。')
    })
  }

  const units = actors.length ? clauses(body, quotes) : []
  type ActorHit = { rule: AuditRule<HardCanonActorActionCheck>; hit: ActionEvidence }
  const allowed = new Map<number, ActorHit[]>(), forbidden: ActorHit[] = []
  // Undated notes may dispute a dated assertion, never confirm it (stateAtChapter).
  const stateFacts = actors.some(rule => rule.check.state) ? [
    ...characterStatesForProjectAtChapter(data, projectId, chapterOrder),
    ...data.characterStateFacts.filter(f => f.projectId === projectId && f.status === 'active' && !f.sourceChapterId && f.sourceChapterOrder == null)
  ] : []
  for (const rule of actors) {
    const basis = stateAtChapter(rule.check.state, dir.identities.get(rule.check)!, stateFacts, rows, projectId, chapterOrder)
    bindings.push([rule.id, basis])
    for (const hit of actionEvidence(rule.check, basis, dir, units)) {
      if (rule.check.effect === 'forbid') forbidden.push({ rule, hit })
      else {
        const group = allowed.get(hit.start) ?? []
        group.push({ rule, hit })
        allowed.set(hit.start, group)
      }
    }
  }
  for (const { rule, hit } of forbidden) {
    const conflict = allowed.get(hit.start)?.find(({ hit: a }) => a.actionStart < hit.actionEnd && a.actionEnd > hit.actionStart)
    const doubt = conflict ? `同一动作也命中允许规则「${conflict.rule.title}」（${conflict.rule.id}）` : hit.doubt
    finding(rule, hit, doubt ? 'review' : rule.check.enforcement, doubt ? doubt + '，请作者复核。' :
      `原句明确写出${rule.check.actor}做了受限动作「${body.slice(hit.actionStart, hit.actionEnd)}」` +
      (rule.check.state ? `，且截至本章已确认状态「${rule.check.state}」` : '') + '。')
  }
  findings.sort((a, b) => a.start - b.start || a.end - b.end || (a.ruleId < b.ruleId ? -1 : Number(a.ruleId !== b.ruleId)))
  const draftHash = draftContentHash(body)
  return { projectId, chapterOrder, draftContentHash: draftHash, rawBodyFingerprint: body.includes('\r') ? fingerprint(body) : draftHash,
    rulesFingerprint: fingerprint(['mechanical-v1', projectId, chapterOrder, rules.map((r) => [r.id, r.version]), dir.signature, bindings]),
    checkedRuleIds: rules.map((r) => r.id), findings, counts }
}
