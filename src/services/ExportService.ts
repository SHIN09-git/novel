import type { Chapter, Project } from '../shared/types'

function chapterHeading(chapter: Chapter): string {
  return `第 ${chapter.order} 章 ${chapter.title || '未命名'}`
}

export class ExportService {
  static sanitizeFileName(name: string): string {
    const sanitized = name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
    return sanitized || '未命名'
  }

  static formatChapterAsText(chapter: Chapter): string {
    return `${chapterHeading(chapter)}\n\n${chapter.body || ''}`.trimEnd()
  }

  static formatChapterAsMarkdown(chapter: Chapter): string {
    return [
      `# ${chapterHeading(chapter)}`,
      '',
      chapter.body || '',
      '',
      '## 本章摘要',
      '',
      chapter.summary || '',
      '',
      '## 本章结尾钩子',
      '',
      chapter.endingHook || ''
    ].join('\n').trimEnd()
  }

  static formatAllChaptersAsText(chapters: Chapter[]): string {
    return [...chapters]
      .sort((a, b) => a.order - b.order)
      .map((chapter) => this.formatChapterAsText(chapter))
      .join('\n\n---\n\n')
  }

  static formatAllChaptersAsMarkdown(project: Project, chapters: Chapter[]): string {
    const body = [...chapters]
      .sort((a, b) => a.order - b.order)
      .map((chapter) => [`## ${chapterHeading(chapter)}`, '', chapter.body || ''].join('\n').trimEnd())
      .join('\n\n---\n\n')
    return [`# ${project.name || '未命名小说'}`, '', body].join('\n').trimEnd()
  }

  static defaultChapterFileName(chapter: Chapter, extension: 'txt' | 'md'): string {
    return `${this.sanitizeFileName(`第${chapter.order}章-${chapter.title || '未命名'}`)}.${extension}`
  }

  static defaultAllChaptersFileName(project: Project, extension: 'txt' | 'md'): string {
    return `${this.sanitizeFileName(`${project.name || '未命名小说'}-全章节`)}.${extension}`
  }
}
