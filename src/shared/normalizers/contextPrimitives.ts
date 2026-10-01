import type {
  ContextDecisionReasonCode,
  ContextNeedPriority,
  ContextNeedSourceHint,
  ContextSelectionMode
} from '../types'
import { stringValue } from './common'

const CONTEXT_DECISION_REASON_CODES: ContextDecisionReasonCode[] = [
  'required_need',
  'manual_selection',
  'task_relevance',
  'recency',
  'related_context',
  'profile_default',
  'budget_exceeded',
  'low_relevance',
  'compressed_replacement',
  'forbidden',
  'manual_exclusion',
  'prompt_limit',
  'profile_filter',
  'status_ineligible',
  'snapshot_locked',
  'missing_source',
  'not_available',
  'unknown'
]

const CONTEXT_NEED_SOURCE_HINTS: ContextNeedSourceHint[] = [
  'character',
  'character_state',
  'foreshadowing',
  'timeline',
  'stageSummary',
  'hardCanon',
  'storyDirection',
  'chapterEnding',
  'recentChapter',
  'worldbuilding',
  'unknown'
]

export function normalizeContextNeedPriority(value: unknown): ContextNeedPriority {
  return value === 'must' || value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

export function normalizeContextDecisionReasonCode(value: unknown): ContextDecisionReasonCode {
  return CONTEXT_DECISION_REASON_CODES.includes(value as ContextDecisionReasonCode)
    ? (value as ContextDecisionReasonCode)
    : 'unknown'
}

export function normalizeContextSelectionMode(value: unknown): ContextSelectionMode {
  return value === 'explicit' || value === 'prompt_snapshot' ? value : 'automatic'
}

export function normalizeContextNeedSourceHint(value: unknown): ContextNeedSourceHint {
  const hint = stringValue(value)
  return CONTEXT_NEED_SOURCE_HINTS.includes(hint as ContextNeedSourceHint)
    ? (hint as ContextNeedSourceHint)
    : 'unknown'
}
