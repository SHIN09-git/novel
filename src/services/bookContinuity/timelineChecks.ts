import type { Chapter, TimelineEvent } from '../../shared/types'
import { isTimelineDay, timelineChapterFor, timelineChapterIndex } from '../../shared/normalizers/timeline'
import type { BookAuditContext, BookAuditEvidence, BookAuditFinding } from './types'
import { locateTimeQuote, readTimelinePassages, seasonNames, timeClues, timeExcerpt, timeNoteShift, type TimeKind } from './timelineText'

const labels = { season: '季节', countdown: '倒计时' }
interface Reading {
  event: TimelineEvent; chapter: Chapter; kind: TimeKind; proof?: BookAuditEvidence
  missing: string[]; scope?: string; point?: string
}

// Keep an earlier chapter available even if this chapter contains multiple events on the same clock.
class ReadingIndex {
  private entries = new Map<string, { last: Reading; previous?: Reading }>()

  earlier(key: string | undefined, row: Reading) {
    const pair = key && this.entries.get(key)
    return pair ? pair.last.chapter.id === row.chapter.id ? pair.previous : pair.last : undefined
  }

  remember(key: string, row: Reading) {
    this.entries.set(key, { last: row, previous: this.earlier(key, row) })
  }
}

function compare(a: Reading, b: Reading): Pick<BookAuditFinding, 'status' | 'reason'> | undefined {
  const left = a.event, right = b.event
  if (a.missing.length || b.missing.length) {
    const why = [a, b].filter(r => r.missing.length).map(r => `第 ${r.chapter.order} 章缺${r.missing.join('、')}`)
    return { status: 'needs_evidence', reason: why.join('；') + '，不能据此认定前后矛盾。' }
  }
  if (left.timeAnchor !== right.timeAnchor) {
    if (b.kind === 'season' && left.season === right.season) return
    return { status: 'needs_evidence', reason: `“${left.timeAnchor}”与“${right.timeAnchor}”不是同一计时起点，缺少两个起点之间的时距。` }
  }
  if (b.kind === 'season') {
    // No invented calendar for a fictional world. A later day can really be in another season.
    if (left.elapsedDays !== right.elapsedDays || left.season === right.season) return
    return { status: 'conflict', reason: `${right.timelineKey}的${right.location}，同在“${right.timeAnchor}”起算 ${right.elapsedDays} 天时，一处记为${seasonNames[left.season!]}，另一处记为${seasonNames[right.season!]}。` }
  }
  // Chapter order is not story chronology. After expiry, zero can legitimately remain zero.
  const [first, last] = left.elapsedDays! <= right.elapsedDays! ? [left, right] : [right, left]
  const elapsed = last.elapsedDays! - first.elapsedDays!
  const expected = Math.max(0, first.remainingDays! - elapsed)
  if (last.remainingDays === expected) return
  return { status: 'conflict', reason: `同一截止事项“${right.deadlineKey}”：从“${right.timeAnchor}”计时，两处相隔 ${elapsed} 天，由剩余 ${first.remainingDays} 天推得应剩 ${expected} 天，另一处却记为 ${last.remainingDays} 天。` }
}

export function auditBookTimeline(ctx: BookAuditContext): BookAuditFinding[] {
  const findings: BookAuditFinding[] = []
  const byScope = new ReadingIndex(), byPoint = new ReadingIndex()
  const incomplete = new Set<Reading>()
  const covered = new Set<Reading>()
  const chapterIndex = timelineChapterIndex(ctx.data.chapters).get(ctx.projectId)
  const byChapter = new Map<string, TimelineEvent[]>()
  const inRange = (n: number) => n >= ctx.from && n <= ctx.to

  for (const event of ctx.data.timelineEvents) {
    if (event.projectId !== ctx.projectId) continue
    const target = timelineChapterFor(chapterIndex, event.chapterId, event.chapterOrder)
    if (!target) {
      if (event.chapterOrder == null ? ctx.from !== 1 : !inRange(event.chapterOrder)) continue
      const clues = timeClues([event.storyTime, event.result, event.sourceExcerpt].filter(Boolean).join(' '))
      const kinds: TimeKind[] = []
      if (event.season || clues.seasonAt >= 0) kinds.push('season')
      if (event.deadlineKey || event.remainingDays != null || clues.countdownAt >= 0) kinds.push('countdown')
      // Also surface a legacy chapter-number collision for an otherwise unclassified time event.
      if (!kinds.length && event.chapterOrder != null && chapterIndex?.get(event.chapterOrder) === null) kinds.push('season')
      for (const kind of kinds) findings.push({ kind, status: 'needs_evidence', title: `时间线「${event.title}」待绑定章节`,
        ...(event.chapterOrder != null && event.chapterOrder > 0 ? { atChapterOrder: event.chapterOrder } : {}),
        reason: `无法唯一定位${event.chapterOrder == null ? '来源章节' : `原第 ${event.chapterOrder} 章`}，请指定本书的章节；未引用任何一章作为依据。`, evidence: [] })
      continue
    }
    const current = ctx.chapterFor(target.id, null)
    if (!current) continue // Archived, empty or beyond the requested cutoff.
    const events = byChapter.get(current.id) ?? []
    events.push(event)
    byChapter.set(current.id, events)
  }

  const epochs = { era: 0, deadlineEra: 0 }
  const shifts = new Map<string, number>()
  for (const chapter of ctx.chapters) {
    const passages = readTimelinePassages(chapter.body, epochs)
    const used = { season: new Set<number>(), countdown: new Set<number>() }
    const events = byChapter.get(chapter.id) ?? []
    for (const event of events.sort((a, b) => a.narrativeOrder - b.narrativeOrder || a.id.localeCompare(b.id))) {
      const lane = JSON.stringify([event.timelineKey, event.location])
      const shift = event.timeShift ?? timeNoteShift(event.storyTime)
      if (shift === 'time_skip') shifts.set(lane, (shifts.get(lane) ?? 0) + 1)
      for (const kind of ['season', 'countdown'] as const) {
        if (kind === 'season' ? !event.season : event.remainingDays == null && !event.deadlineKey) continue
        const line = locateTimeQuote(event, chapter.body, passages, kind)
        if (line) used[kind].add(line.at)
        if (shift === 'flashback' || line?.flashback) continue
        const missing: string[] = []
        if (!line) missing.push('可唯一定位的本章原句')
        else if (line.uncertain || (kind === 'season' ? line.named.length !== 1 || line.named[0] !== event.season :
          line.countMentions !== 1 || line.days[0] !== event.remainingDays)) missing.push(`能证实所记${labels[kind]}的直述原句`)
        if (!event.timelineKey) missing.push('时间线')
        if (!event.location) missing.push('地点')
        if (!event.timeAnchor) missing.push('共同计时起点')
        if (!isTimelineDay(event.elapsedDays)) missing.push('距起点已过天数')
        if (kind === 'countdown' && !event.deadlineKey) missing.push('截止事项')
        if (kind === 'countdown' && !isTimelineDay(event.remainingDays)) missing.push('剩余天数')
        const scope = event.timelineKey && event.location && (kind === 'season' || event.deadlineKey)
          ? JSON.stringify([kind, lane, shifts.get(lane) ?? 0, line?.era ?? epochs.era,
              ...(kind === 'countdown' ? [event.deadlineKey, line?.deadlineEra ?? epochs.deadlineEra] : [])]) : undefined
        const point = scope && !missing.length ? JSON.stringify([scope, event.timeAnchor, ...(kind === 'season' ? [event.elapsedDays] : [])]) : undefined
        const row: Reading = { event, chapter, kind, missing, scope, point,
          proof: line ? ctx.evidence(chapter, timeExcerpt(line, kind)) : undefined }
        if (missing.length) incomplete.add(row)
        const prior = byPoint.earlier(point, row) ?? byScope.earlier(scope, row)
        if (prior && inRange(chapter.order)) {
          const result = compare(prior, row)
          if (result) {
            const evidence = [prior.proof, row.proof].filter((e): e is BookAuditEvidence => !!e)
            findings.push({ kind, ...result, atChapterOrder: chapter.order,
              title: `第 ${prior.chapter.order}、${chapter.order} 章${labels[kind]}${result.status === 'conflict' ? '矛盾' : '待核'}`, evidence })
            covered.add(prior); covered.add(row)
          }
        }
        if (scope) byScope.remember(scope, row)
        if (point) byPoint.remember(point, row)
      }
    }
    if (!inRange(chapter.order)) continue
    for (const line of passages) {
      for (const kind of ['season', 'countdown'] as const) {
        if ((kind === 'season' ? line.seasonAt : line.countdownAt) < 0 || used[kind].has(line.at)) continue
        findings.push({ kind, status: 'needs_evidence', atChapterOrder: chapter.order, title: `第 ${chapter.order} 章${labels[kind]}线索`,
          reason: '这句现存正文未关联已核实的时间记录，只作为线索，不参与跨章推算。', evidence: [ctx.evidence(chapter, timeExcerpt(line, kind))] })
      }
    }
  }
  for (const row of incomplete) {
    if (covered.has(row) || !inRange(row.chapter.order)) continue
    findings.push({ kind: row.kind, status: 'needs_evidence', atChapterOrder: row.chapter.order, title: `第 ${row.chapter.order} 章「${row.event.title}」待核`,
      reason: `缺${row.missing.join('、')}，不能据此核对${labels[row.kind]}。`, evidence: row.proof ? [row.proof] : [] })
  }
  return findings
}
