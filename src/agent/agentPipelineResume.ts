import type { AppData, ChapterGenerationStepType, ID, PipelineMode } from '../shared/types'
import { PipelineRecipeService } from '../services/PipelineRecipeService'
import { AGENT_PIPELINE_STEP_ORDER } from './AgentRunService'

export function resolveAgentPipelineResumeStep(
  data: AppData,
  jobId: ID,
  requestedStep?: ChapterGenerationStepType,
  requestedMode?: PipelineMode
): ChapterGenerationStepType | null {
  const steps = data.chapterGenerationSteps.filter(step => step.jobId === jobId)
  if (requestedStep) return steps.some(step => step.type === requestedStep) ? requestedStep : null
  const job = data.chapterGenerationJobs.find(item => item.id === jobId)
  const mode = requestedMode ?? job?.pipelineMode ?? 'standard'
  const recipe = job && PipelineRecipeService.resolveRecipe(
    requestedMode ? undefined : job.pipelineRecipe ?? job.pipelineRecipeId ?? job.pipelineMode, mode
  )
  const executable = recipe && new Set(PipelineRecipeService.resolveExecutionPlan(recipe, mode).steps
    .filter(decision => decision.run).map(decision => decision.type))
  // A downstream failure cannot run ahead of an earlier invalidated prerequisite.
  return AGENT_PIPELINE_STEP_ORDER.find(type => executable?.has(type) !== false &&
    steps.some(step => step.type === type && step.status !== 'completed' && step.status !== 'skipped')) ?? null
}
