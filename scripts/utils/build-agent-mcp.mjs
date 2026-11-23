import { hash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build, version } from 'esbuild'

const digest = (data) => hash('sha256', data)

async function publish(path, contents, expectedHash) {
  const alreadyPublished = () => expectedHash && existsSync(path) && digest(readFileSync(path)) === expectedHash
  if (alreadyPublished()) return
  const temp = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temp, contents, { flag: 'wx' })
    // On Windows an active reader can briefly deny replacement. Never unlink
    // the old generation: it must stay readable until rename succeeds.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temp, path)
        break
      } catch (error) {
        if (alreadyPublished()) break
        if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 12) throw error
        await delay(Math.min(10 * (attempt + 1), 100))
      }
    }
  } finally {
    await rm(temp, { force: true })
  }
}

function buildKey(options) {
  const binary = process.env.ESBUILD_BINARY_PATH
  return digest(JSON.stringify([
    options, version, process.version, process.platform, process.arch,
    digest(readFileSync(new URL(import.meta.url))), digest(readFileSync(new URL(import.meta.resolve('esbuild')))),
    binary, binary && existsSync(binary) && digest(readFileSync(binary)),
    process.env.NODE_PATH
  ]))
}

// esbuild's module inputs do not include resolver metadata. A new sibling
// (e.g. dep.tsx ahead of dep.ts), package entry point or tsconfig can change the bundle.
function directoryInputs(root, dir, outfile) {
  const entries = readdirSync(dir, { withFileTypes: true })
  let names = entries.filter(e => e.isDirectory() || e.isSymbolicLink() || /\.(?:[cm]?[jt]sx?|json)$/.test(e.name))
    .map(e => e.name).sort()
  if (dir === dirname(outfile)) names = names.filter(name => !/(?:\.[a-f0-9]{64}\.mjs|\.mjs\.cache\.json)$/.test(name))
  const records = [names]
  for (const name of entries.filter(e => e.isSymbolicLink()).map(e => e.name).sort()) {
    records.push([name, readlinkSync(join(dir, name))])
  }
  if (names.includes('node_modules')) {
    const modules = join(dir, 'node_modules')
    const packages = readdirSync(modules, { withFileTypes: true }).filter(e => e.isDirectory() || e.isSymbolicLink())
      .map(e => e.name).sort()
    records.push(packages)
    for (const scope of packages.filter(name => name.startsWith('@'))) records.push([scope, readdirSync(join(modules, scope)).sort()])
  }
  for (const name of ['package.json', 'tsconfig.json', ...(dir === root ? ['package-lock.json'] : [])]) {
    if (!names.includes(name)) continue
    const bytes = readFileSync(join(dir, name))
    // These options can bring in resolver inputs outside the module directories.
    if (name === 'tsconfig.json' && /"(?:extends|paths|baseUrl)"\s*:/.test(bytes.toString())) return null
    records.push([name, digest(bytes)])
  }
  return digest(JSON.stringify(records))
}

function resolverSnapshot(root, outfile) {
  const dirs = new Map()
  let cacheable = true
  function observe(file) {
    const rel = relative(root, file)
    if (isAbsolute(rel) || rel.startsWith('..' + sep)) cacheable = false
    for (let dir = dirname(file); cacheable && !dirs.has(dir); dir = dirname(dir)) {
      const state = directoryInputs(root, dir, outfile)
      if (state === null) cacheable = false
      dirs.set(dir, state)
      if (dir === root) break
    }
  }
  return { observe, key: () => cacheable ? digest(JSON.stringify([...dirs.keys()].sort().map(d => [d, dirs.get(d)]))) : null }
}

function resolverKey(root, files, outfile) {
  const snapshot = resolverSnapshot(root, outfile)
  for (const file of files) snapshot.observe(file)
  return snapshot.key()
}

const generation = (outfile, checksum) => outfile.replace(/\.mjs$/, '') + '.' + checksum + '.mjs'

function cachedGeneration(manifest, root, outfile, key) {
  try {
    const stamp = JSON.parse(readFileSync(manifest, 'utf8'))
    if (stamp.key !== key || !stamp.resolver || !/^[a-f0-9]{64}$/.test(stamp.output)) return
    const files = Object.keys(stamp.inputs)
    const path = generation(outfile, stamp.output)
    if (files.length && files.every(f => digest(readFileSync(f)) === stamp.inputs[f]) &&
      resolverKey(root, files, outfile) === stamp.resolver && digest(readFileSync(path)) === stamp.output) return path
  } catch {
    // Missing, unreadable or malformed cache state is never a reason to skip a build.
  }
}

export async function buildAgentMcp(root, outfile, {
  entry = 'src/agent/mcp/server.ts', target = 'node22', cache = false
} = {}) {
  root = resolve(root)
  outfile = resolve(outfile)
  const options = {
    absWorkingDir: root, entryPoints: [resolve(root, entry)], outfile,
    bundle: true, platform: 'node', format: 'esm', target,
    external: ['better-sqlite3', 'electron'], logLevel: 'silent'
  }
  await mkdir(dirname(outfile), { recursive: true })
  if (!cache) {
    await build(options)
    return { cached: false, outfile }
  }
  const manifest = outfile + '.cache.json'
  const key = buildKey(options)
  const hit = cachedGeneration(manifest, root, outfile, key)
  if (hit) return { cached: true, outfile: hit }

  const inputs = Object.create(null)
  const resolving = resolverSnapshot(root, outfile)
  resolving.observe(options.entryPoints[0])
  const plugins = [{
    name: 'agent-cache-inputs',
    setup(ctx) {
      ctx.onLoad({ filter: /.*/, namespace: 'file' }, async ({ path }) => {
        resolving.observe(path)
        const contents = await readFile(path)
        inputs[path] = digest(contents)
        return { contents, loader: 'default', resolveDir: dirname(path) }
      })
    }
  }]
  const { outputFiles } = await build({ ...options, write: false, plugins })
  if (outputFiles.length !== 1 || outputFiles[0].path !== outfile) throw new Error('Expected a single Agent JavaScript bundle')
  const bundle = outputFiles[0].contents
  const output = digest(bundle)
  const path = generation(outfile, output)
  const resolver = resolving.key()
  await publish(path, bundle, output)
  if (resolver && resolver === resolverKey(root, Object.keys(inputs), outfile)) {
    await publish(manifest, JSON.stringify({ key, resolver, inputs, output }))
  }
  return { cached: false, outfile: path }
}
