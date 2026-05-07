import { useEffect, useMemo, useState } from 'react'
import type {
  AppData,
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  ContextBudgetProfile,
  ContextBudgetMode,
  ContextSelectionResult,
  ForcedContextBlock,
  GeneratedChapterDraft,
  GenerationRunTrace,
  ID,
  MemoryUpdateCandidate,
  PipelineContextSource,
  PipelineMode,
  Project,
  PromptContextSnapshot,
  QualityGateIssue,
  QualityGateReport,
  RevisionCandidate,
  RevisionCandidateContextSource,
  RevisionRequest,
  RevisionRequestType,
  RevisionSession
} from '../../../shared/types'
import { AIService } from '../../../services/AIService'
import { safeParseJson } from '../../../services/AIJsonParser'
import { TokenEstimator } from '../../../services/TokenEstimator'
import { EmptyState, NumberInput, SelectField, TextInput } from '../components/FormFields'
import { Header } from '../components/Layout'
import { ActionToolbar, StatusBadge, Stepper } from '../components/UI'
import { formatDate, newId, now } from '../utils/format'
import { projectData } from '../utils/projectData'
import { buildPipelineContextFromSelection, createContextBudgetProfile, selectBudgetContext } from '../utils/promptContext'
import { addReaderEmotionPreset, loadReaderEmotionState, rememberReaderEmotionTarget } from '../utils/readerEmotionPresets'
import { appendGenerationRunTraceForcedContextBlocks, appendGenerationRunTraceIds, upsertGenerationRunTraceByJobId } from '../utils/runTrace'
import type { SaveDataInput } from '../utils/saveDataState'
import { DraftPreviewPanel } from './generation/DraftPreviewPanel'
import { PipelineStepsPanel } from './generation/PipelineStepsPanel'
import { RunTracePanel, buildRunTraceSummary } from './generation/RunTracePanel'
import { useDraftAcceptance } from './generation/useDraftAcceptance'
import { useMemoryCandidates } from './generation/useMemoryCandidates'
import { PIPELINE_STEP_LABELS, PIPELINE_STEP_ORDER, usePipelineRunner } from './generation/usePipelineRunner'

interface ProjectProps {
  data: AppData
  project: Project
  saveData: (next: SaveDataInput) => Promise<void>
  onOpenRevision?: (prefill: { chapterId: ID | null; draftId: ID | null; requestId: ID }) => void
  initialSnapshotId?: ID | null
  onInitialSnapshotConsumed?: () => void
}

function updateProjectTimestamp(data: AppData, projectId: ID): Project[] {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: now() } : project))
}

const CONSISTENCY_TYPE_LABELS: Record<ConsistencyReviewIssue['type'], string> = {
  timeline_conflict: '时间线冲突',
  worldbuilding_conflict: '设定冲突',
  character_knowledge_leak: '角色知识越界',
  character_motivation_gap: '动机断裂',
  character_ooc: '角色 OOC',
  foreshadowing_misuse: '伏笔误用',
  foreshadowing_leak: '伏笔提前泄露',
  geography_or_physics_conflict: '空间/物理冲突',
  previous_chapter_contradiction: '前文矛盾',
  continuity_gap: '连续性缺口',
  other: '其他'
}

function consistencyIssueToRevisionType(issue: ConsistencyReviewIssue): RevisionRequestType {
  if (issue.type === 'timeline_conflict' || issue.type === 'previous_chapter_contradiction' || issue.type === 'continuity_gap') return 'fix_continuity'
  if (issue.type === 'worldbuilding_conflict' || issue.type === 'geography_or_physics_conflict') return 'fix_worldbuilding'
  if (issue.type === 'character_knowledge_leak') return 'fix_character_knowledge'
  if (issue.type === 'character_motivation_gap') return 'strengthen_conflict'
  if (issue.type === 'character_ooc') return 'fix_ooc'
  if (issue.type === 'foreshadowing_misuse' || issue.type === 'foreshadowing_leak') return 'fix_foreshadowing'
  return 'custom'
}

function consistencyRevisionInstruction(issue: ConsistencyReviewIssue): string {
  return (
    issue.revisionInstruction ||
    [issue.description, issue.suggestedFix].filter(Boolean).join('\n修订目标：') ||
    '修复该一致性问题，同时不得改动无关剧情、不得引入新设定、不得破坏角色状态和伏笔 treatmentMode。'
  )
}

function contextFromBuildContextOutput(output: string): string {
  const parsed = safeParseJson<{ finalPrompt?: string; context?: string }>(output, 'pipeline build_context output')
  if (parsed.ok && typeof parsed.data.finalPrompt === 'string' && parsed.data.finalPrompt.trim()) return parsed.data.finalPrompt
  if (parsed.ok && typeof parsed.data.context === 'string' && parsed.data.context.trim()) return parsed.data.context
  return output.trim()
}

function budgetSelectionFromStepOutput(output: string): { profile: ContextBudgetProfile | null; selection: ContextSelectionResult | null } {
  const parsed = safeParseJson<{ profile?: ContextBudgetProfile; selection?: ContextSelectionResult }>(output, 'pipeline budget selection output')
  if (!parsed.ok) return { profile: null, selection: null }
  return {
    profile: parsed.data.profile ?? null,
    selection: parsed.data.selection ?? null
  }
}

function renderMemoryPatchDetails(candidate: MemoryUpdateCandidate, scoped: ReturnType<typeof projectData>) {
  const patch = candidate.proposedPatch
  if (patch.kind === 'chapter_review_update') {
    return (
      <div className="patch-details">
        <p><strong>本章摘要：</strong>{patch.review.summary || '-'}</p>
        <p><strong>新增信息：</strong>{patch.review.newInformation || '-'}</p>
        <p><strong>角色变化：</strong>{patch.review.characterChanges || '-'}</p>
        <p><strong>新增伏笔：</strong>{patch.review.newForeshadowing || '-'}</p>
        <p><strong>已回收伏笔：</strong>{patch.review.resolvedForeshadowing || '-'}</p>
        <p><strong>结尾钩子：</strong>{patch.review.endingHook || '-'}</p>
        <p><strong>风险提醒：</strong>{patch.review.riskWarnings || '-'}</p>
        {patch.continuityBridgeSuggestion ? <p><strong>下一章衔接：</strong>{patch.continuityBridgeSuggestion.immediateNextBeat || patch.continuityBridgeSuggestion.mustContinueFrom || '-'}</p> : null}
      </div>
    )
  }
  if (patch.kind === 'character_state_update') {
    const character = scoped.characters.find((item) => item.id === patch.characterId)
    return (
      <div className="patch-details">
        <p><strong>角色：</strong>{character?.name ?? patch.characterId}</p>
        <p><strong>变化摘要：</strong>{patch.changeSummary || '-'}</p>
        <p><strong>新情绪状态：</strong>{patch.newCurrentEmotionalState || '-'}</p>
        <p><strong>与主角关系：</strong>{patch.newRelationshipWithProtagonist || '-'}</p>
        <p><strong>下一步行动倾向：</strong>{patch.newNextActionTendency || '-'}</p>
      </div>
    )
  }
  if (patch.kind === 'foreshadowing_create') {
    return (
      <div className="patch-details">
        <p><strong>标题：</strong>{patch.candidate.title || '-'}</p>
        <p><strong>描述：</strong>{patch.candidate.description || '-'}</p>
        <p><strong>权重：</strong>{patch.candidate.suggestedWeight}</p>
        <p><strong>预期回收：</strong>{patch.candidate.expectedPayoff || '-'}</p>
        <p><strong>相关角色：</strong>{patch.candidate.relatedCharacterIds.map((id) => scoped.characters.find((character) => character.id === id)?.name ?? id).join('、') || '-'}</p>
        <p><strong>备注：</strong>{patch.candidate.notes || '-'}</p>
      </div>
    )
  }
  if (patch.kind === 'foreshadowing_status_update') {
    const foreshadowing = scoped.foreshadowings.find((item) => item.id === patch.foreshadowingId)
    return (
      <div className="patch-details">
        <p><strong>伏笔：</strong>{foreshadowing?.title ?? patch.foreshadowingId}</p>
        <p><strong>建议状态：</strong>{patch.suggestedStatus}</p>
        <p><strong>推荐处理方式：</strong>{patch.recommendedTreatmentMode || '-'}</p>
        <p><strong>证据：</strong>{patch.evidenceText || '-'}</p>
        <p><strong>备注：</strong>{patch.notes || '-'}</p>
      </div>
    )
  }
  if (patch.kind === 'legacy_raw') {
    return (
      <div className="patch-details">
        {patch.parseError ? <p><strong>解析失败：</strong>{patch.parseError}</p> : null}
        <pre>{patch.rawText.slice(0, 900)}</pre>
      </div>
    )
  }
  return <pre>{JSON.stringify(patch, null, 2).slice(0, 900)}</pre>
}

export function GenerationPipelineView({
  data,
  project,
  saveData,
  onOpenRevision,
  initialSnapshotId,
  onInitialSnapshotConsumed
}: ProjectProps) {
  const scoped = projectData(data, project.id)
  const nextChapter = Math.max(0, ...scoped.chapters.map((chapter) => chapter.order)) + 1
  const [targetChapterOrder, setTargetChapterOrder] = useState(nextChapter)
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('standard')
  const [estimatedWordCount, setEstimatedWordCount] = useState('3000-5000')
  const [readerEmotionTarget, setReaderEmotionTarget] = useState(() => {
    const emotionState = loadReaderEmotionState(project.id)
    return emotionState.lastTarget || project.coreAppeal || ''
  })
  const [readerEmotionPresets, setReaderEmotionPresets] = useState(() => loadReaderEmotionState(project.id).presets)
  const [newReaderEmotionPreset, setNewReaderEmotionPreset] = useState('')
  const [budgetMode, setBudgetMode] = useState<ContextBudgetMode>(data.settings.defaultPromptMode)
  const [budgetMaxTokens, setBudgetMaxTokens] = useState(data.settings.defaultTokenBudget)
  const [contextSource, setContextSource] = useState<PipelineContextSource>(initialSnapshotId ? 'prompt_snapshot' : 'auto')
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<ID | null>(initialSnapshotId ?? null)
  const [selectedJobId, setSelectedJobId] = useState<ID | null>(scoped.chapterGenerationJobs[0]?.id ?? null)
  const aiService = useMemo(() => new AIService(data.settings), [data.settings])

  const snapshots = [...scoped.promptContextSnapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const selectedSnapshot = selectedSnapshotId ? snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? null : null

  useEffect(() => {
    const emotionState = loadReaderEmotionState(project.id)
    setReaderEmotionPresets(emotionState.presets)
    setReaderEmotionTarget(emotionState.lastTarget || project.coreAppeal || '')
    setNewReaderEmotionPreset('')
  }, [project.id, project.coreAppeal])

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

  const jobs = [...scoped.chapterGenerationJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null
  const selectedSteps = selectedJob
    ? data.chapterGenerationSteps
        .filter((step) => step.jobId === selectedJob.id)
        .sort((a, b) => PIPELINE_STEP_ORDER.indexOf(a.type) - PIPELINE_STEP_ORDER.indexOf(b.type))
    : []
  const selectedDrafts = selectedJob ? scoped.generatedChapterDrafts.filter((draft) => draft.jobId === selectedJob.id) : []
  const selectedCandidates = selectedJob ? scoped.memoryUpdateCandidates.filter((candidate) => candidate.jobId === selectedJob.id) : []
  const selectedReports = selectedJob ? scoped.consistencyReviewReports.filter((report) => report.jobId === selectedJob.id) : []
  const selectedQualityReports = selectedJob ? scoped.qualityGateReports.filter((report) => report.jobId === selectedJob.id) : []
  const selectedRevisionCandidates = selectedJob ? scoped.revisionCandidates.filter((candidate) => candidate.jobId === selectedJob.id) : []
  const selectedTrace = selectedJob ? scoped.generationRunTraces.find((trace) => trace.jobId === selectedJob.id) ?? null : null
  const selectedTraceSnapshot = selectedTrace?.promptContextSnapshotId
    ? scoped.promptContextSnapshots.find((snapshot) => snapshot.id === selectedTrace.promptContextSnapshotId) ?? null
    : null
  const consistencyIssueById = useMemo(() => {
    return new Map(selectedReports.flatMap((report) => report.issues.map((issue) => [issue.id, issue] as const)))
  }, [selectedReports])
  const latestDraft = selectedDrafts[0] ?? null
  const latestQualityReport = latestDraft
    ? selectedQualityReports.find((report) => report.draftId === latestDraft.id) ?? selectedQualityReports[0] ?? null
    : selectedQualityReports[0] ?? null
  const traceConsistencyReport = selectedTrace?.consistencyReviewReportId
    ? selectedReports.find((report) => report.id === selectedTrace.consistencyReviewReportId) ?? selectedReports[0] ?? null
    : selectedReports[0] ?? null
  const traceQualityReport = selectedTrace?.qualityGateReportId
    ? selectedQualityReports.find((report) => report.id === selectedTrace.qualityGateReportId) ?? latestQualityReport
    : latestQualityReport
  const traceContinuityBridge = selectedTrace?.continuityBridgeId
    ? scoped.chapterContinuityBridges.find((bridge) => bridge.id === selectedTrace.continuityBridgeId) ?? null
    : null
  const traceRedundancyReport = selectedTrace?.redundancyReportId
    ? scoped.redundancyReports.find((report) => report.id === selectedTrace.redundancyReportId) ?? null
    : null
  const draftAcceptance = useDraftAcceptance({
    project,
    saveData,
    selectedJob,
    targetChapterOrder,
    chapters: scoped.chapters,
    qualityGateReports: scoped.qualityGateReports
  })
  const memoryCandidates = useMemoryCandidates({
    project,
    selectedJob,
    qualityGateReports: scoped.qualityGateReports,
    saveData
  })

  const {
    pipelineMessage,
    setPipelineMessage,
    isPipelineRunning,
    runPipeline,
    retryStep,
    skipStep
  } = usePipelineRunner({
    data,
    project,
    scoped,
    saveData,
    targetChapterOrder,
    pipelineMode,
    estimatedWordCount,
    readerEmotionTarget,
    budgetMode,
    budgetMaxTokens,
    contextSource,
    selectedSnapshot,
    setSelectedJobId
  })

  function applyReaderEmotionPreset(preset: string) {
    const nextEmotionState = rememberReaderEmotionTarget(project.id, preset)
    setReaderEmotionTarget(preset)
    setReaderEmotionPresets(nextEmotionState.presets)
  }

  function addReaderEmotionPresetFromInput() {
    const value = newReaderEmotionPreset.trim()
    if (!value) {
      setPipelineMessage('请输入要保存的读者情绪预设。')
      return
    }
    const nextEmotionState = addReaderEmotionPreset(project.id, value)
    setReaderEmotionTarget(value)
    setReaderEmotionPresets(nextEmotionState.presets)
    setNewReaderEmotionPreset('')
    setPipelineMessage('已保存读者情绪预设。')
  }

  function startPipeline() {
    if (readerEmotionTarget.trim()) {
      const nextEmotionState = rememberReaderEmotionTarget(project.id, readerEmotionTarget)
      setReaderEmotionPresets(nextEmotionState.presets)
    }
    void runPipeline()
  }

  async function updateConsistencyIssueStatus(
    report: ConsistencyReviewReport,
    issue: ConsistencyReviewIssue,
    status: ConsistencyReviewIssue['status']
  ) {
    await saveData((current) => ({
      ...current,
      consistencyReviewReports: current.consistencyReviewReports.map((item) =>
        item.id === report.id
          ? {
              ...item,
              issues: item.issues.map((current) => (current.id === issue.id ? { ...current, status } : current))
            }
          : item
      )
    }))
  }

  async function startRevisionFromConsistencyIssue(report: ConsistencyReviewReport, issue: ConsistencyReviewIssue) {
    const draft = scoped.generatedChapterDrafts.find((item) => item.jobId === report.jobId) ?? latestDraft
    if (!draft) {
      setPipelineMessage('请先生成章节草稿，再进入修订工作台。')
      return
    }
    const targetChapter = draft.chapterId ? scoped.chapters.find((chapter) => chapter.id === draft.chapterId) ?? null : null
    const timestamp = now()
    const session: RevisionSession = {
      id: newId(),
      projectId: project.id,
      chapterId: targetChapter?.id ?? '',
      sourceDraftId: draft.id,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const request: RevisionRequest = {
      id: newId(),
      sessionId: session.id,
      type: consistencyIssueToRevisionType(issue),
      targetRange: issue.evidence,
      instruction: `${consistencyRevisionInstruction(issue)}\n\n约束：只修复该一致性问题，不得擅自改动无关剧情，不得引入新设定，不得破坏角色状态和伏笔 treatmentMode。`,
      createdAt: timestamp
    }
    await saveData((current) => {
      const nextData: AppData = {
        ...current,
        revisionSessions: [session, ...current.revisionSessions],
        revisionRequests: [request, ...current.revisionRequests],
        consistencyReviewReports: current.consistencyReviewReports.map((item) =>
          item.id === report.id
            ? {
                ...item,
                issues: item.issues.map((currentIssue) =>
                  currentIssue.id === issue.id ? { ...currentIssue, status: 'converted_to_revision' } : currentIssue
                )
              }
            : item
        )
      }
      return appendGenerationRunTraceIds(nextData, report.jobId, 'revisionSessionIds', [session.id])
    })
    setPipelineMessage(targetChapter ? '已创建修订请求，正在进入修订工作台。' : '已创建草稿修订请求。该草稿尚未关联章节，修订接受后不会写入任何已有章节。')
    onOpenRevision?.({ chapterId: targetChapter?.id ?? null, draftId: draft.id, requestId: request.id })
  }

  function resolveRevisionCandidateContext(issue: QualityGateIssue, report: QualityGateReport): {
    context: string
    contextSource: RevisionCandidateContextSource
    contextWarnings: string[]
    compressionRecords?: ContextSelectionResult['compressionRecords']
    forcedBlock: ForcedContextBlock
  } {
    const targetOrder = selectedJob?.targetChapterOrder ?? targetChapterOrder
    const issueText = JSON.stringify(issue, null, 2)
    const forcedBlock: ForcedContextBlock = {
      kind: 'quality_gate_issue',
      sourceId: report.id,
      sourceType: issue.type,
      sourceChapterId: report.chapterId ?? null,
      sourceChapterOrder: targetOrder,
      title: `质量门禁问题：${issue.description || issue.type}`,
      tokenEstimate: TokenEstimator.estimate(issueText)
    }

    const buildContextStep = selectedSteps.find((step) => step.type === 'build_context' && step.status === 'completed' && step.output.trim())
    if (buildContextStep) {
      const context = contextFromBuildContextOutput(buildContextStep.output)
      if (context.trim()) return { context, contextSource: 'reused_current_job_context', contextWarnings: [], forcedBlock }
    }

    if (selectedTraceSnapshot?.finalPrompt?.trim()) {
      return {
        context: selectedTraceSnapshot.finalPrompt,
        contextSource: 'reused_current_job_context',
        contextWarnings: ['当前 job 的 build_context 输出不可用，已复用绑定的 Prompt 快照。'],
        forcedBlock
      }
    }

    const budgetStep = selectedSteps.find((step) => step.type === 'context_budget_selection' && step.status === 'completed' && step.output.trim())
    const parsedBudget = budgetStep ? budgetSelectionFromStepOutput(budgetStep.output) : { profile: null, selection: null }
    const budgetProfile = parsedBudget.profile ?? createContextBudgetProfile(project.id, budgetMode, budgetMaxTokens, '修订候选上下文')
    const budgetSelection = parsedBudget.selection ?? selectBudgetContext(project, data, targetOrder, budgetProfile)
    const context = buildPipelineContextFromSelection(project, data, targetOrder, readerEmotionTarget, estimatedWordCount, budgetProfile, budgetSelection)
    return {
      context,
      contextSource: 'rebuilt_from_explicit_selection',
      contextWarnings: parsedBudget.selection ? [] : ['当前 job 缺少可复用上下文，已通过 ContextBudgetManager 重新生成显式 selection。'],
      compressionRecords: budgetSelection.compressionRecords,
      forcedBlock
    }
  }

  async function generateRevisionCandidate(issue: QualityGateIssue, report: QualityGateReport, draft: GeneratedChapterDraft) {
    setPipelineMessage('')
    const revisionContext = resolveRevisionCandidateContext(issue, report)
    const context = revisionContext.context
    void [
      project,
      data,
      selectedJob?.targetChapterOrder ?? targetChapterOrder,
      readerEmotionTarget,
      estimatedWordCount,
      createContextBudgetProfile(project.id, budgetMode, budgetMaxTokens, '修订候选上下文')
    ]
    const result = await aiService.generateRevisionCandidate({ title: draft.title, body: draft.body }, issue, context)
    if (!result.data) {
      setPipelineMessage(result.error || result.parseError || '修订候选生成失败')
      return
    }
    const timestamp = now()
    const candidate: RevisionCandidate = {
      id: newId(),
      projectId: project.id,
      jobId: draft.jobId,
      draftId: draft.id,
      sourceReportId: report.id,
      targetIssue: issue.description || issue.type,
      revisionInstruction: result.data.revisionInstruction || issue.suggestedFix,
      revisedText: result.data.revisedText,
      status: 'pending',
      contextSource: revisionContext.contextSource,
      contextWarnings: revisionContext.contextWarnings,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData((current) => {
      const withCandidate = { ...current, revisionCandidates: [candidate, ...current.revisionCandidates] }
      const withForcedBlock = appendGenerationRunTraceForcedContextBlocks(withCandidate, report.jobId, [revisionContext.forcedBlock])
      return revisionContext.compressionRecords?.length
        ? upsertGenerationRunTraceByJobId(withForcedBlock, report.jobId, { compressionRecords: revisionContext.compressionRecords })
        : withForcedBlock
    })
    setPipelineMessage('修订候选已生成，请在下方候选区确认后再应用。')
  }

  async function acceptRevisionCandidate(candidate: RevisionCandidate) {
    if (candidate.status !== 'pending') return
    const timestamp = now()
    await saveData((current) => ({
      ...current,
      generatedChapterDrafts: current.generatedChapterDrafts.map((draft) =>
        draft.id === candidate.draftId && candidate.revisedText.trim()
          ? { ...draft, body: candidate.revisedText, tokenEstimate: TokenEstimator.estimate(candidate.revisedText), updatedAt: timestamp }
          : draft
      ),
      revisionCandidates: current.revisionCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'accepted', updatedAt: timestamp } : item
      )
    }))
  }

  async function rejectRevisionCandidate(candidate: RevisionCandidate) {
    if (candidate.status !== 'pending') return
    await saveData((current) => ({
      ...current,
      revisionCandidates: current.revisionCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'rejected', updatedAt: now() } : item
      )
    }))
  }

  async function copyRunTrace(trace: GenerationRunTrace) {
    await window.novelDirector.clipboard.writeText(JSON.stringify(buildRunTraceSummary(trace, traceConsistencyReport, traceQualityReport), null, 2))
    setPipelineMessage('已复制生成追踪摘要。')
  }

  return (
    <div className="generation-view">
      <Header title="章节生产流水线" description="把上下文构建、任务书、正文草稿、复盘、记忆候选和一致性审稿串成可见流程。" />
      <section className="panel pipeline-start pipeline-command-panel">
        <div>
          <span className="chapter-kicker">Generation Pipeline</span>
          <h2>生成下一章</h2>
          <p className="muted">每一步都会保存输出，长期记忆更新始终需要人工确认。</p>
        </div>
        <div className="form-grid compact">
          <NumberInput label="目标章节编号" min={1} value={targetChapterOrder} onChange={(value) => setTargetChapterOrder(value ?? nextChapter)} />
          <SelectField<PipelineMode>
            label="生成模式"
            value={pipelineMode}
            onChange={setPipelineMode}
            options={[
              { value: 'conservative', label: '保守' },
              { value: 'standard', label: '标准' },
              { value: 'aggressive', label: '激进' }
            ]}
          />
          <TextInput label="章节预计字数" value={estimatedWordCount} onChange={setEstimatedWordCount} />
          <TextInput label="读者情绪目标" value={readerEmotionTarget} onChange={setReaderEmotionTarget} />
          <div className="reader-emotion-presets">
            <div className="reader-emotion-presets-header">
              <strong>快捷情绪</strong>
              <span>点击即可填入，也会记住你上次使用的目标。</span>
            </div>
            <div className="reader-emotion-preset-list">
              {readerEmotionPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={preset === readerEmotionTarget ? 'reader-emotion-chip active' : 'reader-emotion-chip'}
                  onClick={() => applyReaderEmotionPreset(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
            <div className="reader-emotion-add">
              <TextInput
                label="新增情绪预设"
                value={newReaderEmotionPreset}
                onChange={setNewReaderEmotionPreset}
                placeholder="例如：克制、酸涩、余韵"
              />
              <button className="ghost-button" type="button" disabled={!newReaderEmotionPreset.trim()} onClick={addReaderEmotionPresetFromInput}>
                添加并使用
              </button>
            </div>
          </div>
          <SelectField<ContextBudgetMode>
            label="上下文预算模式"
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
            label="预算 token"
            min={1000}
            value={budgetMaxTokens}
            onChange={(value) => setBudgetMaxTokens(value ?? data.settings.defaultTokenBudget)}
          />
          <SelectField<PipelineContextSource>
            label="上下文来源"
            value={contextSource}
            onChange={(value) => setContextSource(value)}
            options={[
              { value: 'auto', label: '自动构建上下文' },
              { value: 'prompt_snapshot', label: '使用 Prompt 构建器快照' }
            ]}
          />
          {contextSource === 'prompt_snapshot' ? (
            <SelectField<ID>
              label="Prompt 上下文快照"
              value={selectedSnapshotId ?? ''}
              onChange={(value) => {
                setSelectedSnapshotId(value || null)
                const snapshot = snapshots.find((item) => item.id === value)
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
              }}
              options={[
                { value: '', label: '选择快照' },
                ...snapshots.map((snapshot) => ({
                  value: snapshot.id,
                  label: `第 ${snapshot.targetChapterOrder} 章 · ${snapshot.estimatedTokens} token · ${formatDate(snapshot.createdAt)}`
                }))
              ]}
            />
          ) : null}
        </div>
        {contextSource === 'prompt_snapshot' ? (
          <div className="notice">
            {selectedSnapshot ? (
              <>
                使用快照：第 {selectedSnapshot.targetChapterOrder} 章 · {selectedSnapshot.mode} · 角色 {selectedSnapshot.selectedCharacterIds.length} · 伏笔 {selectedSnapshot.selectedForeshadowingIds.length}
                {selectedSnapshot.targetChapterOrder !== targetChapterOrder ? `。注意：快照目标章节与当前目标章节不一致。` : ''}
                {selectedSnapshot.note ? ` 备注：${selectedSnapshot.note}` : ''}
              </>
            ) : (
              '请先选择一个上下文快照；也可以回到 Prompt 构建器生成并发送。'
            )}
            <div className="row-actions">
              <button
                className="ghost-button"
                onClick={() => {
                  setContextSource('auto')
                  setSelectedSnapshotId(null)
                }}
              >
                重新自动构建上下文
              </button>
            </div>
            {selectedSnapshot ? (
              <details className="snapshot-detail">
                <summary>查看快照详情</summary>
                <ul className="advice-list">
                  <li>纳入章节：{selectedSnapshot.contextSelectionResult.selectedChapterIds.length}</li>
                  <li>纳入阶段摘要：{selectedSnapshot.contextSelectionResult.selectedStageSummaryIds.length}</li>
                  <li>纳入时间线事件：{selectedSnapshot.contextSelectionResult.selectedTimelineEventIds.length}</li>
                  <li>省略项目：{selectedSnapshot.contextSelectionResult.omittedItems.length}</li>
                </ul>
                <pre>{selectedSnapshot.finalPrompt.slice(0, 1200)}</pre>
              </details>
            ) : null}
          </div>
        ) : null}
        <ActionToolbar>
          <button className="primary-button" disabled={isPipelineRunning} onClick={startPipeline}>
            {isPipelineRunning ? '流水线正在运行' : '开始生成'}
          </button>
          {selectedJob ? <StatusBadge tone={selectedJob.status === 'failed' ? 'danger' : selectedJob.status === 'completed' ? 'success' : 'accent'}>{selectedJob.status}</StatusBadge> : null}
        </ActionToolbar>
        {pipelineMessage ? <div className="notice">{pipelineMessage}</div> : null}
      </section>

      <section className="split-layout pipeline-workbench">
        <aside className="list-pane">
          {jobs.length === 0 ? (
            <EmptyState title="暂无流水线任务" description="选择目标章节后点击开始生成。" />
          ) : (
            jobs.map((job) => (
              <button key={job.id} className={job.id === selectedJob?.id ? 'list-item active' : 'list-item'} onClick={() => setSelectedJobId(job.id)}>
                <strong>第 {job.targetChapterOrder} 章</strong>
                <span>{job.currentStep ? PIPELINE_STEP_LABELS[job.currentStep] : '未开始'}</span>
                <small>{formatDate(job.createdAt)}</small>
              </button>
            ))
          )}
        </aside>
        <div className="editor-pane">
          {!selectedJob ? (
            <EmptyState title="选择或创建流水线任务" description="每一步都会保存输出，失败后可重试或跳过。" />
          ) : (
            <>
              <div className="panel pipeline-stepper-panel">
                <h2>流程状态</h2>
                <Stepper steps={selectedSteps.map((step) => ({ id: step.id, type: step.type, status: step.status }))} labels={PIPELINE_STEP_LABELS} />
              </div>
              <RunTracePanel
                trace={selectedTrace}
                snapshot={selectedTraceSnapshot}
                scoped={scoped}
                consistencyReport={traceConsistencyReport}
                qualityReport={traceQualityReport}
                continuityBridge={traceContinuityBridge}
                redundancyReport={traceRedundancyReport}
                onCopy={copyRunTrace}
              />

              <PipelineStepsPanel job={selectedJob} steps={selectedSteps} labels={PIPELINE_STEP_LABELS} onRetry={retryStep} onSkip={skipStep} />

              <DraftPreviewPanel
                draft={latestDraft}
                job={selectedJob}
                onAccept={draftAcceptance.acceptDraft}
                onReject={draftAcceptance.rejectDraft}
                onRetryDraft={(job) => retryStep(job, 'generate_chapter_draft')}
                onCopyDraft={(draft) => {
                  void window.novelDirector.clipboard.writeText(draft.body).then(() => setPipelineMessage('????????'))
                }}
              />

              <div className="panel">
                <h2>质量门禁报告</h2>
                {latestQualityReport ? (
                  <article className="candidate-card">
                    <h3>
                      总分 {latestQualityReport.overallScore} · {latestQualityReport.pass ? '通过' : '需人工审查'}
                    </h3>
                    <div className="metric-grid">
                      {Object.entries(latestQualityReport.dimensions).map(([key, value]) => (
                        <article key={key}>
                          <span>{key}</span>
                          <strong className={value < 70 ? 'over-budget' : ''}>{value}</strong>
                        </article>
                      ))}
                    </div>
                    {latestQualityReport.issues.length ? (
                      <div className="candidate-list">
                        {latestQualityReport.issues.map((issue, index) => (
                          <article key={`${issue.type}-${index}`} className="candidate-card">
                            <h3>{issue.severity} · {issue.type}</h3>
                            {issue.linkedConsistencyIssueId && consistencyIssueById.has(issue.linkedConsistencyIssueId) ? (
                              <>
                                <p>该问题已在一致性审稿中记录：{consistencyIssueById.get(issue.linkedConsistencyIssueId)?.title}</p>
                                <p className="muted">这里仅作为放行拦截依据，避免重复展开同一诊断。</p>
                              </>
                            ) : (
                              <>
                                <p>{issue.description}</p>
                                <p className="muted">{issue.evidence}</p>
                                <p>{issue.suggestedFix}</p>
                              </>
                            )}
                            {latestDraft ? (
                              <button className="ghost-button" onClick={() => generateRevisionCandidate(issue, latestQualityReport, latestDraft)}>
                                生成修订候选
                              </button>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">没有发现高风险问题。</p>
                    )}
                    {latestQualityReport.requiredFixes.length ? (
                      <ul className="advice-list">
                        {latestQualityReport.requiredFixes.map((fix) => (
                          <li key={fix}>必修：{fix}</li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ) : (
                  <p className="muted">质量门禁会在一致性审稿后执行，低分草稿不会自动进入长期记忆。</p>
                )}
              </div>

              <div className="panel">
                <h2>修订候选</h2>
                {selectedRevisionCandidates.length === 0 ? (
                  <p className="muted">可从质量门禁问题中生成局部修订候选。</p>
                ) : (
                  <div className="candidate-list">
                    {selectedRevisionCandidates.map((candidate) => (
                      <article key={candidate.id} className="candidate-card">
                        <h3>{candidate.status} · {candidate.targetIssue}</h3>
                        <p>{candidate.revisionInstruction}</p>
                        <pre>{candidate.revisedText || '暂无修订正文'}</pre>
                        <div className="row-actions">
                          <button className="primary-button" disabled={candidate.status !== 'pending'} onClick={() => acceptRevisionCandidate(candidate)}>
                            应用到草稿
                          </button>
                          <button className="danger-button" disabled={candidate.status !== 'pending'} onClick={() => rejectRevisionCandidate(candidate)}>
                            拒绝修订
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div className="panel">
                <h2>记忆更新候选</h2>
                {selectedCandidates.length === 0 ? (
                  <p className="muted">章节复盘、角色和伏笔候选会在流水线后半段出现。</p>
                ) : (
                  <div className="candidate-list">
                    {selectedCandidates.map((candidate) => (
                      <article key={candidate.id} className="candidate-card">
                        <h3>{candidate.type}</h3>
                        <p>状态：{candidate.status} · 置信度 {Math.round(candidate.confidence * 100)}%</p>
                        <p>{candidate.evidence || '暂无证据文本'}</p>
                        {renderMemoryPatchDetails(candidate, scoped)}
                        <div className="row-actions">
                          <button className="primary-button" disabled={candidate.status !== 'pending'} onClick={() => memoryCandidates.applyCandidate(candidate)}>
                            接受
                          </button>
                          <button className="danger-button" disabled={candidate.status !== 'pending'} onClick={() => memoryCandidates.rejectCandidate(candidate)}>
                            拒绝
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div className="panel">
                <h2>一致性审稿报告</h2>
                {selectedReports.length === 0 ? (
                  <p className="muted">审稿报告会在第 7 步完成后显示并自动保存。</p>
                ) : (
                  <div className="candidate-list">
                    {selectedReports.map((report) => {
                      const counts = {
                        high: report.issues.filter((issue) => issue.severity === 'high').length,
                        medium: report.issues.filter((issue) => issue.severity === 'medium').length,
                        low: report.issues.filter((issue) => issue.severity === 'low').length
                      }
                      return (
                        <article key={report.id} className="candidate-card">
                          <h3>诊断报告 · {report.severitySummary}</h3>
                          <p className="muted">
                            high {counts.high} · medium {counts.medium} · low {counts.low} · {counts.high ? '建议先进入修订' : '可结合质量门禁判断是否修订'}
                          </p>
                          {report.legacyIssuesText ? <pre>{report.legacyIssuesText}</pre> : null}
                          {report.issues.length === 0 ? (
                            <p className="muted">没有发现结构化一致性问题。</p>
                          ) : (
                            <div className="candidate-list">
                              {report.issues.map((issue) => (
                                <article key={issue.id} className={`candidate-card ${issue.severity}`}>
                                  <h3>
                                    {issue.severity} · {CONSISTENCY_TYPE_LABELS[issue.type]} · {issue.status}
                                  </h3>
                                  <strong>{issue.title}</strong>
                                  <p>{issue.description}</p>
                                  <p className="muted">证据：{issue.evidence || '暂无'}</p>
                                  <p>{issue.suggestedFix || issue.revisionInstruction || '暂无建议修复方式'}</p>
                                  <div className="row-actions">
                                    <button className="primary-button" onClick={() => startRevisionFromConsistencyIssue(report, issue)}>
                                      生成修订
                                    </button>
                                    <button className="ghost-button" disabled={issue.status === 'ignored'} onClick={() => updateConsistencyIssueStatus(report, issue, 'ignored')}>
                                      忽略
                                    </button>
                                    <button className="ghost-button" disabled={issue.status === 'resolved'} onClick={() => updateConsistencyIssueStatus(report, issue, 'resolved')}>
                                      标记已解决
                                    </button>
                                  </div>
                                </article>
                              ))}
                            </div>
                          )}
                          <p>{report.suggestions || '暂无建议'}</p>
                          <small>已保存 · {formatDate(report.createdAt)}</small>
                        </article>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
