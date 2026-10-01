import type { AppData } from '../../shared/types'
import { redactSensitiveText } from '../../shared/errorUtils'
import { compact } from '../agentReadableText'
import { findProjectId, readOptions, requiredString } from '../tools/agentToolArguments'
import { checkRevisionFields, resolveRevisionSource, revisionCommonFields, revisionFingerprint, revisionVersion, type RevisionSource } from './agentRevisionModel'

export function readRevisionVersion(data: AppData, projectId: string, id: string, args: Record<string, unknown> = {}) {
  const { version, session, request } = revisionVersion(data, projectId, id)
  const options = readOptions(args)
  const text = (value: string) => {
    const safe = redactSensitiveText(value, [data.settings.apiKey])
    return options.detail === 'full' ? safe.slice(0, options.maxChars) : compact(safe, options.maxChars ?? 320)
  }
  let currentSource: RevisionSource | null = null
  let sourceError: string | null = null
  try { currentSource = resolveRevisionSource(data, projectId, session.chapterId, session.sourceDraftId).source }
  catch (error) { sourceError = error instanceof Error ? error.message : String(error) }
  return {
    projectId, session, request: { ...request, instruction: text(request.instruction), targetRange: text(request.targetRange) },
    version: { ...version, title: text(version.title), body: text(version.body), changedSummary: text(version.changedSummary),
      risks: text(version.risks), preservedFacts: text(version.preservedFacts) },
    versionHash: revisionFingerprint(version), requestHash: revisionFingerprint(request), currentSource, sourceError,
    stale: !currentSource || version.sourceContentHash !== currentSource.sourceContentHash ||
      (currentSource.sourceChapterContentHash !== null && version.sourceChapterContentHash !== currentSource.sourceChapterContentHash),
    bodyCharCount: version.body.length,
    revisionCommitId: data.revisionCommitBundles.find((bundle) => bundle.projectId === projectId && bundle.revisionVersionId === version.id)?.revisionCommitId ?? null,
    formalCommit: data.revisionCommitBundles.some((bundle) => bundle.projectId === projectId && bundle.revisionVersionId === version.id)
  }
}

export function handleRevisionRead(name: string, args: Record<string, unknown>, data: AppData) {
  if (name !== 'agent.getRevisionSessions' && name !== 'agent.getRevisionVersion') return { handled: false }
  checkRevisionFields(args, [...revisionCommonFields, 'detail', 'maxChars', ...(name === 'agent.getRevisionVersion' ? ['versionId'] : ['chapterId', 'draftId'])])
  const projectId = findProjectId(data, args)
  readOptions(args)
  if (name === 'agent.getRevisionVersion') return { handled: true, payload: readRevisionVersion(data, projectId, requiredString(args, 'versionId'), args) }
  const chapterId = args.chapterId === undefined ? undefined : requiredString(args, 'chapterId')
  const draftId = args.draftId === undefined ? undefined : requiredString(args, 'draftId')
  if (chapterId && !data.chapters.some((chapter) => chapter.id === chapterId && chapter.projectId === projectId)) throw new Error('Chapter not in project.')
  if (draftId && !data.generatedChapterDrafts.some((draft) => draft.id === draftId && draft.projectId === projectId)) throw new Error('Draft not in project.')
  const sourceDraft = draftId ? data.generatedChapterDrafts.find((draft) => draft.id === draftId)! : null
  if (chapterId && sourceDraft && sourceDraft.chapterId !== chapterId) throw new Error('Draft and chapter filters refer to different revision sources.')
  const currentSource = chapterId || draftId
    ? resolveRevisionSource(data, projectId, sourceDraft?.chapterId ?? chapterId ?? '', draftId ?? null).source : null
  const sessions = data.revisionSessions.filter((session) => session.projectId === projectId &&
    (!chapterId || session.chapterId === chapterId) && (!draftId || session.sourceDraftId === draftId))
  return { handled: true, payload: { projectId, currentSource, sessions: sessions.map((session) => ({
    ...session,
    requests: data.revisionRequests.filter((request) => request.sessionId === session.id).map((request) => ({
      ...request, requestHash: revisionFingerprint(request),
      instruction: readOptions(args).detail === 'full' ? redactSensitiveText(request.instruction, [data.settings.apiKey]) : compact(redactSensitiveText(request.instruction, [data.settings.apiKey]), 320),
      targetRange: readOptions(args).detail === 'full' ? redactSensitiveText(request.targetRange, [data.settings.apiKey]) : compact(redactSensitiveText(request.targetRange, [data.settings.apiKey]), 320)
    })),
    versions: data.revisionVersions.filter((version) => version.sessionId === session.id).map((version) => readRevisionVersion(data, projectId, version.id, args))
  })) } }
}
