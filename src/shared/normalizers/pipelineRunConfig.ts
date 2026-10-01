import type {
  PipelineAIModelConfig,
  PipelineAIRole,
  PipelineAIRoleConfigs,
  ResolvedPipelineAIRunConfig
} from '../types/generation'

export const PIPELINE_AI_ROLES: readonly PipelineAIRole[] = Object.freeze([
  'planner', 'prose', 'extraction', 'reviewer', 'revision'
])

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Never spread external settings: credentials and unknown nested properties are not configuration. */
export function normalizePipelineAIModelOverride(value: unknown): Partial<PipelineAIModelConfig> {
  const raw = objectValue(value)
  const result: Partial<PipelineAIModelConfig> = {}
  if (raw.apiProvider === 'openai' || raw.apiProvider === 'compatible' || raw.apiProvider === 'local' || raw.apiProvider === 'codex_cli') {
    result.apiProvider = raw.apiProvider
  }
  for (const field of ['baseUrl', 'modelName', 'codexCliPath', 'codexCliModel'] as const) {
    if (typeof raw[field] === 'string') result[field] = raw[field]
  }
  for (const field of ['temperature', 'maxTokens', 'maxRetries', 'requestTimeoutMs'] as const) {
    const number = raw[field]
    if (typeof number !== 'number' || !Number.isFinite(number)) continue
    if (field === 'temperature' && number >= 0 && number <= 2) result[field] = number
    if (field === 'maxRetries' && Number.isInteger(number) && number >= 0) result[field] = number
    if ((field === 'maxTokens' || field === 'requestTimeoutMs') && Number.isInteger(number) && number > 0) result[field] = number
  }
  if (typeof raw.retryEnabled === 'boolean') result.retryEnabled = raw.retryEnabled
  return result
}

export function normalizePipelineAIRoleConfigs(value: unknown): PipelineAIRoleConfigs {
  const raw = objectValue(value)
  const result: PipelineAIRoleConfigs = {}
  for (const role of PIPELINE_AI_ROLES) {
    const override = normalizePipelineAIModelOverride(raw[role])
    if (Object.keys(override).length) result[role] = override
  }
  return result
}

export function normalizePipelineAIModelConfig(value: unknown, fallback: PipelineAIModelConfig): PipelineAIModelConfig {
  // Explicit fallback fields also protect callers passing an AppSettings object with an apiKey.
  return {
    apiProvider: fallback.apiProvider,
    baseUrl: fallback.baseUrl,
    modelName: fallback.modelName,
    codexCliPath: fallback.codexCliPath,
    codexCliModel: fallback.codexCliModel,
    temperature: fallback.temperature,
    maxTokens: fallback.maxTokens,
    retryEnabled: fallback.retryEnabled,
    maxRetries: fallback.maxRetries,
    requestTimeoutMs: fallback.requestTimeoutMs,
    ...normalizePipelineAIModelOverride(value)
  }
}

export function normalizePipelineAIRunConfig(value: unknown, fallback: PipelineAIModelConfig): ResolvedPipelineAIRunConfig | null {
  const raw = objectValue(value)
  if (!Object.keys(raw).length) return null
  const base = normalizePipelineAIModelConfig(raw, fallback)
  // Preserve the former default-timeout migration only for legacy snapshots.
  if (raw.schemaVersion !== 1 && base.requestTimeoutMs === 120_000) base.requestTimeoutMs = fallback.requestTimeoutMs
  const overrides = normalizePipelineAIRoleConfigs(raw.roles)
  const roles = {} as Record<PipelineAIRole, Readonly<PipelineAIModelConfig>>
  for (const role of PIPELINE_AI_ROLES) roles[role] = Object.freeze(normalizePipelineAIModelConfig(overrides[role], base))
  return Object.freeze({ ...base, schemaVersion: 1, roles: Object.freeze(roles) })
}
