import { draftContentHash } from '../../services/DraftDiagnosticBindingService'
import { applyRevisionToPendingDraft } from '../../services/PendingDraftRevisionService'
import { requireAgentPendingDraft } from '../agentDraftActions'
import { saveAgentRuntimeData, type AgentRuntimeData } from '../AgentRuntime'
import { findProjectId, requiredString } from '../tools/agentToolArguments'
import {
  assertRevisionWritable, checkKnownAgentSource, checkRevisionFields, checkSourceHashes, checkVersionSource,
  commandIdentity, recordRevisionOperation, replayRevisionOperation, resolveRevisionSource,
  revisionFingerprint, revisionHashFields, revisionVersion, revisionWriteFields, type RevisionAudit
} from './agentRevisionModel'

const operation = 'apply_revision_to_draft'

export async function applyAgentRevisionToDraft(runtime: AgentRuntimeData, args: Record<string, unknown>) {
  const { data } = runtime
  checkRevisionFields(args, [...revisionWriteFields, ...revisionHashFields, 'versionId', 'expectedVersionHash', 'acceptBroaderResponse'])
  if (args.acceptBroaderResponse !== undefined && typeof args.acceptBroaderResponse !== 'boolean') {
    throw new Error('acceptBroaderResponse must be a boolean.')
  }
  const projectId = findProjectId(data, args)
  const identity = commandIdentity(args, operation, projectId)
  const prior = replayRevisionOperation(data, projectId, identity)
  if (prior) return {
    projectId, agentRunId: identity.agentRunId, draftId: prior.source.sourceDraftId,
    appliedToDraft: true, formalCommit: false, replayed: true
  }

  const { version, session, request } = revisionVersion(data, projectId, requiredString(args, 'versionId'))
  if (!session.sourceDraftId || session.status !== 'active' || !['pending', 'draft'].includes(version.status)) {
    throw new Error('该修订不是当前待应用的草稿修订。')
  }
  const versionHash = revisionFingerprint(version)
  if (requiredString(args, 'expectedVersionHash') !== versionHash) throw new Error('修订候选已变化，请重新读取。')
  const draft = await requireAgentPendingDraft(runtime, projectId, identity.agentRunId, session.sourceDraftId)
  const resolved = resolveRevisionSource(data, projectId, session.chapterId, draft.id)
  assertRevisionWritable(resolved)
  checkSourceHashes(resolved.source, args)
  checkVersionSource(version, resolved)
  checkKnownAgentSource(data, resolved.source, 'version', version.id, versionHash)
  if (version.responseScope === 'broader_than_requested' && args.acceptBroaderResponse !== true) {
    throw new Error('修订超出了所选范围。请先审阅整章，确认采用这份修订。')
  }
  const audit: RevisionAudit = {
    schemaVersion: 1, actor: { kind: 'agent', agentRunId: identity.agentRunId }, operation,
    commandHash: identity.hash, source: resolved.source, sessionId: session.id, requestId: request.id,
    requestHash: revisionFingerprint(request), versionId: version.id, versionHash, candidateContentHash: draftContentHash(version.body)
  }
  const next = applyRevisionToPendingDraft(data, projectId, draft.id, version, new Date().toISOString())
  const saved = await saveAgentRuntimeData(recordRevisionOperation(next, identity.id, audit, requiredString(args, 'reason')), runtime)
  return { projectId, agentRunId: identity.agentRunId, draftId: draft.id, appliedToDraft: true,
    formalCommit: false, replayed: false, saved }
}
