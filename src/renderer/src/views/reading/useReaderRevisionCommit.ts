import { useCallback } from 'react'
import type { AppData, ID, RevisionCommitBundle } from '../../../../shared/types'
import { newId, now } from '../../utils/format'
import type { SaveDataHandler, SaveDataOutcome } from '../../utils/saveDataState'

export type SaveReaderRevisionCommitBundle = (
  buildCommit: (currentData: AppData) => { next: AppData; bundle: RevisionCommitBundle }
) => Promise<void>

interface ReaderRevisionCommitInput {
  chapterId: ID
  expectedBeforeBody: string
  body: string
  revisedBy: RevisionCommitBundle['revisedBy']
  revisionReason: string
  revisionNote: string
}

export function useReaderRevisionCommit({
  projectId,
  saveData,
  saveRevisionCommitBundle
}: {
  projectId: ID
  saveData: SaveDataHandler
  saveRevisionCommitBundle?: SaveReaderRevisionCommitBundle
}) {
  return useCallback(async (input: ReaderRevisionCommitInput): Promise<SaveDataOutcome> => {
    if (!input.body.trim()) return { ok: false, errorMessage: '正文为空，未创建修订版本。' }
    const { applyRevisionCommitBundleToAppData, buildRevisionCommitBundle } = await import(
      '../../../../services/RevisionCommitBundleService'
    )
    const timestamp = now()
    const buildCommit = (current: AppData) => {
      const currentChapter = current.chapters.find(
        (chapter) => chapter.id === input.chapterId && chapter.projectId === projectId
      )
      if (!currentChapter) throw new Error('当前章节已不存在，无法保存修订。')
      if (currentChapter.body !== input.expectedBeforeBody) {
        throw new Error('正文已被其他流程更新，本次阅读页修改未提交。请重新载入最新正文后再试。')
      }
      const bundle = buildRevisionCommitBundle({
        appData: current,
        projectId,
        chapterId: input.chapterId,
        revisionCommitId: newId(),
        newChapterVersionId: newId(),
        revisedAt: timestamp,
        revisedBy: input.revisedBy,
        afterText: input.body,
        revisionReason: input.revisionReason,
        revisionNote: input.revisionNote
      })
      return { bundle, next: applyRevisionCommitBundleToAppData(current, bundle) }
    }

    try {
      if (saveRevisionCommitBundle) {
        await saveRevisionCommitBundle(buildCommit)
        return { ok: true }
      }
      return saveData((current) => buildCommit(current).next)
    } catch (error) {
      return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) }
    }
  }, [projectId, saveData, saveRevisionCommitBundle])
}
