import type { TimelineEvent } from '../../shared/types'
import { clauses, merged, overlaps, quotationSpans } from '../hardCanonAudit/text'
import { taskNumber } from '../chapterTaskContractText'

type Season = NonNullable<TimelineEvent['season']>
export type TimeKind = 'season' | 'countdown'
export const seasonNames: Record<Season, string> = { spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季' }
const seasons: Record<Season, RegExp> = {
  spring: /春[天季日]|[早初仲暮晚深开新立]春|春暖花开/u,
  summer: /夏[天季日]|[初仲盛炎暑暮晚立]夏/u,
  autumn: /秋[天季日]|[初仲深金暮晚立]秋/u,
  winter: /冬[天季日]|[初仲深寒隆严暮立]冬/u
}
const remaining = /(?:倒计时(?:尚余|还剩|[:：为是])?|还剩(?:下)?|只剩(?:下)?|仅剩(?:下)?|尚剩|剩余|尚余|仅余|还有|尚有|只余|剩下)\s*([零〇一二两三四五六七八九十百千万\d]+)\s*(?:整天|天|日)/gu
const deadlineClue = /倒计时|(?:期限|大限|截止|到期)(?:已至|将至|还剩|为|只剩|日)|[零〇一二两三四五六七八九十百千万\d]+[天日](?:内|之内|后到期|后截止|为限)/u
const jump = /跨(?:季|年)|季节交替|转眼(?:已|便|到了?|就是)|时隔|来年|次年|翌年|来到了?[春夏秋冬]季|[春夏秋冬]去[春夏秋冬]来|(?:入[春夏秋冬]|[春夏秋冬]至|立[春夏秋冬])(?:了|时|之日|当天|之?后|之际|[，。；]|$)|[零〇半一两三四五六七八九十百千数几多\d]+个?(?:年|月|季)(?:之?后|过去)|(?:过了|过去了|一晃|转眼过了)[零〇半一两三四五六七八九十百千数几多\d]+个?(?:年|月|季)/u
const reschedule = /延期|改期|宽限|展期|重新(?:开始)?计时|重置.{0,5}倒计时|(?:期限|截止日?).{0,6}(?:延长|提前|推迟|顺延|取消)|(?:延长|推迟|顺延|取消).{0,6}(?:期限|截止)/u
const recollection = /回忆|回想|闪回|倒叙|梦中|梦里|往年|当年|年前|小时候|[零〇一两三四五六七八九十百千数几多\d]+个?(?:月|天|日|时辰)前/u
const present = /回到(?:眼前|现实|现在)|回过神|回忆结束|梦醒/u
const nonAssertion = /(?:并非|并不|不是|不再是|还没|尚未|并未|没有|并无|未到|不可能|不到|不止|不只|至少|至多|大约|大概|约莫|宛如|犹如|好比|仿佛|倘若|要不是|错以为|误以为|据传|明年|去年|上个|上一年|传闻)/u

export function timeClues(text: string) {
  const named = (Object.keys(seasons) as Season[]).filter((key) => seasons[key].test(text))
  const counts = [...text.matchAll(remaining)]
  const days = counts.flatMap(m => {
    // Approximate amounts and ranges are clues, never exact countdowns.
    if (/[一二两三四五六七八九]{2}/u.test(m[1]) || /^(?:半|多|左右|上下|以上|以下|至|到)/u.test(text.slice(m.index! + m[0].length))) return []
    const n = taskNumber(m[1])
    return Number.isSafeInteger(n) ? [n] : []
  })
  const deadline = deadlineClue.exec(text)
  return { named, days, seasonAt: named.length ? text.search(seasons[named[0]]) : -1,
    countdownAt: counts[0]?.index ?? deadline?.index ?? -1, countMentions: counts.length }
}

export function timeNoteShift(note: string) {
  if (recollection.test(note) && !present.test(note)) return 'flashback'
  if (jump.test(note)) return 'time_skip'
}

export interface TimelinePassage extends ReturnType<typeof timeClues> {
  text: string; at: number; uncertain: boolean; flashback: boolean; era: number; deadlineEra: number
}

export function readTimelinePassages(body: string, epochs: { era: number; deadlineEra: number }): TimelinePassage[] {
  const passages: TimelinePassage[] = []
  const uncertain = merged(clauses(body, quotationSpans(body)).filter(c => c.uncertain))
  let flashback = false
  for (const m of body.matchAll(/[^\s。！？!?；;][^\r\n。！？!?；;]*[。！？!?；;]*[”’」』"]*/gu)) {
    const text = m[0].trimEnd(), at = m.index!
    if (present.test(text)) flashback = false
    else if (recollection.test(text)) flashback = true
    const indirect = overlaps(uncertain, { start: at, end: at + text.length }) || nonAssertion.test(text)
    if (!indirect && jump.test(text)) epochs.era++
    if (!indirect && reschedule.test(text)) epochs.deadlineEra++
    const clues = timeClues(text)
    // Keep even clue-free sentences: an author's surviving quote can no longer support the annotated value.
    passages.push({ ...clues, text, at, uncertain: indirect, flashback, ...epochs })
  }
  return passages
}

export function locateTimeQuote(event: TimelineEvent, body: string, passages: TimelinePassage[], kind: TimeKind) {
  // An explicit stale quote is not interchangeable with another mention of the same season or number.
  const quotes = event.sourceExcerpt ? [event.sourceExcerpt] : [event.storyTime, event.result]
  for (const quote of quotes) {
    if (!quote?.trim()) continue
    const clue = timeClues(quote)
    if ((kind === 'season' ? clue.seasonAt : clue.countdownAt) < 0) continue
    const at = body.indexOf(quote)
    if (at < 0 || body.indexOf(quote, at + 1) >= 0) continue
    const end = at + quote.length
    const lines = passages.filter(p => {
      if (end <= p.at || at >= p.at + p.text.length) return false
      if (at >= p.at && end <= p.at + p.text.length) return true
      const overlap = timeClues(p.text.slice(Math.max(0, at - p.at), end - p.at))
      return (kind === 'season' ? overlap.seasonAt : overlap.countdownAt) >= 0
    })
    if (lines.length === 1) return lines[0]
  }
}

export function timeExcerpt(p: TimelinePassage, kind: TimeKind) {
  // Keep the clue inside the shared evidence display limit, even in a very long unbroken sentence.
  const at = kind === 'season' ? p.seasonAt : p.countdownAt
  const start = Math.max(0, Math.min(at - 45, p.text.length - 150))
  return p.text.slice(start, start + 150)
}
