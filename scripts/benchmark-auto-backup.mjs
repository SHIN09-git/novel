import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createLongNovelFixture } from './fixtures/long-novel-performance.mjs'
import { repoRoot } from './utils/repo-root.mjs'

// Run unchanged against each revision. Times include real publication/rotation and parsing.
const chapters = Number(process.argv[2] ?? 500)
const root = join(repoRoot, 'tmp')
await mkdir(root, { recursive: true })
const dir = await mkdtemp(join(root, 's4-backup-bench-'))
try {
  const entry = join(dir, 'backup.mjs')
  await build({ stdin: { resolveDir: repoRoot, contents: [
    "export { BackupService } from './src/main/BackupService'",
    "export { normalizeAppData } from './src/shared/defaults'"
  ].join('\n') }, outfile: entry, bundle: true, format: 'esm', platform: 'node' })
  const { BackupService, normalizeAppData } = await import(pathToFileURL(entry).href)
  const data = normalizeAppData(createLongNovelFixture(chapters))
  const service = new BackupService(dir), snapshotBytes = Buffer.byteLength(JSON.stringify(data))
  const samples = { due: [], notDue: [], read: [] }
  async function time(key, fn, warmup) {
    const before = performance.now(), value = await fn()
    if (!warmup) samples[key].push(performance.now() - before)
    return value
  }
  let path
  for (let day = 0; day < 8; day++) {
    const now = Date.now, simulated = now() + day * 25 * 3600000
    Date.now = () => simulated
    try {
      path = await time('due', () => service.maybeCreateAutomaticBackup(async () => data), day === 0)
      assert.ok(path)
      assert.equal(await time('notDue', () => service.maybeCreateAutomaticBackup(() => {
        throw new Error('non-due backup read the library')
      }), day === 0), null)
      const restored = await time('read', () => service.loadBackup(path), day === 0)
      assert.deepEqual(restored, data)
    } finally { Date.now = now }
  }
  const folder = service.getBackupDir(), files = await readdir(folder)
  const retained = await Promise.all(files.map(name => stat(join(folder, name))))
  console.log(JSON.stringify({ node: process.version, chapters, snapshotBytes, autoBytes: (await stat(path)).size,
    retainedFiles: files.length, retainedBytes: retained.reduce((sum, s) => sum + s.size, 0),
    timingsMs: Object.fromEntries(Object.entries(samples).map(([key, v]) => {
      v.sort((a, b) => a - b)
      return [key, { n: v.length, median: +v[3].toFixed(2), max: +v.at(-1).toFixed(2) }]
    })) }, null, 2))
} finally { await rm(dir, { recursive: true, force: true }) }
