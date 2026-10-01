import type { GeneratedChapterDraft } from '../../../../shared/types'
import {
  buildEditorialVerdict,
  upsertEditorialVerdictToAppData,
  type EditorialCoverageExpectation
} from '../../../../services/EditorialVerdictService'
import { PipelineRecipeService } from '../../../../services/PipelineRecipeService'
import { upsertGenerationRunTrace } from '../../utils/runTrace'
import type { PipelineStepHandlerContext } from './pipelineRunnerTypes'

export function finalizeEditorialVerdict(
  ctx: PipelineStepHandlerContext,
  currentDraft: GeneratedChapterDraft
): void {
  const { state, job } = ctx
  const frozenRecipe = PipelineRecipeService.resolveRecipe(
    job.pipelineRecipe ?? job.pipelineRecipeId ?? job.pipelineMode,
    job.pipelineMode ?? ctx.options.pipelineMode
  )
  const consistencyStep = state.working.chapterGenerationSteps.find(
    (item) => item.jobId === job.id && item.type === 'consistency_review'
  )
  const consistencyDecision = PipelineRecipeService.resolveStepExecution(
    frozenRecipe,
    'consistency_review',
    'none',
    job.pipelineMode ?? ctx.options.pipelineMode
  )
  const coverageExpectation: EditorialCoverageExpectation = {
    recipeId: frozenRecipe.id,
    consistency: consistencyStep?.status === 'completed' || consistencyDecision.run
  }
  const verdict = buildEditorialVerdict({
    appData: state.working,
    draftId: currentDraft.id,
    coverageExpectation
  })
  state.working = upsertEditorialVerdictToAppData(state.working, verdict)
  state.working = upsertGenerationRunTrace(state.working, job, {
    editorialVerdictId: verdict.id,
    editorialVerdictDraftId: verdict.draftId,
    editorialVerdictDraftContentHash: verdict.draftContentHash
  })
}
