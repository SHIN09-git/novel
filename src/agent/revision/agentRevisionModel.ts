import { createHash } from 'node:crypto'
import type { AgentDecision, AppData, RevisionSession, RevisionVersion } from '../../shared/types'
import { draftContentHash } from '../../services/DraftDiagnosticBindingService'
import { assertRevisionSourceMatches } from '../../services/RevisionSourceBindingService'
import { isChapterArchived } from '../../services/ChapterLifecycleService'
import { AgentRunService } from '../AgentRunService'
import { requiredString } from '../tools/agentToolArguments'

export interface RevisionSource {
  projectId: string
  chapterId: string
  sourceDraftId: string | null
  sourceJobId: string | null
  sourceContentHash: string
  sourceChapterContentHash: string | null
}

export interface RevisionAudit {
  schemaVersion: 1
  actor: { kind: 'agent'; agentRunId: string }
  operation: string
  commandHash: string
  source: RevisionSource
  sessionId: string
  requestId: string
  requestHash: string
  versionId?: string
  versionHash?: string
  candidateContentHash?: string
  parentVersionId?: string
  contextHash?: string
  aiRunId?: string
  modelConfigHash?: string
}

const auditPrefix = 'agent-revision-v1:'
export const revisionCommonFields = ['storagePath', 'userDataPath', 'projectId', 'project']
export const revisionWriteFields = [...revisionCommonFields, 'agentRunId', 'operationId', 'reason']
export const revisionHashFields = ['expectedSourceHash', 'expectedChapterHash']

export function checkRevisionFields(args: Record<string, unknown>, fields: string[]): void {
  const unknown = Object.keys(args).filter((key) => !fields.includes(key))
  if (unknown.length) throw new Error(`Unsupported revision fields: ${unknown.join(', ')}.`)
}

export function rawRevisionText(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${key}.`)
  return value
}

export function revisionFingerprint(value: unknown): string {
  const stable = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(stable)
    if (!item || typeof item !== 'object') return item
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]))
  }
  return createHash('sha256').update(JSON.stringify(stable(value)) ?? 'undefined').digest('hex')
}

export function revisionEvidence(audit: RevisionAudit): string[] {
  return [auditPrefix + JSON.stringify(audit)]
}

export function revisionAudit(evidence: string[]): RevisionAudit {
  const entries = evidence.filter((entry) => entry.startsWith(auditPrefix))
  if (entries.length !== 1) throw new Error('Missing or ambiguous Agent revision binding.')
  const audit = JSON.parse(entries[0].slice(auditPrefix.length)) as RevisionAudit
  if (audit.schemaVersion !== 1 || audit.actor?.kind !== 'agent' || !audit.actor.agentRunId || !audit.source) {
    throw new Error('Invalid Agent revision binding.')
  }
  return audit
}

export function revisionRun(data: AppData, projectId: string, agentRunId: string) {
  const run = data.agentRuns.find((item) => item.id === agentRunId && item.projectId === projectId)
  if (!run) throw new Error('AgentRun does not belong to the selected project.')
  return run
}

export function revisionSession(data: AppData, projectId: string, sessionId: string): RevisionSession {
  const session = data.revisionSessions.find((item) => item.id === sessionId && item.projectId === projectId)
  if (!session) throw new Error('RevisionSession does not belong to the selected project.')
  return session
}

export function revisionVersion(data: AppData, projectId: string, versionId: string) {
  const version = data.revisionVersions.find((item) => item.id === versionId)
  if (!version) throw new Error('RevisionVersion not found.')
  const session = revisionSession(data, projectId, version.sessionId)
  const request = data.revisionRequests.find((item) => item.id === version.requestId && item.sessionId === session.id)
  if (!request) throw new Error('RevisionVersion references a missing or foreign request.')
  return { version, session, request }
}

export function resolveRevisionSource(data: AppData, projectId: string, chapterId: string, sourceDraftId: string | null) {
  const draft = sourceDraftId ? data.generatedChapterDrafts.find((item) => item.id === sourceDraftId && item.projectId === projectId) : null
  if (sourceDraftId && !draft) throw new Error('Revision source draft is missing or belongs to another project.')
  if (draft && (draft.chapterId ?? '') !== chapterId) throw new Error('Revision source draft chapter binding changed.')
  if (draft && !data.chapterGenerationJobs.some((job) => job.id === draft.jobId && job.projectId === projectId)) {
    throw new Error('Revision source draft references a missing or foreign job.')
  }
  const chapter = chapterId ? data.chapters.find((item) => item.id === chapterId && item.projectId === projectId) : null
  if (chapterId && !chapter) throw new Error('Revision chapter is missing or belongs to another project.')
  if (!draft && !chapter) throw new Error('A revision requires a persisted source.')
  const body = draft?.body ?? chapter!.body
  const source: RevisionSource = {
    projectId, chapterId, sourceDraftId, sourceJobId: draft?.jobId ?? null, sourceContentHash: draftContentHash(body),
    sourceChapterContentHash: chapter ? draftContentHash(chapter.body) : null
  }
  return { source, body, chapter, draft }
}

export function assertRevisionWritable(source: ReturnType<typeof resolveRevisionSource>): void {
  if (source.chapter && isChapterArchived(source.chapter)) throw new Error('Restore the archived chapter before revising it.')
  if (!source.body.trim()) throw new Error('Revision source body is empty.')
}

export function checkSourceHashes(source: RevisionSource, args: Record<string, unknown>): void {
  if (requiredString(args, 'expectedSourceHash') !== source.sourceContentHash ||
    args.expectedChapterHash !== source.sourceChapterContentHash) {
    throw new Error('Revision source/hash changed; read the current source before continuing.')
  }
}

export function checkVersionSource(version: RevisionVersion, source: ReturnType<typeof resolveRevisionSource>): void {
  if (!version.sourceContentHash || (source.chapter && !version.sourceChapterContentHash)) {
    throw new Error('RevisionVersion has no complete source binding; generate a source-bound candidate first.')
  }
  assertRevisionSourceMatches(version, source.body, source.chapter?.body)
}

export function checkKnownAgentSource(data: AppData, source: RevisionSource, kind: 'request' | 'version', id: string, hash: string): void {
  const operations = kind === 'request' ? ['create_revision_request'] : ['generate_revision_version', 'edit_revision_version']
  for (const run of data.agentRuns.filter((item) => item.projectId === source.projectId)) {
    for (const decision of run.decisions.filter((item) => operations.includes(item.step))) {
      const audit = revisionAudit(decision.evidence)
      const matches = kind === 'request' ? audit.requestId === id && audit.requestHash === hash : audit.versionId === id && audit.versionHash === hash
      if (matches && revisionFingerprint(audit.source) !== revisionFingerprint(source)) throw new Error('Agent revision source/job binding changed.')
    }
  }
}

export function commandIdentity(args: Record<string, unknown>, operation: string, projectId: string) {
  const agentRunId = requiredString(args, 'agentRunId')
  const id = `agent-revision-${requiredString(args, 'operationId')}`
  const { storagePath: _path, userDataPath: _user, project: _project, ...command } = args
  return { id, agentRunId, hash: revisionFingerprint({ ...command, projectId, operation }) }
}

export function replayRevisionOperation(data: AppData, projectId: string, identity: ReturnType<typeof commandIdentity>) {
  revisionRun(data, projectId, identity.agentRunId)
  const prior = data.agentRuns.flatMap((run) => run.decisions).find((item) => item.id === identity.id)
  if (!prior) return null
  const audit = revisionAudit(prior.evidence)
  if (prior.projectId !== projectId || prior.agentRunId !== identity.agentRunId || audit.commandHash !== identity.hash) {
    throw new Error('Revision operationId was already used for a different command.')
  }
  return audit
}

export function recordRevisionOperation(data: AppData, id: string, audit: RevisionAudit, reason: string): AppData {
  const decision: AgentDecision = {
    id, agentRunId: audit.actor.agentRunId, projectId: audit.source.projectId,
    chapterId: audit.source.chapterId || null, step: audit.operation, action: 'revise_draft',
    reason, evidence: revisionEvidence(audit), riskLevel: 'medium', result: 'applied', createdAt: new Date().toISOString()
  }
  return AgentRunService.recordAgentDecision(data, decision)
}
