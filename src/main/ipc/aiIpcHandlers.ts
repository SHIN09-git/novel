import { ipcMain } from 'electron'
import { getUserFriendlyError, redactSensitiveText } from '../../shared/errorUtils'
import { IPC_CHANNELS } from '../../shared/ipc/ipcChannels'
import type {
  CancelAiCallRequest,
  CancelAiCallResult,
  CancelAiRunResult,
  ChatCompletionRequest,
  ChatCompletionResult,
  CodexCliStatusResult,
  GetAiCallProgressRequest,
  GetAiCallProgressResult,
  ListAiCallProgressResult
} from '../../shared/ipc/ipcTypes'
import { ValidationError, validateString } from '../../shared/validation'
import { LogService } from '../LogService'
import type { IAIService } from '../services/AIService'
import { validateChatCompletionRequest } from './aiChatValidation'
import { safeIpcHandler } from './safeIpcHandler'

const aiIdOptions = { minLength: 1, maxLength: 200, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ }

function validateChatRequestCallId(
  request: ChatCompletionRequest,
  validated: ChatCompletionRequest
): ChatCompletionRequest {
  const rawCallId = (request as unknown as Record<string, unknown>).clientCallId
  if (rawCallId === undefined) return validated
  const clientCallId = validateString(rawCallId, 'AI clientCallId', aiIdOptions)
  if (!validated.runId) throw new ValidationError('AI clientCallId requires a runId namespace.')
  return { ...validated, clientCallId }
}

function validateCancelCallRequest(request: CancelAiCallRequest): CancelAiCallRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new ValidationError('AI cancel-call request must be an object.')
  }
  const record = request as unknown as Record<string, unknown>
  return {
    runId: validateString(record.runId, 'AI runId', aiIdOptions),
    callId: validateString(record.callId, 'AI callId', aiIdOptions)
  }
}

function validateCallProgressRequest(request: GetAiCallProgressRequest | undefined): GetAiCallProgressRequest {
  if (request === undefined) return {}
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new ValidationError('AI call-progress request must be an object.')
  }
  const record = request as unknown as Record<string, unknown>
  return {
    runId: record.runId === undefined ? undefined : validateString(record.runId, 'AI runId', aiIdOptions),
    callId: record.callId === undefined ? undefined : validateString(record.callId, 'AI callId', aiIdOptions)
  }
}

export function registerAiIpcHandlers(aiService: IAIService): void {
  ipcMain.handle(
    IPC_CHANNELS.AI_CHAT_COMPLETION,
    safeIpcHandler(async (_event, request: ChatCompletionRequest): Promise<ChatCompletionResult> => {
      try {
        const validated = validateChatCompletionRequest(request)
        return await aiService.chatCompletion(validateChatRequestCallId(request, validated))
      } catch (error) {
        LogService.error('AI chat completion failed', error)
        const message = getUserFriendlyError(error)
        return { ok: false, error: `AI 请求失败：${redactSensitiveText(message).slice(0, 800)}` }
      }
    })
  )
  ipcMain.handle(
    IPC_CHANNELS.AI_CANCEL_RUN,
    safeIpcHandler(async (_event, runId: string): Promise<CancelAiRunResult> => ({
      ok: true,
      cancelled: aiService.cancelRun(validateString(runId, 'runId', { minLength: 1, maxLength: 200 }))
    }))
  )
  ipcMain.handle(
    IPC_CHANNELS.AI_CANCEL_CALL,
    safeIpcHandler(async (_event, request: CancelAiCallRequest): Promise<CancelAiCallResult> => {
      const validated = validateCancelCallRequest(request)
      return {
        ok: true,
        cancelled: aiService.cancelCall(validated.runId, validated.callId)
      }
    })
  )
  ipcMain.handle(
    IPC_CHANNELS.AI_GET_CALL_PROGRESS,
    safeIpcHandler(async (_event, request?: GetAiCallProgressRequest): Promise<GetAiCallProgressResult> =>
      aiService.getCallProgress(validateCallProgressRequest(request))
    )
  )
  ipcMain.handle(
    IPC_CHANNELS.AI_LIST_CALL_PROGRESS,
    safeIpcHandler(async (_event, runId: string): Promise<ListAiCallProgressResult> =>
      aiService.listCallProgress(validateString(runId, 'AI runId', aiIdOptions))
    )
  )
  ipcMain.handle(
    IPC_CHANNELS.AI_CODEX_CLI_STATUS,
    safeIpcHandler(async (_event, command?: string): Promise<CodexCliStatusResult> =>
      aiService.getCodexCliStatus(
        command === undefined
          ? 'codex'
          : validateString(command, 'Codex CLI path', { minLength: 1, maxLength: 1_000 })
      )
    )
  )
}
