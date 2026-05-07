import { useEffect, useMemo, useState } from 'react'
import type {
  AppData,
  BuildPromptResult,
  ChapterTask,
  ContextBudgetMode,
  ForeshadowingTreatmentMode,
  ID,
  Project,
  PromptContextSnapshot,
  PromptContextSnapshotSource,
  PromptMode,
  PromptModuleSelection
} from '../../../shared/types'
import { createEmptyChapterTask, defaultModulesForMode } from '../../../shared/defaults'
import {
  effectiveTreatmentMode,
  FORESHADOWING_TREATMENT_OPTIONS,
  treatmentDescription
} from '../../../shared/foreshadowingTreatment'
import { ContextBudgetManager } from '../../../services/ContextBudgetManager'
import { endingExcerpt, resolveContinuityBridge } from '../../../services/ContinuityService'
import { PromptBuilderService } from '../../../services/PromptBuilderService'
import { TokenEstimator } from '../../../services/TokenEstimator'
import { NumberInput, SelectField, TextArea, TextInput, Toggle } from '../components/FormFields'
import { Header } from '../components/Layout'
import { StatCard, TokenBudgetMeter } from '../components/UI'
import { formatDate, modeLabel, newId, now, statusLabel, treatmentModeLabel, weightLabel } from '../utils/format'
import { projectData } from '../utils/projectData'
import {
  createContextBudgetProfile,
  recommendedCharacters,
  recommendedForeshadowings,
  selectBudgetContext
} from '../utils/promptContext'
import type { SaveDataInput } from '../utils/saveDataState'

interface ProjectProps {
  data: AppData
  project: Project
  saveData: (next: SaveDataInput) => Promise<void>
  onSendToPipeline?: (snapshotId: ID) => void
}

const moduleLabels: Record<keyof PromptModuleSelection, string> = {
  bible: '全书核心设定',
  progress: '当前剧情进度',
  recentChapters: '最近章节回顾',
  characters: '主要角色状态',
  foreshadowing: '当前相关伏笔',
  stageSummaries: '阶段摘要档案',
  timeline: '时间线校验',
  chapterTask: '当前章节任务书',
  forbidden: '本章禁止事项',
  outputFormat: '输出格式要求'
}

function safeModeLabel(mode: ContextBudgetMode): string {
  return mode === 'custom' ? '自定义模式' : modeLabel(mode)
}

export function PromptBuilderView({ data, project, saveData, onSendToPipeline }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const nextChapter = Math.max(0, ...scoped.chapters.map((chapter) => chapter.order)) + 1
  const [targetChapterOrder, setTargetChapterOrder] = useState(nextChapter)
  const [mode, setMode] = useState<PromptMode>(data.settings.defaultPromptMode)
  const [modules, setModules] = useState<PromptModuleSelection>(defaultModulesForMode(data.settings.defaultPromptMode))
  const [task, setTask] = useState<ChapterTask>(createEmptyChapterTask())
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<ID[]>([])
  const [selectedForeshadowingIds, setSelectedForeshadowingIds] = useState<ID[]>([])
  const [foreshadowingTreatmentOverrides, setForeshadowingTreatmentOverrides] = useState<Record<ID, ForeshadowingTreatmentMode>>({})
  const [useContinuityBridge, setUseContinuityBridge] = useState(true)
  const [continuityInstructions, setContinuityInstructions] = useState('')
  const [prompt, setPrompt] = useState('')
  const [snapshotNote, setSnapshotNote] = useState('')
  const [budgetMode, setBudgetMode] = useState<ContextBudgetMode>(data.settings.defaultPromptMode)
  const [budgetMaxTokens, setBudgetMaxTokens] = useState(data.settings.defaultTokenBudget)

  const tokenEstimate = TokenEstimator.estimate(prompt)
  const advice = TokenEstimator.compressionAdvice(tokenEstimate, budgetMaxTokens)
  const budgetProfile = useMemo(
    () => createContextBudgetProfile(project.id, budgetMode, budgetMaxTokens, 'Prompt 构建器预算'),
    [project.id, budgetMode, budgetMaxTokens]
  )
  const budgetSelection = useMemo(
    () =>
      selectBudgetContext(project, data, targetChapterOrder, budgetProfile, {
        characterIds: selectedCharacterIds,
        foreshadowingIds: selectedForeshadowingIds
      }),
    [project, data, targetChapterOrder, budgetProfile, selectedCharacterIds, selectedForeshadowingIds]
  )
  const autoForeshadowings = useMemo(
    () => recommendedForeshadowings(scoped.foreshadowings, targetChapterOrder),
    [scoped.foreshadowings, targetChapterOrder]
  )
  const autoCharacters = useMemo(
    () => recommendedCharacters(scoped.characters, autoForeshadowings),
    [scoped.characters, autoForeshadowings]
  )
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

  function resetAutomaticSelection() {
    setSelectedForeshadowingIds(autoForeshadowings.map((item) => item.id))
    setSelectedCharacterIds(autoCharacters.map((item) => item.id))
    setForeshadowingTreatmentOverrides({})
  }

  useEffect(() => {
    resetAutomaticSelection()
  }, [project.id, targetChapterOrder])

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
      foreshadowings: scoped.foreshadowings,
      timelineEvents: scoped.timelineEvents,
      stageSummaries: scoped.stageSummaries,
      chapterContinuityBridges: scoped.chapterContinuityBridges,
      budgetProfile,
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

  function generatePrompt() {
    const result = buildPromptResult()
    setPrompt(result.finalPrompt)
  }

  async function copyPrompt() {
    if (!prompt.trim()) return
    await window.novelDirector.clipboard.writeText(prompt)
  }

  async function savePromptVersion() {
    if (!prompt.trim()) return
    await saveData({
      ...data,
      promptVersions: [
        {
          id: newId(),
          projectId: project.id,
          targetChapterOrder,
          title: `第 ${targetChapterOrder} 章 ${modeLabel(mode)} ${formatDate(now())}`,
          mode,
          content: prompt,
          tokenEstimate,
          moduleSelection: modules,
          task,
          createdAt: now()
        },
        ...data.promptVersions
      ]
    })
  }

  async function saveContextSnapshot(source: PromptContextSnapshotSource = 'manual'): Promise<PromptContextSnapshot | null> {
    const result = buildPromptResult()
    const finalPrompt = prompt.trim() ? prompt : result.finalPrompt
    if (!finalPrompt.trim()) return null
    const timestamp = now()
    const snapshot: PromptContextSnapshot = {
      id: newId(),
      projectId: project.id,
      targetChapterOrder,
      mode: budgetMode,
      budgetProfileId: budgetProfile.id,
      budgetProfile,
      contextSelectionResult: result.contextSelectionResult ?? budgetSelection,
      selectedCharacterIds: result.selectedCharacterIds,
      selectedForeshadowingIds: result.selectedForeshadowingIds,
      foreshadowingTreatmentOverrides: result.foreshadowingTreatmentOverrides,
      chapterTask: result.chapterTask,
      finalPrompt,
      estimatedTokens: TokenEstimator.estimate(finalPrompt),
      source,
      note: snapshotNote,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData({
      ...data,
      promptContextSnapshots: [snapshot, ...data.promptContextSnapshots],
      contextBudgetProfiles: data.contextBudgetProfiles.some((profile) => profile.id === budgetProfile.id)
        ? data.contextBudgetProfiles
        : [budgetProfile, ...data.contextBudgetProfiles]
    })
    if (!prompt.trim()) setPrompt(finalPrompt)
    return snapshot
  }

  async function sendToPipeline() {
    const snapshot = await saveContextSnapshot('manual')
    if (snapshot) onSendToPipeline?.(snapshot.id)
  }

  async function deleteContextSnapshot(id: ID) {
    if (!confirm('确定删除这个上下文快照吗？依赖它的流水线任务会提示快照已丢失。')) return
    await saveData({ ...data, promptContextSnapshots: data.promptContextSnapshots.filter((snapshot) => snapshot.id !== id) })
  }

  async function deletePromptVersion(id: ID) {
    if (!confirm('确定删除这个 Prompt 版本吗？')) return
    await saveData({ ...data, promptVersions: data.promptVersions.filter((version) => version.id !== id) })
  }

  function updateForeshadowingTreatmentOverride(id: ID, nextMode: ForeshadowingTreatmentMode) {
    setForeshadowingTreatmentOverrides((current) => ({ ...current, [id]: nextMode }))
  }

  async function saveForeshadowingTreatmentMode(id: ID) {
    const nextMode = foreshadowingTreatmentOverrides[id]
    if (!nextMode) return
    await saveData({
      ...data,
      foreshadowings: data.foreshadowings.map((item) =>
        item.id === id && item.projectId === project.id ? { ...item, treatmentMode: nextMode, updatedAt: now() } : item
      )
    })
  }

  return (
    <div className="prompt-view">
      <Header title="Prompt 构建器" description="把上下文选择、预算、伏笔调度和章节衔接整理成可执行的写作 Prompt。" />
      <section className="prompt-layout prompt-workbench">
        <aside className="panel prompt-controls">
          <div className="prompt-controls-head">
            <span className="chapter-kicker">Context Console</span>
            <h2>上下文控制</h2>
          </div>
          <NumberInput label="准备写第 N 章" value={targetChapterOrder} min={1} onChange={(value) => setTargetChapterOrder(value ?? 1)} />
          <SelectField<PromptMode>
            label="Prompt 模式"
            value={mode}
            onChange={changeMode}
            options={[
              { value: 'light', label: '轻量模式' },
              { value: 'standard', label: '标准模式' },
              { value: 'full', label: '完整模式' }
            ]}
          />
          <SelectField<ContextBudgetMode>
            label="记忆预算模式"
            value={budgetMode}
            onChange={setBudgetMode}
            options={[
              { value: 'light', label: '轻量' },
              { value: 'standard', label: '标准' },
              { value: 'full', label: '完整' },
              { value: 'custom', label: '自定义' }
            ]}
          />
          <NumberInput
            label="上下文预算 token"
            min={1000}
            value={budgetMaxTokens}
            onChange={(value) => setBudgetMaxTokens(value ?? data.settings.defaultTokenBudget)}
          />
          <div className="module-box">
            <h3>上下文模块</h3>
            {(Object.keys(modules) as Array<keyof PromptModuleSelection>).map((key) => (
              <Toggle key={key} label={moduleLabels[key]} checked={modules[key]} onChange={(checked) => setModules({ ...modules, [key]: checked })} />
            ))}
          </div>
          <button className="ghost-button" onClick={resetAutomaticSelection}>恢复自动推荐</button>
          <TokenBudgetMeter value={tokenEstimate} max={budgetMaxTokens} label="最终 Prompt" />
          <ul className="advice-list">
            {advice.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </aside>

        <div className="prompt-main">
          <section className="panel prompt-budget-panel">
            <h2>记忆预算调度</h2>
            <p className="muted">{ContextBudgetManager.explainSelection(budgetSelection)}</p>
            <TokenBudgetMeter value={budgetSelection.estimatedTokens} max={budgetProfile.maxTokens} label="上下文选择" />
            <div className="metric-grid prompt-budget-stats">
              <StatCard label="纳入章节" value={budgetSelection.selectedChapterIds.length} tone="accent" />
              <StatCard label="纳入角色" value={budgetSelection.selectedCharacterIds.length} tone="success" />
              <StatCard label="纳入伏笔" value={budgetSelection.selectedForeshadowingIds.length} tone="warning" />
              <StatCard label="省略项目" value={budgetSelection.omittedItems.length} tone="info" />
            </div>
            <div className="budget-columns">
              <div>
                <h3>已选择内容</h3>
                <ul className="advice-list">
                  <li>章节：{scoped.chapters.filter((chapter) => budgetSelection.selectedChapterIds.includes(chapter.id)).map((chapter) => `第 ${chapter.order} 章`).join('、') || '无'}</li>
                  <li>角色：{scoped.characters.filter((character) => budgetSelection.selectedCharacterIds.includes(character.id)).map((character) => character.name).join('、') || '无'}</li>
                  <li>伏笔：{scoped.foreshadowings.filter((item) => budgetSelection.selectedForeshadowingIds.includes(item.id)).map((item) => item.title).join('、') || '无'}</li>
                </ul>
              </div>
              <div>
                <h3>省略与风险</h3>
                <ul className="advice-list">
                  {budgetSelection.omittedItems.slice(0, 6).map((item, index) => (
                    <li key={`${item.type}-${item.id ?? index}`}>{item.type}：{item.reason}</li>
                  ))}
                  {budgetSelection.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title-row">
              <h2>章节衔接</h2>
              <Toggle label="使用衔接桥" checked={useContinuityBridge} onChange={setUseContinuityBridge} />
            </div>
            <p className="muted">
              上一章：{previousChapter ? `第 ${previousChapter.order} 章 ${previousChapter.title || '未命名'}` : '暂无上一章'} · 来源：
              {continuity.source === 'saved_bridge' ? '已保存衔接桥' : continuity.source === 'auto_from_previous_ending' ? '上一章结尾片段兜底' : '暂无'}
            </p>
            {previousChapter ? (
              <div className="context-item">
                <strong>上一章结尾片段</strong>
                <p className="muted">{endingExcerpt(previousChapter, 500) || '暂无正文片段'}</p>
              </div>
            ) : null}
            {continuity.bridge ? (
              <div className="stack-list">
                <p><strong>下一章开头必须接住：</strong>{continuity.bridge.immediateNextBeat || continuity.bridge.mustContinueFrom || '待补充'}</p>
                <p><strong>禁止重置：</strong>{continuity.bridge.mustNotReset || '不要重新介绍已有环境、机关和设定。'}</p>
                <p><strong>开放小张力：</strong>{continuity.bridge.openMicroTensions || '待补充'}</p>
              </div>
            ) : null}
            <TextArea label="本章衔接补充指令" value={continuityInstructions} rows={4} onChange={setContinuityInstructions} />
          </section>

          <section className="panel">
            <h2>手动选择本章相关角色</h2>
            <div className="checkbox-grid">
              {scoped.characters.map((character) => (
                <Toggle
                  key={character.id}
                  label={`${character.name}${autoCharacters.some((item) => item.id === character.id) ? '（自动推荐）' : ''}`}
                  checked={selectedCharacterIds.includes(character.id)}
                  onChange={(checked) => setSelectedCharacterIds(toggleId(selectedCharacterIds, character.id, checked))}
                />
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>手动选择本章相关伏笔</h2>
            <div className="stack-list">
              {scoped.foreshadowings.map((item) => {
                const isAuto = autoForeshadowings.some((auto) => auto.id === item.id)
                const effectiveMode = effectiveTreatmentMode(item, foreshadowingTreatmentOverrides)
                return (
                  <div key={item.id} className="context-item">
                    <Toggle
                      label={`${item.title || '未命名伏笔'}${isAuto ? '（自动推荐）' : ''}`}
                      checked={selectedForeshadowingIds.includes(item.id)}
                      onChange={(checked) => setSelectedForeshadowingIds(toggleId(selectedForeshadowingIds, item.id, checked))}
                    />
                    <p className="muted">
                      状态：{statusLabel(item.status)} · 权重：{weightLabel(item.weight)} · 预计回收：{item.expectedPayoff || '未设置'} · 本章处理：{treatmentModeLabel(effectiveMode)}
                    </p>
                    <div className="inline-controls">
                      <SelectField<ForeshadowingTreatmentMode>
                        label="临时处理方式"
                        value={effectiveMode}
                        onChange={(nextMode) => updateForeshadowingTreatmentOverride(item.id, nextMode)}
                        options={FORESHADOWING_TREATMENT_OPTIONS}
                      />
                      <button className="ghost-button" onClick={() => saveForeshadowingTreatmentMode(item.id)}>保存为当前处理方式</button>
                    </div>
                    <p className="muted">{treatmentDescription(effectiveMode)}</p>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="panel">
            <h2>当前章节任务书</h2>
            <div className="form-grid">
              <TextArea label="本章目标" value={task.goal} onChange={(goal) => setTask({ ...task, goal })} />
              <TextArea label="本章必须推进的冲突" value={task.conflict} onChange={(conflict) => setTask({ ...task, conflict })} />
              <TextArea label="本章必须保留的悬念" value={task.suspenseToKeep} onChange={(suspenseToKeep) => setTask({ ...task, suspenseToKeep })} />
              <TextArea label="本章允许回收的伏笔" value={task.allowedPayoffs} onChange={(allowedPayoffs) => setTask({ ...task, allowedPayoffs })} />
              <TextArea label="本章禁止回收的伏笔" value={task.forbiddenPayoffs} onChange={(forbiddenPayoffs) => setTask({ ...task, forbiddenPayoffs })} />
              <TextArea label="本章结尾钩子" value={task.endingHook} onChange={(endingHook) => setTask({ ...task, endingHook })} />
              <TextArea label="本章读者应该产生的情绪" value={task.readerEmotion} onChange={(readerEmotion) => setTask({ ...task, readerEmotion })} />
              <TextInput label="本章预计字数" value={task.targetWordCount} onChange={(targetWordCount) => setTask({ ...task, targetWordCount })} />
              <TextArea label="文风要求" value={task.styleRequirement} onChange={(styleRequirement) => setTask({ ...task, styleRequirement })} />
            </div>
            <div className="row-actions">
              <button className="primary-button" onClick={generatePrompt}>生成 Prompt</button>
              <button className="ghost-button" onClick={copyPrompt}>复制 Prompt</button>
              <button className="ghost-button" onClick={savePromptVersion}>保存版本</button>
              <button className="ghost-button" onClick={() => saveContextSnapshot()}>保存上下文快照</button>
              <button className="primary-button" onClick={sendToPipeline}>发送到生产流水线</button>
            </div>
          </section>

          <section className="panel prompt-editor-panel">
            <div className="panel-title-row sticky-title-row">
              <h2>最终 Prompt</h2>
              <div className="row-actions">
                <button className="primary-button" onClick={copyPrompt}>复制 Prompt</button>
                <button className="ghost-button" onClick={savePromptVersion}>保存版本</button>
                <button className="ghost-button" onClick={() => saveContextSnapshot()}>保存快照</button>
              </div>
            </div>
            <TextInput label="快照备注" value={snapshotNote} onChange={setSnapshotNote} />
            <textarea className="prompt-editor" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </section>

          <section className="panel">
            <h2>上下文快照</h2>
            <p className="muted">快照保存的是上下文选择、预算、任务书和最终 Prompt；生产流水线可以直接使用它作为执行输入。</p>
            <div className="version-list">
              {scoped.promptContextSnapshots.length === 0 ? (
                <p className="muted">暂无上下文快照。</p>
              ) : (
                scoped.promptContextSnapshots.map((snapshot) => (
                  <div key={snapshot.id} className="version-row">
                    <button onClick={() => setPrompt(snapshot.finalPrompt)}>
                      <strong>第 {snapshot.targetChapterOrder} 章 · {safeModeLabel(snapshot.mode)}</strong>
                      <span>
                        {snapshot.estimatedTokens} token · 角色 {snapshot.selectedCharacterIds.length} · 伏笔 {snapshot.selectedForeshadowingIds.length} · {formatDate(snapshot.createdAt)}
                      </span>
                      {snapshot.note ? <span>{snapshot.note}</span> : null}
                    </button>
                    <button className="ghost-button" onClick={() => onSendToPipeline?.(snapshot.id)}>发送到流水线</button>
                    <button className="danger-button" onClick={() => deleteContextSnapshot(snapshot.id)}>删除快照</button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <h2>已保存版本</h2>
            <div className="version-list">
              {scoped.promptVersions.map((version) => (
                <div key={version.id} className="version-row">
                  <button onClick={() => setPrompt(version.content)}>
                    <strong>{version.title}</strong>
                    <span>{version.tokenEstimate} token · {formatDate(version.createdAt)}</span>
                  </button>
                  <button className="danger-button" onClick={() => deletePromptVersion(version.id)}>删除版本</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}
