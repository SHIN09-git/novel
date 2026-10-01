import type { AppData, Chapter, ID, Project, RevisionCommitBundle } from '../../../../shared/types'
import {
  buildRestoreRevisionCommitBundle,
  getChapterVersionProtectionReason,
  type ChapterVersionChainEntry
} from '../../../../services/ChapterVersionChainService'
import { applyRevisionCommitBundleToAppData } from '../../../../services/RevisionCommitBundleService'
import { ExportService } from '../../../../services/ExportService'
import type { ConfirmFn } from '../../components/ConfirmDialog'
import { getNovelDirectorClipboardApi } from '../../platform/novelDirectorBridge'
import { formatDate, newId, now } from '../../utils/format'
import type { SaveDataHandler } from '../../utils/saveDataState'

export interface ChapterVersionActionContext {
  chapters: Chapter[]
  selected: Chapter | null
  bodyDraft: string
  project: Project
  saveData: SaveDataHandler
  saveRevisionCommitBundle?: (buildCommit: (currentData: AppData) => { next: AppData; bundle: RevisionCommitBundle }) => Promise<void>
  confirmAction: ConfirmFn
  flushBody: () => Promise<boolean>
  replaceWithPersistedBody: (body: string) => void
  setAiMessage: (message: string) => void
}

export async function restoreChapterVersionEntry(
  context: ChapterVersionActionContext,
  entry: ChapterVersionChainEntry
): Promise<void> {
  const {
    selected,
    bodyDraft,
    project,
    saveData,
    saveRevisionCommitBundle,
    confirmAction,
    flushBody,
    replaceWithPersistedBody,
    setAiMessage
  } = context
  if (!selected || entry.isCurrent) return
  if (entry.body === selected.body && bodyDraft === selected.body) {
    setAiMessage('该历史版本已经是当前正文，无需重复恢复。')
    return
  }
  if (bodyDraft !== selected.body) {
    const saveFirst = await confirmAction({
      title: '存在未保存修改',
      message: '当前编辑区有未保存修改。恢复历史版本前，建议先保存当前正文；保存后系统仍会把恢复动作写成新的版本提交。',
      confirmLabel: '保存并继续'
    })
    if (!saveFirst) return
    if (!(await flushBody())) {
      setAiMessage('当前正文保存失败，已取消恢复历史版本。')
      return
    }
  }
  const confirmed = await confirmAction({
    title: '恢复历史版本',
    message: '系统会创建一个新的“历史版本恢复”提交；当前正文不会被永久删除，之后仍可以从版本链恢复回来。',
    confirmLabel: '创建恢复版本'
  })
  if (!confirmed) return
  const timestamp = now()
  const buildCommit = (current: AppData): { next: AppData; bundle: RevisionCommitBundle } => {
    const bundle = buildRestoreRevisionCommitBundle({
      appData: current,
      projectId: project.id,
      chapterId: selected.id,
      sourceVersionId: entry.id,
      revisionCommitId: newId(),
      newChapterVersionId: newId(),
      restoredAt: timestamp,
      note: `从 ${formatDate(entry.createdAt)} 的历史版本恢复`
    })
    return {
      next: applyRevisionCommitBundleToAppData(current, bundle),
      bundle
    }
  }
  try {
    if (saveRevisionCommitBundle) {
      await saveRevisionCommitBundle(buildCommit)
    } else {
      const saved = await saveData((current) => buildCommit(current).next)
      if (!saved.ok) throw new Error(saved.errorMessage)
    }
    replaceWithPersistedBody(entry.body)
    setAiMessage('已创建新的恢复版本，原版本链已保留。')
  } catch (error) {
    setAiMessage(error instanceof Error ? error.message : '恢复历史版本失败。')
  }
}

export async function deleteChapterVersionEntry(
  context: ChapterVersionActionContext,
  entry: ChapterVersionChainEntry
): Promise<void> {
  if (!entry.version) return
  const confirmed = await context.confirmAction({
    title: '删除历史版本',
    message: '确定删除这个章节历史版本吗？',
    confirmLabel: '删除版本',
    tone: 'danger'
  })
  if (!confirmed) return
  let protectionReason: string | null = null
  const saved = await context.saveData((current) => {
    protectionReason = getChapterVersionProtectionReason(current, entry.id)
    if (protectionReason) return current
    return {
      ...current,
      chapterVersions: current.chapterVersions.filter((item) => item.id !== entry.version?.id)
    }
  })
  if (protectionReason) {
    context.setAiMessage(protectionReason)
    return
  }
  if (!saved.ok) context.setAiMessage(`删除历史版本失败：${saved.errorMessage}`)
}

export async function copyChapterVersionEntry(
  context: ChapterVersionActionContext,
  entry: ChapterVersionChainEntry
): Promise<void> {
  const base = context.selected ?? context.chapters.find((chapter) => chapter.id === entry.chapterId)
  if (!base) return
  await getNovelDirectorClipboardApi().writeText(
    ExportService.formatChapterAsText({ ...base, title: entry.title, body: entry.body })
  )
  context.setAiMessage('已复制历史版本正文')
}
