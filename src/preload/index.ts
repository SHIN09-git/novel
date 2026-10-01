import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc/ipcChannels'
import type {
  ChatCompletionRequest,
  CancelAiCallResult,
  CandidateDecisionWriteResult,
  ChatCompletionResult,
  AgentAuthorizationGrantRequest,
  AgentAuthorizationGrantResult,
  AgentAuthorizationListResult,
  AgentAuthorizationRevokeRequest,
  AgentAuthorizationRevokeResult,
  CodexCliStatusResult,
  CancelAiRunResult,
  GetRuntimeInfoResult,
  GetAiCallProgressRequest,
  GetAiCallProgressResult,
  BackupCreateResult,
  BackupDeleteResult,
  BackupListResult,
  BackupOpenFolderResult,
  BackupRestoreResult,
  BackupRestoreRequest,
  ConfirmMigrationMergeResult,
  CredentialDeleteApiKeyResult,
  CredentialHasApiKeyResult,
  CredentialMigrateLegacyApiKeyResult,
  CredentialSetApiKeyResult,
  DiagnosticsAnalyzeRedundancyRequest,
  DiagnosticsAnalyzeRedundancyResult,
  DiagnosticsAuditNoveltyRequest,
  DiagnosticsAuditNoveltyResult,
  DiagnosticsEvaluateQualityGateRequest,
  DiagnosticsEvaluateQualityGateResult,
  ExportDataResult,
  GetStoragePathResult,
  ImportDataResult,
  ImportDataRequest,
  ImportDataStrategy,
  IpcFailure,
  LogsGetPathResult,
  LogsOpenResult,
  ListAiCallProgressResult,
  MigrateStoragePathResult,
  MigrationMergePreviewResult,
  OpenStorageFolderResult,
  SaveFileResult,
  StorageWriteResult,
  SelectStoragePathResult,
  StorageGetResult,
  StorageSaveResult
} from '../shared/ipc/ipcTypes'
import type { AppData, CandidateDecisionCommand, ChapterCommitBundle, GenerationRunBundle, RevisionCommitBundle } from '../shared/types'

function isIpcFailure(value: unknown): value is IpcFailure {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { ok?: unknown }).ok === false &&
      typeof (value as { error?: unknown }).error === 'string' &&
      !('storagePath' in value)
  )
}

async function invokeOrThrow<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args)
  if (isIpcFailure(result)) {
    const error = new Error(result.error) as Error & { code?: string }
    error.code = result.code
    throw error
  }
  return result as T
}

function assertText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串。`)
  return value
}

let storageRevision: string | undefined

async function loadStorageData(): Promise<StorageGetResult> {
  const result = await invokeOrThrow<StorageGetResult>(IPC_CHANNELS.STORAGE_GET)
  storageRevision = result.revision
  return result
}

async function saveStorageData(data: AppData): Promise<StorageSaveResult> {
  const result = await invokeOrThrow<StorageSaveResult>(IPC_CHANNELS.STORAGE_SAVE, {
    data,
    expectedRevision: storageRevision
  })
  storageRevision = result.revision
  return result
}

async function saveStorageBundle<T extends StorageWriteResult>(channel: string, bundle: unknown): Promise<T> {
  const result = await invokeOrThrow<T>(channel, { bundle, expectedRevision: storageRevision })
  storageRevision = result.revision
  return result
}

function rememberStorageRevision(result: { revision?: string }): void {
  if (result.revision) storageRevision = result.revision
}

const novelDirector = {
  data: {
    load: loadStorageData,
    save: saveStorageData,
    executeCandidateDecision: async (command: CandidateDecisionCommand) => {
      const result = await invokeOrThrow<CandidateDecisionWriteResult>(IPC_CHANNELS.DATA_EXECUTE_CANDIDATE_DECISION,
        { command, expectedRevision: storageRevision })
      storageRevision = result.revision
      return result
    },
    saveGenerationRunBundle: (bundle: GenerationRunBundle) =>
      saveStorageBundle<StorageWriteResult>(IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE, bundle),
    saveChapterCommitBundle: (bundle: ChapterCommitBundle) =>
      saveStorageBundle<StorageWriteResult>(IPC_CHANNELS.DATA_SAVE_CHAPTER_COMMIT_BUNDLE, bundle),
    saveRevisionCommitBundle: (bundle: RevisionCommitBundle) =>
      saveStorageBundle<StorageWriteResult>(IPC_CHANNELS.DATA_SAVE_REVISION_COMMIT_BUNDLE, bundle),
    export: (data: AppData) => invokeOrThrow<ExportDataResult>(IPC_CHANNELS.STORAGE_EXPORT, data),
    import: async (strategy: ImportDataStrategy = 'replace') => {
      const request: ImportDataRequest = { expectedRevision: storageRevision, strategy }
      const result = await invokeOrThrow<ImportDataResult>(IPC_CHANNELS.STORAGE_IMPORT, request)
      rememberStorageRevision(result)
      return result
    }
  },
  app: {
    getStoragePath: () => invokeOrThrow<GetStoragePathResult>(IPC_CHANNELS.APP_GET_STORAGE_PATH),
    getRuntimeInfo: () => invokeOrThrow<GetRuntimeInfoResult>(IPC_CHANNELS.APP_GET_RUNTIME_INFO),
    selectStoragePath: () => invokeOrThrow<SelectStoragePathResult>(IPC_CHANNELS.APP_SELECT_STORAGE_PATH),
    migrateStoragePath: async (storagePath: string, data: AppData, overwrite = false) => {
      const result = await invokeOrThrow<MigrateStoragePathResult>(IPC_CHANNELS.APP_MIGRATE_STORAGE_PATH, {
        storagePath: assertText(storagePath, 'storagePath'),
        data,
        overwrite,
        expectedRevision: storageRevision
      })
      rememberStorageRevision(result)
      return result
    },
    createMigrationMergePreview: (sourcePath: string, targetPath: string) =>
      invokeOrThrow<MigrationMergePreviewResult>(IPC_CHANNELS.APP_CREATE_MIGRATION_MERGE_PREVIEW, {
        sourcePath: assertText(sourcePath, 'sourcePath'),
        targetPath: assertText(targetPath, 'targetPath')
      }),
    confirmMigrationMerge: async (sourcePath: string, targetPath: string) => {
      const result = await invokeOrThrow<ConfirmMigrationMergeResult>(IPC_CHANNELS.APP_CONFIRM_MIGRATION_MERGE, {
        sourcePath: assertText(sourcePath, 'sourcePath'),
        targetPath: assertText(targetPath, 'targetPath'),
        expectedRevision: storageRevision
      })
      rememberStorageRevision(result)
      return result
    },
    resetStoragePath: async (data: AppData, overwrite = false) => {
      const result = await invokeOrThrow<MigrateStoragePathResult>(IPC_CHANNELS.APP_RESET_STORAGE_PATH, {
        data,
        overwrite,
        expectedRevision: storageRevision
      })
      rememberStorageRevision(result)
      return result
    },
    openStorageFolder: (storagePath?: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.APP_OPEN_STORAGE_FOLDER,
        storagePath === undefined ? undefined : assertText(storagePath, 'storagePath')
      ) as Promise<OpenStorageFolderResult>
  },
  backup: {
    create: () => invokeOrThrow<BackupCreateResult>(IPC_CHANNELS.BACKUP_CREATE),
    list: () => invokeOrThrow<BackupListResult>(IPC_CHANNELS.BACKUP_LIST),
    restore: async (backupPath: string) => {
      const request: BackupRestoreRequest = {
        backupPath: assertText(backupPath, 'backupPath'),
        expectedRevision: storageRevision
      }
      const result = await invokeOrThrow<BackupRestoreResult>(
        IPC_CHANNELS.BACKUP_RESTORE,
        request
      )
      rememberStorageRevision(result)
      return result
    },
    delete: (backupPath: string) =>
      invokeOrThrow<BackupDeleteResult>(IPC_CHANNELS.BACKUP_DELETE, assertText(backupPath, 'backupPath')),
    openFolder: () => invokeOrThrow<BackupOpenFolderResult>(IPC_CHANNELS.BACKUP_OPEN_FOLDER)
  },
  logs: {
    getPath: () => invokeOrThrow<LogsGetPathResult>(IPC_CHANNELS.LOGS_GET_PATH),
    open: () => invokeOrThrow<LogsOpenResult>(IPC_CHANNELS.LOGS_OPEN)
  },
  export: {
    saveTextFile: (content: string, defaultFileName: string) =>
      invokeOrThrow<SaveFileResult>(IPC_CHANNELS.EXPORT_SAVE_TEXT_FILE, {
        content: assertText(content, 'content'),
        defaultFileName: assertText(defaultFileName, 'defaultFileName')
      }),
    saveMarkdownFile: (content: string, defaultFileName: string) =>
      invokeOrThrow<SaveFileResult>(IPC_CHANNELS.EXPORT_SAVE_MARKDOWN_FILE, {
        content: assertText(content, 'content'),
        defaultFileName: assertText(defaultFileName, 'defaultFileName')
      })
  },
  clipboard: {
    writeText: (text: string) =>
      invokeOrThrow<{ ok: true }>(IPC_CHANNELS.CLIPBOARD_WRITE_TEXT, assertText(text, 'text'))
  },
  credentials: {
    setApiKey: (apiKey: string) =>
      invokeOrThrow<CredentialSetApiKeyResult>(IPC_CHANNELS.CREDENTIALS_SET_API_KEY, {
        apiKey: assertText(apiKey, 'apiKey')
      }),
    hasApiKey: () => invokeOrThrow<CredentialHasApiKeyResult>(IPC_CHANNELS.CREDENTIALS_HAS_API_KEY),
    deleteApiKey: () => invokeOrThrow<CredentialDeleteApiKeyResult>(IPC_CHANNELS.CREDENTIALS_DELETE_API_KEY),
    migrateLegacyApiKey: (apiKey: string) =>
      invokeOrThrow<CredentialMigrateLegacyApiKeyResult>(
        IPC_CHANNELS.CREDENTIALS_MIGRATE_LEGACY_API_KEY,
        assertText(apiKey, 'apiKey')
      )
  },
  ai: {
    chatCompletion: (request: ChatCompletionRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CHAT_COMPLETION, request) as Promise<ChatCompletionResult>,
    cancelRun: (runId: string) =>
      invokeOrThrow<CancelAiRunResult>(IPC_CHANNELS.AI_CANCEL_RUN, assertText(runId, 'runId')),
    cancelCall: (runId: string, callId: string) =>
      invokeOrThrow<CancelAiCallResult>(IPC_CHANNELS.AI_CANCEL_CALL, {
        runId: assertText(runId, 'runId'),
        callId: assertText(callId, 'callId')
      }),
    getCallProgress: (request: GetAiCallProgressRequest = {}) =>
      invokeOrThrow<GetAiCallProgressResult>(IPC_CHANNELS.AI_GET_CALL_PROGRESS, request),
    listCallProgress: (runId: string) =>
      invokeOrThrow<ListAiCallProgressResult>(IPC_CHANNELS.AI_LIST_CALL_PROGRESS, assertText(runId, 'runId')),
    getCodexCliStatus: (command = 'codex') =>
      invokeOrThrow<CodexCliStatusResult>(IPC_CHANNELS.AI_CODEX_CLI_STATUS, assertText(command, 'Codex CLI path'))
  },
  diagnostics: {
    analyzeRedundancy: (request: DiagnosticsAnalyzeRedundancyRequest) =>
      invokeOrThrow<DiagnosticsAnalyzeRedundancyResult>(IPC_CHANNELS.DIAGNOSTICS_ANALYZE_REDUNDANCY, request),
    auditNovelty: (request: DiagnosticsAuditNoveltyRequest) =>
      invokeOrThrow<DiagnosticsAuditNoveltyResult>(IPC_CHANNELS.DIAGNOSTICS_AUDIT_NOVELTY, request),
    evaluateQualityGate: (request: DiagnosticsEvaluateQualityGateRequest) =>
      invokeOrThrow<DiagnosticsEvaluateQualityGateResult>(IPC_CHANNELS.DIAGNOSTICS_EVALUATE_QUALITY_GATE, request)
  },
  agentAuthorization: {
    list: (projectId: string) =>
      invokeOrThrow<AgentAuthorizationListResult>(IPC_CHANNELS.AGENT_AUTHORIZATION_LIST, {
        projectId: assertText(projectId, 'projectId')
      }),
    grant: (request: AgentAuthorizationGrantRequest) =>
      invokeOrThrow<AgentAuthorizationGrantResult>(IPC_CHANNELS.AGENT_AUTHORIZATION_GRANT, {
        ...request,
        projectId: assertText(request.projectId, 'projectId')
      }),
    revoke: (request: AgentAuthorizationRevokeRequest) =>
      invokeOrThrow<AgentAuthorizationRevokeResult>(IPC_CHANNELS.AGENT_AUTHORIZATION_REVOKE, {
        projectId: assertText(request.projectId, 'projectId'),
        grantId: assertText(request.grantId, 'grantId')
      })
  }
}

contextBridge.exposeInMainWorld('novelDirector', novelDirector)

export type NovelDirectorAPI = typeof novelDirector
