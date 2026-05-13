import { app, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { redactSensitiveText } from '../shared/errorUtils'

const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function formatArg(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${redactSensitiveText(value.message)}${value.stack ? `\n${redactSensitiveText(value.stack)}` : ''}`
  }
  if (typeof value === 'string') return redactSensitiveText(value)
  try {
    return redactSensitiveText(JSON.stringify(value))
  } catch {
    return redactSensitiveText(String(value))
  }
}

export class LogService {
  private static initialized = false
  private static logPath = ''

  static initialize(): void {
    if (this.initialized) return
    this.initialized = true
    this.logPath = join(app.getPath('userData'), 'logs', 'main.log')
    mkdirSync(dirname(this.logPath), { recursive: true })
    this.info('='.repeat(80))
    this.info('Novel Director starting')
    this.info(`Version: ${app.getVersion()}`)
    this.info(`Platform: ${process.platform}`)
    this.info(`Electron: ${process.versions.electron}`)
    this.info(`Node: ${process.versions.node}`)
    this.info(`Chrome: ${process.versions.chrome}`)
    this.info(`User Data: ${app.getPath('userData')}`)
    this.info('='.repeat(80))
  }

  static getLogPath(): string {
    if (!this.logPath && app.isReady()) {
      this.logPath = join(app.getPath('userData'), 'logs', 'main.log')
    }
    return this.logPath
  }

  static openLogFile(): void {
    const path = this.getLogPath()
    if (path) shell.showItemInFolder(path)
  }

  static debug(message: string, ...args: unknown[]): void {
    this.write('debug', message, args)
  }

  static info(message: string, ...args: unknown[]): void {
    this.write('info', message, args)
  }

  static warn(message: string, ...args: unknown[]): void {
    this.write('warn', message, args)
  }

  static error(message: string, ...args: unknown[]): void {
    this.write('error', message, args)
  }

  private static write(level: LogLevel, message: string, args: unknown[]): void {
    const path = this.getLogPath()
    const text = [redactSensitiveText(message), ...args.map(formatArg)].filter(Boolean).join(' ')
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${text}\n`

    if (!path) {
      if (!app.isPackaged) {
        const output = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
        output(line.trimEnd())
      }
      return
    }

    try {
      mkdirSync(dirname(path), { recursive: true })
      this.rotateIfNeeded(path)
      appendFileSync(path, line, 'utf-8')
    } catch (error) {
      if (!app.isPackaged) console.warn('Failed to write log file.', error)
    }
  }

  private static rotateIfNeeded(path: string): void {
    if (!existsSync(path)) return
    const info = statSync(path)
    if (info.size < MAX_LOG_SIZE_BYTES) return
    const rotatedPath = `${path}.${Date.now()}.old`
    renameSync(path, rotatedPath)
  }
}
