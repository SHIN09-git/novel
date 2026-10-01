import { useEffect, useState } from 'react'
import type { AppData, DataMergePreview } from '../../../../shared/types'
import type { ImportDataStrategy } from '../../../../shared/ipc/ipcTypes'
import { getUserFriendlyError } from '../../../../shared/errorUtils'
import { useConfirm } from '../../components/ConfirmDialog'
import {
  confirmMigrationMerge as confirmMigrationMergeRequest,
  createMigrationMergePreview,
  exportAppData,
  getStoragePath,
  migrateStoragePath as migrateStoragePathRequest,
  openStorageFolder as openStorageFolderRequest,
  resetStoragePath as resetStoragePathRequest,
  selectStoragePath
} from '../../settings/settingsApi'
import type { RunPersistedStorageOperation } from '../../utils/saveDataState'
import { formatMergeConflictSummary } from '../../utils/importFeedback'
import type { ImportDataHandler } from '../viewTypes'

interface UseSettingsStorageOptions {
  storagePath: string
  setStoragePath: (path: string) => void
  setStatus: (message: string) => void
  importData: ImportDataHandler
  runPersistedStorageOperation: RunPersistedStorageOperation
  getCurrentData: () => AppData
}

export function useSettingsStorage(options: UseSettingsStorageOptions) {
  const confirmAction = useConfirm()
  const [pendingStoragePath, setPendingStoragePath] = useState(options.storagePath)
  const [defaultStoragePath, setDefaultStoragePath] = useState('')
  const [storageMessage, setStorageMessage] = useState('')
  const [transferMessage, setTransferMessage] = useState('')
  const [storageBusy, setStorageBusy] = useState(false)
  const [transferBusy, setTransferBusy] = useState(false)
  const [mergePreview, setMergePreview] = useState<DataMergePreview | null>(null)
  const [mergeSourcePath, setMergeSourcePath] = useState('')
  const [mergeTargetPath, setMergeTargetPath] = useState('')

  useEffect(() => {
    setPendingStoragePath(options.storagePath)
  }, [options.storagePath])

  useEffect(() => {
    let active = true
    getStoragePath()
      .then((result) => {
        if (!active) return
        setDefaultStoragePath(result.defaultStoragePath)
        setPendingStoragePath(result.storagePath)
      })
      .catch((error) => {
        if (active) setStorageMessage(`读取路径配置失败：${getUserFriendlyError(error)}`)
      })
    return () => {
      active = false
    }
  }, [])

  function clearMergeState() {
    setMergePreview(null)
    setMergeSourcePath('')
    setMergeTargetPath('')
  }

  async function exportData() {
    setTransferBusy(true)
    setTransferMessage('正在导出项目数据...')
    try {
      const result = await exportAppData(options.getCurrentData())
      setTransferMessage(result.canceled ? '已取消导出。' : `项目数据已导出：${result.filePath ?? '已选择的位置'}`)
    } catch (error) {
      setTransferMessage(`导出失败：${getUserFriendlyError(error)}`)
    } finally {
      setTransferBusy(false)
    }
  }

  async function importData(strategy: ImportDataStrategy) {
    if (strategy === 'replace') {
      const confirmed = await confirmAction({
        title: '覆盖导入数据',
        message: '覆盖导入会用所选 JSON 替换当前本地数据。系统会先创建恢复备份，但当前项目将不再出现在工作台中。确定继续吗？',
        confirmLabel: '覆盖当前数据',
        tone: 'danger'
      })
      if (!confirmed) return
    }
    setTransferBusy(true)
    setTransferMessage(strategy === 'merge' ? '正在读取、校验并安全合并数据...' : '正在读取并覆盖导入数据...')
    try {
      const result = await options.importData(strategy)
      if (result.canceled || !result.data) {
        if (result.mergeBlocked) {
          setTransferMessage(`未写入任何数据：${formatMergeConflictSummary(result.mergePreview)}。可以保留当前数据，或明确选择“覆盖导入”。`)
        } else {
          setTransferMessage('已取消导入。')
        }
        return
      }
      const action = strategy === 'merge' ? '项目数据已安全合并。' : '项目数据已覆盖导入。'
      setTransferMessage(`${action}${result.credentialWarning ? ` ${result.credentialWarning}` : ' API Key 不会随数据文件导入。'}`)
    } catch (error) {
      setTransferMessage(`导入失败：${getUserFriendlyError(error)}`)
    } finally {
      setTransferBusy(false)
    }
  }

  async function chooseStoragePath() {
    setStorageBusy(true)
    try {
      const result = await selectStoragePath()
      if (!result.canceled && result.storagePath) {
        setPendingStoragePath(result.storagePath)
        setStorageMessage('已选择新路径，点击“迁移当前数据到新位置”后生效。')
      }
    } catch (error) {
      setStorageMessage(`选择保存位置失败：${getUserFriendlyError(error)}`)
    } finally {
      setStorageBusy(false)
    }
  }

  async function migrateStoragePath(targetPath = pendingStoragePath, overwrite = false) {
    if (!targetPath.trim()) {
      setStorageMessage('请先选择或输入新的数据保存路径。')
      return
    }
    clearMergeState()
    setStorageBusy(true)
    setStorageMessage('正在保存当前数据并迁移...')
    try {
      const result = await options.runPersistedStorageOperation(
        (current) => migrateStoragePathRequest(targetPath, current, overwrite),
        { persistCurrentFirst: true }
      )
      if (result.needsOverwrite && result.targetPath) {
        const preview = result.mergePreview
          ?? (await createMigrationMergePreview(options.storagePath, result.targetPath)).preview
          ?? null
        setMergeSourcePath(options.storagePath)
        setMergeTargetPath(result.targetPath)
        setMergePreview(preview)
        setStorageMessage('目标位置已有 Novel Director 数据文件。请选择合并、覆盖或取消。')
        return
      }
      if (!result.ok) {
        const errorMessage = result.error || '未知错误'
        setStorageMessage(`迁移失败，已保留原路径：${errorMessage}`)
        options.setStatus(`迁移失败：${errorMessage}`)
        return
      }
      options.setStoragePath(result.storagePath)
      setPendingStoragePath(result.storagePath)
      const backup = result.backupPath ? ` 原路径备份：${result.backupPath}` : ''
      setStorageMessage(`迁移成功，后续读写将使用新路径。${backup}`)
      options.setStatus('数据路径已迁移')
    } catch (error) {
      setStorageMessage(`迁移失败，当前路径未改变：${getUserFriendlyError(error)}`)
    } finally {
      setStorageBusy(false)
    }
  }

  async function resetStoragePath() {
    clearMergeState()
    setStorageBusy(true)
    setStorageMessage('正在恢复默认路径...')
    try {
      const result = await options.runPersistedStorageOperation(
        (current) => resetStoragePathRequest(current, false),
        { persistCurrentFirst: true }
      )
      if (result.needsOverwrite && result.targetPath) {
        const preview = result.mergePreview
          ?? (await createMigrationMergePreview(options.storagePath, result.targetPath)).preview
          ?? null
        setMergeSourcePath(options.storagePath)
        setMergeTargetPath(result.targetPath)
        setMergePreview(preview)
        setStorageMessage('默认路径已有 Novel Director 数据文件。请选择合并、覆盖或取消。')
        return
      }
      if (!result.ok) {
        setStorageMessage(`恢复默认路径失败：${result.error || '未知错误'}`)
        return
      }
      options.setStoragePath(result.storagePath)
      setPendingStoragePath(result.storagePath)
      setStorageMessage(`已恢复默认路径。${result.backupPath ? ` 原路径备份：${result.backupPath}` : ''}`)
    } catch (error) {
      setStorageMessage(`恢复默认路径失败：${getUserFriendlyError(error)}`)
    } finally {
      setStorageBusy(false)
    }
  }

  async function confirmMergeMigration() {
    if (!mergePreview || !mergeSourcePath || !mergeTargetPath) return
    if (!mergePreview.canAutoMerge) {
      setStorageMessage('合并预览存在未解决冲突，当前版本不会自动合并。')
      return
    }
    setStorageBusy(true)
    setStorageMessage('正在备份并合并数据文件...')
    try {
      const result = await options.runPersistedStorageOperation(() =>
        confirmMigrationMergeRequest(mergeSourcePath, mergeTargetPath)
      )
      if (!result.ok || !result.data) {
        setStorageMessage(`合并迁移失败：${result.error || '未知错误'}`)
        return
      }
      options.setStoragePath(result.storagePath)
      setPendingStoragePath(result.storagePath)
      clearMergeState()
      setStorageMessage('合并迁移成功。源文件和目标文件已在写入前备份。')
      options.setStatus('数据路径已合并迁移')
    } catch (error) {
      setStorageMessage(`合并迁移失败：${getUserFriendlyError(error)}`)
    } finally {
      setStorageBusy(false)
    }
  }

  async function confirmOverwriteMigration() {
    if (!mergeTargetPath) return
    const confirmed = await confirmAction({
      title: '覆盖目标数据',
      message: '这会覆盖目标位置已有数据文件。系统会先备份目标文件，但覆盖后目标内容会被当前数据替换。确定继续吗？',
      confirmLabel: '覆盖目标数据',
      tone: 'danger'
    })
    if (confirmed) await migrateStoragePath(mergeTargetPath, true)
  }

  function cancelMergeMigration() {
    clearMergeState()
    setStorageMessage('已取消迁移，当前数据路径未改变。')
  }

  async function openStorageFolder() {
    setStorageBusy(true)
    try {
      const result = await openStorageFolderRequest(options.storagePath)
      setStorageMessage(result.ok ? '已打开数据文件所在位置。' : `打开失败：${result.error || '未知错误'}`)
    } catch (error) {
      setStorageMessage(`打开失败：${getUserFriendlyError(error)}`)
    } finally {
      setStorageBusy(false)
    }
  }

  return {
    cancelMergeMigration,
    chooseStoragePath,
    confirmMergeMigration,
    confirmOverwriteMigration,
    defaultStoragePath,
    exportData,
    importData,
    mergePreview,
    migrateStoragePath,
    openStorageFolder,
    pendingStoragePath,
    resetStoragePath,
    setPendingStoragePath,
    storageBusy,
    storageMessage,
    transferBusy,
    transferMessage
  }
}

export type SettingsStorageController = ReturnType<typeof useSettingsStorage>
