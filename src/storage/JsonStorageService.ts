import { createHash } from 'node:crypto'
import { accessSync, closeSync, constants, openSync, readFileSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AppData, CandidateDecisionCommand, CandidateDecisionReceipt, CharacterCardReviewCommand, ChapterCommitBundle, ChapterWritebackFailure, GenerationRunBundle, RevisionCommitBundle } from '../shared/types'
import type { CandidateDecisionWriteResult, CharacterCardReviewWriteResult, StorageWriteResult } from '../shared/ipc/ipcTypes'
import { applyCandidateDecisionCommand, candidateDecisionChanges, candidateDecisionRemovals } from '../services/CandidateDecisionService'
import { EMPTY_APP_DATA, normalizeAppData, sanitizeAppDataForPersistence } from '../shared/defaults'
import { redactSensitiveText } from '../shared/errorUtils'
import { normalizeChapterWritebackFailure, normalizeChapterWritebackFailures } from '../shared/normalizers/chapterWritebackFailures'
import { applyChapterCommitBundleToAppData } from '../services/ChapterCommitBundleService'
import { applyGenerationRunBundleToAppData } from '../services/GenerationRunBundleService'
import { applyRevisionCommitBundleToAppData } from '../services/RevisionCommitBundleService'
import { withJsonWriteLock } from './jsonWriteLock'
import { assertReservedLibraryFile } from './libraryFile'
import { decodeLibraryText, normalizeLibraryData, parseLibraryJsonValue } from './libraryValidation'
import { jsonTitleVersionIds, readJsonChapterTitles } from './chapterTitleState'
import { applyTitleReceiptToChapters } from '../shared/chapterTitleHistory'
import { decideChapterTitleCommit } from '../services/ChapterTitleRenameService'
import type { ChapterTitleActor, ChapterTitleCommit } from '../shared/types/chapterTitle'
import type { ChapterTitleWriteResult } from '../shared/ipc/ipcTypes'
import { applyCharacterCardReview } from '../services/characterState/cardReview'
import {
  StorageRevisionConflictError,
  type StorageService,
  type StorageSnapshot
} from './StorageService'

function revisionForRaw(raw: string | Buffer): string {
  return createHash('sha256').update(raw).digest('hex')
}

function checkedJsonSnapshot(bytes: Buffer, initial?: StorageSnapshot): StorageSnapshot {
  const revision = revisionForRaw(bytes)
  if (initial?.revision === revision) return initial
  return { data: normalizeLibraryData(parseLibraryJsonValue(decodeLibraryText(bytes))), revision }
}

function redactDecisionValue(value: unknown, secrets: string[], field = ''): unknown {
  if (typeof value === 'string') {
    const redacted = value && /^(?:api[_-]?key|x-api-key|authorization|access[_-]?token|token)$/i.test(field)
      ? '[REDACTED]' : redactSensitiveText(value, secrets)
    if (redacted !== value && /^(?:id|.*Ids?|.*Fingerprint)$/.test(field)) {
      throw new Error('Candidate decision identity contains sensitive data.')
    }
    return redacted
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => redactDecisionValue(item, secrets, field))
    return items.some((item, index) => item !== value[index]) ? items : value
  }
  if (!value || typeof value !== 'object') return value
  const entries = Object.entries(value)
  const redacted = entries.map(([key, item]) => {
    if (redactSensitiveText(key, secrets) !== key) throw new Error('Candidate decision field contains sensitive data.')
    return [key, redactDecisionValue(item, secrets, key)] as const
  })
  return redacted.some(([, item], index) => item !== entries[index][1]) ? Object.fromEntries(redacted) : value
}

/** Shared by JSON and SQLite before any decision writes or response patches are emitted. */
export function sanitizeCandidateDecisionWrite(data: AppData, applied: ReturnType<typeof applyCandidateDecisionCommand>) {
  const secrets = [data.settings.apiKey]
  const sanitizeReceipt = (receipt: CandidateDecisionReceipt): CandidateDecisionReceipt => {
    const safe = redactDecisionValue(receipt, secrets) as CandidateDecisionReceipt
    if (safe.effects !== receipt.effects) {
      // Redacted before-values are not reversible evidence; never restore placeholder text.
      const { effects: _effects, ...withoutJournal } = safe
      return withoutJournal
    }
    return safe
  }
  const receipt = sanitizeReceipt(applied.receipt)
  if (applied.replayed) return { ...applied, receipt }
  const changes = candidateDecisionChanges(data, applied.data)
  for (const [collection, records] of Object.entries(changes)) {
    if (collection === 'candidateDecisionReceipts') continue
    if ((records as unknown[]).some((record) => redactDecisionValue(record, secrets) !== record)) {
      throw new Error('Candidate decision target contains sensitive data. Remove credentials before saving.')
    }
  }
  const safeReceipts = new Map((changes.candidateDecisionReceipts ?? []).map((item) => [item.id, sanitizeReceipt(item)]))
  return { ...applied, receipt, data: { ...applied.data,
    candidateDecisionReceipts: applied.data.candidateDecisionReceipts.map((item) => safeReceipts.get(item.id) ?? item) } }
}

export function applyCandidateDecisionForStorage(data: AppData, command: CandidateDecisionCommand) {
  try {
    return sanitizeCandidateDecisionWrite(data, applyCandidateDecisionCommand(data, command))
  } catch (error) {
    if (!(error instanceof Error)) throw new Error('Candidate decision could not be saved.')
    const message = redactSensitiveText(error.message, [data.settings.apiKey])
    if (message === error.message) throw error
    const safe = new Error(message) as Error & { code?: string }
    if ('code' in error && typeof error.code === 'string') safe.code = redactSensitiveText(error.code, [data.settings.apiKey])
    throw safe
  }
}

export class JsonStorageService implements StorageService {
  private readonly strict: boolean
  private initial?: StorageSnapshot

  constructor(private readonly storagePath: string, mode: 'legacy' | 'existing' | 'new' = 'legacy', initialData: AppData = EMPTY_APP_DATA) {
    this.strict = mode !== 'legacy'
    if (mode === 'existing') {
      this.initial = checkedJsonSnapshot(readFileSync(storagePath))
      closeSync(openSync(storagePath, 'r+'))
      accessSync(dirname(storagePath), constants.W_OK)
    } else if (mode === 'new') {
      const fd = openSync(storagePath, 'r+')
      try {
        assertReservedLibraryFile(storagePath, fd)
        const data = normalizeLibraryData(initialData, sanitizeAppDataForPersistence)
        writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8')
      } finally { closeSync(fd) }
    }
  }

  getStoragePath(): string {
    return this.storagePath
  }

  async load(): Promise<AppData> {
    return (await this.loadSnapshot()).data
  }

  async loadSnapshot(): Promise<StorageSnapshot> {
    if (this.strict) {
      const bytes = await readFile(this.storagePath), initial = this.initial
      this.initial = undefined
      return checkedJsonSnapshot(bytes, initial)
    }
    let raw = ''
    try {
      raw = await readFile(this.storagePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppData>
      return { data: normalizeAppData(parsed), revision: revisionForRaw(raw) }
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') {
        await withJsonWriteLock(this.storagePath, async () => {
          // Another process may have initialized the file while we waited.
          if (await this.readCurrentRevision() === 'missing') await this.writeData(EMPTY_APP_DATA)
        })
        return this.loadSnapshot()
      }

      const backupPath = `${this.storagePath}.corrupt.${Date.now()}.json`
      try {
        await copyFile(this.storagePath, backupPath)
        console.warn(`Failed to load data file. Backed up corrupt data to ${backupPath}.`, error)
      } catch (backupError) {
        console.warn(`Failed to load data file and could not create corrupt backup at ${backupPath}.`, {
          error,
          backupError
        })
      }
      return {
        data: EMPTY_APP_DATA,
        revision: raw ? revisionForRaw(raw) : 'unreadable'
      }
    }
  }

  async save(data: AppData): Promise<void> {
    await this.saveIfCurrent(data)
  }

  async touchProject(projectId: string, expectedRevision: string): Promise<StorageWriteResult> {
    if (!expectedRevision) throw new StorageRevisionConflictError()
    return withJsonWriteLock(this.storagePath, async () => {
      const bytes = await readFile(this.storagePath)
      if (revisionForRaw(bytes) !== expectedRevision) throw new StorageRevisionConflictError()
      const original = parseLibraryJsonValue(decodeLibraryText(bytes)) as AppData
      // Its digest matches the loaded snapshot. Validate shape without normalizing unrelated rows.
      if (this.strict) normalizeLibraryData(original, data => data)
      const project = original.projects.find(row => row.id === projectId)
      if (!project) throw new Error('项目不存在。')
      // Write the original document, not its normalized view: keep unknown fields and old records.
      let cleanBackup: string | undefined
      if (original.settings?.apiKey) {
        original.settings.apiKey = ''
        cleanBackup = JSON.stringify(original, null, 2)
      }
      const updatedAt = new Date().toISOString()
      project.lastOpenedAt = updatedAt
      const written = await this.replaceDocument(original, undefined, cleanBackup)
      return { ok: true, storagePath: this.storagePath, revision: revisionForRaw(written),
        updatedAt, savedCollections: ['projects'] }
    }, false)
  }

  async backupTo(targetPath: string): Promise<void> {
    if (this.strict) {
      const raw = await readFile(this.storagePath)
      checkedJsonSnapshot(raw, this.initial)
      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(targetPath, raw)
      return
    }
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(this.storagePath, targetPath)
  }

  async saveIfCurrent(data: AppData, expectedRevision?: string, onWriteStarted?: () => void): Promise<StorageWriteResult> {
    return this.withWriteLock(revision => this.writeIfCurrent(data, expectedRevision, onWriteStarted, revision))
  }

  private withWriteLock<T>(write: (validatedRevision?: string) => Promise<T>): Promise<T> {
    // A file replaced or removed after open must not be recreated, even by an unconditional save.
    return withJsonWriteLock(this.storagePath, async () =>
      write(this.strict ? (await this.loadSnapshot()).revision : undefined), !this.strict)
  }

  private async writeIfCurrent(data: AppData, expectedRevision?: string, onWriteStarted?: () => void, validatedRevision?: string): Promise<StorageWriteResult> {
    const currentRevision = validatedRevision ?? await this.readCurrentRevision()
    if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
      throw new StorageRevisionConflictError()
    }
    await this.writeData(data, onWriteStarted)
    const revision = await this.readCurrentRevision()
    const updatedAt = new Date().toISOString()
    return {
      ok: true,
      storagePath: this.storagePath,
      revision,
      updatedAt,
      savedCollections: ['appData']
    }
  }

  private async readCurrentRevision(): Promise<string> {
    try {
      return revisionForRaw(await readFile(this.storagePath, 'utf-8'))
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT' && !this.strict) return 'missing'
      throw error
    }
  }

  private async writeData(data: AppData, onWriteStarted?: () => void): Promise<void> {
    await this.replaceDocument(this.strict ? normalizeLibraryData(data, sanitizeAppDataForPersistence)
      : sanitizeAppDataForPersistence(data), onWriteStarted)
  }

  private async replaceDocument(data: Partial<AppData>, onWriteStarted?: () => void, cleanBackup?: string): Promise<string> {
    const raw = JSON.stringify(data, null, 2)
    onWriteStarted?.()
    if (!this.strict) await mkdir(dirname(this.storagePath), { recursive: true })
    const tmpPath = `${this.storagePath}.tmp`
    const backupPath = `${this.storagePath}.bak`

    await writeFile(tmpPath, raw, 'utf-8')

    try {
      await stat(this.storagePath)
      if (cleanBackup !== undefined) await writeFile(backupPath, cleanBackup, 'utf-8')
      else await copyFile(this.storagePath, backupPath)
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      if (this.strict || code !== 'ENOENT') {
        throw error
      }
    }

    await rename(tmpPath, this.storagePath)
    return raw
  }

  async saveGenerationRunBundle(bundle: GenerationRunBundle, expectedRevision?: string): Promise<StorageWriteResult> {
    const snapshot = await this.loadSnapshot()
    if (expectedRevision !== undefined && snapshot.revision !== expectedRevision) {
      throw new StorageRevisionConflictError()
    }
    const next = applyGenerationRunBundleToAppData(snapshot.data, bundle)
    const persisted = await this.saveIfCurrent(next, snapshot.revision)
    const updatedAt = new Date().toISOString()
    return {
      ...persisted,
      updatedAt,
      savedCollections: [
        'chapterGenerationJobs',
        'chapterGenerationSteps',
        'promptContextSnapshots',
        'contextNeedPlans',
        'contextBudgetProfiles',
        'generatedChapterDrafts',
        'qualityGateReports',
        'consistencyReviewReports',
        'memoryUpdateCandidates',
        'characterStateChangeCandidates',
        'redundancyReports',
        'editorialVerdicts',
        'generationRunTraces'
      ]
    }
  }

  async saveChapterCommitBundle(bundle: ChapterCommitBundle, expectedRevision?: string, onWriteStarted?: () => void): Promise<StorageWriteResult> {
    const snapshot = await this.loadSnapshot()
    if (expectedRevision !== undefined && snapshot.revision !== expectedRevision) {
      throw new StorageRevisionConflictError()
    }
    const next = applyChapterCommitBundleToAppData(snapshot.data, bundle)
    if (next === snapshot.data) {
      return {
        ok: true,
        storagePath: this.storagePath,
        revision: snapshot.revision,
        updatedAt: new Date().toISOString(),
        savedCollections: []
      }
    }
    const persisted = await this.saveIfCurrent(next, snapshot.revision, onWriteStarted)
    const updatedAt = new Date().toISOString()
    return {
      ...persisted,
      updatedAt,
      savedCollections: [
        'chapters',
        'chapterVersions',
        'generatedChapterDrafts',
        'qualityGateReports',
        'consistencyReviewReports',
        'redundancyReports',
        'memoryUpdateCandidates',
        'characterStateChangeCandidates',
        'characterStateFacts',
        'foreshadowings',
        'timelineEvents',
        'generationRunTraces',
        'chapterCommitBundles'
      ]
    }
  }

  async saveRevisionCommitBundle(bundle: RevisionCommitBundle, expectedRevision?: string, onWriteStarted?: () => void): Promise<StorageWriteResult> {
    const snapshot = await this.loadSnapshot()
    if (expectedRevision !== undefined && snapshot.revision !== expectedRevision) {
      throw new StorageRevisionConflictError()
    }
    const next = applyRevisionCommitBundleToAppData(snapshot.data, bundle)
    if (next === snapshot.data) {
      return {
        ok: true,
        storagePath: this.storagePath,
        revision: snapshot.revision,
        updatedAt: new Date().toISOString(),
        savedCollections: []
      }
    }
    const persisted = await this.saveIfCurrent(next, snapshot.revision, onWriteStarted)
    const updatedAt = new Date().toISOString()
    return {
      ...persisted,
      updatedAt,
      savedCollections: [
        'chapters',
        'chapterVersions',
        'generatedChapterDrafts',
        'revisionSessions',
        'revisionVersions',
        'generationRunTraces',
        'revisionCommitBundles'
      ]
    }
  }

  async recordChapterWritebackFailureIfUncommitted(failure: ChapterWritebackFailure): Promise<void> {
    await this.withWriteLock(async () => {
      // A missing/corrupt file is not evidence of absence. Do not initialize it or save a fallback snapshot.
      const data = JSON.parse(await readFile(this.storagePath, 'utf-8')) as Partial<AppData>
      const safe = normalizeChapterWritebackFailure(failure, data.settings?.apiKey)
      if (!safe || !data.projects?.some((row) => row.id === safe.projectId) ||
        data.chapterVersions?.some((row) => row.id === safe.versionId)) return
      const hasReceipt = failure.kind === 'chapter_commit'
        ? data.chapterCommitBundles?.some((row) => row.commitId === failure.commitId || row.id === failure.commitId)
        : data.revisionCommitBundles?.some((row) => row.revisionCommitId === failure.commitId || row.id === failure.commitId)
      if (hasReceipt) return
      const history = normalizeChapterWritebackFailures(data.chapterWritebackFailures, data.settings?.apiKey, data.projects)
      if (history.some((row) => row.id === safe.id)) return
      await this.replaceDocument({ ...data, chapterWritebackFailures: [...history, safe] })
    })
  }

  async executeCandidateDecision(command: CandidateDecisionCommand, expectedRevision?: string): Promise<CandidateDecisionWriteResult> {
    const snapshot = await this.loadSnapshot()
    const hasReceipt = snapshot.data.candidateDecisionReceipts.some((item) => item.id === command.id)
    if (!hasReceipt && expectedRevision !== undefined && snapshot.revision !== expectedRevision) throw new StorageRevisionConflictError()
    const result = applyCandidateDecisionForStorage(snapshot.data, command)
    if (result.replayed) return { ok: true, storagePath: this.storagePath, revision: snapshot.revision,
      updatedAt: result.receipt.updatedAt, savedCollections: [], changes: {}, removedRecords: [], receipt: result.receipt, replayed: true }
    const changes = candidateDecisionChanges(snapshot.data, result.data)
    const removedRecords = candidateDecisionRemovals(snapshot.data, result.data)
    const saved = await this.saveIfCurrent(result.data, snapshot.revision)
    return { ...saved, changes, removedRecords, receipt: result.receipt, replayed: false,
      savedCollections: [...new Set([...Object.keys(changes), ...removedRecords.map((item) => item.collection)])] }
  }

  async reviewCharacterCard(command: CharacterCardReviewCommand, expectedRevision: string): Promise<CharacterCardReviewWriteResult> {
    return this.withWriteLock(async () => {
      const raw = await readFile(this.storagePath, 'utf-8')
      if (!expectedRevision || revisionForRaw(raw) !== expectedRevision) throw new StorageRevisionConflictError()
      const original = JSON.parse(raw) as AppData
      const updatedAt = new Date().toISOString()
      const character = applyCharacterCardReview(normalizeAppData(original), command, updatedAt)
      // Preserve unrelated records exactly, including fields from a newer import.
      await this.replaceDocument({ ...original, characters: original.characters.map(c =>
        c.id === character.id && c.projectId === character.projectId ? character : c) })
      return { ok: true, storagePath: this.storagePath, revision: await this.readCurrentRevision(),
        updatedAt, savedCollections: ['characters'], character }
    })
  }

  async renameChapterTitles(commit: ChapterTitleCommit, actor: ChapterTitleActor): Promise<ChapterTitleWriteResult> {
    return this.withWriteLock(async () => {
      const { data, state, revision } = await readJsonChapterTitles(this.storagePath, commit.command.projectId)
      const { receipt, replayed } = decideChapterTitleCommit(state, commit, this.storagePath, revision, actor,
        () => jsonTitleVersionIds(data, state.projectId))
      if (!replayed) await this.replaceDocument({ ...data, chapters: applyTitleReceiptToChapters(data.chapters!, receipt),
        chapterTitleReceipts: [...data.chapterTitleReceipts ?? [], receipt] })
      return { ok: true, storagePath: this.storagePath, revision: replayed ? revision : await this.readCurrentRevision(),
        updatedAt: receipt.createdAt, savedCollections: replayed ? [] : ['chapters', 'chapterTitleReceipts'], receipt, replayed }
    })
  }
}
