import type {
  AppData,
  ConsistencyReviewIssue,
  ContextBudgetProfile,
  ContextSelectionResult,
  Project,
  RevisionRequestType
} from '../../../../shared/types'
import { safeParseJson } from '../../../../services/AIJsonParser'
import { now } from '../../utils/format'

export function updateProjectTimestamp(data: AppData, projectId: string): Project[] {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: now() } : project))
}

export function consistencyIssueToRevisionType(issue: ConsistencyReviewIssue): RevisionRequestType {
  if (issue.type === 'timeline_conflict' || issue.type === 'previous_chapter_contradiction' || issue.type === 'continuity_gap') return 'fix_continuity'
  if (issue.type === 'worldbuilding_conflict' || issue.type === 'geography_or_physics_conflict') return 'fix_worldbuilding'
  if (issue.type === 'character_knowledge_leak') return 'fix_character_knowledge'
  if (issue.type === 'character_motivation_gap') return 'strengthen_conflict'
  if (issue.type === 'character_ooc') return 'fix_ooc'
  if (issue.type === 'foreshadowing_misuse' || issue.type === 'foreshadowing_leak') return 'fix_foreshadowing'
  return 'custom'
}

export function consistencyRevisionInstruction(issue: ConsistencyReviewIssue): string {
  return (
    issue.revisionInstruction ||
    [issue.description, issue.suggestedFix].filter(Boolean).join('\n修订目标：') ||
    '修复该一致性问题，同时不得改动无关剧情、不得引入新设定、不得破坏角色状态和伏笔 treatmentMode。'
  )
}

export function contextFromBuildContextOutput(output: string): string {
  const parsed = safeParseJson<{ finalPrompt?: string; context?: string }>(output, 'pipeline build_context output')
  if (parsed.ok && typeof parsed.data.finalPrompt === 'string' && parsed.data.finalPrompt.trim()) return parsed.data.finalPrompt
  if (parsed.ok && typeof parsed.data.context === 'string' && parsed.data.context.trim()) return parsed.data.context
  return output.trim()
}

export function budgetSelectionFromStepOutput(output: string): { profile: ContextBudgetProfile | null; selection: ContextSelectionResult | null } {
  const parsed = safeParseJson<{ profile?: ContextBudgetProfile; selection?: ContextSelectionResult }>(output, 'pipeline budget selection output')
  if (!parsed.ok) return { profile: null, selection: null }
  return {
    profile: parsed.data.profile ?? null,
    selection: parsed.data.selection ?? null
  }
}
