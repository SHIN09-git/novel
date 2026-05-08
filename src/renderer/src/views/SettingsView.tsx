import { useEffect, useState } from 'react'
import type { AppData, AppSettings, DataMergePreview, PromptMode } from '../../../shared/types'
import { useConfirm } from '../components/ConfirmDialog'
import { Field, NumberInput, SelectField, TextInput, Toggle } from '../components/FormFields'
import { Header } from '../components/Layout'
import { deleteApiKey, getApiKeyState, saveApiKey } from '../settings/credentialApi'
import type { ProjectProps } from './viewTypes'

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
      .catch((error) => setStorageMessage(`读取路径配置失败：${String(error)}`))
  }, [])

  useEffect(() => {
    getApiKeyState()
      .then((hasApiKey) => {
        setHasStoredApiKey(hasApiKey)
        if (hasApiKey !== data.settings.hasApiKey || data.settings.apiKey) {
          void updateSettings({ apiKey: '', hasApiKey })
        }
      })
      .catch((error) => setCredentialMessage(`读取 API Key 安全存储状态失败：${String(error)}`))
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
      setCredentialMessage(`API Key 保存失败：${String(error)}`)
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
      setCredentialMessage(`API Key 删除失败：${String(error)}`)
    }
  }

  async function exportData() {
    await window.novelDirector.data.export(data)
  }

  async function importData() {
    const confirmed = await confirmAction({
      title: '导入数据',
      message: '导入会覆盖当前本地数据，确定继续吗？',
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
    await saveData(data)
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
      setStorageMessage(`迁移失败，已回退原路径：${result.error || '未知错误'}`)
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
    await saveData(data)
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
      message: '这会覆盖目标位置已有数据文件。系统会先备份目标文件，但覆盖后目标文件内容会被当前数据替换。确定继续吗？',
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

  return (
    <div className="settings-view">
      <Header title="设置" description={`当前项目：${project.name}`} />
      <div className="settings-grid">
      <section className="panel settings-section">
        <h2>AI API 设置预留</h2>
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
            <input type="number" step="0.1" min="0" max="2" value={data.settings.temperature} onChange={(event) => updateSettings({ temperature: Number(event.target.value) })} />
          </Field>
          <NumberInput label="Max Tokens" value={data.settings.maxTokens} onChange={(maxTokens) => updateSettings({ maxTokens: maxTokens ?? 8000 })} />
        </div>
        <div className="checkbox-grid">
          <Toggle label="启用 AI 自动总结" checked={data.settings.enableAutoSummary} onChange={(enableAutoSummary) => updateSettings({ enableAutoSummary })} />
          <Toggle label="启用 AI 章节诊断" checked={data.settings.enableChapterDiagnostics} onChange={(enableChapterDiagnostics) => updateSettings({ enableChapterDiagnostics })} />
        </div>
      </section>
      <section className="panel settings-section">
        <h2>Prompt 与存储</h2>
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
            label="主题预留"
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
          <button className="ghost-button" onClick={exportData}>
            导出项目数据
          </button>
          <button className="ghost-button" onClick={importData}>
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
          <TextInput label="新数据保存路径（文件夹或 .json 文件）" value={pendingStoragePath} onChange={setPendingStoragePath} />
        </div>
        {storageMessage ? <div className="notice">{storageMessage}</div> : null}
        {mergePreview ? (
          <div className="panel soft-panel">
            <h3>合并预览</h3>
            <p className="muted">
              合并会保留目标数据，并把当前数据中可安全导入的项目、章节、角色和历史记录追加进去。确认前不会写入目标文件。
            </p>
            <div className="metric-grid compact">
              <article>
                <span>当前数据</span>
                <strong>{mergePreview.sourceSummary.projectCount} 项目</strong>
                <small>
                  {mergePreview.sourceSummary.chapterCount} 章 / {mergePreview.sourceSummary.characterCount} 角色 /{' '}
                  {mergePreview.sourceSummary.foreshadowingCount} 伏笔
                </small>
              </article>
              <article>
                <span>目标已有</span>
                <strong>{mergePreview.targetSummary.projectCount} 项目</strong>
                <small>
                  {mergePreview.targetSummary.chapterCount} 章 / {mergePreview.targetSummary.characterCount} 角色 /{' '}
                  {mergePreview.targetSummary.foreshadowingCount} 伏笔
                </small>
              </article>
              <article>
                <span>合并后</span>
                <strong>{mergePreview.mergedSummary.projectCount} 项目</strong>
                <small>
                  {mergePreview.mergedSummary.chapterCount} 章 / {mergePreview.mergedSummary.characterCount} 角色 /{' '}
                  {mergePreview.mergedSummary.foreshadowingCount} 伏笔
                </small>
              </article>
            </div>
            <div className="compact-list">
              <span>新增：{mergePreview.operations.filter((operation) => operation.action === 'add_from_source').length}</span>
              <span>去重：{mergePreview.operations.filter((operation) => operation.action === 'dedupe_same_id').length}</span>
              <span>重命名导入：{mergePreview.operations.filter((operation) => operation.action === 'rename_source_id').length}</span>
              <span>冲突：{mergePreview.conflicts.length}</span>
            </div>
            {mergePreview.warnings.length ? (
              <div className="notice warning">{mergePreview.warnings.slice(0, 3).join('；')}</div>
            ) : null}
            {mergePreview.conflicts.length ? (
              <div className="notice danger">
                存在 {mergePreview.conflicts.length} 个未解决冲突，当前版本不会自动合并。请先导出备份后手动整理。
              </div>
            ) : null}
            <div className="row-actions">
              <button className="primary-button" disabled={!mergePreview.canAutoMerge} onClick={confirmMergeMigration}>
                合并已有数据
              </button>
              <button className="danger-button" onClick={confirmOverwriteMigration}>
                覆盖目标数据
              </button>
              <button className="ghost-button" onClick={cancelMergeMigration}>
                取消迁移
              </button>
            </div>
          </div>
        ) : null}
        <div className="row-actions">
          <button className="ghost-button" onClick={chooseStoragePath}>
            选择保存位置
          </button>
          <button className="ghost-button" onClick={openStorageFolder}>
            打开所在文件夹
          </button>
          <button className="primary-button" onClick={() => migrateStoragePath()}>
            迁移当前数据到新位置
          </button>
          <button className="danger-button" onClick={resetStoragePath}>
            恢复默认路径
          </button>
        </div>
      </section>
      </div>
    </div>
  )
}
