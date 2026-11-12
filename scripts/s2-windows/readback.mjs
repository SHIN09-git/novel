import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { books, digest, revisedBody, signature } from '../fixtures/library-recovery.mjs'
import { sha256 } from '../utils/long-novel-ui-driver.mjs'
import { repoRoot } from '../utils/repo-root.mjs'

export const fixtureDir = join(repoRoot, 'scripts', 'fixtures', 'library-preview20')
export const editedBody = revisedBody + '\n\nS2: 06:15.'
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
export async function fixture() {
  const m = await readJson(join(fixtureDir, 'manifest.json'))
  for (const [file, hash, pinned] of [
    ['library.sqlite', m.sqliteSha256, '6e1b99178daeb837fcbd20e31e981cb74fc5fc01fc72f1116aeae239a001bcc6'],
    ['backup.json', m.backupSha256, 'c436210de250b5aff90f4e1bff209aabc7ca10329dc39ae9840f40ef7e5b6050']
  ]) {
    assert.equal(hash, pinned)
    assert.equal(await sha256(join(fixtureDir, file)), hash)
  }
  const backup = await readJson(join(fixtureDir, 'backup.json'))
  assert.equal(m.baseUrl, 'http://127.0.0.1:57760/v1')
  assert.equal(backup.settings.baseUrl, m.baseUrl)
  assert.deepEqual(signature(backup), m.signature)
  return { manifest: m, backup }
}

// Check the new head and receipt separately, then run the original S0 assertions
// on the historical slice, including the other book's unfinished checkpoint.
export function checkedState(data, expected, edited) {
  for (const book of books) assert.equal(data.projects.find(p => p.id === book.id)?.name, book.name)
  if (!edited) {
    assert.deepEqual(signature(data), expected)
    return expected
  }
  const oldIds = expected.versions.map(v => v.id)
  const newVersions = data.chapterVersions.filter(v => !oldIds.includes(v.id))
  const receipts = data.revisionCommitBundles.filter(r => r.revisionCommitId !== expected.revisionId)
  assert.equal(newVersions.length, 1)
  assert.equal(receipts.length, 1)
  const [v] = newVersions, [r] = receipts
  for (const item of [v, r]) {
    assert.equal(item.projectId, books[0].id)
    assert.equal(item.chapterId, expected.chapterId)
    assert.equal(item.baseChapterVersionId, oldIds.at(-1))
    assert.equal(item.linkedChapterCommitId, expected.acceptanceId)
  }
  assert(v.id && r.revisionCommitId)
  assert.equal(v.id, r.newChapterVersionId)
  assert.equal(v.linkedRevisionCommitId, r.revisionCommitId)
  assert.equal(v.source, 'manual_revision')
  assert.equal(r.beforeText, revisedBody)
  assert.equal(data.chapters.length, 1)
  for (const text of [data.chapters[0].body, r.afterText, v.body, r.chapter.body, r.chapterVersion.body]) {
    assert.equal(text, editedBody)
  }
  const original = signature({ ...data, chapters: [{ ...data.chapters[0], body: revisedBody }],
    chapterVersions: data.chapterVersions.filter(x => x !== v), revisionCommitBundles: data.revisionCommitBundles.filter(x => x !== r) })
  assert.deepEqual(original, expected)
  return { ...original, chapterSha256: digest(editedBody), latestRevisionId: r.revisionCommitId,
    versions: [...original.versions, { id: v.id, base: v.baseChapterVersionId, source: v.source, bodySha256: digest(v.body) }] }
}

export async function closedHash(path) {
  // A plain DB copy is valid only after a clean close with no outstanding journal.
  for (const suffix of ['-wal', '-journal']) {
    const sidecar = await stat(path + suffix).catch(e => { if (e.code !== 'ENOENT') throw e })
    assert(!sidecar?.size, 'Uncheckpointed SQLite sidecar: ' + suffix)
  }
  return sha256(path)
}

export async function copyClosed(source, destination) {
  const hash = await closedHash(source)
  await copyFile(source, destination, constants.COPYFILE_EXCL)
  assert.equal(await sha256(destination), hash)
  return hash
}

export function agentRead(profile, database, state) {
  const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH,
    APPDATA: profile, LOCALAPPDATA: profile, HOME: profile, USERPROFILE: profile, TEMP: profile, TMP: profile,
    NOVEL_DIRECTOR_API_REGISTRY: join(profile, 'no-registry.json') }
  function call(...args) {
    const result = JSON.parse(execFileSync(process.execPath, [join(repoRoot, 'scripts', 'run-agent.mjs'),
      ...args, '--user-data', profile], { cwd: repoRoot, env, encoding: 'utf8', windowsHide: true, timeout: 60000 }))
    assert.equal(result.ok, true)
    assert.equal(result.storage.source, 'sqlite')
    assert.equal(result.storage.storagePath, database)
    return result.data
  }
  assert.deepEqual(call('list-projects').map(p => p.id).sort(), state.projectIds)
  const chapter = ['--project-id', books[0].id, '--chapter', '1']
  const text = call('chapter-text', ...chapter, '--detail', 'full')
  assert.equal(text.id, state.chapterId)
  assert.equal(digest(text.text), state.chapterSha256)
  const chain = call('version-chain', ...chapter)
  assert.equal(chain.chapterId, state.chapterId)
  assert.deepEqual(chain.versions.map(v => v.id), state.versions.map(v => v.id).reverse())
  assert.deepEqual(chain.versions.filter(v => v.isCurrent).map(v => v.id), [state.versions.at(-1).id])
  return { node: process.version, source: 'sqlite', storagePath: database, projectIds: state.projectIds,
    chapterSha256: digest(text.text), versionIds: chain.versions.map(v => v.id) }
}
