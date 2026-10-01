import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkedPath, sha256, within } from './long-novel-ui-driver.mjs'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const digest = (content) => createHash('sha256').update(content).digest('hex')
const bindingRelative = join('node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')

export async function treeManifest(directory) {
  const files = []
  async function visit(relativePath) {
    const entries = await readdir(join(directory, relativePath), { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relativePath, entry.name)
      assert(!entry.isSymbolicLink(), `Symlink/junction forbidden in runtime copy: ${path}`)
      if (entry.isDirectory()) await visit(path)
      else {
        assert(entry.isFile(), `Not a regular runtime file: ${path}`)
        files.push({ path, bytes: (await stat(join(directory, path))).size, sha256: await sha256(join(directory, path)) })
      }
    }
  }
  await visit('')
  return files
}

async function copyVerifiedTree(source, destination) {
  const before = await treeManifest(source)
  await cp(source, destination, { recursive: true, dereference: false, force: false, errorOnExist: true })
  assert.deepEqual(await treeManifest(destination), before, 'Runtime copy differs from source snapshot')
  assert.deepEqual(await treeManifest(source), before, 'Build changed during runtime copy; retry after the build finishes')
  return before
}

export async function targetIdentity(root, target) {
  target.archive = await checkedPath(root, join(target.packagedDir, 'resources', 'app.asar'))
  const packagedManifest = JSON.parse(asar.extractFile(target.archive, 'package.json', false).toString('utf8'))
  const manifestPath = target.out ? join(root, 'package.json') : null
  const manifest = manifestPath ? JSON.parse(await readFile(manifestPath, 'utf8')) : packagedManifest
  assert.equal(manifest.main.replaceAll('\\', '/'), 'out/main/index.js', 'Unexpected Electron entrypoint')
  assert.equal(manifest.type, 'module', 'Production main requires the ESM package contract')
  target.expectedAppVersion = manifest.version
  target.expectedMode = target.out ? 'preview' : 'packaged'
  if (target.out) {
    // A binding from another Electron version is not silently accepted or rebuilt.
    const releasePath = await checkedPath(root, join(dirname(target.packagedDir), 'BUILD_INFO.json'))
    const release = JSON.parse(await readFile(releasePath, 'utf8'))
    const releaseExecutable = await checkedPath(root, join(dirname(releasePath), release.unpackedExecutable))
    assert.equal(releaseExecutable.toLowerCase(), (await checkedPath(root, join(target.packagedDir, 'Novel Director.exe'))).toLowerCase(),
      'Binding release manifest points to a different package')
    assert.equal(release.version, packagedManifest.version, 'Binding package and release manifest versions differ')
    const versionPath = await checkedPath(root, join(dirname(target.executable), 'version'))
    target.expectedElectronVersion = (await readFile(versionPath, 'utf8')).trim()
    assert.equal(target.expectedElectronVersion, release.electronVersion,
      'Electron and packaged native binding versions differ; this benchmark never rebuilds bindings')
    target.nativeSourceRelease = { path: releasePath, sha256: await sha256(releasePath), ...release }
    target.appManifestSource = manifestPath
    target.appManifestSha256 = digest(await readFile(manifestPath))
  }
}

async function copyPackagedSqlite(root, target) {
  const packages = ['better-sqlite3', 'bindings', 'file-uri-to-path']
  const copied = []
  for (const listed of asar.listPackage(target.archive)) {
    const name = listed.replaceAll('\\', '/').replace(/^\//, '')
    if (!packages.some((pkg) => name.startsWith(`node_modules/${pkg}/`))) continue
    const archiveName = join(...name.split('/'))
    const info = asar.statFile(target.archive, archiveName, false)
    assert(!('link' in info), `Linked packaged dependency is not supported: ${name}`)
    if ('files' in info || !/\.(js|json)$/.test(name)) continue
    const destination = resolve(target.runtimeRoot, name)
    assert(within(target.runtimeRoot, destination), 'Archive entry escaped isolated runtime')
    const contents = info.unpacked
      ? await readFile(await checkedPath(root, join(`${target.archive}.unpacked`, archiveName)))
      : asar.extractFile(target.archive, archiveName, false)
    assert.equal(info.integrity?.algorithm, 'SHA256', `Missing packaged file integrity: ${name}`)
    assert.equal(digest(contents), info.integrity.hash, `Packaged dependency changed: ${name}`)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, contents, { flag: 'wx' })
    copied.push({ path: name, sha256: digest(contents) })
  }
  const native = join(target.runtimeRoot, bindingRelative)
  await mkdir(dirname(native), { recursive: true })
  await copyFile(target.binding, native)
  assert.equal(await sha256(native), await sha256(target.binding), 'Copied Electron binding hash mismatch')
  const runtimeRequire = createRequire(join(target.runtimeRoot, 'package.json'))
  const sqliteEntry = runtimeRequire.resolve('better-sqlite3')
  assert(within(join(target.runtimeRoot, 'node_modules', 'better-sqlite3'), sqliteEntry))
  const sqliteRequire = createRequire(sqliteEntry)
  const bindingsEntry = sqliteRequire.resolve('bindings')
  assert(within(target.runtimeRoot, bindingsEntry), 'bindings resolved outside runtime copy')
  assert(within(target.runtimeRoot, createRequire(bindingsEntry).resolve('file-uri-to-path')))
  // path:true resolves without loading the Electron ABI into this Node process.
  const resolvedNative = sqliteRequire('bindings')({ bindings: 'better_sqlite3.node',
    module_root: join(target.runtimeRoot, 'node_modules', 'better-sqlite3'), path: true })
  assert.equal(resolve(resolvedNative).toLowerCase(), resolve(native).toLowerCase())
  target.nativeRuntime = { archive: target.archive, sqliteEntry, bindingsEntry, resolvedNative,
    bindingSha256: await sha256(native), copiedJavaScript: copied,
    verification: 'Static module/path resolution only; Electron loads the binding during isolated bootstrap.' }
}

export async function prepareTarget(root, target, work) {
  target.fingerprints = []
  for (const file of [...new Set([target.executable, target.binding, target.archive, ...target.required])]) {
    target.fingerprints.push({ path: file, bytes: (await stat(file)).size, sha256: await sha256(file) })
  }
  if (target.mode === 'packaged') { target.runtimeRoot = target.packagedDir; return }
  target.runtimeRoot = await mkdtemp(join(work, 'runtime-'))
  target.outManifest = await copyVerifiedTree(target.out, join(target.runtimeRoot, 'out'))
  target.outManifestSha256 = digest(JSON.stringify(target.outManifest))
  await copyFile(target.appManifestSource, join(target.runtimeRoot, 'package.json'))
  assert.equal(await sha256(join(target.runtimeRoot, 'package.json')), target.appManifestSha256, 'App manifest changed while preparing runtime')
  await copyPackagedSqlite(root, target)
  await mkdir(join(target.runtimeRoot, 'build'), { recursive: true })
  const icon = await checkedPath(root, join(target.packagedDir, 'resources', 'icon.png'))
  await copyFile(icon, join(target.runtimeRoot, 'build', 'icon.png'))
  target.iconSha256 = await sha256(icon)
  assert.equal(await sha256(target.archive), target.fingerprints.find((f) => f.path === target.archive).sha256,
    'Binding package changed during preparation')
  target.isolatedManifest = await treeManifest(target.runtimeRoot)
}

export function verifyRuntimeIdentity(target, info, rendererUrl) {
  assert.equal(info.mode, target.expectedMode, 'Runtime mode does not match selected target')
  assert.equal(info.version, target.expectedAppVersion, 'Runtime app version does not match selected target')
  assert.equal(resolve(info.execPath).toLowerCase(), resolve(target.executable).toLowerCase(), 'Unexpected Electron executable')
  if (target.expectedElectronVersion) assert.equal(info.electronVersion, target.expectedElectronVersion, 'Unexpected Electron runtime version')
  assert(Number.isFinite(Date.parse(info.buildTime)), 'Runtime build time is missing or invalid')
  const entry = target.out ? join(target.runtimeRoot, 'out', 'renderer', 'index.html')
    : join(target.archive, 'out', 'renderer', 'index.html')
  assert.equal(new URL(rendererUrl).href.toLowerCase(), pathToFileURL(entry).href.toLowerCase(), 'Renderer was not loaded from selected production output')
  if (target.observedRuntime) assert.deepEqual(info, target.observedRuntime, 'Build identity changed between samples')
  else target.observedRuntime = info
}
