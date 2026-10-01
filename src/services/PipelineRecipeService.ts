import type {
  ChapterGenerationStepType,
  PipelineMode,
  PipelineRecipe,
  PipelineRecipeId,
  PipelineRecipeStep,
  PipelineStepEscalation
} from '../shared/types'

const STEP_ORDER: readonly ChapterGenerationStepType[] = [
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

export type PipelineRecipeInput = PipelineRecipe | PipelineRecipeId | PipelineMode | null | undefined
export type PipelineEscalationSignal = 'none' | 'warning' | 'failure'

export type PipelineStepSkipReasonCode =
  | 'recipe_step_omitted'
  | 'recipe_step_disabled'
  | 'recipe_escalation_not_triggered'

export interface PipelineStepSkipReason {
  code: PipelineStepSkipReasonCode
  recipeId: PipelineRecipeId
  recipeVersion: number
  stepType: ChapterGenerationStepType
  required: boolean
  escalation: PipelineStepEscalation
  signal: PipelineEscalationSignal
  message: string
}

export interface PipelineStepExecutionDecision {
  type: ChapterGenerationStepType
  run: boolean
  configured: boolean
  required: boolean
  escalation: PipelineStepEscalation
  signal: PipelineEscalationSignal
  reason: string
  skipReason: PipelineStepSkipReason | null
}

export interface PipelineExecutionPlan {
  recipe: PipelineRecipe
  steps: PipelineStepExecutionDecision[]
}

interface SerializedPipelineStepSkip extends PipelineStepSkipReason {
  kind: 'pipeline_recipe_step_skipped'
}

export interface ResolvePipelineRunConfigurationInput {
  recipe?: PipelineRecipe | null
  recipeId?: PipelineRecipeId | null
  storedMode?: PipelineMode | null
  requestedMode?: PipelineMode | null
  fallbackMode?: PipelineMode
}

const CORE_REQUIRED_STEPS = new Set<ChapterGenerationStepType>([
  'context_need_planning',
  'context_budget_selection',
  'build_context',
  'generate_chapter_plan',
  'context_need_planning_from_plan',
  'context_budget_selection_delta',
  'rebuild_context_with_plan',
  'generate_chapter_draft',
  'quality_gate',
  'await_user_confirmation'
])

// These are deliberately limited to post-draft advisory work. Fast mode still
// executes context planning, the plan-derived context rebuild, drafting, the
// hard quality gate, and the author confirmation step.
const FAST_ADVISORY_STEPS = new Set<ChapterGenerationStepType>([
  'generate_chapter_review',
  'propose_character_updates',
  'propose_foreshadowing_updates',
  'consistency_review'
])

const FAST_ESCALATION: Partial<Record<ChapterGenerationStepType, PipelineStepEscalation>> = {
  generate_chapter_review: 'on_warning',
  propose_character_updates: 'on_warning',
  propose_foreshadowing_updates: 'on_warning',
  consistency_review: 'on_warning'
}

function recipeIdFromLegacyMode(mode: PipelineMode): PipelineRecipeId {
  if (mode === 'conservative') return 'strict'
  if (mode === 'aggressive') return 'fast'
  return 'standard'
}

function pipelineModeFromRecipeId(id: PipelineRecipeId): PipelineMode {
  if (id === 'fast') return 'aggressive'
  if (id === 'strict') return 'conservative'
  return 'standard'
}

function isRecipeId(value: unknown): value is PipelineRecipeId {
  return value === 'fast' || value === 'standard' || value === 'strict' || value === 'custom'
}

function cloneRecipe(recipe: PipelineRecipe): PipelineRecipe {
  return { ...recipe, steps: recipe.steps.map((step) => ({ ...step })) }
}

function defaultStep(type: ChapterGenerationStepType, id: PipelineRecipeId): PipelineRecipeStep {
  if (id === 'fast') {
    const escalation = FAST_ESCALATION[type] ?? 'never'
    const advisory = FAST_ADVISORY_STEPS.has(type)
    return {
      type,
      enabled: !advisory,
      required: CORE_REQUIRED_STEPS.has(type),
      escalation
    }
  }
  if (id === 'strict') return { type, enabled: true, required: true, escalation: 'never' }
  return {
    type,
    enabled: true,
    required: CORE_REQUIRED_STEPS.has(type),
    escalation: 'never'
  }
}

function createDefault(id: PipelineRecipeId): PipelineRecipe {
  const metadata: Record<PipelineRecipeId, Pick<PipelineRecipe, 'name' | 'description'>> = {
    fast: {
      name: '快速生成',
      description: '运行章节生产核心步骤，包括基于章节计划的二次上下文补全；章节复盘、候选提取和一致性复审仅在出现风险信号时升级执行。'
    },
    standard: {
      name: '标准闭环',
      description: '保留现有完整生产闭环，核心步骤不可跳过，提取与复审步骤允许人工跳过。'
    },
    strict: {
      name: '严格审稿',
      description: '完整运行并要求通过全部十四个步骤，适合高潮、揭露和正式定稿章节。'
    },
    custom: {
      name: '自定义配方',
      description: '以标准闭环为兼容基线，可由调用方覆盖每个步骤的启用、必需和升级策略。'
    }
  }
  const baseId = id === 'custom' ? 'standard' : id
  return {
    id,
    version: 1,
    ...metadata[id],
    steps: STEP_ORDER.map((type) => defaultStep(type, baseId))
  }
}

function normalizeSuppliedRecipe(recipe: PipelineRecipe): PipelineRecipe {
  const id = isRecipeId(recipe.id) ? recipe.id : 'custom'
  const fallback = createDefault(id)
  const suppliedSteps = Array.isArray(recipe.steps) ? recipe.steps : []
  const normalizedSuppliedSteps = suppliedSteps.reduce<PipelineRecipeStep[]>((steps, step) => {
    if (!step || !isStepType(step.type) || steps.some((item) => item.type === step.type)) return steps
    return [
      ...steps,
      {
        type: step.type,
        enabled: step.enabled !== false,
        required: step.required === true,
        escalation:
          step.escalation === 'on_warning' || step.escalation === 'on_failure' ? step.escalation : 'never'
      }
    ]
  }, [])
  if (id === 'custom') {
    return {
      id,
      version: 1,
      name: typeof recipe.name === 'string' && recipe.name.trim() ? recipe.name.trim() : fallback.name,
      description:
        typeof recipe.description === 'string' && recipe.description.trim()
          ? recipe.description.trim()
          : fallback.description,
      // A custom recipe is a frozen allow-list. Missing steps are intentionally
      // not filled from standard, otherwise the recipe would not be executable
      // as authored.
      steps: normalizedSuppliedSteps
    }
  }
  const suppliedByType = new Map(normalizedSuppliedSteps.map((step) => [step.type, step]))
  return {
    id,
    version: 1,
    name: typeof recipe.name === 'string' && recipe.name.trim() ? recipe.name.trim() : fallback.name,
    description:
      typeof recipe.description === 'string' && recipe.description.trim()
        ? recipe.description.trim()
        : fallback.description,
    steps: STEP_ORDER.map((type) => {
      const supplied = suppliedByType.get(type)
      if (!supplied) return fallback.steps.find((step) => step.type === type)!
      return { ...supplied }
    })
  }
}

function isStepType(value: unknown): value is ChapterGenerationStepType {
  return STEP_ORDER.includes(value as ChapterGenerationStepType)
}

function parseSerializedSkipOutput(output: unknown): PipelineStepSkipReason | null {
  if (typeof output !== 'string' || !output.trim().startsWith('{')) return null
  try {
    const value = JSON.parse(output) as Partial<SerializedPipelineStepSkip>
    if (
      value.kind !== 'pipeline_recipe_step_skipped' ||
      !isRecipeId(value.recipeId) ||
      !isStepType(value.stepType) ||
      (value.code !== 'recipe_step_omitted' &&
        value.code !== 'recipe_step_disabled' &&
        value.code !== 'recipe_escalation_not_triggered') ||
      (value.escalation !== 'never' && value.escalation !== 'on_warning' && value.escalation !== 'on_failure') ||
      (value.signal !== 'none' && value.signal !== 'warning' && value.signal !== 'failure') ||
      typeof value.required !== 'boolean' ||
      typeof value.recipeVersion !== 'number' ||
      typeof value.message !== 'string'
    ) return null
    return {
      code: value.code,
      recipeId: value.recipeId,
      recipeVersion: value.recipeVersion,
      stepType: value.stepType,
      required: value.required,
      escalation: value.escalation,
      signal: value.signal,
      message: value.message
    }
  } catch {
    return null
  }
}

function escalationTriggered(escalation: PipelineStepEscalation, signal: PipelineEscalationSignal): boolean {
  if (escalation === 'on_failure') return signal === 'failure'
  if (escalation === 'on_warning') return signal === 'warning' || signal === 'failure'
  return false
}

function decisionForStep(
  recipe: PipelineRecipe,
  stepType: ChapterGenerationStepType,
  signal: PipelineEscalationSignal
): PipelineStepExecutionDecision {
  const configuredStep = recipe.steps.find((step) => step.type === stepType)
  if (!configuredStep) {
    const skipReason: PipelineStepSkipReason = {
      code: 'recipe_step_omitted',
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      stepType,
      required: false,
      escalation: 'never',
      signal,
      message: `自定义配方未包含${stepType}，按冻结 recipe.steps 跳过。`
    }
    return {
      type: stepType,
      run: false,
      configured: false,
      required: false,
      escalation: 'never',
      signal,
      reason: skipReason.message,
      skipReason
    }
  }
  if (configuredStep.enabled) {
    return {
      type: stepType,
      run: true,
      configured: true,
      required: configuredStep.required,
      escalation: configuredStep.escalation,
      signal,
      reason: `${recipe.name}已启用${stepType}。`,
      skipReason: null
    }
  }
  if (escalationTriggered(configuredStep.escalation, signal)) {
    return {
      type: stepType,
      run: true,
      configured: true,
      required: configuredStep.required,
      escalation: configuredStep.escalation,
      signal,
      reason: `${stepType}收到${signal}信号，触发${configuredStep.escalation}升级执行。`,
      skipReason: null
    }
  }
  const code: PipelineStepSkipReasonCode = configuredStep.escalation === 'never'
    ? 'recipe_step_disabled'
    : 'recipe_escalation_not_triggered'
  const skipReason: PipelineStepSkipReason = {
    code,
    recipeId: recipe.id,
    recipeVersion: recipe.version,
    stepType,
    required: configuredStep.required,
    escalation: configuredStep.escalation,
    signal,
    message: configuredStep.escalation === 'never'
      ? `${recipe.name}已关闭${stepType}，按配方跳过。`
      : `${recipe.name}未收到${configuredStep.escalation === 'on_failure' ? '失败' : '警告或失败'}信号，按常规路径跳过${stepType}。`
  }
  return {
    type: stepType,
    run: false,
    configured: true,
    required: configuredStep.required,
    escalation: configuredStep.escalation,
    signal,
    reason: skipReason.message,
    skipReason
  }
}

export class PipelineRecipeService {
  static getDefaultRecipe(id: PipelineRecipeId): PipelineRecipe {
    return cloneRecipe(createDefault(id))
  }

  static resolveRecipe(input?: PipelineRecipeInput, legacyMode: PipelineMode = 'standard'): PipelineRecipe {
    if (input && typeof input === 'object') return cloneRecipe(normalizeSuppliedRecipe(input))
    const id = input === 'conservative' || input === 'aggressive'
      ? recipeIdFromLegacyMode(input)
      : input === 'fast' || input === 'strict' || input === 'custom' || input === 'standard'
        ? input
        : recipeIdFromLegacyMode(legacyMode)
    return PipelineRecipeService.getDefaultRecipe(id)
  }

  static recipeIdForLegacyMode(mode: PipelineMode): PipelineRecipeId {
    return recipeIdFromLegacyMode(mode)
  }

  static pipelineModeForRecipe(id: PipelineRecipeId): PipelineMode {
    return pipelineModeFromRecipeId(id)
  }

  static resolveRunConfiguration(input: ResolvePipelineRunConfigurationInput): {
    pipelineMode: PipelineMode
    pipelineRecipe: PipelineRecipe
  } {
    const frozenRecipeInput = input.recipe ?? input.recipeId
    const inferredStoredMode = frozenRecipeInput
      ? pipelineModeFromRecipeId(PipelineRecipeService.resolveRecipe(frozenRecipeInput).id)
      : null
    const pipelineMode = input.requestedMode ?? input.storedMode ?? inferredStoredMode ?? input.fallbackMode ?? 'standard'
    const pipelineRecipe = input.requestedMode
      ? PipelineRecipeService.resolveRecipe(undefined, pipelineMode)
      : PipelineRecipeService.resolveRecipe(frozenRecipeInput, pipelineMode)
    return { pipelineMode, pipelineRecipe }
  }

  static shouldRunStep(
    recipeInput: PipelineRecipeInput,
    stepType: ChapterGenerationStepType,
    signal: PipelineEscalationSignal = 'none',
    legacyMode: PipelineMode = 'standard'
  ): boolean {
    return PipelineRecipeService.resolveStepExecution(recipeInput, stepType, signal, legacyMode).run
  }

  static resolveStepExecution(
    recipeInput: PipelineRecipeInput,
    stepType: ChapterGenerationStepType,
    signal: PipelineEscalationSignal = 'none',
    legacyMode: PipelineMode = 'standard'
  ): PipelineStepExecutionDecision {
    return decisionForStep(PipelineRecipeService.resolveRecipe(recipeInput, legacyMode), stepType, signal)
  }

  static resolveExecutionPlan(
    recipeInput: PipelineRecipeInput,
    legacyMode: PipelineMode = 'standard',
    signals: Partial<Record<ChapterGenerationStepType, PipelineEscalationSignal>> = {}
  ): PipelineExecutionPlan {
    const recipe = PipelineRecipeService.resolveRecipe(recipeInput, legacyMode)
    return {
      recipe,
      steps: STEP_ORDER.map((type) => decisionForStep(recipe, type, signals[type] ?? 'none'))
    }
  }

  static serializeSkipOutput(decision: PipelineStepExecutionDecision): string {
    if (!decision.skipReason) throw new Error(`Cannot serialize a non-skipped step: ${decision.type}`)
    return JSON.stringify({
      kind: 'pipeline_recipe_step_skipped',
      ...decision.skipReason
    })
  }

  static parseSkipOutput(output: unknown): PipelineStepSkipReason | null {
    return parseSerializedSkipOutput(output)
  }

  static isSkipOutput(output: unknown): boolean {
    return parseSerializedSkipOutput(output) !== null
  }

  static explainRecipe(
    recipeInput: PipelineRecipeInput,
    legacyMode: PipelineMode = 'standard',
    executionPlan?: PipelineExecutionPlan
  ): string {
    const recipe = executionPlan?.recipe ?? PipelineRecipeService.resolveRecipe(recipeInput, legacyMode)
    const enabled = recipe.steps.filter((step) => step.enabled).length
    const required = recipe.steps.filter((step) => step.required).length
    const escalated = recipe.steps.filter((step) => !step.enabled && step.escalation !== 'never')
    const escalationText = escalated.length
      ? `风险升级步骤：${escalated.map((step) => step.type).join('、')}`
      : '无风险升级步骤'
    const skipped = executionPlan?.steps.filter((step) => !step.run) ?? []
    const skippedText = skipped.length
      ? ` 本次解析跳过：${skipped.map((step) => `${step.type}（${step.skipReason?.code ?? 'unknown'}）`).join('、')}。跳过原因详情：${JSON.stringify(skipped.map((step) => step.skipReason))}`
      : ''
    return `${recipe.name}（${recipe.id} v${recipe.version}）：默认运行 ${enabled}/14 步，其中 ${required} 步为必需；${escalationText}。${recipe.description}${skippedText}`
  }
}
