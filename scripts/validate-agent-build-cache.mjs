import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { appendFile, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const self = fileURLToPath(import.meta.url)
const repo = dirname(dirname(self))
const helper = 'scripts/utils/build-agent-mcp.mjs'
const cli = 'scripts/run-agent.mjs'
const mcp = 'scripts/run-agent-tools.mjs'
const packaged = 'scripts/build-packaged-agent.mjs'
const cliEntry = 'src/agent/cli.ts'
const mcpEntry = 'src/agent/mcp/server.ts'

async function check(root) {
  const path = f => join(root, f)
  async function put(f, contents) {
    await mkdir(dirname(path(f)), { recursive: true })
    await writeFile(path(f), contents)
  }
  for (const f of [helper, cli, mcp, packaged]) {
    await mkdir(dirname(path(f)), { recursive: true })
    await copyFile(join(repo, f), path(f))
  }
  // Forward to the real compiler, recording actual build invocations (not cache timestamps).
  await put('node_modules/esbuild/package.json', '{"type":"module","exports":"./index.js"}')
  await put('node_modules/esbuild/index.js', `
    import esbuild from ${JSON.stringify(import.meta.resolve('esbuild'))}
    import { appendFileSync, writeFileSync } from 'node:fs'
    export const version = process.env.FIXTURE_ESBUILD_VERSION || esbuild.version
    export async function build(opts) {
      appendFileSync(${JSON.stringify(path('calls.log'))}, 'build\\n')
      const result = await esbuild.build(opts)
      if (process.env.FIXTURE_SWAP_MAIN) writeFileSync(${JSON.stringify(path('node_modules/fixture-pkg/package.json'))}, '{"main":"b.js"}')
      return result
    }
  `)
  await put(cliEntry, 'import { v } from "./dep"; console.log("cli", v)')
  await put(mcpEntry, 'import { v } from "../dep"; console.log("mcp", v)')
  await put('src/agent/dep.ts', 'export { v } from "fixture-pkg"')
  await put('node_modules/fixture-pkg/package.json', '{"main":"a.js"}')
  const dep = 'node_modules/fixture-pkg/a.js'
  await put(dep, 'export const v = 11')
  await put('node_modules/fixture-pkg/b.js', 'export const v = 33')
  const out = path('tmp/agent-cli/agent-cli.mjs')
  const stamp = out + '.cache.json'
  const current = async base => {
    const { output } = JSON.parse(await readFile(base + '.cache.json', 'utf8'))
    return base.replace(/\.mjs$/, '.' + output + '.mjs')
  }
  const node = async (args, env) => (await run(process.execPath, args, {
    cwd: tmpdir(), env: { ...process.env, ...env }
  })).stdout.trim()
  const calls = async () => (await readFile(path('calls.log'), 'utf8')).trim().split('\n').length
  const start = (script, env) => node([path(script)], env)
  const checkCalls = async (count, label, op) => {
    const before = await calls()
    await op()
    assert.equal(await calls() - before, count, label + ': unexpected esbuild invocation count')
  }
  assert.equal(await start(cli), 'cli 11')
  assert.equal(await start(mcp), 'mcp 11')
  assert.equal(await calls(), 2)
  await checkCalls(0, 'unchanged CLI after first build creates calls.log', async () => assert.equal(await start(cli), 'cli 11'))
  await checkCalls(0, 'unchanged MCP', async () => assert.equal(await start(mcp), 'mcp 11'))
  const mtime = (await stat(path(dep))).mtime
  await put(dep, 'export const v = 22')
  await utimes(path(dep), mtime, mtime)
  assert.equal(await start(cli), 'cli 22')
  await put(dep, 'export const v = 23')
  assert.equal(await start(cli, { FIXTURE_SWAP_MAIN: '1' }), 'cli 23')
  assert.equal(await start(cli), 'cli 33')
  await put('src/agent/dep.tsx', 'export const v = 44')
  assert.equal(await start(cli), 'cli 44')
  for (const [f, contents] of [['package-lock.json', '{}'], ['tsconfig.json', '{}'], ['package.json', '{}']]) {
    await put(f, contents)
    await checkCalls(1, f, () => start(cli))
  }
  await appendFile(path(helper), '\n// fixture builder update\n')
  await checkCalls(1, 'builder implementation', () => start(cli))
  await checkCalls(1, 'esbuild version', () => start(cli, { FIXTURE_ESBUILD_VERSION: 'test-next' }))
  const buildArgs = [self, '--build', root, out, cliEntry]
  assert.equal(await node([...buildArgs, 'es2020']), 'built')
  assert.equal(await node([...buildArgs, 'es2020']), 'hit')
  assert.equal(await node([...buildArgs, 'es2022']), 'built')
  await rm(await current(out))
  assert.equal(await node([...buildArgs, 'es2022']), 'built')
  await writeFile(await current(out), 'broken')
  assert.equal(await node([...buildArgs, 'es2022']), 'built')
  await writeFile(stamp, '{')
  assert.equal(await node([...buildArgs, 'es2022']), 'built')
  console.log('PASS: both source launchers, reuse, content/resolver/tool/options invalidation and damaged cache')

  const oldPath = await current(out)
  const previous = await readFile(oldPath)
  await put('src/agent/dep.tsx', 'export const v = ;')
  await assert.rejects(start(cli), /Build failed/)
  assert.deepEqual(await readFile(await current(out)), previous)
  await put('src/agent/dep.tsx', 'export const v = "' + 'z'.repeat(1000000) + '".length')
  const golden = path('tmp/golden/agent-cli.mjs')
  await node([self, '--build', root, golden, cliEntry])
  const next = await readFile(await current(golden))
  assert.ok(next.length > 1000000)
  let building = true, observations = 0
  const observe = async () => {
    do {
      const bytes = await readFile(await current(out))
      assert.ok(bytes.equals(previous) || bytes.equals(next), 'reader saw an incomplete generation')
      observations++
    } while (building)
  }
  const launches = Promise.allSettled(Array.from({ length: 6 }, () => start(cli))).finally(() => { building = false })
  const [results, observation] = await Promise.allSettled([launches, observe()])
  for (const result of results.value) {
    if (result.status === 'rejected') throw result.reason
    assert.equal(result.value, 'cli 1000000')
  }
  if (observation.status === 'rejected') throw observation.reason
  assert.ok(observations > 1)
  await checkCalls(0, 'hot start after concurrent publication', () => start(cli))
  assert.deepEqual(await readFile(oldPath), previous)
  assert.deepEqual(await readFile(await current(out)), next)
  assert.ok(!(await readdir(dirname(out))).some(f => f.endsWith('.tmp')))
  console.log(`PASS: failed build preserves previous bundle; six concurrent launches, ${observations} complete reads`)

  await checkCalls(2, 'forced release builds', async () => { await start(packaged); await start(packaged) })
  const release = path('out/agent/server.mjs')
  assert.equal(await node([release]), 'mcp 1000000')
  await start(mcp)
  assert.deepEqual(await readFile(release), await readFile(await current(path('tmp/agent-tools/agent-tools-server.mjs'))))
  assert.deepEqual(await readdir(dirname(release)), ['server.mjs'])
  console.log('PASS: release entry always builds, matches source bundle and ships no cache files')
}

async function measure(dir) {
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(1)
  for (const entry of [cliEntry, mcpEntry]) {
    const forced = [], cold = [], hot = []
    for (let i = 0; i < 5; i++) {
      const out = join(dir, String(i), entry + '.mjs')
      for (const [expected, times, mode] of [['built', forced, 'force'], ['built', cold, 'cache'], ['hit', hot, 'cache']]) {
        const t = performance.now()
        const { stdout } = await run(process.execPath, [self, '--build', repo, out, entry, 'node22', mode])
        times.push(performance.now() - t)
        assert.equal(stdout.trim(), expected)
      }
      const { output } = JSON.parse(await readFile(out + '.cache.json', 'utf8'))
      assert.deepEqual(await readFile(out), await readFile(out.replace(/\.mjs$/, '.' + output + '.mjs')))
    }
    console.log(`${entry}: median of 5 fresh Node processes per state (including startup): force ${median(forced)} ms, cold ${median(cold)} ms, hot ${median(hot)} ms`)
  }
}

if (process.argv[2] === '--build') {
  const [, , , root, outfile, entry, target, mode] = process.argv
  const { buildAgentMcp } = await import(pathToFileURL(join(root, helper)))
  const { cached } = await buildAgentMcp(root, outfile, { entry, target, cache: mode !== 'force' })
  console.log(cached ? 'hit' : 'built')
} else {
  const temp = await mkdtemp(join(resolve(tmpdir()), 'novel-agent-build-cache-'))
  try {
    if (process.argv[2] === '--measure') await measure(temp)
    else await check(temp)
  } finally {
    assert.equal(dirname(temp), resolve(tmpdir()))
    await rm(temp, { recursive: true, force: true, maxRetries: 4 })
  }
}
