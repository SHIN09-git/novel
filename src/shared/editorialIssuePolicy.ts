import type { ConsistencyReviewIssue } from './types'

/** Converting an issue into a revision request is not evidence of resolution.
 * Keep the quality gate's conservative behavior for legacy/unknown statuses.
 */
export function isEditorialIssueActive(issue: Pick<ConsistencyReviewIssue, 'status'>): boolean {
  return issue.status !== 'resolved' && issue.status !== 'ignored'
}
