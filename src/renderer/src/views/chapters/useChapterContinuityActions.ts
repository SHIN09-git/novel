import type {
  Chapter,
  ChapterContinuityBridge,
  ChapterContinuityBridgeSuggestion,
  NextChapterSuggestions,
  Project
} from '../../../../shared/types'
import type { SaveDataHandler } from '../../utils/saveDataState'
import { newId, now } from '../../utils/format'
import { updateProjectTimestamp } from '../viewTypes'

interface UseChapterContinuityActionsInput {
  selected: Chapter | null
  selectedBridge: ChapterContinuityBridge | null
  project: Project
  saveData: SaveDataHandler
  setAiMessage: (message: string) => void
}

const emptyBridgeSuggestion: ChapterContinuityBridgeSuggestion = {
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

export function formatNextSuggestionsAsRiskText(suggestions: NextChapterSuggestions): string {
  return [
    '下一章风险提醒：',
    `- 下一章目标：${suggestions.nextChapterGoal}`,
    `- 必须推进的冲突：${suggestions.conflictToPush}`,
    `- 必须保留的悬念：${suggestions.suspenseToKeep}`,
    `- 可轻推伏笔：${suggestions.foreshadowingToHint}`,
    `- 不要提前揭示：${suggestions.foreshadowingNotToReveal}`,
    `- 建议结尾钩子：${suggestions.suggestedEndingHook}`,
    `- 读者情绪目标：${suggestions.readerEmotionTarget}`
  ].join('\n')
}

export function useChapterContinuityActions({ selected, selectedBridge, project, saveData, setAiMessage }: UseChapterContinuityActionsInput) {
  async function saveContinuityBridge(suggestion: ChapterContinuityBridgeSuggestion) {
    if (!selected) return
    const timestamp = now()
    const existing = selectedBridge
    const bridge: ChapterContinuityBridge = {
      ...(existing ?? {
        id: newId(),
        projectId: project.id,
        fromChapterId: selected.id,
        toChapterOrder: selected.order + 1,
        createdAt: timestamp
      }),
      ...suggestion,
      updatedAt: timestamp
    }
    const saved = await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      chapterContinuityBridges: existing
        ? current.chapterContinuityBridges.map((item) => (item.id === existing.id ? bridge : item))
        : [bridge, ...current.chapterContinuityBridges]
    }))
    if (!saved.ok) return
    setAiMessage('已保存下一章衔接状态。')
  }

  async function updateContinuityBridgeField(field: keyof ChapterContinuityBridgeSuggestion, value: string) {
    await saveContinuityBridge({ ...(selectedBridge ?? emptyBridgeSuggestion), [field]: value })
  }

  return {
    saveContinuityBridge,
    updateContinuityBridgeField
  }
}
