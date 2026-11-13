import { execFile } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { repoRoot } from '../../../scripts/utils/repo-root.mjs'

const parent = resolve(repoRoot, 'tmp')
await mkdir(parent, { recursive: true })
const dir = await mkdtemp(join(parent, 'library-recovery-ui-'))
try {
  const common = { absWorkingDir: repoRoot, bundle: true, logLevel: 'silent' }
  await build({ ...common, entryPoints: ['src/renderer/src/main.tsx'], outfile: join(dir, 'ui.js'),
    jsx: 'automatic', loader: { '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"development"' } })
  for (const [entry, name] of [['src/preload/index.ts', 'preload'], ['src/renderer/tests/library-recovery-window.mjs', 'verify']]) {
    await build({ ...common, entryPoints: [entry], outfile: join(dir, name + '.cjs'),
      platform: 'node', format: 'cjs', external: ['electron'] })
  }
  await writeFile(join(dir, 'index.html'), `<!doctype html><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; connect-src 'none'">
    <link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron'),
    [join(dir, 'verify.cjs'), '--user-data-dir=' + join(dir, 'profile'), '--disable-background-networking'],
    { env, windowsHide: true, timeout: 60_000 })
  assert.match(stdout, /PASS library recovery/)
  console.log(stdout.trim())
} finally {
  assert.equal(dirname(resolve(dir)), parent)
  await rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 })
}
