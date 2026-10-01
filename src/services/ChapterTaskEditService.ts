import type { AppData, ChapterGenerationJob, ChapterGenerationStep, ChapterPlan, ChapterTask, ChapterTaskEdit, ContextBudgetMode, ID, PipelineMode } from '../shared/types'
import { normalizeChapterTask } from '../shared/normalizers/generation'
import { PipelineRecipeService } from './PipelineRecipeService'
import { createPipelineAIRunConfig } from './PipelineRunContextService'
import { StoryDirectionService } from './StoryDirectionService'

export const CHAPTER_TASK_FIELDS = ['goal', 'conflict', 'suspenseToKeep', 'allowedPayoffs', 'forbiddenPayoffs', 'endingHook', 'readerEmotion', 'targetWordCount', 'styleRequirement'] as const
export const TASK_SCOPE_LABELS = { expression: '仅更新表达要求', budget: '更新篇幅与预算', context: '重新准备相关上下文' } as const

function readOutput<T>(steps: ChapterGenerationStep[], type: ChapterGenerationStep['type']): T | null {
  const raw = [...steps].filter((step) => step.type === type && step.status === 'completed').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.output
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

export function getChapterTaskForJob(data: AppData, projectId: ID, job: ChapterGenerationJob | null, target: number, wordCount = '2000-3000', emotion = ''): ChapterTask {
  const project = data.projects.find((item) => item.id === projectId)
  if (!project || (job && job.projectId !== projectId)) throw new Error('章节任务不属于当前项目。')
  if (job?.chapterTaskSnapshot) return normalizeChapterTask(job.chapterTaskSnapshot)
  const snapshot = job?.contextSource === 'prompt_snapshot' ? data.promptContextSnapshots.find((item) => item.id === job.promptContextSnapshotId && item.projectId === projectId) : null
  if (snapshot) return normalizeChapterTask(snapshot.chapterTask)
  const guide = StoryDirectionService.getActiveGuideForChapter(data.storyDirectionGuides, projectId, target)
  const direction = StoryDirectionService.deriveChapterTaskPatch(guide, target)
  const plan = job ? readOutput<ChapterPlan>(data.chapterGenerationSteps.filter((step) => step.jobId === job.id), 'generate_chapter_plan') : null
  return normalizeChapterTask({
    ...direction,
    goal: plan?.chapterGoal ?? direction.goal ?? `生成第 ${target} 章草稿`,
    conflict: plan?.conflictToPush ?? direction.conflict ?? '',
    allowedPayoffs: plan?.foreshadowingToUse ?? direction.allowedPayoffs ?? '',
    forbiddenPayoffs: plan?.foreshadowingNotToReveal ?? direction.forbiddenPayoffs ?? '',
    endingHook: plan?.endingHook ?? direction.endingHook ?? '',
    readerEmotion: plan?.readerEmotionTarget ?? direction.readerEmotion ?? emotion,
    targetWordCount: plan?.estimatedWordCount ?? wordCount,
    styleRequirement: project.style
  })
}

export function analyzeChapterTaskEdit(before: ChapterTask, after: ChapterTask): ChapterTaskEdit {
  const changedFields = CHAPTER_TASK_FIELDS.filter((field) => before[field] !== after[field])
  const scope = changedFields.some((field) => field !== 'styleRequirement' && field !== 'targetWordCount') ? 'context' : changedFields.includes('targetWordCount') ? 'budget' : 'expression'
  return { sourceJobId: null, changedFields, scope, resumeStep: 'generate_chapter_plan', reusableArtifacts: ['原草稿和历史报告'], warnings: [] }
}

export interface PrepareChapterTaskEditInput {
  projectId: ID
  sourceJobId?: ID | null
  sourceUpdatedAt?: string
  sourceSnapshotId?: ID | null
  targetChapterOrder: number
  task: ChapterTask
  jobId: ID
  createdAt: string
  budgetMode: ContextBudgetMode
  budgetMaxTokens: number
  pipelineMode: PipelineMode
  refreshContext?: boolean
}

/** Creates a new execution branch, never rewrites an old run or starts an AI call. */
export async function prepareChapterTaskEdit(data: AppData, input: PrepareChapterTaskEditInput): Promise<{ data: AppData; job: ChapterGenerationJob; impact: ChapterTaskEdit }> {
  const project = data.projects.find((item) => item.id === input.projectId)
  const source = input.sourceJobId ? data.chapterGenerationJobs.find((item) => item.id === input.sourceJobId && item.projectId === input.projectId) : null
  const snapshotId = source?.contextSource === 'prompt_snapshot' ? source.promptContextSnapshotId : input.sourceSnapshotId
  const snapshot = snapshotId ? data.promptContextSnapshots.find((item) => item.id === snapshotId && item.projectId === input.projectId) : null
  if (!project || (input.sourceJobId && !source)) throw new Error('找不到原章节任务，请重新打开当前项目。')
  if (!input.jobId.trim() || !Number.isSafeInteger(input.targetChapterOrder) || input.targetChapterOrder < 1) throw new Error('章节任务缺少有效编号。')
  if (!Number.isFinite(input.budgetMaxTokens) || input.budgetMaxTokens < 1000) throw new Error('上下文预算至少为 1000 token。')
  if (source?.targetChapterOrder !== undefined && source.targetChapterOrder !== input.targetChapterOrder) throw new Error('新任务章序与原运行不一致。')
  if (snapshotId && !snapshot) throw new Error('找不到原手动快照，请重新选择。')
  if ((source?.contextSource === 'prompt_snapshot' || snapshot) && !input.refreshContext) throw new Error('手动快照保持固定。请明确选择基于最新资料另建任务，原快照不会被修改。')
  if (!input.task || CHAPTER_TASK_FIELDS.some((field) => typeof input.task[field] !== 'string')) throw new Error('章节任务字段必须是文本。')
  const task = normalizeChapterTask(input.task)
  const existing = data.chapterGenerationJobs.find((item) => item.id === input.jobId)
  if (existing) {
    if (existing.projectId !== input.projectId || existing.targetChapterOrder !== input.targetChapterOrder || existing.taskEdit?.sourceJobId !== (source?.id ?? null) || (existing.taskEdit?.sourcePromptContextSnapshotId ?? null) !== (snapshotId ?? null) || CHAPTER_TASK_FIELDS.some((field) => existing.chapterTaskSnapshot?.[field] !== task[field])) throw new Error('任务操作编号已用于另一份内容。')
    return { data, job: existing, impact: existing.taskEdit! }
  }
  if (source?.status === 'running') throw new Error('请等待或取消当前生成后再保存新任务。')
  if (source && input.sourceUpdatedAt && source.updatedAt !== input.sourceUpdatedAt) throw new Error('原任务已变化，请重新查看后保存。')
  const before = snapshot ? normalizeChapterTask(snapshot.chapterTask) : getChapterTaskForJob(data, input.projectId, source ?? null, input.targetChapterOrder, task.targetWordCount, task.readerEmotion)
  const impact = analyzeChapterTaskEdit(before, task)
  impact.sourceJobId = source?.id ?? null
  impact.sourcePromptContextSnapshotId = snapshotId ?? null
  if (!source || input.refreshContext) impact.scope = 'context'
  const recipe = structuredClone(source?.pipelineRecipe ?? PipelineRecipeService.resolveRecipe(undefined, input.pipelineMode))
  const job: ChapterGenerationJob = {
    id: input.jobId, projectId: project.id, targetChapterOrder: input.targetChapterOrder,
    chapterTaskSnapshot: task, taskEdit: impact, contextSource: 'auto', promptContextSnapshotId: null,
    aiRunConfig: structuredClone(source?.aiRunConfig ?? createPipelineAIRunConfig(data.settings)),
    pipelineRecipe: recipe, pipelineRecipeId: recipe.id, pipelineRecipeVersion: recipe.version,
    pipelineMode: source?.pipelineMode ?? input.pipelineMode,
    status: 'idle', currentStep: 'generate_chapter_plan', createdAt: input.createdAt, updatedAt: input.createdAt, errorMessage: ''
  }
  const { prepareTaskContext } = await import('./chapterTaskEdit/prepareTaskContext')
  return prepareTaskContext(data, input, job, source ?? null)
}
