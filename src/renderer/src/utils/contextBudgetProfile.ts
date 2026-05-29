import type { ContextBudgetMode, ContextBudgetProfile, ID } from '../../../shared/types'
import { newId, now } from './format'

export function createContextBudgetProfile(
  projectId: ID,
  mode: ContextBudgetMode,
  maxTokens: number,
  name = '临时预算方案'
): ContextBudgetProfile {
  const timestamp = now()
  const isLight = mode === 'light'
  const isFull = mode === 'full'
  return {
    id: newId(),
    projectId,
    name,
    maxTokens,
    mode,
    includeRecentChaptersCount: isLight ? 2 : isFull ? 5 : 3,
    includeStageSummariesCount: isLight ? 0 : isFull ? 8 : 2,
    includeMainCharacters: true,
    includeRelatedCharacters: !isLight,
    includeForeshadowingWeights: isLight ? ['high', 'payoff'] : isFull ? ['low', 'medium', 'high', 'payoff'] : ['medium', 'high', 'payoff'],
    includeTimelineEventsCount: isLight ? 0 : isFull ? 20 : 6,
    styleSampleMaxChars: isLight ? 600 : isFull ? 2000 : 1200,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}
