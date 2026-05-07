export interface PipelineRunLock {
  current: boolean
}

export function tryAcquirePipelineRunLock(lock: PipelineRunLock): boolean {
  if (lock.current) return false
  lock.current = true
  return true
}

export function releasePipelineRunLock(lock: PipelineRunLock): void {
  lock.current = false
}
