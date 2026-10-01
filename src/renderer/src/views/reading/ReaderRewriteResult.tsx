import { lazy, Suspense } from 'react'
import type { Chapter } from '../../../../shared/types'
import { currentReaderTextSelection } from './readerText'
import type { useReaderAiRewrite } from './useReaderAiRewrite'

const AiRewriteResultPanel = lazy(() => import('../../components/AiRewriteResultPanel').then((module) => ({ default: module.AiRewriteResultPanel })))

export function ReaderRewriteResult({ rewrite, chapters, onMessage, clearSelection }: {
  rewrite: ReturnType<typeof useReaderAiRewrite>; chapters: Chapter[]
  onMessage: (message: string) => void; clearSelection: () => void
}) {
  if (!rewrite.candidate) return null
  return <Suspense fallback={null}><AiRewriteResultPanel result={rewrite} onUseSelection={() => {
    const chapter = chapters.find((item) => item.id === rewrite.candidate?.targetKey)
    const target = chapter ? currentReaderTextSelection(chapter.id, chapter.body) : null
    if (!target) return onMessage('请在候选所属章节重新选择一段文字。')
    rewrite.retarget(target)
    clearSelection()
  }} /></Suspense>
}
