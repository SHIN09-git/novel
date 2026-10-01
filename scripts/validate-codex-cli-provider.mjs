#!/usr/bin/env node
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const checks = []

function check(name, ok, details = '') {
  checks.push({ name, ok: Boolean(ok), details })
}

async function read(relativePath) {
  return await readFile(join(repoRoot, relativePath), 'utf8')
}

async function loadCodexCliService(tempRoot) {
  const source = await read('src/main/services/CodexCliService.ts')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    },
    fileName: 'CodexCliService.ts'
  })
  const modulePath = join(tempRoot, 'CodexCliService.mjs')
  await writeFile(modulePath, transpiled.outputText, 'utf8')
  return await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`)
}

async function createFakeCodex(tempRoot) {
  const fixturePath = join(tempRoot, 'fake-codex.mjs')
  await writeFile(
    fixturePath,
    `import { readFile, writeFile } from 'node:fs/promises'
const args = process.argv.slice(2)
if (args[0] === '--version') {
  console.log('codex-cli 9.9.9-fixture')
  process.exit(0)
}

if (args[0] === 'login' && args[1] === 'status') {
  console.log('Logged in using ChatGPT')
  process.exit(0)
}
if (args[0] !== 'exec') process.exit(2)
const modelIndex = args.indexOf('--model')
const model = modelIndex >= 0 ? args[modelIndex + 1] : ''
if (model === 'slow-model') await new Promise((resolve) => setTimeout(resolve, 5000))
let prompt = ''
for await (const chunk of process.stdin) prompt += chunk.toString('utf8')
const outputIndex = args.indexOf('--output-last-message')
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : ''
const result = JSON.stringify({ ok: true, model, hasSystem: prompt.includes('系统指令'), hasUser: prompt.includes('用户任务') })
if (outputPath) await writeFile(outputPath, result, 'utf8')
else console.log(result)
`,
    'utf8'
  )

  if (process.platform === 'win32') {
    const commandPath = join(tempRoot, 'codex.cmd')
    await writeFile(commandPath, `@echo off\r\n"${process.execPath}" "${fixturePath}" %*\r\n`, 'utf8')
    return commandPath
  }

  const commandPath = join(tempRoot, 'codex')
  await writeFile(commandPath, `#!/bin/sh\nexec "${process.execPath}" "${fixturePath}" "$@"\n`, 'utf8')
  await chmod(commandPath, 0o755)
  return commandPath
}

async function loadPipelineRunContext(relativePath = 'src/services/PipelineRunContextService.ts') {
  const result = await build({
    entryPoints: [join(repoRoot, relativePath)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent'
  })
  const source = result.outputFiles[0]?.text
  if (!source) throw new Error('Unable to bundle PipelineRunContextService.')
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'novel-director-codex-test-'))
  try {
    const { CodexCliService, formatCodexCliPrompt } = await loadCodexCliService(tempRoot)
    const command = await createFakeCodex(tempRoot)
    const logs = []
    const service = new CodexCliService({
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message)
    })

    const status = await service.getStatus(command)
    check('fake Codex CLI is detected', status.available && status.authenticated)
    check('ChatGPT subscription login is distinguished from API-key login', status.authenticationMode === 'chatgpt')
    check('Codex CLI version is reported', status.version === 'codex-cli 9.9.9-fixture')

    const controller = new AbortController()
    const result = await service.chatCompletion({
      command,
      model: 'fixture-model',
      messages: [
        { role: 'system', content: '只返回 JSON。' },
        { role: 'user', content: '生成测试结果。' }
      ],
      maxTokens: 800,
      signal: controller.signal,
      timeoutMs: 5_000
    })
    assert.equal(result.ok, true)
    const parsed = JSON.parse(result.content)
    check('stdin prompt reaches Codex CLI', parsed.hasSystem && parsed.hasUser)
    check('optional CLI model is passed through', parsed.model === 'fixture-model')
    check('prompt forbids file/tool side effects', /不要读取本机文件、执行命令、修改工作区/.test(formatCodexCliPrompt([], 100)))
    check('logs do not contain prompt content', logs.every((line) => !line.includes('生成测试结果')))

    const timeoutStartedAt = Date.now()
    let timeoutMessage = ''
    try {
      await service.chatCompletion({
        command,
        model: 'slow-model',
        messages: [{ role: 'user', content: '慢请求' }],
        maxTokens: 100,
        signal: new AbortController().signal,
        timeoutMs: 250
      })
    } catch (error) {
      timeoutMessage = error instanceof Error ? error.message : String(error)
    }
    const timeoutElapsedMs = Date.now() - timeoutStartedAt
    check(
      'CLI hard timeout terminates a hanging process',
      /超过|终止/.test(timeoutMessage) && timeoutElapsedMs < 4_000,
      `elapsedMs=${timeoutElapsedMs}, message=${timeoutMessage}`
    )

    const types = `${await read('src/shared/types/base.ts')}\n${await read('src/shared/types/appData.ts')}\n${await read('src/shared/types/generation.ts')}`
    const defaults = await read('src/shared/defaults/index.ts')
    const aiService = await read('src/main/services/AIService.ts')
    const aiIpc = await read('src/main/ipc/aiIpcHandlers.ts')
    const preload = await read('src/preload/index.ts')
    const settingsUi = await read('src/renderer/src/views/settings/SettingsCorePanels.tsx')
    const pipelineConfig = await loadPipelineRunContext()
    const { validateChatCompletionRequest } = await loadPipelineRunContext('src/main/ipc/aiChatValidation.ts')
    const request = { settings: { apiProvider: 'compatible', baseUrl: 'http://127.0.0.1:12345', modelName: 'fixture',
      codexCliPath: '', codexCliModel: '', temperature: 0, maxTokens: 256 }, messages: [{ role: 'user', content: '测试请求' }] }
    for (const apiProvider of ['compatible', 'openai', 'local']) {
      const validated = validateChatCompletionRequest({ ...request, settings: { ...request.settings, apiProvider } })
      check(`${apiProvider} ignores unused blank CLI configuration`, validated.settings.apiProvider === apiProvider && validated.settings.modelName === 'fixture')
    }
    assert.throws(() => validateChatCompletionRequest({ ...request, settings: { ...request.settings, apiProvider: 'codex_cli' } }), /Codex CLI path/)
    check('Codex requests still validate the actual CLI path', true)

    check('codex_cli is a supported provider type', types.includes("'codex_cli'"))
    check('old projects receive safe CLI defaults', defaults.includes("codexCliPath: 'codex'") && defaults.includes("codexCliModel: ''"))
    check('main AI transport routes Codex CLI without API key', aiService.includes("settings.apiProvider === 'codex_cli'") && aiService.includes('codexCliService.chatCompletion'))
    check('Codex status IPC is exposed through preload', aiIpc.includes('AI_CODEX_CLI_STATUS') && preload.includes('getCodexCliStatus'))
    check('settings UI exposes Codex CLI provider and login check', settingsUi.includes('Codex CLI（订阅登录）') && settingsUi.includes('检测 Codex CLI'))
    const runSettings = {
      apiProvider: 'codex_cli',
      apiKey: 'SHOULD_NOT_ENTER_RUN_SNAPSHOT',
      hasApiKey: false,
      baseUrl: 'https://example.invalid/v1',
      modelName: 'unused-http-model',
      codexCliPath: command,
      codexCliModel: 'fixture-model',
      temperature: 0.4,
      maxTokens: 800,
      retryEnabled: true,
      maxRetries: 2,
      requestTimeoutMs: 300_000,
      enableAutoSummary: false,
      enableChapterDiagnostics: false,
      defaultTokenBudget: 16_000,
      defaultPromptMode: 'standard',
      theme: 'system'
    }
    const runSnapshot = pipelineConfig.createPipelineAIRunConfig(runSettings)
    const roleSettings = pipelineConfig.resolvePipelineRoleSettings(runSnapshot, runSettings, 'prose')
    check(
      'pipeline run snapshot freezes CLI path and model',
      runSnapshot.codexCliPath === command &&
        runSnapshot.codexCliModel === 'fixture-model' &&
        roleSettings.codexCliPath === command &&
        roleSettings.codexCliModel === 'fixture-model' &&
        !JSON.stringify(runSnapshot).includes(runSettings.apiKey),
      {
        snapshot: { codexCliPath: runSnapshot.codexCliPath, codexCliModel: runSnapshot.codexCliModel },
        role: { codexCliPath: roleSettings.codexCliPath, codexCliModel: roleSettings.codexCliModel }
      }
    )

    const failed = checks.filter((item) => !item.ok)
    if (failed.length) {
      console.error(JSON.stringify({ ok: false, failed }, null, 2))
      process.exitCode = 1
      return
    }
    console.log(JSON.stringify({ ok: true, totalChecks: checks.length }, null, 2))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

await main()
