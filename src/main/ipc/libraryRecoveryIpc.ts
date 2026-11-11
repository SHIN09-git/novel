import { dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../shared/ipc/ipcChannels'
import type { LibrarySession } from '../LibrarySession'
import { safeIpcHandler } from './safeIpcHandler'
import { assertSafeDataStoragePath, isPathInsideOrSame } from './storagePath'

// File paths come exclusively from a native picker, never from the renderer.
export function registerLibraryRecoveryIpc(session: LibrarySession, userData: string, backups: string): void {
  let busy = false
  ipcMain.handle(IPC_CHANNELS.APP_RECOVER_LIBRARY, safeIpcHandler(async (_event, action: unknown) => {
    if (action !== 'choose' && action !== 'restore' && action !== 'create' && action !== 'retry') {
      throw new Error('未知的书库恢复操作。')
    }
    if (busy) throw new Error('已有书库操作正在进行。')
    session.assertRecoveryAvailable(action)
    busy = true
    try {
      let source: string | undefined
      let target: string | undefined
      if (action === 'choose' || action === 'restore') {
        const chosen = await dialog.showOpenDialog({
          title: action === 'restore' ? '选择要恢复的 JSON 备份' : '选择已有书库',
          defaultPath: action === 'restore' ? backups : undefined, properties: ['openFile'],
          filters: [{ name: action === 'restore' ? 'JSON 书库备份' : '书库文件', extensions: action === 'restore' ? ['json'] : ['sqlite', 'db', 'json'] }]
        })
        if (chosen.canceled || !chosen.filePaths[0]) return { ok: true, cancelled: true }
        if (action === 'choose') target = chosen.filePaths[0]
        else source = chosen.filePaths[0]
      }
      if (action === 'restore' || action === 'create') {
        const chosen = await dialog.showSaveDialog({
          title: action === 'restore' ? '将备份恢复到新文件（不覆盖原书库）' : '新建独立书库',
          defaultPath: join(userData, action === 'restore' ? '恢复的书库.sqlite' : '新书库.sqlite'),
          filters: [{ name: 'SQLite 书库', extensions: ['sqlite'] }, { name: '独立 JSON 书库', extensions: ['json'] }]
        })
        if (chosen.canceled || !chosen.filePath) return { ok: true, cancelled: true }
        target = chosen.filePath
      }
      if (target) assertSafeDataStoragePath(target)
      if (target && (isPathInsideOrSame(target, backups) || /\.before-sqlite-migrate\..*\.json$/i.test(target))) {
        throw new Error('这是备份位置，不能用作当前书库。请用“从备份恢复到新文件”，另选保存位置。')
      }
      if (target && /\.json$/i.test(target)) {
        const choice = await dialog.showMessageBox({
          type: 'question', title: '使用独立 JSON 书库', message: '后续修改只保存到这个文件，不会自动合回 SQLite。',
          detail: target, buttons: ['取消', '使用这个 JSON 书库'], defaultId: 0, cancelId: 0
        })
        if (choice.response !== 1) return { ok: true, cancelled: true }
      }
      await session.recover(action, target, source)
      return { ok: true }
    } finally { busy = false }
  }))
}
