import { DEFAULT_SETTINGS } from '../defaults/index'
import type { ContextBudgetProfile } from '../types'
import { objectOrEmpty, stringValue } from './common'

export function normalizeBudgetProfile(value: unknown, projectId = ''): ContextBudgetProfile {
  const profile = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  return {
    id: stringValue(profile.id) || `budget-${timestamp}`,
    projectId: stringValue(profile.projectId) || projectId,
    name: stringValue(profile.name) || '上下文快照预算',
    maxTokens: typeof profile.maxTokens === 'number' ? profile.maxTokens : DEFAULT_SETTINGS.defaultTokenBudget,
    mode:
      profile.mode === 'light' ||
      profile.mode === 'standard' ||
      profile.mode === 'full' ||
      profile.mode === 'custom'
        ? profile.mode
        : 'standard',
    includeRecentChaptersCount:
      typeof profile.includeRecentChaptersCount === 'number' ? profile.includeRecentChaptersCount : 3,
    includeStageSummariesCount:
      typeof profile.includeStageSummariesCount === 'number' ? profile.includeStageSummariesCount : 2,
    includeMainCharacters:
      typeof profile.includeMainCharacters === 'boolean' ? profile.includeMainCharacters : true,
    includeRelatedCharacters:
      typeof profile.includeRelatedCharacters === 'boolean' ? profile.includeRelatedCharacters : true,
    includeForeshadowingWeights: Array.isArray(profile.includeForeshadowingWeights)
      ? (profile.includeForeshadowingWeights as ContextBudgetProfile['includeForeshadowingWeights'])
      : ['medium', 'high', 'payoff'],
    includeTimelineEventsCount:
      typeof profile.includeTimelineEventsCount === 'number' ? profile.includeTimelineEventsCount : 6,
    styleSampleMaxChars: typeof profile.styleSampleMaxChars === 'number' ? profile.styleSampleMaxChars : 1200,
    createdAt: stringValue(profile.createdAt) || timestamp,
    updatedAt: stringValue(profile.updatedAt) || timestamp
  }
}
