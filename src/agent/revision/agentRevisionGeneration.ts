import type { AppData, RevisionVersion } from '../../shared/types'
import { AIService } from '../../services/AIService'
import { resolvePipelineRoleSettings } from '../../services/PipelineRunContextService'
import { normalizePipelineAIModelOverride } from '../../shared/normalizers/pipelineRunConfig'
import { projectData } from '../../renderer/src/utils/projectData'
import { buildRevisionAiContext } from '../../renderer/src/views/revision/revisionAiContext'
import { findRewriteRange } from '../../renderer/src/components/aiRewriteResultModel'
import { looksLikeFullChapterRevision } from '../../renderer/src/utils/revisionMerge'
import { createHeadlessTransport } from '../AgentPipelineExecutor'
import { loadAgentRuntimeData, saveAgentRuntimeData, type AgentRuntimeData } from '../AgentRuntime'
import { findProjectId, requiredString } from '../tools/agentToolArguments'
import { readRevisionVersion } from './agentRevisionReads'
import {
  assertRevisionWritable, checkKnownAgentSource, checkRevisionFields, checkSourceHashes, commandIdentity, recordRevisionOperation,
  replayRevisionOperation, resolveRevisionSource, revisionFingerprint, revisionHashFields, revisionSession,
  revisionWriteFields, type RevisionAudit
} from './agentRevisionModel'

export async function generateAgentRevisionVersion(
  data: AppData, args: Record<string, unknown>, runtime: AgentRuntimeData,
  dependencies: { ai?: Pick<AIService, 'generateRevision'> } = {}
) {
  checkRevisionFields(args, [...revisionWriteFields, ...revisionHashFields, 'requestId', 'expectedRequestHash'])
  const projectId = findProjectId(data, args)
  const identity = commandIdentity(args, 'generate_revision_version', projectId)
  const reason = requiredString(args, 'reason')
  const prior = replayRevisionOperation(data, projectId, identity)
  if (prior?.versionId) return { ...readRevisionVersion(data, projectId, prior.versionId), replayed: true }
  if (data.revisionVersions.some((item) => item.id === `${identity.id}-version`)) throw new Error('Revision version ID collision.')
  const request = data.revisionRequests.find((item) => item.id === requiredString(args, 'requestId'))
  if (!request) throw new Error('RevisionRequest not found.')
  const session = revisionSession(data, projectId, request.sessionId)
  if (session.status !== 'active') throw new Error('RevisionSession is no longer active.')
  if (revisionFingerprint(request) !== requiredString(args, 'expectedRequestHash')) throw new Error('Revision request changed.')
  const resolved = resolveRevisionSource(data, projectId, session.chapterId, session.sourceDraftId)
  assertRevisionWritable(resolved)
  checkSourceHashes(resolved.source, args)
  checkKnownAgentSource(data, resolved.source, 'request', request.id, revisionFingerprint(request))
  if (request.sourceDraftContentHash && request.sourceDraftContentHash !== resolved.source.sourceContentHash) throw new Error('Revision request belongs to an older source.')
  const range = request.targetRange ? findRewriteRange(resolved.body, request.targetRange) : null
  if (request.targetRange && !range) throw new Error('Local revision target must match the source exactly once.')
  const scoped = projectData(data, projectId)
  const project = data.projects.find((item) => item.id === projectId)!
  const context = buildRevisionAiContext({ ...scoped, project, selectedChapter: resolved.chapter ?? null, selectedDraft: resolved.draft ?? null })
  const sourceRun = resolved.draft ? scoped.chapterGenerationJobs.find((job) => job.id === resolved.draft!.jobId) : undefined
  const roleSettings = resolvePipelineRoleSettings(sourceRun?.aiRunConfig, data.settings, 'revision')
  const settings = { ...roleSettings, hasApiKey: roleSettings.hasApiKey || Boolean(process.env.NOVEL_DIRECTOR_API_KEY?.trim()) }
  const aiRunId = sourceRun?.id ?? identity.agentRunId
  const ai = dependencies.ai ?? new AIService(settings, { runId: aiRunId, transport: createHeadlessTransport(settings).transport })
  const result = await ai.generateRevision({
    type: request.type, instruction: request.instruction, fullChapterText: resolved.body,
    revisionScope: range ? 'local' : 'full', ...(range ? { targetRange: range.text } : {})
  }, context, { runId: aiRunId, clientCallId: identity.id })
  if (!result.ok || !result.usedAI || !result.data?.revisedText.trim()) {
    throw new Error(!result.usedAI ? 'AI did not generate a revision; no fallback prose was saved.' :
      result.error || 'AI did not return revision prose; no candidate was saved.')
  }
  const broader = Boolean(range && looksLikeFullChapterRevision(resolved.body, range.text, result.data.revisedText))
  const body = range && !broader
    ? resolved.body.slice(0, range.start) + result.data.revisedText + resolved.body.slice(range.end)
    : result.data.revisedText
  const timestamp = new Date().toISOString()
  const version: RevisionVersion = {
    id: `${identity.id}-version`, sessionId: session.id, requestId: request.id,
    title: `${resolved.draft?.title ?? resolved.chapter?.title ?? 'Revision'} - ${request.type}`,
    body, changedSummary: result.data.changedSummary, risks: result.data.risks, preservedFacts: result.data.preservedFacts,
    sourceContentHash: resolved.source.sourceContentHash,
    ...(resolved.source.sourceChapterContentHash !== null ? { sourceChapterContentHash: resolved.source.sourceChapterContentHash } : {}),
    responseScope: broader ? 'broader_than_requested' : 'as_requested', status: 'pending', createdAt: timestamp, updatedAt: timestamp
  }
  const audit: RevisionAudit = {
    schemaVersion: 1, actor: { kind: 'agent', agentRunId: identity.agentRunId }, operation: 'generate_revision_version',
    commandHash: identity.hash, source: resolved.source, sessionId: session.id, requestId: request.id,
    requestHash: revisionFingerprint(request), versionId: version.id, versionHash: revisionFingerprint(version), contextHash: revisionFingerprint(context),
    aiRunId, modelConfigHash: revisionFingerprint(normalizePipelineAIModelOverride(settings))
  }
  // Reload after the asynchronous model call. Never save the pre-request AppData snapshot.
  const current = await loadAgentRuntimeData({ storagePath: runtime.storagePath ?? undefined, userDataPath: runtime.userDataPath })
  const replay = replayRevisionOperation(current.data, projectId, identity)
  if (replay?.versionId) return { ...readRevisionVersion(current.data, projectId, replay.versionId), replayed: true }
  const currentSession = revisionSession(current.data, projectId, session.id)
  if (revisionFingerprint(currentSession) !== revisionFingerprint(session) ||
    revisionFingerprint(current.data.revisionRequests.find((item) => item.id === request.id)) !== audit.requestHash) {
    throw new Error('Revision session/request changed during generation; candidate was not saved.')
  }
  if (current.data.revisionVersions.some((item) => item.id === version.id)) throw new Error('Revision version ID collision.')
  const next = recordRevisionOperation({ ...current.data, revisionVersions: [...current.data.revisionVersions, version] }, identity.id, audit, reason)
  const saved = await saveAgentRuntimeData(next, current)
  Object.assign(runtime, current)
  return { ...readRevisionVersion(next, projectId, version.id), contextSource: 'rebuilt_from_current_project_records', saved, replayed: false }
}
