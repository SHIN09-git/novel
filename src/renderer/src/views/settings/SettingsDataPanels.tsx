import type { BackupInfo } from '../../../../shared/ipc/ipcTypes'
import { TextInput } from '../../components/FormFields'
import type { SettingsBackupAndLogsController } from './useSettingsBackupAndLogs'
import type { SettingsStorageController } from './useSettingsStorage'

function formatBackupTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

interface SettingsDataPanelsProps {
  storagePath: string
  storage: SettingsStorageController
  backupAndLogs: SettingsBackupAndLogsController
}

function BackupRow({
  backup,
  busy,
  onRestore,
  onDelete
}: {
  backup: BackupInfo
  busy: boolean
  onRestore: () => void
  onDelete: () => void
}) {
  return (
    <article className="settings-backup-row">
      <div>
        <strong>{backup.isAutomatic ? '自动备份' : '手动备份'} · {formatBackupTime(backup.timestamp)}</strong>
        <small>{formatBytes(backup.size)}</small>
      </div>
      <code title={backup.path}>{backup.path}</code>
      <div className="row-actions">
        <button className="ghost-button" type="button" disabled={busy} onClick={onRestore}>恢复此备份</button>
        <button className="danger-button" type="button" disabled={busy} onClick={onDelete}>删除</button>
      </div>
    </article>
  )
}

export function SettingsDataPanels({ storagePath, storage, backupAndLogs }: SettingsDataPanelsProps) {
  const mergePreview = storage.mergePreview
  return (
    <>
      <section className="settings-data-section settings-transfer-section">
        <div className="settings-data-section-heading">
          <div>
            <h2>项目导入与导出</h2>
            <p className="muted">数据文件不包含 API Key。合并导入会尽量保留当前项目与历史记录。</p>
          </div>
        </div>
        {storage.transferMessage ? <div className="notice">{storage.transferMessage}</div> : null}
        <div className="row-actions">
          <button className="ghost-button" type="button" disabled={storage.transferBusy} onClick={() => void storage.exportData()}>
            导出项目数据
          </button>
          <button className="ghost-button" type="button" disabled={storage.transferBusy} onClick={() => void storage.importData('merge')}>
            合并导入 JSON
          </button>
          <button className="danger-button" type="button" disabled={storage.transferBusy} onClick={() => void storage.importData('replace')}>
            覆盖导入 JSON
          </button>
        </div>
      </section>

      <section className="settings-data-section local-data-section">
        <div className="settings-data-section-heading">
          <div>
            <h2>本地数据位置</h2>
            <p className="muted">迁移前会先保存当前数据；目标位置已有数据时可先查看合并预览。</p>
          </div>
        </div>
        <div className="storage-path">
          <span>当前数据文件路径</span>
          <code>{storagePath || '读取中'}</code>
        </div>
        <div className="storage-path">
          <span>默认数据文件路径</span>
          <code>{storage.defaultStoragePath || '读取中'}</code>
        </div>
        <div className="form-grid compact">
          <TextInput
            label="新数据保存路径（文件夹或本地数据文件）"
            value={storage.pendingStoragePath}
            onChange={storage.setPendingStoragePath}
          />
        </div>
        {storage.storageMessage ? <div className="notice">{storage.storageMessage}</div> : null}
        {mergePreview ? (
          <div className="settings-merge-preview">
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
              <button
                className="primary-button"
                type="button"
                disabled={!mergePreview.canAutoMerge || storage.storageBusy}
                onClick={() => void storage.confirmMergeMigration()}
              >
                合并已有数据
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={storage.storageBusy}
                onClick={() => void storage.confirmOverwriteMigration()}
              >
                覆盖目标数据
              </button>
              <button className="ghost-button" type="button" disabled={storage.storageBusy} onClick={storage.cancelMergeMigration}>
                取消迁移
              </button>
            </div>
          </div>
        ) : null}
        <div className="row-actions">
          <button className="ghost-button" type="button" disabled={storage.storageBusy} onClick={() => void storage.chooseStoragePath()}>选择保存位置</button>
          <button className="ghost-button" type="button" disabled={storage.storageBusy} onClick={() => void storage.openStorageFolder()}>打开所在文件夹</button>
          <button className="primary-button" type="button" disabled={storage.storageBusy} onClick={() => void storage.migrateStoragePath()}>迁移当前数据到新位置</button>
          <button className="danger-button" type="button" disabled={storage.storageBusy} onClick={() => void storage.resetStoragePath()}>恢复默认路径</button>
        </div>
      </section>

      <section className="settings-data-section">
        <div className="settings-data-section-heading">
          <div>
            <h2>数据备份</h2>
            <p className="muted">自动备份每天最多创建一次，手动备份可随时创建。恢复前会再保存一份恢复前备份。</p>
          </div>
        </div>
        {backupAndLogs.backupMessage ? <div className="notice">{backupAndLogs.backupMessage}</div> : null}
        <div className="row-actions">
          <button className="primary-button" type="button" disabled={backupAndLogs.backupBusy} onClick={() => void backupAndLogs.createBackup()}>立即备份</button>
          <button className="ghost-button" type="button" disabled={backupAndLogs.backupBusy} onClick={() => void backupAndLogs.refreshBackups()}>查看备份</button>
          <button className="ghost-button" type="button" disabled={backupAndLogs.backupBusy} onClick={() => void backupAndLogs.openBackupFolder()}>打开备份文件夹</button>
        </div>
        {backupAndLogs.backups.length ? (
          <div className="compact-list backup-list">
            {backupAndLogs.backups.slice(0, 8).map((backup) => (
              <BackupRow
                key={backup.path}
                backup={backup}
                busy={backupAndLogs.backupBusy}
                onRestore={() => void backupAndLogs.restoreBackup(backup)}
                onDelete={() => void backupAndLogs.deleteBackup(backup)}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="settings-data-section settings-diagnostics-section">
        <div className="settings-data-section-heading">
          <div>
            <h2>日志与诊断</h2>
            <p className="muted">日志只记录操作摘要和脱敏错误，便于定位本地保存、AI 请求或导入导出问题。</p>
          </div>
        </div>
        {backupAndLogs.logMessage ? <div className="notice">{backupAndLogs.logMessage}</div> : null}
        <div className="row-actions">
          <button className="ghost-button" type="button" disabled={backupAndLogs.logBusy} onClick={() => void backupAndLogs.openLogFile()}>查看日志文件</button>
          <button className="ghost-button" type="button" disabled={backupAndLogs.logBusy} onClick={() => void backupAndLogs.copyLogPath()}>复制日志路径</button>
        </div>
      </section>
    </>
  )
}

export function SettingsDataDisclosure(props: SettingsDataPanelsProps) {
  return (
    <details className="settings-data-disclosure">
      <summary>
        <span className="settings-data-disclosure-heading">
          <strong>数据与备份</strong>
          <small>导入导出、本地数据位置、迁移、备份与诊断</small>
        </span>
        <span className="settings-data-disclosure-action" aria-hidden="true">展开</span>
      </summary>
      <div className="settings-data-disclosure-content">
        <SettingsDataPanels {...props} />
      </div>
    </details>
  )
}
