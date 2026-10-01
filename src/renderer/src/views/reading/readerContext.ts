import type { Chapter, Project } from '../../../../shared/types'

export function buildReaderChapterContext(project: Project, chapter: Chapter, chapters: Chapter[]): string {
  const previous = chapters
    .filter((item) => item.order < chapter.order)
    .slice(-3)
    .map((item) => `第 ${item.order} 章《${item.title || '未命名'}》：${item.summary || '无摘要'}`)
    .join('\n')
  const next = chapters
    .filter((item) => item.order > chapter.order)
    .slice(0, 2)
    .map((item) => `第 ${item.order} 章《${item.title || '未命名'}》：${item.summary || '无摘要'}`)
    .join('\n')
  return [
    `项目：${project.name}`,
    `题材：${project.genre || '未设置'}`,
    `核心爽点：${project.coreAppeal || '未设置'}`,
    `当前章节：第 ${chapter.order} 章《${chapter.title || '未命名'}》`,
    chapter.summary ? `本章摘要：${chapter.summary}` : '',
    previous ? `前三章摘要：\n${previous}` : '',
    next ? `后续章节摘要：\n${next}` : '',
    '重写要求：只改写用户选中的片段，不新增未铺垫设定，不改变既有剧情事实。'
  ]
    .filter(Boolean)
    .join('\n')
}
