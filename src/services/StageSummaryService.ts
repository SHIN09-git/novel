import type { Chapter, StageSummary } from '../shared/types'

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function line(label: string, value: string): string | null {
  const text = clean(value)
  return text ? `${label}${text}` : null
}

export class StageSummaryService {
  static coveredChapterRange(summary: Pick<StageSummary, 'chapterStart' | 'chapterEnd' | 'coveredChapterRange'>): string {
    return clean(summary.coveredChapterRange) || `第 ${summary.chapterStart}-${summary.chapterEnd} 章`
  }

  static compressedPlotSummary(summary: StageSummary): string {
    return clean(summary.compressedPlotSummary) || clean(summary.plotProgress)
  }

  static formatForPrompt(summary: StageSummary): string {
    return [
      `### ${this.coveredChapterRange(summary)}阶段摘要`,
      line('压缩剧情：', this.compressedPlotSummary(summary)),
      line('不可逆变化：', summary.irreversibleChanges ?? ''),
      line('结尾承接状态：', summary.endingCarryoverState ?? ''),
      line('情绪余味：', summary.emotionalAftertaste ?? ''),
      line('节奏状态：', summary.pacingState ?? '')
    ].filter(Boolean).join('\n')
  }

  static formatForBudget(summary: StageSummary): string {
    return [
      this.coveredChapterRange(summary),
      this.compressedPlotSummary(summary),
      clean(summary.irreversibleChanges),
      clean(summary.endingCarryoverState),
      clean(summary.emotionalAftertaste),
      clean(summary.pacingState)
    ].filter(Boolean).join('\n')
  }

  static createDraftFromChapters(chapters: Chapter[]): Omit<StageSummary, 'id' | 'projectId' | 'createdAt' | 'updatedAt'> {
    const sorted = [...chapters].sort((a, b) => a.order - b.order)
    const chapterStart = sorted[0]?.order ?? 1
    const chapterEnd = sorted[sorted.length - 1]?.order ?? chapterStart
    const summaries = sorted
      .map((chapter) => `第 ${chapter.order} 章《${chapter.title || '未命名'}》：${chapter.summary || chapter.endingHook || '暂无复盘摘要'}`)
      .join('\n')
    return {
      chapterStart,
      chapterEnd,
      coveredChapterRange: `第 ${chapterStart}-${chapterEnd} 章`,
      compressedPlotSummary: summaries,
      irreversibleChanges: sorted.map((chapter) => chapter.newInformation).filter(Boolean).join('\n'),
      endingCarryoverState: sorted.at(-1)?.endingHook || '',
      emotionalAftertaste: '',
      pacingState: '',
      plotProgress: summaries,
      characterRelations: '',
      secrets: '',
      foreshadowingPlanted: '',
      foreshadowingResolved: '',
      unresolvedQuestions: '',
      nextStageDirection: ''
    }
  }
}
