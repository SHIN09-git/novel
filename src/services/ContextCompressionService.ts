import type {
  Chapter,
  ContextBudgetProfile,
  ContextCompressionRecord,
  ContextSelectionResult,
  ID,
  StageSummary
} from '../shared/types'
import { TokenEstimator } from './TokenEstimator'
import { StageSummaryService } from './StageSummaryService'

interface ChapterWithShortSummaries extends Chapter {
  oneLineSummary?: string
  shortSummary?: string
}

interface CompressChapterRecapsForBudgetArgs {
  chapters: Chapter[]
  stageSummaries: StageSummary[]
  selection: ContextSelectionResult
  targetChapterOrder: number
  budgetProfile: ContextBudgetProfile
  estimateSelectionTokens: (selection: ContextSelectionResult) => number
  manualChapterIds?: ID[]
}

const OLD_CHAPTER_DISTANCE = 3
const SUMMARY_EXCERPT_LIMIT = 110

function textOrEmpty(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export function detailedChapterRecapText(chapter: Chapter): string {
  return [
    chapter.title,
    chapter.summary,
    chapter.newInformation,
    chapter.characterChanges,
    chapter.newForeshadowing,
    chapter.resolvedForeshadowing,
    chapter.endingHook,
    chapter.riskWarnings
  ].join('\n')
}

export function stageSummaryCompressionText(summary: StageSummary): string {
  return StageSummaryService.formatForBudget(summary)
}

function firstSentenceOrExcerpt(text: string, limit = SUMMARY_EXCERPT_LIMIT): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const sentence = trimmed.match(/^.{8,}?[。！？!?；;]/u)?.[0]
  const source = sentence && sentence.length <= limit * 1.3 ? sentence : trimmed
  return source.length <= limit ? source : `${source.slice(0, limit)}…`
}

function bestShortSummary(chapter: Chapter): { text: string; kind: 'chapter_one_line_summary' | 'summary_excerpt' } | null {
  const withShort = chapter as ChapterWithShortSummaries
  const oneLine = textOrEmpty(withShort.oneLineSummary) || textOrEmpty(withShort.shortSummary) || textOrEmpty(chapter.endingHook)
  if (oneLine) return { text: oneLine, kind: 'chapter_one_line_summary' }
  const excerpt = firstSentenceOrExcerpt(textOrEmpty(chapter.summary))
  return excerpt ? { text: excerpt, kind: 'summary_excerpt' } : null
}

function findStageSummaryForChapter(stageSummaries: StageSummary[], chapterOrder: number): StageSummary | null {
  return [...stageSummaries]
    .filter((summary) => summary.chapterStart <= chapterOrder && summary.chapterEnd >= chapterOrder)
    .sort((a, b) => {
      const rangeDelta = (a.chapterEnd - a.chapterStart) - (b.chapterEnd - b.chapterStart)
      if (rangeDelta !== 0) return rangeDelta
      return b.chapterEnd - a.chapterEnd
    })[0] ?? null
}

function recordId(chapter: Chapter, replacementKind: ContextCompressionRecord['replacementKind']): ID {
  return `compression-${chapter.id}-${replacementKind}`
}

export function createDroppedChapterCompressionRecord(chapter: Chapter, reason: string): ContextCompressionRecord {
  const originalTokenEstimate = TokenEstimator.estimate(detailedChapterRecapText(chapter))
  return {
    id: recordId(chapter, 'dropped'),
    kind: 'chapter_recap_dropped',
    originalContextKind: 'chapter_recap',
    originalChapterId: chapter.id,
    originalChapterOrder: chapter.order,
    originalTitle: chapter.title,
    originalTokenEstimate,
    replacementKind: 'dropped',
    replacementSourceId: null,
    replacementText: '',
    replacementTokenEstimate: 0,
    savedTokenEstimate: originalTokenEstimate,
    reason
  }
}

function createReplacementRecord(
  chapter: Chapter,
  replacementKind: ContextCompressionRecord['replacementKind'],
  replacementText: string,
  replacementSourceId: ID | null,
  reason: string
): ContextCompressionRecord {
  const originalTokenEstimate = TokenEstimator.estimate(detailedChapterRecapText(chapter))
  const replacementTokenEstimate = TokenEstimator.estimate(replacementText)
  const kind: ContextCompressionRecord['kind'] =
    replacementKind === 'stage_summary'
      ? 'chapter_recap_to_stage_summary'
      : replacementKind === 'chapter_one_line_summary'
        ? 'chapter_recap_to_one_line_summary'
        : 'chapter_recap_to_summary_excerpt'
  return {
    id: recordId(chapter, replacementKind),
    kind,
    originalContextKind: 'chapter_recap',
    originalChapterId: chapter.id,
    originalChapterOrder: chapter.order,
    originalTitle: chapter.title,
    originalTokenEstimate,
    replacementKind,
    replacementSourceId,
    replacementText,
    replacementTokenEstimate,
    savedTokenEstimate: Math.max(0, originalTokenEstimate - replacementTokenEstimate),
    reason
  }
}

function upsertCompressionRecord(selection: ContextSelectionResult, record: ContextCompressionRecord): ContextSelectionResult {
  return {
    ...selection,
    compressionRecords: [
      record,
      ...(selection.compressionRecords ?? []).filter((item) => item.originalChapterId !== record.originalChapterId)
    ]
  }
}

function removeSelectedChapter(selection: ContextSelectionResult, chapterId: ID): ContextSelectionResult {
  return {
    ...selection,
    selectedChapterIds: selection.selectedChapterIds.filter((id) => id !== chapterId)
  }
}

function recalc(selection: ContextSelectionResult, estimateSelectionTokens: (selection: ContextSelectionResult) => number): ContextSelectionResult {
  return {
    ...selection,
    estimatedTokens: estimateSelectionTokens(selection)
  }
}

export function compressChapterRecapsForBudget({
  chapters,
  stageSummaries,
  selection,
  targetChapterOrder,
  budgetProfile,
  estimateSelectionTokens,
  manualChapterIds = []
}: CompressChapterRecapsForBudgetArgs): ContextSelectionResult {
  let next: ContextSelectionResult = {
    ...selection,
    compressionRecords: [...(selection.compressionRecords ?? [])],
    warnings: [...selection.warnings],
    omittedItems: [...selection.omittedItems],
    selectedChapterIds: [...selection.selectedChapterIds]
  }
  next = recalc(next, estimateSelectionTokens)
  if (next.estimatedTokens <= budgetProfile.maxTokens) return next

  const manual = new Set(manualChapterIds)
  const selected = new Set(next.selectedChapterIds)
  const candidates = chapters
    .filter((chapter) => selected.has(chapter.id))
    .filter((chapter) => targetChapterOrder - chapter.order >= OLD_CHAPTER_DISTANCE)
    .filter((chapter) => !manual.has(chapter.id))
    .map((chapter) => ({
      chapter,
      originalTokenEstimate: TokenEstimator.estimate(detailedChapterRecapText(chapter))
    }))
    .sort((a, b) => {
      if (a.chapter.order !== b.chapter.order) return a.chapter.order - b.chapter.order
      return b.originalTokenEstimate - a.originalTokenEstimate
    })

  for (const { chapter } of candidates) {
    if (next.estimatedTokens <= budgetProfile.maxTokens) break
    const stageSummary = findStageSummaryForChapter(stageSummaries, chapter.order)
    if (stageSummary) {
      next = upsertCompressionRecord(
        next,
        createReplacementRecord(
          chapter,
          'stage_summary',
          stageSummaryCompressionText(stageSummary),
          stageSummary.id,
          '预算不足，旧章节详细回顾改用覆盖该章节的阶段摘要。'
        )
      )
      next = recalc(next, estimateSelectionTokens)
      continue
    }

    const shortSummary = bestShortSummary(chapter)
    if (shortSummary) {
      next = upsertCompressionRecord(
        next,
        createReplacementRecord(
          chapter,
          shortSummary.kind,
          shortSummary.text,
          chapter.id,
          shortSummary.kind === 'chapter_one_line_summary'
            ? '预算不足，旧章节详细回顾改用已有一句话摘要或结尾钩子。'
            : '预算不足，旧章节详细回顾改用章节摘要摘录。'
        )
      )
      next = recalc(next, estimateSelectionTokens)
      continue
    }

    const dropped = createDroppedChapterCompressionRecord(chapter, '预算不足，且该旧章节没有可用阶段摘要或短摘要，只能裁掉详细回顾。')
    next = removeSelectedChapter(upsertCompressionRecord(next, dropped), chapter.id)
    next.omittedItems = [
      ...next.omittedItems,
      {
        type: 'chapter',
        id: chapter.id,
        reason: dropped.reason,
        estimatedTokensSaved: dropped.savedTokenEstimate
      }
    ]
    next = recalc(next, estimateSelectionTokens)
  }

  if (next.estimatedTokens > budgetProfile.maxTokens && manualChapterIds.length > 0) {
    next.warnings = [
      ...next.warnings,
      '预算仍然超限；手动强选章节未被静默压缩，请人工确认上下文取舍。'
    ]
  }

  return next
}

export function replacementTextForCompressedChapter(record: ContextCompressionRecord): string {
  if (record.replacementKind === 'dropped') return ''
  return record.replacementText?.trim() ?? ''
}
