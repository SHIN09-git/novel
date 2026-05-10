import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AppData, ChapterCommitBundle, GenerationRunBundle, RevisionCommitBundle } from '../shared/types'
import type { StorageWriteResult } from '../shared/ipc/ipcTypes'
import { EMPTY_APP_DATA, normalizeAppData, sanitizeAppDataForPersistence } from '../shared/defaults'
import { applyChapterCommitBundleToAppData } from '../services/ChapterCommitBundleService'
import { applyGenerationRunBundleToAppData } from '../services/GenerationRunBundleService'
import { applyRevisionCommitBundleToAppData } from '../services/RevisionCommitBundleService'
import type { StorageService } from './StorageService'

export class JsonStorageService implements StorageService {
  constructor(private readonly storagePath: string) {}

  getStoragePath(): string {
    return this.storagePath
  }

  async load(): Promise<AppData> {
    try {
      const raw = await readFile(this.storagePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppData>
      return normalizeAppData(parsed)
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') {
        await this.save(EMPTY_APP_DATA)
        return EMPTY_APP_DATA
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
      return EMPTY_APP_DATA
    }
  }

  async save(data: AppData): Promise<void> {
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

  async saveGenerationRunBundle(bundle: GenerationRunBundle): Promise<StorageWriteResult> {
    const current = await this.load()
    const next = applyGenerationRunBundleToAppData(current, bundle)
    await this.save(next)
    const updatedAt = new Date().toISOString()
    return {
      ok: true,
      storagePath: this.storagePath,
      revision: updatedAt,
      updatedAt,
      savedCollections: [
        'chapterGenerationJobs',
        'chapterGenerationSteps',
        'generatedChapterDrafts',
        'qualityGateReports',
        'consistencyReviewReports',
        'memoryUpdateCandidates',
        'characterStateChangeCandidates',
        'redundancyReports',
        'generationRunTraces'
      ]
    }
  }

  async saveChapterCommitBundle(bundle: ChapterCommitBundle): Promise<StorageWriteResult> {
    const current = await this.load()
    const next = applyChapterCommitBundleToAppData(current, bundle)
    await this.save(next)
    const updatedAt = new Date().toISOString()
    return {
      ok: true,
      storagePath: this.storagePath,
      revision: updatedAt,
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

  async saveRevisionCommitBundle(bundle: RevisionCommitBundle): Promise<StorageWriteResult> {
    const current = await this.load()
    const next = applyRevisionCommitBundleToAppData(current, bundle)
    await this.save(next)
    const updatedAt = new Date().toISOString()
    return {
      ok: true,
      storagePath: this.storagePath,
      revision: updatedAt,
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
}
