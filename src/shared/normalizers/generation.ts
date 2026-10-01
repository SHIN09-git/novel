import type {
  ChapterGenerationStepType,
  ChapterTask,
  ChapterTaskEdit,
  PipelineMode,
  PipelineRecipe,
  PipelineRecipeId,
  PipelineRecipeStep,
  PipelineRecipeVersion,
  PipelineStepEscalation
} from '../types'
import { createEmptyChapterTask } from '../defaults/index'
import { objectOrEmpty, stringArrayValue, stringValue } from './common'

export function normalizeChapterTask(value: unknown): ChapterTask {
  const task = objectOrEmpty(value)
  return {
    goal: stringValue(task.goal),
    conflict: stringValue(task.conflict),
    suspenseToKeep: stringValue(task.suspenseToKeep),
    allowedPayoffs: stringValue(task.allowedPayoffs),
    forbiddenPayoffs: stringValue(task.forbiddenPayoffs),
    endingHook: stringValue(task.endingHook),
    readerEmotion: stringValue(task.readerEmotion),
    targetWordCount: stringValue(task.targetWordCount) || createEmptyChapterTask().targetWordCount,
    styleRequirement: stringValue(task.styleRequirement)
  }
}

export function normalizeChapterTaskEdit(value: unknown): ChapterTaskEdit | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const edit = objectOrEmpty(value)
  const fields = Object.keys(createEmptyChapterTask())
  return {
    sourceJobId: stringValue(edit.sourceJobId) || null,
    sourcePromptContextSnapshotId: stringValue(edit.sourcePromptContextSnapshotId) || null,
    changedFields: [...new Set(stringArrayValue(edit.changedFields))].filter((field): field is keyof ChapterTask => fields.includes(field)),
    scope: edit.scope === 'expression' || edit.scope === 'budget' ? edit.scope : 'context',
    resumeStep: edit.resumeStep === 'generate_chapter_draft' ? edit.resumeStep : 'generate_chapter_plan',
    reusableArtifacts: stringArrayValue(edit.reusableArtifacts),
    warnings: stringArrayValue(edit.warnings)
  }
}

const STEP_TYPES: readonly ChapterGenerationStepType[] = [
  'context_need_planning',
  'context_budget_selection',
  'build_context',
  'generate_chapter_plan',
  'context_need_planning_from_plan',
  'context_budget_selection_delta',
  'rebuild_context_with_plan',
  'generate_chapter_draft',
  'generate_chapter_review',
  'propose_character_updates',
  'propose_foreshadowing_updates',
  'consistency_review',
  'quality_gate',
  'await_user_confirmation'
]

const RECIPE_IDS: readonly PipelineRecipeId[] = ['fast', 'standard', 'strict', 'custom']
const ESCALATIONS: readonly PipelineStepEscalation[] = ['never', 'on_warning', 'on_failure']
const RECIPE_NAMES: Record<PipelineRecipeId, string> = {
  fast: '快速生成',
  standard: '标准闭环',
  strict: '严格审稿',
  custom: '自定义流水线配方'
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function pipelineRecipeIdFromLegacyMode(mode: PipelineMode | null | undefined): PipelineRecipeId {
  if (mode === 'conservative') return 'strict'
  if (mode === 'aggressive') return 'fast'
  return 'standard'
}

export function normalizePipelineMode(value: unknown): PipelineMode | null {
  return value === 'conservative' || value === 'standard' || value === 'aggressive' ? value : null
}

export function normalizePipelineRecipeId(value: unknown, legacyMode?: PipelineMode | null): PipelineRecipeId {
  return RECIPE_IDS.includes(value as PipelineRecipeId)
    ? (value as PipelineRecipeId)
    : pipelineRecipeIdFromLegacyMode(legacyMode)
}

export function normalizePipelineRecipeVersion(_value: unknown): PipelineRecipeVersion {
  return 1
}

function normalizeStep(value: unknown): PipelineRecipeStep | null {
  const step = objectValue(value)
  if (!STEP_TYPES.includes(step.type as ChapterGenerationStepType)) return null
  const escalation = ESCALATIONS.includes(step.escalation as PipelineStepEscalation)
    ? (step.escalation as PipelineStepEscalation)
    : 'never'
  return {
    type: step.type as ChapterGenerationStepType,
    enabled: step.enabled !== false,
    required: step.required === true,
    escalation
  }
}

/**
 * Normalizes a persisted recipe when present. Missing recipes remain null so
 * callers can deterministically resolve them from the legacy PipelineMode.
 */
export function normalizePipelineRecipe(value: unknown, legacyMode?: PipelineMode | null): PipelineRecipe | null {
  const recipe = objectValue(value)
  if (Object.keys(recipe).length === 0) return null
  const normalizedSteps = Array.isArray(recipe.steps)
    ? recipe.steps.map(normalizeStep).filter((step): step is PipelineRecipeStep => Boolean(step))
    : []
  const stepsByType = new Map(normalizedSteps.map((step) => [step.type, step]))
  const steps = STEP_TYPES.filter((type) => stepsByType.has(type)).map((type) => ({ ...stepsByType.get(type)! }))
  const id = normalizePipelineRecipeId(recipe.id, legacyMode)
  return {
    id,
    version: normalizePipelineRecipeVersion(recipe.version),
    name: typeof recipe.name === 'string' && recipe.name.trim() ? recipe.name.trim() : RECIPE_NAMES[id],
    description: typeof recipe.description === 'string' ? recipe.description.trim() : '',
    steps
  }
}

export function normalizePipelineRecipeReference(
  value: unknown,
  legacyMode?: PipelineMode | null
): {
  pipelineRecipeId: PipelineRecipeId
  pipelineRecipeVersion: PipelineRecipeVersion
  pipelineRecipe: PipelineRecipe | null
} {
  const record = objectValue(value)
  const effectiveLegacyMode = normalizePipelineMode(legacyMode) ?? normalizePipelineMode(record.pipelineMode)
  const recipe = normalizePipelineRecipe(record.pipelineRecipe, effectiveLegacyMode)
  const fallbackId = effectiveLegacyMode
    ? pipelineRecipeIdFromLegacyMode(effectiveLegacyMode)
    : normalizePipelineRecipeId(record.pipelineRecipeId)
  return {
    // A null recipe means no historical recipe snapshot exists. In that case
    // the recovered legacy mode is more authoritative than a previously
    // synthesized compatibility id.
    pipelineRecipeId: recipe?.id ?? fallbackId,
    pipelineRecipeVersion: recipe?.version ?? normalizePipelineRecipeVersion(record.pipelineRecipeVersion),
    pipelineRecipe: recipe
  }
}
