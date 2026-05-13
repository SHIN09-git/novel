import type {
  Character,
  CharacterCardField,
  CharacterStateFact,
  CharacterStateLog,
  Chapter,
  ChapterContinuityBridge,
  Foreshadowing,
  ForeshadowingTreatmentMode,
  ID,
  ContextCompressionRecord,
  ContextNeedPlan,
  PromptBlockOrderItem,
  PromptBuildInput,
  PromptConfig,
  PromptMode,
  StageSummary,
  TimelineEvent
} from '../../shared/types'

import { StageSummaryService } from '../StageSummaryService'
import { cleanPromptBody, truncateText, valueOrEmpty } from './promptUtils'

export function summarizeChapter(chapter: Chapter, includeBody: boolean): string {
  const lines = [
    `### 第 ${chapter.order} 章：${chapter.title || '未命名'}`,
    `剧情摘要：${valueOrEmpty(chapter.summary)}`,
    `新增信息：${valueOrEmpty(chapter.newInformation)}`,
    `角色变化：${valueOrEmpty(chapter.characterChanges)}`,
    `新增伏笔：${valueOrEmpty(chapter.newForeshadowing)}`,
    `已回收伏笔：${valueOrEmpty(chapter.resolvedForeshadowing)}`,
    `结尾钩子：${valueOrEmpty(chapter.endingHook)}`
  ]

  if (includeBody && chapter.body.trim()) {
    lines.push(`正文摘录：\n${chapter.body.trim().slice(0, 1200)}`)
  }

  return lines.join('\n')
}

function normalizeDedupText(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[，。！？；：、,.!?;:"'“”‘’（）()【】\[\]《》<>]/g, '')
    .toLowerCase()
}

function bridgeDedupFacts(bridge: ChapterContinuityBridge | null): string[] {
  if (!bridge) return []
  return [
    bridge.lastSceneLocation,
    bridge.lastPhysicalState,
    bridge.lastEmotionalState,
    bridge.lastUnresolvedAction,
    bridge.lastDialogueOrThought,
    bridge.immediateNextBeat,
    bridge.mustContinueFrom,
    bridge.mustNotReset,
    bridge.openMicroTensions
  ]
    .map(valueOrEmpty)
    .map(normalizeDedupText)
    .filter((text) => text.length >= 8)
}

export function dedupeAgainstBridge(text: string, bridge: ChapterContinuityBridge | null): string {
  const bridgeFacts = bridgeDedupFacts(bridge)
  if (!bridgeFacts.length) return cleanPromptBody(text)
  const seen = new Set<string>()
  return cleanPromptBody(
    text
      .split('\n')
      .filter((line) => {
        const normalized = normalizeDedupText(line)
        if (!normalized) return true
        if (seen.has(normalized)) return false
        seen.add(normalized)
        if (normalized.length < 8) return true
        return !bridgeFacts.some((fact) => normalized.includes(fact) || fact.includes(normalized))
      })
      .join('\n')
  )
}

export function formatCompressedChapterRecap(chapter: Chapter, record: ContextCompressionRecord): string {
  if (record.replacementKind === 'dropped') return ''
  const replacementText = record.replacementText?.trim()
  if (!replacementText) return ''
  const sourceLabel = {
    stage_summary: '阶段摘要',
    chapter_one_line_summary: '章节一句话摘要',
    summary_excerpt: '章节摘要摘录',
    dropped: '已裁掉'
  }[record.replacementKind]
  return [
    `### 第 ${chapter.order} 章：${chapter.title || '未命名'}（详细回顾已压缩）`,
    `替换方式：${sourceLabel}`,
    `压缩原因：${record.reason}`,
    `节省估算：约 ${record.savedTokenEstimate} token`,
    replacementText
  ].join('\n')
}

export function formatStageSummary(summary: StageSummary): string {
  return StageSummaryService.formatForPrompt(summary)
}

export function formatTimeline(events: TimelineEvent[], targetChapterOrder: number): string {
  return events
    .filter((event) => event.chapterOrder === null || event.chapterOrder <= targetChapterOrder)
    .sort((a, b) => a.narrativeOrder - b.narrativeOrder)
    .map((event) =>
      [
        `### ${event.narrativeOrder}. ${event.title || '未命名事件'}`,
        `所属章节：${valueOrEmpty(event.chapterOrder)}`,
        `故事内时间：${valueOrEmpty(event.storyTime)}`,
        `事件结果：${valueOrEmpty(event.result)}`,
        `后续影响：${valueOrEmpty(event.downstreamImpact)}`
      ].join('\n')
    )
    .join('\n\n')
}
