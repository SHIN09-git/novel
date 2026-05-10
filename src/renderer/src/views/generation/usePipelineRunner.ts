import { useMemo, useRef, useState } from 'react'
import type {
  AppData,
  ChapterDraftResult,
  ChapterGenerationJob,
  ChapterGenerationStep,
  ChapterGenerationStepType,
  ChapterTask,
  ChapterPlan,
  ConsistencyReviewReport,
  ContextBudgetMode,
  ContextBudgetProfile,
  ContextNeedPlan,
  ContextSelectionResult,
  ContextSelectionTrace,
  ForcedContextBlock,
  GenerationRunBundle,
  PlanContextGapAnalysisResult,
  PromptBlockOrderItem,
  GeneratedChapterDraft,
  CharacterStateChangeCandidate,
  CharacterStateFact,
  CharacterStateTransaction,
  ID,
  MemoryUpdateCandidate,
  NoveltyAuditResult,
  PipelineContextSource,
  PipelineMode,
  Project,
  PromptContextSnapshot,
  StoryDirectionGuide
} from '../../../../shared/types'
import { safeParseJson } from '../../../../services/AIJsonParser'
import { AIService } from '../../../../services/AIService'
import { ContextBudgetManager } from '../../../../services/ContextBudgetManager'
import { ContextNeedPlannerService } from '../../../../services/ContextNeedPlannerService'
import { CharacterStateService } from '../../../../services/CharacterStateService'
import { QualityGateService } from '../../../../services/QualityGateService'
import { TokenEstimator } from '../../../../services/TokenEstimator'
import { inferPromptBlockOrderFromPrompt } from '../../../../services/PromptBuilderService'
import { formatContinuityBridgeForPrompt, resolveContinuityBridge } from '../../../../services/ContinuityService'
import { analyzeRedundancy } from '../../../../services/RedundancyService'
import { NoveltyDetector } from '../../../../services/NoveltyDetector'
import { PlanContextGapAnalyzerService } from '../../../../services/PlanContextGapAnalyzerService'
import { StoryDirectionService } from '../../../../services/StoryDirectionService'
import {
  appendMissingGenerationRunRelatedItems,
  applyGenerationRunBundleToAppData,
  buildGenerationRunBundle
} from '../../../../services/GenerationRunBundleService'
import { newId, now } from '../../utils/format'
import { createContextBudgetProfile, selectBudgetContext, buildPipelineContextResultFromSelection } from '../../utils/promptContext'
import { releasePipelineRunLock, tryAcquirePipelineRunLock } from '../../utils/pipelineRunLock'
import { buildForeshadowingTreatmentModes, estimateForcedContextTokens, upsertGenerationRunTrace } from '../../utils/runTrace'
import type { SaveDataInput } from '../../utils/saveDataState'

interface UsePipelineRunnerArgs {
  data: AppData
  project: Project
  scoped: {
    bible: AppData['storyBibles'][number] | null
    chapters: AppData['chapters']
    characters: AppData['characters']
    characterStateLogs: AppData['characterStateLogs']
    characterStateFacts: AppData['characterStateFacts']
    foreshadowings: AppData['foreshadowings']
    timelineEvents: AppData['timelineEvents']
    stageSummaries: AppData['stageSummaries']
  }
  saveData: (next: SaveDataInput) => Promise<void>
  saveGenerationRunBundle?: (next: SaveDataInput, bundle: GenerationRunBundle) => Promise<void>
  targetChapterOrder: number
  pipelineMode: PipelineMode
  estimatedWordCount: string
  readerEmotionTarget: string
  budgetMode: ContextBudgetMode
  budgetMaxTokens: number
  contextSource: PipelineContextSource
  selectedSnapshot: PromptContextSnapshot | null
  setSelectedJobId: (id: ID) => void
}

export const PIPELINE_STEP_ORDER: ChapterGenerationStepType[] = [
  'context_need_planning',
  'context_budget_selection',
  'build_context',
  'generate_chapter_plan',
  'context_need_planning_from_plan',
  'context_budget_selection_delta',
  'rebuild_context_with_plan',
  'generate_chapter_draft',
  'generate_chapter_review',
  'propose_character_updates',
  'propose_foreshadowing_updates',
  'consistency_review',
  'quality_gate',
  'await_user_confirmation'
]

export const PIPELINE_STEP_LABELS: Record<ChapterGenerationStepType, string> = {
  context_need_planning: '上下文需求规划',
  context_budget_selection: '上下文预算选择',
  build_context: '构建上下文',
  generate_chapter_plan: '生成任务书',
  context_need_planning_from_plan: '计划后需求补全',
  context_budget_selection_delta: '补选上下文',
  rebuild_context_with_plan: '重建计划上下文',
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

function uniqueIds(ids: ID[]): ID[] {
  return [...new Set(ids.filter(Boolean))]
}

function diffIds(next: ID[] = [], previous: ID[] = []): ID[] {
  const previousSet = new Set(previous)
  return uniqueIds(next.filter((id) => !previousSet.has(id)))
}

function enrichContextSelectionTrace(
  baseTrace: ContextSelectionTrace | null | undefined,
  args: {
    jobId: ID
    contextNeedPlan: ContextNeedPlan | null
    includedCharacterStateFacts: CharacterStateFact[]
    hardCanonTrace: { itemCount: number; tokenEstimate: number; includedItemIds: ID[]; truncatedItemIds: ID[] }
    finalPromptTokenEstimate: number
  }
): ContextSelectionTrace | null {
  if (!baseTrace) return null
  const selectedBlocks = [...baseTrace.selectedBlocks]
  const droppedBlocks = [...baseTrace.droppedBlocks]
  const unmetNeeds = [...baseTrace.unmetNeeds]

  for (const fact of args.includedCharacterStateFacts) {
    selectedBlocks.push({
      blockType: 'character_state_fact',
      sourceId: fact.id,
      priority: fact.trackingLevel === 'hard' ? 'must' : 'high',
      tokenEstimate: TokenEstimator.estimate([fact.label, fact.value, fact.evidence].filter(Boolean).join('\n')),
      reason: `角色状态账本事实「${fact.label || fact.key}」进入 prompt，约束本章连续性。`
    })
  }

  const hardCanonToken = args.hardCanonTrace.includedItemIds.length
    ? Math.max(1, Math.round(args.hardCanonTrace.tokenEstimate / args.hardCanonTrace.includedItemIds.length))
    : 0
  for (const itemId of args.hardCanonTrace.includedItemIds) {
    selectedBlocks.push({
      blockType: 'hard_canon',
      sourceId: itemId,
      priority: 'must',
      tokenEstimate: hardCanonToken,
      reason: 'HardCanonPack 条目进入 prompt，作为不可违背硬设定。'
    })
  }
  for (const itemId of args.hardCanonTrace.truncatedItemIds) {
    droppedBlocks.push({
      blockType: 'hard_canon',
      sourceId: itemId,
      priority: 'must',
      tokenEstimate: hardCanonToken,
      dropReason: 'HardCanonPack 超出预算，被压缩或截断。'
    })
    unmetNeeds.push({
      needType: 'hard_canon',
      priority: 'must',
      reason: 'HardCanonPack 有 must/high 条目未完整进入 prompt。',
      sourceId: itemId
    })
  }

  const factsByCharacterId = new Set(args.includedCharacterStateFacts.map((fact) => fact.characterId))
  for (const [characterId, categories] of Object.entries(args.contextNeedPlan?.requiredStateFactCategories ?? {})) {
    if (categories.length > 0 && !factsByCharacterId.has(characterId)) {
      unmetNeeds.push({
        needType: 'character_state',
        priority: 'must',
        reason: `本章需求计划要求角色状态类别 ${categories.join(', ')}，但 prompt 未找到匹配状态事实。`,
        sourceId: characterId
      })
    }
  }

  const seenUnmet = new Set<string>()
  return {
    ...baseTrace,
    jobId: args.jobId,
    selectedBlocks,
    droppedBlocks,
    unmetNeeds: unmetNeeds.filter((item) => {
      const key = `${item.needType}:${item.sourceId ?? ''}:${item.priority}`
      if (seenUnmet.has(key)) return false
      seenUnmet.add(key)
      return true
    }),
    budgetSummary: {
      ...baseTrace.budgetSummary,
      usedTokens: args.finalPromptTokenEstimate,
      reservedTokens: Math.max(0, baseTrace.budgetSummary.totalBudget - args.finalPromptTokenEstimate),
      pressure:
        args.finalPromptTokenEstimate >= baseTrace.budgetSummary.totalBudget * 0.9 || droppedBlocks.length >= 12
          ? 'high'
          : args.finalPromptTokenEstimate >= baseTrace.budgetSummary.totalBudget * 0.7 || droppedBlocks.length >= 4
            ? 'medium'
            : 'low'
    }
  }
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
    contextNeedPlan: snapshot.contextNeedPlan,
    contextSelectionResult: snapshot.contextSelectionResult,
    note: snapshot.note
  }
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

function pipelineChapterTask(
  project: Project,
  options: ReturnType<typeof normalizePipelineOptions>,
  activeStoryDirectionGuide?: StoryDirectionGuide | null
): ChapterTask {
  const directionPatch = StoryDirectionService.deriveChapterTaskPatch(activeStoryDirectionGuide ?? null, options.targetChapterOrder)
  return {
    goal: directionPatch.goal || `生成第 ${options.targetChapterOrder} 章草稿`,
    conflict: directionPatch.conflict || '',
    suspenseToKeep: directionPatch.suspenseToKeep || '',
    allowedPayoffs: directionPatch.allowedPayoffs || '',
    forbiddenPayoffs: directionPatch.forbiddenPayoffs || '',
    endingHook: directionPatch.endingHook || '',
    readerEmotion: directionPatch.readerEmotion || options.readerEmotionTarget,
    targetWordCount: options.estimatedWordCount,
    styleRequirement: project.style
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

function noveltyWarnings(audit: NoveltyAuditResult | null): string[] {
  if (!audit || audit.severity === 'pass') return []
  const findings = [
    ...audit.newNamedCharacters,
    ...audit.newWorldRules,
    ...audit.newSystemMechanics,
    ...audit.newOrganizationsOrRanks,
    ...audit.majorLoreReveals,
    ...audit.suspiciousDeusExRules,
    ...audit.untracedNames
  ]
  return [
    `Novelty audit ${audit.severity}: ${audit.summary}`,
    ...findings.slice(0, 6).map((finding) => `${finding.kind}: ${finding.text} - ${finding.evidenceExcerpt}`)
  ]
}

function noveltyAdjustedConfidence(audit: NoveltyAuditResult | null, base: number): number {
  if (!audit) return base
  if (audit.severity === 'fail') return Math.min(base, 0.35)
  if (audit.severity === 'warning') return Math.min(base, 0.55)
  return base
}

export function usePipelineRunner({
  data,
  project,
  scoped,
  saveData,
  saveGenerationRunBundle,
  targetChapterOrder,
  pipelineMode,
  estimatedWordCount,
  readerEmotionTarget,
  budgetMode,
  budgetMaxTokens,
  contextSource,
  selectedSnapshot,
  setSelectedJobId
}: UsePipelineRunnerArgs) {
  const [pipelineMessage, setPipelineMessage] = useState('')
  const pipelineRunLockRef = useRef(false)
  const [isPipelineRunning, setIsPipelineRunning] = useState(false)
  const aiService = useMemo(() => new AIService(data.settings), [data.settings])

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

  function mergePipelineWorking(current: AppData, working: AppData, jobId?: ID): AppData {
    const next = jobId ? applyGenerationRunBundleToAppData(current, buildGenerationRunBundle(working, jobId)) : current
    return {
      ...next,
      contextBudgetProfiles: appendMissingGenerationRunRelatedItems(next.contextBudgetProfiles, working.contextBudgetProfiles),
      contextNeedPlans: appendMissingGenerationRunRelatedItems(next.contextNeedPlans, working.contextNeedPlans),
      characterStateChangeCandidates: appendMissingGenerationRunRelatedItems(
        next.characterStateChangeCandidates,
        working.characterStateChangeCandidates
      ),
      redundancyReports: appendMissingGenerationRunRelatedItems(next.redundancyReports, working.redundancyReports)
    }
  }

  async function persistWorking(next: AppData, jobId?: ID, statusMessage?: string): Promise<AppData> {
    if (jobId && saveGenerationRunBundle) {
      const bundle = buildGenerationRunBundle(next, jobId)
      await saveGenerationRunBundle((current) => mergePipelineWorking(current, next, jobId), bundle)
    } else {
      await saveData((current) => mergePipelineWorking(current, next, jobId))
    }
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
    if (!tryAcquirePipelineRunLock(pipelineRunLockRef)) {
      setPipelineMessage('流水线正在运行，请等待当前任务结束后再启动。')
      return
    }
    setIsPipelineRunning(true)
    try {
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
      currentStep: 'context_need_planning',
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
    await persistWorking(working, job.id)
    setSelectedJobId(job.id)
    await runPipelineFromStep(working, job.id, 'context_need_planning', {
      targetChapterOrder,
      pipelineMode,
      estimatedWordCount,
      readerEmotionTarget,
      budgetMode,
      budgetMaxTokens
    })
    } catch (error) {
      setPipelineMessage(error instanceof Error ? error.message : String(error))
    } finally {
      releasePipelineRunLock(pipelineRunLockRef)
      setIsPipelineRunning(false)
    }
  }

  async function skipStep(job: ChapterGenerationJob, step: ChapterGenerationStep) {
    await saveData((current) =>
      updateStepInData(current, step.id, { status: 'skipped', errorMessage: '' }, { currentStep: step.type, status: job.status })
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
    const activeStoryDirectionGuide =
      job.contextSource === 'prompt_snapshot'
        ? null
        : StoryDirectionService.getActiveGuideForChapter(
            working.storyDirectionGuides ?? [],
            project.id,
            options.targetChapterOrder
          )
    const activeStoryDirectionBeat = activeStoryDirectionGuide
      ? StoryDirectionService.getBeatForChapter(activeStoryDirectionGuide, options.targetChapterOrder)
      : null
    const storyDirectionTracePatch = {
      storyDirectionGuideId: activeStoryDirectionGuide?.id ?? null,
      storyDirectionGuideSource: activeStoryDirectionGuide?.source ?? null,
      storyDirectionGuideHorizon: activeStoryDirectionGuide?.horizonChapters ?? null,
      storyDirectionGuideStartChapterOrder: activeStoryDirectionGuide?.startChapterOrder ?? null,
      storyDirectionGuideEndChapterOrder: activeStoryDirectionGuide?.endChapterOrder ?? null,
      storyDirectionBeatId: activeStoryDirectionBeat?.id ?? null,
      storyDirectionAppliedToChapterTask: Boolean(activeStoryDirectionGuide)
    }
    let context = ''
    let plan: ChapterPlan | null = null
    let draftResult: ChapterDraftResult | null = null
    let noveltyAuditResult: NoveltyAuditResult | null = null
    let planGapAnalysis: PlanContextGapAnalysisResult | null = null
    let contextNeedPlanFromPlan: ContextNeedPlan | null = null
    let rebuiltContextFromPlan = false
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
    noveltyAuditResult = working.generationRunTraces.find((trace) => trace.jobId === jobId)?.noveltyAuditResult ?? null
    let contextNeedPlan: ContextNeedPlan | null = snapshot?.contextNeedPlan ?? null
    const needPlanStep = steps.find((step) => step.type === 'context_need_planning')
    if (needPlanStep?.output) {
      const savedNeedPlan = parseOutput<ContextNeedPlan | null>(needPlanStep.output, null)
      if (savedNeedPlan) contextNeedPlan = savedNeedPlan
    }
    let budgetProfile = createContextBudgetProfile(project.id, options.budgetMode, options.budgetMaxTokens, `第 ${options.targetChapterOrder} 章流水线预算`)
    let budgetSelection: ContextSelectionResult | null = null
    const budgetStep = steps.find((step) => step.type === 'context_budget_selection')
    if (budgetStep?.output) {
      const savedBudget = parseOutput<{ profile?: ContextBudgetProfile; selection?: ContextSelectionResult } | null>(budgetStep.output, null)
      if (savedBudget?.profile) budgetProfile = savedBudget.profile
      if (savedBudget?.selection) budgetSelection = savedBudget.selection
    }
    const planNeedStep = steps.find((step) => step.type === 'context_need_planning_from_plan')
    if (planNeedStep?.output) {
      planGapAnalysis = parseOutput<PlanContextGapAnalysisResult | null>(planNeedStep.output, null)
      if (planGapAnalysis?.derivedContextNeedPlan) {
        contextNeedPlanFromPlan = planGapAnalysis.derivedContextNeedPlan
        if (job.contextSource !== 'prompt_snapshot') contextNeedPlan = contextNeedPlanFromPlan
      }
    }
    const budgetDeltaStep = steps.find((step) => step.type === 'context_budget_selection_delta')
    if (budgetDeltaStep?.output) {
      const savedBudget = parseOutput<{ profile?: ContextBudgetProfile; selection?: ContextSelectionResult } | null>(budgetDeltaStep.output, null)
      if (savedBudget?.profile) budgetProfile = savedBudget.profile
      if (savedBudget?.selection) budgetSelection = savedBudget.selection
    }
    const rebuildContextStep = steps.find((step) => step.type === 'rebuild_context_with_plan')
    if (rebuildContextStep?.output) {
      context = pipelineContextFromStepOutput(rebuildContextStep.output)
      if (context.trim()) rebuiltContextFromPlan = true
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
      await persistWorking(working, jobId)

      try {
        if (type === 'context_need_planning') {
          if (job.contextSource === 'prompt_snapshot') {
            if (!snapshot) throw new Error('Prompt 上下文快照已丢失，请重新构建上下文。')
            contextNeedPlan = snapshot.contextNeedPlan ?? null
            working = updateStepInData(working, step.id, {
              status: 'completed',
              output: serializeOutput(contextNeedPlan ?? {
                id: null,
                contextSource: 'prompt_context_snapshot',
                snapshotId: snapshot.id,
                warning: '该快照没有保存上下文需求计划，将沿用快照中的上下文选择。'
              })
            })
          } else {
            const scopedChapters = working.chapters.filter((chapter) => chapter.projectId === project.id)
            const previousChapter = scopedChapters.find((chapter) => chapter.order === options.targetChapterOrder - 1) ?? null
            const continuityResult = resolveContinuityBridge({
              projectId: project.id,
              chapters: scopedChapters,
              bridges: working.chapterContinuityBridges.filter((bridge) => bridge.projectId === project.id),
              targetChapterOrder: options.targetChapterOrder
            })
            contextNeedPlan = ContextNeedPlannerService.buildFromChapterIntent({
              project,
              storyBible: scoped.bible,
              targetChapterOrder: options.targetChapterOrder,
              chapterTaskDraft: pipelineChapterTask(project, options, activeStoryDirectionGuide),
              previousChapter,
              continuityBridge: continuityResult.bridge,
              characters: scoped.characters,
              characterStateFacts: scoped.characterStateFacts,
              foreshadowing: scoped.foreshadowings,
              timelineEvents: scoped.timelineEvents,
              stageSummaries: scoped.stageSummaries,
              storyDirectionGuide: activeStoryDirectionGuide,
              storyDirectionPromptText: StoryDirectionService.formatForPrompt(activeStoryDirectionGuide, options.targetChapterOrder),
              source: 'generation_pipeline'
            })
            working = {
              ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(contextNeedPlan) }),
              contextNeedPlans: [contextNeedPlan, ...working.contextNeedPlans.filter((plan) => plan.id !== contextNeedPlan?.id)]
            }
          }
        }

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
            budgetSelection = selectBudgetContext(project, working, options.targetChapterOrder, budgetProfile, {
              chapterTask: pipelineChapterTask(project, options, activeStoryDirectionGuide),
              contextNeedPlan
            })
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
          let promptBlockOrder: PromptBlockOrderItem[] = []
          let hardCanonTrace = { itemCount: 0, tokenEstimate: 0, includedItemIds: [] as ID[], truncatedItemIds: [] as ID[] }
          if (job.contextSource === 'prompt_snapshot') {
            if (!snapshot) throw new Error('Prompt 上下文快照已丢失，请重新构建上下文。')
            context = snapshot.finalPrompt
            promptBlockOrder = inferPromptBlockOrderFromPrompt(context, 'prompt_context_snapshot')
          } else {
            if (!budgetSelection) {
              budgetSelection = selectBudgetContext(project, working, options.targetChapterOrder, budgetProfile, {
                chapterTask: pipelineChapterTask(project, options, activeStoryDirectionGuide),
                contextNeedPlan
              })
            }
            const promptResult = buildPipelineContextResultFromSelection(
              project,
              working,
              options.targetChapterOrder,
              options.readerEmotionTarget,
              options.estimatedWordCount,
              budgetProfile,
              budgetSelection,
              contextNeedPlan,
              activeStoryDirectionGuide
            )
            context = promptResult.finalPrompt
            promptBlockOrder = promptResult.promptBlockOrder
            hardCanonTrace = {
              itemCount: promptResult.hardCanonPrompt?.itemCount ?? 0,
              tokenEstimate: promptResult.hardCanonPrompt?.tokenEstimate ?? 0,
              includedItemIds: promptResult.hardCanonPrompt?.includedItemIds ?? [],
              truncatedItemIds: promptResult.hardCanonPrompt?.truncatedItemIds ?? []
            }
          }
          const continuityResult = resolveContinuityBridge({
            projectId: project.id,
            chapters: working.chapters.filter((chapter) => chapter.projectId === project.id),
            bridges: working.chapterContinuityBridges.filter((bridge) => bridge.projectId === project.id),
            targetChapterOrder: options.targetChapterOrder
          })
          if (continuityResult.bridge && !context.includes('上一章结尾衔接')) {
            context = `${context}\n\n## 上一章结尾衔接\n${formatContinuityBridgeForPrompt(continuityResult.bridge)}`
            promptBlockOrder = [
              ...promptBlockOrder,
              {
                id: 'forced-continuity-bridge',
                title: '上一章结尾衔接',
                kind: 'continuity_bridge',
                priority: promptBlockOrder.length + 1,
                tokenEstimate: TokenEstimator.estimate(formatContinuityBridgeForPrompt(continuityResult.bridge)),
                source: continuityResult.source ?? 'continuity_service',
                sourceIds: [continuityResult.bridge.id],
                included: true,
                compressed: false,
                forced: true,
                omittedReason: null,
                reason: '快照或旧 prompt 缺少上一章衔接时，由流水线作为 forced context 追加。'
              }
            ]
          }
          const continuityPromptBlock = continuityResult.bridge ? formatContinuityBridgeForPrompt(continuityResult.bridge) : ''
          const forcedContextBlocks: ForcedContextBlock[] = continuityResult.bridge
            ? [
                {
                  kind: 'continuity_bridge',
                  sourceId: continuityResult.bridge.id,
                  sourceType: continuityResult.source,
                  sourceChapterId: continuityResult.bridge.fromChapterId,
                  sourceChapterOrder: options.targetChapterOrder > 1 ? options.targetChapterOrder - 1 : null,
                  title: '上一章结尾衔接',
                  tokenEstimate: TokenEstimator.estimate(continuityPromptBlock)
                }
              ]
            : []
          const finalPromptTokenEstimate = TokenEstimator.estimate(context)
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
          const selectedTimelineEventIds = snapshot ? snapshot.contextSelectionResult.selectedTimelineEventIds : budgetSelection?.selectedTimelineEventIds ?? []
          const treatmentOverrides = snapshot?.foreshadowingTreatmentOverrides ?? {}
          const includedCharacterStateFacts = CharacterStateService.getRelevantCharacterStatesForPrompt(
            selectedCharacterIds,
            contextNeedPlan,
            options.targetChapterOrder,
            working.characterStateFacts.filter((fact) => fact.projectId === project.id)
          )
          const contextSelectionTrace = enrichContextSelectionTrace(
            snapshot?.contextSelectionResult.contextSelectionTrace ?? budgetSelection?.contextSelectionTrace,
            {
              jobId: job.id,
              contextNeedPlan,
              includedCharacterStateFacts,
              hardCanonTrace,
              finalPromptTokenEstimate
            }
          )
          working = upsertGenerationRunTrace(working, job, {
            ...storyDirectionTracePatch,
            targetChapterOrder: options.targetChapterOrder,
            promptContextSnapshotId: job.promptContextSnapshotId ?? null,
            contextSource: job.contextSource,
            selectedChapterIds: snapshot ? snapshot.contextSelectionResult.selectedChapterIds : budgetSelection?.selectedChapterIds ?? [],
            selectedStageSummaryIds: snapshot ? snapshot.contextSelectionResult.selectedStageSummaryIds : budgetSelection?.selectedStageSummaryIds ?? [],
            selectedCharacterIds,
            selectedForeshadowingIds,
            selectedTimelineEventIds,
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
            contextTokenEstimate: Math.max(0, finalPromptTokenEstimate - estimateForcedContextTokens(forcedContextBlocks)),
            forcedContextBlocks,
            compressionRecords: budgetSelection?.compressionRecords ?? [],
            promptBlockOrder,
            finalPromptTokenEstimate,
            continuityBridgeId: continuityResult.bridge?.id ?? null,
            continuitySource: continuityResult.source,
            continuityWarnings: continuityResult.warnings,
            contextNeedPlanId: contextNeedPlan?.id ?? null,
            requiredCharacterCardFields: contextNeedPlan?.requiredCharacterCardFields ?? {},
            requiredStateFactCategories: contextNeedPlan?.requiredStateFactCategories ?? {},
            contextNeedPlanWarnings: contextNeedPlan?.warnings ?? [],
            contextNeedPlanMatchedItems: [
              ...(contextNeedPlan?.expectedCharacters.map((item) => item.characterId) ?? []),
              ...(contextNeedPlan?.requiredForeshadowingIds ?? []),
              ...(contextNeedPlan?.requiredTimelineEventIds ?? [])
            ],
            contextNeedPlanOmittedItems: (budgetSelection?.omittedItems ?? []).filter((item) =>
              contextNeedPlan
                ? contextNeedPlan.expectedCharacters.some((character) => character.characterId === item.id) ||
                  contextNeedPlan.requiredForeshadowingIds.includes(item.id ?? '') ||
                  contextNeedPlan.requiredTimelineEventIds.includes(item.id ?? '')
                : false
            ),
            includedCharacterStateFactIds: includedCharacterStateFacts.map((fact) => fact.id),
            characterStateWarnings: includedCharacterStateFacts.length
              ? []
              : contextNeedPlan
                ? ['上下文需求计划要求角色状态类别，但本章没有匹配的状态账本事实。']
                : [],
            characterStateIssueIds: [],
            hardCanonPackItemCount: hardCanonTrace.itemCount,
            hardCanonPackTokenEstimate: hardCanonTrace.tokenEstimate,
            includedHardCanonItemIds: hardCanonTrace.includedItemIds,
            truncatedHardCanonItemIds: hardCanonTrace.truncatedItemIds,
            contextSelectionTrace
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

        if (type === 'context_need_planning_from_plan') {
          if (!plan) throw new Error('缺少章节任务书，无法进行计划后上下文补全')
          const analysis = PlanContextGapAnalyzerService.buildFromChapterPlan({
            project,
            targetChapterOrder: options.targetChapterOrder,
            baseContextNeedPlan: contextNeedPlan,
            plan,
            characters: working.characters.filter((character) => character.projectId === project.id),
            foreshadowings: working.foreshadowings.filter((item) => item.projectId === project.id),
            timelineEvents: working.timelineEvents.filter((event) => event.projectId === project.id),
            characterStateFacts: working.characterStateFacts.filter((fact) => fact.projectId === project.id)
          })
          planGapAnalysis =
            job.contextSource === 'prompt_snapshot'
              ? {
                  ...analysis,
                  warnings: [...analysis.warnings, 'Prompt 快照模式不会自动补选上下文；如任务书新增了角色、伏笔或时间线，请回到 Prompt 构建器重新保存快照。'],
                  reason: 'Prompt 快照模式保持用户手动上下文，不自动重建。'
                }
              : analysis
          if (job.contextSource !== 'prompt_snapshot') {
            contextNeedPlanFromPlan = planGapAnalysis.derivedContextNeedPlan
            contextNeedPlan = contextNeedPlanFromPlan
            working = {
              ...working,
              contextNeedPlans: [contextNeedPlanFromPlan, ...working.contextNeedPlans.filter((item) => item.id !== contextNeedPlanFromPlan?.id)]
            }
          }
          working = updateStepInData(working, step.id, {
            status: 'completed',
            output: serializeOutput(planGapAnalysis)
          })
        }

        if (type === 'context_budget_selection_delta') {
          if (job.contextSource === 'prompt_snapshot') {
            if (!snapshot) throw new Error('Prompt 上下文快照已丢失，请重新构建上下文。')
            budgetProfile = snapshot.budgetProfile
            budgetSelection = snapshot.contextSelectionResult
            working = updateStepInData(working, step.id, {
              status: 'completed',
              output: serializeOutput({
                profile: budgetProfile,
                selection: budgetSelection,
                explanation: ContextBudgetManager.explainSelection(budgetSelection),
                deltaFromPreviousSelection: {
                  addedCharacterIds: [],
                  addedForeshadowingIds: [],
                  addedTimelineEventIds: [],
                  addedChapterIds: [],
                  addedStageSummaryIds: []
                },
                warning: 'Prompt 快照模式已跳过计划后二次补选，正文将继续使用快照上下文。'
              })
            })
          } else {
            const previousSelection = budgetSelection
            const activeNeedPlan = contextNeedPlanFromPlan ?? contextNeedPlan
            if (!activeNeedPlan) throw new Error('缺少上下文需求计划，无法进行计划后补选。')
            budgetProfile = createContextBudgetProfile(project.id, options.budgetMode, options.budgetMaxTokens, `第 ${options.targetChapterOrder} 章计划后预算`)
            budgetSelection = selectBudgetContext(project, working, options.targetChapterOrder, budgetProfile, {
              characterIds: uniqueIds(activeNeedPlan.expectedCharacters.map((item) => item.characterId)),
              foreshadowingIds: activeNeedPlan.requiredForeshadowingIds,
              chapterTask: pipelineChapterTask(project, options, activeStoryDirectionGuide),
              contextNeedPlan: activeNeedPlan
            })
            const deltaFromPreviousSelection = {
              addedCharacterIds: diffIds(budgetSelection.selectedCharacterIds, previousSelection?.selectedCharacterIds ?? []),
              addedForeshadowingIds: diffIds(budgetSelection.selectedForeshadowingIds, previousSelection?.selectedForeshadowingIds ?? []),
              addedTimelineEventIds: diffIds(budgetSelection.selectedTimelineEventIds, previousSelection?.selectedTimelineEventIds ?? []),
              addedChapterIds: diffIds(budgetSelection.selectedChapterIds, previousSelection?.selectedChapterIds ?? []),
              addedStageSummaryIds: diffIds(budgetSelection.selectedStageSummaryIds, previousSelection?.selectedStageSummaryIds ?? [])
            }
            working = {
              ...updateStepInData(working, step.id, {
                status: 'completed',
                output: serializeOutput({
                  profile: budgetProfile,
                  selection: budgetSelection,
                  explanation: ContextBudgetManager.explainSelection(budgetSelection),
                  deltaFromPreviousSelection
                })
              }),
              contextBudgetProfiles: [budgetProfile, ...working.contextBudgetProfiles]
            }
          }
        }

        if (type === 'rebuild_context_with_plan') {
          let promptBlockOrder: PromptBlockOrderItem[] = []
          let hardCanonTrace = { itemCount: 0, tokenEstimate: 0, includedItemIds: [] as ID[], truncatedItemIds: [] as ID[] }
          if (job.contextSource === 'prompt_snapshot') {
            if (!snapshot) throw new Error('Prompt 上下文快照已丢失，请重新构建上下文。')
            context = snapshot.finalPrompt
            promptBlockOrder = inferPromptBlockOrderFromPrompt(context, 'prompt_context_snapshot')
            rebuiltContextFromPlan = true
          } else {
            if (!budgetSelection) throw new Error('缺少计划后预算选择，无法重建上下文。')
            const promptResult = buildPipelineContextResultFromSelection(
              project,
              working,
              options.targetChapterOrder,
              options.readerEmotionTarget,
              options.estimatedWordCount,
              budgetProfile,
              budgetSelection,
              contextNeedPlanFromPlan ?? contextNeedPlan,
              activeStoryDirectionGuide
            )
            context = promptResult.finalPrompt
            promptBlockOrder = promptResult.promptBlockOrder
            hardCanonTrace = {
              itemCount: promptResult.hardCanonPrompt?.itemCount ?? 0,
              tokenEstimate: promptResult.hardCanonPrompt?.tokenEstimate ?? 0,
              includedItemIds: promptResult.hardCanonPrompt?.includedItemIds ?? [],
              truncatedItemIds: promptResult.hardCanonPrompt?.truncatedItemIds ?? []
            }
            rebuiltContextFromPlan = true
          }
          const continuityResult = resolveContinuityBridge({
            projectId: project.id,
            chapters: working.chapters.filter((chapter) => chapter.projectId === project.id),
            bridges: working.chapterContinuityBridges.filter((bridge) => bridge.projectId === project.id),
            targetChapterOrder: options.targetChapterOrder
          })
          if (continuityResult.bridge && !context.includes('上一章结尾衔接')) {
            const bridgePrompt = formatContinuityBridgeForPrompt(continuityResult.bridge)
            context = `${context}\n\n## 上一章结尾衔接\n${bridgePrompt}`
            promptBlockOrder = [
              ...promptBlockOrder,
              {
                id: 'forced-continuity-bridge',
                title: '上一章结尾衔接',
                kind: 'continuity_bridge',
                priority: promptBlockOrder.length + 1,
                tokenEstimate: TokenEstimator.estimate(bridgePrompt),
                source: continuityResult.source ?? 'continuity_service',
                sourceIds: [continuityResult.bridge.id],
                included: true,
                compressed: false,
                forced: true,
                omittedReason: null,
                reason: '计划后重建上下文仍缺少上一章衔接时，由流水线作为 forced context 追加。'
              }
            ]
          }
          const continuityPromptBlock = continuityResult.bridge ? formatContinuityBridgeForPrompt(continuityResult.bridge) : ''
          const forcedContextBlocks: ForcedContextBlock[] = continuityResult.bridge
            ? [
                {
                  kind: 'continuity_bridge',
                  sourceId: continuityResult.bridge.id,
                  sourceType: continuityResult.source,
                  sourceChapterId: continuityResult.bridge.fromChapterId,
                  sourceChapterOrder: options.targetChapterOrder > 1 ? options.targetChapterOrder - 1 : null,
                  title: '上一章结尾衔接',
                  tokenEstimate: TokenEstimator.estimate(continuityPromptBlock)
                }
              ]
            : []
          const finalPromptTokenEstimate = TokenEstimator.estimate(context)
          const selectedCharacterIds = snapshot ? snapshot.selectedCharacterIds : budgetSelection?.selectedCharacterIds ?? []
          const selectedForeshadowingIds = snapshot ? snapshot.selectedForeshadowingIds : budgetSelection?.selectedForeshadowingIds ?? []
          const selectedTimelineEventIds = snapshot ? snapshot.contextSelectionResult.selectedTimelineEventIds : budgetSelection?.selectedTimelineEventIds ?? []
          const treatmentOverrides = snapshot?.foreshadowingTreatmentOverrides ?? {}
          const activeNeedPlan = contextNeedPlanFromPlan ?? contextNeedPlan
          const includedCharacterStateFacts = CharacterStateService.getRelevantCharacterStatesForPrompt(
            selectedCharacterIds,
            activeNeedPlan,
            options.targetChapterOrder,
            working.characterStateFacts.filter((fact) => fact.projectId === project.id)
          )
          const contextSelectionTrace = enrichContextSelectionTrace(
            snapshot?.contextSelectionResult.contextSelectionTrace ?? budgetSelection?.contextSelectionTrace,
            {
              jobId: job.id,
              contextNeedPlan: activeNeedPlan,
              includedCharacterStateFacts,
              hardCanonTrace,
              finalPromptTokenEstimate
            }
          )
          working = updateStepInData(working, step.id, {
            status: 'completed',
            output: serializeOutput({
              finalPrompt: context,
              promptBlockOrder,
              contextNeedPlanId: activeNeedPlan?.id ?? null,
              selectedCharacterIds,
              selectedForeshadowingIds,
              selectedTimelineEventIds,
              includedCharacterStateFactIds: includedCharacterStateFacts.map((fact) => fact.id),
              warnings: [...(budgetSelection?.warnings ?? []), ...continuityResult.warnings, ...(planGapAnalysis?.warnings ?? [])]
            })
          })
          working = upsertGenerationRunTrace(working, job, {
            ...storyDirectionTracePatch,
            targetChapterOrder: options.targetChapterOrder,
            promptContextSnapshotId: job.promptContextSnapshotId ?? null,
            contextSource: job.contextSource,
            selectedChapterIds: snapshot ? snapshot.contextSelectionResult.selectedChapterIds : budgetSelection?.selectedChapterIds ?? [],
            selectedStageSummaryIds: snapshot ? snapshot.contextSelectionResult.selectedStageSummaryIds : budgetSelection?.selectedStageSummaryIds ?? [],
            selectedCharacterIds,
            selectedForeshadowingIds,
            selectedTimelineEventIds,
            foreshadowingTreatmentModes: buildForeshadowingTreatmentModes(working.foreshadowings, selectedForeshadowingIds, treatmentOverrides),
            foreshadowingTreatmentOverrides: treatmentOverrides,
            omittedContextItems: budgetSelection?.omittedItems ?? [],
            contextWarnings: [
              ...(budgetSelection?.warnings ?? []),
              ...continuityResult.warnings,
              ...(planGapAnalysis?.warnings ?? []),
              ...(snapshot && snapshot.targetChapterOrder !== options.targetChapterOrder
                ? [`快照目标为第 ${snapshot.targetChapterOrder} 章，流水线目标为第 ${options.targetChapterOrder} 章。`]
                : [])
            ],
            contextTokenEstimate: Math.max(0, finalPromptTokenEstimate - estimateForcedContextTokens(forcedContextBlocks)),
            forcedContextBlocks,
            compressionRecords: budgetSelection?.compressionRecords ?? [],
            promptBlockOrder,
            finalPromptTokenEstimate,
            continuityBridgeId: continuityResult.bridge?.id ?? null,
            continuitySource: continuityResult.source,
            continuityWarnings: continuityResult.warnings,
            contextNeedPlanId: activeNeedPlan?.id ?? null,
            requiredCharacterCardFields: activeNeedPlan?.requiredCharacterCardFields ?? {},
            requiredStateFactCategories: activeNeedPlan?.requiredStateFactCategories ?? {},
            contextNeedPlanWarnings: activeNeedPlan?.warnings ?? [],
            contextNeedPlanMatchedItems: [
              ...(activeNeedPlan?.expectedCharacters.map((item) => item.characterId) ?? []),
              ...(activeNeedPlan?.requiredForeshadowingIds ?? []),
              ...(activeNeedPlan?.requiredTimelineEventIds ?? [])
            ],
            contextNeedPlanOmittedItems: (budgetSelection?.omittedItems ?? []).filter((item) =>
              activeNeedPlan
                ? activeNeedPlan.expectedCharacters.some((character) => character.characterId === item.id) ||
                  activeNeedPlan.requiredForeshadowingIds.includes(item.id ?? '') ||
                  activeNeedPlan.requiredTimelineEventIds.includes(item.id ?? '')
                : false
            ),
            includedCharacterStateFactIds: includedCharacterStateFacts.map((fact) => fact.id),
            characterStateWarnings: includedCharacterStateFacts.length
              ? []
              : activeNeedPlan
                ? ['上下文需求计划要求角色状态类别，但本章没有匹配的状态账本事实。']
                : [],
            characterStateIssueIds: [],
            hardCanonPackItemCount: hardCanonTrace.itemCount,
            hardCanonPackTokenEstimate: hardCanonTrace.tokenEstimate,
            includedHardCanonItemIds: hardCanonTrace.includedItemIds,
            truncatedHardCanonItemIds: hardCanonTrace.truncatedItemIds,
            contextSelectionTrace
          })
        }

        if (type === 'generate_chapter_draft') {
          if (!plan) throw new Error('缺少章节任务书，无法生成正文')
          if (job.contextSource !== 'prompt_snapshot' && !rebuiltContextFromPlan) throw new Error('缺少计划后重建上下文，无法生成正文。')
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
          noveltyAuditResult = NoveltyDetector.audit({
            generatedText: result.data.body,
            context,
            chapterPlan: plan
          })
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
          redundancyReport.jobId = jobId
          redundancyReport.updatedAt = redundancyReport.createdAt
          draftRecord = draft
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
            generatedChapterDrafts: [draft, ...working.generatedChapterDrafts],
            redundancyReports: [redundancyReport, ...working.redundancyReports]
          }
          working = upsertGenerationRunTrace(working, job, {
            generatedDraftId: draft.id,
            redundancyReportId: redundancyReport.id,
            noveltyAuditResult
          })
        }

        if (type === 'generate_chapter_review') {
          if (!draftResult) throw new Error('缺少章节正文草稿，无法复盘')
          const result = await aiService.generateChapterReview(draftResult.body, context)
          if (!result.data) throw new Error(result.error || result.parseError || '复盘生成失败')
          const auditWarnings = noveltyWarnings(noveltyAuditResult)
          const candidate: MemoryUpdateCandidate = {
            id: newId(),
            projectId: project.id,
            jobId,
            type: 'chapter_review',
            targetId: null,
            proposedPatch: {
              schemaVersion: 1,
              kind: 'chapter_review_update',
              summary: result.data.summary || '??????',
              sourceChapterOrder: options.targetChapterOrder,
              warnings: auditWarnings,
              targetChapterId: null,
              targetChapterOrder: options.targetChapterOrder,
              review: {
                summary: result.data.summary,
                newInformation: result.data.newInformation,
                characterChanges: result.data.characterChanges,
                newForeshadowing: result.data.newForeshadowing,
                resolvedForeshadowing: result.data.resolvedForeshadowing,
                endingHook: result.data.endingHook,
                riskWarnings: result.data.riskWarnings
              },
              continuityBridgeSuggestion: result.data.continuityBridgeSuggestion ?? null
            },
            evidence: 'AI 对生成正文的章节复盘草稿',
            confidence: noveltyAdjustedConfidence(noveltyAuditResult, result.usedAI ? 0.75 : 0),
            status: 'pending',
            createdAt: now(),
            updatedAt: now()
          }
          const stateCandidates: CharacterStateChangeCandidate[] = result.data.characterStateChangeSuggestions.map((suggestion) => {
            const existingFact = working.characterStateFacts.find(
              (fact) => fact.projectId === project.id && fact.characterId === suggestion.characterId && fact.key === suggestion.key && fact.status === 'active'
            )
            const fact: CharacterStateFact = {
              id: existingFact?.id ?? newId(),
              projectId: project.id,
              characterId: suggestion.characterId,
              category: suggestion.category,
              key: suggestion.key,
              label: suggestion.label,
              valueType: Array.isArray(suggestion.afterValue) ? 'list' : typeof suggestion.afterValue === 'number' ? 'number' : 'text',
              value: suggestion.afterValue ?? existingFact?.value ?? '',
              unit: existingFact?.unit ?? '',
              linkedCardFields: suggestion.linkedCardFields,
              trackingLevel: suggestion.category === 'status' || suggestion.category === 'relationship' ? 'soft' : 'hard',
              promptPolicy: 'when_relevant',
              status: 'active',
              sourceChapterId: null,
              sourceChapterOrder: options.targetChapterOrder,
              evidence: suggestion.evidence,
              confidence: suggestion.confidence,
              createdAt: existingFact?.createdAt ?? now(),
              updatedAt: now()
            }
            const transaction: CharacterStateTransaction = {
              id: newId(),
              projectId: project.id,
              characterId: suggestion.characterId,
              factId: fact.id,
              chapterId: null,
              chapterOrder: options.targetChapterOrder,
              transactionType: suggestion.suggestedTransactionType,
              beforeValue: suggestion.beforeValue ?? existingFact?.value ?? null,
              afterValue: suggestion.afterValue,
              delta: suggestion.delta,
              reason: suggestion.evidence,
              evidence: suggestion.evidence,
              source: 'pipeline',
              status: 'pending',
              createdAt: now(),
              updatedAt: now()
            }
            return {
              id: newId(),
              projectId: project.id,
              jobId,
              characterId: suggestion.characterId,
              chapterId: null,
              chapterOrder: options.targetChapterOrder,
              candidateType: suggestion.changeType,
              targetFactId: existingFact?.id ?? null,
              proposedFact: fact,
              proposedTransaction: transaction,
              beforeValue: suggestion.beforeValue ?? existingFact?.value ?? null,
              afterValue: suggestion.afterValue,
              evidence: suggestion.evidence,
              confidence: suggestion.confidence,
              riskLevel: suggestion.riskLevel,
              status: 'pending',
              createdAt: now(),
              updatedAt: now()
            }
          })
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
            memoryUpdateCandidates: [candidate, ...working.memoryUpdateCandidates],
            characterStateChangeCandidates: [...stateCandidates, ...working.characterStateChangeCandidates]
          }
        }

        if (type === 'propose_character_updates') {
          if (!draftResult) throw new Error('缺少章节正文草稿，无法提取角色更新')
          const result = await aiService.updateCharacterStates(draftResult.body, scoped.characters, context)
          if (!result.data) throw new Error(result.error || result.parseError || '角色更新提取失败')
          const auditWarnings = noveltyWarnings(noveltyAuditResult)
          const candidates: MemoryUpdateCandidate[] = result.data.map((suggestion) => ({
            id: newId(),
            projectId: project.id,
            jobId,
            type: 'character',
            targetId: suggestion.characterId,
            proposedPatch: {
              schemaVersion: 1,
              kind: 'character_state_update',
              summary: suggestion.changeSummary || '??????',
              sourceChapterOrder: options.targetChapterOrder,
              warnings: auditWarnings,
              characterId: suggestion.characterId,
              relatedChapterId: suggestion.relatedChapterId ?? null,
              relatedChapterOrder: options.targetChapterOrder,
              changeSummary: suggestion.changeSummary,
              newCurrentEmotionalState: suggestion.newCurrentEmotionalState,
              newRelationshipWithProtagonist: suggestion.newRelationshipWithProtagonist,
              newNextActionTendency: suggestion.newNextActionTendency
            },
            evidence: suggestion.changeSummary,
            confidence: noveltyAdjustedConfidence(noveltyAuditResult, suggestion.confidence),
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
          const auditWarnings = noveltyWarnings(noveltyAuditResult)
          const newCandidates: MemoryUpdateCandidate[] = result.data.newForeshadowingCandidates.map((candidate) => ({
            id: newId(),
            projectId: project.id,
            jobId,
            type: 'foreshadowing',
            targetId: null,
            proposedPatch: {
              schemaVersion: 1,
              kind: 'foreshadowing_create',
              summary: candidate.title || '????',
              sourceChapterOrder: options.targetChapterOrder,
              warnings: auditWarnings,
              candidate
            },
            evidence: candidate.description,
            confidence: noveltyAdjustedConfidence(noveltyAuditResult, result.usedAI ? 0.7 : 0),
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
            proposedPatch: {
              schemaVersion: 1,
              kind: 'foreshadowing_status_update',
              summary: change.evidenceText || '??????',
              sourceChapterOrder: options.targetChapterOrder,
              warnings: auditWarnings,
              foreshadowingId: change.foreshadowingId,
              suggestedStatus: change.suggestedStatus,
              recommendedTreatmentMode: change.recommendedTreatmentMode,
              actualPayoffChapter: change.suggestedStatus === 'resolved' ? options.targetChapterOrder : null,
              evidenceText: change.evidenceText,
              notes: change.notes
            },
            evidence: change.evidenceText,
            confidence: noveltyAdjustedConfidence(noveltyAuditResult, change.confidence),
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
          noveltyAuditResult =
            noveltyAuditResult ??
            NoveltyDetector.audit({
              generatedText: (draftRecord ?? draftResult).body,
              context,
              chapterPlan: plan
            })
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
          working = upsertGenerationRunTrace(working, job, { qualityGateReportId: report.id, noveltyAuditResult })
        }

        if (type === 'await_user_confirmation') {
          working = updateStepInData(working, step.id, { status: 'completed', output: '等待用户确认章节草稿和记忆更新候选。' }, { status: 'completed', currentStep: type })
        }

        await persistWorking(working, jobId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        working = updateStepInData(working, step.id, { status: 'failed', errorMessage: message }, { status: 'failed', errorMessage: message })
        await persistWorking(working, jobId)
        break
      }
    }
  }

  return {
    pipelineMessage,
    setPipelineMessage,
    isPipelineRunning,
    runPipeline,
    retryStep,
    skipStep
  }
}
