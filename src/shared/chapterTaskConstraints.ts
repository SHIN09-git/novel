import type { ChapterTask } from './types'

export const TASK_TEXT_FIELDS = ['goal', 'conflict', 'suspenseToKeep', 'allowedPayoffs', 'forbiddenPayoffs', 'endingHook', 'readerEmotion', 'targetWordCount', 'styleRequirement'] as const
export const TASK_CONSTRAINT_FIELDS = ['povPolicy', 'storyTimeWindow', 'mustOpenWithBeat'] as const
export const CHAPTER_TASK_FIELDS = [...TASK_TEXT_FIELDS, ...TASK_CONSTRAINT_FIELDS] as const
type Constraints = Pick<ChapterTask, typeof TASK_CONSTRAINT_FIELDS[number]>

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 50_000) throw new Error(`${field} 必须是非空文本，且不超过 50000 字符。`)
  return value.trim()
}

function record(value: unknown, field: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} 必须是对象。`)
  const unknown = Object.keys(value).filter(key => !keys.includes(key))
  if (unknown.length) throw new Error(`${field} 不支持字段：${unknown.join(', ')}。`)
  return value as Record<string, unknown>
}

function readPolicy(value: unknown): NonNullable<Constraints['povPolicy']> {
  const raw = record(value, 'povPolicy', ['mode', 'povCharacterId', 'perceptionChannels'])
  const channels = raw.perceptionChannels
  if (!Array.isArray(channels) || !channels.length) throw new Error('povPolicy.perceptionChannels 至少需要一个感知渠道。')
  return { mode: text(raw.mode, 'povPolicy.mode'), povCharacterId: text(raw.povCharacterId, 'povPolicy.povCharacterId'),
    perceptionChannels: channels.map(channel => text(channel, 'povPolicy.perceptionChannels')) }
}

function readTimeWindow(value: unknown): NonNullable<Constraints['storyTimeWindow']> {
  const raw = record(value, 'storyTimeWindow', ['date', 'weekday', 'range'])
  const date = text(raw.date, 'storyTimeWindow.date')
  const day = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day.getTime()) || !day.toISOString().startsWith(date + 'T')) {
    throw new Error('storyTimeWindow.date 必须是有效的公历日期（YYYY-MM-DD）。')
  }
  const weekday = raw.weekday === undefined ? undefined : text(raw.weekday, 'storyTimeWindow.weekday')
  const expected = '日一二三四五六'[day.getUTCDay()]
  if (weekday && weekday.replace(/^(?:周|星期|礼拜)/, '').replace('天', '日') !== expected) {
    throw new Error(`storyTimeWindow.weekday：${date} 是周${expected}，不是${weekday}。`)
  }
  const range = text(raw.range, 'storyTimeWindow.range')
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  const times = range.split(/\s*(?:->|[-–—~～至到→])\s*/)
  if (times.length !== 2 || !times.every(t => clock.test(t)) || times[1] < times[0]) {
    throw new Error('storyTimeWindow.range 需要同一天内起止有序的时间，如 20:57–20:59。')
  }
  return { date, ...(weekday ? { weekday } : {}), range }
}

// Reads tolerate an invalid optional field without losing the rest of a stored task.
// All authoring boundaries use strict mode before creating snapshots.
export function readTaskConstraints(task: Constraints | Record<string, unknown>, strict = true): Constraints {
  const result: Constraints = {}
  for (const field of TASK_CONSTRAINT_FIELDS) {
    if (task[field] === undefined) continue
    try {
      if (field === 'povPolicy') result.povPolicy = readPolicy(task[field])
      else if (field === 'storyTimeWindow') result.storyTimeWindow = readTimeWindow(task[field])
      else result.mustOpenWithBeat = text(task[field], field)
    } catch (error) { if (strict) throw error }
  }
  return result
}

export function changedTaskFields(before: ChapterTask, after: ChapterTask) {
  // Compare named members, not object identity or the caller's property insertion order.
  return CHAPTER_TASK_FIELDS.filter(field => {
    if (field === 'povPolicy') {
      const a = before[field], b = after[field]
      return a?.mode !== b?.mode || a?.povCharacterId !== b?.povCharacterId || JSON.stringify(a?.perceptionChannels) !== JSON.stringify(b?.perceptionChannels)
    }
    if (field === 'storyTimeWindow') {
      const a = before[field], b = after[field]
      return a?.date !== b?.date || a?.weekday !== b?.weekday || a?.range !== b?.range
    }
    return before[field] !== after[field]
  })
}
