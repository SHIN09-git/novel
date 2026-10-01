import type { AgentActionPreview, AppData, RevisionCommitBundle } from '../../shared/types'
import { draftContentHash } from '../../services/DraftDiagnosticBindingService'
import { applyRevisionCommitBundleToAppData, buildRevisionCommitBundle, validateRevisionCommitBundle } from '../../services/RevisionCommitBundleService'
import { AgentCommitService } from '../AgentCommitService'
import { withAgentActionAcknowledgement } from '../agentAcknowledgedAction'
import { saveAgentRevisionCommitBundle, saveAgentRuntimeData, type AgentRuntimeData } from '../AgentRuntime'
import { findProjectId, requiredString } from '../tools/agentToolArguments'
import {
  assertRevisionWritable, checkKnownAgentSource, checkRevisionFields, checkSourceHashes, checkVersionSource, commandIdentity,
  recordRevisionOperation, replayRevisionOperation, resolveRevisionSource, revisionAudit, revisionCommonFields,
  revisionEvidence, revisionFingerprint, revisionHashFields, revisionRun, revisionVersion, revisionWriteFields,
  type RevisionAudit
} from './agentRevisionModel'

function previewOutput(preview: AgentActionPreview) {
  const binding = revisionAudit(preview.evidence)
  return { preview, binding, previewHash: revisionFingerprint(binding), formalCommit: preview.status === 'applied' }
}

function buildPreviewBundle(data: AppData, preview: AgentActionPreview, audit: RevisionAudit) {
  return buildRevisionCommitBundle({
    appData: data, projectId: preview.projectId, chapterId: audit.source.chapterId,
    revisionCommitId: `agent-revision-commit-${preview.id}`, newChapterVersionId: `agent-revision-chapter-version-${preview.id}`,
    revisionSessionId: audit.sessionId, revisionVersionId: audit.versionId, revisedAt: preview.createdAt,
    revisedBy: 'agent', actor: { kind: 'agent', agentRunId: preview.agentRunId, actionPreviewId: preview.id },
    revisionReason: preview.reason,
    revisionNote: `Agent ${preview.agentRunId}; preview ${preview.id}; binding ${revisionFingerprint(audit)}. No human approval claimed.`
  })
}

function validateCurrentPreview(data: AppData, preview: AgentActionPreview, audit: RevisionAudit) {
  const { version, session, request } = revisionVersion(data, preview.projectId, audit.versionId!)
  if (session.status !== 'active' || !['pending', 'draft'].includes(version.status)) throw new Error('Revision candidate/session is no longer active.')
  if (session.id !== audit.sessionId || request.id !== audit.requestId || revisionFingerprint(request) !== audit.requestHash ||
    revisionFingerprint(version) !== audit.versionHash) throw new Error('Revision preview candidate or request changed.')
  const resolved = resolveRevisionSource(data, preview.projectId, session.chapterId, session.sourceDraftId)
  assertRevisionWritable(resolved)
  checkVersionSource(version, resolved)
  checkKnownAgentSource(data, resolved.source, 'version', version.id, revisionFingerprint(version))
  if (revisionFingerprint(resolved.source) !== revisionFingerprint(audit.source)) throw new Error('Revision preview source binding changed.')
  if (!resolved.chapter) throw new Error('An unlinked draft can hold candidates but needs a chapter before formal revision commit.')
}

export async function previewAgentRevisionCommit(data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData) {
  checkRevisionFields(args, [...revisionWriteFields, ...revisionHashFields, 'versionId', 'expectedVersionHash'])
  const projectId = findProjectId(data, args)
  const identity = commandIdentity(args, 'preview_revision_commit', projectId)
  const prior = replayRevisionOperation(data, projectId, identity)
  const previewId = `${identity.id}-preview`
  if (prior) {
    const existing = data.agentActionPreviews.find((item) => item.id === previewId && item.projectId === projectId && item.agentRunId === identity.agentRunId)
    if (!existing || revisionFingerprint(revisionAudit(existing.evidence)) !== revisionFingerprint(prior)) throw new Error('Revision preview is missing or was modified.')
    return { ...previewOutput(existing), replayed: true }
  }
  if (data.agentActionPreviews.some((item) => item.id === previewId)) throw new Error('Revision preview ID collision.')
  const { version, session, request } = revisionVersion(data, projectId, requiredString(args, 'versionId'))
  if (requiredString(args, 'expectedVersionHash') !== revisionFingerprint(version)) throw new Error('Revision candidate changed before preview.')
  const source = resolveRevisionSource(data, projectId, session.chapterId, session.sourceDraftId)
  checkSourceHashes(source.source, args)
  checkKnownAgentSource(data, source.source, 'version', version.id, revisionFingerprint(version))
  const audit: RevisionAudit = {
    schemaVersion: 1, actor: { kind: 'agent', agentRunId: identity.agentRunId }, operation: 'preview_revision_commit',
    commandHash: identity.hash, source: source.source, sessionId: session.id, requestId: request.id,
    requestHash: revisionFingerprint(request), versionId: version.id, versionHash: revisionFingerprint(version), candidateContentHash: draftContentHash(version.body)
  }
  const timestamp = new Date().toISOString()
  const preview: AgentActionPreview = {
    id: previewId, agentRunId: identity.agentRunId, projectId, chapterId: session.chapterId || null,
    jobId: source.draft?.jobId ?? null, actionType: 'revision_commit', status: 'pending',
    summary: 'Replace the bound chapter body with this revision candidate; no canon or memory changes.',
    riskLevel: 'medium', diffSummary: [`Body: ${source.chapter?.body.length ?? 0} -> ${version.body.length} characters.`,
      ...(version.responseScope === 'broader_than_requested' ? ['AI response is broader than the requested selection; explicit whole-chapter acknowledgement required.'] : [])],
    affectedIds: [session.id, request.id, version.id, session.chapterId, session.sourceDraftId ?? ''].filter(Boolean),
    requiresHumanApproval: false, recommendation: 'revise', reason: requiredString(args, 'reason'),
    evidence: revisionEvidence(audit), createdAt: timestamp, updatedAt: timestamp, schemaVersion: 1
  }
  const next = recordRevisionOperation({ ...data, agentActionPreviews: [...data.agentActionPreviews, preview] }, identity.id, audit, preview.reason)
  validateCurrentPreview(next, preview, audit)
  validateRevisionCommitBundle(buildPreviewBundle(next, preview, audit), next)
  const saved = await saveAgentRuntimeData(next, runtime)
  return { ...previewOutput(preview), saved, replayed: false }
}

function assertPersistedBundle(bundle: RevisionCommitBundle, preview: AgentActionPreview, audit: RevisionAudit) {
  if (bundle.revisionCommitId !== `agent-revision-commit-${preview.id}` || bundle.projectId !== preview.projectId ||
    bundle.chapterId !== audit.source.chapterId || bundle.revisionSessionId !== audit.sessionId || bundle.revisionVersionId !== audit.versionId ||
    bundle.revisedBy !== 'agent' || bundle.actor?.kind !== 'agent' || bundle.actor.agentRunId !== preview.agentRunId ||
    bundle.actor.actionPreviewId !== preview.id || draftContentHash(bundle.beforeText ?? '') !== audit.source.sourceChapterContentHash ||
    draftContentHash(bundle.afterText) !== audit.candidateContentHash || !bundle.revisionNote?.includes(`binding ${revisionFingerprint(audit)}.`)) {
    throw new Error('Persisted revision commit does not match the approved Agent preview.')
  }
}

export async function applyApprovedAgentRevisionCommit(data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData) {
  checkRevisionFields(args, [...revisionCommonFields, 'agentRunId', 'previewId', 'expectedPreviewHash', 'confirm', 'acceptBroaderResponse'])
  const projectId = findProjectId(data, args)
  if (args.acceptBroaderResponse !== undefined && typeof args.acceptBroaderResponse !== 'boolean') throw new Error('acceptBroaderResponse must be a boolean.')
  const agentRunId = requiredString(args, 'agentRunId')
  const run = revisionRun(data, projectId, agentRunId)
  const preview = data.agentActionPreviews.find((item) => item.id === requiredString(args, 'previewId') && item.projectId === projectId && item.agentRunId === agentRunId)
  if (!preview || preview.actionType !== 'revision_commit' || preview.status === 'dismissed' || preview.recommendation !== 'revise') throw new Error('Revision preview is unavailable for this Agent/project.')
  const audit = revisionAudit(preview.evidence)
  if (audit.actor.agentRunId !== agentRunId || audit.source.projectId !== projectId || audit.source.chapterId !== preview.chapterId || audit.operation !== 'preview_revision_commit') {
    throw new Error('Revision preview scope binding is invalid.')
  }
  if (requiredString(args, 'expectedPreviewHash') !== revisionFingerprint(audit)) {
    throw new Error('Confirm the exact revision preview hash. This is an Agent acknowledgement, not human approval.')
  }
  const committed = data.revisionCommitBundles.find((bundle) => bundle.revisionCommitId === `agent-revision-commit-${preview.id}`)
  if (committed) {
    assertPersistedBundle(committed, preview, audit)
    if (preview.status === 'applied') {
      return { preview, revisionCommitId: committed.revisionCommitId, replayed: true, formalCommit: true }
    }
  } else {
    if (preview.status === 'applied') throw new Error('Applied revision preview is missing its commit.')
    validateCurrentPreview(data, preview, audit)
    const { version } = revisionVersion(data, projectId, audit.versionId!)
    if (version.responseScope === 'broader_than_requested' && args.acceptBroaderResponse !== true) throw new Error('Explicitly acknowledge the broader whole-chapter response.')
  }
  return withAgentActionAcknowledgement({ runtime, projectId,
    chapterOrder: data.chapters.find((item) => item.id === audit.source.chapterId && item.projectId === projectId)?.order,
    action: 'apply_revision', confirmed: args.confirm === true, requiresGrant: preview.requiresHumanApproval
  }, async (grant) => {
  const bundle = committed ?? buildPreviewBundle(data, preview, audit)
  if (!committed && grant && bundle.actor) bundle.actor = { ...bundle.actor, authorizationGrantId: grant.id }
  const applied = AgentCommitService.applyRevisionCommitBundleForAgent({ appData: data, preview, bundle, confirm: Boolean(grant) })
  applied.decision.id = `agent-revision-applied-${preview.id}`
  applied.decision.evidence = [...revisionEvidence(audit), 'acknowledgedBy=agent', `previewHash=${revisionFingerprint(audit)}`, `revisionCommitId=${bundle.revisionCommitId}`]
  // Use one stable decision for crash recovery instead of adding a second history entry.
  applied.appData.agentRuns = applied.appData.agentRuns.map((item) => item.id === run.id ? {
    ...item, decisions: [...run.decisions.filter((decision) => decision.id !== applied.decision.id), applied.decision]
  } : item)
  const commitSave = await saveAgentRevisionCommitBundle(bundle, runtime)
  runtime.data = applyRevisionCommitBundleToAppData(data, bundle)
  const metadataSave = await saveAgentRuntimeData(applied.appData, runtime)
  return { preview: applied.preview, decision: applied.decision, revisionCommitId: bundle.revisionCommitId,
    commitSave, metadataSave, replayed: Boolean(committed), formalCommit: true }
  })
}
