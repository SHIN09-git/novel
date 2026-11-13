import { homedir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { AppConfigService } from '../main/AppConfigService'
import { exists, hasLibraryTraces, libraryFile } from '../main/libraryFiles'
import { JSON_DATA_FILE_NAME, SQLITE_DATA_FILE_NAME } from '../storage/StorageService'

export interface AgentRuntimeLoadOptions {
  storagePath?: string
  userDataPath?: string
}

export interface AgentLibraryChoice {
  storagePath: string
  userDataPath: string
  source: 'sqlite' | 'json' | 'empty'
}

export function storageSourceForPath(storagePath: string): 'sqlite' | 'json' {
  return storagePath.toLowerCase().endsWith('.json') ? 'json' : 'sqlite'
}

function defaultUserDataPath(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Novel Director')
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Novel Director')
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Novel Director')
}

function missingLibrary(path: string): Error {
  return new Error(`Project database not found. 找不到原书库：${path}。请检查路径，或在桌面重新选择书库。`)
}

export async function resolveAgentRuntimeStoragePath(
  options: AgentRuntimeLoadOptions = {}, mode?: 'overview'
): Promise<AgentLibraryChoice> {
  const userDataPath = resolve(options.userDataPath ?? defaultUserDataPath())
  const explicit = options.storagePath ? resolve(options.storagePath) : undefined
  const namedFile = explicit && extname(explicit) ? libraryFile(explicit) : undefined
  const directory = explicit && !namedFile ? explicit : userDataPath
  const sqlite = join(directory, SQLITE_DATA_FILE_NAME)
  const choice = (storagePath: string): AgentLibraryChoice =>
    ({ storagePath, userDataPath, source: storageSourceForPath(storagePath) })

  if (namedFile) {
    if (await exists(namedFile)) return choice(namedFile)
    // Old overview callers probe an unconfigured profile using its default SQLite filename.
    if (mode !== 'overview' || relative(sqlite, namedFile) !== '') throw missingLibrary(namedFile)
  }

  const selected = await new AppConfigService(directory).readLibrarySelection()
  if (selected) {
    if (namedFile) throw missingLibrary(namedFile)
    const path = libraryFile(selected.storagePath)
    if (!await exists(path)) throw missingLibrary(path)
    if (!selected.explicitJson && storageSourceForPath(path) === 'json' && await hasLibraryTraces(dirname(path), 'sqlite')) {
      throw new Error(`旧配置指向 ${path}，但同目录留有 SQLite 书库记录。请在桌面明确选择书库。`)
    }
    return choice(path)
  }

  if (await exists(directory)) {
    if (await hasLibraryTraces(directory, 'config')) throw new Error(`无法确认 ${directory} 上次选择的书库，请在桌面重新选择。`)
    if (await exists(sqlite)) return choice(sqlite)
    const json = join(directory, JSON_DATA_FILE_NAME)
    const hasJson = await exists(json)
    if (await hasLibraryTraces(directory, hasJson ? 'sqlite' : 'any')) throw missingLibrary(sqlite)
    if (hasJson) return choice(json)
  }
  return { storagePath: sqlite, userDataPath, source: 'empty' }
}
