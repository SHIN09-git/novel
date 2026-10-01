import { createEmptyChapterTask } from '../../shared/defaults'
import type { AppData, ChapterTask, ID } from '../../shared/types'
import type { AgentReadDetail, AgentReadOptions } from '../AgentReadableSummaryService'

export function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return undefined
  const normalized = value.trim()
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function temperatureArg(args: Record<string, unknown>, key = 'temperature'): number | undefined {
  if (args[key] === undefined) return undefined
  const value = numberArg(args, key)
  if (value === undefined || value < 0 || value > 2) {
    throw new Error(`${key} must be a number between 0 and 2.`)
  }
  return value
}

export function booleanArg(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true || args[key] === 'true'
}

export function requiredString(args: Record<string, unknown>, key: string): string {
  const value = stringArg(args, key)
  if (!value) throw new Error(`Missing ${key}.`)
  return value
}

export function requiredPositiveInteger(
  args: Record<string, unknown>,
  key: string,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const value = numberArg(args, key)
  if (value === undefined) throw new Error(`Missing or invalid ${key}.`)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${key} must be an integer between 1 and ${maximum}.`)
  }
  return value
}

const CHAPTER_TASK_STRING_FIELDS = [
  'goal',
  'conflict',
  'suspenseToKeep',
  'allowedPayoffs',
  'forbiddenPayoffs',
  'endingHook',
  'readerEmotion',
  'targetWordCount',
  'styleRequirement'
] as const satisfies readonly (keyof ChapterTask)[]

export function chapterTaskArg(
  args: Record<string, unknown>,
  key = 'chapterTask',
  fallback: Partial<ChapterTask> = {}
): ChapterTask | null {
  const value = args[key]
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} must be an object.`)
  }

  const raw = value as Record<string, unknown>
  const allowedFields = new Set<string>(CHAPTER_TASK_STRING_FIELDS)
  const unknownFields = Object.keys(raw).filter((field) => !allowedFields.has(field))
  if (unknownFields.length > 0) throw new Error(`${key} contains unsupported fields: ${unknownFields.join(', ')}.`)
  const task: ChapterTask = { ...createEmptyChapterTask(), ...fallback }
  for (const field of CHAPTER_TASK_STRING_FIELDS) {
    const fieldValue = raw[field]
    if (fieldValue === undefined) continue
    if (typeof fieldValue !== 'string') throw new Error(`${key}.${field} must be a string.`)
    task[field] = fieldValue.trim()
  }
  if (!task.goal) throw new Error(`${key}.goal is required.`)
  return task
}

export function readOptions(args: Record<string, unknown>): AgentReadOptions {
  const detail = stringArg(args, 'detail')
  if (args.detail !== undefined && detail !== 'summary' && detail !== 'compact' && detail !== 'full') {
    throw new Error('detail must be summary, compact, or full.')
  }
  const maxChars = numberArg(args, 'maxChars')
  if (
    args.maxChars !== undefined &&
    (maxChars === undefined || !Number.isSafeInteger(maxChars) || maxChars < 1)
  ) {
    throw new Error('maxChars must be a positive integer.')
  }
  return {
    detail: detail === 'summary' || detail === 'compact' || detail === 'full' ? (detail as AgentReadDetail) : undefined,
    includeProse: booleanArg(args, 'includeProse'),
    includePrompt: booleanArg(args, 'includePrompt'),
    includeDiagnostics: booleanArg(args, 'includeDiagnostics'),
    maxChars
  }
}

export function findProjectId(data: Pick<AppData, 'projects'>, args: Record<string, unknown>): ID {
  const value = stringArg(args, 'projectId') ?? stringArg(args, 'project')
  if (!value) throw new Error('Missing projectId or project.')
  const direct = data.projects.find((project) => project.id === value)
  if (direct) return direct.id
  const byName = data.projects.find((project) => project.name === value)
  if (byName) return byName.id
  throw new Error(`Project not found: ${value}`)
}

export function safeSafetyMode(value: string | undefined): 'conservative' | 'autonomous' | 'experimental' | undefined {
  return value === 'conservative' || value === 'autonomous' || value === 'experimental' ? value : undefined
}

export function safePipelineMode(value: string | undefined): 'conservative' | 'standard' | 'aggressive' | undefined {
  return value === 'conservative' || value === 'standard' || value === 'aggressive' ? value : undefined
}

// approvalToken is an explicit acknowledgement supplied by an orchestrator, not an authentication secret.
export function hasApproval(args: Record<string, unknown>): boolean {
  const token = stringArg(args, 'approvalToken')
  return booleanArg(args, 'confirm') || Boolean(token && token.length >= 8)
}
