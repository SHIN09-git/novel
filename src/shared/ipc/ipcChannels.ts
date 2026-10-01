export const IPC_CHANNELS = {
  DATA_EXECUTE_CANDIDATE_DECISION: 'data:execute-candidate-decision',
  STORAGE_GET: 'storage:get',
  STORAGE_SAVE: 'storage:save',
  DATA_SAVE_GENERATION_RUN_BUNDLE: 'data:save-generation-run-bundle',
  DATA_SAVE_CHAPTER_COMMIT_BUNDLE: 'data:save-chapter-commit-bundle',
  DATA_SAVE_REVISION_COMMIT_BUNDLE: 'data:save-revision-commit-bundle',
  STORAGE_EXPORT: 'storage:export',
  STORAGE_IMPORT: 'storage:import',

  APP_GET_STORAGE_PATH: 'app:get-storage-path',
  APP_GET_RUNTIME_INFO: 'app:get-runtime-info',
  APP_SELECT_STORAGE_PATH: 'app:select-storage-path',
  APP_MIGRATE_STORAGE_PATH: 'app:migrate-storage-path',
  APP_CREATE_MIGRATION_MERGE_PREVIEW: 'app:create-migration-merge-preview',
  APP_CONFIRM_MIGRATION_MERGE: 'app:confirm-migration-merge',
  APP_RESET_STORAGE_PATH: 'app:reset-storage-path',
  APP_OPEN_STORAGE_FOLDER: 'app:open-storage-folder',

  BACKUP_CREATE: 'backup:create',
  BACKUP_LIST: 'backup:list',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_DELETE: 'backup:delete',
  BACKUP_OPEN_FOLDER: 'backup:open-folder',

  LOGS_GET_PATH: 'logs:get-path',
  LOGS_OPEN: 'logs:open',

  EXPORT_SAVE_TEXT_FILE: 'export:save-text-file',
  EXPORT_SAVE_MARKDOWN_FILE: 'export:save-markdown-file',

  CLIPBOARD_WRITE_LEGACY: 'clipboard:write',
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',

  CREDENTIALS_SET_API_KEY: 'credentials:setApiKey',
  CREDENTIALS_HAS_API_KEY: 'credentials:hasApiKey',
  CREDENTIALS_DELETE_API_KEY: 'credentials:deleteApiKey',
  CREDENTIALS_MIGRATE_LEGACY_API_KEY: 'credentials:migrateLegacyApiKey',

  AI_CHAT_COMPLETION: 'ai:chatCompletion',
  AI_CANCEL_RUN: 'ai:cancel-run',
  AI_CANCEL_CALL: 'ai:cancel-call',
  AI_GET_CALL_PROGRESS: 'ai:get-call-progress',
  AI_LIST_CALL_PROGRESS: 'ai:list-call-progress',
  AI_CODEX_CLI_STATUS: 'ai:codex-cli-status',

  AGENT_AUTHORIZATION_LIST: 'agent-authorization:list',
  AGENT_AUTHORIZATION_GRANT: 'agent-authorization:grant',
  AGENT_AUTHORIZATION_REVOKE: 'agent-authorization:revoke',

  DIAGNOSTICS_ANALYZE_REDUNDANCY: 'diagnostics:analyze-redundancy',
  DIAGNOSTICS_AUDIT_NOVELTY: 'diagnostics:audit-novelty',
  DIAGNOSTICS_EVALUATE_QUALITY_GATE: 'diagnostics:evaluate-quality-gate'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
