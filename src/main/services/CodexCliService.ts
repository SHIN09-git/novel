import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import type { ChatCompletionRequest, ChatCompletionResult, CodexCliStatusResult } from '../../shared/ipc/ipcTypes'

interface CodexCliLogger {
  info(message: string): void
  warn(message: string): void
}

interface CodexCliCompletionInput {
  command: string
  model: string
  messages: ChatCompletionRequest['messages']
  maxTokens: number
  signal: AbortSignal
  timeoutMs: number
}

interface ProcessResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

interface SpawnInvocation {
  command: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

const MAX_CAPTURE_BYTES = 4 * 1024 * 1024
const STATUS_TIMEOUT_MS = 8_000
const CODEX_EXECUTABLE_NAMES = new Set(['codex', 'codex.exe', 'codex.cmd', 'codex.bat'])

function trimBom(value: string): string {
  return value.replace(/^\uFEFF/, '').trim()
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validateCodexCommand(command: string): string {
  const normalized = command.trim() || 'codex'
  if (normalized.length > 1_000 || /[\0\r\n]/.test(normalized)) {
    throw new Error('Codex CLI 路径无效。')
  }

  if (!isAbsolute(normalized) && !normalized.includes('/') && !normalized.includes('\\')) {
    if (normalized.toLowerCase() !== 'codex') {
      throw new Error('CLI 命令只允许使用 codex，或选择 codex/codex.exe/codex.cmd 的绝对路径。')
    }
    return normalized
  }

  const resolved = resolve(normalized)
  if (!CODEX_EXECUTABLE_NAMES.has(basename(resolved).toLowerCase())) {
    throw new Error('所选文件不是 Codex CLI 可执行文件。')
  }
  return resolved
}

function validateCodexModel(model: string): string {
  const normalized = model.trim()
  if (!normalized) return ''
  if (normalized.length > 200 || !/^[A-Za-z0-9._:/-]+$/.test(normalized)) {
    throw new Error('Codex CLI 模型名包含不支持的字符。')
  }
  return normalized
}

function quoteWindowsCommandArgument(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error('Codex CLI 参数无效。')
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`
}

function createSpawnInvocation(executable: string, args: string[]): SpawnInvocation {
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(extname(executable))) {
    return { command: executable, args }
  }

  const commandLine = [executable, ...args].map(quoteWindowsCommandArgument).join(' ')
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true
  }
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
      shell: false
    })
    killer.unref()
    return
  }
  child.kill('SIGKILL')
}

async function runCapturedProcess(
  executable: string,
  args: string[],
  options: {
    cwd?: string
    stdin?: string
    signal?: AbortSignal
    timeoutMs: number
  }
): Promise<ProcessResult> {
  const invocation = createSpawnInvocation(executable, args)
  const child = spawn(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    shell: false
  })

  return await new Promise<ProcessResult>((resolvePromise, reject) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let terminalError: Error | null = null
    let settled = false

    const cleanup = () => {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }
    const failAfterClose = (error: Error) => {
      if (terminalError) return
      terminalError = error
      terminateProcessTree(child)
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 150)
      forceKill.unref()
    }
    const onAbort = () => failAfterClose(new Error('Codex CLI 调用已取消。'))
    const timeout = setTimeout(() => {
      failAfterClose(new Error(`Codex CLI 调用超过 ${Math.ceil(options.timeoutMs / 1_000)} 秒，已终止。`))
    }, options.timeoutMs)

    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_CAPTURE_BYTES) {
        failAfterClose(new Error('Codex CLI 标准输出过大，已终止。'))
        return
      }
      stdoutChunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_CAPTURE_BYTES) {
        failAfterClose(new Error('Codex CLI 错误输出过大，已终止。'))
        return
      }
      stderrChunks.push(chunk)
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
    child.once('close', (exitCode) => {
      if (settled) return
      settled = true
      cleanup()
      if (terminalError) {
        reject(terminalError)
        return
      }
      resolvePromise({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8')
      })
    })

    child.stdin.once('error', () => {
      // The close/error handlers above own the final result.
    })
    child.stdin.end(options.stdin ?? '')
  })
}

export function formatCodexCliPrompt(
  messages: ChatCompletionRequest['messages'],
  maxTokens: number
): string {
  const formattedMessages = messages.map((message, index) => {
    const label = message.role === 'system' ? '系统指令' : '用户任务'
    return `## ${label} ${index + 1}\n${message.content}`
  })

  return [
    '你是 Novel Director 的非交互式文本生成后端。',
    '只完成下面的文本任务并返回最终答案。不要读取本机文件、执行命令、修改工作区、浏览网络或调用外部工具。',
    '不要输出分析过程、执行日志或额外说明。若任务要求 JSON，只输出可直接解析的 JSON。',
    `输出应尽量控制在 ${Math.max(1, Math.floor(maxTokens))} token 以内。`,
    ...formattedMessages
  ].join('\n\n')
}

// P0 Codex CLI provider: the process runs in an empty temporary directory and
// reuses the user's existing `codex login` session. No auth token is exposed to
// the renderer or persisted in AppData.
export class CodexCliService {
  constructor(private readonly logger: CodexCliLogger) {}

  async getStatus(command = 'codex'): Promise<CodexCliStatusResult> {
    try {
      const executable = await this.resolveExecutable(command)
      const versionResult = await runCapturedProcess(executable, ['--version'], {
        timeoutMs: STATUS_TIMEOUT_MS
      })
      if (versionResult.exitCode !== 0) {
        throw new Error(trimBom(versionResult.stderr) || '无法读取 Codex CLI 版本。')
      }
      const loginResult = await runCapturedProcess(executable, ['login', 'status'], {
        timeoutMs: STATUS_TIMEOUT_MS
      })
      const loginText = trimBom(`${loginResult.stdout}\n${loginResult.stderr}`)
      const authenticationMode = /chatgpt/i.test(loginText)
        ? 'chatgpt'
        : /api[ _-]?key/i.test(loginText)
          ? 'api_key'
          : 'unknown'
      const authenticated = loginResult.exitCode === 0
      return {
        ok: true,
        available: true,
        authenticated,
        authenticationMode,
        resolvedPath: executable,
        version: trimBom(versionResult.stdout || versionResult.stderr),
        message:
          authenticated && authenticationMode === 'chatgpt'
            ? 'Codex CLI 已安装，并已通过 ChatGPT 登录，可以使用当前 Codex 计划额度。'
            : authenticated && authenticationMode === 'api_key'
              ? 'Codex CLI 当前使用 API Key 登录；调用可能计入 API 账单，而不是 ChatGPT/Codex 计划额度。'
              : authenticated
                ? 'Codex CLI 已登录，但无法确认登录方式。请在终端运行 codex login status 核对是否为 ChatGPT 登录。'
            : 'Codex CLI 已安装，但尚未登录。请先在终端运行 codex login。'
      }
    } catch (error) {
      return {
        ok: true,
        available: false,
        authenticated: false,
        authenticationMode: 'unknown',
        message: `未找到可用的 Codex CLI：${safeErrorMessage(error)}`
      }
    }
  }

  async chatCompletion(input: CodexCliCompletionInput): Promise<ChatCompletionResult> {
    const executable = await this.resolveExecutable(input.command)
    const model = validateCodexModel(input.model)
    const workspace = await mkdtemp(join(tmpdir(), 'novel-director-codex-'))
    const outputPath = join(workspace, 'last-message.txt')
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--color',
      'never',
      '--output-last-message',
      outputPath
    ]
    if (model) args.push('--model', model)
    args.push('-')

    this.logger.info(
      `Codex CLI request: model=${model || 'cli-default'}, messages=${input.messages.length}, promptCharacters=${input.messages.reduce((sum, item) => sum + item.content.length, 0)}`
    )

    try {
      const result = await runCapturedProcess(executable, args, {
        cwd: workspace,
        stdin: formatCodexCliPrompt(input.messages, input.maxTokens),
        signal: input.signal,
        timeoutMs: input.timeoutMs
      })
      if (result.exitCode !== 0) {
        const stderr = trimBom(result.stderr).slice(0, 800)
        if (/login|not authenticated|unauthorized|sign in/i.test(stderr)) {
          throw new Error('Codex CLI 尚未登录，请先在终端运行 codex login。')
        }
        throw new Error(`Codex CLI 执行失败（退出码 ${result.exitCode ?? 'unknown'}）：${stderr || '没有错误详情。'}`)
      }

      let content = ''
      try {
        content = trimBom(await readFile(outputPath, 'utf8'))
      } catch {
        content = trimBom(result.stdout)
      }
      if (!content) {
        this.logger.warn('Codex CLI returned an empty final message.')
        return { ok: false, error: 'Codex CLI 返回了空内容。请检查登录状态、模型权限和运行日志。' }
      }
      return { ok: true, content, finishReason: 'stop' }
    } finally {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async resolveExecutable(command: string): Promise<string> {
    const validated = validateCodexCommand(command)
    if (isAbsolute(validated)) {
      await access(validated, fsConstants.X_OK).catch(async () => {
        await access(validated, fsConstants.F_OK)
      })
      return validated
    }

    const finder = process.platform === 'win32' ? 'where.exe' : 'which'
    const result = await runCapturedProcess(finder, [validated], { timeoutMs: STATUS_TIMEOUT_MS })
    if (result.exitCode !== 0) throw new Error('PATH 中没有 codex 命令。')
    const candidates = result.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => CODEX_EXECUTABLE_NAMES.has(basename(item).toLowerCase()))
    const executable = candidates.find((item) => /\.exe$/i.test(item)) ?? candidates[0]
    if (!executable) throw new Error('PATH 中没有有效的 Codex CLI 可执行文件。')
    return executable
  }
}
