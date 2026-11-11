import type { Project } from '../types/project'
import { recordOrEmpty } from './common'

export function normalizeBookWordTarget(value: unknown): Project['bookWordTarget'] {
  const { min, max } = recordOrEmpty(value)
  const isBound = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0
  if ((min != null && !isBound(min)) || (max != null && !isBound(max))) return undefined
  if ((min == null && max == null) || (min != null && max != null && min > max)) return undefined
  return { ...(min == null ? {} : { min }), ...(max == null ? {} : { max }) }
}

export function bookWordGoal(totalWords: number, value: Project['bookWordTarget']) {
  const target = normalizeBookWordTarget(value)
  const min = target?.min ?? null
  const max = target?.max ?? null
  return {
    min, max,
    remainingToMin: min === null ? null : Math.max(0, min - totalWords),
    overMax: max === null ? null : Math.max(0, totalWords - max)
  }
}
