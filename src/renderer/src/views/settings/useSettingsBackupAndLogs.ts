import { useState } from 'react'
import type { BackupInfo } from '../../../../shared/ipc/ipcTypes'
import { getUserFriendlyError } from '../../../../shared/errorUtils'
import { useConfirm } from '../../components/ConfirmDialog'
import { getNovelDirectorClipboardApi } from '../../platform/novelDirectorBridge'
import type { RunPersistedStorageOperation } from '../../utils/saveDataState'
import {
  createBackup as createBackupRequest,
  deleteBackup as deleteBackupRequest,
  getLogPath,
  listBackups,
  openBackupFolder as openBackupFolderRequest,
  openLogFile as openLogFileRequest,
  restoreBackup as restoreBackupRequest
} from '../../settings/settingsApi'

interface UseSettingsBackupAndLogsOptions {
  runPersistedStorageOperation: RunPersistedStorageOperation
}

export function useSettingsBackupAndLogs({ runPersistedStorageOperation }: UseSettingsBackupAndLogsOptions) {
  const confirmAction = useConfirm()
  const [backupMessage, setBackupMessage] = useState('')
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [logMessage, setLogMessage] = useState('')
  const [logBusy, setLogBusy] = useState(false)

  async function loadBackups() {
    const result = await listBackups()
    setBackups(result.backups)
    if (!result.backups.length) setBackupMessage('暂无备份。')
  }

  async function createBackup() {
    setBackupBusy(true)
    setBackupMessage('正在创建备份...')
    try {
      const result = await createBackupRequest()
      setBackupMessage(`备份已创建：${result.backupPath}`)
      await loadBackups()
    } catch (error) {
      setBackupMessage(`备份失败：${getUserFriendlyError(error)}`)
    } finally {
      setBackupBusy(false)
    }
  }

  async function refreshBackups() {
    setBackupBusy(true)
    try {
      await loadBackups()
    } catch (error) {
      setBackupMessage(`读取备份列表失败：${getUserFriendlyError(error)}`)
    } finally {
      setBackupBusy(false)
    }
  }

  async function restoreBackup(backup: BackupInfo) {
    const confirmed = await confirmAction({
      title: '恢复备份',
      message: '恢复备份会替换当前本地数据。系统会先创建一份恢复前备份，当前正文不会被静默删除。确定继续吗？',
      confirmLabel: '恢复此备份',
      tone: 'danger'
    })
    if (!confirmed) return
    setBackupBusy(true)
    try {
      const result = await runPersistedStorageOperation(() => restoreBackupRequest(backup.path))
      setBackupMessage(`已恢复备份。${result.preRestoreBackupPath ? `恢复前备份：${result.preRestoreBackupPath}` : ''}`)
      await loadBackups()
    } catch (error) {
      setBackupMessage(`恢复失败：${getUserFriendlyError(error)}`)
    } finally {
      setBackupBusy(false)
    }
  }

  async function deleteBackup(backup: BackupInfo) {
    const confirmed = await confirmAction({
      title: '删除备份',
      message: '确定删除这份备份吗？此操作不会影响当前项目数据。',
      confirmLabel: '删除备份',
      tone: 'danger'
    })
    if (!confirmed) return
    setBackupBusy(true)
    try {
      await deleteBackupRequest(backup.path)
      setBackupMessage('备份已删除。')
      await loadBackups()
    } catch (error) {
      setBackupMessage(`删除备份失败：${getUserFriendlyError(error)}`)
    } finally {
      setBackupBusy(false)
    }
  }

  async function openBackupFolder() {
    setBackupBusy(true)
    try {
      const result = await openBackupFolderRequest()
      setBackupMessage(result.ok ? '已打开备份文件夹。' : `打开备份文件夹失败：${result.error || '未知错误'}`)
    } catch (error) {
      setBackupMessage(`打开备份文件夹失败：${getUserFriendlyError(error)}`)
    } finally {
      setBackupBusy(false)
    }
  }

  async function openLogFile() {
    setLogBusy(true)
    try {
      const result = await getLogPath()
      await openLogFileRequest()
      setLogMessage(`日志文件：${result.logPath}`)
    } catch (error) {
      setLogMessage(`打开日志失败：${getUserFriendlyError(error)}`)
    } finally {
      setLogBusy(false)
    }
  }

  async function copyLogPath() {
    setLogBusy(true)
    try {
      const result = await getLogPath()
      await getNovelDirectorClipboardApi().writeText(result.logPath)
      setLogMessage('日志路径已复制到剪贴板。')
    } catch (error) {
      setLogMessage(`复制日志路径失败：${getUserFriendlyError(error)}`)
    } finally {
      setLogBusy(false)
    }
  }

  return {
    backupBusy,
    backupMessage,
    backups,
    copyLogPath,
    createBackup,
    deleteBackup,
    logBusy,
    logMessage,
    openBackupFolder,
    openLogFile,
    refreshBackups,
    restoreBackup
  }
}

export type SettingsBackupAndLogsController = ReturnType<typeof useSettingsBackupAndLogs>
