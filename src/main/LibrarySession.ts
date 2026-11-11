import { dirname, extname, join, relative } from 'node:path'
import { JSON_DATA_FILE_NAME, resolveSqliteStoragePath, type StorageService } from '../storage/StorageService'
import type { AppData } from '../shared/types'
import type { AppConfigService } from './AppConfigService'
import { backupLegacyJson, exists, hasLibraryTraces, libraryFile, libraryStores,
  openExistingLibrary, writeNewLibrary, type LibraryStores, type OpenLibrary } from './libraryFiles'

function failure(path: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : ''
  const reason = /NODE_MODULE_VERSION|bindings file|native module|better-sqlite3/i.test(message)
    ? 'SQLite 组件与当前程序不匹配或无法加载。请修复安装后重试，或明确选择另一份书库。'
    : /SQLITE_CORRUPT|SQLITE_NOTADB|malformed|not a database/i.test(message)
      ? '文件损坏或不是有效的 SQLite 书库。请从备份恢复到新位置。'
      : /EACCES|EPERM|EBUSY|SQLITE_BUSY/.test(message) ? '文件被占用或当前没有读写权限。请检查后重试。'
        : message || '读取失败，请检查磁盘或选择备份。'
  return Object.assign(new Error(`无法打开书库：${path}\n${reason}`), { code: 'LIBRARY_UNAVAILABLE' })
}

// The only handle exposed to desktop writers belongs to a successfully read library.
export class LibrarySession {
  private active?: StorageService
  private unavailable?: Error
  private opening?: Promise<OpenLibrary>
  private requestedPath: string

  constructor(private readonly config: AppConfigService, private readonly stores: LibraryStores = libraryStores,
    private readonly prepareLegacy: (data: AppData) => Promise<AppData> = async data => data,
    private readonly previousDesktopLaunch = false) {
    this.requestedPath = config.getDefaultStoragePath()
  }

  get path(): string { return this.active?.getStoragePath() ?? this.requestedPath }
  getStorage(): StorageService {
    if (!this.active) throw this.unavailable ?? failure(this.path, new Error('尚未成功读取书库，请稍后重试。'))
    return this.active
  }
  adopt(storage: StorageService): void {
    if (this.active !== storage) this.active?.close?.()
    this.active = storage
    this.requestedPath = storage.getStoragePath()
    this.unavailable = undefined
  }
  close(): void { this.active?.close?.(); this.active = undefined }

  async load(): Promise<OpenLibrary> {
    if (this.opening) return this.opening
    if (this.unavailable) throw this.unavailable
    if (!this.active) return this.openConfigured()
    const storage = this.active
    try {
      const snapshot = await storage.loadSnapshot()
      if (storage !== this.active) throw new Error('书库已切换，请重新加载。')
      return { storage, snapshot }
    } catch (error) {
      if (storage !== this.active) throw error
      this.close()
      throw (this.unavailable = failure(this.path, error))
    }
  }

  assertRecoveryAvailable(action?: string): void {
    if (action === 'retry' && this.active && !this.opening) return
    if (this.active || !this.unavailable || this.opening) throw new Error('书库状态已改变，请刷新后重试。')
  }

  async recover(action: 'retry' | 'choose' | 'restore' | 'create', path?: string, backup?: string): Promise<void> {
    this.assertRecoveryAvailable(action)
    if (action === 'retry') { await (this.active ? this.load() : this.openConfigured()); return }
    if (!path) throw new Error('尚未选择书库。')
    const target = libraryFile(path)
    const recover = async (): Promise<OpenLibrary> => {
      let opened: OpenLibrary
      if (action === 'choose') {
        opened = await openExistingLibrary(target, this.stores)
      } else {
        if (!relative(target, this.requestedPath)) throw new Error('请另选一个新文件名，原书库位置将保留。')
        if (action === 'restore' && !backup) throw new Error('尚未选择备份。')
        let data: AppData | undefined
        if (backup) {
          if (extname(backup).toLowerCase() !== '.json') throw new Error('请选择 JSON 书库备份。')
          const source = await openExistingLibrary(backup, this.stores)
          try { data = source.snapshot.data } finally { source.storage.close?.() }
        }
        opened = await writeNewLibrary(target, this.stores, data)
      }
      return this.finish(opened, true)
    }
    this.opening = recover()
    try { await this.opening } finally { this.opening = undefined }
  }

  private openConfigured(): Promise<OpenLibrary> {
    this.opening = this.readConfigured().catch(error => {
      throw (this.unavailable = failure(this.requestedPath, error))
    }).finally(() => { this.opening = undefined })
    return this.opening
  }

  private async readConfigured(): Promise<OpenLibrary> {
    this.requestedPath = await this.config.getConfigPath()
    const selected = await this.config.readLibrarySelection()
    const path = selected?.storagePath ?? this.config.getDefaultStoragePath()
    this.requestedPath = path
    const directory = dirname(path)
    if (!selected && await hasLibraryTraces(directory, 'config')) {
      throw new Error('发现旧书库配置记录，但无法确认上次使用的位置。请选择原书库。')
    }
    if (selected || await exists(path)) {
      const opened = await openExistingLibrary(path, this.stores)
      if (!selected || selected.explicitJson || extname(path).toLowerCase() !== '.json') {
        return this.finish(opened, !selected)
      }
      // Old configs did not distinguish deliberate JSON use from an automatic fallback.
      try {
        const target = resolveSqliteStoragePath(path)
        if (await hasLibraryTraces(directory, 'sqlite')) {
          throw new Error('旧配置指向 JSON，但无法确定上次使用的是哪一份书库。请明确选择 SQLite 或独立 JSON。')
        }
        return await this.migrateLegacy(path, opened, target)
      } finally { opened.storage.close?.() }
    }
    const legacy = join(directory, JSON_DATA_FILE_NAME)
    const hasLegacy = await exists(legacy)
    if ((!hasLegacy && this.previousDesktopLaunch) || await hasLibraryTraces(directory, hasLegacy ? 'sqlite' : 'any')) {
      throw new Error('发现旧书库记录，但原书库不存在。请连接磁盘、选择书库或从备份恢复。')
    }
    if (hasLegacy) {
      this.requestedPath = legacy
      const opened = await openExistingLibrary(legacy, this.stores)
      try { return await this.migrateLegacy(legacy, opened, path) } finally { opened.storage.close?.() }
    }
    return this.finish(await writeNewLibrary(path, this.stores), true)
  }

  private async migrateLegacy(source: string, opened: OpenLibrary, target: string): Promise<OpenLibrary> {
    this.stores.checkSqlite()
    const data = await this.prepareLegacy(opened.snapshot.data)
    return this.finish(await writeNewLibrary(target, this.stores, data, () => backupLegacyJson(source)), true)
  }

  private async finish(opened: OpenLibrary, remember: boolean): Promise<OpenLibrary> {
    try {
      if (remember) {
        const path = opened.storage.getStoragePath()
        await this.config.setStoragePath(path, extname(path).toLowerCase() === '.json')
      }
      this.adopt(opened.storage)
      return opened
    } catch (error) {
      opened.storage.close?.()
      throw error
    }
  }
}
