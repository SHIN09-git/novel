import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Copy, Layers, Save, WandSparkles } from 'lucide-react'
import type {
  AppData,
  BuildPromptResult,
  ChapterTask,
  ContextNeedPlan,
  ContextBudgetMode,
  ForeshadowingTreatmentMode,
  ID,
  Project,
  PromptContextSnapshot,
  PromptMode,
  PromptModuleSelection,
  PromptVersion
} from '../../../shared/types'
import { createEmptyChapterTask, defaultModulesForMode } from '../../../shared/defaults'
import { ContextNeedPlannerService } from '../../../services/ContextNeedPlannerService'
import { resolveContinuityBridge } from '../../../services/ContinuityService'
import { PromptBuilderService } from '../../../services/PromptBuilderService'
import { StoryDirectionService } from '../../../services/StoryDirectionService'
import { TokenEstimator } from '../../../services/TokenEstimator'
import { nextChapterOrder } from '../../../services/ChapterLifecycleService'
import { Header } from '../components/Layout'
import { useConfirm } from '../components/ConfirmDialog'
import { useProjectData } from '../hooks/useProjectData'
import { getNovelDirectorClipboardApi } from '../platform/novelDirectorBridge'
import { compareForeshadowingByStatusWeightUpdatedAt } from '../utils/foreshadowingSort'
import { now } from '../utils/format'
import {
  createContextBudgetProfile,
  recommendedCharacters,
  recommendedForeshadowings,
  selectBudgetContext
} from '../utils/promptContext'
import type { SaveDataHandler } from '../utils/saveDataState'
import { PromptBudgetPanel } from './promptBuilder/PromptBudgetPanel'
import { PromptCharacterSelectionPanel } from './promptBuilder/PromptCharacterSelectionPanel'
import { PromptChapterTaskPanel } from './promptBuilder/PromptChapterTaskPanel'
import { PromptContextNeedPanel } from './promptBuilder/PromptContextNeedPanel'
import { PromptContinuityPanel } from './promptBuilder/PromptContinuityPanel'
import { PromptControlPanel } from './promptBuilder/PromptControlPanel'
import { PromptEditorPanel } from './promptBuilder/PromptEditorPanel'
import { PromptHistoryPanels } from './promptBuilder/PromptHistoryPanels'
import { PromptManualForeshadowingPanel } from './promptBuilder/PromptManualForeshadowingPanel'
import {
  restorePromptBuilderFromSnapshot,
  restorePromptBuilderFromVersion
} from './promptBuilder/promptBuilderHistoryState'
import {
  toggleNeedPlanCharacter,
  toggleNeedPlanForeshadowing,
  updateForeshadowingTreatmentOverrides
} from './promptBuilder/promptBuilderNeedPlan'
import { usePromptBuilderHistoryActions } from './promptBuilder/usePromptBuilderHistoryActions'
import { PromptWorkspaceTabs, type PromptWorkspaceTab } from './promptBuilder/PromptWorkspaceTabs'
import { createPromptBuilderSnapshotBinding, type PromptBuilderSnapshotBinding } from './promptBuilder/promptBuilderSnapshotConsistency'

interface ProjectProps {
  data: AppData
  project: Project
  saveData: SaveDataHandler
  onSendToPipeline?: (snapshotId: ID) => void
}

export function PromptBuilderView({ data, project, saveData, onSendToPipeline }: ProjectProps) {
  const confirmAction = useConfirm()
  const scoped = useProjectData(data, project.id)
  const nextChapter = nextChapterOrder(scoped.allChapters, project.id)
  const [targetChapterOrder, setTargetChapterOrder] = useState(nextChapter)
  const [mode, setMode] = useState<PromptMode>(data.settings.defaultPromptMode)
  const [modules, setModules] = useState<PromptModuleSelection>(defaultModulesForMode(data.settings.defaultPromptMode))
  const [task, setTask] = useState<ChapterTask>(createEmptyChapterTask())
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<ID[]>([])
  const [selectedForeshadowingIds, setSelectedForeshadowingIds] = useState<ID[]>([])
  const [foreshadowingTreatmentOverrides, setForeshadowingTreatmentOverrides] = useState<Record<ID, ForeshadowingTreatmentMode>>({})
  const [useContinuityBridge, setUseContinuityBridge] = useState(true)
  const [continuityInstructions, setContinuityInstructions] = useState('')
  const [contextNeedPlan, setContextNeedPlan] = useState<ContextNeedPlan | null>(null)
  const [prompt, setPrompt] = useState('')
  const [snapshotNote, setSnapshotNote] = useState('')
  const [budgetMode, setBudgetMode] = useState<ContextBudgetMode>(data.settings.defaultPromptMode)
  const [budgetMaxTokens, setBudgetMaxTokens] = useState(data.settings.defaultTokenBudget)
  const previousProjectIdRef = useRef(project.id)
  const restoringHistoryRef = useRef(false)
  const [activeTab, setActiveTab] = useState<PromptWorkspaceTab>('task')
  const [workspaceMessage, setWorkspaceMessage] = useState('')
  const [promptBinding, setPromptBinding] = useState<PromptBuilderSnapshotBinding | null>(null)
  const [promptVersionSource, setPromptVersionSource] = useState<PromptVersion | null>(null)
  const [needsRebuild, setNeedsRebuild] = useState(false)
  const [promptManuallyEdited, setPromptManuallyEdited] = useState(false)

  const tokenEstimate = TokenEstimator.estimate(prompt)
  const advice = prompt.trim() ? TokenEstimator.compressionAdvice(tokenEstimate, budgetMaxTokens) : []
  const budgetProfile = useMemo(
    () => createContextBudgetProfile(project.id, budgetMode, budgetMaxTokens, 'Prompt 构建器预算'),
    [project.id, budgetMode, budgetMaxTokens]
  )
  const budgetSelection = useMemo(
    () =>
      selectBudgetContext(project, data, targetChapterOrder, budgetProfile, {
        characterIds: selectedCharacterIds,
        foreshadowingIds: selectedForeshadowingIds,
        chapterTask: task,
        foreshadowingTreatmentOverrides,
        contextNeedPlan,
        selectionMode: 'explicit'
      }),
    [project, data, targetChapterOrder, budgetProfile, selectedCharacterIds, selectedForeshadowingIds, task, foreshadowingTreatmentOverrides, contextNeedPlan]
  )
  const autoForeshadowings = useMemo(
    () => recommendedForeshadowings(scoped.foreshadowings, targetChapterOrder),
    [scoped.foreshadowings, targetChapterOrder]
  )
  const autoForeshadowingIds = useMemo(() => new Set(autoForeshadowings.map((item) => item.id)), [autoForeshadowings])
  const autoCharacters = useMemo(
    () => recommendedCharacters(scoped.characters, autoForeshadowings),
    [scoped.characters, autoForeshadowings]
  )
  const sortedForeshadowings = useMemo(
    () => [...scoped.foreshadowings].sort(compareForeshadowingByStatusWeightUpdatedAt),
    [scoped.foreshadowings]
  )
  const autoCharacterIds = useMemo(() => new Set(autoCharacters.map((item) => item.id)), [autoCharacters])
  const continuity = useMemo(
    () =>
      resolveContinuityBridge({
        projectId: project.id,
        chapters: scoped.chapters,
        bridges: scoped.chapterContinuityBridges,
        targetChapterOrder
      }),
    [project.id, scoped.chapters, scoped.chapterContinuityBridges, targetChapterOrder]
  )
  const previousChapter = useMemo(
    () => scoped.chapters.find((chapter) => chapter.order === targetChapterOrder - 1) ?? null,
    [scoped.chapters, targetChapterOrder]
  )
  const activeStoryDirectionGuide = useMemo(
    () => StoryDirectionService.getActiveGuideForChapter(data.storyDirectionGuides ?? [], project.id, targetChapterOrder),
    [data.storyDirectionGuides, project.id, targetChapterOrder]
  )

  function resetAutomaticSelection() {
    setSelectedForeshadowingIds(autoForeshadowings.map((item) => item.id))
    setSelectedCharacterIds(autoCharacters.map((item) => item.id))
    setForeshadowingTreatmentOverrides({})
  }

  useEffect(() => {
    if (previousProjectIdRef.current === project.id) return
    previousProjectIdRef.current = project.id
    setTargetChapterOrder(nextChapter)
    setMode(data.settings.defaultPromptMode)
    setModules(defaultModulesForMode(data.settings.defaultPromptMode))
    setTask(createEmptyChapterTask())
    setSelectedCharacterIds([])
    setSelectedForeshadowingIds([])
    setForeshadowingTreatmentOverrides({})
    setContextNeedPlan(null)
    setPrompt('')
    setActiveTab('task')
    setWorkspaceMessage('')
    setPromptBinding(null)
    setPromptVersionSource(null)
    setNeedsRebuild(false)
    setPromptManuallyEdited(false)
    setSnapshotNote('')
    setBudgetMode(data.settings.defaultPromptMode)
    setBudgetMaxTokens(data.settings.defaultTokenBudget)
    setUseContinuityBridge(true)
    setContinuityInstructions('')
  }, [data.settings.defaultPromptMode, data.settings.defaultTokenBudget, nextChapter, project.id])

  useEffect(() => {
    if (restoringHistoryRef.current) {
      restoringHistoryRef.current = false
      return
    }
    resetAutomaticSelection()
    setContextNeedPlan(null)
  }, [project.id, targetChapterOrder])

  useEffect(() => {
    const characterIds = new Set(scoped.characters.map((character) => character.id))
    const foreshadowingIds = new Set(scoped.foreshadowings.map((item) => item.id))
    setSelectedCharacterIds((ids) => ids.filter((id) => characterIds.has(id)))
    setSelectedForeshadowingIds((ids) => ids.filter((id) => foreshadowingIds.has(id)))
    setForeshadowingTreatmentOverrides((overrides) =>
      Object.fromEntries(Object.entries(overrides).filter(([id]) => foreshadowingIds.has(id)))
    )
  }, [scoped.characters, scoped.foreshadowings])

  function changeMode(nextMode: PromptMode) {
    setMode(nextMode)
    setBudgetMode(nextMode)
    setModules(defaultModulesForMode(nextMode))
  }

  function toggleId(list: ID[], id: ID, checked: boolean): ID[] {
    return checked ? [...new Set([...list, id])] : list.filter((item) => item !== id)
  }

  function buildPromptResult(): BuildPromptResult {
    return PromptBuilderService.buildResult({
      project,
      bible: scoped.bible,
      chapters: scoped.chapters,
      characters: scoped.characters,
      characterStateLogs: scoped.characterStateLogs,
      characterStateFacts: scoped.characterStateFacts,
      foreshadowings: scoped.foreshadowings,
      timelineEvents: scoped.timelineEvents,
      stageSummaries: scoped.stageSummaries,
      chapterContinuityBridges: scoped.chapterContinuityBridges,
      budgetProfile,
      contextNeedPlan,
      storyDirectionGuide: activeStoryDirectionGuide,
      hardCanonPack: scoped.hardCanonPacks[0] ?? null,
      config: {
        projectId: project.id,
        targetChapterOrder,
        mode,
        modules,
        task,
        selectedCharacterIds,
        selectedForeshadowingIds,
        foreshadowingTreatmentOverrides,
        continuityInstructions,
        useContinuityBridge
      }
    })
  }

  async function generatePrompt() {
    if (promptManuallyEdited && !await confirmAction({
      title: '重新构建 Prompt',
      message: '编辑区包含手动修改。重新构建会替换这些文字，已保存的版本和快照不受影响。',
      confirmLabel: '重新构建'
    })) return
    clearHistoryFeedback()
    const result = buildPromptResult()
    setPrompt(result.finalPrompt)
    setPromptVersionSource(null)
    setPromptBinding(createPromptBuilderSnapshotBinding({
      projectId: project.id, targetChapterOrder, budgetMode, promptMode: mode,
      moduleSelection: modules, continuityInstructions, useContinuityBridge,
      budgetProfile, budgetSelection, result
    }))
    setNeedsRebuild(false)
    setPromptManuallyEdited(false)
    setActiveTab('editor')
    setWorkspaceMessage('Prompt 已构建')
  }

  async function generateContextNeedPlan() {
    setNeedsRebuild(Boolean(prompt.trim()))
    const plan = ContextNeedPlannerService.buildFromChapterIntent({
      project,
      storyBible: scoped.bible,
      targetChapterOrder,
      chapterTaskDraft: task,
      previousChapter,
      continuityBridge: continuity.bridge,
      characters: scoped.characters,
      characterStateFacts: scoped.characterStateFacts,
      foreshadowing: scoped.foreshadowings,
      timelineEvents: scoped.timelineEvents,
      stageSummaries: scoped.stageSummaries,
      hardCanonItems: scoped.hardCanonPacks.flatMap((pack) => pack.items),
      storyDirectionGuide: activeStoryDirectionGuide,
      storyDirectionPromptText: StoryDirectionService.formatForPrompt(activeStoryDirectionGuide, targetChapterOrder),
      source: 'prompt_builder'
    })
    setContextNeedPlan(plan)
    setSelectedCharacterIds((current) => [...new Set([...current, ...plan.expectedCharacters.map((item) => item.characterId)])])
    setSelectedForeshadowingIds((current) => [...new Set([...current, ...plan.requiredForeshadowingIds])].filter((id) => !plan.forbiddenForeshadowingIds.includes(id)))
    await saveData((current) => ({
      ...current,
      contextNeedPlans: [plan, ...current.contextNeedPlans.filter((item) => item.id !== plan.id)]
    }))
  }

  async function copyPrompt() {
    if (!prompt.trim()) return
    try {
      await getNovelDirectorClipboardApi().writeText(prompt)
      setWorkspaceMessage('已复制 Prompt')
    } catch {
      setWorkspaceMessage('复制失败，请重试')
    }
  }

  const {
    deleteContextSnapshot,
    deletePromptVersion,
    saveContextSnapshot,
    savePromptVersion,
    sendToPipeline,
    isSaving,
    historyMessage,
    historyError,
    clearHistoryFeedback
  } = usePromptBuilderHistoryActions({
    projectId: project.id,
    targetChapterOrder,
    promptMode: mode,
    budgetMode,
    budgetProfile,
    modules,
    task,
    continuityInstructions,
    useContinuityBridge,
    prompt,
    promptBinding,
    promptVersionSource,
    snapshotNote,
    budgetSelection,
    buildPromptResult,
    saveData,
    onPromptNormalized: setPrompt,
    onPromptBindingChange: (binding) => { setPromptBinding(binding); setPromptVersionSource(null) },
    onSendToPipeline
  })

  function updateForeshadowingTreatmentOverride(id: ID, nextMode: ForeshadowingTreatmentMode) {
    setForeshadowingTreatmentOverrides((current) => updateForeshadowingTreatmentOverrides(current, id, nextMode))
  }

  function loadContextSnapshot(snapshot: PromptContextSnapshot) {
    clearHistoryFeedback()
    setWorkspaceMessage('已载入上下文快照')
    const restored = restorePromptBuilderFromSnapshot(snapshot, mode)
    restoringHistoryRef.current = restored.targetChapterOrder !== targetChapterOrder
    setTargetChapterOrder(restored.targetChapterOrder)
    setMode(restored.promptMode)
    setBudgetMode(restored.budgetMode)
    setBudgetMaxTokens(restored.budgetMaxTokens)
    setModules(restored.modules)
    setTask(restored.task)
    setSelectedCharacterIds(restored.selectedCharacterIds)
    setSelectedForeshadowingIds(restored.selectedForeshadowingIds)
    setForeshadowingTreatmentOverrides(restored.foreshadowingTreatmentOverrides)
    setContextNeedPlan(restored.contextNeedPlan)
    setContinuityInstructions(restored.continuityInstructions)
    setUseContinuityBridge(restored.useContinuityBridge)
    setPrompt(restored.prompt)
    setSnapshotNote(restored.snapshotNote)
    setPromptBinding(restored.promptBinding)
    setPromptVersionSource(null)
    setNeedsRebuild(false)
    setPromptManuallyEdited(false)
    setActiveTab('editor')
  }

  function loadPromptVersion(version: PromptVersion) {
    clearHistoryFeedback()
    setWorkspaceMessage('已载入 Prompt 版本')
    const restored = restorePromptBuilderFromVersion(version)
    const targetChanged = restored.targetChapterOrder !== targetChapterOrder
    setTargetChapterOrder(restored.targetChapterOrder)
    setMode(restored.promptMode)
    setBudgetMode(restored.budgetMode)
    setModules(restored.modules)
    setTask(restored.task)
    setPrompt(restored.prompt)
    setActiveTab('editor')
    setPromptBinding(restored.promptBinding)
    setPromptVersionSource(version)
    setNeedsRebuild(false)
    setPromptManuallyEdited(false)
    setContextNeedPlan(null)
    setForeshadowingTreatmentOverrides({})
    if (!targetChanged) resetAutomaticSelection()
  }

  async function saveForeshadowingTreatmentMode(id: ID) {
    const nextMode = foreshadowingTreatmentOverrides[id]
    if (!nextMode) return
    await saveData((current) => ({
      ...current,
      foreshadowings: current.foreshadowings.map((item) =>
        item.id === id && item.projectId === project.id ? { ...item, treatmentMode: nextMode, updatedAt: now() } : item
      )
    }))
  }

  function updateNeedPlanCharacter(characterId: ID, checked: boolean) {
    if (!contextNeedPlan) return
    const character = scoped.characters.find((item) => item.id === characterId)
    if (!character) return
    setContextNeedPlan(toggleNeedPlanCharacter(contextNeedPlan, character, task, checked))
    setSelectedCharacterIds((current) => toggleId(current, characterId, checked))
  }

  function updateNeedPlanForeshadowing(id: ID, role: 'required' | 'forbidden', checked: boolean) {
    if (!contextNeedPlan) return
    setContextNeedPlan(toggleNeedPlanForeshadowing(contextNeedPlan, id, role, checked))
    if (role === 'required' && checked) {
      setSelectedForeshadowingIds((current) => toggleId(current, id, true))
    }
    if (role === 'forbidden' && checked) {
      setSelectedForeshadowingIds((current) => toggleId(current, id, false))
    }
  }

  return (
    <div className="prompt-view">
      <Header title="Prompt 构建器" />
      <div className="prompt-command-bar">
        <span className="prompt-command-target">第 {targetChapterOrder} 章</span>
        <div className="row-actions">
          <button className={prompt.trim() ? 'secondary-button' : 'primary-button'} disabled={isSaving} onClick={generatePrompt}><WandSparkles size={16} aria-hidden="true" />构建 Prompt</button>
          <button className="ghost-button" aria-label="复制 Prompt" title="复制 Prompt" disabled={!prompt.trim()} onClick={() => void copyPrompt()}><Copy size={16} aria-hidden="true" /></button>
          <button className="ghost-button" title="保存版本" disabled={isSaving || !prompt.trim()} onClick={() => { setWorkspaceMessage(''); void savePromptVersion() }}><Save size={16} aria-hidden="true" />保存版本</button>
          <button className="ghost-button" title="保存上下文快照" disabled={isSaving} onClick={() => { setWorkspaceMessage(''); void saveContextSnapshot() }}><Layers size={16} aria-hidden="true" />保存快照</button>
          {onSendToPipeline && <button disabled={isSaving} className={prompt.trim() ? 'primary-button' : 'secondary-button'} onClick={() => { setWorkspaceMessage(''); void sendToPipeline() }}>发送到生产流水线<ArrowRight size={16} aria-hidden="true" /></button>}
        </div>
      </div>
      <p className="prompt-workspace-message" role="status">{isSaving ? '正在保存...' : workspaceMessage || historyMessage}</p>
      {historyError && <p className="notice danger" role="alert">{historyError}</p>}
      {needsRebuild && prompt.trim() && <p className="notice">任务或上下文已调整，当前 Prompt 尚未更新{promptBinding ? `，仍对应第 ${promptBinding.targetChapterOrder} 章` : ''}。重新构建会替换编辑区中的文本。</p>}
      <section className="prompt-layout prompt-workbench">
        <fieldset className="prompt-control-fieldset" disabled={isSaving} onChangeCapture={() => setNeedsRebuild(Boolean(prompt.trim()))}>
        <PromptControlPanel
          targetChapterOrder={targetChapterOrder}
          mode={mode}
          budgetMode={budgetMode}
          budgetMaxTokens={budgetMaxTokens}
          tokenEstimate={tokenEstimate}
          modules={modules}
          advice={advice}
          onTargetChapterOrderChange={(value) => setTargetChapterOrder(value ?? 1)}
          onModeChange={changeMode}
          onBudgetModeChange={setBudgetMode}
          onBudgetMaxTokensChange={(value) => setBudgetMaxTokens(value ?? data.settings.defaultTokenBudget)}
          onModulesChange={setModules}
          onResetAutomaticSelection={() => { resetAutomaticSelection(); setNeedsRebuild(Boolean(prompt.trim())) }}
        />
        </fieldset>

        <div className="prompt-main">
          <PromptWorkspaceTabs activeTab={activeTab} onChange={setActiveTab} />
          <fieldset className="prompt-content-fieldset" disabled={isSaving}>
          <div id="prompt-workspace-panel-task" role="tabpanel" aria-labelledby="prompt-workspace-tab-task" hidden={activeTab !== 'task'}>
            <PromptChapterTaskPanel task={task} onTaskChange={(value) => { setTask(value); setNeedsRebuild(Boolean(prompt.trim())) }} />
          </div>
          <div id="prompt-workspace-panel-editor" role="tabpanel" aria-labelledby="prompt-workspace-tab-editor" hidden={activeTab !== 'editor'}>
            <PromptEditorPanel prompt={prompt} snapshotNote={snapshotNote} onPromptChange={(value) => { setPrompt(value); setPromptManuallyEdited(true) }} onSnapshotNoteChange={setSnapshotNote} />
          </div>
          <div id="prompt-workspace-panel-history" role="tabpanel" aria-labelledby="prompt-workspace-tab-history" hidden={activeTab !== 'history'}>
            <PromptHistoryPanels
              promptContextSnapshots={scoped.promptContextSnapshots}
              promptVersions={scoped.promptVersions}
              onLoadSnapshot={loadContextSnapshot}
              onSendSnapshotToPipeline={onSendToPipeline}
              onDeleteSnapshot={(id) => void deleteContextSnapshot(id)}
              onLoadPromptVersion={loadPromptVersion}
              onDeletePromptVersion={(id) => void deletePromptVersion(id)}
            />
          </div>
          <div id="prompt-workspace-panel-context" role="tabpanel" aria-labelledby="prompt-workspace-tab-context" hidden={activeTab !== 'context'} onChangeCapture={() => setNeedsRebuild(Boolean(prompt.trim()))}>
          <PromptBudgetPanel
            budgetProfile={budgetProfile}
            budgetSelection={budgetSelection}
            chapters={scoped.chapters}
            characters={scoped.characters}
            foreshadowings={scoped.foreshadowings}
          />

          <PromptContextNeedPanel
            contextNeedPlan={contextNeedPlan}
            characters={scoped.characters}
            foreshadowings={sortedForeshadowings}
            onGenerate={() => void generateContextNeedPlan()}
            onChange={setContextNeedPlan}
            onToggleCharacter={updateNeedPlanCharacter}
            onToggleForeshadowing={updateNeedPlanForeshadowing}
          />

          <PromptContinuityPanel
            previousChapter={previousChapter}
            continuity={continuity}
            useContinuityBridge={useContinuityBridge}
            continuityInstructions={continuityInstructions}
            onUseContinuityBridgeChange={setUseContinuityBridge}
            onContinuityInstructionsChange={setContinuityInstructions}
          />

          <PromptCharacterSelectionPanel
            characters={scoped.characters}
            automaticallyRecommendedIds={autoCharacterIds}
            selectedCharacterIds={selectedCharacterIds}
            onToggleCharacter={(id, checked) =>
              setSelectedCharacterIds((current) => toggleId(current, id, checked))
            }
          />

          <PromptManualForeshadowingPanel
            foreshadowings={sortedForeshadowings}
            autoForeshadowingIds={autoForeshadowingIds}
            selectedForeshadowingIds={selectedForeshadowingIds}
            treatmentOverrides={foreshadowingTreatmentOverrides}
            onToggleForeshadowing={(id, checked) => setSelectedForeshadowingIds(toggleId(selectedForeshadowingIds, id, checked))}
            onTreatmentOverrideChange={updateForeshadowingTreatmentOverride}
            onSaveTreatmentMode={(id) => void saveForeshadowingTreatmentMode(id)}
          />
          </div>
          </fieldset>
        </div>
      </section>
    </div>
  )
}
