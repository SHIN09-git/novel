import type {
  BuildPromptResult,
  ChapterTask,
  ContextBudgetMode,
  ContextBudgetProfile,
  ContextNeedPlan,
  ContextSelectionResult,
  ID,
  PromptContextSnapshot,
  PromptContextSnapshotSource,
  PromptMode,
  PromptModuleSelection,
  StoryDirectionGuide
} from '../../../../shared/types'
import type { SaveDataHandler, SaveDataOutcome } from '../../utils/saveDataState'

export interface PromptBuilderSnapshotBinding {
  projectId: ID
  targetChapterOrder: number
  budgetMode: ContextBudgetMode
  promptMode: PromptMode
  moduleSelection: PromptModuleSelection
  continuityInstructions: string
  useContinuityBridge: boolean
  budgetProfile: ContextBudgetProfile
  contextSelectionResult: ContextSelectionResult
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
  foreshadowingTreatmentOverrides: PromptContextSnapshot['foreshadowingTreatmentOverrides']
  chapterTask: ChapterTask
  contextNeedPlan: ContextNeedPlan | null
  storyDirectionGuide: StoryDirectionGuide | null
}

export interface CreatePromptBuilderSnapshotBindingInput {
  projectId: ID
  targetChapterOrder: number
  budgetMode: ContextBudgetMode
  promptMode: PromptMode
  moduleSelection: PromptModuleSelection
  continuityInstructions: string
  useContinuityBridge: boolean
  budgetProfile: ContextBudgetProfile
  budgetSelection: ContextSelectionResult
  result: BuildPromptResult
}

interface CreateSnapshotInput {
  id: ID
  binding: PromptBuilderSnapshotBinding
  finalPrompt: string
  estimatedTokens: number
  source: PromptContextSnapshotSource
  note: string
  timestamp: string
}

export function createPromptBuilderSnapshotBinding(
  input: CreatePromptBuilderSnapshotBindingInput
): PromptBuilderSnapshotBinding {
  return {
    projectId: input.projectId,
    targetChapterOrder: input.targetChapterOrder,
    budgetMode: input.budgetMode,
    promptMode: input.promptMode,
    moduleSelection: { ...input.moduleSelection },
    continuityInstructions: input.continuityInstructions,
    useContinuityBridge: input.useContinuityBridge,
    budgetProfile: { ...input.budgetProfile },
    contextSelectionResult: input.result.contextSelectionResult ?? input.budgetSelection,
    selectedCharacterIds: [...input.result.selectedCharacterIds],
    selectedForeshadowingIds: [...input.result.selectedForeshadowingIds],
    foreshadowingTreatmentOverrides: { ...input.result.foreshadowingTreatmentOverrides },
    chapterTask: { ...input.result.chapterTask },
    contextNeedPlan: input.result.contextNeedPlan,
    storyDirectionGuide: input.result.storyDirectionGuide
  }
}

interface ResolvePromptBuilderSnapshotDraftInput
  extends Omit<CreatePromptBuilderSnapshotBindingInput, 'result'> {
  prompt: string
  promptBinding?: PromptBuilderSnapshotBinding | null
  buildPromptResult: () => BuildPromptResult
}

export function resolvePromptBuilderSnapshotDraft(input: ResolvePromptBuilderSnapshotDraftInput): {
  prompt: string
  binding: PromptBuilderSnapshotBinding
  builtFromEmptyPrompt: boolean
} {
  if (input.prompt.trim() && input.promptBinding?.projectId === input.projectId) {
    return { prompt: input.prompt, binding: input.promptBinding, builtFromEmptyPrompt: false }
  }
  if (input.prompt.trim()) {
    throw new Error('当前 Prompt 没有绑定上下文；请重新构建 Prompt 后再保存快照或发送到流水线。')
  }

  const result = input.buildPromptResult()
  return {
    prompt: result.finalPrompt,
    binding: createPromptBuilderSnapshotBinding({ ...input, result }),
    builtFromEmptyPrompt: true
  }
}

export function createPromptBuilderSnapshotBindingFromSnapshot(
  snapshot: PromptContextSnapshot,
  restored: Pick<PromptBuilderSnapshotBinding, 'promptMode' | 'moduleSelection'>
): PromptBuilderSnapshotBinding {
  return {
    projectId: snapshot.projectId,
    targetChapterOrder: snapshot.targetChapterOrder,
    budgetMode: snapshot.mode,
    promptMode: restored.promptMode,
    moduleSelection: { ...restored.moduleSelection },
    continuityInstructions: snapshot.continuityInstructions ?? '',
    useContinuityBridge: snapshot.useContinuityBridge ?? true,
    budgetProfile: { ...snapshot.budgetProfile },
    contextSelectionResult: snapshot.contextSelectionResult,
    selectedCharacterIds: [...snapshot.selectedCharacterIds],
    selectedForeshadowingIds: [...snapshot.selectedForeshadowingIds],
    foreshadowingTreatmentOverrides: { ...snapshot.foreshadowingTreatmentOverrides },
    chapterTask: { ...snapshot.chapterTask },
    contextNeedPlan: snapshot.contextNeedPlan,
    storyDirectionGuide: snapshot.storyDirectionGuide
  }
}

export function createBoundPromptContextSnapshot(input: CreateSnapshotInput): PromptContextSnapshot {
  const { binding } = input
  return {
    id: input.id,
    projectId: binding.projectId,
    targetChapterOrder: binding.targetChapterOrder,
    mode: binding.budgetMode,
    promptMode: binding.promptMode,
    moduleSelection: { ...binding.moduleSelection },
    continuityInstructions: binding.continuityInstructions,
    useContinuityBridge: binding.useContinuityBridge,
    budgetProfileId: binding.budgetProfile.id,
    budgetProfile: { ...binding.budgetProfile },
    contextSelectionResult: binding.contextSelectionResult,
    selectedCharacterIds: [...binding.selectedCharacterIds],
    selectedForeshadowingIds: [...binding.selectedForeshadowingIds],
    foreshadowingTreatmentOverrides: { ...binding.foreshadowingTreatmentOverrides },
    chapterTask: { ...binding.chapterTask },
    contextNeedPlan: binding.contextNeedPlan,
    storyDirectionGuide: binding.storyDirectionGuide,
    finalPrompt: input.finalPrompt,
    estimatedTokens: input.estimatedTokens,
    source: input.source,
    note: input.note,
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  }
}

export async function persistPromptContextSnapshot(
  snapshot: PromptContextSnapshot,
  saveData: SaveDataHandler
): Promise<SaveDataOutcome> {
  return saveData((current) => ({
    ...current,
    promptContextSnapshots: [snapshot, ...current.promptContextSnapshots],
    contextNeedPlans: snapshot.contextNeedPlan
      ? [snapshot.contextNeedPlan, ...current.contextNeedPlans.filter((plan) => plan.id !== snapshot.contextNeedPlan?.id)]
      : current.contextNeedPlans,
    contextBudgetProfiles: current.contextBudgetProfiles.some((profile) => profile.id === snapshot.budgetProfile.id)
      ? current.contextBudgetProfiles
      : [snapshot.budgetProfile, ...current.contextBudgetProfiles]
  }))
}

export async function persistPromptContextSnapshotAndSend(
  snapshot: PromptContextSnapshot,
  saveData: SaveDataHandler,
  onSendToPipeline?: (snapshotId: ID) => void,
  onPersisted?: () => void
): Promise<SaveDataOutcome> {
  const saved = await persistPromptContextSnapshot(snapshot, saveData)
  if (saved.ok) {
    onPersisted?.()
    onSendToPipeline?.(snapshot.id)
  }
  return saved
}

export function createExclusivePromptHistoryActionRunner() {
  let running = false

  return {
    isRunning: () => running,
    async run<T>(action: () => Promise<T>): Promise<{ started: true; value: T } | { started: false }> {
      if (running) return { started: false }
      running = true
      try {
        return { started: true, value: await action() }
      } finally {
        running = false
      }
    }
  }
}
