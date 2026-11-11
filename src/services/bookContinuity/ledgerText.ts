import type { Chapter } from '../../shared/types'
import { taskNumber } from '../chapterTaskContractText'

export interface Passage { text: string; at: number }
export const currency = /^(?:文(?:钱)?|两(?:银子|白银|银)?|元|圆|块钱|铜钱|铜板|银元|银两|金币|银币|铜币|灵石|美元|英镑)$/u
const cashAmount = /(\d+(?:\.\d+)?[千万]?|[零〇一二两三四五六七八九十百千万亿]+)\s*(?:枚|锭)?(文钱|文(?!字|章|书|学)|两(?:银子|白银|银)?|美元|元(?!素|年)|圆|块钱|铜钱|铜板|银元|银两|金币|银币|铜币|灵石|英镑)/gu
export const cashAmounts = (s: string) => Array.from(s.matchAll(cashAmount)).filter(m =>
  m[2] !== '两' || /银钱|银子|现银|碎银|银票|银锭|账|余额|钱袋|盘缠|经费|支付|花了|付了|花去|欠款/u.test(s))
export const crewNumber = /(?:队伍|队里|队中|队内|全队|小队|一行|一队|队员|随行|同行|人数)[^。！？\d零〇一二两三四五六七八九十百千万]{0,10}[\d零〇一二两三四五六七八九十百千万]+\s*(?:个?[人名]|位)/u
export const ownership = /(?:唯一|独一无二|仅此一)[^，。！？]{0,24}(?:持有|保管|归|交给)|(?:持有|保管|拿着|收着|交给)[^，。！？]{0,12}(?:唯一|独一无二)|(?:归|交由)[^，。！？]{1,12}(?:所有|保管)/u
export const promiseWord = /承诺|答应|约定|立誓|发誓|许诺|应允|许下诺言/u
export const whereaboutsWord = /下落(?:不明|待交代)|不知所终|去向不明/u

export function quantitiesIn(text: string, kind: 'money' | 'headcount', unit: string) {
  const printed = kind === 'headcount' ? Array.from(text.matchAll(/(\d+[千万]?|[零〇一二两三四五六七八九十百千万]+)\s*(个人|人|名|位|员)/gu)) : cashAmounts(text)
  const matches = printed.map(m => ({ at: m.index!, raw: m[1], unit: m[2], literal: m[0] }))
  if (kind === 'money' && !matches.length && unit && !currency.test(unit)) {
    for (const m of text.matchAll(/(\d+(?:\.\d+)?[千万]?|[零〇一二两三四五六七八九十百千万]+)\s*/gu)) {
      if (text.startsWith(unit, m.index! + m[0].length)) matches.push({ at: m.index!, raw: m[1], unit, literal: m[0] + unit })
    }
  }
  return matches.map(({ at, raw, unit, literal }) => {
    const prefix = text.slice(0, at)
    const approximate = /(?:至少|至多|大约|大概|约莫|不到|不止|近|超过|约|并非|不是|并无)\s*$/u.test(prefix) ||
      /^(?:左右|上下|有余|以上|以下|不到|至|到)/u.test(text.slice(at + literal.length)) || /[一二两三四五六七八九]{2}/u.test(raw)
    const sign = /[-−负]\s*$/u.test(prefix) ? -1 : 1
    return { at, value: approximate ? NaN : sign * taskNumber(raw), unit, literal }
  })
}

/** Keep a literal UTF-16 offset as the focus but clip by Unicode code points, like ctx.evidence. */
export function excerptAt(ch: Chapter, line: Passage, focus: number): string {
  const chars = Array.from(line.text)
  const count = 144
  if (chars.length > count) {
    const index = Array.from(line.text.slice(0, Math.max(0, focus))).length
    const start = Math.max(0, Math.min(index - 38, chars.length - count))
    return chars.slice(start, start + count).join('')
  }
  if (line.text === ch.body.trim() && chars.length > 1) {
    // Even a one-sentence book need not be returned wholesale.
    if (/[。！？!?」』”’]$/u.test(line.text) || focus === 0) return chars.slice(0, -1).join('')
    return chars.slice(1).join('')
  }
  return line.text
}
