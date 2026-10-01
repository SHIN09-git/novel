import type { RevisionVersionStatus } from './types'

export function canEditRevisionVersionStatus(status: RevisionVersionStatus): boolean {
  return status === 'pending' || status === 'draft'
}

export function canAcceptRevisionVersionStatus(status: RevisionVersionStatus): boolean {
  return canEditRevisionVersionStatus(status)
}

export function canRejectRevisionVersionStatus(status: RevisionVersionStatus): boolean {
  return canEditRevisionVersionStatus(status)
}
