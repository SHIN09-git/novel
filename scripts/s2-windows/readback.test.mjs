import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from '../utils/repo-root.mjs'
import { agentRead, checkedState, closedHash, copyClosed, editedBody, fixture, fixtureDir } from './readback.mjs'

test('S2 synthetic readback only (no installer, desktop, real profile or model)', async t => {
  const { manifest, backup } = await fixture()
  const tmp = join(repoRoot, 'tmp')
  await mkdir(tmp, { recursive: true })
  assert.equal(await realpath(tmp), tmp)
  const work = await mkdtemp(join(tmp, 's2-readback-'))
  const profile = join(work, 'profile'), database = join(work, 'selected.sqlite')
  const config = join(profile, 'app-config.json'), saved = join(work, 'before-upgrade.sqlite')
  await mkdir(profile)
  await copyClosed(join(fixtureDir, 'library.sqlite'), database)
  await copyClosed(database, saved)
  await writeFile(config, JSON.stringify({ storagePath: database }), { flag: 'wx' })
  const base = manifest.signature
  await t.test('fixed preview.20 database and independently selected Agent database agree', () => {
    assert.deepEqual(checkedState(backup, base, false), base)
    agentRead(profile, database, base)
  })
  const bundle = join(work, 'revision-service.mjs')
  await build({ stdin: { resolveDir: repoRoot, contents: [
    "export { buildRevisionCommitBundle } from './src/services/RevisionCommitBundleService'",
    "export { SqliteStorageService } from './src/storage/SqliteStorageService'"
  ].join('\n') }, bundle: true, format: 'esm', platform: 'node', external: ['electron','better-sqlite3'], outfile: bundle })
  const { SqliteStorageService, buildRevisionCommitBundle } = await import(pathToFileURL(bundle))
  const open = () => new SqliteStorageService(database, { mode: 'existing' })
  const db = open()
  try {
    const { data, revision } = await db.loadSnapshot()
    const record = buildRevisionCommitBundle({ appData: data, projectId: 's0-quay', chapterId: base.chapterId,
      newChapterVersionId: 's2-test-version', revisionCommitId: 's2-test-revision', revisedBy: 'user',
      revisedAt: '2030-01-01T00:00:00.000Z', afterText: editedBody })
    await db.saveRevisionCommitBundle(record, revision)
  } finally { db.close() }
  const reopened = open()
  let edited
  try { edited = (await reopened.loadSnapshot()).data } finally { reopened.close() }
  await t.test('persisted edit, third version, receipt, checkpoint and independent Node CLI read', () => {
    const actual = checkedState(edited, base, true)
    assert.equal(actual.latestRevisionId, 's2-test-revision')
    assert.equal(actual.versions.at(-1).id, 's2-test-version')
    agentRead(profile, database, actual)
  })
  await t.test('wrong body, broken parent, changed draft, missing book and lost checkpoint are rejected', () => {
    for (const corrupt of [d => { d.chapters[0].body += 'changed' },
      d => { d.chapterVersions.find(v => v.id === 's2-test-version').baseChapterVersionId = null },
      d => { d.chapterCommitBundles[0].generatedDraftId = 'wrong' }, d => d.projects.pop(),
      d => { d.chapterGenerationSteps.find(s => s.id === base.unfinished.stepId).status = 'completed' }]) {
      const copy = structuredClone(edited)
      corrupt(copy)
      assert.throws(() => checkedState(copy, base, true))
    }
  })
  await t.test('restores elsewhere; preserves updated file; rejects stale WAL and overwrite', async () => {
    const original = await closedHash(database), restored = join(work, 'restored.sqlite')
    assert.notEqual(original, manifest.sqliteSha256)
    assert.equal(await copyClosed(saved, restored), manifest.sqliteSha256)
    await writeFile(config, JSON.stringify({ storagePath: restored }))
    agentRead(profile, restored, base)
    assert.equal(await closedHash(database), original)
    await assert.rejects(copyClosed(saved, restored), { code: 'EEXIST' })
    await writeFile(saved + '-wal', 'unfinished synthetic WAL', { flag: 'wx' })
    await assert.rejects(copyClosed(saved, join(work, 'unsafe.sqlite')), /Uncheckpointed/)
  })
})
