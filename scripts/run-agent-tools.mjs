#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAgentMcp } from './utils/build-agent-mcp.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'tmp', 'agent-tools')
const { outfile } = await buildAgentMcp(root, join(outDir, 'agent-tools-server.mjs'), { cache: true })

const child = spawn(process.execPath, [outfile, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? '1' },
  stdio: 'inherit',
  shell: false
})

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
