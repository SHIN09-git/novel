import type {
  AppData,
  CandidateDecisionCommand,
  CandidateDecisionReceipt,
  CandidateDecisionRemovedRecords,
  AppSettings,
  AiCallProgress,
  AiCallTelemetry,
  ChapterCommitBundle,
  Character,
  CharacterStateFact,
  DataMergePreview,
  ChapterNoveltyPolicy,
  ChapterDraftResult,
  ChapterPlan,
  ChapterTask,
  ContextCompressionRecord,
  ContextSelectionResult,
  ForcedContextBlock,
  GeneratedChapterDraft,
  GenerationRunBundle,
  NoveltyAuditResult,
  PipelineContextSource,
  Project,
  PromptBlockOrderItem,
  QualityGateReport,
  RedundancyReport,
  RevisionCommitBundle
} from '../types'
import type {
  AgentAuthorizationAction,
  AgentAuthorizationGrant
} from '../types/agentAuthorization'
import type { RuntimeInfo } from '../runtimeInfo'

export type { AiCallProgress, AiCallProgressStage, AiCallTelemetry, AiCallTerminationCategory, AiTokenUsage } from '../types'

export type IpcResult<T> = { ok: true; data: T } | IpcFailure

export interface IpcFailure {
  ok: false
  error: string
  code?: string
}

export interface StorageGetResult {
  data: AppData
  storagePath: string
  revision?: string
  credentialWarning?: string
}

export interface StorageSaveResult {
  ok: true
  storagePath: string
  revision?: string
  credentialWarning?: string
}

export interface StorageSaveRequest {
  data: AppData
  expectedRevision?: string
}

export interface StorageWriteResult {
  ok: true
  storagePath: string
  revision: string
  updatedAt: string
  savedCollections: string[]
  credentialWarning?: string
}

export interface CandidateDecisionWriteResult extends StorageWriteResult {
  receipt: CandidateDecisionReceipt
  changes: Partial<AppData>
  removedRecords?: CandidateDecisionRemovedRecords[]
  replayed: boolean
}

export interface ExecuteCandidateDecisionRequest {
  command: CandidateDecisionCommand
  expectedRevision?: string
}

export interface SaveGenerationRunBundleRequest {
  bundle: GenerationRunBundle
  expectedRevision?: string
}

export interface SaveChapterCommitBundleRequest {
  bundle: ChapterCommitBundle
  expectedRevision?: string
}

export interface SaveRevisionCommitBundleRequest {
  bundle: RevisionCommitBundle
  expectedRevision?: string
}

export interface ExportDataResult {
  canceled: boolean
  filePath?: string
}

export interface ImportDataResult {
  canceled: boolean
  filePath?: string
  data?: AppData
  storagePath?: string
  revision?: string
  credentialWarning?: string
  mergePreview?: DataMergePreview
  mergeBlocked?: boolean
  importedProjectIds?: string[]
}

export type ImportDataStrategy = 'merge' | 'replace'

export interface ImportDataRequest {
  expectedRevision?: string
  strategy?: ImportDataStrategy
}

export interface GetStoragePathResult {
  storagePath: string
  defaultStoragePath: string
}

export type GetRuntimeInfoResult = RuntimeInfo

export interface SelectStoragePathResult {
  canceled: boolean
  storagePath?: string
}

export interface MigrateStoragePathRequest {
  storagePath: string
  data: AppData
  overwrite?: boolean
  expectedRevision?: string
}

export interface MigrateStoragePathResult {
  ok: boolean
  needsOverwrite?: boolean
  needsMerge?: boolean
  storagePath: string
  targetPath?: string
  backupPath?: string
  targetBackupPath?: string
  mergePreview?: DataMergePreview
  revision?: string
  error?: string
}

export interface ResetStoragePathRequest {
  data: AppData
  overwrite?: boolean
  expectedRevision?: string
}

export type ResetStoragePathResult = MigrateStoragePathResult

export interface OpenStorageFolderRequest {
  storagePath?: string
}

export interface OpenStorageFolderResult {
  ok: boolean
  error?: string
}

export interface BackupInfo {
  path: string
  timestamp: number
  size: number
  isAutomatic: boolean
}

export interface BackupCreateResult {
  ok: true
  backupPath: string
}

export interface BackupListResult {
  ok: true
  backups: BackupInfo[]
}

export interface BackupRestoreResult {
  ok: true
  data: AppData
  storagePath: string
  revision?: string
  preRestoreBackupPath?: string
}

export interface BackupRestoreRequest {
  backupPath: string
  expectedRevision?: string
}

export interface BackupDeleteResult {
  ok: true
}

export interface BackupOpenFolderResult {
  ok: boolean
  error?: string
}

export interface LogsGetPathResult {
  ok: true
  logPath: string
}

export interface LogsOpenResult {
  ok: true
}

export interface MigrationMergePreviewRequest {
  sourcePath: string
  targetPath: string
}

export interface MigrationMergePreviewResult {
  ok: boolean
  preview?: DataMergePreview
  error?: string
}

export interface ConfirmMigrationMergeRequest {
  sourcePath: string
  targetPath: string
  expectedRevision?: string
}

export interface ConfirmMigrationMergeResult {
  ok: boolean
  storagePath: string
  data?: AppData
  preview?: DataMergePreview
  sourceBackupPath?: string
  targetBackupPath?: string
  revision?: string
  error?: string
}

export interface SaveTextFileRequest {
  content: string
  defaultFileName: string
}

export type SaveMarkdownFileRequest = SaveTextFileRequest

export interface SaveFileResult {
  canceled: boolean
  filePath?: string
}

export interface ClipboardWriteTextRequest {
  text: string
}

export interface ClipboardWriteTextResult {
  ok: true
}

export interface CredentialSetApiKeyRequest {
  apiKey: string
}

export interface CredentialStateResult {
  ok: true
  hasApiKey: boolean
}

export type CredentialSetApiKeyResult = CredentialStateResult
export type CredentialHasApiKeyResult = CredentialStateResult
export type CredentialDeleteApiKeyResult = CredentialStateResult
export type CredentialMigrateLegacyApiKeyResult = CredentialStateResult

export interface ChatCompletionRequest {
  settings: AppSettings
  messages: Array<{ role: 'system' | 'user'; content: string }>
  runId?: string
  clientCallId?: string
}

export interface ChatCompletionResult {
  ok: boolean
  content?: string
  error?: string
  finishReason?: string
  telemetry?: AiCallTelemetry
}

export interface CancelAiRunResult {
  ok: true
  cancelled: boolean
}

export interface CancelAiCallRequest {
  runId: string
  callId: string
}

export type CancelAiCallResult = CancelAiRunResult

export interface GetAiCallProgressRequest {
  runId?: string
  callId?: string
}

export type GetAiCallProgressResult = AiCallProgress | null
export type ListAiCallProgressResult = AiCallProgress[]

export interface AgentAuthorizationListRequest {
  projectId: string
}

export type AgentAuthorizationListResult = AgentAuthorizationGrant[]

export interface AgentAuthorizationGrantRequest {
  projectId: string
  actions: AgentAuthorizationAction[]
  chapterStart: number | null
  chapterEnd: number | null
}

export type AgentAuthorizationGrantResult = AgentAuthorizationGrant

export interface AgentAuthorizationRevokeRequest {
  projectId: string
  grantId: string
}

export type AgentAuthorizationRevokeResult = AgentAuthorizationGrant | null

export interface CodexCliStatusResult {
  ok: true
  available: boolean
  authenticated: boolean
  authenticationMode?: 'chatgpt' | 'api_key' | 'unknown'
  resolvedPath?: string
  version?: string
  message: string
}

export interface DiagnosticsAnalyzeRedundancyRequest {
  projectId: string
  chapterId: string | null
  draftId: string | null
  body: string
}

export type DiagnosticsAnalyzeRedundancyResult = RedundancyReport

export interface DiagnosticsAuditNoveltyRequest {
  generatedText: string
  context: string
  chapterPlan: ChapterPlan | null
  noveltyPolicy?: ChapterNoveltyPolicy
  project?: Project | null
  knownCharacterNames?: string[]
  knownForeshadowingTexts?: string[]
  knownCanonTexts?: string[]
  contextSelection?: ContextSelectionResult | null
  promptBlockOrder?: PromptBlockOrderItem[] | null
  forcedContextBlocks?: ForcedContextBlock[] | null
  compressionRecords?: ContextCompressionRecord[] | null
}

export type DiagnosticsAuditNoveltyResult = NoveltyAuditResult

export interface DiagnosticsEvaluateQualityGateRequest {
  settings: AppSettings
  runId?: string
  projectId: string
  jobId: string
  chapterId: string | null
  draftId: string | null
  chapterDraft: ChapterDraftResult | GeneratedChapterDraft
  context: string
  chapterPlan: ChapterPlan | null
  consistencyReports?: AppData['consistencyReviewReports']
  noveltyAuditResult?: NoveltyAuditResult | null
  redundancyReport?: RedundancyReport | null
  characterStateFacts?: CharacterStateFact[]
  characters?: Character[]
  promptContextSnapshotId?: string | null
  contextSource?: PipelineContextSource
  targetChapterOrder?: number
  hasAuthoritativeChapterTask?: boolean
  chapterTask?: ChapterTask | null
}

export type DiagnosticsEvaluateQualityGateResult = QualityGateReport
