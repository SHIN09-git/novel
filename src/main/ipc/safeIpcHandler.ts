import type { IpcMainInvokeEvent } from 'electron'
import { getUserFriendlyError, logSafeError } from '../../shared/errorUtils'
import type { IpcFailure } from '../../shared/ipc/ipcTypes'

type AsyncIpcHandler<TArgs extends unknown[], TResult> = (
  event: IpcMainInvokeEvent,
  ...args: TArgs
) => Promise<TResult> | TResult

export function safeIpcHandler<TArgs extends unknown[], TResult>(
  handler: AsyncIpcHandler<TArgs, TResult>
): (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult | IpcFailure> {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args)
    } catch (error) {
      logSafeError('IPC handler failed', error)
      return {
        ok: false,
        error: getUserFriendlyError(error)
      }
    }
  }
}
