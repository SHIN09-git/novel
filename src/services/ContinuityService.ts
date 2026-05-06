import type { Chapter, ChapterContinuityBridge, ChapterContinuityBridgeSuggestion, ContinuitySource, ID } from '../shared/types'

export const EMPTY_CONTINUITY_BRIDGE_SUGGESTION: ChapterContinuityBridgeSuggestion = {
  lastSceneLocation: '',
  lastPhysicalState: '',
  lastEmotionalState: '',
  lastUnresolvedAction: '',
  lastDialogueOrThought: '',
  immediateNextBeat: '',
  mustContinueFrom: '',
  mustNotReset: '',
  openMicroTensions: ''
}

export function endingExcerpt(chapter: Chapter | null | undefined, maxChars = 900): string {
  const text = chapter?.body?.trim() ?? ''
  if (!text) return ''
  return text.length > maxChars ? text.slice(-maxChars) : text
}

export function previousChapterForTarget(chapters: Chapter[], targetChapterOrder: number): Chapter | null {
  return [...chapters].sort((a, b) => b.order - a.order).find((chapter) => chapter.order === targetChapterOrder - 1) ?? null
}

export function findContinuityBridge(
  bridges: ChapterContinuityBridge[],
  fromChapterId: ID | null,
  targetChapterOrder: number
): ChapterContinuityBridge | null {
  if (!fromChapterId) return null
  return bridges.find((bridge) => bridge.fromChapterId === fromChapterId && bridge.toChapterOrder === targetChapterOrder) ?? null
}

export function createBridgeFromPreviousEnding(
  projectId: ID,
  previousChapter: Chapter,
  targetChapterOrder: number
): ChapterContinuityBridge {
  const timestamp = new Date().toISOString()
  const excerpt = endingExcerpt(previousChapter, 900)
  return {
    id: `auto-bridge-${previousChapter.id}-${targetChapterOrder}`,
    projectId,
    fromChapterId: previousChapter.id,
    toChapterOrder: targetChapterOrder,
    lastSceneLocation: '请从上一章结尾片段中确认位置。',
    lastPhysicalState: '请延续上一章结尾的身体状态，不要重置。',
    lastEmotionalState: '请延续上一章结尾的情绪余波。',
    lastUnresolvedAction: previousChapter.endingHook || '上一章结尾动作尚未明确复盘，请参考结尾片段。',
    lastDialogueOrThought: excerpt,
    immediateNextBeat: '下一章开头必须直接接住上一章最后一幕。',
    mustContinueFrom: excerpt,
    mustNotReset: '不要重新开场；不要重新介绍已有环境、机关、设定或人物状态。',
    openMicroTensions: previousChapter.riskWarnings || previousChapter.endingHook || '',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function resolveContinuityBridge(options: {
  projectId: ID
  chapters: Chapter[]
  bridges: ChapterContinuityBridge[]
  targetChapterOrder: number
}): { bridge: ChapterContinuityBridge | null; source: ContinuitySource | null; warnings: string[] } {
  const previousChapter = previousChapterForTarget(options.chapters, options.targetChapterOrder)
  if (!previousChapter) {
    return { bridge: null, source: null, warnings: ['未找到上一章，无法建立章节衔接。'] }
  }
  const saved = findContinuityBridge(options.bridges, previousChapter.id, options.targetChapterOrder)
  if (saved) return { bridge: saved, source: 'saved_bridge', warnings: [] }
  const autoBridge = createBridgeFromPreviousEnding(options.projectId, previousChapter, options.targetChapterOrder)
  return {
    bridge: autoBridge,
    source: 'auto_from_previous_ending',
    warnings: ['未找到已保存的衔接桥，已使用上一章结尾片段作为临时衔接依据。']
  }
}

export function formatContinuityBridgeForPrompt(
  bridge: ChapterContinuityBridge | null,
  manualInstructions = ''
): string {
  const lines = bridge
    ? [
        `上一章结尾位置：${bridge.lastSceneLocation || '待补充'}`,
        `身体状态：${bridge.lastPhysicalState || '待补充'}`,
        `情绪状态：${bridge.lastEmotionalState || '待补充'}`,
        `未完成动作：${bridge.lastUnresolvedAction || '待补充'}`,
        `未说出口的问题：${bridge.lastDialogueOrThought || '待补充'}`,
        `下一章开头必须接住：${bridge.immediateNextBeat || bridge.mustContinueFrom || '待补充'}`,
        `禁止重置：${bridge.mustNotReset || '不要重新介绍已有环境、机关和设定。'}`,
        `开放的小张力：${bridge.openMicroTensions || '待补充'}`
      ]
    : ['暂无上一章衔接桥。']

  if (manualInstructions.trim()) {
    lines.push(`作者补充衔接指令：${manualInstructions.trim()}`)
  }

  lines.push(
    '硬规则：下一章开头必须直接承接上一章最后一幕，不得跳过、不得重新开场、不得重新介绍已有环境。',
    '除非章节任务明确要求时间跳跃，否则第一场戏必须从上一章结尾后的数秒到数分钟内开始。'
  )
  return lines.join('\n')
}
