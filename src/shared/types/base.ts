export type ID = string

export type PromptMode = 'light' | 'standard' | 'full'

export type ContextBudgetMode = PromptMode | 'custom'

export type ApiProvider = 'openai' | 'compatible' | 'local' | 'codex_cli'

export interface AiTokenUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedPromptTokens?: number
}

export type AiCallTerminationCategory = 'none' | 'cancelled' | 'timeout'

export type AiCallProgressStage =
  | 'waiting_response'
  | 'reading_response'
  | 'retry_wait'
  | 'format_retry'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Main-process transport progress. No prompt, response text, reasoning, or credentials are retained. */
export interface AiCallProgress {
  callId: ID
  runId?: ID
  stage: AiCallProgressStage
  elapsedMs: number
  attempt: number
  retryDelayMs?: number
  provider: ApiProvider
  model: string
  startedAt: string
  lastActivityAt: string
}

/**
 * Safe transport telemetry only. It must never contain prompts, generated
 * prose, reasoning text, credentials, or a raw provider response.
 */
export interface AiCallTelemetry {
  callId?: ID
  runId?: ID
  provider: ApiProvider
  model: string
  durationMs: number
  attempts: number
  responseFormatFallback: boolean
  finishReason?: string
  usage?: AiTokenUsage
  terminationCategory: AiCallTerminationCategory
}

export type ContinuitySource = 'saved_bridge' | 'auto_from_previous_ending' | 'manual'

export interface TimelineEvent {
  id: ID
  projectId: ID
  title: string
  chapterOrder: number | null
  storyTime: string
  narrativeOrder: number
  participantCharacterIds: ID[]
  result: string
  downstreamImpact: string
  createdAt: string
  updatedAt: string
}

export interface StageSummary {
  id: ID
  projectId: ID
  chapterStart: number
  chapterEnd: number
  coveredChapterRange?: string
  compressedPlotSummary?: string
  irreversibleChanges?: string
  endingCarryoverState?: string
  emotionalAftertaste?: string
  pacingState?: string
  plotProgress: string
  characterRelations: string
  secrets: string
  foreshadowingPlanted: string
  foreshadowingResolved: string
  unresolvedQuestions: string
  nextStageDirection: string
  createdAt: string
  updatedAt: string
}

export interface AIResult<T> {
  ok: boolean
  usedAI: boolean
  data: T | null
  error?: string
  rawText?: string
  parseError?: string
  finishReason?: string
  telemetry?: AiCallTelemetry
}
