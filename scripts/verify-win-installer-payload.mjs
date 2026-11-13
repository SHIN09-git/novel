// Compare the NSIS application payload with the tested unpacked tree without installing it.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const release = join(root, 'release')
await mkdir(join(root, 'tmp'), { recursive: true })
const tmp = await realpath(join(root, 'tmp'))
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const info = JSON.parse(await readFile(join(release, 'BUILD_INFO.json'), 'utf8'))
assert.equal(info.version, pkg.version)
assert.equal(info.installer, `Novel Director Setup ${pkg.version}.exe`)
const installer = join(release, info.installer)
const sevenZip = [
  process.env.ProgramFiles && join(process.env.ProgramFiles, '7-Zip', '7z.exe'),
  join(root, 'node_modules/electron-winstaller/vendor/7z.exe')
].find(path => path && existsSync(path))
assert(sevenZip, 'Install 7-Zip to verify the NSIS payload.')

function extract(archive, to, members = []) {
  execFileSync(sevenZip, ['x', '-y', '-bd', `-o${to}`, archive, ...members], { stdio: 'pipe', windowsHide: true })
}

async function hash(path) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path)) h.update(chunk)
  return h.digest('hex').toUpperCase()
}

async function files(base, dir = base) {
  const paths = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) paths.push(...await files(base, path))
    else {
      assert(entry.isFile(), `Unexpected non-file in application tree: ${path}`)
      paths.push(relative(base, path))
    }
  }
  return paths.sort()
}

const work = await mkdtemp(join(tmp, 'installer-equivalence-'))
try {
  const publishedHash = await hash(installer)
  assert.equal(publishedHash, info.installerSha256.toUpperCase(), 'Installer does not match the release manifest')
  const payload = join(work, 'app')
  await mkdir(payload)
  extract(installer, work, ['$PLUGINSDIR\\app-64.7z'])
  extract(join(work, '$PLUGINSDIR', 'app-64.7z'), payload)
  const unpacked = join(release, 'win-unpacked')
  const members = await files(unpacked)
  assert.deepEqual(await files(payload), members, 'Installer and unpacked program have different file lists')
  assert(members.includes('Novel Director.exe'))
  const sqliteDir = join('resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3')
  const native = [join(sqliteDir, 'prebuilds', 'win32-x64.node'),
    join(sqliteDir, 'build', 'Release', 'better_sqlite3.node')].find(path => members.includes(path))
  assert(native, 'Windows x64 SQLite native binding missing')
  for (const member of members) {
    assert.equal(await hash(join(payload, member)), await hash(join(unpacked, member)), `File differs: ${member}`)
  }
  const result = { version: info.version, checkedAt: new Date().toISOString(), installer: info.installer,
    installerSha256: publishedHash, appAsarSha256: await hash(join(unpacked, 'resources', 'app.asar')),
    sqliteBindingSha256: await hash(join(unpacked, native)), comparedFileCount: members.length,
    status: 'identical', installedOnHost: false }
  await writeFile(join(release, 'INSTALLER_PAYLOAD_CHECK.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  assert.equal(dirname(await realpath(work)), tmp)
  assert(basename(work).startsWith('installer-equivalence-'))
  await rm(work, { recursive: true, force: true, maxRetries: 4 })
}
