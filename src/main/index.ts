import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { dirname, extname, join, resolve } from 'node:path'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { AppConfigService } from './AppConfigService'
import { JsonStorageService } from '../storage/JsonStorageService'
import { normalizeAppData } from '../shared/defaults'
import type { AppData, AppSettings } from '../shared/types'

let storage: JsonStorageService
let appConfig: AppConfigService
const isSmokeTest = process.env.NOVEL_DIRECTOR_SMOKE_TEST === '1'
const DATA_FILE_NAME = 'novel-director-data.json'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    title: 'Novel Director',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!isSmokeTest) {
      mainWindow.show()
    }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    if (isSmokeTest) {
      console.error(`Smoke test load failed: ${errorCode} ${errorDescription}`)
      app.exit(1)
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (isSmokeTest) {
      setTimeout(() => {
        void mainWindow.webContents
          .executeJavaScript(
            `({
              hasApi: Boolean(window.novelAPI),
              bodyText: document.body.innerText.trim().slice(0, 120)
            })`
          )
          .then((result: { hasApi: boolean; bodyText: string }) => {
            if (!result.hasApi || !result.bodyText) {
              console.error(`Smoke test render failed: ${JSON.stringify(result)}`)
              app.exit(1)
              return
            }
            app.quit()
          })
          .catch((error) => {
            console.error('Smoke test render check failed:', error)
            app.exit(1)
          })
      }, 1000)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function resolveDataStoragePath(rawPath: string): Promise<string> {
  const trimmed = rawPath.trim()
  if (!trimmed) throw new Error('请选择或输入数据保存路径。')
  const absolutePath = resolve(trimmed)

  try {
    const info = await stat(absolutePath)
    if (info.isDirectory()) return join(absolutePath, DATA_FILE_NAME)
  } catch {
    // Non-existing paths are allowed if they end with .json; otherwise we treat them as folders.
  }

  if (extname(absolutePath).toLowerCase() === '.json') return absolutePath
  return join(absolutePath, DATA_FILE_NAME)
}

async function backupExistingSourceData(sourcePath: string): Promise<string | null> {
  if (!(await pathExists(sourcePath))) return null
  const backupPath = `${sourcePath}.before-migrate.${Date.now()}.json`
  await copyFile(sourcePath, backupPath)
  return backupPath
}

async function migrateStoragePath(rawTargetPath: string, data: AppData, overwrite = false) {
  const oldPath = storage.getStoragePath()
  const targetPath = await resolveDataStoragePath(rawTargetPath)

  try {
    await storage.save(data)

    if (oldPath !== targetPath && (await pathExists(targetPath)) && !overwrite) {
      return {
        ok: false,
        needsOverwrite: true,
        storagePath: oldPath,
        targetPath,
        error: '目标路径已存在数据文件。MVP 当前只支持覆盖或取消。'
      }
    }

    await mkdir(dirname(targetPath), { recursive: true })
    const backupPath = await backupExistingSourceData(oldPath)
    const nextStorage = new JsonStorageService(targetPath)
    await nextStorage.save(normalizeAppData(data))
    await nextStorage.load()
    await appConfig.setStoragePath(targetPath)
    storage = nextStorage

    return {
      ok: true,
      storagePath: targetPath,
      backupPath: backupPath ?? undefined
    }
  } catch (error) {
    return {
      ok: false,
      storagePath: oldPath,
      error: errorMessage(error)
    }
  }
}

async function saveTextFile(content: string, defaultFileName: string, markdown = false) {
  const result = await dialog.showSaveDialog({
    title: markdown ? '导出 Markdown 文件' : '导出文本文件',
    defaultPath: defaultFileName,
    filters: markdown ? [{ name: 'Markdown', extensions: ['md'] }] : [{ name: 'Text', extensions: ['txt'] }]
  })

  if (result.canceled || !result.filePath) return { canceled: true }
  await writeFile(result.filePath, content, 'utf-8')
  return { canceled: false, filePath: result.filePath }
}

function registerIpc(): void {
  ipcMain.handle('storage:get', async () => {
    const data = await storage.load()
    return {
      data,
      storagePath: storage.getStoragePath()
    }
  })

  ipcMain.handle('storage:save', async (_event, data: AppData) => {
    await storage.save(data)
    return {
      ok: true,
      storagePath: storage.getStoragePath()
    }
  })

  ipcMain.handle('storage:export', async (_event, data: AppData) => {
    const result = await dialog.showSaveDialog({
      title: '导出小说导演台数据',
      defaultPath: 'novel-director-export.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) return { canceled: true }
    await writeFile(result.filePath, JSON.stringify(normalizeAppData(data), null, 2), 'utf-8')
    return { canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('storage:import', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入小说导演台数据',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const raw = await readFile(result.filePaths[0], 'utf-8')
    const imported = normalizeAppData(JSON.parse(raw) as Partial<AppData>)
    await storage.save(imported)
    return {
      canceled: false,
      filePath: result.filePaths[0],
      data: imported,
      storagePath: storage.getStoragePath()
    }
  })

  ipcMain.handle('app:get-storage-path', async () => ({
    storagePath: storage.getStoragePath(),
    defaultStoragePath: appConfig.getDefaultStoragePath()
  }))

  ipcMain.handle('app:select-storage-path', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择数据保存位置',
      properties: ['openFile', 'openDirectory', 'promptToCreate'],
      filters: [{ name: 'JSON 数据文件', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    return {
      canceled: false,
      storagePath: await resolveDataStoragePath(result.filePaths[0])
    }
  })

  ipcMain.handle('app:migrate-storage-path', async (_event, request: { storagePath: string; data: AppData; overwrite?: boolean }) =>
    migrateStoragePath(request.storagePath, request.data, Boolean(request.overwrite))
  )

  ipcMain.handle('app:reset-storage-path', async (_event, request: { data: AppData; overwrite?: boolean }) =>
    migrateStoragePath(appConfig.getDefaultStoragePath(), request.data, Boolean(request.overwrite))
  )

  ipcMain.handle('app:open-storage-folder', async (_event, storagePath?: string) => {
    const target = storagePath || storage.getStoragePath()
    if (await pathExists(target)) {
      shell.showItemInFolder(target)
      return { ok: true }
    }
    const error = await shell.openPath(dirname(target))
    return error ? { ok: false, error } : { ok: true }
  })

  ipcMain.handle('export:save-text-file', async (_event, request: { content: string; defaultFileName: string }) =>
    saveTextFile(request.content, request.defaultFileName, false)
  )

  ipcMain.handle('export:save-markdown-file', async (_event, request: { content: string; defaultFileName: string }) =>
    saveTextFile(request.content, request.defaultFileName, true)
  )

  ipcMain.handle('clipboard:write', async (_event, text: string) => {
    clipboard.writeText(text)
    return { ok: true }
  })

  ipcMain.handle('clipboard:write-text', async (_event, text: string) => {
    clipboard.writeText(text)
    return { ok: true }
  })

  ipcMain.handle(
    'ai:chatCompletion',
    async (
      _event,
      request: {
        settings: AppSettings
        messages: Array<{ role: 'system' | 'user'; content: string }>
      }
    ) => {
      const settings = request.settings
      if (settings.apiProvider !== 'local' && !settings.apiKey.trim()) {
        return { ok: false, error: '未配置 API Key。已跳过远程 AI 调用。' }
      }

      const baseUrl = settings.baseUrl.replace(/\/+$/, '')
      const url = `${baseUrl}/chat/completions`
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }
      if (settings.apiKey.trim()) {
        headers.Authorization = `Bearer ${settings.apiKey.trim()}`
      }

      const requestBody = {
        model: settings.modelName,
        messages: request.messages,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        response_format: { type: 'json_object' }
      }

      try {
        let response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody)
        })

        if (!response.ok) {
          const errorText = await response.text()
          if (/response_format|json_object|unsupported/i.test(errorText)) {
            const { response_format: _responseFormat, ...fallbackBody } = requestBody
            response = await fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(fallbackBody)
            })
            if (response.ok) {
              const payload = (await response.json()) as {
                choices?: Array<{ finish_reason?: string; finishReason?: string; message?: { content?: string } }>
              }
              const choice = payload.choices?.[0]
              const content = choice?.message?.content
              if (!content) return { ok: false, error: 'AI 返回为空。' }
              return { ok: true, content, finishReason: choice?.finish_reason ?? choice?.finishReason }
            }
          }
          return { ok: false, error: `AI 调用失败：HTTP ${response.status} ${errorText.slice(0, 500)}` }
        }

        const payload = (await response.json()) as {
          choices?: Array<{ finish_reason?: string; finishReason?: string; message?: { content?: string } }>
        }
        const choice = payload.choices?.[0]
        const content = choice?.message?.content
        if (!content) return { ok: false, error: 'AI 返回为空。' }
        return { ok: true, content, finishReason: choice?.finish_reason ?? choice?.finishReason }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.novel-director.mvp')
  appConfig = new AppConfigService(app.getPath('userData'))
  storage = new JsonStorageService(await appConfig.getStoragePath())
  registerIpc()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
