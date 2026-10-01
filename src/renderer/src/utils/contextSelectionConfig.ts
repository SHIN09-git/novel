import type { ChapterTask, ContextSelectionResult, ID, PromptConfig, PromptModuleSelection } from '../../../shared/types'

interface PipelinePromptConfigInput {
  projectId: ID
  targetChapterOrder: number
  emotion: string
  wordCount: string
  projectStyle: string
  modules: PromptModuleSelection
  selection: Pick<ContextSelectionResult, 'selectedCharacterIds' | 'selectedForeshadowingIds'>
  chapterTask?: ChapterTask | null
}

export function createPipelinePromptConfigFromSelection(input: PipelinePromptConfigInput): PromptConfig {
  const fallbackTask: ChapterTask = {
    goal: `生成第 ${input.targetChapterOrder} 章草稿`,
    conflict: '',
    suspenseToKeep: '',
    allowedPayoffs: '',
    forbiddenPayoffs: '',
    endingHook: '',
    readerEmotion: input.emotion,
    targetWordCount: input.wordCount,
    styleRequirement: input.projectStyle
  }
  const task: ChapterTask = input.chapterTask ? { ...input.chapterTask } : fallbackTask

  return {
    projectId: input.projectId,
    targetChapterOrder: input.targetChapterOrder,
    mode: 'standard',
    modules: input.modules,
    task,
    selectedCharacterIds: [...input.selection.selectedCharacterIds],
    selectedForeshadowingIds: [...input.selection.selectedForeshadowingIds]
  }
}
