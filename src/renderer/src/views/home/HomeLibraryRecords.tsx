import { useState } from 'react'
import { ArchiveRestore } from 'lucide-react'
import type { Project, WorldManagementReceipt } from '../../../../shared/types'
import { formatDate } from '../../utils/format'

export function ArchivedProjects({ projects, disabled, onRestore }: {
  projects: Project[]
  disabled: boolean
  onRestore: (project: Project) => void
}) {
  if (!projects.length) return null
  return <details className="home-library-records">
    <summary>已归档项目 ({projects.length})</summary>
    {projects.map(project => <div className="home-library-record" key={project.id}>
      <div><strong>{project.name}</strong><small>归档于 {formatDate(project.archivedAt ?? '')}</small></div>
      <button className="ghost-button" type="button" disabled={disabled} onClick={() => onRestore(project)}>
        <ArchiveRestore size={16} aria-hidden="true" /> 恢复项目
      </button>
    </div>)}
  </details>
}

const fields = { name: '书名', genre: '题材', description: '简介', targetReaders: '目标读者', coreAppeal: '核心爽点',
  style: '整体风格', archivedAt: '归档状态' } as const
const labels = { create: '开书', update: '修改项目资料', archive: '归档', restore: '恢复' } as const

export function LibraryProjectHistory({ projects, receipts }: { projects: Project[]; receipts: WorldManagementReceipt[] }) {
  const [limit, setLimit] = useState(10)
  const records = receipts.filter(item => item.entity === 'project')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  if (!records.length) return null
  const names = new Map(projects.map(project => [project.id, project.name]))
  return <details className="home-library-records">
    <summary>书库改动记录 ({records.length})</summary>
    {records.slice(0, limit).map(record => {
      const title = names.get(record.projectId) ?? String(record.after.name ?? '未命名项目')
      const kind = record.source.restoredFromOperationId ? '回退' : labels[record.action as keyof typeof labels] ?? '修改'
      return <details className="home-library-entry" key={record.id}>
        <summary>{title} · {kind} · {formatDate(record.createdAt)}</summary>
        <p>{record.source.reason}</p>
        {Object.entries(fields).filter(([key]) => (record.before?.[key] ?? '') !== (record.after[key] ?? ''))
          .map(([key, label]) => <div className="home-library-diff" key={key}>
            <strong>{label}</strong>
            <div>改前：{String(record.before?.[key] ?? (key === 'archivedAt' ? '未归档' : '未填写'))}</div>
            <div>改后：{String(record.after[key] ?? (key === 'archivedAt' ? '未归档' : '未填写'))}</div>
          </div>)}
        <small>操作编号：{record.operationId}{record.source.restoredFromOperationId ? ` · 来源：${record.source.restoredFromOperationId}` : ''}</small>
      </details>
    })}
    {records.length > limit ? <button className="ghost-button" type="button" onClick={() => setLimit(count => count + 10)}>显示更多</button> : null}
  </details>
}
