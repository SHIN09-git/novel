import type { AppData } from '../../../shared/types'

export type SaveDataInput = AppData | ((currentData: AppData) => AppData)

export type SaveDataOutcome =
  | { ok: true }
  | {
      ok: false
      errorMessage: string
    }

export type SaveDataHandler = (next: SaveDataInput) => Promise<SaveDataOutcome>

export interface PersistedStorageOperationResult {
  data?: AppData
  storagePath?: string
  credentialWarning?: string
}

export interface PersistedStorageOperationOptions {
  persistCurrentFirst?: boolean
}

export type RunPersistedStorageOperation = <T extends PersistedStorageOperationResult>(
  operation: (currentData: AppData) => Promise<T>,
  options?: PersistedStorageOperationOptions
) => Promise<T>

export function resolveSaveDataInput(currentData: AppData, input: SaveDataInput): AppData {
  return typeof input === 'function' ? input(currentData) : input
}
