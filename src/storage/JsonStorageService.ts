import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AppData, CandidateDecisionCommand, CandidateDecisionReceipt, ChapterCommitBundle, GenerationRunBundle, RevisionCommitBundle } from '../shared/types'
import type { CandidateDecisionWriteResult, StorageWriteResult } from '../shared/ipc/ipcTypes'
import { applyCandidateDecisionCommand, candidateDecisionChanges, candidateDecisionRemovals } from '../services/CandidateDecisionService'
import { EMPTY_APP_DATA, normalizeAppData, sanitizeAppDataForPersistence } from '../shared/defaults'
import { redactSensitiveText } from '../shared/errorUtils'
import { applyChapterCommitBundleToAppData } from '../services/ChapterCommitBundleService'
import { applyGenerationRunBundleToAppData } from '../services/GenerationRunBundleService'
import { applyRevisionCommitBundleToAppData } from '../services/RevisionCommitBundleService'
import { withJsonWriteLock } from './jsonWriteLock'
import {
  StorageRevisionConflictError,
  type StorageService,
  type StorageSnapshot
} from './StorageService'

function revisionForRaw(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
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
  constructor(private readonly storagePath: string) {}

  getStoragePath(): string {
    return this.storagePath
  }

  async load(): Promise<AppData> {
    return (await this.loadSnapshot()).data
  }

  async loadSnapshot(): Promise<StorageSnapshot> {
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

  async backupTo(targetPath: string): Promise<void> {
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(this.storagePath, targetPath)
  }

  async saveIfCurrent(data: AppData, expectedRevision?: string): Promise<StorageWriteResult> {
    return withJsonWriteLock(this.storagePath, () => this.writeIfCurrent(data, expectedRevision))
  }

  private async writeIfCurrent(data: AppData, expectedRevision?: string): Promise<StorageWriteResult> {
    const currentRevision = await this.readCurrentRevision()
    if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
      throw new StorageRevisionConflictError()
    }
    await this.writeData(data)
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
      if (code === 'ENOENT') return 'missing'
      throw error
    }
  }

  private async writeData(data: AppData): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true })
    const normalized = sanitizeAppDataForPersistence(data)
    const tmpPath = `${this.storagePath}.tmp`
    const backupPath = `${this.storagePath}.bak`

    await writeFile(tmpPath, JSON.stringify(normalized, null, 2), 'utf-8')

    try {
      await stat(this.storagePath)
      await copyFile(this.storagePath, backupPath)
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') {
        throw error
      }
    }

    await rename(tmpPath, this.storagePath)
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

  async saveChapterCommitBundle(bundle: ChapterCommitBundle, expectedRevision?: string): Promise<StorageWriteResult> {
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
    const persisted = await this.saveIfCurrent(next, snapshot.revision)
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

  async saveRevisionCommitBundle(bundle: RevisionCommitBundle, expectedRevision?: string): Promise<StorageWriteResult> {
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
    const persisted = await this.saveIfCurrent(next, snapshot.revision)
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
}
