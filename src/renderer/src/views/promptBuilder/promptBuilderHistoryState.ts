import { defaultModulesForMode } from '../../../../shared/defaults/index'
import type {
  ContextNeedPlan,
  ForeshadowingTreatmentMode,
  ID,
  PromptContextSnapshot,
  PromptMode,
  PromptModuleSelection,
  PromptVersion
} from '../../../../shared/types'
import {
  createPromptBuilderSnapshotBindingFromSnapshot,
  type PromptBuilderSnapshotBinding
} from './promptBuilderSnapshotConsistency'

export interface RestoredPromptBuilderState {
  targetChapterOrder: number
  promptMode: PromptMode
  budgetMode: PromptContextSnapshot['mode']
  budgetMaxTokens: number
  modules: PromptModuleSelection
  task: PromptContextSnapshot['chapterTask']
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
  foreshadowingTreatmentOverrides: Record<ID, ForeshadowingTreatmentMode>
  contextNeedPlan: ContextNeedPlan | null
  continuityInstructions: string
  useContinuityBridge: boolean
  prompt: string
  snapshotNote: string
  promptBinding: PromptBuilderSnapshotBinding | null
}

function promptModeFromSnapshot(snapshot: PromptContextSnapshot, fallback: PromptMode): PromptMode {
  if (snapshot.promptMode) return snapshot.promptMode
  return snapshot.mode === 'custom' ? fallback : snapshot.mode
}

export function restorePromptBuilderFromSnapshot(
  snapshot: PromptContextSnapshot,
  fallbackPromptMode: PromptMode
): RestoredPromptBuilderState {
  const promptMode = promptModeFromSnapshot(snapshot, fallbackPromptMode)
  return {
    targetChapterOrder: snapshot.targetChapterOrder,
    promptMode,
    budgetMode: snapshot.mode,
    budgetMaxTokens: snapshot.budgetProfile.maxTokens,
    modules: snapshot.moduleSelection ?? defaultModulesForMode(promptMode),
    task: snapshot.chapterTask,
    selectedCharacterIds: [...snapshot.selectedCharacterIds],
    selectedForeshadowingIds: [...snapshot.selectedForeshadowingIds],
    foreshadowingTreatmentOverrides: { ...snapshot.foreshadowingTreatmentOverrides },
    contextNeedPlan: snapshot.contextNeedPlan,
    continuityInstructions: snapshot.continuityInstructions ?? '',
    useContinuityBridge: snapshot.useContinuityBridge ?? true,
    prompt: snapshot.finalPrompt,
    snapshotNote: snapshot.note,
    promptBinding: createPromptBuilderSnapshotBindingFromSnapshot(snapshot, {
      promptMode,
      moduleSelection: snapshot.moduleSelection ?? defaultModulesForMode(promptMode)
    })
  }
}

export function restorePromptBuilderFromVersion(version: PromptVersion): Pick<
  RestoredPromptBuilderState,
  'targetChapterOrder' | 'promptMode' | 'budgetMode' | 'modules' | 'task' | 'prompt' | 'promptBinding'
> {
  return {
    targetChapterOrder: version.targetChapterOrder,
    promptMode: version.mode,
    budgetMode: version.mode,
    modules: version.moduleSelection,
    task: version.task,
    prompt: version.content,
    promptBinding: null
  }
}
