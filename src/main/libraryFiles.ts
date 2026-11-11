import { constants } from 'node:fs'
import { copyFile, lstat, open, readdir, unlink } from 'node:fs/promises'
import { extname, isAbsolute, join, resolve } from 'node:path'
import type { AppData } from '../shared/types'
import type { StorageService, StorageSnapshot } from '../storage/StorageService'
import { checkSqliteBindingAvailable, createExistingLibraryStorage, createNewLibraryStorage } from '../storage/SqliteStorageService'

export const libraryStores = { existing: createExistingLibraryStorage, create: createNewLibraryStorage, checkSqlite: checkSqliteBindingAvailable }
export type LibraryStores = typeof libraryStores
export interface OpenLibrary { storage: StorageService; snapshot: StorageSnapshot }

export function libraryFile(path: string): string {
  if (!isAbsolute(path) || !['.json', '.db', '.sqlite'].includes(extname(path).toLowerCase())) {
    throw new Error('请选择完整路径的 .sqlite、.db 或 .json 书库文件。')
  }
  return resolve(path)
}

export async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function hasLibraryTraces(directory: string, kind: 'config' | 'sqlite' | 'any' = 'any'): Promise<boolean> {
  const entries = await readdir(directory)
  if (kind === 'config') return entries.some(name => /^app-config\.json\.(?:bak|tmp|corrupt\.)/i.test(name))
  if (entries.some(name => /\.sqlite(?:$|[.-])|^novel-director-data\.db(?:$|[.-])|\.before-sqlite-migrate\./i.test(name))) return true
  if (kind === 'sqlite') return false
  if (entries.some(name => /^(secure-credentials\.json|agent-authorizations\.json)$|^novel-director-data\.json\./i.test(name))) return true
  const backups = join(directory, 'backups')
  return await exists(backups) && (await readdir(backups)).some(name => /\.json(?:\.gz)?$/i.test(name))
}

export async function openExistingLibrary(path: string, stores: LibraryStores): Promise<OpenLibrary> {
  if (!await exists(path)) throw new Error('找不到原书库。请连接原磁盘，或选择已有书库。')
  const storage = stores.existing(libraryFile(path))
  try {
    return { storage, snapshot: await storage.loadSnapshot() }
  } catch (error) {
    storage.close?.()
    throw error
  }
}

// Never pass an existing destination (or an orphaned WAL) to the initializing backend.
export async function writeNewLibrary(path: string, stores: LibraryStores, data?: AppData,
  beforeInitialize?: () => Promise<void>): Promise<OpenLibrary> {
  path = libraryFile(path)
  for (const suffix of ['-wal', '-shm', '-journal', '.bak', '.tmp']) {
    if (await exists(path + suffix)) throw new Error('目标位置留有旧书库文件，请另选一个新文件名。')
  }
  let reserved: Awaited<ReturnType<typeof open>>
  try { reserved = await open(path, 'wx', 0o600) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('目标文件已存在。不会覆盖，请另选一个新文件名。')
    throw error
  }
  const owned = await reserved.stat()
  let storage: StorageService | undefined
  try {
    await reserved.close()
    await beforeInitialize?.()
    // Schema and initial data commit together: an interruption cannot publish an empty migrated book.
    storage = stores.create(path, data)
    return { storage, snapshot: await storage.loadSnapshot() }
  } catch (error) {
    storage?.close?.()
    const current = await lstat(path).catch(() => null)
    if (current && current.dev === owned.dev && current.ino === owned.ino) await unlink(path)
    throw error
  }
}

export async function backupLegacyJson(path: string): Promise<void> {
  await copyFile(path, path + '.before-sqlite-migrate.' + Date.now() + '.json', constants.COPYFILE_EXCL)
}
