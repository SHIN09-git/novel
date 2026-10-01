import type {
  AppSettings,
  ChapterGenerationStepType,
  PipelineAIRole,
  PipelineAIRoleConfigs,
  PipelineAIRunConfig,
  PipelineRecipeId,
  ResolvedPipelineAIRunConfig
} from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/defaults/index'
import { normalizePipelineAIModelConfig, normalizePipelineAIRoleConfigs, normalizePipelineAIRunConfig } from '../shared/normalizers/pipelineRunConfig'

export function createPipelineAIRunConfig(
  settings: AppSettings,
  roleConfigs: PipelineAIRoleConfigs = settings.pipelineModelRoles ?? {}
): ResolvedPipelineAIRunConfig {
  const base = normalizePipelineAIModelConfig(settings, DEFAULT_SETTINGS)
  return normalizePipelineAIRunConfig({ ...base, schemaVersion: 1, roles: roleConfigs }, base)!
}

export function resolvePipelineRunSettings(
  config: PipelineAIRunConfig | null | undefined,
  fallback: AppSettings,
  role?: PipelineAIRole
): AppSettings {
  // Existing runs inherit only their frozen base, not today's global role overrides.
  const snapshot = normalizePipelineAIRunConfig(config, DEFAULT_SETTINGS) ?? createPipelineAIRunConfig(fallback)
  const modelConfig = role ? snapshot.roles[role] : normalizePipelineAIModelConfig(snapshot, DEFAULT_SETTINGS)
  return {
    ...fallback,
    ...modelConfig,
    pipelineModelRoles: normalizePipelineAIRoleConfigs(snapshot.roles),
    apiKey: '',
    hasApiKey: fallback.hasApiKey
  }
}

export function resolvePipelineRoleSettings(
  config: PipelineAIRunConfig | null | undefined,
  fallback: AppSettings,
  role: PipelineAIRole
): AppSettings {
  return resolvePipelineRunSettings(config, fallback, role)
}

const PIPELINE_STEP_ROLES: Partial<Record<ChapterGenerationStepType, PipelineAIRole>> = {
  generate_chapter_plan: 'planner',
  generate_chapter_draft: 'prose',
  generate_chapter_review: 'extraction',
  propose_character_updates: 'extraction',
  propose_foreshadowing_updates: 'extraction',
  consistency_review: 'reviewer',
  quality_gate: 'reviewer'
}

/** Shared role contract for UI, Agent Runtime, trace validation, and retries. */
export function getPipelineRoleForStep(
  stepType: ChapterGenerationStepType | 'revision_candidate'
): PipelineAIRole | null {
  return stepType === 'revision_candidate' ? 'revision' : PIPELINE_STEP_ROLES[stepType] ?? null
}

/** Expected logical provider calls on the healthy path; transport retries are counted inside each call. */
export function getPipelineLogicalCallBudget(recipe: PipelineRecipeId): number {
  if (recipe === 'fast') return 3
  if (recipe === 'strict') return 5
  return 4
}
