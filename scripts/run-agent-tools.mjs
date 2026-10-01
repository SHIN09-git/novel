#!/usr/bin/env node
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'tmp', 'agent-tools')
const outfile = join(outDir, 'agent-tools-server.mjs')

await mkdir(outDir, { recursive: true })

await build({
  entryPoints: [join(root, 'src', 'agent', 'mcp', 'server.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['better-sqlite3', 'electron'],
  logLevel: 'silent'
})

const child = spawn(process.execPath, [outfile, ...process.argv.slice(2)], {
  cwd: root,
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
