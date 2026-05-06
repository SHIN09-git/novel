export const IPC_CHANNELS = {
  STORAGE_GET: 'storage:get',
  STORAGE_SAVE: 'storage:save',
  STORAGE_EXPORT: 'storage:export',
  STORAGE_IMPORT: 'storage:import',

  APP_GET_STORAGE_PATH: 'app:get-storage-path',
  APP_SELECT_STORAGE_PATH: 'app:select-storage-path',
  APP_MIGRATE_STORAGE_PATH: 'app:migrate-storage-path',
  APP_RESET_STORAGE_PATH: 'app:reset-storage-path',
  APP_OPEN_STORAGE_FOLDER: 'app:open-storage-folder',

  EXPORT_SAVE_TEXT_FILE: 'export:save-text-file',
  EXPORT_SAVE_MARKDOWN_FILE: 'export:save-markdown-file',

  CLIPBOARD_WRITE_LEGACY: 'clipboard:write',
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',

  AI_CHAT_COMPLETION: 'ai:chatCompletion'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
