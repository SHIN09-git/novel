import type { AppData, RevisionRequest, RevisionVersion } from '../../shared/types'
import { selectRevisionSession, createRevisionSourceSnapshot } from '../../renderer/src/views/revision/revisionSessionModel'
import { revisionTypeOptions } from '../../renderer/src/views/revision/revisionTypeCatalog'
import { findRewriteRange } from '../../renderer/src/components/aiRewriteResultModel'
import { findProjectId, requiredString } from '../tools/agentToolArguments'
import { saveAgentRuntimeData, type AgentRuntimeData } from '../AgentRuntime'
import { readRevisionVersion } from './agentRevisionReads'
import {
  assertRevisionWritable, checkKnownAgentSource, checkRevisionFields, checkSourceHashes, checkVersionSource, commandIdentity,
  rawRevisionText, recordRevisionOperation, replayRevisionOperation, resolveRevisionSource,
  revisionFingerprint, revisionHashFields, revisionSession, revisionVersion, revisionWriteFields,
  type RevisionAudit
} from './agentRevisionModel'

export async function createAgentRevisionRequest(data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData) {
  checkRevisionFields(args, [...revisionWriteFields, ...revisionHashFields, 'chapterId', 'draftId', 'sessionId', 'type', 'instruction', 'targetRange'])
  const projectId = findProjectId(data, args)
  const identity = commandIdentity(args, 'create_revision_request', projectId)
  const prior = replayRevisionOperation(data, projectId, identity)
  if (prior) return { sessionId: prior.sessionId, requestId: prior.requestId, requestHash: prior.requestHash, source: prior.source, replayed: true }
  const draftId = args.draftId === undefined ? null : requiredString(args, 'draftId')
  const draft = draftId ? data.generatedChapterDrafts.find((item) => item.id === draftId && item.projectId === projectId) : null
  const chapterId = args.chapterId === undefined ? draft?.chapterId ?? '' : requiredString(args, 'chapterId')
  const resolved = resolveRevisionSource(data, projectId, chapterId, draftId)
  assertRevisionWritable(resolved)
  checkSourceHashes(resolved.source, args)
  const type = args.type === undefined ? 'custom' : requiredString(args, 'type')
  const selectedType = revisionTypeOptions.find((item) => item.value === type)
  if (!selectedType) throw new Error('Unsupported revision type.')
  const instruction = rawRevisionText(args, 'instruction')
  const targetRange = args.targetRange === undefined ? '' : rawRevisionText(args, 'targetRange')
  if (targetRange && !findRewriteRange(resolved.body, targetRange)) throw new Error('Local revision target must match the source exactly once.')
  const timestamp = new Date().toISOString()
  const snapshot = createRevisionSourceSnapshot({ ...resolved.source, sourceBody: resolved.body, sourceChapterBody: resolved.chapter?.body })
  const selection = selectRevisionSession(data.revisionSessions, snapshot, timestamp, () => `${identity.id}-session`)
  if (args.sessionId === undefined && !selection.reusedSession && data.revisionSessions.some((item) => item.id === selection.session.id)) {
    throw new Error('Revision session ID collision.')
  }
  const session = args.sessionId === undefined ? selection.session : revisionSession(data, projectId, requiredString(args, 'sessionId'))
  if (session.status !== 'active' || session.chapterId !== chapterId || session.sourceDraftId !== draftId) throw new Error('RevisionSession source is different or no longer active.')
  const request: RevisionRequest = {
    id: `${identity.id}-request`, sessionId: session.id, type: selectedType.value, instruction, targetRange,
    sourceDraftContentHash: resolved.source.sourceContentHash, createdAt: timestamp
  }
  if (data.revisionRequests.some((item) => item.id === request.id)) throw new Error('Revision request ID collision.')
  const audit: RevisionAudit = {
    schemaVersion: 1, actor: { kind: 'agent', agentRunId: identity.agentRunId }, operation: 'create_revision_request',
    commandHash: identity.hash, source: resolved.source, sessionId: session.id, requestId: request.id, requestHash: revisionFingerprint(request)
  }
  const next = recordRevisionOperation({ ...data,
    revisionSessions: data.revisionSessions.some((item) => item.id === session.id) ? data.revisionSessions : [...data.revisionSessions, session],
    revisionRequests: [...data.revisionRequests, request]
  }, identity.id, audit, requiredString(args, 'reason'))
  const saved = await saveAgentRuntimeData(next, runtime)
  return { sessionId: session.id, requestId: request.id, requestHash: audit.requestHash, source: audit.source, saved, replayed: false, formalCommit: false }
}

export async function editAgentRevisionVersion(data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData) {
  checkRevisionFields(args, [...revisionWriteFields, ...revisionHashFields, 'versionId', 'expectedVersionHash', 'body'])
  const projectId = findProjectId(data, args)
  const identity = commandIdentity(args, 'edit_revision_version', projectId)
  const prior = replayRevisionOperation(data, projectId, identity)
  if (prior?.versionId) return { ...readRevisionVersion(data, projectId, prior.versionId), replayed: true }
  const { version, session, request } = revisionVersion(data, projectId, requiredString(args, 'versionId'))
  if (session.status !== 'active' || !['draft', 'pending'].includes(version.status)) throw new Error('Only active draft/pending revision versions can be edited.')
  if (revisionFingerprint(version) !== requiredString(args, 'expectedVersionHash')) throw new Error('Revision candidate changed before editing.')
  const resolved = resolveRevisionSource(data, projectId, session.chapterId, session.sourceDraftId)
  assertRevisionWritable(resolved)
  checkVersionSource(version, resolved)
  checkKnownAgentSource(data, resolved.source, 'version', version.id, revisionFingerprint(version))
  checkSourceHashes(resolved.source, args)
  const body = rawRevisionText(args, 'body')
  const timestamp = new Date().toISOString()
  const nextVersion: RevisionVersion = { ...version, id: `${identity.id}-version`, body, status: 'draft', createdAt: timestamp, updatedAt: timestamp }
  if (data.revisionVersions.some((item) => item.id === nextVersion.id)) throw new Error('Revision version ID collision.')
  const audit: RevisionAudit = {
    schemaVersion: 1, actor: { kind: 'agent', agentRunId: identity.agentRunId }, operation: 'edit_revision_version',
    commandHash: identity.hash, source: resolved.source, sessionId: session.id, requestId: request.id,
    requestHash: revisionFingerprint(request), parentVersionId: version.id, versionId: nextVersion.id, versionHash: revisionFingerprint(nextVersion)
  }
  const next = recordRevisionOperation({ ...data, revisionVersions: [
    ...data.revisionVersions.map((item) => item.id === version.id ? { ...item, status: 'superseded' as const, updatedAt: timestamp } : item), nextVersion
  ] }, identity.id, audit, requiredString(args, 'reason'))
  const saved = await saveAgentRuntimeData(next, runtime)
  return { ...readRevisionVersion(next, projectId, nextVersion.id), saved, replayed: false }
}
