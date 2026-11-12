import type { AppData, ChapterCommitBundle, RevisionCommitBundle } from '../../shared/types'
import { normalizeAppData } from '../../shared/defaults'
import { normalizeHardCanonPack } from '../../shared/normalizers/appData'
import { applicableRules } from '../../services/hardCanonAudit/rules'
import { libraryEntityId, parseLibraryJsonValue } from '../libraryValidation'
import { asRecord } from './sqliteEntityMapper'
import { receiptKeys } from './sqliteReceiptAliases'
import { readLibraryHeader } from './sqliteSnapshot'
import type { AppDataArrayKey, SqliteDatabase, SqliteValue } from './sqliteTypes'

type Key = AppDataArrayKey
type Id = string | null | undefined

// A transaction-local input to the existing bundle validators and entry mappers.
// This projection must never be passed to a snapshot writer.
class CommitRows {
  private readonly rows = new Map<Key, Map<string, Record<string, unknown>>>()
  private readonly byId
  constructor(private readonly db: SqliteDatabase) {
    this.byId = db.prepare('SELECT id, json FROM entities WHERE collection = ? AND id = ?')
  }

  private keep(key: Key, row: Record<string, unknown>) {
    let group = this.rows.get(key)
    if (!group) this.rows.set(key, group = new Map())
    if (typeof row.id !== 'string' || typeof row.json !== 'string') throw new Error('Invalid SQLite commit record.')
    if (!group.has(row.id)) {
      const value = parseLibraryJsonValue(row.json)
      if (libraryEntityId(key, value) !== row.id) throw new Error(`SQLite record ID mismatch: ${key}/${row.id}`)
      group.set(row.id, asRecord(value))
    }
  }

  ids(key: Key, ...ids: Id[]) {
    for (const id of new Set(ids)) {
      if (!id || this.rows.get(key)?.has(id)) continue
      const row = this.byId.get(key, id)
      if (row) this.keep(key, row)
    }
  }

  one(key: Key, id: Id) {
    this.ids(key, id)
    return id ? this.rows.get(key)?.get(id) : undefined
  }

  receipt(key: 'chapterCommitBundles' | 'revisionCommitBundles', id: Id) {
    if (id) this.ids(key, ...receiptKeys(this.db, key, id))
    return Boolean(this.rows.get(key)?.size)
  }

  private select(key: Key, where: string, ...args: SqliteValue[]) {
    for (const row of this.db.prepare(`SELECT id, json FROM entities WHERE collection = ? AND ${where}`)
      .iterate(key, ...args)) this.keep(key, row)
  }

  scoped(key: Key, column: keyof typeof legacyKeys, value: string | number, filter = '', ...args: SqliteValue[]) {
    // Separate index probes keep SQLite from scanning the whole collection for an OR.
    this.select(key, column + ' = ?' + filter, value, ...args)
    this.select(key, column + ' IS NULL AND ' + legacyKeys[column] + ' = ?' + filter, value, ...args)
  }

  private values(key: Key) {
    const rows = this.rows.get(key)
    if (!rows) return []
    // Both the audit and the validators see the same binary ID ordering as a full SQLite read.
    const ids = [...rows.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    return ids.map(id => rows.get(id)!)
  }

  hardCanon(projectId: string, order: number) {
    this.scoped('hardCanonPacks', 'project_id', projectId)
    const packs = this.values('hardCanonPacks')
    if (!packs.length) return
    // First normalize without a character directory. The final normalization below
    // resolves character bindings against the same project as a full snapshot.
    const rules = applicableRules(packs.map(pack => normalizeHardCanonPack(pack)), projectId, order)
    if (!rules.length) return
    this.scoped('characters', 'project_id', projectId)
    const state = rules.some(r => r.check.kind === 'actor_action' && r.check.state)
    if (state || rules.some(r => r.check.kind === 'literal')) this.scoped('chapters', 'project_id', projectId)
    if (state) {
      this.scoped('characterStateFacts', 'project_id', projectId)
      this.scoped('characterStateTransactions', 'project_id', projectId)
    }
  }

  data(): AppData {
    const partial: Partial<AppData> = { characters: [] }
    for (const key of this.rows.keys()) Object.assign(partial, { [key]: this.values(key) })
    return normalizeAppData(partial)
  }
}

// Older stores may lack a denormalized key; filter those rows in SQLite.
const legacyKeys = {
  project_id: "json_extract(json, '$.projectId')",
  job_id: "json_extract(json, '$.jobId')",
  chapter_order: "CASE WHEN json_type(json, '$.order') IN ('integer', 'real') THEN json_extract(json, '$.order') ELSE 1 END"
}
const inProject = " AND coalesce(project_id, json_extract(json, '$.projectId')) = ?"

export function readChapterCommitContext(db: SqliteDatabase, b: ChapterCommitBundle, strict = false): AppData {
  if (strict) readLibraryHeader(db)
  const r = new CommitRows(db)
  const replay = r.receipt('chapterCommitBundles', b.commitId)
  // Point reads deliberately have no project predicate: a foreign colliding ID
  // must be visible to the same validator that handles JSON and in-memory data.
  r.ids('chapters', b.chapterId)
  r.ids('chapterVersions', b.chapterVersion?.id, b.previousChapterVersion?.id, b.chapterVersion?.baseChapterVersionId)
  const draft = r.one('generatedChapterDrafts', b.generatedDraftId)
  r.ids('generatedChapterDrafts', b.generatedDraft?.id)
  r.ids('generationRunTraces', b.generationRunTraceId, b.generationRunTrace?.id)
  r.ids('qualityGateReports', b.qualityGateReportId, ...(b.qualityGateReports ?? []).map(x => x.id))
  r.ids('consistencyReviewReports', b.consistencyReviewReportId, ...(b.consistencyReviewReports ?? []).map(x => x.id))
  r.ids('redundancyReports', ...(b.redundancyReports ?? []).map(x => x.id))
  r.ids('memoryUpdateCandidates', ...(b.acceptedMemoryUpdateCandidates ?? []).map(x => x.id))
  r.ids('characterStateChangeCandidates', ...(b.acceptedCharacterStateChangeCandidates ?? []).map(x => x.id))
  r.ids('characterStateFacts', ...(b.appliedCharacterStateFacts ?? []).map(x => x.id),
    ...(b.appliedCharacterStateTransactions ?? []).map(x => x.factId))
  r.ids('characterStateTransactions', ...(b.appliedCharacterStateTransactions ?? []).map(x => x.id))
  r.ids('foreshadowings', ...(b.appliedForeshadowingUpdates ?? []).map(x => x.id))
  r.ids('timelineEvents', ...(b.appliedTimelineEvents ?? []).map(x => x.id))
  const jobId = b.jobId ?? (draft?.jobId as Id) ?? b.generatedDraft?.jobId
  const job = r.one('chapterGenerationJobs', jobId)
  if (!replay) {
    if (jobId && job?.projectId === b.projectId) {
      if (b.acceptanceReview) {
        for (const key of ['qualityGateReports', 'editorialVerdicts'] as const) {
          r.scoped(key, 'job_id', jobId, inProject + " AND json_extract(json, '$.draftId') = ?", b.projectId, b.generatedDraftId ?? null)
        }
      } else {
        // Only legacy adoption checks the first prose step for an incomplete fragment.
        r.scoped('chapterGenerationSteps', 'job_id', jobId, " AND json_extract(json, '$.type') = 'generate_chapter_draft'")
      }
    }
    if (b.acceptanceReview) {
      const order = b.chapter.order
      r.scoped('chapters', 'chapter_order', order, inProject, b.projectId)
    }
    const order = b.acceptanceReview && typeof job?.targetChapterOrder === 'number' ? job.targetChapterOrder : b.chapter.order
    r.hardCanon(b.projectId, order)
  }
  return r.data()
}

export function readRevisionCommitContext(db: SqliteDatabase, b: RevisionCommitBundle, strict = false): AppData {
  if (strict) readLibraryHeader(db)
  const r = new CommitRows(db)
  if (r.receipt('revisionCommitBundles', b.revisionCommitId)) return r.data()
  r.ids('chapters', b.chapterId)
  r.ids('chapterVersions', b.baseChapterVersionId, b.newChapterVersionId)
  r.receipt('chapterCommitBundles', b.linkedChapterCommitId)
  r.ids('generationRunTraces', b.linkedGenerationRunTraceId, b.generationRunTrace?.id)
  r.ids('agentRuns', b.actor?.agentRunId)
  r.ids('agentActionPreviews', b.actor?.actionPreviewId)
  const version = r.one('revisionVersions', b.revisionVersionId ?? b.revisionVersion?.id)
  const session = r.one('revisionSessions', (version?.sessionId as Id) ?? b.revisionSessionId ?? b.revisionSession?.id)
  r.ids('revisionSessions', b.revisionSessionId, b.revisionSession?.id)
  r.ids('generatedChapterDrafts', session?.sourceDraftId as Id, b.generatedDraft?.id)
  r.hardCanon(b.projectId, b.chapter.order)
  return r.data()
}
