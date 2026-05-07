export interface SaveQueue<T, R> {
  enqueue(next: T): Promise<R>
  getLastError(): string
}

function getQueueErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createSaveQueue<T, R>(saveFn: (next: T) => Promise<R>): SaveQueue<T, R> {
  let queue: Promise<void> = Promise.resolve()
  let lastError = ''

  return {
    enqueue(next: T): Promise<R> {
      const operation = queue.then(() => saveFn(next))
      queue = operation.then(
        () => undefined,
        () => undefined
      )
      return operation.catch((error) => {
        lastError = getQueueErrorMessage(error)
        throw error
      })
    },
    getLastError(): string {
      return lastError
    }
  }
}
