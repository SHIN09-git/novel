import { app, clipboard, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { IPC_CHANNELS } from '../../shared/ipc/ipcChannels'
import type {
  SaveFileResult,
  SaveMarkdownFileRequest,
  SaveTextFileRequest
} from '../../shared/ipc/ipcTypes'
import { validateFilePath, validateString } from '../../shared/validation'
import { LogService } from '../LogService'
import { collectCurrentRuntimeInfo } from '../RuntimeInfoService'
import { safeIpcHandler } from './safeIpcHandler'

async function saveTextFile(
  request: SaveTextFileRequest | SaveMarkdownFileRequest,
  markdown = false
): Promise<SaveFileResult> {
  const content = validateString(request.content, 'Export content', { maxLength: 2_000_000, trim: false })
  const defaultFileName = validateFilePath(request.defaultFileName, 'Export file name')

  const result = await dialog.showSaveDialog({
    title: markdown ? '导出 Markdown 文件' : '导出文本文件',
    defaultPath: defaultFileName,
    filters: markdown ? [{ name: 'Markdown', extensions: ['md'] }] : [{ name: 'Text', extensions: ['txt'] }]
  })

  if (result.canceled || !result.filePath) return { canceled: true }
  await writeFile(result.filePath, content, 'utf-8')
  return { canceled: false, filePath: result.filePath }
}

export function registerUtilityIpcHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.APP_GET_RUNTIME_INFO,
    safeIpcHandler(async () => collectCurrentRuntimeInfo(app))
  )

  ipcMain.handle(
    IPC_CHANNELS.LOGS_GET_PATH,
    safeIpcHandler(async () => ({
      ok: true as const,
      logPath: LogService.getLogPath()
    }))
  )

  ipcMain.handle(
    IPC_CHANNELS.LOGS_OPEN,
    safeIpcHandler(async () => {
      LogService.openLogFile()
      return { ok: true as const }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.EXPORT_SAVE_TEXT_FILE,
    safeIpcHandler(async (_event, request: SaveTextFileRequest): Promise<SaveFileResult> => saveTextFile(request, false))
  )

  ipcMain.handle(
    IPC_CHANNELS.EXPORT_SAVE_MARKDOWN_FILE,
    safeIpcHandler(async (_event, request: SaveMarkdownFileRequest): Promise<SaveFileResult> => saveTextFile(request, true))
  )

  const writeClipboardText = (text: string): { ok: true } => {
    clipboard.writeText(validateString(text, 'Clipboard text', { maxLength: 500_000, trim: false }))
    return { ok: true }
  }

  ipcMain.handle(
    IPC_CHANNELS.CLIPBOARD_WRITE_LEGACY,
    safeIpcHandler(async (_event, text: string) => writeClipboardText(text))
  )

  ipcMain.handle(
    IPC_CHANNELS.CLIPBOARD_WRITE_TEXT,
    safeIpcHandler(async (_event, text: string) => writeClipboardText(text))
  )
}
