import { useEffect, useState } from 'react'
import { EMPTY_APP_DATA } from '../../../shared/defaults'
import type { AppData } from '../../../shared/types'
import { getUserFriendlyError } from '../../../shared/errorUtils'

export function useAppData() {
  const [data, setData] = useState<AppData | null>(null)
  const [storagePath, setStoragePath] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    window.novelDirector.data
      .load()
      .then((result) => {
        setData(result.data)
        setStoragePath(result.storagePath)
      })
      .catch((error) => {
        setData(EMPTY_APP_DATA)
        setStatus(`读取失败：${getUserFriendlyError(error)}`)
      })
  }, [])

  useEffect(() => {
    if (!data) return
    document.documentElement.dataset.theme = data.settings.theme
  }, [data])

  async function saveData(next: AppData) {
    setData(next)
    setStatus('保存中...')
    try {
      const result = await window.novelDirector.data.save(next)
      setStoragePath(result.storagePath)
      setStatus(`已保存 ${new Date().toLocaleTimeString('zh-CN')}`)
    } catch (error) {
      setStatus(`保存失败：${getUserFriendlyError(error)}`)
    }
  }

  function replaceData(next: AppData, nextStoragePath?: string) {
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
