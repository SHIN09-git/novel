import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'

export async function buildAgentMcp(root, outfile) {
  await mkdir(dirname(outfile), { recursive: true })
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
}
