const changed = '本地数据已被另一个窗口或 Agent 进程更新。为避免覆盖新内容，请重新加载数据后再保存。'
export const replayNeedsReload = '改名已提交，请重新加载最新数据后继续。'

export class StorageRevisionConflictError extends Error {
  readonly code = 'STORAGE_REVISION_CONFLICT'
  constructor(message = changed) { super(message); this.name = 'StorageRevisionConflictError' }
}

export function isStorageRevisionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  // Electron's contextBridge preserves Error.message but drops custom properties.
  return ('code' in error && error.code === 'STORAGE_REVISION_CONFLICT') ||
    ('message' in error && (error.message === changed || error.message === replayNeedsReload))
}
