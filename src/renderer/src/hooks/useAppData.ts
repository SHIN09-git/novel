import { useEffect, useRef, useState } from 'react'
import { EMPTY_APP_DATA } from '../../../shared/defaults'
import type { AppData, ChapterCommitBundle, GenerationRunBundle, RevisionCommitBundle } from '../../../shared/types'
import { getUserFriendlyError } from '../../../shared/errorUtils'
import type { StorageSaveResult, StorageWriteResult } from '../../../shared/ipc/ipcTypes'
import { createSaveQueue, type SaveQueue } from '../utils/saveQueue'
import { resolveSaveDataInput, type SaveDataInput } from '../utils/saveDataState'

export type { SaveDataInput }

export type ChapterCommitSaveInput = (currentData: AppData) => { next: AppData; bundle: ChapterCommitBundle }
export type RevisionCommitSaveInput = (currentData: AppData) => { next: AppData; bundle: RevisionCommitBundle }

export function useAppData() {
  const [data, setData] = useState<AppData | null>(null)
  const [storagePath, setStoragePath] = useState('')
  const [status, setStatus] = useState('')
  const saveQueueRef = useRef<SaveQueue<() => Promise<StorageSaveResult | StorageWriteResult>, StorageSaveResult | StorageWriteResult> | null>(null)
  const latestDataRef = useRef<AppData>(EMPTY_APP_DATA)

  useEffect(() => {
    window.novelDirector.data
      .load()
      .then((result) => {
        latestDataRef.current = result.data
        setData(result.data)
        setStoragePath(result.storagePath)
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
    document.documentElement.dataset.theme = data.settings.theme
  }, [data])

  function enqueueStorageWrite(operation: () => Promise<StorageSaveResult | StorageWriteResult>): Promise<StorageSaveResult | StorageWriteResult> {
    if (!saveQueueRef.current) {
      saveQueueRef.current = createSaveQueue((queuedOperation) => queuedOperation())
    }
    return saveQueueRef.current.enqueue(operation)
  }

  async function saveData(nextInput: SaveDataInput) {
    const next = resolveSaveDataInput(latestDataRef.current, nextInput)
    latestDataRef.current = next
    setData(next)
    setStatus('保存中...')
    try {
      const result = await enqueueStorageWrite(() => window.novelDirector.data.save(next))
      setStoragePath(result.storagePath)
      setStatus(result.credentialWarning || `已保存 ${new Date().toLocaleTimeString('zh-CN')}`)
    } catch (error) {
      setStatus(`保存失败：${getUserFriendlyError(error)}`)
    }
  }

  async function saveGenerationRunBundle(nextInput: SaveDataInput, bundle: GenerationRunBundle) {
    const next = resolveSaveDataInput(latestDataRef.current, nextInput)
    latestDataRef.current = next
    setData(next)
    setStatus('正在保存生成运行记录...')
    try {
      const result = await enqueueStorageWrite(async () => {
        if (window.novelDirector.data.saveGenerationRunBundle) {
          try {
            return await window.novelDirector.data.saveGenerationRunBundle(bundle)
          } catch (error) {
            console.warn('GenerationRunBundle save failed; falling back to full AppData save.', error)
          }
        }
        return window.novelDirector.data.save(next)
      })
      setStoragePath(result.storagePath)
      setStatus(result.credentialWarning || `生成运行记录已保存 ${new Date().toLocaleTimeString('zh-CN')}`)
    } catch (error) {
      setStatus(`生成运行记录保存失败：${getUserFriendlyError(error)}`)
      throw error
    }
  }

  async function saveChapterCommitBundle(buildCommit: ChapterCommitSaveInput) {
    const { next, bundle } = buildCommit(latestDataRef.current)
    latestDataRef.current = next
    setData(next)
    setStatus('正在提交正式章节...')
    try {
      const result = await enqueueStorageWrite(async () => {
        if (window.novelDirector.data.saveChapterCommitBundle) {
          try {
            return await window.novelDirector.data.saveChapterCommitBundle(bundle)
          } catch (error) {
            console.warn('ChapterCommitBundle save failed; falling back to full AppData save.', error)
          }
        }
        return window.novelDirector.data.save(next)
      })
      setStoragePath(result.storagePath)
      setStatus(result.credentialWarning || `正式章节已提交 ${new Date().toLocaleTimeString('zh-CN')}`)
    } catch (error) {
      setStatus(`提交正式章节失败：${getUserFriendlyError(error)}`)
      throw error
    }
  }

  async function saveRevisionCommitBundle(buildCommit: RevisionCommitSaveInput) {
    const { next, bundle } = buildCommit(latestDataRef.current)
    latestDataRef.current = next
    setData(next)
    setStatus('正在提交正式修订...')
    try {
      const result = await enqueueStorageWrite(async () => {
        if (window.novelDirector.data.saveRevisionCommitBundle) {
          try {
            return await window.novelDirector.data.saveRevisionCommitBundle(bundle)
          } catch (error) {
            console.warn('RevisionCommitBundle save failed; falling back to full AppData save.', error)
          }
        }
        return window.novelDirector.data.save(next)
      })
      setStoragePath(result.storagePath)
      setStatus(result.credentialWarning || `正式修订已提交 ${new Date().toLocaleTimeString('zh-CN')}`)
    } catch (error) {
      setStatus(`提交正式修订失败：${getUserFriendlyError(error)}`)
      throw error
    }
  }

  function replaceData(next: AppData, nextStoragePath?: string) {
    latestDataRef.current = next
    setData(next)
    if (nextStoragePath) setStoragePath(nextStoragePath)
    setStatus('数据已导入')
  }

  return {
    data,
    storagePath,
    setStoragePath,
    status,
    setStatus,
    saveData,
    saveGenerationRunBundle,
    saveChapterCommitBundle,
    saveRevisionCommitBundle,
    replaceData
  }
}
