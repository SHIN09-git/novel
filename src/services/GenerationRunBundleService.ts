import type {
  AppData,
  ChapterGenerationStep,
  GenerationRunBundle,
  ID
} from '../shared/types'

export type GenerationRunBundleValidationContext = Pick<
  AppData,
  | 'generatedChapterDrafts'
  | 'consistencyReviewReports'
  | 'qualityGateReports'
  | 'editorialVerdicts'
>

const GENERATION_RUN_BUNDLE_SCHEMA_VERSION = 1
const MAX_EDITORIAL_VERDICT_JSON_LENGTH = 24_000
const FORBIDDEN_EDITORIAL_VERDICT_KEYS = new Set([
  'apikey',
  'apitoken',
  'accesstoken',
  'authorization',
  'password',
  'secret',
  'body',
  'draftbody',
  'drafttext',
  'content',
  'prompt',
  'fullprompt'
])

function uniqueById<T extends { id: ID }>(items: T[]): T[] {
  const seen = new Set<ID>()
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function upsertById<T extends { id: ID }>(current: T[], incoming: T[]): T[] {
  if (!incoming.length) return current
  const normalizedIncoming = uniqueById(incoming)
  const incomingById = new Map(normalizedIncoming.map((item) => [item.id, item]))
  const existingIds = new Set(current.map((item) => item.id))
  const replaced = current.map((item) => incomingById.get(item.id) ?? item)
  const missing = normalizedIncoming.filter((item) => !existingIds.has(item.id))
  return [...missing, ...replaced]
}

function assertSameJobId(collection: string, items: Array<{ id: ID; jobId?: ID | null }>, jobId: ID, errors: string[]) {
  for (const item of items) {
    if (!item.id) errors.push(`${collection} contains an item without id`)
    if (!item.jobId) errors.push(`${collection}:${item.id || '<missing-id>'} is missing jobId`)
    if (item.jobId && item.jobId !== jobId) errors.push(`${collection}:${item.id} belongs to job ${item.jobId}, expected ${jobId}`)
  }
}

function assertProjectId(collection: string, items: Array<{ id: ID; projectId?: ID | null }>, projectId: ID, errors: string[]) {
  for (const item of items) {
    if (!item.projectId) errors.push(`${collection}:${item.id || '<missing-id>'} is missing projectId`)
    if (item.projectId && item.projectId !== projectId) {
      errors.push(`${collection}:${item.id} belongs to project ${item.projectId}, expected ${projectId}`)
    }
  }
}

function assertChapterField(collection: string, items: Array<{ id: ID; chapterId?: ID | null }>, errors: string[]) {
  for (const item of items) {
    if (!Object.prototype.hasOwnProperty.call(item, 'chapterId')) {
      errors.push(`${collection}:${item.id || '<missing-id>'} is missing chapterId field`)
    }
  }
}

function assertReportShape(collection: string, items: Array<{ id: ID; jobId?: ID | null; chapterId?: ID | null }>, jobId: ID, errors: string[]) {
  assertSameJobId(collection, items, jobId, errors)
  assertChapterField(collection, items, errors)
}

function forbiddenEditorialVerdictKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const pending: object[] = [value]
  const visited = new Set<object>()
  while (pending.length) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const [key, nested] of Object.entries(current)) {
      const normalizedKey = key.replace(/[_-]/g, '').toLowerCase()
      if (FORBIDDEN_EDITORIAL_VERDICT_KEYS.has(normalizedKey)) return key
      if (nested && typeof nested === 'object') pending.push(nested)
    }
  }
  return null
}

function assertEditorialVerdictsSafe(items: Array<{ id: ID }>, errors: string[]) {
  for (const item of items) {
    const forbiddenKey = forbiddenEditorialVerdictKey(item)
    if (forbiddenKey) {
      errors.push(`editorialVerdicts:${item.id || '<missing-id>'} contains forbidden persistence field ${forbiddenKey}`)
      continue
    }
    try {
      if (JSON.stringify(item).length > MAX_EDITORIAL_VERDICT_JSON_LENGTH) {
        errors.push(`editorialVerdicts:${item.id || '<missing-id>'} is too large`)
      }
    } catch {
      errors.push(`editorialVerdicts:${item.id || '<missing-id>'} is not serializable`)
    }
  }
}

function stepOutputRecord(step: ChapterGenerationStep): Record<string, unknown> | null {
  if (!step.output.trim()) return null
  try {
    const parsed = JSON.parse(step.output) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function nestedId(value: unknown): ID | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = (value as Record<string, unknown>).id
  return typeof id === 'string' && id ? id : null
}

function generationRunContextIds(steps: ChapterGenerationStep[], runTraceContextNeedPlanId?: ID | null) {
  const contextNeedPlanIds = new Set<ID>()
  const contextBudgetProfileIds = new Set<ID>()
  if (runTraceContextNeedPlanId) contextNeedPlanIds.add(runTraceContextNeedPlanId)

  for (const step of steps) {
    const output = stepOutputRecord(step)
    if (!output) continue
    if (step.type === 'context_need_planning') {
      const id = typeof output.id === 'string' ? output.id : null
      if (id) contextNeedPlanIds.add(id)
    }
    if (step.type === 'context_need_planning_from_plan') {
      const id = nestedId(output.derivedContextNeedPlan)
      if (id) contextNeedPlanIds.add(id)
    }
    if (step.type === 'context_budget_selection' || step.type === 'context_budget_selection_delta') {
      const id = nestedId(output.profile)
      if (id) contextBudgetProfileIds.add(id)
    }
  }

  return { contextNeedPlanIds, contextBudgetProfileIds }
}

export function buildGenerationRunBundle(appData: AppData, jobId: ID): GenerationRunBundle {
  const job = appData.chapterGenerationJobs.find((item) => item.id === jobId)
  if (!job) throw new Error(`GenerationRunBundle cannot be built: job ${jobId} was not found`)
  const promptContextSnapshot = job.promptContextSnapshotId
    ? appData.promptContextSnapshots.find((snapshot) => snapshot.id === job.promptContextSnapshotId)
    : undefined
  const generatedDrafts = appData.generatedChapterDrafts.filter((draft) => draft.jobId === jobId)
  const qualityGateReports = appData.qualityGateReports.filter((report) => report.jobId === jobId)
  const consistencyReviewReports = appData.consistencyReviewReports.filter((report) => report.jobId === jobId)
  const memoryUpdateCandidates = appData.memoryUpdateCandidates.filter((candidate) => candidate.jobId === jobId)
  const characterStateChangeCandidates = appData.characterStateChangeCandidates.filter((candidate) => candidate.jobId === jobId)
  const redundancyReports = appData.redundancyReports.filter((report) =>
    report.jobId === jobId || generatedDrafts.some((draft) => draft.id === report.draftId)
  )
  const editorialVerdicts = (appData.editorialVerdicts ?? []).filter((verdict) => verdict.jobId === jobId)
  const runTrace = appData.generationRunTraces.find((trace) => trace.jobId === jobId)
  const steps = appData.chapterGenerationSteps.filter((step) => step.jobId === jobId)
  const { contextNeedPlanIds, contextBudgetProfileIds } = generationRunContextIds(steps, runTrace?.contextNeedPlanId)
  if (promptContextSnapshot?.contextNeedPlan?.id) contextNeedPlanIds.add(promptContextSnapshot.contextNeedPlan.id)

  return {
    schemaVersion: GENERATION_RUN_BUNDLE_SCHEMA_VERSION,
    jobId: job.id,
    projectId: job.projectId,
    chapterId:
      generatedDrafts.find((draft) => draft.chapterId)?.chapterId ??
      qualityGateReports.find((report) => report.chapterId)?.chapterId ??
      consistencyReviewReports.find((report) => report.chapterId)?.chapterId ??
      null,
    updatedAt: job.updatedAt,
    job,
    steps,
    promptContextSnapshot,
    contextNeedPlans: appData.contextNeedPlans.filter((plan) => contextNeedPlanIds.has(plan.id)),
    contextBudgetProfiles: appData.contextBudgetProfiles.filter((profile) => contextBudgetProfileIds.has(profile.id)),
    generatedDrafts,
    qualityGateReports,
    consistencyReviewReports,
    memoryUpdateCandidates,
    characterStateChangeCandidates,
    redundancyReports,
    editorialVerdicts,
    runTrace
  }
}

export function validateGenerationRunBundle(
  bundle: GenerationRunBundle,
  existingData?: GenerationRunBundleValidationContext
): void {
  const errors: string[] = []
  const jobId = bundle.job?.id
  const projectId = bundle.job?.projectId
  if (!jobId) errors.push('GenerationRunBundle.job.id is required')
  if (!projectId) errors.push('GenerationRunBundle.job.projectId is required')
  if (bundle.jobId && jobId && bundle.jobId !== jobId) errors.push(`GenerationRunBundle.jobId ${bundle.jobId} does not match job.id ${jobId}`)
  if (bundle.projectId && projectId && bundle.projectId !== projectId) {
    errors.push(`GenerationRunBundle.projectId ${bundle.projectId} does not match job.projectId ${projectId}`)
  }
  if (typeof bundle.schemaVersion !== 'number') errors.push('GenerationRunBundle.schemaVersion is required')
  if (!bundle.updatedAt) errors.push('GenerationRunBundle.updatedAt is required')
  if (!bundle.job?.targetChapterOrder) errors.push('GenerationRunBundle.job.targetChapterOrder is required')
  if (!jobId) throw new Error(errors.join('; '))

  assertSameJobId('chapterGenerationSteps', bundle.steps, jobId, errors)
  if (projectId) {
    assertProjectId('contextNeedPlans', bundle.contextNeedPlans ?? [], projectId, errors)
    assertProjectId('contextBudgetProfiles', bundle.contextBudgetProfiles ?? [], projectId, errors)
    assertProjectId('generatedChapterDrafts', bundle.generatedDrafts, projectId, errors)
    assertProjectId('qualityGateReports', bundle.qualityGateReports, projectId, errors)
    assertProjectId('consistencyReviewReports', bundle.consistencyReviewReports, projectId, errors)
    assertProjectId('memoryUpdateCandidates', bundle.memoryUpdateCandidates, projectId, errors)
    assertProjectId('characterStateChangeCandidates', bundle.characterStateChangeCandidates, projectId, errors)
    assertProjectId('redundancyReports', bundle.redundancyReports, projectId, errors)
    assertProjectId('editorialVerdicts', bundle.editorialVerdicts ?? [], projectId, errors)
    if (bundle.runTrace?.projectId && bundle.runTrace.projectId !== projectId) {
      errors.push(`generationRunTrace:${bundle.runTrace.id} belongs to project ${bundle.runTrace.projectId}, expected ${projectId}`)
    }
  }
  assertReportShape('generatedChapterDrafts', bundle.generatedDrafts, jobId, errors)
  assertReportShape('qualityGateReports', bundle.qualityGateReports, jobId, errors)
  assertReportShape('consistencyReviewReports', bundle.consistencyReviewReports, jobId, errors)
  assertSameJobId('memoryUpdateCandidates', bundle.memoryUpdateCandidates, jobId, errors)
  assertSameJobId('characterStateChangeCandidates', bundle.characterStateChangeCandidates, jobId, errors)
  assertSameJobId('redundancyReports', bundle.redundancyReports, jobId, errors)
  assertReportShape('editorialVerdicts', bundle.editorialVerdicts ?? [], jobId, errors)
  assertEditorialVerdictsSafe(bundle.editorialVerdicts ?? [], errors)
  assertChapterField('characterStateChangeCandidates', bundle.characterStateChangeCandidates, errors)
  assertChapterField('redundancyReports', bundle.redundancyReports, errors)
  if (bundle.runTrace) {
    if (!bundle.runTrace.id) errors.push('generationRunTrace is missing id')
    if (bundle.runTrace.jobId !== jobId) errors.push(`generationRunTrace:${bundle.runTrace.id} belongs to job ${bundle.runTrace.jobId}, expected ${jobId}`)
  }
  if (bundle.promptContextSnapshot && bundle.job.promptContextSnapshotId && bundle.promptContextSnapshot.id !== bundle.job.promptContextSnapshotId) {
    errors.push(`promptContextSnapshot:${bundle.promptContextSnapshot.id} does not match job snapshot ${bundle.job.promptContextSnapshotId}`)
  }

  const stepTypes = new Set<ChapterGenerationStep['type']>()
  for (const step of bundle.steps) {
    if (stepTypes.has(step.type)) errors.push(`chapterGenerationSteps contains duplicate step type ${step.type} for job ${jobId}`)
    stepTypes.add(step.type)
  }
  const draftIds = new Set([
    ...bundle.generatedDrafts.map((draft) => draft.id),
    ...(existingData?.generatedChapterDrafts.filter((draft) => draft.jobId === jobId).map((draft) => draft.id) ?? [])
  ])
  if (bundle.runTrace?.generatedDraftId && !draftIds.has(bundle.runTrace.generatedDraftId)) {
    errors.push(`generationRunTrace.generatedDraftId ${bundle.runTrace.generatedDraftId} is not present in generatedDrafts`)
  }
  const consistencyIds = new Set([
    ...bundle.consistencyReviewReports.map((report) => report.id),
    ...(existingData?.consistencyReviewReports.filter((report) => report.jobId === jobId).map((report) => report.id) ?? [])
  ])
  if (bundle.runTrace?.consistencyReviewReportId && !consistencyIds.has(bundle.runTrace.consistencyReviewReportId)) {
    errors.push(`generationRunTrace.consistencyReviewReportId ${bundle.runTrace.consistencyReviewReportId} is not present in consistencyReviewReports`)
  }
  const qualityIds = new Set([
    ...bundle.qualityGateReports.map((report) => report.id),
    ...(existingData?.qualityGateReports.filter((report) => report.jobId === jobId).map((report) => report.id) ?? [])
  ])
  if (bundle.runTrace?.qualityGateReportId && !qualityIds.has(bundle.runTrace.qualityGateReportId)) {
    errors.push(`generationRunTrace.qualityGateReportId ${bundle.runTrace.qualityGateReportId} is not present in qualityGateReports`)
  }
  const editorialVerdictIds = new Set([
    ...(bundle.editorialVerdicts ?? []).map((verdict) => verdict.id),
    ...((existingData?.editorialVerdicts ?? []).filter((verdict) => verdict.jobId === jobId).map((verdict) => verdict.id))
  ])
  if (bundle.runTrace?.editorialVerdictId && !editorialVerdictIds.has(bundle.runTrace.editorialVerdictId)) {
    errors.push(`generationRunTrace.editorialVerdictId ${bundle.runTrace.editorialVerdictId} is not present in editorialVerdicts`)
  }

  if (errors.length) throw new Error(`Invalid GenerationRunBundle: ${errors.join('; ')}`)
}

export function applyGenerationRunBundleToAppData(appData: AppData, bundle: GenerationRunBundle): AppData {
  validateGenerationRunBundle(bundle, appData)
  return {
    ...appData,
    chapterGenerationJobs: upsertById(appData.chapterGenerationJobs, [bundle.job]),
    chapterGenerationSteps: upsertById(appData.chapterGenerationSteps, bundle.steps),
    promptContextSnapshots: bundle.promptContextSnapshot ? upsertById(appData.promptContextSnapshots, [bundle.promptContextSnapshot]) : appData.promptContextSnapshots,
    contextNeedPlans: upsertById(appData.contextNeedPlans, bundle.contextNeedPlans ?? []),
    contextBudgetProfiles: upsertById(appData.contextBudgetProfiles, bundle.contextBudgetProfiles ?? []),
    generatedChapterDrafts: upsertById(appData.generatedChapterDrafts, bundle.generatedDrafts),
    qualityGateReports: upsertById(appData.qualityGateReports, bundle.qualityGateReports),
    consistencyReviewReports: upsertById(appData.consistencyReviewReports, bundle.consistencyReviewReports),
    memoryUpdateCandidates: upsertById(appData.memoryUpdateCandidates, bundle.memoryUpdateCandidates),
    characterStateChangeCandidates: upsertById(appData.characterStateChangeCandidates, bundle.characterStateChangeCandidates),
    redundancyReports: upsertById(appData.redundancyReports, bundle.redundancyReports),
    editorialVerdicts: upsertById([...(appData.editorialVerdicts ?? [])], bundle.editorialVerdicts ?? []),
    generationRunTraces: bundle.runTrace ? upsertById(appData.generationRunTraces, [bundle.runTrace]) : appData.generationRunTraces
  }
}

export function upsertGenerationRunRelatedItems<T extends { id: ID }>(current: T[], incoming: T[]): T[] {
  return upsertById(current, incoming)
}

export function appendMissingGenerationRunRelatedItems<T extends { id: ID }>(current: T[], incoming: T[]): T[] {
  const existingIds = new Set(current.map((item) => item.id))
  const missing = uniqueById(incoming).filter((item) => !existingIds.has(item.id))
  return missing.length ? [...missing, ...current] : current
}
