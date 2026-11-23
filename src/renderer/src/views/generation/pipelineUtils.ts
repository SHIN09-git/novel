import { draftBodyFormatError } from '../../../../services/ChapterDraftEnvelopeService'
import { TASK_TEXT_FIELDS } from '../../../../shared/chapterTaskConstraints'
import type {
  AppData,
  ChapterTask,
  ID,
  NoveltyAuditResult,
  Project,
  PromptContextSnapshot,
  StoryDirectionGuide
} from '../../../../shared/types'
import { collectNoveltyReviewFindings } from '../../../../shared/noveltyReview'
import { safeParseJson } from '../../../../services/AIJsonParser'
import { ChapterTaskContractService } from '../../../../services/ChapterTaskContractService'
import { TokenEstimator } from '../../../../services/TokenEstimator'
import { StoryDirectionService } from '../../../../services/StoryDirectionService'
import { PipelineRecipeService } from '../../../../services/PipelineRecipeService'
import { normalizePipelineOptions } from './pipelineRuntimeBasics'
export { PIPELINE_STEP_LABELS, PIPELINE_STEP_ORDER, canSkipPipelineStep } from './pipelineStepDefinitions'
export { normalizePipelineOptions, parseOutput, serializeOutput } from './pipelineRuntimeBasics'
export {
  characterStateFactsPresentInPrompt,
  enrichContextSelectionTrace,
  hardCanonTraceFromPrompt
} from './contextSelectionTraceRuntime'
export function pipelineContextFromStepOutput(output: string): string {
  if (PipelineRecipeService.isSkipOutput(output)) return ''
  const parsed = safeParseJson<{ finalPrompt?: string; context?: string; contextSource?: string }>(output, '流水线上下文输出')
  if (parsed.ok && typeof parsed.data.finalPrompt === 'string' && parsed.data.finalPrompt.trim()) return parsed.data.finalPrompt
  if (parsed.ok && typeof parsed.data.context === 'string' && parsed.data.context.trim()) return parsed.data.context
  return output
}

export function uniqueIds(ids: ID[]): ID[] {
  return [...new Set(ids.filter(Boolean))]
}

export function diffIds(next: ID[] = [], previous: ID[] = []): ID[] {
  const previousSet = new Set(previous)
  return uniqueIds(next.filter((id) => !previousSet.has(id)))
}

export function noveltyReferenceContext(data: AppData, projectId: ID): {
  knownCharacterNames: string[]
  knownForeshadowingTexts: string[]
  knownCanonTexts: string[]
} {
  return {
    knownCharacterNames: data.characters.filter((item) => item.projectId === projectId).map((item) => item.name).filter(Boolean),
    knownForeshadowingTexts: data.foreshadowings
      .filter((item) => item.projectId === projectId)
      .map((item) => [item.title, item.description, item.expectedPayoff].filter(Boolean).join(' ')),
    knownCanonTexts: data.hardCanonPacks
      .filter((pack) => pack.projectId === projectId)
      .flatMap((pack) => pack.items.filter((item) => item.status === 'active').map((item) => `${item.title} ${item.content}`))
  }
}

export function summarizeSnapshot(snapshot: PromptContextSnapshot) {
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

export function pipelineChapterTask(
  project: Project,
  options: ReturnType<typeof normalizePipelineOptions>,
  activeStoryDirectionGuide?: StoryDirectionGuide | null,
  chapterTaskSnapshot?: ChapterTask | null
): ChapterTask {
  if (chapterTaskSnapshot) return { ...chapterTaskSnapshot }
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

// Old manual snapshots supplied prompt text only. Opt in for snapshots with explicit task boundaries.
export function constrainedSnapshotTask(snapshot: PromptContextSnapshot | null) {
  const task = snapshot?.chapterTask
  return snapshot?.moduleSelection?.chapterTask !== false && task && (task.povPolicy || task.storyTimeWindow || task.mustOpenWithBeat) ? task : null
}

export function assertChapterTaskPresentInPrompt(
  prompt: string,
  chapterTask: ChapterTask,
  stage: 'plan' | 'draft'
): void {
  const missingFields: string[] = TASK_TEXT_FIELDS.filter((field) => {
    const value = chapterTask[field].trim()
    return value.length > 0 && !prompt.includes(value)
  })
  const { povPolicy: pov, storyTimeWindow: time, mustOpenWithBeat: beat } = chapterTask
  if (pov && ![pov.mode, pov.povCharacterId, ...pov.perceptionChannels].every(v => prompt.includes(v))) missingFields.push('povPolicy')
  if (time && ![time.date, time.weekday ?? '', time.range].every(v => prompt.includes(v))) missingFields.push('storyTimeWindow')
  if (beat && !prompt.includes(beat)) missingFields.push('mustOpenWithBeat')
  if (missingFields.length === 0) return
  throw new Error(
    `显式章节任务契约未完整进入${stage === 'plan' ? '计划生成前' : '正文生成前'} Prompt；缺失字段：${missingFields.join(', ')}。请重新开始该章节任务，避免静默丢失修订要求。`
  )
}

export function minimumDraftTokens(expectedWordCount: string): number {
  const numbers = [...expectedWordCount.matchAll(/\d+/g)].map((match) => Number(match[0])).filter((value) => Number.isFinite(value))
  const minimumWords = numbers.length > 0 ? Math.min(...numbers) : 2000
  return Math.max(900, Math.min(2400, Math.round(minimumWords * 0.4)))
}

export function validateGeneratedChapterDraft(body: string, expectedWordCount: string, strict: boolean): string | null {
  const trimmed = body.trim()
  const formatError = draftBodyFormatError(trimmed)
  if (formatError) return formatError
  if (strict) {
    const tokenEstimate = TokenEstimator.estimate(trimmed)
    const minTokens = minimumDraftTokens(expectedWordCount)
    if (tokenEstimate < minTokens) {
      return `正文过短（约 ${tokenEstimate} token），低于本章预计字数的最低可接受值（约 ${minTokens} token）。`
    }
  }
  return null
}

export function validateAuthoritativeChapterTaskDraft(
  body: string,
  title: string,
  expectedWordCount: string,
  strict: boolean,
  chapterTask?: ChapterTask | null,
  options: { allowReviewableLengthUnderflow?: boolean; allowReviewableLengthOverflow?: boolean } = {}
): string | null {
  if (!chapterTask) return validateGeneratedChapterDraft(body, expectedWordCount, strict)
  const evaluation = ChapterTaskContractService.evaluate({ body, title, chapterTask })
  const reviewableOverflow = options.allowReviewableLengthOverflow && ChapterTaskContractService.isOnlyLengthOverflow(evaluation)
  const basicError = validateGeneratedChapterDraft(body, expectedWordCount, strict && !reviewableOverflow)
  if (basicError || reviewableOverflow) return basicError
  if (options.allowReviewableLengthUnderflow && ChapterTaskContractService.isReviewableLengthUnderflow(evaluation)) return null
  return evaluation.retryReason
}

export function noveltyWarnings(audit: NoveltyAuditResult | null): string[] {
  if (!audit || audit.severity === 'pass') return []
  const reviewFindings = collectNoveltyReviewFindings(audit)
  return [
    `Novelty audit ${audit.severity}: ${audit.summary}`,
    ...reviewFindings.slice(0, 6).map((finding) => `${finding.kind}: ${finding.text} - ${finding.evidenceExcerpt}`)
  ]
}

export function noveltyAdjustedConfidence(audit: NoveltyAuditResult | null, base: number): number {
  if (!audit) return base
  if (audit.severity === 'fail') return Math.min(base, 0.35)
  if (audit.severity === 'warning') return Math.min(base, 0.55)
  return base
}
