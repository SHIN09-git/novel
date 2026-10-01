import type { AppData, QuickRewriteDraft, QuickRewriteTarget } from '../shared/types'
import { normalizeQuickRewriteDrafts } from '../shared/normalizers/quickRewrite'

export function quickRewriteTargetKey(target: QuickRewriteTarget): string {
  return JSON.stringify([target.projectId, target.kind, target.targetId])
}

export function quickRewriteDraftTarget(draft: QuickRewriteDraft): QuickRewriteTarget {
  return { projectId: draft.projectId, kind: draft.targetKind,
    targetId: (draft.targetKind === 'revision_version' ? draft.revisionVersionId : draft.chapterId) ?? '' }
}

export function getQuickRewriteDraft(data: AppData, target: QuickRewriteTarget): QuickRewriteDraft | null {
  const key = quickRewriteTargetKey(target)
  return (data.quickRewriteDrafts ?? []).filter((draft) => quickRewriteTargetKey(quickRewriteDraftTarget(draft)) === key)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
}

export function upsertQuickRewriteDraft(data: AppData, input: QuickRewriteDraft): AppData {
  const draft = normalizeQuickRewriteDrafts([input])[0]
  if (!draft) throw new Error('重写候选的原文或选区无效，暂未保存。')
  const target = quickRewriteDraftTarget(draft)
  const chapter = data.chapters.find((item) => item.id === target.targetId && item.projectId === target.projectId)
  const version = data.revisionVersions.find((item) => item.id === target.targetId)
  const session = version && data.revisionSessions.find((item) => item.id === version.sessionId && item.projectId === target.projectId)
  if (!data.projects.some((item) => item.id === target.projectId) || (target.kind === 'revision_version' ? !session : !chapter)) {
    throw new Error('候选对应的项目或正文已不存在，请复制候选后选择有效目标。')
  }
  const existing = getQuickRewriteDraft(data, target)
  const next = { ...draft, id: existing?.id ?? draft.id, createdAt: existing?.createdAt ?? draft.createdAt }
  const key = quickRewriteTargetKey(target)
  return { ...data, quickRewriteDrafts: [next, ...(data.quickRewriteDrafts ?? []).filter((item) =>
    quickRewriteTargetKey(quickRewriteDraftTarget(item)) !== key)] }
}

export function removeQuickRewriteDraft(data: AppData, target: QuickRewriteTarget): AppData {
  const key = quickRewriteTargetKey(target)
  return { ...data, quickRewriteDrafts: (data.quickRewriteDrafts ?? []).filter((item) =>
    quickRewriteTargetKey(quickRewriteDraftTarget(item)) !== key) }
}
