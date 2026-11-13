import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { repoRoot } from '../utils/repo-root.mjs'

async function directoryBytes(dir) {
  return Object.fromEntries(await Promise.all((await readdir(dir)).map(async name =>
    [name, await readFile(join(dir, name))])))
}

// SQLite and the JSON snapshot may enumerate the same entities in different orders.
function persisted(data) {
  const snapshot = JSON.parse(JSON.stringify(data))
  for (const records of Object.values(snapshot).filter(Array.isArray)) {
    records.sort((a, b) => String(a.id ?? a.projectId).localeCompare(String(b.id ?? b.projectId)))
  }
  return snapshot
}

export async function checkBackupFormats({ api, work, handlers, test }) {
  const old = await readFile(join(repoRoot, 'scripts/fixtures/library-preview20/backup.json'))
  const data = api.normalizeAppData(JSON.parse(old)), expected = persisted(data)
  const invoke = (channel, arg) => handlers.get(api.IPC_CHANNELS[channel])({}, arg)
  const dialogs = globalThis.__backupDialogs

  await test('mixed rotations, ENOSPC on both formats and failed gzip publish preserve prior files', async () => {
    const service = new api.BackupService(join(work, 'partial-backup-rotation')), dir = service.getBackupDir()
    await service.ensureBackupDir()
    const userFile = join(dir, 'my-auto-copy.json'), broken = join(dir, 'bad.json')
    await writeFile(userFile, old)
    await writeFile(broken, '{}')
    const manual = await service.createBackup(data, false), manualBytes = await readFile(manual)
    const now = Date.now, base = now(), day = 25 * 3600_000
    try {
      for (let i = 0; i < 7; i++) await writeFile(join(dir, `novel-director-${base + day * i}-auto.json`), old)
      Date.now = () => base + 6 * day
      assert.equal(await service.maybeCreateAutomaticBackup(() => assert.fail('old JSON satisfies schedule')), null)
      Date.now = () => base + 7 * day
      const first = await service.maybeCreateAutomaticBackup(data)
      assert.match(first, /\.json\.gz$/)
      const before = await directoryBytes(dir)
      assert.equal((await service.listBackups()).filter(b => b.isAutomatic).length, 7)
      assert.equal(before[`novel-director-${base}-auto.json`], undefined)
      Date.now = () => base + 8 * day
      for (const [flag, code] of [['__backupPartialWriteFailure', 'ENOSPC'], ['__gzipDiskFull', 'ENOSPC'],
        ['__backupRenameFailure', 'EACCES']]) {
        globalThis[flag] = true
        try { await assert.rejects(service.maybeCreateAutomaticBackup(data), { code }) }
        finally { delete globalThis[flag] }
        assert.deepEqual(await directoryBytes(dir), before)
      }
      let latest
      for (let i = 8; i <= 15; i++) {
        Date.now = () => base + i * day
        latest = await service.maybeCreateAutomaticBackup({ ...data,
          projects: data.projects.map(p => ({ ...p, name: 'snapshot ' + i })) })
      }
      const entries = await service.listBackups(), autos = entries.filter(e => e.isAutomatic)
      assert.equal(autos.length, 7)
      assert(autos.every(e => e.path.endsWith('.json.gz')))
      assert.deepEqual(autos.map(b => b.timestamp), [15,14,13,12,11,10,9].map(i => base + i * day))
      const rolls = entries.filter(e => e.isRollback)
      assert.equal(rolls.length, 1)
      assert.deepEqual(await readFile(rolls[0].path), gunzipSync(await readFile(latest)))
      assert.equal(JSON.parse(await readFile(rolls[0].path)).projects[0].name, 'snapshot 15')
      assert.deepEqual(await readFile(manual), manualBytes)
      assert.deepEqual(await readFile(userFile), old)
      assert.equal(await readFile(broken, 'utf8'), '{}')
      assert.deepEqual(persisted(await service.loadBackup(userFile)), expected)
      await assert.rejects(service.deleteBackup(join(work, 'external.json.gz')), /outside/)
    } finally { Date.now = now }
  })

  await test('gzip boundary is inclusive; oversized auto is a scheduled, recoverable plain backup', async () => {
    const home = join(work, 'boundary')
    const reference = new api.BackupService(home)
    const manual = await reference.createBackup(data, false), bytes = await readFile(manual)
    const inclusive = new api.BackupService(home, bytes.length)
    const gzip = await inclusive.createBackup(data)
    assert.deepEqual(gunzipSync(await readFile(gzip)), bytes)
    const smaller = new api.BackupService(home, bytes.length - 1)
    await assert.rejects(smaller.loadBackup(gzip), /上限/)
    const now = Date.now
    Date.now = () => now() + 25 * 3600_000
    try {
      const plain = await smaller.maybeCreateAutomaticBackup(data)
      assert.match(plain, /-auto-.*\.json$/)
      assert.deepEqual(await readFile(plain), bytes)
      assert.deepEqual(persisted(await smaller.loadBackup(plain)), expected)
      assert.deepEqual(persisted(await smaller.loadBackup(manual)), expected)
      assert.equal(await smaller.maybeCreateAutomaticBackup(() => assert.fail('plain satisfies schedule')), null)
    } finally { Date.now = now }
  })

  await test('reject bad header, truncation, CRC, UTF-8, JSON, shape and expansion across gzip members', async () => {
    const service = new api.BackupService(join(work, 'invalid'))
    await service.ensureBackupDir()
    const path = join(service.getBackupDir(), 'input.JSON.GZ'), gz = gzipSync(old), crc = Buffer.from(gz)
    crc[crc.length - 8] ^= 1
    for (const [bytes, reason] of [[old, /Gzip/], [gz.subarray(0, -2), /Gzip/], [crc, /Gzip/],
      [gzipSync(Buffer.from([0xff])), /UTF-8/], [gzipSync('{'), /JSON/], [gzipSync('{}'), /完整/]]) {
      await writeFile(path, bytes)
      await assert.rejects(service.loadBackup(path), reason)
    }
    await writeFile(path, Buffer.concat([gzipSync(' '.repeat(8192)), gzipSync(' '.repeat(8192) + '{}')]))
    await assert.rejects(api.readBackupJson(path, 8193), /上限/)
    await writeFile(path, Buffer.concat([gzipSync('{}'), Buffer.alloc(1024 * 1024 + 8192)]))
    await assert.rejects(api.readBackupJson(path, 8192), /压缩备份文件超出/)
    await writeFile(path, gzipSync(Buffer.concat([Buffer.from('\ufeff'), old])))
    assert.deepEqual(persisted(await service.loadBackup(path)), expected)
  })

  await test('gzip-only profile is not new; recovery picker restores the entire old fixture and reopens it', async () => {
    const home = join(work, 'recover'), dir = join(home, 'backups'), target = join(home, 'restored.sqlite')
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'book.json.gz'), config = new api.AppConfigService(home)
    const session = new api.LibrarySession(config), bytes = gzipSync(old)
    await writeFile(path, bytes.subarray(0, -3))
    try {
      await assert.rejects(session.load(), /旧书库记录/)
      await assert.rejects(api.resolveAgentRuntimeStoragePath({ userDataPath: home }), /找不到原书库/)
      api.registerLibraryRecoveryIpc(session, home, dir)
      dialogs.showOpenDialog = async opts => {
        assert.equal(opts.defaultPath, dir)
        assert.deepEqual(opts.filters[0].extensions, ['json', 'gz'])
        return { filePaths: [path] }
      }
      dialogs.showSaveDialog = async () => ({ filePath: target })
      assert.equal((await invoke('APP_RECOVER_LIBRARY', 'restore')).ok, false)
      assert.deepEqual(await readdir(home), ['backups'])
      await writeFile(path, bytes)
      assert.equal((await invoke('APP_RECOVER_LIBRARY', 'restore')).ok, true)
      assert.deepEqual(persisted((await session.load()).snapshot.data), expected)
      assert.deepEqual(await readFile(path), bytes)
    } finally { session.close() }
    const restarted = new api.LibrarySession(config)
    try { assert.deepEqual(persisted((await restarted.load()).snapshot.data), expected) }
    finally { restarted.close() }
  })

  await test('settings restore/import validate before replacing; merge stays partial; export stays plain', async () => {
    const service = new api.BackupService(join(work, 'partial-backup-ipc'))
    const path = await service.createBackup(data), dir = service.getBackupDir()
    const invalid = join(dir, 'invalid.json.gz'), partial = join(dir, 'partial.json.gz')
    await writeFile(invalid, gzipSync(old).subarray(0, -2))
    await writeFile(partial, gzipSync(JSON.stringify({ projects: [{ ...data.projects[0], id: 'merge-only' }] })))
    const storage = new api.SqliteStorageService(join(work, 'import.sqlite'))
    const context = { getStorage: () => storage, backupService: service,
      credentialService: { hasApiKey: async () => false } }
    let selected = invalid
    dialogs.showOpenDialog = async opts => {
      assert.deepEqual(opts.filters[0].extensions, ['json', 'gz'])
      return { filePaths: [selected] }
    }
    try {
      api.registerDataIpcHandlers(context)
      api.registerBackupIpcHandlers(context)
      const before = await storage.loadSnapshot(), files = await directoryBytes(dir)
      assert((await invoke('BACKUP_LIST')).backups.some(b => b.path === path && b.isAutomatic))
      assert.equal((await invoke('BACKUP_RESTORE', invalid)).ok, false)
      assert.equal((await invoke('STORAGE_IMPORT', { strategy: 'replace' })).ok, false)
      selected = partial
      assert.equal((await invoke('STORAGE_IMPORT', { strategy: 'replace' })).ok, false)
      selected = path
      globalThis.__backupPartialWriteFailure = true
      try {
        assert.equal((await invoke('BACKUP_RESTORE', path)).code, 'ENOSPC')
        assert.equal((await invoke('STORAGE_IMPORT', { strategy: 'replace' })).code, 'ENOSPC')
      } finally { delete globalThis.__backupPartialWriteFailure }
      assert.deepEqual(await storage.loadSnapshot(), before)
      assert.deepEqual(await directoryBytes(dir), files)
      const restored = await invoke('BACKUP_RESTORE', path)
      assert.equal(restored.ok, true, restored.error)
      assert.deepEqual(persisted(JSON.parse(await readFile(restored.preRestoreBackupPath))), persisted(before.data))
      assert.deepEqual(persisted(await storage.load()), expected)
      selected = partial
      assert.equal((await invoke('STORAGE_IMPORT', { strategy: 'merge' })).mergeBlocked, false)
      assert((await storage.load()).projects.some(p => p.id === 'merge-only'))
      selected = path
      assert.equal((await invoke('STORAGE_IMPORT', { strategy: 'replace' })).mergeBlocked, false)
      assert.deepEqual(persisted(await storage.load()), expected)
      selected = join(work, 'export.json')
      dialogs.showSaveDialog = async opts => {
        assert.deepEqual(opts.filters[0].extensions, ['json'])
        return { filePath: selected }
      }
      assert.equal((await invoke('STORAGE_EXPORT', await storage.load())).filePath, selected)
      assert.deepEqual(persisted(JSON.parse(await readFile(selected))), expected)
      assert.equal((await invoke('STORAGE_IMPORT', { strategy: 'replace' })).mergeBlocked, false)
    } finally { storage.close() }
  })

  if (process.env.S4_TEST_LARGE === '1') {
    await test('real oversized UTF-8 library writes and restores using the default production limit', async () => {
      const service = new api.BackupService(join(work, 'large-plain'))
      const chapter = data.chapters[0], body = '书'.repeat(128 * 1024 * 1024 + 1)
      const path = await service.maybeCreateAutomaticBackup({ ...data, chapters: [{ ...chapter, body }] })
      assert.match(path, /-auto-.*\.json$/)
      const rows = await service.listBackups()
      assert.equal(rows.length, 1)
      assert(rows[0].isAutomatic && rows[0].size > 384 * 1024 * 1024)
      assert.equal((await service.loadBackup(path)).chapters[0].body, body)
      assert.equal(await service.maybeCreateAutomaticBackup(() => assert.fail('unexpected retry')), null)
      console.log('Oversized synthetic auto JSON bytes:', rows[0].size)
    })
  }
}
