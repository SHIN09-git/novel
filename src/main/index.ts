import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { AppConfigService } from './AppConfigService'
import { SecureCredentialService } from './SecureCredentialService'
import type { StorageService } from '../storage/StorageService'
import { createStorageService } from '../storage/SqliteStorageService'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'

let storage: StorageService
let appConfig: AppConfigService
let credentialService: SecureCredentialService
const isSmokeTest = process.env.NOVEL_DIRECTOR_SMOKE_TEST === '1'

function createWindow(): void {
  const windowIcon = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(process.cwd(), 'build', 'icon.png')
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    icon: windowIcon,
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
              hasApi: Boolean(window.novelDirector || window.novelAPI),
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

app.whenReady().then(async () => {
  app.setAppUserModelId('com.novel-director.mvp')
  appConfig = new AppConfigService(app.getPath('userData'))
  credentialService = new SecureCredentialService(app.getPath('userData'))
  const configuredStoragePath = await appConfig.getStoragePath()
  storage = createStorageService(configuredStoragePath)
  if (storage.getStoragePath() !== configuredStoragePath) {
    await appConfig.setStoragePath(storage.getStoragePath())
  }
  registerIpcHandlers({
    appConfig,
    credentialService,
    getStorage: () => storage,
    setStorage: (nextStorage) => {
      storage = nextStorage
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
