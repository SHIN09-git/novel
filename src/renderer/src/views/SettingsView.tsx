import { useEffect, useState } from 'react'
import type { AppData, AppSettings, DataMergePreview, PromptMode } from '../../../shared/types'
import type { BackupInfo } from '../../../shared/ipc/ipcTypes'
import { getUserFriendlyError } from '../../../shared/errorUtils'
import { useConfirm } from '../components/ConfirmDialog'
import { Field, NumberInput, SelectField, TextInput, Toggle } from '../components/FormFields'
import { Header } from '../components/Layout'
import { deleteApiKey, getApiKeyState, saveApiKey } from '../settings/credentialApi'
import type { ProjectProps } from './viewTypes'

function formatBackupTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function SettingsView({
  data,
  project,
  saveData,
  storagePath,
  setStoragePath,
  setStatus,
  replaceData
}: ProjectProps & {
  storagePath: string
  setStoragePath: (path: string) => void
  setStatus: (message: string) => void
  replaceData: (next: AppData, storagePath?: string) => Promise<void>
}) {
  const confirmAction = useConfirm()
  const [pendingStoragePath, setPendingStoragePath] = useState(storagePath)
  const [defaultStoragePath, setDefaultStoragePath] = useState('')
  const [storageMessage, setStorageMessage] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [hasStoredApiKey, setHasStoredApiKey] = useState(Boolean(data.settings.hasApiKey))
  const [credentialMessage, setCredentialMessage] = useState('')
  const [mergePreview, setMergePreview] = useState<DataMergePreview | null>(null)
  const [mergeSourcePath, setMergeSourcePath] = useState('')
  const [mergeTargetPath, setMergeTargetPath] = useState('')
  const [backupMessage, setBackupMessage] = useState('')
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [logMessage, setLogMessage] = useState('')

  useEffect(() => {
    setPendingStoragePath(storagePath)
  }, [storagePath])

  useEffect(() => {
    window.novelDirector.app
      .getStoragePath()
      .then((result) => {
        setDefaultStoragePath(result.defaultStoragePath)
        setPendingStoragePath(result.storagePath)
      })
      .catch((error) => setStorageMessage(`读取路径配置失败：${getUserFriendlyError(error)}`))
  }, [])

  useEffect(() => {
    getApiKeyState()
      .then((hasApiKey) => {
        setHasStoredApiKey(hasApiKey)
        if (hasApiKey !== data.settings.hasApiKey || data.settings.apiKey) {
          void updateSettings({ apiKey: '', hasApiKey })
        }
      })
      .catch((error) => setCredentialMessage(`读取 API Key 安全存储状态失败：${getUserFriendlyError(error)}`))
    // Check secure credential state once when the settings view opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function updateSettings(patch: Partial<AppSettings>) {
    await saveData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ...patch,
        apiKey: ''
      }
    }))
  }

  async function storeApiKey() {
    setCredentialMessage('')
    if (!apiKeyInput.trim()) {
      setCredentialMessage('请输入新的 API Key。')
      return
    }
    try {
      const hasApiKey = await saveApiKey(apiKeyInput)
      setApiKeyInput('')
      setHasStoredApiKey(hasApiKey)
      await updateSettings({ apiKey: '', hasApiKey })
      setCredentialMessage('API Key 已加密保存。')
    } catch (error) {
      setCredentialMessage(`API Key 保存失败：${getUserFriendlyError(error)}`)
    }
  }

  async function clearApiKey() {
    const confirmed = await confirmAction({
      title: '删除 API Key',
      message: '确定删除已保存的 API Key 吗？删除后远程 AI 调用会不可用，直到重新保存。',
      confirmLabel: '删除密钥',
      tone: 'danger'
    })
    if (!confirmed) return
    try {
      const hasApiKey = await deleteApiKey()
      setApiKeyInput('')
      setHasStoredApiKey(hasApiKey)
      await updateSettings({ apiKey: '', hasApiKey })
      setCredentialMessage('API Key 已删除。')
    } catch (error) {
      setCredentialMessage(`API Key 删除失败：${getUserFriendlyError(error)}`)
    }
  }

  async function exportData() {
    await window.novelDirector.data.export(data)
  }

  async function importData() {
    const confirmed = await confirmAction({
      title: '导入数据',
      message: '导入会覆盖当前本地数据。请确认你已经备份当前数据。',
      confirmLabel: '继续导入',
      tone: 'danger'
    })
    if (!confirmed) return
    const result = await window.novelDirector.data.import()
    if (!result.canceled && result.data) {
      await replaceData(result.data, result.storagePath)
    }
  }

  async function chooseStoragePath() {
    const result = await window.novelDirector.app.selectStoragePath()
    if (!result.canceled && result.storagePath) {
      setPendingStoragePath(result.storagePath)
      setStorageMessage('已选择新路径，点击“迁移当前数据到新位置”后生效。')
    }
  }

  async function migrateStoragePath(targetPath = pendingStoragePath, overwrite = false) {
    setMergePreview(null)
    setStorageMessage('正在保存当前数据并迁移...')
    await saveData((current) => current)
    const result = await window.novelDirector.app.migrateStoragePath(targetPath, data, overwrite)
    if (result.needsOverwrite && result.targetPath) {
      const preview =
        result.mergePreview ??
        (await window.novelDirector.app.createMigrationMergePreview(storagePath, result.targetPath)).preview ??
        null
      setMergeSourcePath(storagePath)
      setMergeTargetPath(result.targetPath)
      setMergePreview(preview)
      setStorageMessage('目标位置已有 Novel Director 数据文件。请选择合并、覆盖或取消。')
      return
    }
    if (!result.ok) {
      setStorageMessage(`迁移失败，已保留原路径：${result.error || '未知错误'}`)
      setStatus(`迁移失败：${result.error || '未知错误'}`)
      return
    }
    setStoragePath(result.storagePath)
    setPendingStoragePath(result.storagePath)
    const backup = result.backupPath ? ` 原路径备份：${result.backupPath}` : ''
    setStorageMessage(`迁移成功，后续读写将使用新路径。${backup}`)
    setStatus('数据路径已迁移')
  }

  async function resetStoragePath() {
    setMergePreview(null)
    setStorageMessage('正在恢复默认路径...')
    await saveData((current) => current)
    const result = await window.novelDirector.app.resetStoragePath(data, false)
    if (result.needsOverwrite && result.targetPath) {
      const preview =
        result.mergePreview ??
        (await window.novelDirector.app.createMigrationMergePreview(storagePath, result.targetPath)).preview ??
        null
      setMergeSourcePath(storagePath)
      setMergeTargetPath(result.targetPath)
      setMergePreview(preview)
      setStorageMessage('默认路径已有 Novel Director 数据文件。请选择合并、覆盖或取消。')
      return
    }
    if (!result.ok) {
      setStorageMessage(`恢复默认路径失败：${result.error || '未知错误'}`)
      return
    }
    setStoragePath(result.storagePath)
    setPendingStoragePath(result.storagePath)
    setStorageMessage(`已恢复默认路径。${result.backupPath ? ` 原路径备份：${result.backupPath}` : ''}`)
  }

  async function confirmMergeMigration() {
    if (!mergePreview || !mergeSourcePath || !mergeTargetPath) return
    if (!mergePreview.canAutoMerge) {
      setStorageMessage('合并预览存在未解决冲突，当前版本不会自动合并。')
      return
    }
    setStorageMessage('正在备份并合并数据文件...')
    const result = await window.novelDirector.app.confirmMigrationMerge(mergeSourcePath, mergeTargetPath)
    if (!result.ok || !result.data) {
      setStorageMessage(`合并迁移失败：${result.error || '未知错误'}`)
      return
    }
    await replaceData(result.data, result.storagePath)
    setStoragePath(result.storagePath)
    setPendingStoragePath(result.storagePath)
    setMergePreview(null)
    setStorageMessage('合并迁移成功。源文件和目标文件已在写入前备份。')
    setStatus('数据路径已合并迁移')
  }

  async function confirmOverwriteMigration() {
    if (!mergeTargetPath) return
    const confirmed = await confirmAction({
      title: '覆盖目标数据',
      message: '这会覆盖目标位置已有数据文件。系统会先备份目标文件，但覆盖后目标内容会被当前数据替换。确定继续吗？',
      confirmLabel: '覆盖目标数据',
      tone: 'danger'
    })
    if (!confirmed) return
    await migrateStoragePath(mergeTargetPath, true)
  }

  function cancelMergeMigration() {
    setMergePreview(null)
    setMergeSourcePath('')
    setMergeTargetPath('')
    setStorageMessage('已取消迁移，当前数据路径未改变。')
  }

  async function openStorageFolder() {
    const result = await window.novelDirector.app.openStorageFolder(storagePath)
    setStorageMessage(result.ok ? '已打开数据文件所在位置。' : `打开失败：${result.error || '未知错误'}`)
  }

  async function createBackup() {
    setBackupMessage('正在创建备份...')
    try {
      const result = await window.novelDirector.backup.create()
      setBackupMessage(`备份已创建：${result.backupPath}`)
      await refreshBackups()
    } catch (error) {
      setBackupMessage(`备份失败：${getUserFriendlyError(error)}`)
    }
  }

  async function refreshBackups() {
    try {
      const result = await window.novelDirector.backup.list()
      setBackups(result.backups)
      if (!result.backups.length) setBackupMessage('暂无备份。')
    } catch (error) {
      setBackupMessage(`读取备份列表失败：${getUserFriendlyError(error)}`)
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
    try {
      const result = await window.novelDirector.backup.restore(backup.path)
      await replaceData(result.data, result.storagePath)
      setBackupMessage(`已恢复备份。${result.preRestoreBackupPath ? `恢复前备份：${result.preRestoreBackupPath}` : ''}`)
      await refreshBackups()
    } catch (error) {
      setBackupMessage(`恢复失败：${getUserFriendlyError(error)}`)
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
    try {
      await window.novelDirector.backup.delete(backup.path)
      setBackupMessage('备份已删除。')
      await refreshBackups()
    } catch (error) {
      setBackupMessage(`删除备份失败：${getUserFriendlyError(error)}`)
    }
  }

  async function openBackupFolder() {
    const result = await window.novelDirector.backup.openFolder()
    setBackupMessage(result.ok ? '已打开备份文件夹。' : `打开备份文件夹失败：${result.error || '未知错误'}`)
  }

  async function openLogFile() {
    try {
      const result = await window.novelDirector.logs.getPath()
      await window.novelDirector.logs.open()
      setLogMessage(`日志文件：${result.logPath}`)
    } catch (error) {
      setLogMessage(`打开日志失败：${getUserFriendlyError(error)}`)
    }
  }

  async function copyLogPath() {
    try {
      const result = await window.novelDirector.logs.getPath()
      await navigator.clipboard.writeText(result.logPath)
      setLogMessage('日志路径已复制到剪贴板。')
    } catch (error) {
      setLogMessage(`复制日志路径失败：${getUserFriendlyError(error)}`)
    }
  }

  return (
    <div className="settings-view">
      <Header title="设置" description={`当前项目：${project.name}`} />
      <div className="settings-grid">
        <section className="panel settings-section">
          <h2>AI API 设置</h2>
          <div className="form-grid compact">
            <SelectField
              label="API Provider"
              value={data.settings.apiProvider}
              onChange={(apiProvider) => updateSettings({ apiProvider })}
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'compatible', label: 'Compatible API' },
                { value: 'local', label: 'Local Model' }
              ]}
            />
            <TextInput label="Base URL" value={data.settings.baseUrl} onChange={(baseUrl) => updateSettings({ baseUrl })} />
            <TextInput label="Model Name" value={data.settings.modelName} onChange={(modelName) => updateSettings({ modelName })} />
            <Field label="API Key">
              <div className="credential-field">
                <div className="muted">{hasStoredApiKey ? '已保存 API Key。出于安全原因不会回显完整密钥。' : '未保存 API Key。'}</div>
                <input
                  type="password"
                  value={apiKeyInput}
                  placeholder={hasStoredApiKey ? '输入新 key 可替换当前保存项' : '输入 API Key 后点击保存'}
                  onChange={(event) => setApiKeyInput(event.target.value)}
                />
                <div className="row-actions">
                  <button className="ghost-button" type="button" onClick={storeApiKey}>
                    {hasStoredApiKey ? '更换 Key' : '保存 Key'}
                  </button>
                  <button className="danger-button" type="button" disabled={!hasStoredApiKey} onClick={clearApiKey}>
                    删除 Key
                  </button>
                </div>
                {credentialMessage ? <div className="notice">{credentialMessage}</div> : null}
              </div>
            </Field>
            <Field label="Temperature">
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={data.settings.temperature}
                onChange={(event) => updateSettings({ temperature: Number(event.target.value) })}
              />
            </Field>
            <NumberInput label="Max Tokens" value={data.settings.maxTokens} onChange={(maxTokens) => updateSettings({ maxTokens: maxTokens ?? 8000 })} />
          </div>
          <div className="checkbox-grid">
            <Toggle label="启用 AI 自动总结" checked={data.settings.enableAutoSummary} onChange={(enableAutoSummary) => updateSettings({ enableAutoSummary })} />
            <Toggle label="启用 AI 章节诊断" checked={data.settings.enableChapterDiagnostics} onChange={(enableChapterDiagnostics) => updateSettings({ enableChapterDiagnostics })} />
          </div>
        </section>

        <section className="panel settings-section">
          <h2>Prompt 与偏好</h2>
          <div className="form-grid compact">
            <NumberInput label="默认 token 预算" value={data.settings.defaultTokenBudget} onChange={(defaultTokenBudget) => updateSettings({ defaultTokenBudget: defaultTokenBudget ?? 16000 })} />
            <SelectField<PromptMode>
              label="默认 Prompt 模式"
              value={data.settings.defaultPromptMode}
              onChange={(defaultPromptMode) => updateSettings({ defaultPromptMode })}
              options={[
                { value: 'light', label: '轻量模式' },
                { value: 'standard', label: '标准模式' },
                { value: 'full', label: '完整模式' }
              ]}
            />
            <SelectField
              label="主题"
              value={data.settings.theme}
              onChange={(theme) => updateSettings({ theme })}
              options={[
                { value: 'system', label: '跟随系统' },
                { value: 'light', label: '浅色' },
                { value: 'dark', label: '深色' }
              ]}
            />
          </div>
          <div className="row-actions">
            <button className="ghost-button" type="button" onClick={exportData}>
              导出项目数据
            </button>
            <button className="ghost-button" type="button" onClick={importData}>
              导入项目数据
            </button>
          </div>
        </section>

        <section className="panel settings-section local-data-section">
          <h2>本地数据</h2>
          <div className="storage-path">
            <span>当前数据文件路径</span>
            <code>{storagePath || '读取中'}</code>
          </div>
          <div className="storage-path">
            <span>默认数据文件路径</span>
            <code>{defaultStoragePath || '读取中'}</code>
          </div>
          <div className="form-grid compact">
            <TextInput label="新数据保存路径（文件夹或本地数据文件）" value={pendingStoragePath} onChange={setPendingStoragePath} />
          </div>
          {storageMessage ? <div className="notice">{storageMessage}</div> : null}
          {mergePreview ? (
            <div className="panel soft-panel">
              <h3>合并预览</h3>
              <p className="muted">合并会保留目标数据，并把当前数据中可安全导入的项目、章节、角色和历史记录追加进去。确认前不会写入目标文件。</p>
              <div className="metric-grid compact">
                <article>
                  <span>当前数据</span>
                  <strong>{mergePreview.sourceSummary.projectCount} 项目</strong>
                  <small>{mergePreview.sourceSummary.chapterCount} 章 / {mergePreview.sourceSummary.characterCount} 角色 / {mergePreview.sourceSummary.foreshadowingCount} 伏笔</small>
                </article>
                <article>
                  <span>目标已有</span>
                  <strong>{mergePreview.targetSummary.projectCount} 项目</strong>
                  <small>{mergePreview.targetSummary.chapterCount} 章 / {mergePreview.targetSummary.characterCount} 角色 / {mergePreview.targetSummary.foreshadowingCount} 伏笔</small>
                </article>
                <article>
                  <span>合并后</span>
                  <strong>{mergePreview.mergedSummary.projectCount} 项目</strong>
                  <small>{mergePreview.mergedSummary.chapterCount} 章 / {mergePreview.mergedSummary.characterCount} 角色 / {mergePreview.mergedSummary.foreshadowingCount} 伏笔</small>
                </article>
              </div>
              <div className="compact-list">
                <span>新增：{mergePreview.operations.filter((operation) => operation.action === 'add_from_source').length}</span>
                <span>去重：{mergePreview.operations.filter((operation) => operation.action === 'dedupe_same_id').length}</span>
                <span>重命名导入：{mergePreview.operations.filter((operation) => operation.action === 'rename_source_id').length}</span>
                <span>冲突：{mergePreview.conflicts.length}</span>
              </div>
              {mergePreview.warnings.length ? <div className="notice warning">{mergePreview.warnings.slice(0, 3).join('；')}</div> : null}
              {mergePreview.conflicts.length ? <div className="notice danger">存在 {mergePreview.conflicts.length} 个未解决冲突，当前版本不会自动合并。</div> : null}
              <div className="row-actions">
                <button className="primary-button" type="button" disabled={!mergePreview.canAutoMerge} onClick={confirmMergeMigration}>
                  合并已有数据
                </button>
                <button className="danger-button" type="button" onClick={confirmOverwriteMigration}>
                  覆盖目标数据
                </button>
                <button className="ghost-button" type="button" onClick={cancelMergeMigration}>
                  取消迁移
                </button>
              </div>
            </div>
          ) : null}
          <div className="row-actions">
            <button className="ghost-button" type="button" onClick={chooseStoragePath}>选择保存位置</button>
            <button className="ghost-button" type="button" onClick={openStorageFolder}>打开所在文件夹</button>
            <button className="primary-button" type="button" onClick={() => migrateStoragePath()}>迁移当前数据到新位置</button>
            <button className="danger-button" type="button" onClick={resetStoragePath}>恢复默认路径</button>
          </div>
        </section>

        <section className="panel settings-section">
          <h2>数据备份</h2>
          <p className="muted">自动备份每天最多创建一次，手动备份可随时创建。恢复备份前会先保存一份恢复前备份。</p>
          {backupMessage ? <div className="notice">{backupMessage}</div> : null}
          <div className="row-actions">
            <button className="primary-button" type="button" onClick={createBackup}>立即备份</button>
            <button className="ghost-button" type="button" onClick={refreshBackups}>查看备份</button>
            <button className="ghost-button" type="button" onClick={openBackupFolder}>打开备份文件夹</button>
          </div>
          {backups.length ? (
            <div className="compact-list backup-list">
              {backups.slice(0, 8).map((backup) => (
                <article className="panel soft-panel" key={backup.path}>
                  <strong>{backup.isAutomatic ? '自动备份' : '手动备份'} · {formatBackupTime(backup.timestamp)}</strong>
                  <small>{formatBytes(backup.size)}</small>
                  <code>{backup.path}</code>
                  <div className="row-actions">
                    <button className="ghost-button" type="button" onClick={() => restoreBackup(backup)}>恢复此备份</button>
                    <button className="danger-button" type="button" onClick={() => deleteBackup(backup)}>删除</button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <section className="panel settings-section">
          <h2>日志与诊断</h2>
          <p className="muted">日志只记录操作摘要和脱敏错误，便于定位本地保存、AI 请求或导入导出问题。</p>
          {logMessage ? <div className="notice">{logMessage}</div> : null}
          <div className="row-actions">
            <button className="ghost-button" type="button" onClick={openLogFile}>查看日志文件</button>
            <button className="ghost-button" type="button" onClick={copyLogPath}>复制日志路径</button>
          </div>
        </section>
      </div>
    </div>
  )
}
