import { app, BrowserWindow, shell, session } from 'electron'
import { join } from 'node:path'
import { AppConfigService } from './AppConfigService'
import { SecureCredentialService } from './SecureCredentialService'
import { TokenBucketRateLimiter } from './RateLimiter'
import type { StorageService } from '../storage/StorageService'
import { createStorageService } from '../storage/SqliteStorageService'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'
import type { ApiProvider } from '../shared/types'

let storage: StorageService
let appConfig: AppConfigService
let credentialService: SecureCredentialService
const aiRateLimiters: Partial<Record<ApiProvider, TokenBucketRateLimiter>> = {
  openai: new TokenBucketRateLimiter(60, 1),
  compatible: new TokenBucketRateLimiter(30, 0.5)
}
const isSmokeTest = process.env.NOVEL_DIRECTOR_SMOKE_TEST === '1'
if (isSmokeTest) {
  app.disableHardwareAcceleration()
}
const isDev = !app.isPackaged
const contentSecurityPolicy = isDev
  ? [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  : [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')

let contentSecurityPolicyRegistered = false

function registerContentSecurityPolicy(): void {
  if (contentSecurityPolicyRegistered) return
  contentSecurityPolicyRegistered = true
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy]
      }
    })
  })
}

function canOpenExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
  } catch {
    return false
  }
}

function isAllowedRendererNavigation(url: string): boolean {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return url.startsWith(process.env.ELECTRON_RENDERER_URL)
  }
  return url.startsWith('file://')
}

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
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
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
              hasApi: Boolean(window.novelDirector),
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
    if (canOpenExternalUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererNavigation(url)) {
      event.preventDefault()
    }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.novel-director.mvp')
  registerContentSecurityPolicy()
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
    },
    aiRateLimiters
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
