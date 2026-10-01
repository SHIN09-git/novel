#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import {
  aggregateChapterAbDiagnostics,
  auditWorkbenchRequests,
  diagnoseChapterBody,
  diagnoseChapterPrompt,
  extractModelResponseTelemetry,
  summarizeDraftRequestTelemetry
} from './utils/chapter-ab-diagnostics.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tempRoot = resolve(root, 'tmp')
const PREFLIGHT_DRAFT_STOP = 'PREFLIGHT_DRAFT_INTENTIONAL_STOP'
const chineseWordSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

function valueFlag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}.`)
  return value
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function numberFlag(name, fallback, { min, max }) {
  const raw = valueFlag(name, String(fallback))
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid --${name}; expected ${min}-${max}.`)
  }
  return value
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

async function assertOutputInsideTemp(outputDir) {
  const relation = relative(tempRoot, outputDir)
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error(`--output must be a new subdirectory of ${tempRoot}.`)
  }
  const [realTempRoot, realOutputParent] = await Promise.all([realpath(tempRoot), realpath(dirname(outputDir))])
  const realRelation = relative(realTempRoot, realOutputParent)
  if (realRelation.startsWith('..') || isAbsolute(realRelation)) {
    throw new Error(`--output parent resolves outside ${tempRoot}.`)
  }
}

function hashFile(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolvePromise(hash.digest('hex')))
  })
}

function quotedIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function copySqliteSnapshot(sourcePath, destinationPath) {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  const destination = new Database(destinationPath)
  try {
    source.pragma('query_only = ON')
    destination.pragma('journal_mode = DELETE')
    destination.pragma('synchronous = FULL')
    const schema = source
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name")
      .all()
    const tables = schema.filter((entry) => entry.type === 'table')
    const deferredSchema = schema.filter((entry) => entry.type !== 'table')

    for (const entry of tables) destination.exec(entry.sql)
    source.exec('BEGIN')
    try {
      destination.transaction(() => {
        for (const entry of tables) {
          const table = quotedIdentifier(entry.name)
          const columns = source.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
          if (!columns.length) continue
          const columnSql = columns.map(quotedIdentifier).join(', ')
          const insert = destination.prepare(
            `INSERT INTO ${table} (${columnSql}) VALUES (${columns.map(() => '?').join(', ')})`
          )
          for (const row of source.prepare(`SELECT ${columnSql} FROM ${table}`).iterate()) {
            insert.run(...columns.map((column) => row[column]))
          }
        }
      })()
      source.exec('COMMIT')
    } catch (error) {
      source.exec('ROLLBACK')
      throw error
    }
    for (const entry of deferredSchema) destination.exec(entry.sql)
    const integrity = destination.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`Snapshot integrity check failed: ${integrity}`)
  } finally {
    destination.close()
    source.close()
  }
}

function readSettings(storagePath) {
  const db = new Database(storagePath, { readonly: true, fileMustExist: true })
  try {
    const row = db.prepare('SELECT json FROM app_settings LIMIT 1').get()
    if (!row?.json) throw new Error('SQLite snapshot has no app_settings row.')
    return JSON.parse(row.json)
  } finally {
    db.close()
  }
}

function patchSettings(storagePath, patch) {
  const db = new Database(storagePath)
  try {
    const row = db.prepare('SELECT id, json FROM app_settings LIMIT 1').get()
    if (!row?.json) throw new Error('SQLite snapshot has no app_settings row.')
    const settings = { ...JSON.parse(row.json), ...patch }
    db.prepare('UPDATE app_settings SET json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(settings),
      new Date().toISOString(),
      row.id
    )
  } finally {
    db.close()
  }
}

function writeJsonResponse(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

async function readHttpBody(request, maxBytes = 8 * 1024 * 1024) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new Error(`Loopback request exceeded ${maxBytes} bytes.`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function classifyWorkbenchRequest(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : []
  const systemText = messages.filter((message) => message?.role === 'system').map((message) => String(message?.content ?? '')).join('\n')
  const userText = messages.filter((message) => message?.role === 'user').map((message) => String(message?.content ?? '')).join('\n')
  if (systemText.includes('章节导演') || userText.includes('planning the target chapter')) return 'plan'
  if (systemText.includes('正文作者') || userText.includes('drafting a novel chapter')) return 'draft'
  return 'other'
}

async function startWorkbenchAuditProxy({ preflightOnly, upstreamSettings, apiKey, spec, task, baselinePromptCharacterCount }) {
  const requests = []
  let activeRunLabel = 'unassigned'
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const record = {
        index: requests.length + 1,
        runLabel: activeRunLabel,
        method: request.method ?? '',
        pathname,
        stage: 'invalid',
        model: null,
        prompt: '',
        promptAudit: null,
        forwarded: false,
        responseMode: null,
        finishReason: null,
        usage: null,
        draftResponse: null,
        draftRawResponse: null,
        draftParseError: null,
        error: null
      }
      try {
        if (request.method !== 'POST' || pathname !== '/chat/completions') {
          record.error = 'Unexpected loopback route.'
          requests.push(record)
          writeJsonResponse(response, 404, { error: { message: record.error } })
          return
        }

        const payload = JSON.parse(await readHttpBody(request))
        record.model = String(payload?.model ?? '')
        record.stage = classifyWorkbenchRequest(payload)
        record.prompt = serializeMessages(Array.isArray(payload?.messages) ? payload.messages : [])
        if (record.stage === 'plan' || record.stage === 'draft') {
          record.promptAudit = auditPrompt(record.prompt, spec, task, baselinePromptCharacterCount)
        }
        requests.push(record)

        if (record.model !== spec.audit.expectedModelName) {
          record.error = `Unexpected model ${record.model || '<missing>'}.`
          writeJsonResponse(response, 422, { error: { message: `MODEL_AUDIT_BLOCKED: ${record.error}` } })
          return
        }
        if ((record.stage === 'plan' || record.stage === 'draft') && !record.promptAudit?.hardPass) {
          record.error = `Unsafe ${record.stage} request prompt.`
          writeJsonResponse(response, 422, { error: { message: `PROMPT_AUDIT_BLOCKED:${record.stage}` } })
          return
        }

        if (preflightOnly) {
          if (record.stage === 'plan') {
            record.responseMode = 'unexpected_opening_plan_request'
            record.error = 'PREFLIGHT_OPENING_PLAN_REQUEST_MUST_BE_SKIPPED'
            writeJsonResponse(response, 422, { error: { message: record.error } })
            return
          }
          if (record.stage === 'draft') {
            record.responseMode = 'intentional_draft_stop'
            record.error = PREFLIGHT_DRAFT_STOP
            writeJsonResponse(response, 422, { error: { message: PREFLIGHT_DRAFT_STOP } })
            return
          }
          record.error = 'Unexpected preflight request stage.'
          writeJsonResponse(response, 422, { error: { message: 'PREFLIGHT_UNEXPECTED_REQUEST_STAGE' } })
          return
        }

        const upstreamPayload = {
          ...payload,
          ...(String(payload.model).match(/^deepseek-v4-(flash|pro)$/i) &&
          new URL(upstreamSettings.baseUrl).hostname.toLowerCase() === 'api.deepseek.com'
            ? { thinking: { type: 'disabled' } }
            : {})
        }
        const controller = new AbortController()
        const timer = setTimeout(
          () => controller.abort(),
          Math.max(30_000, upstreamSettings.requestTimeoutMs ?? 300_000)
        )
        let upstreamResponse
        try {
          upstreamResponse = await fetch(
            `${String(upstreamSettings.baseUrl).replace(/\/+$/, '')}/chat/completions`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
              },
              body: JSON.stringify(upstreamPayload),
              signal: controller.signal
            }
          )
        } finally {
          clearTimeout(timer)
        }
        const responseBody = Buffer.from(await upstreamResponse.arrayBuffer())
        const responseText = responseBody.toString('utf8')
        const responseTelemetry = extractModelResponseTelemetry(responseText)
        record.finishReason = responseTelemetry.finishReason
        record.usage = responseTelemetry.usage
        if (record.stage === 'draft') {
          try {
            record.draftRawResponse = responseContent(JSON.parse(responseText))
            const parsedDraft = parseJsonText(record.draftRawResponse)
            const draftBody = String(parsedDraft?.body ?? parsedDraft?.content ?? '').trim()
            if (draftBody) {
              record.draftResponse = {
                title: String(parsedDraft?.title ?? '').trim(),
                body: draftBody
              }
            }
          } catch (error) {
            record.draftResponse = null
            record.draftParseError = error instanceof Error ? error.message : String(error)
          }
        }
        record.forwarded = true
        record.responseMode = 'forwarded'
        response.writeHead(upstreamResponse.status, {
          'Content-Type': upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8'
        })
        response.end(responseBody)
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error)
        if (!requests.includes(record)) requests.push(record)
        if (!response.headersSent) {
          writeJsonResponse(response, 502, { error: { message: `LOOPBACK_PROXY_ERROR: ${record.error}` } })
        } else {
          response.end()
        }
      }
    })()
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to start local preflight server.')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    setRunLabel(value) {
      activeRunLabel = value
    },
    close: () => new Promise((resolvePromise) => server.close(resolvePromise))
  }
}

function parseJsonText(text) {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
    throw new Error('Model response did not contain a JSON object.')
  }
}

function responseContent(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('\n')
  }
  return ''
}

function modelFacingTask(spec) {
  return { ...spec.task, ...(spec.modelFacingTaskOverrides ?? {}) }
}

function minimalCreativeBrief(task) {
  return {
    goal: task.goal,
    conflict: task.conflict,
    suspenseToKeep: task.suspenseToKeep,
    endingHook: task.endingHook,
    readerEmotion: task.readerEmotion,
    targetWordCount: task.targetWordCount,
    styleRequirement: task.styleRequirement
  }
}

function buildDirectMinimalMessages(task) {
  return [
    {
      role: 'system',
      content: '你是中文长篇小说作者。只输出 JSON 对象，格式为 {"title":"","body":""}，不要输出 Markdown 或分析。'
    },
    {
      role: 'user',
      content: [
        '请按下面这份简短创作简报自然写第一章。把简报消化成场景、动作和对话，不要在正文里复述规则。',
        JSON.stringify(minimalCreativeBrief(task), null, 2)
      ].join('\n\n')
    }
  ]
}

function buildDirectContractMessages(task) {
  return [
    {
      role: 'system',
      content: '你是中文长篇小说作者。只输出 JSON 对象，格式为 {"title":"","body":""}，不要输出 Markdown 或分析。'
    },
    {
      role: 'user',
      content: [
        '请直接写第一章。下列结构化任务是唯一创作上下文，没有其他世界观、旧正文或风格样例。',
        '必须保留每一项约束；forbiddenPayoffs 中的内容不得出现在正文。',
        JSON.stringify(task, null, 2)
      ].join('\n\n')
    }
  ]
}

function serializeMessages(messages) {
  return messages.map((message) => `[${message.role}]\n${message.content}`).join('\n\n')
}

async function generateDirect({ settings, apiKey, task, temperature, messages = buildDirectContractMessages(task) }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(30_000, settings.requestTimeoutMs ?? 300_000))
  try {
    const response = await fetch(`${String(settings.baseUrl).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: settings.modelName,
        messages,
        temperature,
        max_tokens: Math.min(12_000, Math.max(1, settings.maxTokens ?? 12_000)),
        response_format: { type: 'json_object' },
        ...(String(settings.modelName).match(/^deepseek-v4-(flash|pro)$/i) && new URL(settings.baseUrl).hostname === 'api.deepseek.com'
          ? { thinking: { type: 'disabled' } }
          : {})
      }),
      signal: controller.signal
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const message = payload?.error?.message || `HTTP ${response.status}`
      throw new Error(`Direct model request failed: ${String(message).slice(0, 500)}`)
    }
    const parsed = parseJsonText(responseContent(payload))
    const body = String(parsed.body ?? parsed.content ?? '')
    if (!body.trim()) throw new Error('Direct model response has no body.')
    return {
      title: String(parsed.title ?? '第 1 章'),
      body,
      prompt: serializeMessages(messages),
      finishReason: payload?.choices?.[0]?.finish_reason ?? null,
      usage: payload?.usage ?? null
    }
  } finally {
    clearTimeout(timer)
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Command timed out after ${options.timeoutMs}ms.`))
    }, options.timeoutMs ?? 1_200_000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolvePromise({ code: code ?? 1, stdout, stderr })
    })
  })
}

function entitiesForJob(storagePath, collection, jobId) {
  const db = new Database(storagePath, { readonly: true, fileMustExist: true })
  try {
    return db
      .prepare('SELECT json FROM entities WHERE collection = ? AND job_id = ? ORDER BY updated_at DESC')
      .all(collection, jobId)
      .map((row) => JSON.parse(row.json))
  } finally {
    db.close()
  }
}

function workbenchArtifacts(storagePath, jobId) {
  const steps = entitiesForJob(storagePath, 'chapterGenerationSteps', jobId)
  const drafts = entitiesForJob(storagePath, 'generatedChapterDrafts', jobId)
  const qualityReports = entitiesForJob(storagePath, 'qualityGateReports', jobId)
  const traces = entitiesForJob(storagePath, 'generationRunTraces', jobId)
  const contextStep =
    steps.find((step) => step.type === 'rebuild_context_with_plan' && step.output) ??
    steps.find((step) => step.type === 'build_context' && step.output)
  let prompt = ''
  if (contextStep?.output) {
    const rawOutput = String(contextStep.output)
    if (rawOutput.trimStart().startsWith('#')) {
      prompt = rawOutput
    } else {
      const parsed = parseJsonText(rawOutput)
      prompt = String(parsed.finalPrompt ?? '')
    }
  }
  return {
    steps,
    draft: drafts[0] ?? null,
    qualityReport: qualityReports[0] ?? null,
    trace: traces[0] ?? null,
    prompt
  }
}

async function runWorkbench({ sourcePath, destinationPath, userDataPath, spec, temperature, apiKey, settingsPatch }) {
  copySqliteSnapshot(sourcePath, destinationPath)
  if (settingsPatch) patchSettings(destinationPath, settingsPatch)
  await mkdir(userDataPath, { recursive: true })
  const args = [
    join(root, 'scripts', 'run-agent.mjs'),
    'run-chapter',
    '--storage', destinationPath,
    '--user-data', userDataPath,
    '--project-id', spec.projectId,
    '--chapter', String(spec.chapterOrder),
    '--goal', spec.goal,
    '--chapter-task-json', JSON.stringify(spec.task),
    '--safety-mode', 'conservative',
    '--pipeline-mode', 'conservative',
    '--estimated-words', spec.task.targetWordCount,
    '--reader-emotion', spec.task.readerEmotion,
    '--temperature', String(temperature),
    '--budget-max-tokens', '12000'
  ]
  const execution = await runCommand(process.execPath, args, {
    env: { ...process.env, NOVEL_DIRECTOR_API_KEY: apiKey },
    timeoutMs: 1_200_000
  })
  let cli = null
  try {
    cli = parseJsonText(execution.stdout)
  } catch (error) {
    throw new Error(`Unable to parse Agent CLI output (exit ${execution.code}): ${error.message}\n${execution.stderr.slice(-1000)}`)
  }
  const jobId = cli?.data?.job?.id
  if (!jobId) throw new Error(`Agent CLI returned no job id: ${execution.stdout.slice(-1200)}`)
  return {
    execution: {
      exitCode: execution.code,
      stderrTail: execution.stderr.slice(-3000)
    },
    cli,
    jobId,
    artifacts: workbenchArtifacts(destinationPath, jobId)
  }
}

function countOccurrences(text, value) {
  if (!value) return 0
  let count = 0
  let offset = 0
  while (true) {
    const index = text.indexOf(value, offset)
    if (index < 0) return count
    count += 1
    offset = index + value.length
  }
}

function expectedLengthRange(value) {
  const numbers = String(value).match(/\d+/g)?.map(Number) ?? []
  return numbers.length >= 2 ? [numbers[0], numbers[1]] : [0, Number.POSITIVE_INFINITY]
}

function normalizedTermHits(text, terms) {
  return [...new Set(terms)].filter((term) => Boolean(normalizedTermMatch(text, term)))
}

function actionViolationDetails(text, actions) {
  const strictContextTerms = new Set(['附件里', '附件中'])
  const violations = []
  for (const action of actions) {
    let offset = 0
    while (offset < text.length) {
      const index = text.indexOf(action, offset)
      if (index < 0) break
      const prefix = normalizedText(text.slice(Math.max(0, index - 18), index))
      const negated =
        !strictContextTerms.has(action) &&
        /(?:没有|并没有|并未|未曾|从未|没再|不再|没|未|不|拒绝|放弃|避免)(?:打算|准备|决定|选择|继续|真的|去|再)?$/u.test(prefix)
      if (!negated) violations.push({ action, index })
      offset = index + action.length
    }
  }
  return violations
}

function auditBody(body, spec, title = '', task = modelFacingTask(spec)) {
  const text = String(body ?? '')
  const titleText = String(title ?? '')
  const completeText = `${titleText}\n${text}`
  const phrase = spec.audit.notificationPhrase
  const phraseCount = countOccurrences(text, phrase)
  const phraseIndex = text.indexOf(phrase)
  const phrasePositionRatio = phraseIndex < 0 || !text.length ? null : phraseIndex / text.length
  const actionTerms = spec.audit.forbiddenActions ?? []
  const actionTermSet = new Set(actionTerms.map(normalizedText))
  const allowedFutureTerms = new Set((spec.audit.bodyFutureTermAllowlist ?? []).map(normalizedText))
  const futureTerms = promptExclusionTerms(spec.task.forbiddenPayoffs).filter((term) => {
    const normalized = normalizedText(term)
    return !actionTermSet.has(normalized) && !allowedFutureTerms.has(normalized)
  })
  const futureTermHits = normalizedTermHits(completeText, futureTerms)
  const forbiddenTermHits = normalizedTermHits(completeText, spec.audit.forbiddenTerms ?? [])
  const forbiddenActionDetails = actionViolationDetails(completeText, actionTerms)
  const forbiddenActionHits = [...new Set(forbiddenActionDetails.map((item) => item.action))]
  const styleSampleLeakHits = normalizedTermHits(completeText, spec.audit.styleSampleLeakPhrases ?? [])
  const dailyTermCounts = Object.fromEntries(spec.audit.dailyTerms.map((term) => [term, countOccurrences(text, term)]))
  const supportingNamedCharacters = (spec.audit.allowedNamedCharacters ?? []).slice(1)
  const [minLength, maxLength] = expectedLengthRange(spec.task.targetWordCount)
  const bodyDiagnostics = diagnoseChapterBody({
    body: text,
    title: titleText,
    task,
    contract: spec.audit,
    profile: spec.audit.diagnosticProfile
  })
  const checks = {
    expectedLength: text.length >= minLength && text.length <= maxLength,
    notificationExactlyOnce: phraseCount === 1,
    notificationLateEnough: phrasePositionRatio !== null && phrasePositionRatio >= spec.audit.notificationMinPositionRatio,
    noFutureTerms: futureTermHits.length === 0,
    noForbiddenTerms: forbiddenTermHits.length === 0,
    noForbiddenActions: forbiddenActionHits.length === 0,
    noStyleSampleLeak: styleSampleLeakHits.length === 0,
    allDailyAnchorsPresent: bodyDiagnostics.hardContract.checks.allRequiredDailyAnchorsPresent !== false,
    firstPersonAndNamedSupportPresent:
      bodyDiagnostics.hardContract.checks.requiredPerspective &&
      bodyDiagnostics.hardContract.checks.requiredNamedCharacters &&
      supportingNamedCharacters.every((name) => text.includes(name)),
    structurallyComplete: bodyDiagnostics.hardContract.checks.completeTerminal && bodyDiagnostics.hardContract.checks.balancedDelimiters,
    notificationExactlyOnceAcrossTitleAndBody:
      bodyDiagnostics.hardContract.checks.notificationExactlyOnceAcrossOutput !== false
  }
  return {
    charCount: text.length,
    titleCharCount: titleText.length,
    phraseCount,
    phrasePositionRatio,
    futureTermHits,
    forbiddenTermHits,
    forbiddenActionHits,
    forbiddenActionDetails,
    styleSampleLeakHits,
    dailyTermCounts,
    bodyDiagnostics,
    checks,
    hardPass: Object.values(checks).every(Boolean) && bodyDiagnostics.hardContract.pass
  }
}

function promptExclusionTerms(value) {
  return [...new Set(
    String(value ?? '')
      .split(/[\r\n,，、;；|:：]+/)
      .map((term) => term.trim().replace(/^(?:不得|不要|禁止|不能|不可|不应|避免)\s*(?:提前)?\s*(?:回收|揭示|使用|提及|出现|写出|引用)?\s*/u, '').replace(/[。.!！?？]+$/u, '').trim())
      .filter((term) => term.length >= 2 && term.length <= 80)
  )]
}

function normalizedText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
}

function normalizedTextWithOffsets(value) {
  const source = String(value ?? '')
  let text = ''
  const offsets = []
  for (let index = 0; index < source.length; ) {
    const codePoint = source.codePointAt(index)
    const character = String.fromCodePoint(codePoint)
    const normalized = character.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
    text += normalized
    for (let offset = 0; offset < normalized.length; offset += 1) offsets.push(index)
    index += character.length
  }
  return { source, text, offsets }
}

function normalizedTermMatch(value, term) {
  const indexed = normalizedTextWithOffsets(value)
  const candidate = normalizedText(term)
  if (!candidate) return null
  const segments = [...chineseWordSegmenter.segment(indexed.source)]
  let searchFrom = 0
  while (searchFrom <= indexed.text.length - candidate.length) {
    const normalizedIndex = indexed.text.indexOf(candidate, searchFrom)
    if (normalizedIndex < 0) return null
    const sourceStart = indexed.offsets[normalizedIndex]
    const sourceEnd = indexed.offsets[normalizedIndex + candidate.length - 1]
    if ([...candidate].length <= 2) {
      const firstSegment = segments.find(
        (segment) => sourceStart >= segment.index && sourceStart < segment.index + segment.segment.length
      )
      const lastSegment = segments.find(
        (segment) => sourceEnd >= segment.index && sourceEnd < segment.index + segment.segment.length
      )
      const crossesTwoLongWords =
        firstSegment &&
        lastSegment &&
        firstSegment !== lastSegment &&
        firstSegment.isWordLike &&
        lastSegment.isWordLike &&
        [...firstSegment.segment].length > 1 &&
        [...lastSegment.segment].length > 1
      if (crossesTwoLongWords) {
        searchFrom = normalizedIndex + 1
        continue
      }
    }
    return { normalizedIndex, sourceIndex: sourceStart }
  }
  return null
}

function assertNormalizedMatcherSanity() {
  if (normalizedTermMatch('保证人物关系自然', '证人')) {
    throw new Error('Normalized term matcher crossed two Chinese word segments (保证/人物 -> 证人).')
  }
  if (!normalizedTermMatch('他确实是证人', '证人') || !normalizedTermMatch('证，人', '证人')) {
    throw new Error('Normalized term matcher failed an exact or punctuation-obfuscated Chinese term.')
  }
}

function sectionAt(prompt, offset) {
  if (offset < 0) return 'normalized-only match'
  const prefix = prompt.slice(0, offset)
  return prefix.match(/^##\s+.+$/gm)?.at(-1) ?? '[message root]'
}

function auditPrompt(prompt, spec, task, baselinePromptCharacterCount) {
  const contractMissingFields = Object.entries(task)
    .filter(([, value]) => String(value ?? '').trim())
    .filter(([, value]) => !prompt.includes(String(value)))
    .map(([field]) => field)
  const allowedConstraintTerms = new Set((spec.audit.forbiddenActions ?? []).map(normalizedText))
  const auditOnlyFutureTerms = [
    ...promptExclusionTerms(spec.task.forbiddenPayoffs),
    ...(spec.audit.promptLeakPhrases ?? []),
    ...(spec.audit.promptForbiddenPhrases ?? [])
  ].filter((term) => !allowedConstraintTerms.has(normalizedText(term)))
  const promptLeakHits = [...new Set(auditOnlyFutureTerms)]
    .map((term) => {
      const match = normalizedTermMatch(prompt, term)
      if (!match) return null
      const offset = match.sourceIndex
      return { term, offset, section: sectionAt(prompt, offset) }
    })
    .filter(Boolean)
  const promptDiagnostics = diagnoseChapterPrompt({
    prompt,
    task,
    baselinePromptCharacterCount,
    profile: spec.audit.diagnosticProfile
  })
  return {
    charCount: prompt.length,
    contractMissingFields,
    promptLeakHits,
    promptDiagnostics,
    hardPass:
      contractMissingFields.length === 0 &&
      promptLeakHits.length === 0 &&
      promptDiagnostics.hardContract.pass
  }
}

function sameIds(actual, expected) {
  const left = [...(actual ?? [])].sort()
  const right = [...(expected ?? [])].sort()
  return JSON.stringify(left) === JSON.stringify(right)
}

function auditTrace(trace, spec) {
  const expected = spec.audit.traceExpectations ?? {}
  const expectedArrayFields = [
    'selectedCharacterIds',
    'selectedForeshadowingIds',
    'includedHardCanonItemIds',
    'selectedChapterIds',
    'selectedStageSummaryIds',
    'selectedTimelineEventIds',
    'includedCharacterStateFactIds'
  ]
  const checks = {
    expectationsComplete: expectedArrayFields.every((field) => Array.isArray(expected[field])),
    tracePresent: Boolean(trace),
    exactCharacters: Boolean(trace) && sameIds(trace.selectedCharacterIds, expected.selectedCharacterIds),
    exactForeshadowing: Boolean(trace) && sameIds(trace.selectedForeshadowingIds, expected.selectedForeshadowingIds),
    exactHardCanon: Boolean(trace) && sameIds(trace.includedHardCanonItemIds, expected.includedHardCanonItemIds),
    exactChapters: Boolean(trace) && sameIds(trace.selectedChapterIds, expected.selectedChapterIds),
    exactStageSummaries: Boolean(trace) && sameIds(trace.selectedStageSummaryIds, expected.selectedStageSummaryIds),
    exactTimelineEvents: Boolean(trace) && sameIds(trace.selectedTimelineEventIds, expected.selectedTimelineEventIds),
    exactCharacterStateFacts:
      Boolean(trace) && sameIds(trace.includedCharacterStateFactIds, expected.includedCharacterStateFactIds),
    noTruncatedHardCanon: Boolean(trace) && (trace.truncatedHardCanonItemIds ?? []).length === 0,
    contextSelectionTracePresent: Boolean(trace?.contextSelectionTrace),
    noUnmetMustNeeds:
      Boolean(trace?.contextSelectionTrace) &&
      (trace.contextSelectionTrace?.unmetNeeds ?? []).every((need) => need.priority !== 'must')
  }
  return {
    expected,
    actual: trace
      ? {
          selectedCharacterIds: trace.selectedCharacterIds ?? [],
          selectedForeshadowingIds: trace.selectedForeshadowingIds ?? [],
          includedHardCanonItemIds: trace.includedHardCanonItemIds ?? [],
          selectedChapterIds: trace.selectedChapterIds ?? [],
          selectedStageSummaryIds: trace.selectedStageSummaryIds ?? [],
          selectedTimelineEventIds: trace.selectedTimelineEventIds ?? [],
          includedCharacterStateFactIds: trace.includedCharacterStateFactIds ?? [],
          truncatedHardCanonItemIds: trace.truncatedHardCanonItemIds ?? [],
          unmetNeeds: trace.contextSelectionTrace?.unmetNeeds ?? []
        }
      : null,
    checks,
    hardPass: Object.values(checks).every(Boolean)
  }
}

function auditConfiguration(settings, spec) {
  const expected = {
    provider: String(spec.audit.expectedProvider ?? ''),
    baseUrlHostname: String(spec.audit.expectedBaseUrlHostname ?? '').toLowerCase(),
    modelName: String(spec.audit.expectedModelName ?? '')
  }
  let actualHostname = ''
  let urlError = null
  try {
    actualHostname = new URL(settings.baseUrl).hostname.toLowerCase()
  } catch (error) {
    urlError = error instanceof Error ? error.message : String(error)
  }
  const actual = {
    provider: String(settings.apiProvider ?? ''),
    baseUrl: String(settings.baseUrl ?? ''),
    baseUrlHostname: actualHostname,
    modelName: String(settings.modelName ?? '')
  }
  const checks = {
    expectationsComplete: Boolean(expected.provider && expected.baseUrlHostname && expected.modelName),
    providerMatches: actual.provider === expected.provider,
    hostnameMatches: actual.baseUrlHostname === expected.baseUrlHostname,
    modelMatches: actual.modelName === expected.modelName,
    validBaseUrl: !urlError
  }
  return { expected, actual, urlError, checks, hardPass: Object.values(checks).every(Boolean) }
}

async function persistWorkbenchRequestPrompts(outputDir, runLabel, records) {
  const persisted = []
  for (const record of records) {
    let promptFile = null
    let draftResponseFile = null
    let draftRawResponseFile = null
    if (record.stage === 'plan' || record.stage === 'draft') {
      promptFile = `${runLabel}-${String(record.index).padStart(2, '0')}-${record.stage}-request-prompt.txt`
      await writeFile(join(outputDir, promptFile), record.prompt, 'utf8')
    }
    if (record.stage === 'draft' && record.draftResponse?.body) {
      draftResponseFile = `${runLabel}-${String(record.index).padStart(2, '0')}-draft-response.txt`
      const draftText = [record.draftResponse.title, record.draftResponse.body].filter(Boolean).join('\n\n')
      await writeFile(join(outputDir, draftResponseFile), draftText, 'utf8')
    }
    if (record.stage === 'draft' && record.draftRawResponse) {
      draftRawResponseFile = `${runLabel}-${String(record.index).padStart(2, '0')}-draft-raw-response.txt`
      await writeFile(join(outputDir, draftRawResponseFile), record.draftRawResponse, 'utf8')
    }
    persisted.push({
      index: record.index,
      stage: record.stage,
      method: record.method,
      pathname: record.pathname,
      model: record.model,
      promptFile,
      draftResponseFile,
      draftRawResponseFile,
      draftResponseTitle: record.draftResponse?.title ?? null,
      draftResponseVisibleCharacterCount: record.draftResponse?.body
        ? [...record.draftResponse.body.replace(/\s/gu, '')].length
        : null,
      draftRawResponseCharacterCount: record.draftRawResponse ? [...record.draftRawResponse].length : null,
      draftParseError: record.draftParseError,
      promptAudit: record.promptAudit,
      forwarded: record.forwarded,
      responseMode: record.responseMode,
      error: record.error
    })
  }
  return persisted
}

async function main() {
  assertNormalizedMatcherSanity()
  const sourcePath = resolve(valueFlag('source', 'F:/novel/novel-director-data.sqlite'))
  const specPath = resolve(valueFlag('spec', join(root, 'experiments', 'low-water-ch1-deepseek-ab.json')))
  const outputDir = resolve(valueFlag('output', join(root, 'tmp', `deepseek-workbench-ab-${timestamp()}`)))
  const runs = Math.trunc(numberFlag('runs', 1, { min: 1, max: 3 }))
  const temperature = numberFlag('temperature', 0.3, { min: 0, max: 2 })
  const preflightOnly = hasFlag('preflight-only')
  const workbenchOnly = hasFlag('workbench-only')
  const spec = JSON.parse(await readFile(specPath, 'utf8'))
  const task = modelFacingTask(spec)
  const apiKey = String(process.env.NOVEL_DIRECTOR_API_KEY ?? '').trim()
  if (!preflightOnly && !apiKey) {
    throw new Error('NOVEL_DIRECTOR_API_KEY is missing. Use scripts/run-deepseek-workbench-ab.ps1 so the key is entered locally without echoing it.')
  }
  await mkdir(tempRoot, { recursive: true })
  await assertOutputInsideTemp(outputDir)
  await mkdir(outputDir, { recursive: false })

  const sourceHashBefore = await hashFile(sourcePath)
  const settings = readSettings(sourcePath)
  const configurationAudit = auditConfiguration(settings, spec)
  if (!configurationAudit.hardPass) {
    throw new Error(`DeepSeek configuration audit failed: ${JSON.stringify(configurationAudit.checks)}`)
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    sourcePath,
    sourceHashBefore,
    sourceHashAfter: null,
    sourceUntouched: null,
    specPath,
    modelFacingTask: task,
    outputDir,
    preflightOnly,
    workbenchOnly,
    configuration: {
      provider: settings.apiProvider,
      baseUrl: settings.baseUrl,
      modelName: settings.modelName,
      temperature,
      runs: preflightOnly ? 1 : runs,
      audit: configurationAudit
    },
    directMinimal: [],
    directContract: [],
    workbench: []
  }

  const minimalTask = minimalCreativeBrief(task)
  const directMinimalMessages = buildDirectMinimalMessages(task)
  const directContractMessages = buildDirectContractMessages(task)
  const directMinimalPrompt = serializeMessages(directMinimalMessages)
  const directContractPrompt = serializeMessages(directContractMessages)
  const directMinimalPromptGate = auditPrompt(
    directMinimalPrompt,
    spec,
    minimalTask,
    directMinimalPrompt.length
  )
  const directContractPromptGate = auditPrompt(
    directContractPrompt,
    spec,
    task,
    directMinimalPrompt.length
  )
  await writeFile(join(outputDir, 'direct-minimal-prompt.txt'), directMinimalPrompt, 'utf8')
  await writeFile(join(outputDir, 'direct-contract-prompt.txt'), directContractPrompt, 'utf8')
  if (!directMinimalPromptGate.hardPass || !directContractPromptGate.hardPass) {
    throw new Error(`Direct prompt audit blocked model invocation: ${JSON.stringify({ directMinimalPromptGate, directContractPromptGate })}`)
  }

  if (!preflightOnly && !workbenchOnly) {
    for (let index = 0; index < runs; index += 1) {
      for (const arm of [
        { key: 'directMinimal', label: 'direct-minimal', messages: directMinimalMessages, promptAudit: directMinimalPromptGate },
        { key: 'directContract', label: 'direct-contract', messages: directContractMessages, promptAudit: directContractPromptGate }
      ]) {
        const direct = await generateDirect({ settings, apiKey, task, temperature, messages: arm.messages })
        const bodyAudit = auditBody(direct.body, spec, direct.title, task)
        const label = `${arm.label}-${String(index + 1).padStart(2, '0')}`
        await writeFile(join(outputDir, `${label}.txt`), direct.body, 'utf8')
        summary[arm.key].push({
          label,
          title: direct.title,
          finishReason: direct.finishReason,
          usage: direct.usage,
          promptAudit: arm.promptAudit,
          bodyAudit
        })
      }
    }
  } else if (preflightOnly) {
    summary.directMinimal.push({
      label: 'direct-minimal-preflight',
      notRunReason: 'preflight-only: no network request was made',
      promptAudit: directMinimalPromptGate,
      bodyAudit: null
    })
    summary.directContract.push({
      label: 'direct-contract-preflight',
      notRunReason: 'preflight-only: no network request was made',
      promptAudit: directContractPromptGate,
      bodyAudit: null
    })
  }

  const workbenchRuns = preflightOnly ? 1 : runs
  const auditProxy = await startWorkbenchAuditProxy({
    preflightOnly,
    upstreamSettings: settings,
    apiKey,
    spec,
    task,
    baselinePromptCharacterCount: directContractPrompt.length
  })
  try {
    for (let index = 0; index < workbenchRuns; index += 1) {
      const label = `workbench-${String(index + 1).padStart(2, '0')}`
      auditProxy.setRunLabel(label)
      const requestStart = auditProxy.requests.length
      const storagePath = join(outputDir, `${label}.sqlite`)
      const userDataPath = join(outputDir, `${label}-userdata`)
      const result = await runWorkbench({
        sourcePath,
        destinationPath: storagePath,
        userDataPath,
        spec: { ...spec, task },
        temperature,
        apiKey: preflightOnly ? 'preflight-local-sentinel' : apiKey,
        settingsPatch: {
          apiProvider: 'compatible',
          baseUrl: auditProxy.baseUrl,
          modelName: settings.modelName,
          hasApiKey: true,
          retryEnabled: false,
          maxRetries: 0,
          ...(preflightOnly
            ? {
                requestTimeoutMs: 10_000
              }
            : {})
        }
      })
      const requestRecords = auditProxy.requests.slice(requestStart)
      const requestAudit = auditWorkbenchRequests(requestRecords, {
        expectedModelName: spec.audit.expectedModelName,
        preflightOnly,
        preflightDraftStopError: PREFLIGHT_DRAFT_STOP
      })
      const requestArtifacts = await persistWorkbenchRequestPrompts(outputDir, label, requestRecords)
      const draftRequests = requestRecords.filter((record) => record.stage === 'draft')
      const finalDraftRequest = draftRequests.at(-1) ?? null
      const draftRequestTelemetry = summarizeDraftRequestTelemetry(requestRecords)
      const finalDraftTelemetry = draftRequestTelemetry.at(-1) ?? null
      const attemptBodyAudits = draftRequests.map((record) => ({
        requestIndex: record.index,
        title: record.draftResponse?.title ?? null,
        visibleCharacterCount: record.draftResponse?.body
          ? [...record.draftResponse.body.replace(/\s/gu, '')].length
          : null,
        draftParseError: record.draftParseError,
        bodyAudit: record.draftResponse?.body
          ? auditBody(record.draftResponse.body, spec, record.draftResponse.title ?? '', task)
          : null
      }))
      const body = result.artifacts.draft?.body ?? ''
      const title = result.artifacts.draft?.title ?? ''
      if (body) await writeFile(join(outputDir, `${label}.txt`), body, 'utf8')
      if (result.artifacts.prompt) await writeFile(join(outputDir, `${label}-prompt.txt`), result.artifacts.prompt, 'utf8')
      const failedStep = result.cli?.data?.failedStep ?? null
      summary.workbench.push({
        label,
        title,
        jobId: result.jobId,
        failedStep,
        awaitingAcceptance: Boolean(result.cli?.data?.awaitingAcceptance),
        execution: result.execution,
        promptAudit: auditPrompt(result.artifacts.prompt, spec, task, directContractPrompt.length),
        modelPromptAudit: finalDraftRequest?.promptAudit ?? null,
        requestAudit,
        requests: requestArtifacts,
        draftRequestTelemetry,
        attemptBodyAudits,
        finishReason: finalDraftTelemetry?.finishReason ?? null,
        usage: finalDraftTelemetry?.usage ?? null,
        bodyAudit: body ? auditBody(body, spec, title, task) : null,
        traceAudit: auditTrace(result.artifacts.trace, spec),
        trace: result.artifacts.trace
          ? {
              finalPromptTokenEstimate: result.artifacts.trace.finalPromptTokenEstimate,
              selectedCharacterIds: result.artifacts.trace.selectedCharacterIds,
              selectedForeshadowingIds: result.artifacts.trace.selectedForeshadowingIds,
              includedHardCanonItemIds: result.artifacts.trace.includedHardCanonItemIds,
              selectedChapterIds: result.artifacts.trace.selectedChapterIds,
              selectedStageSummaryIds: result.artifacts.trace.selectedStageSummaryIds,
              selectedTimelineEventIds: result.artifacts.trace.selectedTimelineEventIds,
              includedCharacterStateFactIds: result.artifacts.trace.includedCharacterStateFactIds,
              truncatedHardCanonItemIds: result.artifacts.trace.truncatedHardCanonItemIds,
              unmetNeeds: result.artifacts.trace.contextSelectionTrace?.unmetNeeds ?? [],
              contextWarnings: result.artifacts.trace.contextWarnings
            }
          : null,
        quality: result.artifacts.qualityReport
          ? {
              overallScore: result.artifacts.qualityReport.overallScore,
              pass: result.artifacts.qualityReport.pass,
              requiredFixes: result.artifacts.qualityReport.requiredFixes,
              optionalSuggestions: result.artifacts.qualityReport.optionalSuggestions,
              dimensions: result.artifacts.qualityReport.dimensions
            }
          : null
      })
    }
  } finally {
    await auditProxy.close()
  }

  const sourceHashAfter = await hashFile(sourcePath)
  summary.sourceHashAfter = sourceHashAfter
  summary.sourceUntouched = sourceHashBefore === sourceHashAfter

  const comparisonSamples = (items, promptSelector) =>
    items.map((item) => ({
      bodyDiagnostics: item.bodyAudit?.bodyDiagnostics ?? null,
      promptDiagnostics: promptSelector(item)?.promptDiagnostics ?? null
    }))
  const workbenchPromptLeakHits = summary.workbench.flatMap((item) => [
    ...(item.promptAudit?.promptLeakHits ?? []),
    ...(item.modelPromptAudit?.promptLeakHits ?? [])
  ])
  const workbenchLegacyBodyHits = summary.workbench.flatMap((item) => [
    ...(item.bodyAudit?.futureTermHits ?? []),
    ...(item.bodyAudit?.forbiddenTermHits ?? []),
    ...(item.bodyAudit?.styleSampleLeakHits ?? [])
  ])
  summary.comparison = aggregateChapterAbDiagnostics({
    arms: {
      directMinimal: comparisonSamples(summary.directMinimal, (item) => item.promptAudit),
      directContract: comparisonSamples(summary.directContract, (item) => item.promptAudit),
      workbench: comparisonSamples(summary.workbench, (item) => item.modelPromptAudit)
    },
    contextEvidence: {
      promptLeakHits: workbenchPromptLeakHits,
      ...(!preflightOnly ? { legacyBodyHits: workbenchLegacyBodyHits } : {}),
      traceExact: summary.workbench.length > 0 && summary.workbench.every((item) => item.traceAudit?.hardPass === true)
    },
    minimumRuns: 3
  })

  summary.result = preflightOnly
    ? {
        ok:
          summary.configuration.audit?.hardPass === true &&
          summary.sourceUntouched === true &&
          summary.directMinimal[0]?.promptAudit?.hardPass === true &&
          summary.directContract[0]?.promptAudit?.hardPass === true &&
          summary.workbench[0]?.promptAudit?.hardPass === true &&
          summary.workbench[0]?.modelPromptAudit?.hardPass === true &&
          summary.workbench[0]?.requestAudit?.hardPass === true &&
          summary.workbench[0]?.traceAudit?.hardPass === true &&
          summary.workbench[0]?.execution?.exitCode === 0 &&
          summary.workbench[0]?.failedStep?.type === 'generate_chapter_draft' &&
          String(summary.workbench[0]?.failedStep?.errorMessage ?? '').includes(PREFLIGHT_DRAFT_STOP) &&
          summary.workbench[0]?.awaitingAcceptance === false &&
          summary.workbench[0]?.bodyAudit === null,
        expectation: '无密钥预演必须证明权威第一章不向模型请求重复计划，只发出一次通过审计的正文请求，并在本地有意停止。上下文必须只选择任务点名角色，且既有章节、阶段摘要、时间线、状态事实、伏笔与 HardCanon 全部为零；持久化 rogue plan 的正文边界净化由 Agent pipeline 回归独立覆盖。'
      }
    : {
        ...(workbenchOnly ? { mode: 'workbench-only' } : {}),
        ok:
          summary.configuration.audit?.hardPass === true &&
          summary.sourceUntouched === true &&
          (workbenchOnly ||
            (summary.directMinimal.length === runs &&
              summary.directMinimal.every((item) => item.promptAudit?.hardPass) &&
              summary.directContract.length === runs &&
              summary.directContract.every((item) => item.promptAudit?.hardPass))) &&
          summary.workbench.length === runs &&
          summary.workbench.every(
            (item) =>
              item.promptAudit?.hardPass &&
              item.modelPromptAudit?.hardPass &&
              item.requestAudit?.hardPass &&
              item.traceAudit?.hardPass &&
              !item.failedStep &&
              item.awaitingAcceptance &&
              item.execution?.exitCode === 0
          ),
        hardContractPass:
          (workbenchOnly ||
            (summary.directMinimal.every((item) => item.bodyAudit?.hardPass) &&
              summary.directContract.every((item) => item.bodyAudit?.hardPass))) &&
          summary.workbench.every((item) => item.bodyAudit?.hardPass),
        directMinimalHardPassCount: summary.directMinimal.filter((item) => item.bodyAudit?.hardPass).length,
        directMinimalPromptPassCount: summary.directMinimal.filter((item) => item.promptAudit?.hardPass).length,
        directContractHardPassCount: summary.directContract.filter((item) => item.bodyAudit?.hardPass).length,
        directContractPromptPassCount: summary.directContract.filter((item) => item.promptAudit?.hardPass).length,
        workbenchHardPassCount: summary.workbench.filter((item) => item.bodyAudit?.hardPass).length,
        workbenchPromptPassCount: summary.workbench.filter((item) => item.promptAudit?.hardPass).length,
        workbenchModelPromptPassCount: summary.workbench.filter((item) => item.modelPromptAudit?.hardPass).length,
        workbenchRequestPassCount: summary.workbench.filter((item) => item.requestAudit?.hardPass).length,
        workbenchTracePassCount: summary.workbench.filter((item) => item.traceAudit?.hardPass).length,
        workbenchQualityPassCountAdvisory: summary.workbench.filter(
          (item) => item.quality?.pass === true && (item.quality.requiredFixes ?? []).length === 0
        ).length,
        workbenchCompletedCount: summary.workbench.filter((item) => !item.failedStep && item.awaitingAcceptance).length,
        interpretation: 'ok 只表示三臂实验与工作台流水线完整执行；hardContractPass 单独表示正文硬契约，AI quality 与风格启发式仅作旁证。'
      }

  const summaryPath = join(outputDir, 'summary.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: summary.result.ok, summaryPath, result: summary.result }, null, 2))
  if (!summary.result.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
  process.exit(1)
})
