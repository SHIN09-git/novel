import type {
  BuildPromptResult,
  ChapterTask,
  ContextBudgetMode,
  ContextBudgetProfile,
  ContextSelectionResult,
  ID,
  PromptContextSnapshot,
  PromptContextSnapshotSource,
  PromptMode,
  PromptModuleSelection,
  PromptVersion
} from '../../../../shared/types'
import { useRef, useState } from 'react'
import { PromptLintService } from '../../../../services/PromptLintService'
import { TokenEstimator } from '../../../../services/TokenEstimator'
import { useConfirm } from '../../components/ConfirmDialog'
import type { SaveDataHandler } from '../../utils/saveDataState'
import { formatDate, modeLabel, newId, now } from '../../utils/format'
import {
  createBoundPromptContextSnapshot,
  createExclusivePromptHistoryActionRunner,
  persistPromptContextSnapshot,
  persistPromptContextSnapshotAndSend,
  resolvePromptBuilderSnapshotDraft,
  type PromptBuilderSnapshotBinding
} from './promptBuilderSnapshotConsistency'

interface PromptBuilderHistoryOptions {
  projectId: ID
  targetChapterOrder: number
  promptMode: PromptMode
  budgetMode: ContextBudgetMode
  budgetProfile: ContextBudgetProfile
  modules: PromptModuleSelection
  task: ChapterTask
  continuityInstructions: string
  useContinuityBridge: boolean
  prompt: string
  promptBinding?: PromptBuilderSnapshotBinding | null
  promptVersionSource?: PromptVersion | null
  snapshotNote: string
  budgetSelection: ContextSelectionResult
  buildPromptResult: () => BuildPromptResult
  saveData: SaveDataHandler
  onPromptNormalized: (prompt: string) => void
  onPromptBindingChange?: (binding: PromptBuilderSnapshotBinding) => void
  onSendToPipeline?: (snapshotId: ID) => void
}

export function usePromptBuilderHistoryActions(options: PromptBuilderHistoryOptions) {
  const confirmAction = useConfirm()
  const actionRunnerRef = useRef(createExclusivePromptHistoryActionRunner())
  const [isSaving, setIsSaving] = useState(false)
  const [historyMessage, setHistoryMessage] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)

  function clearHistoryFeedback() {
    setHistoryMessage(null)
    setHistoryError(null)
  }

  async function runSaveAction<T>(
    successMessage: string,
    action: () => Promise<T>
  ): Promise<T | undefined> {
    const execution = await actionRunnerRef.current.run(async () => {
      setIsSaving(true)
      setHistoryMessage(null)
      setHistoryError(null)
      try {
        const value = await action()
        setHistoryMessage(successMessage)
        return value
      } catch (error) {
        setHistoryError(error instanceof Error ? error.message : String(error))
        return undefined
      } finally {
        setIsSaving(false)
      }
    })
    return execution.started ? execution.value : undefined
  }

  function prepareSnapshot(source: PromptContextSnapshotSource): {
    snapshot: PromptContextSnapshot
    normalizedPrompt: string
    binding: PromptBuilderSnapshotBinding
    builtFromEmptyPrompt: boolean
  } | null {
    const resolved = resolvePromptBuilderSnapshotDraft({
      projectId: options.projectId,
      targetChapterOrder: options.targetChapterOrder,
      budgetMode: options.budgetMode,
      promptMode: options.promptMode,
      moduleSelection: options.modules,
      continuityInstructions: options.continuityInstructions,
      useContinuityBridge: options.useContinuityBridge,
      budgetProfile: options.budgetProfile,
      budgetSelection: options.budgetSelection,
      prompt: options.prompt,
      promptBinding: options.promptBinding,
      buildPromptResult: options.buildPromptResult
    })
    const finalPrompt = PromptLintService.guardWritingPrompt(resolved.prompt).guardedPrompt
    if (!finalPrompt.trim()) return null
    const timestamp = now()
    return {
      snapshot: createBoundPromptContextSnapshot({
        id: newId(),
        binding: resolved.binding,
        finalPrompt,
        estimatedTokens: TokenEstimator.estimate(finalPrompt),
        source,
        note: options.snapshotNote,
        timestamp
      }),
      normalizedPrompt: finalPrompt,
      binding: resolved.binding,
      builtFromEmptyPrompt: resolved.builtFromEmptyPrompt
    }
  }

  async function savePromptVersion(): Promise<boolean> {
    if (!options.prompt.trim()) return false
    const saved = await runSaveAction('Prompt 版本已保存。', async () => {
      const guardedPrompt = PromptLintService.guardWritingPrompt(options.prompt).guardedPrompt
      const binding = options.promptBinding?.projectId === options.projectId
        ? options.promptBinding
        : {
            projectId: options.projectId,
            targetChapterOrder: options.promptVersionSource?.targetChapterOrder ?? options.targetChapterOrder,
            promptMode: options.promptVersionSource?.mode ?? options.promptMode,
            moduleSelection: options.promptVersionSource?.moduleSelection ?? options.modules,
            chapterTask: options.promptVersionSource?.task ?? options.task
          }
      const savedResult = await options.saveData((current) => ({
        ...current,
        promptVersions: [
          {
            id: newId(),
            projectId: binding.projectId,
            targetChapterOrder: binding.targetChapterOrder,
            title: `第 ${binding.targetChapterOrder} 章 ${modeLabel(binding.promptMode)} ${formatDate(now())}`,
            mode: binding.promptMode,
            content: guardedPrompt,
            tokenEstimate: TokenEstimator.estimate(guardedPrompt),
            moduleSelection: binding.moduleSelection,
            task: binding.chapterTask,
            createdAt: now()
          },
          ...current.promptVersions
        ]
      }))
      if (!savedResult.ok) throw new Error(savedResult.errorMessage)
      if (guardedPrompt !== options.prompt) options.onPromptNormalized(guardedPrompt)
      return true
    })
    return saved ?? false
  }

  async function saveContextSnapshot(
    source: PromptContextSnapshotSource = 'manual'
  ): Promise<PromptContextSnapshot | null> {
    const persisted = await runSaveAction('上下文快照已保存。', async () => {
      const prepared = prepareSnapshot(source)
      if (!prepared) throw new Error('Prompt 为空，无法保存快照。')
      const saved = await persistPromptContextSnapshot(prepared.snapshot, options.saveData)
      if (!saved.ok) throw new Error(saved.errorMessage)
      if (!options.prompt.trim() || prepared.normalizedPrompt !== options.prompt) {
        options.onPromptNormalized(prepared.normalizedPrompt)
      }
      if (prepared.builtFromEmptyPrompt) options.onPromptBindingChange?.(prepared.binding)
      return prepared.snapshot
    })
    return persisted ?? null
  }

  async function sendToPipeline(): Promise<boolean> {
    const sent = await runSaveAction('快照已保存并发送到流水线。', async () => {
      const prepared = prepareSnapshot('manual')
      if (!prepared) throw new Error('Prompt 为空，无法发送到流水线。')
      const saved = await persistPromptContextSnapshotAndSend(
        prepared.snapshot,
        options.saveData,
        options.onSendToPipeline,
        () => {
          if (!options.prompt.trim() || prepared.normalizedPrompt !== options.prompt) {
            options.onPromptNormalized(prepared.normalizedPrompt)
          }
          if (prepared.builtFromEmptyPrompt) options.onPromptBindingChange?.(prepared.binding)
        }
      )
      if (!saved.ok) throw new Error(saved.errorMessage)
      return true
    })
    return sent ?? false
  }

  async function deleteContextSnapshot(id: ID): Promise<boolean> {
    const confirmed = await confirmAction({
      title: '删除上下文快照',
      message: '确定删除这个上下文快照吗？依赖它的流水线任务会提示快照已丢失。',
      confirmLabel: '删除快照',
      tone: 'danger'
    })
    if (!confirmed) return false
    const deleted = await runSaveAction('上下文快照已删除。', async () => {
      const saved = await options.saveData((current) => ({
        ...current,
        promptContextSnapshots: current.promptContextSnapshots.filter((snapshot) => snapshot.id !== id)
      }))
      if (!saved.ok) throw new Error(saved.errorMessage)
      return true
    })
    return deleted ?? false
  }

  async function deletePromptVersion(id: ID): Promise<boolean> {
    const confirmed = await confirmAction({
      title: '删除 Prompt 版本',
      message: '确定删除这个 Prompt 版本吗？',
      confirmLabel: '删除版本',
      tone: 'danger'
    })
    if (!confirmed) return false
    const deleted = await runSaveAction('Prompt 版本已删除。', async () => {
      const saved = await options.saveData((current) => ({
        ...current,
        promptVersions: current.promptVersions.filter((version) => version.id !== id)
      }))
      if (!saved.ok) throw new Error(saved.errorMessage)
      return true
    })
    return deleted ?? false
  }

  return {
    clearHistoryFeedback,
    deleteContextSnapshot,
    deletePromptVersion,
    historyError,
    historyMessage,
    isSaving,
    saveContextSnapshot,
    savePromptVersion,
    sendToPipeline
  }
}
