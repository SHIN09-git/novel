#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const checks = []

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function check(name, ok, details = '') {
  checks.push({ name, ok, details })
}

const retryPath = 'src/main/utils/retry.ts'
const aiErrorsPath = 'src/main/utils/aiErrors.ts'
const aiServicePath = 'src/main/services/AIService.ts'
const aiHttpClientPath = 'src/main/services/AIHttpClient.ts'
const ipcPath = 'src/main/ipc/registerIpcHandlers.ts'

check('retry utility exists', existsSync(join(root, retryPath)))
check('AI retry error utility exists', existsSync(join(root, aiErrorsPath)))
check('main-process AI service exists', existsSync(join(root, aiServicePath)))
check('main-process AI HTTP client exists', existsSync(join(root, aiHttpClientPath)))

const retry = read(retryPath)
const aiErrors = read(aiErrorsPath)
const aiService = read(aiServicePath)
const aiHttpClient = read(aiHttpClientPath)
const ipc = read(ipcPath)
const types = `${read('src/shared/types.ts')}\n${read('src/shared/types/appData.ts')}`
const defaults = `${read('src/shared/defaults.ts')}\n${read('src/shared/defaults/index.ts')}`
const runner = read('scripts/run-tests.mjs')

check('retryWithBackoff is exported', /export async function retryWithBackoff/.test(retry))
check('retry defaults to 3 retries', /return 3/.test(retry) && /maxRetries = normalizeRetries/.test(retry))
check('retry initial delay defaults to 1000ms', /initialDelayMs \?\? 1000/.test(retry))
check('retry max delay defaults to 32000ms', /maxDelayMs \?\? 32_000/.test(retry))
check('retry uses exponential backoff', /2 \*\* Math\.max/.test(retry))
check('retry adds jitter', /Math\.random\(\)/.test(retry))
check('retry logs or calls onRetry on each retry', /onRetry\?:/.test(retry) && /options\.onRetry/.test(retry) && /LogService\.warn/.test(retry))
check('retry supports shouldRetry predicate', /shouldRetry\?:/.test(retry) && /!shouldRetry\(error\)/.test(retry))

check('AI HTTP error type carries status', /class AiHttpError/.test(aiErrors) && /readonly status: number/.test(aiErrors))
check('AI retry predicate retries 429 and 5xx transient statuses', /status === 429/.test(aiErrors) && /status === 502/.test(aiErrors) && /status === 503/.test(aiErrors) && /status === 504/.test(aiErrors))
check('AI retry predicate does not retry client/request errors', /\[400, 401, 403, 413\]/.test(aiErrors))
check('AI retry predicate recognizes transient network codes', /ECONNRESET/.test(aiErrors) && /ETIMEDOUT/.test(aiErrors) && /ENOTFOUND/.test(aiErrors))

const aiHandler = ipc.slice(ipc.indexOf('IPC_CHANNELS.AI_CHAT_COMPLETION'))
const aiServiceChatCompletion = aiService.slice(aiService.indexOf('async chatCompletion'))
const limiterIndex = aiServiceChatCompletion.indexOf('await limiter.acquire()')
const retryIndex = aiServiceChatCompletion.indexOf('retryWithBackoff')
check('rate limiter still runs before retry wrapper in AIService', limiterIndex >= 0 && retryIndex > limiterIndex)
check('AI handler delegates to AIService', /context\.aiService\.chatCompletion\(validateChatCompletionRequest\(request\)\)/.test(aiHandler))
check('AIService wraps chat completion HTTP call with retryWithBackoff', /retryWithBackoff\(\s*\(\) => this\.performChatCompletion/.test(aiService))
check('AIHttpClient preserves response_format fallback', /response_format\|json_object\|unsupported/.test(aiHttpClient) && /fallbackBody/.test(aiHttpClient))
check('AI retry logs sanitized retry summaries', /AI request retry scheduled/.test(aiService) && /sanitizeAiErrorText\(describeAiRetryError/.test(aiService))

check('AppSettings exposes retry controls', /retryEnabled: boolean/.test(types) && /maxRetries: number/.test(types))
check('DEFAULT_SETTINGS enables retry with 3 attempts', /retryEnabled: true/.test(defaults) && /maxRetries: 3/.test(defaults))
check('npm test runs AI retry validation', /validate-ai-retry-backoff\.mjs/.test(runner))

const failed = checks.filter((item) => !item.ok)
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, totalChecks: checks.length }, null, 2))
