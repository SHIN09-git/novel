#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const serverScript = join(root, 'scripts', 'run-agent-tools.mjs')
const serverName = 'novel-director'

function findCodexCommand() {
  if (process.env.CODEX_CLI_PATH?.trim()) return process.env.CODEX_CLI_PATH.trim()
  if (process.platform !== 'win32') return 'codex'
  const located = spawnSync('where.exe', ['codex'], { encoding: 'utf8', shell: false })
  const first = located.status === 0 ? located.stdout.split(/\r?\n/).find((line) => line.trim()) : null
  return first?.trim() || 'codex.cmd'
}

function runCodex(args, allowFailure = false) {
  const result = spawnSync(findCodexCommand(), args, {
    cwd: root,
    encoding: 'utf8',
    stdio: allowFailure ? 'pipe' : 'inherit',
    shell: false
  })
  if (!allowFailure && result.status !== 0) {
    throw new Error(`Codex 命令执行失败（exit ${result.status ?? 'unknown'}）。`)
  }
  return result
}

function isRegistered() {
  return runCodex(['mcp', 'get', serverName], true).status === 0
}

const mode = process.argv.includes('--check') ? 'check' : process.argv.includes('--remove') ? 'remove' : 'install'

if (mode === 'check') {
  if (!isRegistered()) {
    console.error('Novel Director 尚未注册到 Codex。请运行 npm.cmd run agent:setup:codex。')
    process.exit(1)
  }
  runCodex(['mcp', 'get', serverName])
  process.exit(0)
}

if (mode === 'remove') {
  if (isRegistered()) runCodex(['mcp', 'remove', serverName])
  console.log('Novel Director Codex MCP 已移除。')
  process.exit(0)
}

if (isRegistered()) runCodex(['mcp', 'remove', serverName])
runCodex(['mcp', 'add', serverName, '--', process.execPath, serverScript])

if (!isRegistered()) throw new Error('Codex MCP 注册后校验失败。')
console.log('Novel Director 已注册到 Codex。重新打开一个 Codex 任务后，可直接使用 agent.* 工具，无需 Computer Use。')
