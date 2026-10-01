import type { ChatCompletionRequest } from '../../shared/ipc/ipcTypes'
import type { ApiProvider } from '../../shared/types'
import { ValidationError, validateNumber, validateString, validateUrl } from '../../shared/validation'

const apiProviders = new Set<ApiProvider>(['openai', 'compatible', 'local', 'codex_cli'])
const chatMessageRoles = new Set(['system', 'user'])

function validateApiProvider(value: unknown): ApiProvider {
  if (typeof value !== 'string' || !apiProviders.has(value as ApiProvider)) {
    throw new ValidationError('AI provider is not supported.')
  }
  return value as ApiProvider
}

function validateChatMessages(messages: unknown): ChatCompletionRequest['messages'] {
  if (!Array.isArray(messages)) {
    throw new ValidationError('AI messages must be an array.')
  }
  if (!messages.length) {
    throw new ValidationError('AI messages cannot be empty.')
  }
  if (messages.length > 128) {
    throw new ValidationError('AI messages contain too many entries.')
  }

  return messages.map((message, index) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new ValidationError(`AI message ${index + 1} must be an object.`)
    }
    const record = message as Record<string, unknown>
    const role = validateString(record.role, `AI message ${index + 1} role`, { minLength: 1, maxLength: 20 })
    if (!chatMessageRoles.has(role)) {
      throw new ValidationError(`AI message ${index + 1} role is not supported.`)
    }

    return {
      role: role as 'system' | 'user',
      content: validateString(record.content, `AI message ${index + 1} content`, {
        minLength: 1,
        maxLength: 500_000,
        trim: false
      })
    }
  })
}

export function validateChatCompletionRequest(request: ChatCompletionRequest): ChatCompletionRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new ValidationError('AI chat request must be an object.')
  }
  const record = request as unknown as Record<string, unknown>
  const settings = record.settings && typeof record.settings === 'object' && !Array.isArray(record.settings)
    ? (record.settings as Record<string, unknown>)
    : null
  if (!settings) {
    throw new ValidationError('AI settings are required.')
  }
  const apiProvider = validateApiProvider(settings.apiProvider)
  const isCodexCli = apiProvider === 'codex_cli'

  return {
    settings: {
      ...(request.settings ?? {}),
      apiProvider,
      baseUrl: isCodexCli
        ? typeof settings.baseUrl === 'string'
          ? validateString(settings.baseUrl, 'AI Base URL', { maxLength: 2_000 })
          : ''
        : validateUrl(settings.baseUrl, 'AI Base URL'),
      modelName: isCodexCli
        ? typeof settings.modelName === 'string'
          ? validateString(settings.modelName, 'AI model name', { maxLength: 200 })
          : ''
        : validateString(settings.modelName, 'AI model name', { minLength: 1, maxLength: 200 }),
      codexCliPath:
        isCodexCli && typeof settings.codexCliPath === 'string'
          ? validateString(settings.codexCliPath, 'Codex CLI path', { minLength: 1, maxLength: 1_000 })
          : 'codex',
      codexCliModel:
        isCodexCli && typeof settings.codexCliModel === 'string'
          ? validateString(settings.codexCliModel, 'Codex CLI model', { maxLength: 200 })
          : '',
      temperature: validateNumber(settings.temperature, 'AI temperature', { min: 0, max: 2 }),
      maxTokens: validateNumber(settings.maxTokens, 'AI max tokens', { min: 1, max: 200_000, integer: true }),
      retryEnabled: typeof settings.retryEnabled === 'boolean' ? settings.retryEnabled : true,
      maxRetries: typeof settings.maxRetries === 'number'
        ? validateNumber(settings.maxRetries, 'AI max retries', { min: 0, max: 10, integer: true })
        : 3,
      requestTimeoutMs: typeof settings.requestTimeoutMs === 'number'
        ? validateNumber(settings.requestTimeoutMs, 'AI request timeout', { min: 5_000, max: 900_000, integer: true })
        : 300_000
    },
    messages: validateChatMessages(record.messages),
    runId: typeof record.runId === 'string'
      ? validateString(record.runId, 'AI runId', { minLength: 1, maxLength: 200 })
      : undefined
  }
}
