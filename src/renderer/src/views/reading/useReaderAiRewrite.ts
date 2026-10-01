import { useRef, useState } from 'react'
import type { Chapter, Project } from '../../../../shared/types'
import type { AIService } from '../../../../services/AIService'
import type { AiRewriteAction } from '../../components/AiRewriteTextArea'
import { useAiRewriteCandidate } from '../../components/useAiRewriteCandidate'
import { buildReaderChapterContext } from './readerContext'
import type { ReaderRewriteUndo, ReaderSelection } from './readerTypes'
import type { useReaderRevisionCommit } from './useReaderRevisionCommit'

interface UseReaderAiRewriteInput {
  initialChapterId: string | null
  chapters: Chapter[]
  project: Project
  selection: ReaderSelection | null
  customInstruction: string
  getAiService: () => Promise<AIService>
  commitChapterBody: ReturnType<typeof useReaderRevisionCommit>
  clearSelection: () => void
  setMessage: (message: string) => void
  setLastRewrite: (rewrite: ReaderRewriteUndo) => void
  beforeApply?: () => void
}

export function useReaderAiRewrite(input: UseReaderAiRewriteInput) {
  const { chapters, project, selection, customInstruction, getAiService, commitChapterBody,
    clearSelection, setMessage, setLastRewrite, beforeApply } = input
  const chaptersRef = useRef(chapters)
  const [restoreTargetId, setRestoreTargetId] = useState(input.initialChapterId ?? chapters[0]?.id ?? '')
  const projectIdRef = useRef(project.id)
  chaptersRef.current = chapters
  projectIdRef.current = project.id
  const rewrite = useAiRewriteCandidate({
    scopeKey: project.id,
    persistenceTarget: { projectId: project.id, kind: 'chapter', targetId: restoreTargetId },
    getContextForTarget: (key) => {
      const chapter = chaptersRef.current.find((item) => item.id === key)
      return chapter ? buildReaderChapterContext(project, chapter, chaptersRef.current) : ''
    },
    getCurrentBody: (key) => chaptersRef.current.find((chapter) => chapter.id === key && chapter.projectId === project.id)?.body,
    getAiService,
    onStatusChange: setMessage,
    onApply: async (candidate, body) => {
      const chapter = chaptersRef.current.find((item) => item.id === candidate.targetKey && item.projectId === project.id)
      if (!chapter) throw new Error('目标章节已不存在，候选仍保留。')
      beforeApply?.()
      const saved = await commitChapterBody({
        chapterId: chapter.id, expectedBeforeBody: candidate.sourceBody, body,
        revisedBy: candidate.usedAI ? 'user_with_ai' : 'user',
        revisionReason: `阅读页 AI 快速重写：${candidate.label}`,
        revisionNote: candidate.scope === 'chapter' ? '在阅读页明确采用整章重写候选。' : '在阅读页确认并应用局部重写候选。'
      })
      if (!saved.ok) throw new Error(`正文保存失败：${saved.errorMessage}`)
      setLastRewrite({ chapterId: chapter.id, beforeBody: candidate.sourceBody, afterBody: body, label: candidate.label })
      window.getSelection()?.removeAllRanges()
      return true
    }
  })

  async function run(action: AiRewriteAction) {
    if (!selection || rewrite.busyActionId) return
    const chapter = chaptersRef.current.find((item) => item.id === selection.chapterId)
    if (!chapter) return
    const instruction = action.requiresCustomInstruction ? customInstruction.trim() : action.instruction
    if (action.requiresCustomInstruction && !instruction) return setMessage('请先填写自定义重写需求。')
    const projectId = project.id
    await rewrite.run(action, { targetKey: chapter.id, sourceBody: chapter.body, selection,
      context: buildReaderChapterContext(project, chapter, chapters), instruction })
    if (projectIdRef.current === projectId) clearSelection()
  }
  return { ...rewrite, run, selectChapter: (id: string) => { rewrite.cancel(); clearSelection(); setRestoreTargetId(id) },
    cancel: () => { if (rewrite.cancel()) clearSelection() } }
}
