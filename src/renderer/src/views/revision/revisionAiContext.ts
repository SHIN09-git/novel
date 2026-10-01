import type {
  Chapter,
  ChapterContinuityBridge,
  Character,
  Foreshadowing,
  GeneratedChapterDraft,
  Project,
  RedundancyReport,
  StoryBible
} from '../../../../shared/types'
import { statusLabel, weightLabel } from '../../utils/format'

interface RevisionAiContextInput {
  project: Project
  bible: StoryBible | null
  chapters: Chapter[]
  characters: Character[]
  foreshadowings: Foreshadowing[]
  chapterContinuityBridges: ChapterContinuityBridge[]
  redundancyReports: RedundancyReport[]
  selectedChapter: Chapter | null
  selectedDraft: GeneratedChapterDraft | null
}

function meaningfulText(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value).trim()
  if (!text) return ''
  if (/^(暂无|待补充|未设定|未记录|未填写|无)$/i.test(text)) return ''
  return text
}

function contextLine(label: string, value: unknown): string {
  const text = meaningfulText(value)
  return text ? `${label}：${text}` : ''
}

function contextBlock(title: string, lines: string[]): string {
  const body = lines.map((line) => meaningfulText(line)).filter(Boolean).join('\n')
  return body ? `${title}：\n${body}` : ''
}

function formatRecentChapters(chapters: Chapter[], selectedChapter: Chapter | null): string {
  return chapters
    .filter((chapter) => !selectedChapter || chapter.order <= selectedChapter.order)
    .slice(-3)
    .map((chapter) => {
      const title = meaningfulText(chapter.title)
      const summary = meaningfulText(chapter.summary)
      const heading = `第 ${chapter.order} 章${title ? `《${title}》` : ''}`
      return summary ? `${heading}：${summary}` : heading
    })
    .join('\n')
}

function formatMainCharacters(characters: Character[]): string {
  return characters
    .filter((character) => character.isMain)
    .map((character) => {
      const details = [
        contextLine('定位', character.role),
        contextLine('情绪', character.emotionalState),
        contextLine('关系', character.protagonistRelationship)
      ].filter(Boolean)
      return details.length ? `${character.name}｜${details.join('｜')}` : character.name
    })
    .join('\n')
}

function formatHighValueForeshadowing(foreshadowings: Foreshadowing[]): string {
  return foreshadowings
    .filter((item) => item.status !== 'resolved' && item.status !== 'abandoned' && (item.weight === 'high' || item.weight === 'payoff'))
    .map((item) => [item.title, statusLabel(item.status), weightLabel(item.weight), meaningfulText(item.description)].filter(Boolean).join('｜'))
    .join('\n')
}

function findContinuityBridge(
  bridges: ChapterContinuityBridge[],
  selectedChapter: Chapter | null
): ChapterContinuityBridge | null {
  if (!selectedChapter) return null
  return (
    bridges.find((bridge) => bridge.toChapterOrder === selectedChapter.order) ??
    bridges.find((bridge) => bridge.fromChapterId === selectedChapter.id) ??
    null
  )
}

function findRedundancyReport(
  reports: RedundancyReport[],
  selectedChapter: Chapter | null,
  selectedDraft: GeneratedChapterDraft | null
): RedundancyReport | null {
  if (selectedDraft) return reports.find((report) => report.draftId === selectedDraft.id) ?? null
  if (selectedChapter) return reports.find((report) => report.chapterId === selectedChapter.id) ?? null
  return null
}

export function buildRevisionAiContext({
  project,
  bible,
  chapters,
  characters,
  foreshadowings,
  chapterContinuityBridges,
  redundancyReports,
  selectedChapter,
  selectedDraft
}: RevisionAiContextInput): string {
  const recentChapters = formatRecentChapters(chapters, selectedChapter)
  const mainCharacters = formatMainCharacters(characters)
  const highValueForeshadowing = formatHighValueForeshadowing(foreshadowings)
  const continuityBridge = findContinuityBridge(chapterContinuityBridges, selectedChapter)
  const redundancyReport = findRedundancyReport(redundancyReports, selectedChapter, selectedDraft)
  const continuityLines = continuityBridge
    ? [
        contextLine('必须接住', continuityBridge.immediateNextBeat || continuityBridge.mustContinueFrom),
        contextLine('身体状态', continuityBridge.lastPhysicalState),
        contextLine('情绪状态', continuityBridge.lastEmotionalState),
        contextLine('禁止重置', continuityBridge.mustNotReset || '不要重新介绍已有环境和设定')
      ].filter(Boolean)
    : []
  const redundancyLines = redundancyReport
    ? [
        contextLine('冗余分', redundancyReport.overallRedundancyScore),
        contextLine('重复词组', redundancyReport.repeatedPhrases.join('、')),
        contextLine('压缩建议', redundancyReport.compressionSuggestions.join('；'))
      ].filter(Boolean)
    : []

  return [
    contextLine('项目', project.name),
    contextLine('题材', project.genre),
    contextLine('简介', project.description),
    contextLine('核心爽点', project.coreAppeal),
    contextLine('整体风格', project.style),
    contextLine('叙事基调', bible?.narrativeTone),
    contextLine('文风样例', bible?.styleSample),
    contextLine('不可违背设定', bible?.immutableFacts),
    contextBlock('最近章节', recentChapters ? [recentChapters] : []),
    contextBlock('主要角色状态', mainCharacters ? [mainCharacters] : []),
    contextBlock('高权重伏笔', highValueForeshadowing ? [highValueForeshadowing] : []),
    contextBlock('章节衔接要求', continuityLines),
    contextBlock('冗余压缩参考', redundancyLines)
  ].filter(Boolean).join('\n')
}
