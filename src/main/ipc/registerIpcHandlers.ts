import { app, clipboard, dialog, ipcMain, shell } from 'electron'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { safeParseJson } from '../../services/AIJsonParser'
import { normalizeAppData, sanitizeAppDataForPersistence } from '../../shared/defaults'
import { getUserFriendlyError, redactSensitiveText } from '../../shared/errorUtils'
import { IPC_CHANNELS } from '../../shared/ipc/ipcChannels'
import {
  ValidationError,
  validateApiKey,
  validateFilePath,
  validateNumber,
  validateString,
  validateUrl
} from '../../shared/validation'
import type {
  ChatCompletionResult,
  ChatCompletionRequest,
  ConfirmMigrationMergeRequest,
  ConfirmMigrationMergeResult,
  BackupCreateResult,
  BackupDeleteResult,
  BackupListResult,
  BackupOpenFolderResult,
  BackupRestoreResult,
  CredentialDeleteApiKeyResult,
  CredentialHasApiKeyResult,
  CredentialMigrateLegacyApiKeyResult,
  CredentialSetApiKeyRequest,
  CredentialSetApiKeyResult,
  ExportDataResult,
  GetStoragePathResult,
  ImportDataResult,
  MigrateStoragePathRequest,
  MigrateStoragePathResult,
  MigrationMergePreviewRequest,
  MigrationMergePreviewResult,
  OpenStorageFolderResult,
  ResetStoragePathRequest,
  SaveChapterCommitBundleRequest,
  SaveGenerationRunBundleRequest,
  SaveRevisionCommitBundleRequest,
  SaveFileResult,
  SaveMarkdownFileRequest,
  SaveTextFileRequest,
  SelectStoragePathResult,
  StorageGetResult,
  StorageSaveResult,
  StorageWriteResult
} from '../../shared/ipc/ipcTypes'
import type { ApiProvider, AppData } from '../../shared/types'
import { AppConfigService } from '../AppConfigService'
import { BackupService } from '../BackupService'
import {
  backupFileForOverwrite,
  confirmMigrationMerge,
  createMigrationMergePreview
} from '../DataMergeService'
import { SecureCredentialService } from '../SecureCredentialService'
import { LogService } from '../LogService'
import type { IAIService } from '../services/AIService'
import type { StorageService } from '../../storage/StorageService'
import { SQLITE_DATA_FILE_NAME } from '../../storage/StorageService'
import { createStorageService } from '../../storage/SqliteStorageService'
import { safeIpcHandler } from './safeIpcHandler'

interface IpcHandlerContext {
  appConfig: AppConfigService
  credentialService: SecureCredentialService
  backupService: BackupService
  getStorage: () => StorageService
  setStorage: (storage: StorageService) => void
  aiService: IAIService
}

async function maybeCreateAutomaticBackup(context: IpcHandlerContext, reason: string): Promise<void> {
  try {
    const storage = context.getStorage()
    const currentData = await storage.load()
    const backupPath = await context.backupService.maybeCreateAutomaticBackup(currentData)
    if (backupPath) LogService.info(`Automatic backup created before ${reason}: ${backupPath}`)
  } catch (error) {
    LogService.warn(`Automatic backup skipped before ${reason}`, error)
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const localDataFileExtensions = new Set(['.sqlite', '.db', '.json'])

function isPathInsideOrSame(childPath: string, parentPath: string): boolean {
  const parent = resolve(parentPath)
  const child = resolve(childPath)
  const relationship = relative(parent, child)
  return relationship === '' || (!!relationship && !relationship.startsWith('..') && !isAbsolute(relationship))
}

function getForbiddenStorageRoots(): string[] {
  const roots = [
    process.env.SystemRoot,
    process.env.WINDIR,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData
  ]

  if (app.isPackaged) {
    roots.push(dirname(process.execPath), app.getAppPath())
  }

  return roots.filter((root): root is string => Boolean(root?.trim()))
}

function assertSafeDataStoragePath(candidatePath: string): string {
  const candidate = resolve(candidatePath)
  const extension = extname(candidate).toLowerCase()
  if (!localDataFileExtensions.has(extension)) {
    throw new Error('Data storage path must end with .sqlite, .db, or .json.')
  }

  const targetDir = dirname(candidate)
  if (parse(targetDir).root === targetDir) {
    throw new Error('Data storage path cannot be a filesystem root directory.')
  }

  for (const forbiddenRoot of getForbiddenStorageRoots()) {
    if (isPathInsideOrSame(candidate, forbiddenRoot)) {
      throw new Error('Data storage path cannot be inside a protected system or application directory.')
    }
  }

  return candidate
}

async function resolveDataStoragePath(rawPath: string): Promise<string> {
  const trimmed = validateFilePath(rawPath, 'Data storage path')
  const absolutePath = resolve(trimmed)
  let candidatePath = ''

  try {
    const info = await stat(absolutePath)
    if (info.isDirectory()) candidatePath = join(absolutePath, SQLITE_DATA_FILE_NAME)
  } catch {
    // Non-existing paths are allowed if they end with a known local-data extension; otherwise treat them as folders.
  }

  if (!candidatePath) {
    const extension = extname(absolutePath).toLowerCase()
    if (extension) {
      if (!localDataFileExtensions.has(extension)) {
        throw new Error('Data storage path must end with .sqlite, .db, or .json.')
      }
      candidatePath = absolutePath
    } else {
      candidatePath = join(absolutePath, SQLITE_DATA_FILE_NAME)
    }
  }

  return assertSafeDataStoragePath(candidatePath)
}

async function backupExistingSourceData(sourcePath: string): Promise<string | null> {
  if (!(await pathExists(sourcePath))) return null
  const backupPath = `${sourcePath}.before-migrate.${Date.now()}.json`
  await copyFile(sourcePath, backupPath)
  return backupPath
}

async function saveTextFile(request: SaveTextFileRequest | SaveMarkdownFileRequest, markdown = false): Promise<SaveFileResult> {
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

const apiProviders = new Set<ApiProvider>(['openai', 'compatible', 'local'])
const chatMessageRoles = new Set(['system', 'user'])

function validateApiProvider(value: unknown): ApiProvider {
  if (typeof value !== 'string' || !apiProviders.has(value as ApiProvider)) {
    throw new ValidationError('AI provider is not supported.')
  }
  return value as ApiProvider
}

function validateChatMessages(messages: unknown): ChatCompletionRequest['messages'] {
  if (!Array.isArray(messages)) {
    throw new ValidationError('AI messages must be an array.')
  }
  if (!messages.length) {
    throw new ValidationError('AI messages cannot be empty.')
  }
  if (messages.length > 128) {
    throw new ValidationError('AI messages contain too many entries.')
  }

  return messages.map((message, index) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new ValidationError(`AI message ${index + 1} must be an object.`)
    }
    const record = message as Record<string, unknown>
    const role = validateString(record.role, `AI message ${index + 1} role`, { minLength: 1, maxLength: 20 })
    if (!chatMessageRoles.has(role)) {
      throw new ValidationError(`AI message ${index + 1} role is not supported.`)
    }

    return {
      role: role as 'system' | 'user',
      content: validateString(record.content, `AI message ${index + 1} content`, {
        minLength: 1,
        maxLength: 500_000,
        trim: false
      })
    }
  })
}

function validateChatCompletionRequest(request: ChatCompletionRequest): ChatCompletionRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new ValidationError('AI chat request must be an object.')
  }
  const record = request as unknown as Record<string, unknown>
  const settings = record.settings && typeof record.settings === 'object' && !Array.isArray(record.settings)
    ? (record.settings as Record<string, unknown>)
    : null
  if (!settings) {
    throw new ValidationError('AI settings are required.')
  }

  return {
    settings: {
      ...(request.settings ?? {}),
      apiProvider: validateApiProvider(settings.apiProvider),
      baseUrl: validateUrl(settings.baseUrl, 'AI Base URL'),
      modelName: validateString(settings.modelName, 'AI model name', { minLength: 1, maxLength: 200 }),
      temperature: validateNumber(settings.temperature, 'AI temperature', { min: 0, max: 2 }),
      maxTokens: validateNumber(settings.maxTokens, 'AI max tokens', { min: 1, max: 200_000, integer: true }),
      retryEnabled: typeof settings.retryEnabled === 'boolean' ? settings.retryEnabled : true,
      maxRetries: typeof settings.maxRetries === 'number'
        ? validateNumber(settings.maxRetries, 'AI max retries', { min: 0, max: 10, integer: true })
        : 3
    },
    messages: validateChatMessages(record.messages)
  }
}

async function secureAndSanitizeAppData(
  context: IpcHandlerContext,
  data: AppData
): Promise<{ data: AppData; migratedLegacyApiKey: boolean; credentialWarning?: string }> {
  const normalized = normalizeAppData(data)
  const legacyApiKey = normalized.settings.apiKey.trim()
  let hasApiKey = normalized.settings.hasApiKey
  let migratedLegacyApiKey = false
  let credentialWarning = ''

  if (legacyApiKey) {
    try {
      await context.credentialService.migrateLegacyApiKey(legacyApiKey)
      hasApiKey = true
      migratedLegacyApiKey = true
    } catch (error) {
      hasApiKey = false
      credentialWarning = `旧 API Key 迁移到安全存储失败，已从 AppData 中移除：${getUserFriendlyError(error)}`
    }
  } else {
    try {
      hasApiKey = await context.credentialService.hasApiKey()
    } catch (error) {
      credentialWarning = `读取 API Key 安全存储状态失败：${getUserFriendlyError(error)}`
    }
  }

  return {
    data: sanitizeAppDataForPersistence({
      ...normalized,
      settings: {
        ...normalized.settings,
        apiKey: '',
        hasApiKey
      }
    }),
    migratedLegacyApiKey,
    credentialWarning
  }
}

async function migrateStoragePath(
  context: IpcHandlerContext,
  rawTargetPath: string,
  data: AppData,
  overwrite = false
): Promise<MigrateStoragePathResult> {
  const storage = context.getStorage()
  const oldPath = storage.getStoragePath()
  const targetPath = await resolveDataStoragePath(rawTargetPath)

  try {
    const secured = await secureAndSanitizeAppData(context, data)
    await storage.save(secured.data)

    const targetAlreadyExists = oldPath !== targetPath && (await pathExists(targetPath))
    if (targetAlreadyExists && !overwrite) {
      const mergePreview = await createMigrationMergePreview(oldPath, targetPath)
      return {
        ok: false,
        needsOverwrite: true,
        needsMerge: true,
        storagePath: oldPath,
        targetPath,
        mergePreview,
        error: '目标路径已存在数据文件。请选择合并已有数据、覆盖目标数据或取消迁移。'
      }
    }

    await mkdir(dirname(targetPath), { recursive: true })
    const backupPath = await backupExistingSourceData(oldPath)
    const targetBackupPath = targetAlreadyExists ? await backupFileForOverwrite(targetPath) : null
    const nextStorage = createStorageService(targetPath)
    await nextStorage.save(secured.data)
    await nextStorage.load()
    const activeStoragePath = nextStorage.getStoragePath()
    await context.appConfig.setStoragePath(activeStoragePath)
    context.setStorage(nextStorage)

    return {
      ok: true,
      storagePath: activeStoragePath,
      backupPath: backupPath ?? undefined,
      targetBackupPath: targetBackupPath ?? undefined
    }
  } catch (error) {
    return {
      ok: false,
      storagePath: oldPath,
      error: redactSensitiveText(getUserFriendlyError(error)).slice(0, 800)
    }
  }
}

export function registerIpcHandlers(context: IpcHandlerContext): void {
  ipcMain.handle(
    IPC_CHANNELS.STORAGE_GET,
    safeIpcHandler(async (): Promise<StorageGetResult> => {
      const storage = context.getStorage()
      LogService.info(`Loading storage data from ${storage.getStoragePath()}`)
      const loaded = await storage.load()
      const secured = await secureAndSanitizeAppData(context, loaded)
      if (secured.migratedLegacyApiKey || loaded.settings.apiKey || loaded.settings.hasApiKey !== secured.data.settings.hasApiKey) {
        await maybeCreateAutomaticBackup(context, 'legacy credential migration')
        await storage.save(secured.data)
      }
      LogService.info(`Storage loaded: projects=${secured.data.projects.length}, chapters=${secured.data.chapters.length}`)
      return {
        data: secured.data,
        storagePath: storage.getStoragePath(),
        credentialWarning: secured.credentialWarning
      }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.STORAGE_SAVE,
    safeIpcHandler(async (_event, data: AppData): Promise<StorageSaveResult> => {
      const storage = context.getStorage()
      const secured = await secureAndSanitizeAppData(context, data)
      await maybeCreateAutomaticBackup(context, 'full AppData save')
      await storage.save(secured.data)
      LogService.info(`Storage saved: ${storage.getStoragePath()}`)
      return {
        ok: true,
        storagePath: storage.getStoragePath(),
        credentialWarning: secured.credentialWarning
      }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE,
    safeIpcHandler(async (_event, request: SaveGenerationRunBundleRequest): Promise<StorageWriteResult> => {
      const storage = context.getStorage()
      await maybeCreateAutomaticBackup(context, 'generation run bundle save')
      LogService.info(`Saving GenerationRunBundle: jobId=${request.bundle.jobId}`)
      return storage.saveGenerationRunBundle(request.bundle)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.DATA_SAVE_CHAPTER_COMMIT_BUNDLE,
    safeIpcHandler(async (_event, request: SaveChapterCommitBundleRequest): Promise<StorageWriteResult> => {
      const storage = context.getStorage()
      await maybeCreateAutomaticBackup(context, 'chapter commit bundle save')
      LogService.info(`Saving ChapterCommitBundle: commitId=${request.bundle.commitId}`)
      return storage.saveChapterCommitBundle(request.bundle)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.DATA_SAVE_REVISION_COMMIT_BUNDLE,
    safeIpcHandler(async (_event, request: SaveRevisionCommitBundleRequest): Promise<StorageWriteResult> => {
      const storage = context.getStorage()
      await maybeCreateAutomaticBackup(context, 'revision commit bundle save')
      LogService.info(`Saving RevisionCommitBundle: revisionCommitId=${request.bundle.revisionCommitId}`)
      return storage.saveRevisionCommitBundle(request.bundle)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.STORAGE_EXPORT,
    safeIpcHandler(async (_event, data: AppData): Promise<ExportDataResult> => {
      const result = await dialog.showSaveDialog({
        title: '导出 Novel Director 数据',
        defaultPath: 'novel-director-export.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })

      if (result.canceled || !result.filePath) return { canceled: true }
      await writeFile(result.filePath, JSON.stringify(sanitizeAppDataForPersistence(data), null, 2), 'utf-8')
      return { canceled: false, filePath: result.filePath }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.STORAGE_IMPORT,
    safeIpcHandler(async (): Promise<ImportDataResult> => {
      const result = await dialog.showOpenDialog({
        title: '导入 Novel Director 数据',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })

      if (result.canceled || !result.filePaths[0]) return { canceled: true }
      const storage = context.getStorage()
      const raw = await readFile(result.filePaths[0], 'utf-8')
      const parsed = safeParseJson<Partial<AppData>>(raw, '导入数据文件')
      if (!parsed.ok) throw new Error(parsed.parseError)
      const imported = normalizeAppData(parsed.data)
      const secured = await secureAndSanitizeAppData(context, imported)
      await storage.save(secured.data)
      return {
        canceled: false,
        filePath: result.filePaths[0],
        data: secured.data,
        storagePath: storage.getStoragePath(),
        credentialWarning: secured.credentialWarning
      }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_GET_STORAGE_PATH,
    safeIpcHandler(async (): Promise<GetStoragePathResult> => ({
      storagePath: context.getStorage().getStoragePath(),
      defaultStoragePath: context.appConfig.getDefaultStoragePath()
    }))
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_SELECT_STORAGE_PATH,
    safeIpcHandler(async (): Promise<SelectStoragePathResult> => {
      const result = await dialog.showOpenDialog({
        title: '选择数据保存位置',
        properties: ['openFile', 'openDirectory', 'promptToCreate'],
        filters: [{ name: '本地数据文件', extensions: ['sqlite', 'db', 'json'] }]
      })

      if (result.canceled || !result.filePaths[0]) return { canceled: true }
      return {
        canceled: false,
        storagePath: await resolveDataStoragePath(result.filePaths[0])
      }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_MIGRATE_STORAGE_PATH,
    safeIpcHandler(async (_event, request: MigrateStoragePathRequest): Promise<MigrateStoragePathResult> =>
      migrateStoragePath(context, request.storagePath, request.data, Boolean(request.overwrite))
    )
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_CREATE_MIGRATION_MERGE_PREVIEW,
    safeIpcHandler(
      async (_event, request: MigrationMergePreviewRequest): Promise<MigrationMergePreviewResult> => {
        const sourcePath = await resolveDataStoragePath(request.sourcePath)
        const targetPath = await resolveDataStoragePath(request.targetPath)
        return {
          ok: true,
          preview: await createMigrationMergePreview(sourcePath, targetPath)
        }
      }
    )
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_CONFIRM_MIGRATION_MERGE,
    safeIpcHandler(async (_event, request: ConfirmMigrationMergeRequest): Promise<ConfirmMigrationMergeResult> => {
      const sourcePath = await resolveDataStoragePath(request.sourcePath)
      const targetPath = await resolveDataStoragePath(request.targetPath)
      const result = await confirmMigrationMerge(sourcePath, targetPath)
      const nextStorage = createStorageService(targetPath)
      await nextStorage.load()
      const activeStoragePath = nextStorage.getStoragePath()
      await context.appConfig.setStoragePath(activeStoragePath)
      context.setStorage(nextStorage)
      return {
        ok: true,
        storagePath: activeStoragePath,
        data: result.data,
        preview: result.preview,
        sourceBackupPath: result.sourceBackupPath,
        targetBackupPath: result.targetBackupPath
      }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_RESET_STORAGE_PATH,
    safeIpcHandler(async (_event, request: ResetStoragePathRequest): Promise<MigrateStoragePathResult> =>
      migrateStoragePath(context, context.appConfig.getDefaultStoragePath(), request.data, Boolean(request.overwrite))
    )
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_OPEN_STORAGE_FOLDER,
    safeIpcHandler(async (_event, storagePath?: string): Promise<OpenStorageFolderResult> => {
      const target = storagePath ? await resolveDataStoragePath(storagePath) : context.getStorage().getStoragePath()
      if (await pathExists(target)) {
        shell.showItemInFolder(target)
        return { ok: true }
      }
      const error = await shell.openPath(dirname(target))
      return error ? { ok: false, error } : { ok: true }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_CREATE,
    safeIpcHandler(async (): Promise<BackupCreateResult> => {
      const storage = context.getStorage()
      const data = await storage.load()
      const backupPath = await context.backupService.createBackup(data, false)
      LogService.info(`Manual backup created: ${backupPath}`)
      return { ok: true, backupPath }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_LIST,
    safeIpcHandler(async (): Promise<BackupListResult> => ({
      ok: true,
      backups: await context.backupService.listBackups()
    }))
  )

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_RESTORE,
    safeIpcHandler(async (_event, backupPath: string): Promise<BackupRestoreResult> => {
      const storage = context.getStorage()
      let preRestoreBackupPath: string | undefined
      try {
        preRestoreBackupPath = await context.backupService.createBackup(await storage.load(), false)
      } catch (error) {
        LogService.warn('Pre-restore backup failed; continuing with selected backup restore.', error)
      }
      const data = await context.backupService.loadBackup(validateFilePath(backupPath, 'Backup path'))
      await storage.save(data)
      LogService.info(`Backup restored: ${backupPath}`)
      return { ok: true, data, storagePath: storage.getStoragePath(), preRestoreBackupPath }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_DELETE,
    safeIpcHandler(async (_event, backupPath: string): Promise<BackupDeleteResult> => {
      await context.backupService.deleteBackup(validateFilePath(backupPath, 'Backup path'))
      LogService.info(`Backup deleted: ${backupPath}`)
      return { ok: true }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_OPEN_FOLDER,
    safeIpcHandler(async (): Promise<BackupOpenFolderResult> => {
      await context.backupService.ensureBackupDir()
      const error = await shell.openPath(context.backupService.getBackupDir())
      return error ? { ok: false, error } : { ok: true }
    })
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

  ipcMain.handle(
    IPC_CHANNELS.CLIPBOARD_WRITE_LEGACY,
    safeIpcHandler(async (_event, text: string) => {
      clipboard.writeText(validateString(text, 'Clipboard text', { maxLength: 500_000, trim: false }))
      return { ok: true as const }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.CLIPBOARD_WRITE_TEXT,
    safeIpcHandler(async (_event, text: string) => {
      clipboard.writeText(validateString(text, 'Clipboard text', { maxLength: 500_000, trim: false }))
      return { ok: true as const }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.CREDENTIALS_SET_API_KEY,
    safeIpcHandler(async (_event, request: CredentialSetApiKeyRequest | string): Promise<CredentialSetApiKeyResult> => {
      const apiKey = validateApiKey(typeof request === 'string' ? request : request.apiKey)
      await context.credentialService.setApiKey(apiKey)
      return { ok: true, hasApiKey: true }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.CREDENTIALS_HAS_API_KEY,
    safeIpcHandler(async (): Promise<CredentialHasApiKeyResult> => ({
      ok: true,
      hasApiKey: await context.credentialService.hasApiKey()
    }))
  )

  ipcMain.handle(
    IPC_CHANNELS.CREDENTIALS_DELETE_API_KEY,
    safeIpcHandler(async (): Promise<CredentialDeleteApiKeyResult> => {
      await context.credentialService.deleteApiKey()
      return { ok: true, hasApiKey: false }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.CREDENTIALS_MIGRATE_LEGACY_API_KEY,
    safeIpcHandler(async (_event, apiKey: string): Promise<CredentialMigrateLegacyApiKeyResult> => ({
      ok: true,
      hasApiKey: await context.credentialService.migrateLegacyApiKey(validateApiKey(apiKey))
    }))
  )

  ipcMain.handle(
    IPC_CHANNELS.AI_CHAT_COMPLETION,
    safeIpcHandler(async (_event, request: ChatCompletionRequest): Promise<ChatCompletionResult> => {
      try {
        return await context.aiService.chatCompletion(validateChatCompletionRequest(request))
      } catch (error) {
        LogService.error('AI chat completion failed', error)
        const message = getUserFriendlyError(error)
        return { ok: false as const, error: `AI 请求失败：${redactSensitiveText(message).slice(0, 800)}` }
      }
    })
  )
}
