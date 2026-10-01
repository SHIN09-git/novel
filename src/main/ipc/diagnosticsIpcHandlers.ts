import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc/ipcChannels'
import type {
  DiagnosticsAnalyzeRedundancyRequest,
  DiagnosticsAnalyzeRedundancyResult,
  DiagnosticsAuditNoveltyRequest,
  DiagnosticsAuditNoveltyResult,
  DiagnosticsEvaluateQualityGateRequest,
  DiagnosticsEvaluateQualityGateResult
} from '../../shared/ipc/ipcTypes'
import { validateString } from '../../shared/validation'
import type { ChapterTask } from '../../shared/types'
import type { DiagnosticsService } from '../services/DiagnosticsService'
import { validateChatCompletionRequest } from './aiChatValidation'
import { safeIpcHandler } from './safeIpcHandler'

function optionalStringArray(value: unknown, fieldName: string, maxItems = 500): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${fieldName} must be an array with at most ${maxItems} items.`)
  return value.map((item, index) => validateString(item, `${fieldName}[${index}]`, { minLength: 1, maxLength: 2_000 }))
}

function boundedArray<T>(value: T[] | undefined, fieldName: string, maxItems: number): T[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${fieldName} must be an array with at most ${maxItems} items.`)
  return value
}

function optionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${fieldName} must be a positive integer.`)
  return Number(value)
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${fieldName} must be a boolean.`)
  return value
}

const CHAPTER_TASK_FIELDS = [
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

function optionalChapterTask(value: unknown, fieldName: string): ChapterTask | null | undefined {
  if (value === undefined || value === null) return value
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${fieldName} must be an object.`)
  const raw = value as Record<string, unknown>
  const allowed = new Set<string>(CHAPTER_TASK_FIELDS)
  const unknown = Object.keys(raw).filter((field) => !allowed.has(field))
  if (unknown.length) throw new Error(`${fieldName} contains unsupported fields: ${unknown.join(', ')}.`)
  const task = Object.fromEntries(CHAPTER_TASK_FIELDS.map((field) => [
    field,
    raw[field] === undefined
      ? ''
      : validateString(raw[field], `${fieldName}.${field}`, { minLength: 0, maxLength: 50_000, trim: false })
  ])) as unknown as ChapterTask
  if (!task.goal.trim()) throw new Error(`${fieldName}.goal is required.`)
  return task
}

export function registerDiagnosticsIpcHandlers(diagnosticsService: DiagnosticsService): void {
  ipcMain.handle(
    IPC_CHANNELS.DIAGNOSTICS_ANALYZE_REDUNDANCY,
    safeIpcHandler(async (_event, request: DiagnosticsAnalyzeRedundancyRequest): Promise<DiagnosticsAnalyzeRedundancyResult> => {
      const body = validateString(request.body, 'Draft body', { minLength: 1, maxLength: 1_000_000, trim: false })
      return diagnosticsService.analyzeRedundancy({
        projectId: validateString(request.projectId, 'projectId', { minLength: 1, maxLength: 200 }),
        chapterId: request.chapterId === null ? null : validateString(request.chapterId, 'chapterId', { minLength: 1, maxLength: 200 }),
        draftId: request.draftId === null ? null : validateString(request.draftId, 'draftId', { minLength: 1, maxLength: 200 }),
        body
      })
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.DIAGNOSTICS_AUDIT_NOVELTY,
    safeIpcHandler(async (_event, request: DiagnosticsAuditNoveltyRequest): Promise<DiagnosticsAuditNoveltyResult> => {
      return diagnosticsService.auditNovelty({
        ...request,
        generatedText: validateString(request.generatedText, 'generatedText', { minLength: 0, maxLength: 1_000_000, trim: false }),
        context: validateString(request.context, 'context', { minLength: 0, maxLength: 1_000_000, trim: false }),
        knownCharacterNames: optionalStringArray(request.knownCharacterNames, 'knownCharacterNames'),
        knownForeshadowingTexts: optionalStringArray(request.knownForeshadowingTexts, 'knownForeshadowingTexts'),
        knownCanonTexts: optionalStringArray(request.knownCanonTexts, 'knownCanonTexts')
      })
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.DIAGNOSTICS_EVALUATE_QUALITY_GATE,
    safeIpcHandler(async (_event, request: DiagnosticsEvaluateQualityGateRequest): Promise<DiagnosticsEvaluateQualityGateResult> => {
      return diagnosticsService.evaluateQualityGate({
        ...request,
        runId: request.runId === undefined
          ? undefined
          : validateString(request.runId, 'runId', { minLength: 1, maxLength: 200 }),
        settings: validateChatCompletionRequest({ settings: request.settings, messages: [{ role: 'user', content: 'diagnostics' }] }).settings,
        projectId: validateString(request.projectId, 'projectId', { minLength: 1, maxLength: 200 }),
        jobId: validateString(request.jobId, 'jobId', { minLength: 1, maxLength: 200 }),
        chapterId: request.chapterId === null ? null : validateString(request.chapterId, 'chapterId', { minLength: 1, maxLength: 200 }),
        draftId: request.draftId === null ? null : validateString(request.draftId, 'draftId', { minLength: 1, maxLength: 200 }),
        context: validateString(request.context, 'context', { minLength: 0, maxLength: 1_000_000, trim: false }),
        targetChapterOrder: optionalPositiveInteger(request.targetChapterOrder, 'targetChapterOrder'),
        hasAuthoritativeChapterTask: optionalBoolean(request.hasAuthoritativeChapterTask, 'hasAuthoritativeChapterTask'),
        chapterTask: optionalChapterTask(request.chapterTask, 'chapterTask'),
        characterStateFacts: boundedArray(request.characterStateFacts, 'characterStateFacts', 2_000)?.filter((fact) => fact.projectId === request.projectId),
        characters: boundedArray(request.characters, 'characters', 1_000)?.filter((character) => character.projectId === request.projectId),
        consistencyReports: boundedArray(request.consistencyReports, 'consistencyReports', 100)
      })
    })
  )
}
