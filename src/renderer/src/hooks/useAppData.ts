import { useEffect, useRef, useState } from 'react'
import { EMPTY_APP_DATA } from '../../../shared/defaults'
import type { AppData } from '../../../shared/types'
import { getUserFriendlyError } from '../../../shared/errorUtils'
import type { StorageSaveResult } from '../../../shared/ipc/ipcTypes'
import { createSaveQueue, type SaveQueue } from '../utils/saveQueue'
import { resolveSaveDataInput, type SaveDataInput } from '../utils/saveDataState'

export type { SaveDataInput }

export function useAppData() {
  const [data, setData] = useState<AppData | null>(null)
  const [storagePath, setStoragePath] = useState('')
  const [status, setStatus] = useState('')
  const saveQueueRef = useRef<SaveQueue<AppData, StorageSaveResult> | null>(null)
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
        setStatus(`读取失败：${getUserFriendlyError(error)}`)
      })
  }, [])

  useEffect(() => {
    if (!data) return
    document.documentElement.dataset.theme = data.settings.theme
  }, [data])

  function enqueueSave(next: AppData): Promise<StorageSaveResult> {
    if (!saveQueueRef.current) {
      saveQueueRef.current = createSaveQueue((queuedData) => window.novelDirector.data.save(queuedData))
    }
    return saveQueueRef.current.enqueue(next)
  }

  async function saveData(nextInput: SaveDataInput) {
    const next = resolveSaveDataInput(latestDataRef.current, nextInput)
    latestDataRef.current = next
    setData(next)
    setStatus('保存中...')
    try {
      const result = await enqueueSave(next)
      setStoragePath(result.storagePath)
      setStatus(result.credentialWarning || `已保存 ${new Date().toLocaleTimeString('zh-CN')}`)
    } catch (error) {
      setStatus(`保存失败：${getUserFriendlyError(error)}`)
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
    replaceData
  }
}
