import { useEffect, useMemo, useState } from 'react'
import type {
  AppData,
  Chapter,
  ChapterDraftResult,
  ChapterGenerationJob,
  ChapterGenerationStep,
  ChapterGenerationStepType,
  ChapterPlan,
  ChapterReviewDraft,
  CharacterStateSuggestion,
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  ContextBudgetMode,
  ContextBudgetProfile,
  ContextSelectionResult,
  Foreshadowing,
  ForeshadowingCandidate,
  ForeshadowingStatusChangeSuggestion,
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
  RevisionRequest,
  RevisionRequestType,
  RevisionSession
} from '../../../shared/types'
import { safeParseJson } from '../../../services/AIJsonParser'
import { AIService } from '../../../services/AIService'
import { ContextBudgetManager } from '../../../services/ContextBudgetManager'
import { QualityGateService } from '../../../services/QualityGateService'
import { TokenEstimator } from '../../../services/TokenEstimator'
import { formatContinuityBridgeForPrompt, resolveContinuityBridge } from '../../../services/ContinuityService'
import { analyzeRedundancy } from '../../../services/RedundancyService'
import { normalizeTreatmentMode, treatmentPromptRules } from '../../../shared/foreshadowingTreatment'
import { EmptyState, NumberInput, SelectField, TextInput } from '../components/FormFields'
import { Header } from '../components/Layout'
import { ActionToolbar, StatusBadge, Stepper } from '../components/UI'
import { formatDate, newId, now, treatmentModeLabel, weightLabel } from '../utils/format'
import { projectData } from '../utils/projectData'
import { buildPipelineContext, createContextBudgetProfile, selectBudgetContext } from '../utils/promptContext'
import {
  appendGenerationRunTraceIds,
  buildForeshadowingTreatmentModes,
  uniqueIds,
  upsertGenerationRunTrace,
  upsertGenerationRunTraceByJobId
} from '../utils/runTrace'

interface ProjectProps {
  data: AppData
  project: Project
  saveData: (next: AppData) => Promise<void>
  onOpenRevision?: (prefill: { chapterId: ID | null; draftId: ID | null; requestId: ID }) => void
  initialSnapshotId?: ID | null
  onInitialSnapshotConsumed?: () => void
}

function updateProjectTimestamp(data: AppData, projectId: ID): Project[] {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: now() } : project))
}

const PIPELINE_STEP_ORDER: ChapterGenerationStepType[] = [
  'context_budget_selection',
  'build_context',
  'generate_chapter_plan',
  'generate_chapter_draft',
  'generate_chapter_review',
  'propose_character_updates',
  'propose_foreshadowing_updates',
  'consistency_review',
  'quality_gate',
  'await_user_confirmation'
]

const PIPELINE_STEP_LABELS: Record<ChapterGenerationStepType, string> = {
  context_budget_selection: '上下文预算选择',
  build_context: '构建上下文',
  generate_chapter_plan: '生成任务书',
  generate_chapter_draft: '生成正文',
  generate_chapter_review: '复盘章节',
  propose_character_updates: '提取角色更新',
  propose_foreshadowing_updates: '提取伏笔更新',
  consistency_review: '一致性审稿',
  quality_gate: '质量门禁',
  await_user_confirmation: '等待确认'
}

function serializeOutput(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function parseOutput<T>(value: string, fallback: T): T {
  if (!value.trim()) return fallback
  const parsed = safeParseJson<T>(value, '流水线步骤输出')
  return parsed.ok ? parsed.data : fallback
}

function pipelineContextFromStepOutput(output: string): string {
  const parsed = safeParseJson<{ finalPrompt?: string; context?: string; contextSource?: string }>(output, '流水线上下文输出')
  if (parsed.ok && typeof parsed.data.finalPrompt === 'string' && parsed.data.finalPrompt.trim()) return parsed.data.finalPrompt
  if (parsed.ok && typeof parsed.data.context === 'string' && parsed.data.context.trim()) return parsed.data.context
  return output
}

function summarizeSnapshot(snapshot: PromptContextSnapshot) {
  return {
    contextSource: 'prompt_context_snapshot',
    snapshotId: snapshot.id,
    targetChapterOrder: snapshot.targetChapterOrder,
    mode: snapshot.mode,
    estimatedTokens: snapshot.estimatedTokens,
    selectedCharacterIds: snapshot.selectedCharacterIds,
    selectedForeshadowingIds: snapshot.selectedForeshadowingIds,
    foreshadowingTreatmentOverrides: snapshot.foreshadowingTreatmentOverrides,
    chapterTask: snapshot.chapterTask,
    contextSelectionResult: snapshot.contextSelectionResult,
    note: snapshot.note
  }
}

function contextItemLabel(trace: GenerationRunTrace, projectDataSnapshot: ReturnType<typeof projectData>, type: string, id: ID | null): string {
  if (!id) return type
  if (type.includes('chapter')) {
    const chapter = projectDataSnapshot.chapters.find((item) => item.id === id)
    if (chapter) return `第 ${chapter.order} 章 ${chapter.title || '未命名'}`
  }
  if (type.includes('stage')) {
    const summary = projectDataSnapshot.stageSummaries.find((item) => item.id === id)
    if (summary) return `阶段摘要 ${summary.chapterStart}-${summary.chapterEnd}`
  }
  if (type.includes('character')) {
    return projectDataSnapshot.characters.find((item) => item.id === id)?.name ?? id
  }
  if (type.includes('foreshadowing')) {
    return projectDataSnapshot.foreshadowings.find((item) => item.id === id)?.title ?? id
  }
  return id || trace.id
}

function runTraceSummary(
  trace: GenerationRunTrace,
  consistencyReport: ConsistencyReviewReport | null,
  qualityReport: QualityGateReport | null
) {
  return {
    id: trace.id,
    jobId: trace.jobId,
    targetChapterOrder: trace.targetChapterOrder,
    contextSource: trace.contextSource,
    promptContextSnapshotId: trace.promptContextSnapshotId,
    selectedCounts: {
      chapters: trace.selectedChapterIds.length,
      stageSummaries: trace.selectedStageSummaryIds.length,
      characters: trace.selectedCharacterIds.length,
      foreshadowings: trace.selectedForeshadowingIds.length
    },
    foreshadowingTreatmentModes: trace.foreshadowingTreatmentModes,
    foreshadowingTreatmentOverrides: trace.foreshadowingTreatmentOverrides,
    omittedContextItems: trace.omittedContextItems,
    contextWarnings: trace.contextWarnings,
    finalPromptTokenEstimate: trace.finalPromptTokenEstimate,
    generatedDraftId: trace.generatedDraftId,
    continuityBridgeId: trace.continuityBridgeId,
    continuitySource: trace.continuitySource,
    continuityWarnings: trace.continuityWarnings,
    redundancyReportId: trace.redundancyReportId,
    consistencyReviewReportId: trace.consistencyReviewReportId,
    qualityGateReportId: trace.qualityGateReportId,
    issueCounts: {
      consistencyHigh: consistencyReport?.issues.filter((issue) => issue.severity === 'high').length ?? 0,
      consistencyMedium: consistencyReport?.issues.filter((issue) => issue.severity === 'medium').length ?? 0,
      consistencyLow: consistencyReport?.issues.filter((issue) => issue.severity === 'low').length ?? 0,
      qualityHigh: qualityReport?.issues.filter((issue) => issue.severity === 'high').length ?? 0,
      qualityMedium: qualityReport?.issues.filter((issue) => issue.severity === 'medium').length ?? 0,
      qualityLow: qualityReport?.issues.filter((issue) => issue.severity === 'low').length ?? 0
    },
    revisionSessionIds: trace.revisionSessionIds,
    acceptedRevisionVersionId: trace.acceptedRevisionVersionId,
    acceptedMemoryCandidateIds: trace.acceptedMemoryCandidateIds,
    rejectedMemoryCandidateIds: trace.rejectedMemoryCandidateIds,
    createdAt: trace.createdAt,
    updatedAt: trace.updatedAt
  }
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

function normalizePipelineOptions(
  options: Partial<{
    targetChapterOrder: number
    pipelineMode: PipelineMode
    estimatedWordCount: string
    readerEmotionTarget: string
    budgetMode: ContextBudgetMode
    budgetMaxTokens: number
  }>,
  fallback: {
    targetChapterOrder: number
    pipelineMode: PipelineMode
    estimatedWordCount: string
    readerEmotionTarget: string
    budgetMode: ContextBudgetMode
    budgetMaxTokens: number
  }
) {
  return {
    targetChapterOrder: Number.isFinite(options.targetChapterOrder) ? Number(options.targetChapterOrder) : fallback.targetChapterOrder,
    pipelineMode: options.pipelineMode ?? fallback.pipelineMode,
    estimatedWordCount: options.estimatedWordCount || fallback.estimatedWordCount,
    readerEmotionTarget: options.readerEmotionTarget || fallback.readerEmotionTarget,
    budgetMode: options.budgetMode ?? fallback.budgetMode,
    budgetMaxTokens: Number.isFinite(options.budgetMaxTokens) ? Number(options.budgetMaxTokens) : fallback.budgetMaxTokens
  }
}

function minimumDraftTokens(expectedWordCount: string): number {
  const numbers = [...expectedWordCount.matchAll(/\d+/g)].map((match) => Number(match[0])).filter((value) => Number.isFinite(value))
  const minimumWords = numbers.length > 0 ? Math.min(...numbers) : 2000
  return Math.max(900, Math.min(2400, Math.round(minimumWords * 0.4)))
}

function validateGeneratedChapterDraft(body: string, expectedWordCount: string, strict: boolean): string | null {
  const trimmed = body.trim()
  if (!trimmed) return '正文生成结果为空。'
  if (/^\s*[\[{]/.test(trimmed) && /"(?:body|chapterBody|chapterText|content)"\s*:/.test(trimmed)) {
    return 'AI 返回的是未解析完成的 JSON，而不是可用正文，可能已被截断。'
  }
  if (/【(?:世界规则|人物心理|主线推进|本章目标|角色节拍)】/.test(trimmed) || /^(本章目标|必须推进的冲突|角色节拍)：/m.test(trimmed)) {
    return 'AI 返回的是大纲/任务书摘要，不是章节正文。'
  }
  if (!/[。！？.!?」”]$/.test(trimmed)) {
    return '正文疑似中途截断，结尾没有完整句号或收束标点。'
  }
  if (strict) {
    const tokenEstimate = TokenEstimator.estimate(trimmed)
    const minTokens = minimumDraftTokens(expectedWordCount)
    if (tokenEstimate < minTokens) {
      return `正文过短（约 ${tokenEstimate} token），低于本章预计字数的最低可接受值（约 ${minTokens} token）。`
    }
  }
  return null
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
  const [readerEmotionTarget, setReaderEmotionTarget] = useState('期待、紧张、好奇')
  const [budgetMode, setBudgetMode] = useState<ContextBudgetMode>(data.settings.defaultPromptMode)
  const [budgetMaxTokens, setBudgetMaxTokens] = useState(data.settings.defaultTokenBudget)
  const [contextSource, setContextSource] = useState<PipelineContextSource>(initialSnapshotId ? 'prompt_snapshot' : 'auto')
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<ID | null>(initialSnapshotId ?? null)
  const [selectedJobId, setSelectedJobId] = useState<ID | null>(scoped.chapterGenerationJobs[0]?.id ?? null)
  const [pipelineMessage, setPipelineMessage] = useState('')
  const aiService = useMemo(() => new AIService(data.settings), [data.settings])

  const snapshots = [...scoped.promptContextSnapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const selectedSnapshot = selectedSnapshotId ? snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? null : null

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
      if (snapshot.chapterTask.readerEmotion) setReaderEmotionTarget(snapshot.chapterTask.readerEmotion)
    }
    onInitialSnapshotConsumed?.()
  }, [initialSnapshotId, onInitialSnapshotConsumed, scoped.promptContextSnapshots])

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

  function makeInitialSteps(jobId: ID): ChapterGenerationStep[] {
    const timestamp = now()
    return PIPELINE_STEP_ORDER.map((type) => ({
      id: newId(),
      jobId,
      type,
      status: 'pending',
      inputSnapshot: '',
      output: '',
      errorMessage: '',
      createdAt: timestamp,
      updatedAt: timestamp
    }))
  }

  async function persistWorking(next: AppData, statusMessage?: string): Promise<AppData> {
    await saveData(next)
    if (statusMessage) {
      // saveData owns the visible status; this keeps the call sites readable.
      void statusMessage
    }
    return next
  }

  function updateStepInData(
    working: AppData,
    stepId: ID,
    patch: Partial<ChapterGenerationStep>,
    jobPatch: Partial<ChapterGenerationJob> = {}
  ): AppData {
    const timestamp = now()
    const step = working.chapterGenerationSteps.find((item) => item.id === stepId)
    return {
      ...working,
      chapterGenerationSteps: working.chapterGenerationSteps.map((item) =>
        item.id === stepId ? { ...item, ...patch, updatedAt: timestamp } : item
      ),
      chapterGenerationJobs: working.chapterGenerationJobs.map((job) =>
        step && job.id === step.jobId ? { ...job, ...jobPatch, updatedAt: timestamp } : job
      )
    }
  }

  async function runPipeline() {
    setPipelineMessage('')
    if (contextSource === 'prompt_snapshot' && !selectedSnapshot) {
      setPipelineMessage('请先选择一个 Prompt 构建器上下文快照，或切换为自动构建上下文。')
      return
    }
    if (contextSource === 'prompt_snapshot' && selectedSnapshot && selectedSnapshot.targetChapterOrder !== targetChapterOrder) {
      setPipelineMessage(`提示：快照目标是第 ${selectedSnapshot.targetChapterOrder} 章，当前流水线目标是第 ${targetChapterOrder} 章；将按流水线目标继续，但请确认上下文是否合适。`)
    }
    const timestamp = now()
    const job: ChapterGenerationJob = {
      id: newId(),
      projectId: project.id,
      targetChapterOrder,
      promptContextSnapshotId: contextSource === 'prompt_snapshot' ? selectedSnapshot?.id ?? null : null,
      contextSource,
      status: 'running',
      currentStep: 'context_budget_selection',
      createdAt: timestamp,
      updatedAt: timestamp,
      errorMessage: ''
    }
    const steps = makeInitialSteps(job.id)
    let working: AppData = {
      ...data,
      chapterGenerationJobs: [job, ...data.chapterGenerationJobs],
      chapterGenerationSteps: [...data.chapterGenerationSteps, ...steps]
    }
    await persistWorking(working)
    setSelectedJobId(job.id)
    await runPipelineFromStep(working, job.id, 'context_budget_selection', {
      targetChapterOrder,
      pipelineMode,
      estimatedWordCount,
      readerEmotionTarget,
      budgetMode,
      budgetMaxTokens
    })
  }

  async function skipStep(job: ChapterGenerationJob, step: ChapterGenerationStep) {
    await saveData(
      updateStepInData(data, step.id, { status: 'skipped', errorMessage: '' }, { currentStep: step.type, status: job.status })
    )
  }

  async function retryStep(job: ChapterGenerationJob, stepType: ChapterGenerationStepType) {
    setPipelineMessage('')
    const firstStep = data.chapterGenerationSteps.find((step) => step.jobId === job.id && step.type === stepType)
    if (!firstStep) return
    const fallbackOptions = { targetChapterOrder: job.targetChapterOrder, pipelineMode, estimatedWordCount, readerEmotionTarget, budgetMode, budgetMaxTokens }
    const options = normalizePipelineOptions(parseOutput(firstStep.inputSnapshot, fallbackOptions), fallbackOptions)
    await runPipelineFromStep(data, job.id, stepType, options)
  }

  async function runPipelineFromStep(
    initialData: AppData,
    jobId: ID,
    fromStep: ChapterGenerationStepType,
    inputOptions: {
      targetChapterOrder: number
      pipelineMode: PipelineMode
      estimatedWordCount: string
      readerEmotionTarget: string
      budgetMode: ContextBudgetMode
      budgetMaxTokens: number
    }
  ) {
    let working = initialData
    const job = working.chapterGenerationJobs.find((item) => item.id === jobId)
    if (!job) return
    const options = normalizePipelineOptions(inputOptions, {
      targetChapterOrder: job?.targetChapterOrder ?? targetChapterOrder,
      pipelineMode,
      estimatedWordCount,
      readerEmotionTarget,
      budgetMode,
      budgetMaxTokens
    })
    const snapshot =
      job.contextSource === 'prompt_snapshot' && job.promptContextSnapshotId
        ? working.promptContextSnapshots.find((item) => item.id === job.promptContextSnapshotId) ?? null
        : null
    let context = ''
    let plan: ChapterPlan | null = null
    let draftResult: ChapterDraftResult | null = null
    const steps = working.chapterGenerationSteps.filter((step) => step.jobId === jobId)
    const startIndex = PIPELINE_STEP_ORDER.indexOf(fromStep)

    const contextStep = steps.find((step) => step.type === 'build_context')
    if (contextStep?.output) context = pipelineContextFromStepOutput(contextStep.output)
    const planStep = steps.find((step) => step.type === 'generate_chapter_plan')
    if (planStep?.output) plan = parseOutput<ChapterPlan | null>(planStep.output, null)
    const draftStep = steps.find((step) => step.type === 'generate_chapter_draft')
    if (draftStep?.output) draftResult = parseOutput<ChapterDraftResult | null>(draftStep.output, null)
    let draftRecord =
      working.generatedChapterDrafts.find((draft) => draft.jobId === jobId && draft.status === 'draft') ??
      working.generatedChapterDrafts.find((draft) => draft.jobId === jobId) ??
      null
    let budgetProfile = createContextBudgetProfile(project.id, options.budgetMode, options.budgetMaxTokens, `第 ${options.targetChapterOrder} 章流水线预算`)
    let budgetSelection: ContextSelectionResult | null = null
    const budgetStep = steps.find((step) => step.type === 'context_budget_selection')
    if (budgetStep?.output) {
      const savedBudget = parseOutput<{ profile?: ContextBudgetProfile; selection?: ContextSelectionResult } | null>(budgetStep.output, null)
      if (savedBudget?.profile) budgetProfile = savedBudget.profile
      if (savedBudget?.selection) budgetSelection = savedBudget.selection
    }

    for (const type of PIPELINE_STEP_ORDER.slice(startIndex)) {
      const step = steps.find((item) => item.type === type)
      if (!step) continue
      working = updateStepInData(
        working,
        step.id,
        { status: 'running', inputSnapshot: serializeOutput(options), errorMessage: '' },
        { status: 'running', currentStep: type, errorMessage: '' }
      )
      await persistWorking(working)

      try {
        if (type === 'context_budget_selection') {
          if (job.contextSource === 'prompt_snapshot') {
            if (!snapshot) throw new Error('Prompt 上下文快照已丢失，请重新构建上下文。')
            if (snapshot.projectId !== project.id) throw new Error('Prompt 上下文快照不属于当前项目，已停止生成。')
            budgetProfile = snapshot.budgetProfile
            budgetSelection = snapshot.contextSelectionResult
            const targetMismatch = snapshot.targetChapterOrder !== options.targetChapterOrder
            working = updateStepInData(working, step.id, {
              status: 'completed',
              output: serializeOutput({
                profile: budgetProfile,
                selection: budgetSelection,
                contextSource: 'prompt_context_snapshot',
                snapshotId: snapshot.id,
                targetMismatch,
                warning: targetMismatch ? `快照目标为第 ${snapshot.targetChapterOrder} 章，流水线目标为第 ${options.targetChapterOrder} 章。` : ''
              })
            })
          } else {
            budgetProfile = createContextBudgetProfile(project.id, options.budgetMode, options.budgetMaxTokens, `第 ${options.targetChapterOrder} 章流水线预算`)
            budgetSelection = selectBudgetContext(project, working, options.targetChapterOrder, budgetProfile)
            working = {
              ...updateStepInData(working, step.id, {
                status: 'completed',
                output: serializeOutput({ profile: budgetProfile, selection: budgetSelection, explanation: ContextBudgetManager.explainSelection(budgetSelection) })
              }),
              contextBudgetProfiles: [budgetProfile, ...working.contextBudgetProfiles]
            }
          }
        }

        if (type === 'build_context') {
          if (job.contextSource === 'prompt_snapshot') {
            if (!snapshot) throw new Error('Prompt 上下文快照已丢失，请重新构建上下文。')
            context = snapshot.finalPrompt
          } else {
            if (!budgetSelection) {
              budgetSelection = selectBudgetContext(project, working, options.targetChapterOrder, budgetProfile)
            }
            context = buildPipelineContext(
              project,
              working,
              options.targetChapterOrder,
              options.readerEmotionTarget,
              options.estimatedWordCount,
              budgetProfile
            )
          }
          const continuityResult = resolveContinuityBridge({
            projectId: project.id,
            chapters: working.chapters.filter((chapter) => chapter.projectId === project.id),
            bridges: working.chapterContinuityBridges.filter((bridge) => bridge.projectId === project.id),
            targetChapterOrder: options.targetChapterOrder
          })
          if (continuityResult.bridge && !context.includes('上一章结尾衔接')) {
            context = `${context}\n\n## 上一章结尾衔接\n${formatContinuityBridgeForPrompt(continuityResult.bridge)}`
          }
          working = updateStepInData(working, step.id, {
            status: 'completed',
            output:
              job.contextSource === 'prompt_snapshot' && snapshot
                ? serializeOutput({
                    ...summarizeSnapshot(snapshot),
                    finalPrompt: context,
                    targetMismatch: snapshot.targetChapterOrder !== options.targetChapterOrder,
                    continuityBridgeId: continuityResult.bridge?.id ?? null,
                    continuitySource: continuityResult.source,
                    continuityWarnings: continuityResult.warnings
                  })
                : context
          })
          const selectedCharacterIds = snapshot ? snapshot.selectedCharacterIds : budgetSelection?.selectedCharacterIds ?? []
          const selectedForeshadowingIds = snapshot ? snapshot.selectedForeshadowingIds : budgetSelection?.selectedForeshadowingIds ?? []
          const treatmentOverrides = snapshot?.foreshadowingTreatmentOverrides ?? {}
          working = upsertGenerationRunTrace(working, job, {
            targetChapterOrder: options.targetChapterOrder,
            promptContextSnapshotId: job.promptContextSnapshotId ?? null,
            contextSource: job.contextSource,
            selectedChapterIds: budgetSelection?.selectedChapterIds ?? [],
            selectedStageSummaryIds: budgetSelection?.selectedStageSummaryIds ?? [],
            selectedCharacterIds,
            selectedForeshadowingIds,
            foreshadowingTreatmentModes: buildForeshadowingTreatmentModes(working.foreshadowings, selectedForeshadowingIds, treatmentOverrides),
            foreshadowingTreatmentOverrides: treatmentOverrides,
            omittedContextItems: budgetSelection?.omittedItems ?? [],
            contextWarnings: [
              ...(budgetSelection?.warnings ?? []),
              ...continuityResult.warnings,
              ...(snapshot && snapshot.targetChapterOrder !== options.targetChapterOrder
                ? [`快照目标为第 ${snapshot.targetChapterOrder} 章，流水线目标为第 ${options.targetChapterOrder} 章。`]
                : [])
            ],
            finalPromptTokenEstimate: TokenEstimator.estimate(context),
            continuityBridgeId: continuityResult.bridge?.id ?? null,
            continuitySource: continuityResult.source,
            continuityWarnings: continuityResult.warnings
          })
        }

        if (type === 'generate_chapter_plan') {
          const result = await aiService.generateChapterPlan(context, {
            mode: options.pipelineMode,
            targetChapterOrder: options.targetChapterOrder,
            estimatedWordCount: options.estimatedWordCount,
            readerEmotionTarget: options.readerEmotionTarget
          })
          if (!result.data) throw new Error(result.error || result.parseError || '任务书生成失败')
          plan = result.data
          working = updateStepInData(working, step.id, {
            status: 'completed',
            output: serializeOutput(result.data),
            errorMessage: result.error?.includes('远程 AI 任务书生成失败') ? result.error : ''
          })
        }

        if (type === 'generate_chapter_draft') {
          if (!plan) throw new Error('缺少章节任务书，无法生成正文')
          let result = await aiService.generateChapterDraft(plan, context, {
            mode: options.pipelineMode,
            estimatedWordCount: options.estimatedWordCount,
            readerEmotionTarget: options.readerEmotionTarget
          })
          if (!result.data) throw new Error(result.error || result.parseError || '正文生成失败')
          let validationError = validateGeneratedChapterDraft(result.data.body, options.estimatedWordCount, result.usedAI)
          if (validationError && result.usedAI) {
            result = await aiService.generateChapterDraft(plan, context, {
              mode: options.pipelineMode,
              estimatedWordCount: options.estimatedWordCount,
              readerEmotionTarget: options.readerEmotionTarget,
              retryReason: validationError
            })
            if (!result.data) throw new Error(result.error || result.parseError || '正文重新生成失败')
            validationError = validateGeneratedChapterDraft(result.data.body, options.estimatedWordCount, result.usedAI)
          }
          if (validationError) {
            throw new Error(`${validationError} 请重试，或提高设置页 Max Tokens。`)
          }
          draftResult = result.data
          const draft: GeneratedChapterDraft = {
            id: newId(),
            projectId: project.id,
            chapterId: null,
            jobId,
            title: result.data.title,
            body: result.data.body,
            summary: plan.chapterGoal,
            status: 'draft',
            tokenEstimate: TokenEstimator.estimate(result.data.body),
            createdAt: now(),
            updatedAt: now()
          }
          const redundancyReport = analyzeRedundancy({
            projectId: project.id,
            chapterId: null,
            draftId: draft.id,
            body: result.data.body
          })
          draftRecord = draft
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
            generatedChapterDrafts: [draft, ...working.generatedChapterDrafts],
            redundancyReports: [redundancyReport, ...working.redundancyReports]
          }
          working = upsertGenerationRunTrace(working, job, { generatedDraftId: draft.id, redundancyReportId: redundancyReport.id })
        }

        if (type === 'generate_chapter_review') {
          if (!draftResult) throw new Error('缺少章节正文草稿，无法复盘')
          const result = await aiService.generateChapterReview(draftResult.body, context)
          if (!result.data) throw new Error(result.error || result.parseError || '复盘生成失败')
          const candidate: MemoryUpdateCandidate = {
            id: newId(),
            projectId: project.id,
            jobId,
            type: 'chapter_review',
            targetId: null,
            proposedPatch: serializeOutput(result.data),
            evidence: 'AI 对生成正文的章节复盘草稿',
            confidence: result.usedAI ? 0.75 : 0,
            status: 'pending',
            createdAt: now(),
            updatedAt: now()
          }
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
            memoryUpdateCandidates: [candidate, ...working.memoryUpdateCandidates]
          }
        }

        if (type === 'propose_character_updates') {
          if (!draftResult) throw new Error('缺少章节正文草稿，无法提取角色更新')
          const result = await aiService.updateCharacterStates(draftResult.body, scoped.characters, context)
          if (!result.data) throw new Error(result.error || result.parseError || '角色更新提取失败')
          const candidates: MemoryUpdateCandidate[] = result.data.map((suggestion) => ({
            id: newId(),
            projectId: project.id,
            jobId,
            type: 'character',
            targetId: suggestion.characterId,
            proposedPatch: serializeOutput(suggestion),
            evidence: suggestion.changeSummary,
            confidence: suggestion.confidence,
            status: 'pending',
            createdAt: now(),
            updatedAt: now()
          }))
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
            memoryUpdateCandidates: [...candidates, ...working.memoryUpdateCandidates]
          }
        }

        if (type === 'propose_foreshadowing_updates') {
          if (!draftResult) throw new Error('缺少章节正文草稿，无法提取伏笔更新')
          const result = await aiService.extractForeshadowing(draftResult.body, scoped.foreshadowings, context, scoped.characters)
          if (!result.data) throw new Error(result.error || result.parseError || '伏笔更新提取失败')
          const newCandidates: MemoryUpdateCandidate[] = result.data.newForeshadowingCandidates.map((candidate) => ({
            id: newId(),
            projectId: project.id,
            jobId,
            type: 'foreshadowing',
            targetId: null,
            proposedPatch: serializeOutput({ kind: 'new', candidate }),
            evidence: candidate.description,
            confidence: result.usedAI ? 0.7 : 0,
            status: 'pending',
            createdAt: now(),
            updatedAt: now()
          }))
          const changeCandidates: MemoryUpdateCandidate[] = result.data.statusChanges.map((change) => ({
            id: newId(),
            projectId: project.id,
            jobId,
            type: 'foreshadowing',
            targetId: change.foreshadowingId,
            proposedPatch: serializeOutput({ kind: 'status', change }),
            evidence: change.evidenceText,
            confidence: change.confidence,
            status: 'pending',
            createdAt: now(),
            updatedAt: now()
          }))
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
            memoryUpdateCandidates: [...newCandidates, ...changeCandidates, ...working.memoryUpdateCandidates]
          }
        }

        if (type === 'consistency_review') {
          if (!draftResult) throw new Error('缺少章节正文草稿，无法审稿')
          const result = await aiService.generateConsistencyReview(draftResult, context)
          if (!result.data) throw new Error(result.error || result.parseError || '一致性审稿失败')
          const report: ConsistencyReviewReport = {
            id: newId(),
            projectId: project.id,
            jobId,
            chapterId: null,
            promptContextSnapshotId: job.promptContextSnapshotId ?? null,
            issues: result.data.issues,
            legacyIssuesText: '',
            suggestions: result.data.suggestions.join('\n'),
            severitySummary: result.data.severitySummary,
            createdAt: now()
          }
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
            consistencyReviewReports: [report, ...working.consistencyReviewReports]
          }
          working = upsertGenerationRunTrace(working, job, { consistencyReviewReportId: report.id })
        }

        if (type === 'quality_gate') {
          if (!draftResult) throw new Error('缺少章节正文草稿，无法执行质量门禁')
          const report = await QualityGateService.evaluateChapterDraft({
            projectId: project.id,
            jobId,
            chapterId: draftRecord?.chapterId ?? null,
            draftId: draftRecord?.id ?? null,
            chapterDraft: draftRecord ?? draftResult,
            context,
            chapterPlan: plan,
            consistencyReports: working.consistencyReviewReports.filter((item) => item.jobId === jobId),
            promptContextSnapshotId: job.promptContextSnapshotId ?? null,
            contextSource: job.contextSource,
            aiService
          })
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(report) }),
            qualityGateReports: [report, ...working.qualityGateReports]
          }
          working = upsertGenerationRunTrace(working, job, { qualityGateReportId: report.id })
        }

        if (type === 'await_user_confirmation') {
          working = updateStepInData(working, step.id, { status: 'completed', output: '等待用户确认章节草稿和记忆更新候选。' }, { status: 'completed', currentStep: type })
        }

        await persistWorking(working)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        working = updateStepInData(working, step.id, { status: 'failed', errorMessage: message }, { status: 'failed', errorMessage: message })
        await persistWorking(working)
        break
      }
    }
  }

  async function acceptDraft(draft: GeneratedChapterDraft) {
    if (draft.status !== 'draft') return
    const report = scoped.qualityGateReports.find((item) => item.draftId === draft.id) ?? null
    if (report && !report.pass) {
      const forced = confirm(`质量门禁未通过（${report.overallScore} 分）。确认仍要进入章节草稿吗？`)
      if (!forced) return
      if (!confirm('再次确认：低分草稿可能导致后续复盘和记忆候选质量下降。是否强制接受？')) return
    }
    const existing = scoped.chapters.find((chapter) => chapter.order === selectedJob?.targetChapterOrder)
    const timestamp = now()
    let chapterId = existing?.id ?? newId()
    let nextChapters: Chapter[]

    if (existing) {
      if (!confirm(`第 ${existing.order} 章已存在，是否覆盖标题和正文？取消则保留草稿不写入章节。`)) return
      nextChapters = data.chapters.map((chapter) =>
        chapter.id === existing.id
          ? { ...chapter, title: draft.title, body: draft.body, updatedAt: timestamp }
          : chapter
      )
      chapterId = existing.id
    } else {
      nextChapters = [
        ...data.chapters,
        {
          id: chapterId,
          projectId: project.id,
          order: selectedJob?.targetChapterOrder ?? targetChapterOrder,
          title: draft.title,
          body: draft.body,
          summary: draft.summary,
          newInformation: '',
          characterChanges: '',
          newForeshadowing: '',
          resolvedForeshadowing: '',
          endingHook: '',
          riskWarnings: '',
          includedInStageSummary: false,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ]
    }

    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      chapters: nextChapters,
      generatedChapterDrafts: data.generatedChapterDrafts.map((item) =>
        item.id === draft.id ? { ...item, chapterId, status: 'accepted', updatedAt: timestamp } : item
      ),
      consistencyReviewReports: data.consistencyReviewReports.map((report) =>
        report.jobId === draft.jobId ? { ...report, chapterId } : report
      ),
      qualityGateReports: data.qualityGateReports.map((report) =>
        report.jobId === draft.jobId ? { ...report, chapterId, draftId: draft.id } : report
      ),
      redundancyReports: data.redundancyReports.map((report) =>
        report.draftId === draft.id ? { ...report, chapterId } : report
      )
    })
  }

  async function rejectDraft(draft: GeneratedChapterDraft) {
    if (draft.status !== 'draft') return
    await saveData({
      ...data,
      generatedChapterDrafts: data.generatedChapterDrafts.map((item) =>
        item.id === draft.id ? { ...item, status: 'rejected', updatedAt: now() } : item
      )
    })
  }

  async function applyCandidate(candidate: MemoryUpdateCandidate) {
    if (candidate.status !== 'pending') return
    const report = scoped.qualityGateReports.find((item) => item.jobId === candidate.jobId && !item.pass) ?? null
    if (report) {
      const ok = confirm(`该流水线质量门禁未通过（${report.overallScore} 分）。确认仍要应用这条长期记忆更新吗？`)
      if (!ok) return
    }
    const timestamp = now()
    let nextData = data

    if (candidate.type === 'chapter_review') {
      const review = parseOutput<ChapterReviewDraft | null>(candidate.proposedPatch, null)
      const targetChapter = scoped.chapters.find((chapter) => chapter.order === selectedJob?.targetChapterOrder) ?? null
      if (!review || !targetChapter) return
      const { continuityBridgeSuggestion, ...chapterReviewPatch } = review
      const hasContinuitySuggestion =
        continuityBridgeSuggestion &&
        Object.values(continuityBridgeSuggestion).some((value) => String(value ?? '').trim())
      const existingBridge = nextData.chapterContinuityBridges.find(
        (bridge) => bridge.fromChapterId === targetChapter.id && bridge.toChapterOrder === targetChapter.order + 1
      )
      const nextBridge = hasContinuitySuggestion
        ? {
            id: existingBridge?.id ?? newId(),
            projectId: project.id,
            fromChapterId: targetChapter.id,
            toChapterOrder: targetChapter.order + 1,
            ...continuityBridgeSuggestion,
            createdAt: existingBridge?.createdAt ?? timestamp,
            updatedAt: timestamp
          }
        : null
      nextData = {
        ...nextData,
        chapters: nextData.chapters.map((chapter) => (chapter.id === targetChapter.id ? { ...chapter, ...chapterReviewPatch, updatedAt: timestamp } : chapter)),
        chapterContinuityBridges: nextBridge
          ? existingBridge
            ? nextData.chapterContinuityBridges.map((bridge) => (bridge.id === existingBridge.id ? nextBridge : bridge))
            : [nextBridge, ...nextData.chapterContinuityBridges]
          : nextData.chapterContinuityBridges
      }
    }

    if (candidate.type === 'character') {
      const suggestion = parseOutput<CharacterStateSuggestion | null>(candidate.proposedPatch, null)
      if (!suggestion) return
      const character = scoped.characters.find((item) => item.id === suggestion.characterId)
      if (!character) return
      const targetChapter = scoped.chapters.find((chapter) => chapter.order === selectedJob?.targetChapterOrder) ?? null
      nextData = {
        ...nextData,
        characters: nextData.characters.map((item) =>
          item.id === character.id
            ? {
                ...item,
                emotionalState: suggestion.newCurrentEmotionalState || item.emotionalState,
                protagonistRelationship: suggestion.newRelationshipWithProtagonist || item.protagonistRelationship,
                nextActionTendency: suggestion.newNextActionTendency || item.nextActionTendency,
                lastChangedChapter: selectedJob?.targetChapterOrder ?? item.lastChangedChapter,
                updatedAt: timestamp
              }
            : item
        ),
        characterStateLogs: [
          ...nextData.characterStateLogs,
          {
            id: newId(),
            projectId: project.id,
            characterId: character.id,
            chapterId: targetChapter?.id ?? null,
            chapterOrder: selectedJob?.targetChapterOrder ?? null,
            note: suggestion.changeSummary,
            createdAt: timestamp
          }
        ]
      }
    }

    if (candidate.type === 'foreshadowing') {
      const patch = parseOutput<{ kind?: string; candidate?: ForeshadowingCandidate; change?: ForeshadowingStatusChangeSuggestion }>(
        candidate.proposedPatch,
        {}
      )
      if (patch.kind === 'new' && patch.candidate) {
        nextData = {
          ...nextData,
          foreshadowings: [
            ...nextData.foreshadowings,
            {
              id: newId(),
              projectId: project.id,
              title: patch.candidate.title,
              firstChapterOrder: patch.candidate.firstChapterOrder ?? selectedJob?.targetChapterOrder ?? null,
              description: patch.candidate.description,
              status: 'unresolved',
              weight: patch.candidate.suggestedWeight,
              treatmentMode: normalizeTreatmentMode(patch.candidate.recommendedTreatmentMode, 'unresolved', patch.candidate.suggestedWeight),
              expectedPayoff: patch.candidate.expectedPayoff,
              payoffMethod: '',
              relatedCharacterIds: patch.candidate.relatedCharacterIds,
              relatedMainPlot: '',
              notes: patch.candidate.notes,
              actualPayoffChapter: null,
              createdAt: timestamp,
              updatedAt: timestamp
            }
          ]
        }
      }
      if (patch.kind === 'status' && patch.change) {
        nextData = {
          ...nextData,
          foreshadowings: nextData.foreshadowings.map((item) =>
            item.id === patch.change?.foreshadowingId
              ? {
                  ...item,
                  status: patch.change.suggestedStatus,
                  actualPayoffChapter: patch.change.suggestedStatus === 'resolved' ? selectedJob?.targetChapterOrder ?? item.actualPayoffChapter : item.actualPayoffChapter,
                  notes: [item.notes, patch.change.notes || patch.change.evidenceText].filter(Boolean).join('\n'),
                  updatedAt: timestamp
                }
              : item
          )
        }
      }
    }

    const acceptedData: AppData = {
      ...nextData,
      projects: updateProjectTimestamp(nextData, project.id),
      memoryUpdateCandidates: nextData.memoryUpdateCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'accepted', updatedAt: timestamp } : item
      )
    }
    await saveData(appendGenerationRunTraceIds(acceptedData, candidate.jobId, 'acceptedMemoryCandidateIds', [candidate.id]))
  }

  async function rejectCandidate(candidate: MemoryUpdateCandidate) {
    if (candidate.status !== 'pending') return
    const timestamp = now()
    const rejectedData: AppData = {
      ...data,
      memoryUpdateCandidates: data.memoryUpdateCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'rejected', updatedAt: timestamp } : item
      )
    }
    await saveData(appendGenerationRunTraceIds(rejectedData, candidate.jobId, 'rejectedMemoryCandidateIds', [candidate.id]))
  }

  async function updateConsistencyIssueStatus(
    report: ConsistencyReviewReport,
    issue: ConsistencyReviewIssue,
    status: ConsistencyReviewIssue['status']
  ) {
    await saveData({
      ...data,
      consistencyReviewReports: data.consistencyReviewReports.map((item) =>
        item.id === report.id
          ? {
              ...item,
              issues: item.issues.map((current) => (current.id === issue.id ? { ...current, status } : current))
            }
          : item
      )
    })
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
    const nextData: AppData = {
      ...data,
      revisionSessions: [session, ...data.revisionSessions],
      revisionRequests: [request, ...data.revisionRequests],
      consistencyReviewReports: data.consistencyReviewReports.map((item) =>
        item.id === report.id
          ? {
              ...item,
              issues: item.issues.map((current) =>
                current.id === issue.id ? { ...current, status: 'converted_to_revision' } : current
              )
            }
          : item
      )
    }
    await saveData(appendGenerationRunTraceIds(nextData, report.jobId, 'revisionSessionIds', [session.id]))
    setPipelineMessage(targetChapter ? '已创建修订请求，正在进入修订工作台。' : '已创建草稿修订请求。该草稿尚未关联章节，修订接受后不会写入任何已有章节。')
    onOpenRevision?.({ chapterId: targetChapter?.id ?? null, draftId: draft.id, requestId: request.id })
  }

  async function generateRevisionCandidate(issue: QualityGateIssue, report: QualityGateReport, draft: GeneratedChapterDraft) {
    setPipelineMessage('')
    const context = buildPipelineContext(
      project,
      data,
      selectedJob?.targetChapterOrder ?? targetChapterOrder,
      readerEmotionTarget,
      estimatedWordCount,
      createContextBudgetProfile(project.id, budgetMode, budgetMaxTokens, '修订候选上下文')
    )
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
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData({ ...data, revisionCandidates: [candidate, ...data.revisionCandidates] })
    setPipelineMessage('修订候选已生成，请在下方候选区确认后再应用。')
  }

  async function acceptRevisionCandidate(candidate: RevisionCandidate) {
    if (candidate.status !== 'pending') return
    const timestamp = now()
    await saveData({
      ...data,
      generatedChapterDrafts: data.generatedChapterDrafts.map((draft) =>
        draft.id === candidate.draftId && candidate.revisedText.trim()
          ? { ...draft, body: candidate.revisedText, tokenEstimate: TokenEstimator.estimate(candidate.revisedText), updatedAt: timestamp }
          : draft
      ),
      revisionCandidates: data.revisionCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'accepted', updatedAt: timestamp } : item
      )
    })
  }

  async function rejectRevisionCandidate(candidate: RevisionCandidate) {
    if (candidate.status !== 'pending') return
    await saveData({
      ...data,
      revisionCandidates: data.revisionCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'rejected', updatedAt: now() } : item
      )
    })
  }

  async function copyRunTrace(trace: GenerationRunTrace) {
    await window.novelDirector.clipboard.writeText(JSON.stringify(runTraceSummary(trace, traceConsistencyReport, traceQualityReport), null, 2))
    setPipelineMessage('已复制生成追踪摘要。')
  }

  return (
    <>
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
                  if (snapshot.chapterTask.readerEmotion) setReaderEmotionTarget(snapshot.chapterTask.readerEmotion)
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
          <button className="primary-button" onClick={runPipeline}>开始生成</button>
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
              <div className="panel run-trace-panel">
                <div className="panel-title-row">
                  <h2>生成追踪</h2>
                  {selectedTrace ? (
                    <button className="ghost-button" onClick={() => copyRunTrace(selectedTrace)}>
                      复制追踪摘要
                    </button>
                  ) : null}
                </div>
                {!selectedTrace ? (
                  <p className="muted">build_context 完成后会生成追踪记录，用于核对本次实际使用的上下文。</p>
                ) : (
                  <>
                    <div className="metric-grid">
                      <article>
                        <span>上下文来源</span>
                        <strong>{selectedTrace.contextSource === 'prompt_snapshot' ? 'Prompt 快照' : '自动构建'}</strong>
                        <p>{selectedTraceSnapshot ? `${formatDate(selectedTraceSnapshot.createdAt)} · ${selectedTraceSnapshot.id}` : selectedTrace.promptContextSnapshotId || '未绑定快照'}</p>
                      </article>
                      <article>
                        <span>纳入章节</span>
                        <strong>{selectedTrace.selectedChapterIds.length}</strong>
                        <p>阶段摘要 {selectedTrace.selectedStageSummaryIds.length}</p>
                      </article>
                      <article>
                        <span>角色 / 伏笔</span>
                        <strong>{selectedTrace.selectedCharacterIds.length} / {selectedTrace.selectedForeshadowingIds.length}</strong>
                        <p>{selectedTrace.finalPromptTokenEstimate} token</p>
                      </article>
                      <article>
                        <span>质量链路</span>
                        <strong>{traceQualityReport ? (traceQualityReport.pass ? '通过' : '需审查') : '未完成'}</strong>
                        <p>审稿 {traceConsistencyReport ? '已完成' : '未完成'}</p>
                      </article>
                      <article>
                        <span>章节衔接</span>
                        <strong>
                          {selectedTrace.continuitySource === 'saved_bridge'
                            ? '已保存 Bridge'
                            : selectedTrace.continuitySource === 'auto_from_previous_ending'
                              ? '上一章结尾兜底'
                              : selectedTrace.continuitySource === 'manual'
                                ? '手动指令'
                                : '未记录'}
                        </strong>
                        <p>{traceContinuityBridge?.immediateNextBeat || selectedTrace.continuityBridgeId || '暂无衔接依据'}</p>
                      </article>
                      <article>
                        <span>冗余检查</span>
                        <strong>{traceRedundancyReport ? `${traceRedundancyReport.overallRedundancyScore} 分` : '未完成'}</strong>
                        <p>{traceRedundancyReport ? `${traceRedundancyReport.compressionSuggestions.length} 条压缩建议` : selectedTrace.redundancyReportId || '暂无报告'}</p>
                      </article>
                    </div>
                    <div className="budget-columns">
                      <div>
                        <h3>伏笔 treatmentMode</h3>
                        <div className="candidate-list compact">
                          {selectedTrace.selectedForeshadowingIds.length === 0 ? (
                            <p className="muted">本次没有纳入伏笔。</p>
                          ) : (
                            selectedTrace.selectedForeshadowingIds.map((id) => {
                              const item = scoped.foreshadowings.find((foreshadowing) => foreshadowing.id === id)
                              const mode = selectedTrace.foreshadowingTreatmentModes[id] ?? item?.treatmentMode ?? 'hint'
                              const override = selectedTrace.foreshadowingTreatmentOverrides[id]
                              return (
                                <article key={id} className="candidate-card">
                                  <h3>{item?.title || id}</h3>
                                  <p>
                                    权重：{item ? weightLabel(item.weight) : '-'} · 全局：{item ? treatmentModeLabel(item.treatmentMode) : '-'} · 本次：{treatmentModeLabel(mode)}
                                    {override ? ` · override：${treatmentModeLabel(override)}` : ''}
                                  </p>
                                  <p className="muted">{treatmentPromptRules(mode).join('；')}</p>
                                </article>
                              )
                            })
                          )}
                        </div>
                      </div>
                      <div>
                        <h3>省略上下文与警告</h3>
                        <ul className="advice-list">
                          {selectedTrace.omittedContextItems.slice(0, 8).map((item, index) => (
                            <li key={`${item.type}-${item.id ?? index}`}>
                              {contextItemLabel(selectedTrace, scoped, item.type, item.id)}：{item.reason}
                            </li>
                          ))}
                          {selectedTrace.contextWarnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                          {!selectedTrace.omittedContextItems.length && !selectedTrace.contextWarnings.length ? <li>暂无省略项或上下文风险。</li> : null}
                        </ul>
                      </div>
                    </div>
                    <div className="budget-columns">
                      <div>
                        <h3>质量链路</h3>
                        <ul className="advice-list">
                          <li>一致性审稿：{traceConsistencyReport ? `已完成 · ${traceConsistencyReport.issues.filter((issue) => issue.severity === 'high').length} high / ${traceConsistencyReport.issues.filter((issue) => issue.severity === 'medium').length} medium / ${traceConsistencyReport.issues.filter((issue) => issue.severity === 'low').length} low` : '未完成'}</li>
                          <li>质量门禁：{traceQualityReport ? `${traceQualityReport.pass ? '通过' : '未通过'} · ${traceQualityReport.overallScore} 分` : '未完成'}</li>
                          <li>转入修订：{traceConsistencyReport?.issues.filter((issue) => issue.status === 'converted_to_revision').length ?? 0} 个 issue</li>
                          <li>已接受修订版本：{selectedTrace.acceptedRevisionVersionId || '无'}</li>
                        </ul>
                      </div>
                      <div>
                        <h3>记忆更新</h3>
                        <ul className="advice-list">
                          <li>已接受候选：{selectedTrace.acceptedMemoryCandidateIds.length}</li>
                          <li>已拒绝候选：{selectedTrace.rejectedMemoryCandidateIds.length}</li>
                        </ul>
                      </div>
                    </div>
                    <details className="snapshot-detail">
                      <summary>查看追踪 JSON 摘要</summary>
                      <pre>{JSON.stringify(runTraceSummary(selectedTrace, traceConsistencyReport, traceQualityReport), null, 2)}</pre>
                    </details>
                  </>
                )}
              </div>
              <div className="panel">
                <h2>步骤输出</h2>
                <div className="pipeline-steps">
                  {selectedSteps.map((step) => (
                    <article key={step.id} className={`pipeline-step ${step.status}`}>
                      <div>
                        <strong>{PIPELINE_STEP_LABELS[step.type]}</strong>
                        <StatusBadge tone={step.status === 'failed' ? 'danger' : step.status === 'completed' ? 'success' : step.status === 'running' ? 'accent' : 'neutral'}>{step.status}</StatusBadge>
                      </div>
                      {step.errorMessage ? <p className="error-text">{step.errorMessage}</p> : null}
                      {step.output ? <pre>{step.output.slice(0, 900)}</pre> : null}
                      <div className="row-actions">
                        <button className="ghost-button" onClick={() => retryStep(selectedJob, step.type)}>
                          重试
                        </button>
                        <button className="ghost-button" onClick={() => skipStep(selectedJob, step)}>
                          跳过
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="panel draft-panel">
                <h2>章节正文草稿</h2>
                {latestDraft ? (
                  <article className="candidate-card">
                    <h3>{latestDraft.title}</h3>
                    <p>
                      状态：{latestDraft.status} · {latestDraft.tokenEstimate} token
                    </p>
                    <textarea className="prompt-editor" value={latestDraft.body} readOnly />
                    <div className="row-actions">
                      <button className="primary-button" onClick={() => acceptDraft(latestDraft)}>
                        接受章节草稿
                      </button>
                      <button className="danger-button" onClick={() => rejectDraft(latestDraft)}>
                        拒绝章节草稿
                      </button>
                      <button className="ghost-button" onClick={() => retryStep(selectedJob, 'generate_chapter_draft')}>
                        重新生成章节正文
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => {
                          void window.novelDirector.clipboard.writeText(latestDraft.body).then(() => setPipelineMessage('已复制草稿正文。'))
                        }}
                      >
                        复制草稿正文
                      </button>
                    </div>
                  </article>
                ) : (
                  <p className="muted">正文草稿会在第 3 步完成后显示。</p>
                )}
              </div>

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
                        <pre>{candidate.proposedPatch.slice(0, 900)}</pre>
                        <div className="row-actions">
                          <button className="primary-button" disabled={candidate.status !== 'pending'} onClick={() => applyCandidate(candidate)}>
                            接受
                          </button>
                          <button className="danger-button" disabled={candidate.status !== 'pending'} onClick={() => rejectCandidate(candidate)}>
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
    </>
  )
}
