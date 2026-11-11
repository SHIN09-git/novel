import { ArchiveRestore, FilePlus2, FolderOpen, RotateCw } from 'lucide-react'
import type { LibraryRecoveryAction } from '../../../shared/ipc/ipcTypes'
import type { LibraryRecoveryState } from '../hooks/useLibraryOpen'

const actions = [
  { action: 'retry', label: '重试', icon: RotateCw, hint: '重新打开原书库。如果书库在外接磁盘上，请先连接磁盘。', pending: '正在重试...' },
  { action: 'choose', label: '选择已有书库', icon: FolderOpen, hint: '可选 SQLite 或 JSON。选择 JSON 后，更改将写入所选文件，不会合并到原书库。', pending: '等待选择书库文件...' },
  { action: 'restore', label: '从备份恢复到新文件', icon: ArchiveRestore, hint: '选择备份和新的保存位置，保留原书库。', pending: '正在处理备份恢复...' },
  { action: 'create', label: '新建书库', icon: FilePlus2, hint: '选择新文件的位置并确认后，才会创建空书库。', pending: '等待选择位置并确认新建...' }
] as const

export function LibraryRecoveryView({ recovery, onRecover }: {
  recovery: LibraryRecoveryState
  onRecover: (action: LibraryRecoveryAction) => Promise<void>
}) {
  const pending = recovery.pending === 'loading' ? '正在读取书库...' : actions.find((item) => item.action === recovery.pending)?.pending
  return (
    <main className="library-recovery" aria-labelledby="library-recovery-heading">
      <h1 id="library-recovery-heading">书库未打开</h1>
      <p className="library-recovery-error" role="alert">{recovery.error}</p>
      <ul aria-label="书库恢复操作" aria-busy={Boolean(recovery.pending)}>
        {actions.map(({ action, label, icon: Icon, hint }) => (
          <li key={action}>
            <button className={action === 'retry' ? 'primary-button' : 'secondary-button'} type="button"
              aria-describedby={`recovery-${action}-hint`} disabled={Boolean(recovery.pending)} onClick={() => void onRecover(action)}>
              <Icon size={16} aria-hidden="true" />{label}
            </button>
            <span id={`recovery-${action}-hint`}>{hint}</span>
          </li>
        ))}
      </ul>
      <p className="library-recovery-feedback" role="status">{pending ?? recovery.feedback}</p>
    </main>
  )
}
