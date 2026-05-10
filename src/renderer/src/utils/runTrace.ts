import type {
  AppData,
  ChapterGenerationJob,
  Foreshadowing,
  ForeshadowingTreatmentMode,
  ForcedContextBlock,
  GenerationRunTrace,
  ID
} from '../../../shared/types'
import { normalizeTreatmentMode } from '../../../shared/foreshadowingTreatment'
import { newId, now } from './format'

export function uniqueIds(ids: ID[]): ID[] {
  return [...new Set(ids.filter(Boolean))]
}

export function buildForeshadowingTreatmentModes(
  foreshadowings: Foreshadowing[],
  selectedForeshadowingIds: ID[],
  overrides: Record<ID, ForeshadowingTreatmentMode> = {}
): Record<ID, ForeshadowingTreatmentMode> {
  const byId = new Map(foreshadowings.map((item) => [item.id, item]))
  return Object.fromEntries(
    uniqueIds(selectedForeshadowingIds).map((id) => {
      const item = byId.get(id)
      return [id, normalizeTreatmentMode(overrides[id] ?? item?.treatmentMode, item?.status, item?.weight)]
    })
  )
}

export function createEmptyGenerationRunTrace(job: ChapterGenerationJob): GenerationRunTrace {
  const timestamp = now()
  return {
    id: newId(),
    projectId: job.projectId,
    jobId: job.id,
    targetChapterOrder: job.targetChapterOrder,
    promptContextSnapshotId: job.promptContextSnapshotId ?? null,
    contextSource: job.contextSource,
    selectedChapterIds: [],
    selectedStageSummaryIds: [],
    selectedCharacterIds: [],
    selectedForeshadowingIds: [],
    selectedTimelineEventIds: [],
    foreshadowingTreatmentModes: {},
    foreshadowingTreatmentOverrides: {},
    omittedContextItems: [],
    contextWarnings: [],
    contextTokenEstimate: 0,
    forcedContextBlocks: [],
    compressionRecords: [],
    promptBlockOrder: [],
    finalPromptTokenEstimate: 0,
    generatedDraftId: null,
    consistencyReviewReportId: null,
    qualityGateReportId: null,
    revisionSessionIds: [],
    acceptedRevisionVersionId: null,
    acceptedMemoryCandidateIds: [],
    rejectedMemoryCandidateIds: [],
    continuityBridgeId: null,
    continuitySource: null,
    redundancyReportId: null,
    continuityWarnings: [],
    contextNeedPlanId: null,
    requiredCharacterCardFields: {},
    requiredStateFactCategories: {},
    contextNeedPlanWarnings: [],
    contextNeedPlanMatchedItems: [],
    contextNeedPlanOmittedItems: [],
    includedCharacterStateFactIds: [],
    characterStateWarnings: [],
    characterStateIssueIds: [],
    noveltyAuditResult: null,
    storyDirectionGuideId: null,
    storyDirectionGuideSource: null,
    storyDirectionGuideHorizon: null,
    storyDirectionGuideStartChapterOrder: null,
    storyDirectionGuideEndChapterOrder: null,
    storyDirectionBeatId: null,
    storyDirectionAppliedToChapterTask: false,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function upsertGenerationRunTrace(
  data: AppData,
  job: ChapterGenerationJob,
  patch: Partial<Omit<GenerationRunTrace, 'id' | 'projectId' | 'jobId' | 'createdAt' | 'updatedAt'>>
): AppData {
  const existing = data.generationRunTraces.find((trace) => trace.jobId === job.id)
  const base = existing ?? createEmptyGenerationRunTrace(job)
  const nextTrace: GenerationRunTrace = {
    ...base,
    ...patch,
    promptContextSnapshotId: patch.promptContextSnapshotId ?? base.promptContextSnapshotId,
    contextSource: patch.contextSource ?? base.contextSource,
    updatedAt: now()
  }
  return {
    ...data,
    generationRunTraces: existing
      ? data.generationRunTraces.map((trace) => (trace.id === existing.id ? nextTrace : trace))
      : [nextTrace, ...data.generationRunTraces]
  }
}

export function upsertGenerationRunTraceByJobId(
  data: AppData,
  jobId: ID,
  patch: Partial<Omit<GenerationRunTrace, 'id' | 'projectId' | 'jobId' | 'createdAt' | 'updatedAt'>>
): AppData {
  const job = data.chapterGenerationJobs.find((item) => item.id === jobId)
  return job ? upsertGenerationRunTrace(data, job, patch) : data
}

function forcedBlockKey(block: ForcedContextBlock): string {
  return [block.kind, block.sourceId ?? '', block.sourceType ?? '', block.sourceChapterId ?? '', block.title].join('|')
}

export function uniqueForcedContextBlocks(blocks: ForcedContextBlock[]): ForcedContextBlock[] {
  const seen = new Set<string>()
  return blocks.filter((block) => {
    const key = forcedBlockKey(block)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function estimateForcedContextTokens(blocks: ForcedContextBlock[]): number {
  return blocks.reduce((total, block) => total + Math.max(0, block.tokenEstimate || 0), 0)
}

export function appendGenerationRunTraceForcedContextBlocks(
  data: AppData,
  jobId: ID,
  blocks: ForcedContextBlock[]
): AppData {
  if (!blocks.length) return data
  const existing = data.generationRunTraces.find((trace) => trace.jobId === jobId)
  const merged = uniqueForcedContextBlocks([...(existing?.forcedContextBlocks ?? []), ...blocks])
  return upsertGenerationRunTraceByJobId(data, jobId, { forcedContextBlocks: merged })
}

export function appendGenerationRunTraceIds(
  data: AppData,
  jobId: ID,
  field: 'revisionSessionIds' | 'acceptedMemoryCandidateIds' | 'rejectedMemoryCandidateIds',
  ids: ID[]
): AppData {
  const existing = data.generationRunTraces.find((trace) => trace.jobId === jobId)
  const merged = uniqueIds([...(existing?.[field] ?? []), ...ids])
  return upsertGenerationRunTraceByJobId(data, jobId, {
    [field]: merged
  } as Partial<Omit<GenerationRunTrace, 'id' | 'projectId' | 'jobId' | 'createdAt' | 'updatedAt'>>)
}
