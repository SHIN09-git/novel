#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf-8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function contains(text, pattern, message) {
  const ok = pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)
  assert(ok, message)
}

const rateLimiterPath = 'src/main/RateLimiter.ts'
assert(existsSync(join(root, rateLimiterPath)), 'RateLimiter.ts must exist.')
const rateLimiter = read(rateLimiterPath)
contains(rateLimiter, 'TokenBucketRateLimiter', 'TokenBucketRateLimiter class must be defined.')
contains(rateLimiter, 'async acquire', 'Rate limiter must expose async acquire().')
contains(rateLimiter, 'getAvailableTokens', 'Rate limiter must expose getAvailableTokens().')

const validationPath = 'src/shared/validation.ts'
assert(existsSync(join(root, validationPath)), 'shared validation helper must exist.')
const validation = read(validationPath)
for (const symbol of ['ValidationError', 'validateString', 'validateNumber', 'validateApiKey', 'validateUrl', 'validateFilePath']) {
  contains(validation, symbol, `validation helper must export ${symbol}.`)
}
contains(validation, 'trim?: boolean', 'validateString must support preserving prompt/export text whitespace.')

const mainIndex = read('src/main/index.ts')
contains(mainIndex, "import { TokenBucketRateLimiter } from './RateLimiter'", 'main process must import TokenBucketRateLimiter.')
contains(mainIndex, "import { AIService } from './services/AIService'", 'main process must import AIService.')
contains(mainIndex, 'aiRateLimiters', 'main process must create AI rate limiters.')
contains(mainIndex, /openai:\s*new TokenBucketRateLimiter/, 'OpenAI provider must have a limiter.')
contains(mainIndex, /compatible:\s*new TokenBucketRateLimiter/, 'Compatible provider must have a limiter.')
contains(mainIndex, 'new AIService(credentialService, aiRateLimiters)', 'main process must instantiate AIService with credentials and rate limiters.')
contains(mainIndex, 'registerIpcHandlers({', 'main process must register IPC handlers.')
contains(mainIndex, 'aiService', 'IPC context must receive AIService.')

const ipcHandlers = read('src/main/ipc/registerIpcHandlers.ts')
contains(ipcHandlers, "import type { IAIService } from '../services/AIService'", 'IPC handlers must depend on the AI service interface.')
contains(ipcHandlers, 'aiService: IAIService', 'IPC context must include AIService instead of AI HTTP internals.')
contains(ipcHandlers, 'validateChatCompletionRequest', 'AI request validator must be present.')
contains(ipcHandlers, 'validateChatMessages', 'AI message validator must be present.')
contains(ipcHandlers, "trim: false", 'Prompt/export/clipboard text validation must preserve meaningful whitespace.')
contains(ipcHandlers, 'validateApiKey', 'API key validation must be used.')
contains(ipcHandlers, 'validateUrl', 'Base URL validation must be used.')
contains(ipcHandlers, 'validateNumber', 'Numeric AI setting validation must be used.')
contains(ipcHandlers, 'validateFilePath(rawPath', 'Storage path validation must be used.')
contains(ipcHandlers, 'context.aiService.chatCompletion(validateChatCompletionRequest(request))', 'AI chat completion IPC must delegate to AIService.')

const aiService = read('src/main/services/AIService.ts')
contains(aiService, 'limiter.acquire()', 'AIService must acquire a rate limiter token.')
contains(aiService, 'settings.apiProvider === \'local\' ? null', 'Local provider must bypass remote rate limiting.')
contains(aiService, 'sanitizeAiErrorText(message, apiKey)', 'AI errors must be redacted after validation/network failures.')
contains(aiService, 'retryWithBackoff', 'AIService must own AI retry behavior.')

const aiHttpClient = read('src/main/services/AIHttpClient.ts')
contains(aiHttpClient, 'postWithFallback', 'AIHttpClient must own response_format fallback behavior.')
contains(aiHttpClient, 'AbortController', 'AIHttpClient must apply request timeout control.')

const errorBoundaryPath = 'src/renderer/src/components/ErrorBoundary.tsx'
assert(existsSync(join(root, errorBoundaryPath)), 'React ErrorBoundary component must exist.')
const errorBoundary = read(errorBoundaryPath)
contains(errorBoundary, 'componentDidCatch', 'ErrorBoundary must implement componentDidCatch.')
contains(errorBoundary, 'getDerivedStateFromError', 'ErrorBoundary must implement getDerivedStateFromError.')

const rendererMain = read('src/renderer/src/main.tsx')
contains(rendererMain, "import { ErrorBoundary } from './components/ErrorBoundary'", 'Renderer entry must import ErrorBoundary.')
contains(rendererMain, '<ErrorBoundary>', 'Renderer tree must be wrapped by ErrorBoundary.')

const app = read('src/renderer/src/App.tsx')
contains(app, "import { ErrorBoundary } from './components/ErrorBoundary'", 'App must import ErrorBoundary for lazy views.')
contains(app, '<ErrorBoundary', 'Current view rendering must be wrapped by ErrorBoundary.')
contains(app, '<Suspense', 'Lazy views must still be rendered inside Suspense.')

const styles = read('src/renderer/src/styles/components.css')
contains(styles, '.error-boundary', 'ErrorBoundary styles must exist.')
contains(styles, '.view-error-boundary', 'View-level ErrorBoundary styles must exist.')

const runner = read('scripts/run-tests.mjs')
contains(runner, "['validate-architecture-p2.mjs']", 'P2 architecture validation must be included in npm test runner.')

console.log('Architecture P2 validation passed.')
