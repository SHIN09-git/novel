import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, ContextBudgetMode, ID, PipelineContextSource, PipelineMode, Project } from '../../../../shared/types'
import { nextChapterOrder } from '../../../../services/ChapterLifecycleService'
import type { projectData } from '../../utils/projectData'
import { addReaderEmotionPreset, loadReaderEmotionState, rememberReaderEmotionTarget } from '../../utils/readerEmotionPresets'

type ScopedProjectData = ReturnType<typeof projectData>

interface UsePipelineConfigStateArgs {
  project: Project
  settings: AppSettings
  scoped: ScopedProjectData
  initialSnapshotId?: ID | null
  onInitialSnapshotConsumed?: () => void
}

export function usePipelineConfigState({
  project,
  settings,
  scoped,
  initialSnapshotId,
  onInitialSnapshotConsumed
}: UsePipelineConfigStateArgs) {
  const nextChapter = nextChapterOrder(scoped.allChapters, project.id)
  const [targetChapterOrder, setTargetChapterOrder] = useState(nextChapter)
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('standard')
  const [estimatedWordCount, setEstimatedWordCount] = useState('3000-5000')
  const [readerEmotionTarget, setReaderEmotionTarget] = useState(() => {
    const emotionState = loadReaderEmotionState(project.id)
    return emotionState.lastTarget || project.coreAppeal || ''
  })
  const [readerEmotionPresets, setReaderEmotionPresets] = useState(() => loadReaderEmotionState(project.id).presets)
  const [newReaderEmotionPreset, setNewReaderEmotionPreset] = useState('')
  const [budgetMode, setBudgetMode] = useState<ContextBudgetMode>(settings.defaultPromptMode)
  const [budgetMaxTokens, setBudgetMaxTokens] = useState(settings.defaultTokenBudget)
  const [contextSource, setContextSource] = useState<PipelineContextSource>(initialSnapshotId ? 'prompt_snapshot' : 'auto')
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<ID | null>(initialSnapshotId ?? null)
  const [selectedJobId, setSelectedJobId] = useState<ID | null>(scoped.chapterGenerationJobs[0]?.id ?? null)
  const previousProjectIdRef = useRef(project.id)

  const snapshots = useMemo(
    () => [...scoped.promptContextSnapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [scoped.promptContextSnapshots]
  )
  const selectedSnapshot = selectedSnapshotId ? snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? null : null

  useEffect(() => {
    if (selectedSnapshotId && !snapshots.some((snapshot) => snapshot.id === selectedSnapshotId)) {
      setSelectedSnapshotId(null)
      setContextSource('auto')
    }
  }, [selectedSnapshotId, snapshots])

  useEffect(() => {
    const jobs = [...scoped.chapterGenerationJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (!selectedJobId && jobs[0]) setSelectedJobId(jobs[0].id)
    if (selectedJobId && !jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(jobs[0]?.id ?? null)
    }
  }, [scoped.chapterGenerationJobs, selectedJobId])

  useEffect(() => {
    const emotionState = loadReaderEmotionState(project.id)
    setReaderEmotionPresets(emotionState.presets)
    setReaderEmotionTarget(emotionState.lastTarget || project.coreAppeal || '')
    setNewReaderEmotionPreset('')
  }, [project.coreAppeal, project.id])

  useEffect(() => {
    if (previousProjectIdRef.current === project.id) return
    previousProjectIdRef.current = project.id
    const jobs = [...scoped.chapterGenerationJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    setTargetChapterOrder(nextChapter)
    setPipelineMode('standard')
    setEstimatedWordCount('3000-5000')
    setBudgetMode(settings.defaultPromptMode)
    setBudgetMaxTokens(settings.defaultTokenBudget)
    setContextSource(initialSnapshotId ? 'prompt_snapshot' : 'auto')
    setSelectedSnapshotId(initialSnapshotId ?? null)
    setSelectedJobId(jobs[0]?.id ?? null)
  }, [initialSnapshotId, nextChapter, project.id, scoped.chapterGenerationJobs, settings.defaultPromptMode, settings.defaultTokenBudget])

  useEffect(() => {
    if (!initialSnapshotId) return
    const snapshot = scoped.promptContextSnapshots.find((item) => item.id === initialSnapshotId)
    setContextSource('prompt_snapshot')
    setSelectedSnapshotId(initialSnapshotId)
    if (snapshot) {
      setTargetChapterOrder(snapshot.targetChapterOrder)
      setBudgetMode(snapshot.mode)
      setBudgetMaxTokens(snapshot.budgetProfile.maxTokens)
      if (snapshot.chapterTask.targetWordCount) setEstimatedWordCount(snapshot.chapterTask.targetWordCount)
      if (snapshot.chapterTask.readerEmotion) {
        const nextEmotionState = rememberReaderEmotionTarget(project.id, snapshot.chapterTask.readerEmotion)
        setReaderEmotionTarget(snapshot.chapterTask.readerEmotion)
        setReaderEmotionPresets(nextEmotionState.presets)
      }
    }
    onInitialSnapshotConsumed?.()
  }, [initialSnapshotId, onInitialSnapshotConsumed, project.id, scoped.promptContextSnapshots])

  function rememberCurrentReaderEmotionTarget() {
    if (!readerEmotionTarget.trim()) return
    const nextEmotionState = rememberReaderEmotionTarget(project.id, readerEmotionTarget)
    setReaderEmotionPresets(nextEmotionState.presets)
  }

  function applyReaderEmotionPreset(preset: string) {
    const nextEmotionState = rememberReaderEmotionTarget(project.id, preset)
    setReaderEmotionTarget(preset)
    setReaderEmotionPresets(nextEmotionState.presets)
  }

  function addReaderEmotionPresetFromInput(): string {
    const value = newReaderEmotionPreset.trim()
    if (!value) return '请输入要保存的读者情绪预设。'
    const nextEmotionState = addReaderEmotionPreset(project.id, value)
    setReaderEmotionTarget(value)
    setReaderEmotionPresets(nextEmotionState.presets)
    setNewReaderEmotionPreset('')
    return '已保存读者情绪预设。'
  }

  function useAutoContext() {
    setContextSource('auto')
    setSelectedSnapshotId(null)
  }

  function handleSnapshotChange(value: ID | '') {
    setSelectedSnapshotId(value || null)
    const snapshot = snapshots.find((item) => item.id === value)
    if (!snapshot) return
    setTargetChapterOrder(snapshot.targetChapterOrder)
    setBudgetMode(snapshot.mode)
    setBudgetMaxTokens(snapshot.budgetProfile.maxTokens)
    if (snapshot.chapterTask.targetWordCount) setEstimatedWordCount(snapshot.chapterTask.targetWordCount)
    if (snapshot.chapterTask.readerEmotion) {
      const nextEmotionState = rememberReaderEmotionTarget(project.id, snapshot.chapterTask.readerEmotion)
      setReaderEmotionTarget(snapshot.chapterTask.readerEmotion)
      setReaderEmotionPresets(nextEmotionState.presets)
    }
  }

  return {
    nextChapter,
    targetChapterOrder,
    setTargetChapterOrder,
    pipelineMode,
    setPipelineMode,
    estimatedWordCount,
    setEstimatedWordCount,
    readerEmotionTarget,
    setReaderEmotionTarget,
    readerEmotionPresets,
    newReaderEmotionPreset,
    setNewReaderEmotionPreset,
    budgetMode,
    setBudgetMode,
    budgetMaxTokens,
    setBudgetMaxTokens,
    contextSource,
    setContextSource,
    selectedSnapshotId,
    selectedSnapshot,
    snapshots,
    selectedJobId,
    setSelectedJobId,
    rememberCurrentReaderEmotionTarget,
    applyReaderEmotionPreset,
    addReaderEmotionPresetFromInput,
    useAutoContext,
    handleSnapshotChange
  }
}
