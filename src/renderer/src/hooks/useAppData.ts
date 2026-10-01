import { useEffect, useRef, useState } from 'react'
import { EMPTY_APP_DATA } from '../../../shared/defaults'
import type { AppData, CandidateDecisionCommand, ChapterCommitBundle, GenerationRunBundle, RevisionCommitBundle } from '../../../shared/types'
import { getUserFriendlyError } from '../../../shared/errorUtils'
import type { StorageSaveResult, StorageWriteResult } from '../../../shared/ipc/ipcTypes'
import type { ImportDataResult, ImportDataStrategy } from '../../../shared/ipc/ipcTypes'
import { createOperationQueue, type OperationQueue } from '../utils/saveQueue'
import {
  resolveSaveDataInput,
  type RunPersistedStorageOperation,
  type SaveDataHandler,
  type SaveDataInput,
  type SaveDataOutcome
} from '../utils/saveDataState'
import { getNovelDirectorDataApi } from '../platform/novelDirectorBridge'

export type { SaveDataHandler, SaveDataInput, SaveDataOutcome }

export type ChapterCommitSaveInput = (currentData: AppData) => { next: AppData; bundle: ChapterCommitBundle }
export type RevisionCommitSaveInput = (currentData: AppData) => { next: AppData; bundle: RevisionCommitBundle }

function isStorageRevisionConflict(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'STORAGE_REVISION_CONFLICT'
  )
}

export function useAppData() {
  const [data, setData] = useState<AppData | null>(null)
  const [storagePath, setStoragePath] = useState('')
  const [status, setStatus] = useState('')
  const [hasStorageConflict, setHasStorageConflict] = useState(false)
  const saveQueueRef = useRef<OperationQueue | null>(null)
  const latestDataRef = useRef<AppData>(EMPTY_APP_DATA)

  useEffect(() => {
    let dataApi: ReturnType<typeof getNovelDirectorDataApi>
    try {
      dataApi = getNovelDirectorDataApi()
    } catch (error) {
      latestDataRef.current = EMPTY_APP_DATA
      setData(EMPTY_APP_DATA)
      setStatus(`读取数据失败：${getUserFriendlyError(error)}`)
      return
    }

    dataApi
      .load()
      .then((result) => {
        latestDataRef.current = result.data
        setData(result.data)
        setStoragePath(result.storagePath)
        setHasStorageConflict(false)
        if (result.credentialWarning) setStatus(result.credentialWarning)
      })
      .catch((error) => {
        latestDataRef.current = EMPTY_APP_DATA
        setData(EMPTY_APP_DATA)
        setStatus(`读取数据失败：${getUserFriendlyError(error)}`)
      })
  }, [])

  useEffect(() => {
    if (!data) return
    applyTheme(data.settings.theme)
  }, [data])

  function enqueueStorageWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (!saveQueueRef.current) {
      saveQueueRef.current = createOperationQueue()
    }
    return saveQueueRef.current.enqueue(operation)
  }

  function getCurrentData(): AppData {
    return latestDataRef.current
  }

  function commitPersistedData(next: AppData) {
    latestDataRef.current = next
    setData(next)
    setHasStorageConflict(false)
  }

  const saveData: SaveDataHandler = async (nextInput): Promise<SaveDataOutcome> => {
    setStatus('保存中...')
    try {
      const result = await enqueueStorageWrite(async () => {
        const next = resolveSaveDataInput(latestDataRef.current, nextInput)
        const persisted = await getNovelDirectorDataApi().save(next)
        commitPersistedData(next)
        return persisted
      })
      setStoragePath(result.storagePath)
      setStatus(result.credentialWarning || `已保存 ${new Date().toLocaleTimeString('zh-CN')}`)
      return { ok: true }
    } catch (error) {
      const errorMessage = getUserFriendlyError(error)
      if (isStorageRevisionConflict(error)) setHasStorageConflict(true)
      setStatus(`保存失败：${errorMessage}`)
      return { ok: false, errorMessage }
    }
  }

  async function saveGenerationRunBundle(nextInput: SaveDataInput, bundle: GenerationRunBundle) {
    setStatus('正在保存生成运行记录...')
    try {
      const result = await enqueueStorageWrite(async () => {
        const next = resolveSaveDataInput(latestDataRef.current, nextInput)
        const dataApi = getNovelDirectorDataApi()
        let persisted: StorageSaveResult | StorageWriteResult
        if (dataApi.saveGenerationRunBundle) {
          persisted = await dataApi.saveGenerationRunBundle(bundle)
          commitPersistedData(next)
          return persisted
        }
        persisted = await dataApi.save(next)
        commitPersistedData(next)
        return persisted
      })
      setStoragePath(result.storagePath)
      setStatus(result.credentialWarning || `生成运行记录已保存 ${new Date().toLocaleTimeString('zh-CN')}`)
    } catch (error) {
      if (isStorageRevisionConflict(error)) setHasStorageConflict(true)
      setStatus(`生成运行记录保存失败：${getUserFriendlyError(error)}`)
      throw error
    }
  }

  async function saveChapterCommitBundle(buildCommit: ChapterCommitSaveInput) {
    setStatus('正在提交正式章节...')
    try {
      const result = await enqueueStorageWrite(async () => {
        const { next, bundle } = buildCommit(latestDataRef.current)
        const dataApi = getNovelDirectorDataApi()
        let persisted: StorageSaveResult | StorageWriteResult
        if (dataApi.saveChapterCommitBundle) {
          persisted = await dataApi.saveChapterCommitBundle(bundle)
          commitPersistedData(next)
          return persisted
        }
        persisted = await dataApi.save(next)
        commitPersistedData(next)
        return persisted
      })
      setStoragePath(result.storagePath)
      setStatus(result.credentialWarning || `正式章节已提交 ${new Date().toLocaleTimeString('zh-CN')}`)
    } catch (error) {
      if (isStorageRevisionConflict(error)) setHasStorageConflict(true)
      setStatus(`提交正式章节失败：${getUserFriendlyError(error)}`)
      throw error
    }
  }

  async function saveRevisionCommitBundle(buildCommit: RevisionCommitSaveInput) {
    setStatus('正在提交正式修订...')
    try {
      const result = await enqueueStorageWrite(async () => {
        const { next, bundle } = buildCommit(latestDataRef.current)
        const dataApi = getNovelDirectorDataApi()
        let persisted: StorageSaveResult | StorageWriteResult
        if (dataApi.saveRevisionCommitBundle) {
          persisted = await dataApi.saveRevisionCommitBundle(bundle)
          commitPersistedData(next)
          return persisted
        }
        persisted = await dataApi.save(next)
        commitPersistedData(next)
        return persisted
      })
      setStoragePath(result.storagePath)
      setStatus(result.credentialWarning || `正式修订已提交 ${new Date().toLocaleTimeString('zh-CN')}`)
    } catch (error) {
      if (isStorageRevisionConflict(error)) setHasStorageConflict(true)
      setStatus(`提交正式修订失败：${getUserFriendlyError(error)}`)
      throw error
    }
  }

  const runPersistedStorageOperation: RunPersistedStorageOperation = async (operation, options = {}) => {
    try {
      const result = await enqueueStorageWrite(async () => {
        const current = latestDataRef.current
        if (options.persistCurrentFirst) {
          await getNovelDirectorDataApi().save(current)
        }
        const persisted = await operation(current)
        if (persisted.data) commitPersistedData(persisted.data)
        return persisted
      })
      if (result.storagePath) setStoragePath(result.storagePath)
      if (result.credentialWarning) setStatus(result.credentialWarning)
      return result
    } catch (error) {
      if (isStorageRevisionConflict(error)) setHasStorageConflict(true)
      throw error
    }
  }

  async function executeCandidateDecision(command: CandidateDecisionCommand): Promise<void> {
    setStatus('正在保存候选决定...')
    try {
      const result = await enqueueStorageWrite(async () => {
        const api = getNovelDirectorDataApi()
        const { applyCandidateDecisionChanges, applyCandidateDecisionCommand } = await import('../../../services/CandidateDecisionService')
        if (api.executeCandidateDecision) {
          const saved = await api.executeCandidateDecision(command)
          // A replay may follow an external write. Reload instead of applying an old response patch.
          if (saved.replayed) commitPersistedData((await api.load()).data)
          else commitPersistedData(applyCandidateDecisionChanges(latestDataRef.current, saved.changes, saved.removedRecords ?? []))
          return saved
        }
        const applied = applyCandidateDecisionCommand(latestDataRef.current, command)
        const saved = await api.save(applied.data)
        commitPersistedData(applied.data)
        return saved
      })
      setStoragePath(result.storagePath)
      setStatus('候选决定已保存')
    } catch (error) {
      if (isStorageRevisionConflict(error)) setHasStorageConflict(true)
      setStatus(`候选决定保存失败：${getUserFriendlyError(error)}`)
      throw error
    }
  }

  async function importData(strategy: ImportDataStrategy): Promise<ImportDataResult> {
    setStatus(strategy === 'merge' ? '正在安全合并导入数据...' : '正在覆盖导入数据...')
    try {
      const result = await enqueueStorageWrite(async () => {
        const imported = await getNovelDirectorDataApi().import(strategy)
        if (imported.data) commitPersistedData(imported.data)
        return imported
      })
      if (result.storagePath) setStoragePath(result.storagePath)
      if (result.canceled) {
        setStatus('已取消导入')
      } else if (result.mergeBlocked) {
        setStatus(`合并未写入：发现 ${result.mergePreview?.conflicts.length ?? 0} 个需要人工处理的冲突`)
      } else {
        setStatus(result.credentialWarning || (strategy === 'merge' ? '数据已安全合并' : '数据已覆盖导入'))
      }
      return result
    } catch (error) {
      if (isStorageRevisionConflict(error)) setHasStorageConflict(true)
      setStatus(`数据导入失败：${getUserFriendlyError(error)}`)
      throw error
    }
  }

  async function reloadData() {
    setStatus('正在重新加载最新本地数据...')
    try {
      const result = await enqueueStorageWrite(async () => {
        const loaded = await getNovelDirectorDataApi().load()
        commitPersistedData(loaded.data)
        return {
          ok: true as const,
          storagePath: loaded.storagePath,
          credentialWarning: loaded.credentialWarning
        }
      })
      setStoragePath(result.storagePath)
      setHasStorageConflict(false)
      setStatus(result.credentialWarning || '已重新加载最新本地数据')
      return { ok: true as const }
    } catch (error) {
      const errorMessage = getUserFriendlyError(error)
      setStatus(`重新加载失败：${errorMessage}`)
      return { ok: false as const, errorMessage }
    }
  }

  return {
    data,
    storagePath,
    setStoragePath,
    status,
    hasStorageConflict,
    setStatus,
    saveData,
    saveGenerationRunBundle,
    saveChapterCommitBundle,
    saveRevisionCommitBundle,
    executeCandidateDecision,
    runPersistedStorageOperation,
    importData,
    reloadData,
    getCurrentData
  }
}

// Cross-fades an explicit theme change; the first paint and reduced-motion users switch instantly.
function applyTheme(theme: string) {
  const root = document.documentElement
  if (root.dataset.theme === theme) return
  const isFirstPaint = root.dataset.theme === undefined
  const startViewTransition = (document as Document & { startViewTransition?: (update: () => void) => unknown }).startViewTransition
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (isFirstPaint || reduceMotion || typeof startViewTransition !== 'function') {
    root.dataset.theme = theme
    return
  }
  startViewTransition.call(document, () => {
    root.dataset.theme = theme
  })
}
