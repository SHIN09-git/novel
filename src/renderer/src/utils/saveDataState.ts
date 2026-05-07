import type { AppData } from '../../../shared/types'

export type SaveDataInput = AppData | ((currentData: AppData) => AppData)

export function resolveSaveDataInput(currentData: AppData, input: SaveDataInput): AppData {
  return typeof input === 'function' ? input(currentData) : input
}
