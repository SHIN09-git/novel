import type { Chapter, Project } from '../../../../shared/types'
import { ExportService } from '../../../../services/ExportService'
import { getNovelDirectorClipboardApi, getNovelDirectorExportApi } from '../../platform/novelDirectorBridge'

interface UseChapterExportActionsInput {
  chapters: Chapter[]
  selected: Chapter | null
  bodyDraft: string
  project: Project
  flushBody: () => Promise<boolean>
  setAiMessage: (message: string) => void
}

export function useChapterExportActions({ chapters, selected, bodyDraft, project, flushBody, setAiMessage }: UseChapterExportActionsInput) {
  function selectedChapterWithDraft(): Chapter | null {
    return selected ? { ...selected, body: bodyDraft } : null
  }

  async function copyChapterBody(includeTitle = false) {
    const chapter = selectedChapterWithDraft()
    if (!chapter) return
    if (!chapter.body.trim()) {
      setAiMessage('当前章节正文为空')
      return
    }
    const content = includeTitle ? ExportService.formatChapterAsText(chapter) : chapter.body
    await getNovelDirectorClipboardApi().writeText(content)
    setAiMessage(includeTitle ? '已复制章节标题 + 正文' : '已复制正文')
  }

  async function exportCurrentChapter(format: 'txt' | 'md') {
    const chapter = selectedChapterWithDraft()
    if (!chapter) return
    if (!chapter.body.trim()) {
      setAiMessage('当前章节正文为空')
      return
    }
    if (!(await flushBody())) {
      setAiMessage('当前正文保存失败，已取消导出。')
      return
    }
    const content = format === 'txt' ? ExportService.formatChapterAsText(chapter) : ExportService.formatChapterAsMarkdown(chapter)
    const fileName = ExportService.defaultChapterFileName(chapter, format)
    const result =
      format === 'txt'
        ? await getNovelDirectorExportApi().saveTextFile(content, fileName)
        : await getNovelDirectorExportApi().saveMarkdownFile(content, fileName)
    if (!result.canceled) {
      setAiMessage(`已导出：${result.filePath}`)
    }
  }

  async function exportAllChapters(format: 'txt' | 'md') {
    if (chapters.length === 0) {
      setAiMessage('当前项目暂无章节可导出')
      return
    }
    if (!(await flushBody())) {
      setAiMessage('当前正文保存失败，已取消导出。')
      return
    }
    const currentBody = selected ? { [selected.id]: bodyDraft } : {}
    const exportChapters = chapters.map((chapter) => ({ ...chapter, body: currentBody[chapter.id] ?? chapter.body }))
    const content =
      format === 'txt'
        ? ExportService.formatAllChaptersAsText(exportChapters)
        : ExportService.formatAllChaptersAsMarkdown(project, exportChapters)
    const fileName = ExportService.defaultAllChaptersFileName(project, format)
    const result =
      format === 'txt'
        ? await getNovelDirectorExportApi().saveTextFile(content, fileName)
        : await getNovelDirectorExportApi().saveMarkdownFile(content, fileName)
    if (!result.canceled) {
      setAiMessage(`已导出全部章节：${result.filePath}`)
    }
  }

  return {
    copyChapterBody,
    exportCurrentChapter,
    exportAllChapters
  }
}
