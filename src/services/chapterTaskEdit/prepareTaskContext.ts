import type { AppData, ChapterGenerationJob, ChapterGenerationStep, ChapterPlan, ContextBudgetProfile, ContextSelectionResult, GenerationRunTrace, PromptBlockOrderItem } from '../../shared/types'
import type { PrepareChapterTaskEditInput } from '../ChapterTaskEditService'
import { TokenEstimator } from '../TokenEstimator'
import { PromptLintService } from '../PromptLintService'
import { PromptCompositionMetricsService } from '../PromptCompositionMetricsService'
import { fieldLine, inferPromptBlockOrderFromPrompt } from '../promptFormatters/promptUtils'
import { createEmptyGenerationRunTrace, estimateForcedContextTokens } from '../../renderer/src/utils/runTrace'
import { projectData } from '../../renderer/src/utils/projectData'
import { createContextBudgetProfile } from '../../renderer/src/utils/contextBudgetProfile'
import { PIPELINE_STEP_ORDER } from '../../renderer/src/views/generation/pipelineStepDefinitions'
import { runBuildContextStep, runContextBudgetSelectionStep, runContextNeedPlanningStep } from '../../renderer/src/views/generation/pipelineSteps/contextPlanning'
import type { PipelineStepHandlerContext } from '../../renderer/src/views/generation/pipelineRunnerTypes'

function parsed<T>(value: string | undefined): T | null {
  if (!value) return null
  try { return JSON.parse(value) as T } catch { return null }
}

// Only task/expression sections change. Historical facts and manual restrictions stay byte-for-byte.
function replaceSection(prompt: string, title: RegExp, body: string): string | null {
  const sections = [...prompt.matchAll(/^##\s+[^\r\n]+/gm)]
  const index = sections.findIndex((match) => title.test(match[0]))
  if (index < 0) return null
  const start = sections[index].index! + sections[index][0].length
  const end = sections[index + 1]?.index ?? prompt.length
  return `${prompt.slice(0, start)}\n${body}\n\n${prompt.slice(end)}`.trimEnd()
}

const CONTEXT_TRACE_KEYS = [
  'selectedChapterIds', 'selectedStageSummaryIds', 'selectedCharacterIds', 'selectedForeshadowingIds', 'selectedTimelineEventIds',
  'foreshadowingTreatmentModes', 'foreshadowingTreatmentOverrides', 'omittedContextItems', 'forcedContextBlocks', 'compressionRecords',
  'continuityBridgeId', 'continuitySource', 'continuityWarnings', 'contextNeedPlanId', 'requiredCharacterCardFields', 'requiredStateFactCategories',
  'contextNeedPlanWarnings', 'contextNeedPlanMatchedItems', 'contextNeedPlanOmittedItems', 'includedCharacterStateFactIds',
  'hardCanonPackItemCount', 'hardCanonPackTokenEstimate', 'includedHardCanonItemIds', 'truncatedHardCanonItemIds',
  'storyDirectionGuideId', 'storyDirectionGuideSource', 'storyDirectionGuideHorizon', 'storyDirectionGuideStartChapterOrder',
  'storyDirectionGuideEndChapterOrder', 'storyDirectionBeatId', 'storyDirectionAppliedToChapterTask'
] as const satisfies readonly (keyof GenerationRunTrace)[]

export async function prepareTaskContext(data: AppData, input: PrepareChapterTaskEditInput, job: ChapterGenerationJob, source: ChapterGenerationJob | null) {
  const impact = job.taskEdit!
  const task = job.chapterTaskSnapshot!
  const options = { targetChapterOrder: job.targetChapterOrder, pipelineMode: job.pipelineMode ?? input.pipelineMode, estimatedWordCount: task.targetWordCount, readerEmotionTarget: task.readerEmotion, budgetMode: input.budgetMode, budgetMaxTokens: input.budgetMaxTokens }
  const steps: ChapterGenerationStep[] = PIPELINE_STEP_ORDER.map((type) => ({ id: `${job.id}:${type}`, jobId: job.id, type, status: 'pending', inputSnapshot: JSON.stringify(options), output: '', errorMessage: '', createdAt: input.createdAt, updatedAt: input.createdAt }))
  let working = { ...data, chapterGenerationJobs: [job, ...data.chapterGenerationJobs], chapterGenerationSteps: [...data.chapterGenerationSteps, ...steps] }
  const oldSteps = source ? data.chapterGenerationSteps.filter((step) => step.jobId === source.id && step.status === 'completed') : []
  const output = (type: ChapterGenerationStep['type']) => [...oldSteps].filter((step) => step.type === type).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.output
  const oldContext = parsed<{ finalPrompt: string }>(output('rebuild_context_with_plan'))
  const oldPlan = parsed<ChapterPlan>(output('generate_chapter_plan'))
  const budget = parsed<{ profile: ContextBudgetProfile; selection: ContextSelectionResult }>(output('context_budget_selection_delta'))
  const oldTrace = source ? [...data.generationRunTraces].filter((trace) => trace.jobId === source.id && trace.projectId === job.projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] : null
  const completeUpstream = PIPELINE_STEP_ORDER.slice(0, PIPELINE_STEP_ORDER.indexOf('generate_chapter_draft')).every((type) => Boolean(output(type)))
  const legacyOpeningContext = job.targetChapterOrder === 1 && !source?.chapterTaskSnapshot
  if (legacyOpeningContext) impact.warnings.push('旧首章运行没有独立任务快照，已重新准备首章上下文，避免沿用后期状态。')
  const reuse = !legacyOpeningContext && impact.scope !== 'context' && source?.contextSource === 'auto' && completeUpstream
    && typeof oldContext?.finalPrompt === 'string' && typeof oldPlan?.chapterGoal === 'string'
    && budget?.selection && budget.profile?.projectId === job.projectId && budget.profile.mode === input.budgetMode && oldTrace
  if (reuse) {
    const labels = ['本章目标', '本章必须推进的冲突', '本章必须保留的悬念', '本章允许回收的伏笔', '本章禁止回收的伏笔', '本章结尾钩子', '本章读者应该产生的情绪', '本章预计字数', '文风要求']
    const values = [task.goal, task.conflict, task.suspenseToKeep, task.allowedPayoffs, task.forbiddenPayoffs, task.endingHook, task.readerEmotion, task.targetWordCount, task.styleRequirement]
    let prompt = replaceSection(oldContext.finalPrompt, /本章任务契约/, labels.map((label, index) => fieldLine(`${label}：`, values[index])).filter(Boolean).join('\n'))
    if (prompt && impact.changedFields.includes('styleRequirement')) {
      prompt = replaceSection(prompt, /风格要求|StyleEnvelope/, [fieldLine('文风要求：', task.styleRequirement), '风格只作为表达滤镜，不得覆盖上一章衔接、本章任务、角色硬状态和伏笔规则。'].filter(Boolean).join('\n'))
    }
    if (prompt && TokenEstimator.estimate(prompt) <= input.budgetMaxTokens) {
      const lint = PromptLintService.guardWritingPrompt(prompt)
      const tokenEstimate = TokenEstimator.estimate(lint.guardedPrompt)
      const blockOrder: PromptBlockOrderItem[] = inferPromptBlockOrderFromPrompt(lint.guardedPrompt, 'task_edit').map((block) => {
        const previous = oldTrace.promptBlockOrder.find((item) => item.kind === block.kind)
        const changed = block.kind === 'chapter_task' || (block.kind === 'style' && impact.changedFields.includes('styleRequirement'))
        return { ...previous, ...block, source: changed ? 'chapter_task_edit' : previous?.source ?? block.source, sourceIds: changed ? [job.id] : previous?.sourceIds, forced: previous?.forced, compressed: previous?.compressed, reason: changed ? '作者修改任务后局部重组。' : `沿用原运行上下文。${previous?.reason ?? ''}` }
      })
      const patchedPlan = { ...oldPlan, estimatedWordCount: task.targetWordCount, readerEmotionTarget: task.readerEmotion }
      impact.resumeStep = 'generate_chapter_draft'
      impact.reusableArtifacts = ['原章节计划', '原上下文选择与硬事实', '原草稿和历史报告']
      impact.warnings.push('沿用原运行的事实切片；期间新增资料不会自动并入。需要更新剧情资料时，请另建最新上下文。')
      if (impact.scope === 'budget') impact.warnings.push('篇幅已更新；原节拍保持不变，正文仍使用原运行模型和输出上限。')
      const nextProfile = { ...budget.profile, id: `${job.id}:budget`, maxTokens: input.budgetMaxTokens, createdAt: input.createdAt, updatedAt: input.createdAt }
      const baseSelectionTrace = oldTrace.contextSelectionTrace ?? budget.selection.contextSelectionTrace
      const dropped = baseSelectionTrace?.droppedBlocks.length ?? 0
      const contextSelectionTrace = baseSelectionTrace ? { ...structuredClone(baseSelectionTrace), jobId: job.id, budgetSummary: {
        totalBudget: input.budgetMaxTokens, usedTokens: tokenEstimate, reservedTokens: Math.max(0, input.budgetMaxTokens - tokenEstimate),
        pressure: tokenEstimate >= input.budgetMaxTokens * 0.9 || dropped >= 12 ? 'high' as const : tokenEstimate >= input.budgetMaxTokens * 0.7 || dropped >= 4 ? 'medium' as const : 'low' as const
      } } : null
      const nextSelection = { ...structuredClone(budget.selection), estimatedTokens: tokenEstimate, contextSelectionTrace }
      working.chapterGenerationSteps = working.chapterGenerationSteps.map((step) => {
        if (step.jobId !== job.id || PIPELINE_STEP_ORDER.indexOf(step.type) >= PIPELINE_STEP_ORDER.indexOf('generate_chapter_draft')) return step
        let value = output(step.type)
        if (step.type === 'generate_chapter_plan') value = JSON.stringify(patchedPlan)
        if (step.type === 'context_budget_selection' || step.type === 'context_budget_selection_delta') value = JSON.stringify({ ...parsed<object>(value), profile: nextProfile, selection: nextSelection, explanation: '沿用原上下文选择，重新计算作者任务的预算。' })
        if (step.type === 'build_context') value = lint.guardedPrompt
        if (step.type === 'rebuild_context_with_plan') value = JSON.stringify({ ...oldContext, finalPrompt: lint.guardedPrompt, promptBlockOrder: blockOrder, warnings: impact.warnings })
        return { ...step, status: value ? 'completed' : 'pending', output: value ?? '' }
      })
      const contextFields = structuredClone(Object.fromEntries(CONTEXT_TRACE_KEYS.map((key) => [key, oldTrace[key]]))) as Partial<GenerationRunTrace>
      const trace: GenerationRunTrace = { ...createEmptyGenerationRunTrace(job), ...contextFields, promptBlockOrder: blockOrder, finalPromptTokenEstimate: tokenEstimate, contextTokenEstimate: Math.max(0, tokenEstimate - estimateForcedContextTokens(oldTrace.forcedContextBlocks)), contextSelectionTrace, contextWarnings: [...oldTrace.contextWarnings, ...impact.warnings], promptLintWarnings: lint.result.warnings, promptLintIssueCount: lint.result.issueCount, promptCompositionMetrics: PromptCompositionMetricsService.calculate(lint.guardedPrompt, blockOrder, tokenEstimate) }
      working.generationRunTraces = [trace, ...working.generationRunTraces]
      working.contextBudgetProfiles = [nextProfile, ...working.contextBudgetProfiles]
      job.currentStep = impact.resumeStep
      return { data: working, job, impact }
    }
    impact.warnings.push('更新后超预算或旧 Prompt 缺少可定位字段，已重新准备上下文；原运行保留。')
  }
  if (impact.scope !== 'context') impact.warnings.push('原运行的计划后上下文不完整或预算模式已变化，将重新准备本章上下文。')
  impact.scope = 'context'
  impact.resumeStep = 'generate_chapter_plan'
  impact.reusableArtifacts = ['原草稿与历史报告（不复制为本次报告）']
  const project = data.projects.find((item) => item.id === job.projectId)!
  const state: PipelineStepHandlerContext['state'] = { working, context: '', plan: null, draftResult: null, noveltyAuditResult: null, planGapAnalysis: null, contextNeedPlanFromPlan: null, rebuiltContextFromPlan: false, draftRecord: null, contextNeedPlan: null, budgetProfile: createContextBudgetProfile(project.id, options.budgetMode, options.budgetMaxTokens), budgetSelection: null, recipeSkipReasons: [] }
  const ctx: PipelineStepHandlerContext = {
    job, step: steps[0], options, snapshot: null, activeStoryDirectionGuide: null, storyDirectionTracePatch: {}, state,
    env: { data, project, scoped: projectData(data, project.id), ...options, aiSettings: data.settings, runId: job.id,
      getAiService: async () => { throw new Error('保存章节任务不能调用模型。') }, getAiSettings: () => data.settings,
      persistWorking: async (next) => next,
      updateStepInData: (current, stepId, patch) => ({ ...current, chapterGenerationSteps: current.chapterGenerationSteps.map((step) => step.id === stepId ? { ...step, ...patch, updatedAt: input.createdAt } : step) }) }
  }
  for (const [index, run] of [runContextNeedPlanningStep, runContextBudgetSelectionStep, runBuildContextStep].entries()) { ctx.step = steps[index]; run(ctx) }
  if (impact.sourcePromptContextSnapshotId) impact.warnings.push('已明确另建自动上下文，原手动快照与原运行保持不变。')
  job.currentStep = impact.resumeStep
  return { data: state.working, job, impact }
}
