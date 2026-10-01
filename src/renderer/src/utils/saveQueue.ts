export interface SaveQueue<T, R> {
  enqueue(next: T): Promise<R>
}

export interface OperationQueue {
  enqueue<R>(operation: () => Promise<R>): Promise<R>
}

export function createSaveQueue<T, R>(saveFn: (next: T) => Promise<R>): SaveQueue<T, R> {
  let queue: Promise<void> = Promise.resolve()

  return {
    enqueue(next: T): Promise<R> {
      const operation = queue.then(() => saveFn(next))
      queue = operation.then(
        () => undefined,
        () => undefined
      )
      return operation
    }
  }
}

export function createOperationQueue(): OperationQueue {
  let queue: Promise<void> = Promise.resolve()

  return {
    enqueue<R>(operation: () => Promise<R>): Promise<R> {
      const result = queue.then(operation)
      queue = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }
  }
}
