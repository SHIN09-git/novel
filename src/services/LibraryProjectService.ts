import type { AppData, Project, WorldManagementReceipt } from '../shared/types'
import { decisionFingerprint } from './candidateDecisionPrimitives'
import { assertProjectWritable, isProjectArchived, setProjectArchived } from './ProjectLifecycleService'

export const PROJECT_TEXT_FIELDS = ['name', 'genre', 'description', 'targetReaders', 'coreAppeal', 'style'] as const
type ProjectTextField = (typeof PROJECT_TEXT_FIELDS)[number]
export type ProjectEdit = { projectId: string; operationId: string; reason: string } & (
  | { action: 'update'; patch: Partial<Record<ProjectTextField, string>> }
  | { action: 'archive' | 'restore' }
  | { action: 'revert'; restoreOperationId: string }
)

export function parseProjectTextPatch(value: unknown): Partial<Record<ProjectTextField, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('项目资料 patch 必须是对象。')
  return Object.fromEntries(Object.entries(value).map(([key, input]) => {
    if (!PROJECT_TEXT_FIELDS.some(field => field === key) || typeof input !== 'string') {
      throw new Error(`不支持的项目资料字段：${key}。`)
    }
    if (key === 'name' && !input.trim()) throw new Error('项目名称不能为空。')
    return [key, key === 'name' ? input.trim() : input]
  }))
}

const changeFields = [...PROJECT_TEXT_FIELDS, 'archivedAt'] as const
function changes(project: Project, next: Project): typeof changeFields[number][] {
  return changeFields.filter(field => (project[field] ?? null) !== (next[field] ?? null))
}

function snapshot(project: Project): Record<string, unknown> {
  return { id: project.id, ...Object.fromEntries(PROJECT_TEXT_FIELDS.map(field => [field, project[field]])),
    archivedAt: project.archivedAt ?? null }
}

function revertedProject(project: Project, source: WorldManagementReceipt, at: string): Project {
  if (!source.before) throw new Error('新建项目请用归档撤回，不删除已有正文与历史。')
  const before = source.before, current = snapshot(project), after = source.after
  const touched = changeFields.filter(key => Object.hasOwn(before, key) && Object.hasOwn(after, key) && before[key] !== after[key])
  if (!touched.length || touched.some(key => current[key] !== after[key])) {
    throw new Error('项目的相关资料已变化，请重新查看历史再决定。')
  }
  const archivedAt = touched.includes('archivedAt') ? before.archivedAt : project.archivedAt
  if (archivedAt != null && (typeof archivedAt !== 'string' || !Number.isFinite(Date.parse(archivedAt)))) {
    throw new Error('无效的历史归档状态。')
  }
  if (!touched.includes('archivedAt')) assertProjectWritable(project)
  return { ...project, ...parseProjectTextPatch(Object.fromEntries(touched.filter(key => key !== 'archivedAt')
    .map(key => [key, before[key]]))), archivedAt: archivedAt ?? null, updatedAt: at }
}

export function planProjectEdit(data: Pick<AppData, 'projects' | 'worldManagementReceipts'>, command: ProjectEdit, at: string) {
  const { projectId, operationId, reason, action } = command
  const project = data.projects.find(book => book.id === projectId)
  if (!project) throw new Error('书库中没有指定项目。')
  const receipts = data.worldManagementReceipts.filter(item => item.projectId === projectId)
  const replay = receipts.find(item => item.operationId === operationId)
  const commandFingerprint = decisionFingerprint(command)
  if (replay) {
    if (replay.entity !== 'project' || replay.commandFingerprint !== commandFingerprint) {
      throw new Error('同一操作编号不能用于不同的项目改动。')
    }
    return { next: project, receipt: replay, replayed: true }
  }
  let next: Project
  if (action === 'revert') {
    const source = receipts.find(item => item.operationId === command.restoreOperationId && item.entity === 'project' && item.targetId === projectId)
    if (!source) throw new Error('没有可回退的项目操作。')
    next = revertedProject(project, source, at)
  } else if (action === 'update') {
    assertProjectWritable(project)
    next = { ...project, ...parseProjectTextPatch(command.patch), updatedAt: at }
  } else {
    if (isProjectArchived(project) === (action === 'archive')) throw new Error(action === 'archive' ? '项目已经归档。' : '项目未归档。')
    next = setProjectArchived(project, action === 'archive', at)
  }
  if (!changes(project, next).length) throw new Error('没有项目资料改动。')
  const before = snapshot(project), after = snapshot(next)
  const receipt: Omit<WorldManagementReceipt, 'authorizationGrantId'> = {
    id: `library-project-${decisionFingerprint([projectId, operationId])}`, projectId, operationId, entity: 'project',
    action: action === 'revert' ? 'restore' : action, targetId: projectId, commandFingerprint,
    previewFingerprint: decisionFingerprint({ commandFingerprint, before }), before, after, createdAt: at, schemaVersion: 1,
    source: { kind: 'agent_director', reason, ...(action === 'revert' ? { restoredFromOperationId: command.restoreOperationId } : {}) }
  }
  return { next, receipt, replayed: false }
}
