import type { Foreshadowing, ForeshadowingWeight } from '../../../shared/types'

export const FORESHADOWING_WEIGHT_ORDER: Record<ForeshadowingWeight, number> = {
  payoff: 4,
  high: 3,
  medium: 2,
  low: 1
}

export function archivedForeshadowingRank(item: Foreshadowing): number {
  return item.status === 'resolved' || item.status === 'abandoned' ? 1 : 0
}

export function compareForeshadowingByStatusWeightUpdatedAt(a: Foreshadowing, b: Foreshadowing): number {
  const archiveDelta = archivedForeshadowingRank(a) - archivedForeshadowingRank(b)
  if (archiveDelta !== 0) return archiveDelta
  const weightDelta = FORESHADOWING_WEIGHT_ORDER[b.weight] - FORESHADOWING_WEIGHT_ORDER[a.weight]
  if (weightDelta !== 0) return weightDelta
  return b.updatedAt.localeCompare(a.updatedAt)
}
