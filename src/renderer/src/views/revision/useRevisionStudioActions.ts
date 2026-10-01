import type { ID, QualityGateIssue, RevisionVersion } from '../../../../shared/types'
import type {
  RevisionGenerationOverride,
  RevisionStudioActionContext
} from './revisionStudioActionTypes'

const loadRevisionGenerationActions = () => import('./revisionGenerationActions')
const loadRevisionRequestRelocationActions = () => import('./revisionRequestRelocationActions')
const loadRevisionVersionActions = () => import('./revisionVersionActions')

export function useRevisionStudioActions(context: RevisionStudioActionContext) {
  return {
    generateRevisionFromCurrent: async (override?: RevisionGenerationOverride) =>
      (await loadRevisionGenerationActions()).generateRevisionFromCurrent(context, override),
    relocateSourceRequest: async (mode: 'selection' | 'full_chapter') =>
      (await loadRevisionRequestRelocationActions()).relocateSourceRequest(context, mode),
    acceptVersion: async (version: RevisionVersion) =>
      (await loadRevisionVersionActions()).acceptVersion(context, version),
    persistEditedVersionBody: async (body?: string) =>
      (await loadRevisionVersionActions()).persistEditedVersionBody(body === undefined ? context : { ...context, editableVersionBody: body }),
    selectRevisionVersion: async (versionId: ID) =>
      (await loadRevisionVersionActions()).selectRevisionVersion(context, versionId),
    rejectVersion: async (version: RevisionVersion) =>
      (await loadRevisionVersionActions()).rejectVersion(context, version),
    copyRevisionVersion: async (version: Pick<RevisionVersion, 'body'>) =>
      (await loadRevisionVersionActions()).copyRevisionVersion(context, version),
    startFromQualityIssue: async (issue: QualityGateIssue) =>
      (await loadRevisionGenerationActions()).startFromQualityIssue(context, issue)
  }
}
