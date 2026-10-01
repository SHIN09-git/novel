import type { AiCallTelemetry, AiTokenUsage, ID } from '../shared/types/base'
import type { AppData } from '../shared/types/appData'
import type { ChapterGenerationJob, PipelineAIRole } from '../shared/types/generation'
import type { ChapterCommitBundle, GenerationRunTrace } from '../shared/types/trace'
import type { ChapterVersion, RevisionCommitBundle } from '../shared/types/revision'

export type AcceptedChapterCostStatus = 'complete' | 'partial' | 'unknown'

export interface AcceptedChapterFixedRate {
  currency: string
  inputPerMillionTokens: number
  outputPerMillionTokens: number
  cachedInputPerMillionTokens?: number
}

export interface AcceptedChapterCostInput {
  data: AppData
  projectId: ID
  chapterId: ID
  /**
   * Explicit alternate or failed runs to include. Jobs must belong to the same
   * project and target chapter; cross-chapter reuse is not a valid cost source.
   */
  relatedJobIds?: readonly ID[]
  fixedRate?: AcceptedChapterFixedRate
}

export interface AcceptedChapterMetricTotal {
  known: number
  unknownCallCount: number
}

export interface AcceptedChapterCostWarning {
  code:
    | 'NO_FORMAL_ACCEPTED_VERSION'
    | 'AMBIGUOUS_CURRENT_VERSION'
    | 'BROKEN_VERSION_CHAIN'
    | 'VERSION_CHAIN_CYCLE'
    | 'MISSING_JOB'
    | 'JOB_SCOPE_MISMATCH'
    | 'TRACE_SCOPE_MISMATCH'
    | 'REJECTED_RELATED_JOB'
    | 'UNATTRIBUTED_FAILED_JOB'
    | 'MISSING_JOB_TELEMETRY'
    | 'MISSING_REVISION_TELEMETRY'
    | 'MISSING_CALL_ID'
    | 'CALL_ID_CONFLICT'
    | 'CROSS_JOB_STEP'
    | 'INVALID_USAGE'
    | 'RETRY_USAGE_MAY_BE_INCOMPLETE'
  message: string
  relatedIds: ID[]
}

export interface AcceptedChapterCostCall {
  callId: ID
  jobId: ID
  traceId: ID | null
  sourceIds: ID[]
  role: PipelineAIRole
  stepType: string
  provider: AiCallTelemetry['provider']
  model: string
  outcome: 'success' | 'failed' | 'unknown'
  durationMs: number | null
  attempts: number
  retryCount: number
  responseFormatFallback: boolean
  terminationCategory: AiCallTelemetry['terminationCategory']
  usageStatus: AcceptedChapterCostStatus
  usage: AiTokenUsage
  conflicted: boolean
  monetaryCost: number | null
}

export interface AcceptedChapterPhaseSummary {
  role: PipelineAIRole
  callCount: number
  failedCallCount: number
  retryCount: number
  durationMs: AcceptedChapterMetricTotal
  promptTokens: AcceptedChapterMetricTotal
  completionTokens: AcceptedChapterMetricTotal
  totalTokens: AcceptedChapterMetricTotal
}

export interface AcceptedChapterMonetaryCost {
  currency: string
  status: AcceptedChapterCostStatus
  knownAmount: number
  unknownCallCount: number
}

export interface AcceptedChapterCostResult {
  projectId: ID
  chapterId: ID
  chapterOrder: number
  status: AcceptedChapterCostStatus
  currentVersionId: ID | null
  chapterCommitIds: ID[]
  revisionCommitIds: ID[]
  includedJobIds: ID[]
  includedTraceIds: ID[]
  callCount: number
  observedTelemetryRecordCount: number
  unidentifiedTelemetryRecordCount: number
  successfulCallCount: number
  failedCallCount: number
  unknownOutcomeCallCount: number
  attemptCount: number
  retryCount: number
  responseFormatFallbackCount: number
  durationMs: AcceptedChapterMetricTotal
  promptTokens: AcceptedChapterMetricTotal
  completionTokens: AcceptedChapterMetricTotal
  totalTokens: AcceptedChapterMetricTotal
  reasoningTokens: AcceptedChapterMetricTotal
  cachedPromptTokens: AcceptedChapterMetricTotal
  monetaryCost: AcceptedChapterMonetaryCost | null
  phases: AcceptedChapterPhaseSummary[]
  calls: AcceptedChapterCostCall[]
  warnings: AcceptedChapterCostWarning[]
}

interface TelemetryObservation {
  callId: string
  jobId: string
  traceId: string | null
  sourceId: string
  sourceKind: 'stored_trace' | 'commit_trace' | 'quality_report'
  role: PipelineAIRole
  stepType: string
  outcome: AcceptedChapterCostCall['outcome']
  telemetry: AiCallTelemetry
}

interface ResolvedUsage {
  status: AcceptedChapterCostStatus
  usage: AiTokenUsage
  hasAny: boolean
  priceable: boolean
}

const ROLES: PipelineAIRole[] = ['planner', 'prose', 'extraction', 'reviewer', 'revision']

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function compareTime(a: { createdAt?: string }, b: { createdAt?: string }): number {
  return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function validateFixedRate(rate: AcceptedChapterFixedRate | undefined): void {
  if (!rate) return
  if (!rate.currency.trim()) throw new Error('Accepted chapter cost currency is required.')
  for (const [field, value] of Object.entries(rate)) {
    if (field === 'currency' || value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`Accepted chapter fixed rate ${field} must be a non-negative finite number.`)
    }
  }
}

function usageSignature(usage: AiTokenUsage | undefined): string {
  if (!usage) return ''
  return JSON.stringify({
    promptTokens: finiteNonNegative(usage.promptTokens),
    completionTokens: finiteNonNegative(usage.completionTokens),
    totalTokens: finiteNonNegative(usage.totalTokens),
    reasoningTokens: finiteNonNegative(usage.reasoningTokens),
    cachedPromptTokens: finiteNonNegative(usage.cachedPromptTokens)
  })
}

function telemetrySignature(observation: TelemetryObservation): string {
  const telemetry = observation.telemetry
  return JSON.stringify({
    jobId: observation.jobId,
    provider: telemetry.provider,
    model: telemetry.model,
    durationMs: finiteNonNegative(telemetry.durationMs),
    attempts: finiteNonNegative(telemetry.attempts),
    responseFormatFallback: telemetry.responseFormatFallback,
    finishReason: telemetry.finishReason ?? '',
    terminationCategory: telemetry.terminationCategory,
    usage: usageSignature(telemetry.usage)
  })
}

function resolveUsage(
  telemetry: AiCallTelemetry,
  callId: string,
  warnings: AcceptedChapterCostWarning[]
): ResolvedUsage {
  const raw = telemetry.usage
  const invalidFields = raw
    ? Object.entries(raw).filter(([, value]) => value !== undefined && finiteNonNegative(value) === undefined).map(([field]) => field)
    : []
  if (invalidFields.length) {
    warnings.push({
      code: 'INVALID_USAGE',
      message: `调用 ${callId} 的 ${invalidFields.join(', ')} 不是有效的非负数，未计入该字段。`,
      relatedIds: [callId]
    })
  }
  let promptTokens = finiteNonNegative(raw?.promptTokens)
  let completionTokens = finiteNonNegative(raw?.completionTokens)
  let totalTokens = finiteNonNegative(raw?.totalTokens)
  const reasoningTokens = finiteNonNegative(raw?.reasoningTokens)
  let cachedPromptTokens = finiteNonNegative(raw?.cachedPromptTokens)
  if (promptTokens === undefined && totalTokens !== undefined && completionTokens !== undefined && totalTokens >= completionTokens) {
    promptTokens = totalTokens - completionTokens
  }
  if (completionTokens === undefined && totalTokens !== undefined && promptTokens !== undefined && totalTokens >= promptTokens) {
    completionTokens = totalTokens - promptTokens
  }
  if (totalTokens === undefined && promptTokens !== undefined && completionTokens !== undefined) {
    totalTokens = promptTokens + completionTokens
  }
  if (promptTokens !== undefined && completionTokens !== undefined && totalTokens !== undefined && totalTokens !== promptTokens + completionTokens) {
    warnings.push({
      code: 'INVALID_USAGE',
      message: `调用 ${callId} 的 totalTokens 与输入、输出 token 之和不一致；保留可独立核实的字段。`,
      relatedIds: [callId]
    })
    totalTokens = undefined
  }
  if (cachedPromptTokens !== undefined && promptTokens !== undefined && cachedPromptTokens > promptTokens) {
    warnings.push({
      code: 'INVALID_USAGE',
      message: `调用 ${callId} 的 cachedPromptTokens 大于 promptTokens，缓存字段未计入。`,
      relatedIds: [callId]
    })
    cachedPromptTokens = undefined
  }
  const usage = { promptTokens, completionTokens, totalTokens, reasoningTokens, cachedPromptTokens }
  const hasAny = Object.values(usage).some((value) => value !== undefined)
  const priceable = promptTokens !== undefined && completionTokens !== undefined
  return { status: priceable ? 'complete' : hasAny ? 'partial' : 'unknown', usage, hasAny, priceable }
}

function monetaryCost(usage: AiTokenUsage, rate: AcceptedChapterFixedRate | undefined): number | null {
  if (!rate || usage.promptTokens === undefined || usage.completionTokens === undefined) return null
  const cached = rate.cachedInputPerMillionTokens === undefined ? 0 : Math.min(usage.promptTokens, usage.cachedPromptTokens ?? 0)
  const ordinaryInput = usage.promptTokens - cached
  const amount = (
    ordinaryInput * rate.inputPerMillionTokens +
    cached * (rate.cachedInputPerMillionTokens ?? rate.inputPerMillionTokens) +
    usage.completionTokens * rate.outputPerMillionTokens
  ) / 1_000_000
  return Number(amount.toFixed(12))
}

function metric(calls: AcceptedChapterCostCall[], field: keyof AiTokenUsage): AcceptedChapterMetricTotal {
  let known = 0
  let unknownCallCount = 0
  for (const call of calls) {
    const value = call.conflicted ? undefined : finiteNonNegative(call.usage[field])
    if (value === undefined) unknownCallCount++
    else known += value
  }
  return { known, unknownCallCount }
}

function durationMetric(calls: AcceptedChapterCostCall[]): AcceptedChapterMetricTotal {
  return {
    known: calls.reduce((total, call) => total + (call.durationMs ?? 0), 0),
    unknownCallCount: calls.filter((call) => call.durationMs === null).length
  }
}

function collectLineage(
  data: AppData,
  projectId: string,
  chapterId: string,
  warnings: AcceptedChapterCostWarning[]
): {
  currentVersionId: string | null
  chapterCommits: ChapterCommitBundle[]
  revisionCommits: RevisionCommitBundle[]
  traceIds: string[]
} {
  const chapter = data.chapters.find((item) => item.id === chapterId && item.projectId === projectId)!
  const chapterCommitVersions: ChapterVersion[] = data.chapterCommitBundles.flatMap((item) => {
    if (item.projectId !== projectId || item.chapterId !== chapterId) return []
    return [item.chapterVersion ?? {
      id: `chapter-commit:${item.commitId}`,
      projectId,
      chapterId,
      source: 'generated_draft',
      title: item.chapter.title,
      body: item.chapter.body,
      note: item.commitNote ?? '',
      createdAt: item.acceptedAt,
      linkedChapterCommitId: item.commitId,
      linkedGenerationRunTraceId: item.generationRunTraceId ?? null
    }]
  })
  const revisionCommitVersions: ChapterVersion[] = data.revisionCommitBundles.flatMap((item) => {
    if (item.projectId !== projectId || item.chapterId !== chapterId) return []
    return [item.chapterVersion ?? {
      id: item.newChapterVersionId,
      projectId,
      chapterId,
      source: item.revisedBy === 'user' ? 'manual_revision' : 'user_with_ai_revision',
      title: item.chapter.title,
      body: item.afterText,
      note: item.revisionNote ?? '',
      createdAt: item.revisedAt,
      linkedRevisionCommitId: item.revisionCommitId,
      linkedGenerationRunTraceId: item.linkedGenerationRunTraceId ?? null,
      linkedChapterCommitId: item.linkedChapterCommitId ?? null,
      baseChapterVersionId: item.baseChapterVersionId ?? null
    }]
  })
  const versions = [
    ...data.chapterVersions.filter((item) => item.projectId === projectId && item.chapterId === chapterId),
    ...chapterCommitVersions,
    ...revisionCommitVersions
  ]
  const versionById = new Map<string, (typeof versions)[number]>()
  for (const version of versions) if (!versionById.has(version.id)) versionById.set(version.id, version)
  const currentMatches = [...versionById.values()]
    .filter((version) => version.title === chapter.title && version.body === chapter.body)
    .sort(compareTime)
  if (currentMatches.length > 1) {
    warnings.push({
      code: 'AMBIGUOUS_CURRENT_VERSION',
      message: `当前正文匹配 ${currentMatches.length} 个正式版本，按最新 createdAt 使用 ${currentMatches[0].id}。`,
      relatedIds: currentMatches.map((item) => item.id)
    })
  }
  const current = currentMatches[0] ?? null
  if (!current) {
    warnings.push({
      code: 'NO_FORMAL_ACCEPTED_VERSION',
      message: '当前正文没有匹配的正式版本记录，无法把 AI 调用严格归属到最终采纳链。',
      relatedIds: [chapterId]
    })
    return { currentVersionId: null, chapterCommits: [], revisionCommits: [], traceIds: [] }
  }

  const chapterCommits: ChapterCommitBundle[] = []
  const revisionCommits: RevisionCommitBundle[] = []
  const traceIds: string[] = []
  const seen = new Set<string>()
  let cursor: (typeof versions)[number] | undefined = current
  while (cursor) {
    if (seen.has(cursor.id)) {
      warnings.push({ code: 'VERSION_CHAIN_CYCLE', message: `版本链在 ${cursor.id} 形成循环，已停止追溯。`, relatedIds: [cursor.id] })
      break
    }
    seen.add(cursor.id)
    if (cursor.linkedGenerationRunTraceId) traceIds.push(cursor.linkedGenerationRunTraceId)
    const revision = data.revisionCommitBundles.find((item) =>
      item.projectId === projectId && item.chapterId === chapterId &&
      (item.newChapterVersionId === cursor!.id || item.revisionCommitId === cursor!.linkedRevisionCommitId || item.id === cursor!.linkedRevisionCommitId)
    )
    if (revision && !revisionCommits.includes(revision)) revisionCommits.push(revision)
    const chapterCommit = data.chapterCommitBundles.find((item) =>
      item.projectId === projectId && item.chapterId === chapterId &&
      (item.commitId === cursor!.linkedChapterCommitId || item.id === cursor!.linkedChapterCommitId || item.chapterVersion?.id === cursor!.id)
    )
    if (chapterCommit && !chapterCommits.includes(chapterCommit)) chapterCommits.push(chapterCommit)
    if (revision?.linkedChapterCommitId) {
      const linked = data.chapterCommitBundles.find((item) =>
        item.projectId === projectId && item.chapterId === chapterId &&
        (item.commitId === revision.linkedChapterCommitId || item.id === revision.linkedChapterCommitId)
      )
      if (linked && !chapterCommits.includes(linked)) chapterCommits.push(linked)
    }
    if (revision?.linkedGenerationRunTraceId) traceIds.push(revision.linkedGenerationRunTraceId)
    if (chapterCommit?.generationRunTraceId) traceIds.push(chapterCommit.generationRunTraceId)
    const baseId = cursor.baseChapterVersionId ?? revision?.baseChapterVersionId ?? null
    if (!baseId) break
    cursor = versionById.get(baseId)
    if (!cursor) {
      warnings.push({
        code: 'BROKEN_VERSION_CHAIN',
        message: `当前采纳链缺少基础版本 ${baseId}。`,
        relatedIds: [current.id, baseId]
      })
    }
  }
  return { currentVersionId: current.id, chapterCommits, revisionCommits, traceIds: unique(traceIds) }
}

function addJobWithSources(
  data: AppData,
  job: ChapterGenerationJob,
  targetChapterOrder: number,
  includedJobs: Map<string, ChapterGenerationJob>,
  warnings: AcceptedChapterCostWarning[]
): void {
  let cursor: ChapterGenerationJob | undefined = job
  const branch = new Set<string>()
  while (cursor && !includedJobs.has(cursor.id)) {
    if (branch.has(cursor.id)) break
    if (cursor.targetChapterOrder !== targetChapterOrder) {
      warnings.push({
        code: 'JOB_SCOPE_MISMATCH',
        message: `任务 ${cursor.id} 的章序 ${cursor.targetChapterOrder} 与目标章序 ${targetChapterOrder} 不一致，未纳入统计。`,
        relatedIds: [cursor.id]
      })
      break
    }
    branch.add(cursor.id)
    includedJobs.set(cursor.id, cursor)
    const sourceId: ID | null | undefined = cursor.taskEdit?.sourceJobId
    if (!sourceId) break
    const cursorProjectId: ID = cursor.projectId
    const source: ChapterGenerationJob | undefined = data.chapterGenerationJobs.find(
      (item: ChapterGenerationJob): boolean => item.id === sourceId && item.projectId === cursorProjectId
    )
    if (!source) {
      warnings.push({ code: 'MISSING_JOB', message: `任务 ${cursor.id} 引用的来源任务 ${sourceId} 不存在，未猜测替代来源。`, relatedIds: [cursor.id, sourceId] })
      break
    }
    cursor = source
  }
}

function phaseSummary(calls: AcceptedChapterCostCall[], role: PipelineAIRole): AcceptedChapterPhaseSummary {
  const selected = calls.filter((call) => call.role === role)
  return {
    role,
    callCount: selected.length,
    failedCallCount: selected.filter((call) => call.outcome === 'failed').length,
    retryCount: selected.reduce((total, call) => total + call.retryCount, 0),
    durationMs: durationMetric(selected),
    promptTokens: metric(selected, 'promptTokens'),
    completionTokens: metric(selected, 'completionTokens'),
    totalTokens: metric(selected, 'totalTokens')
  }
}

export function measureAcceptedChapterCost(input: AcceptedChapterCostInput): AcceptedChapterCostResult {
  validateFixedRate(input.fixedRate)
  const { data, projectId, chapterId } = input
  const chapter = data.chapters.find((item) => item.id === chapterId && item.projectId === projectId)
  if (!chapter) throw new Error(`Accepted chapter cost cannot find chapter ${chapterId} in project ${projectId}.`)
  const warnings: AcceptedChapterCostWarning[] = []
  const lineage = collectLineage(data, projectId, chapterId, warnings)
  const includedJobs = new Map<string, ChapterGenerationJob>()
  const directJobIds = [
    ...lineage.chapterCommits.flatMap((commit) => [commit.jobId, commit.generatedDraft?.jobId].filter(Boolean) as string[]),
    ...lineage.revisionCommits.flatMap((commit) => {
      const sessionId = commit.revisionSessionId ?? commit.revisionSession?.id
      const session = sessionId ? data.revisionSessions.find((item) => item.id === sessionId) ?? commit.revisionSession : undefined
      const draftId = session?.sourceDraftId
      return draftId ? data.generatedChapterDrafts.filter((item) => item.id === draftId && item.projectId === projectId).map((item) => item.jobId) : []
    }),
    ...lineage.traceIds.flatMap((traceId) => data.generationRunTraces.filter((trace) => trace.id === traceId && trace.projectId === projectId).map((trace) => trace.jobId))
  ]
  for (const jobId of unique(directJobIds)) {
    const job = data.chapterGenerationJobs.find((item) => item.id === jobId && item.projectId === projectId)
    if (job) addJobWithSources(data, job, chapter.order, includedJobs, warnings)
    else warnings.push({ code: 'MISSING_JOB', message: `采纳链引用的任务 ${jobId} 不存在。`, relatedIds: [jobId] })
  }
  for (const jobId of unique([...(input.relatedJobIds ?? [])])) {
    const job = data.chapterGenerationJobs.find((item) => item.id === jobId)
    if (!job || job.projectId !== projectId || job.targetChapterOrder !== chapter.order) {
      warnings.push({
        code: 'REJECTED_RELATED_JOB',
        message: `显式关联任务 ${jobId} 不属于当前项目和章序，未纳入统计。`,
        relatedIds: [jobId]
      })
      continue
    }
    addJobWithSources(data, job, chapter.order, includedJobs, warnings)
  }

  for (const job of data.chapterGenerationJobs) {
    if (job.projectId === projectId && job.targetChapterOrder === chapter.order && job.status === 'failed' && !includedJobs.has(job.id)) {
      warnings.push({
        code: 'UNATTRIBUTED_FAILED_JOB',
        message: `失败任务 ${job.id} 与本章章序相同，但没有采纳链来源；未自动计费，可通过 relatedJobIds 明确纳入。`,
        relatedIds: [job.id]
      })
    }
  }

  const traceSources: { trace: GenerationRunTrace; sourceKind: TelemetryObservation['sourceKind']; sourceId: string }[] = []
  for (const trace of data.generationRunTraces) {
    if (trace.projectId !== projectId || !includedJobs.has(trace.jobId)) continue
    if (trace.targetChapterOrder !== chapter.order) {
      warnings.push({
        code: 'TRACE_SCOPE_MISMATCH',
        message: `运行记录 ${trace.id} 的章序 ${trace.targetChapterOrder} 与目标章序 ${chapter.order} 不一致，未纳入统计。`,
        relatedIds: [trace.id, trace.jobId]
      })
      continue
    }
    traceSources.push({ trace, sourceKind: 'stored_trace', sourceId: trace.id })
  }
  for (const commit of [...lineage.chapterCommits, ...lineage.revisionCommits]) {
    const trace = commit.generationRunTrace
    if (trace && trace.projectId === projectId && includedJobs.has(trace.jobId) && trace.targetChapterOrder === chapter.order) {
      traceSources.push({ trace, sourceKind: 'commit_trace', sourceId: commit.id })
    } else if (trace && trace.projectId === projectId && includedJobs.has(trace.jobId)) {
      warnings.push({
        code: 'TRACE_SCOPE_MISMATCH',
        message: `提交 ${commit.id} 内的运行记录 ${trace.id} 章序不属于目标章节，未纳入统计。`,
        relatedIds: [commit.id, trace.id]
      })
    }
  }
  const observations: TelemetryObservation[] = []
  let observedTelemetryRecordCount = 0
  let unidentifiedTelemetryRecordCount = 0
  for (const { trace, sourceKind, sourceId } of traceSources) {
    for (const call of trace.aiCalls ?? []) {
      observedTelemetryRecordCount++
      const callId = call.callId?.trim() ?? ''
      if (!callId) {
        unidentifiedTelemetryRecordCount++
        warnings.push({ code: 'MISSING_CALL_ID', message: `遥测记录 ${call.id} 没有 callId，无法可靠去重，未计入累计值。`, relatedIds: [call.id, trace.id] })
        continue
      }
      const persistedStep = data.chapterGenerationSteps.find((step) => step.id === call.stepId)
      if (persistedStep && (persistedStep.jobId !== trace.jobId || persistedStep.type !== call.stepType)) {
        warnings.push({ code: 'CROSS_JOB_STEP', message: `调用 ${callId} 的 step 与 trace/job 归属冲突，未计入。`, relatedIds: [callId, call.stepId, trace.id] })
        continue
      }
      observations.push({ callId, jobId: trace.jobId, traceId: trace.id, sourceId, sourceKind, role: call.role, stepType: call.stepType, outcome: call.outcome, telemetry: call })
    }
  }
  const reportSources = [
    ...data.qualityGateReports,
    ...lineage.chapterCommits.flatMap((commit) => commit.qualityGateReports ?? [])
  ]
  for (const report of reportSources) {
    if (report.projectId !== projectId || !includedJobs.has(report.jobId) || !report.aiTelemetry) continue
    observedTelemetryRecordCount++
    const callId = report.aiTelemetry.callId?.trim() ?? ''
    if (!callId) {
      unidentifiedTelemetryRecordCount++
      warnings.push({ code: 'MISSING_CALL_ID', message: `质量报告 ${report.id} 的遥测没有 callId，无法可靠去重，未计入累计值。`, relatedIds: [report.id] })
      continue
    }
    observations.push({ callId, jobId: report.jobId, traceId: null, sourceId: report.id, sourceKind: 'quality_report', role: 'reviewer', stepType: 'quality_gate', outcome: 'unknown', telemetry: report.aiTelemetry })
  }

  const grouped = new Map<string, TelemetryObservation[]>()
  for (const observation of observations) grouped.set(observation.callId, [...(grouped.get(observation.callId) ?? []), observation])
  const calls: AcceptedChapterCostCall[] = []
  let hasAnyUsage = false
  for (const [callId, group] of grouped) {
    group.sort((a, b) => ({ stored_trace: 0, commit_trace: 1, quality_report: 2 })[a.sourceKind] - ({ stored_trace: 0, commit_trace: 1, quality_report: 2 })[b.sourceKind])
    const canonical = group[0]
    const signatures = unique(group.map(telemetrySignature))
    const conflicted = unique(group.map((item) => item.jobId)).length > 1 || signatures.length > 1
    if (conflicted) {
      warnings.push({ code: 'CALL_ID_CONFLICT', message: `callId ${callId} 在多个来源中的归属或遥测不一致，仅保留明细，不计入累计值。`, relatedIds: unique([callId, ...group.map((item) => item.sourceId)]) })
    }
    const resolved = resolveUsage(canonical.telemetry, callId, warnings)
    hasAnyUsage ||= resolved.hasAny && !conflicted
    const attempts = Math.round(finiteNonNegative(canonical.telemetry.attempts) ?? 0)
    const retryCount = Math.max(0, attempts - 1)
    if (retryCount > 0) {
      warnings.push({
        code: 'RETRY_USAGE_MAY_BE_INCOMPLETE',
        message: `调用 ${callId} 发生 ${retryCount} 次重试；现有 usage 可能不含失败尝试的供应商计费 token。`,
        relatedIds: [callId]
      })
    }
    calls.push({
      callId,
      jobId: canonical.jobId,
      traceId: canonical.traceId,
      sourceIds: unique(group.map((item) => item.sourceId)),
      role: canonical.role,
      stepType: canonical.stepType,
      provider: canonical.telemetry.provider,
      model: canonical.telemetry.model,
      outcome: canonical.outcome,
      durationMs: conflicted ? null : finiteNonNegative(canonical.telemetry.durationMs) ?? null,
      attempts,
      retryCount,
      responseFormatFallback: canonical.telemetry.responseFormatFallback,
      terminationCategory: canonical.telemetry.terminationCategory,
      usageStatus: conflicted ? 'unknown' : resolved.status,
      usage: resolved.usage,
      conflicted,
      monetaryCost: conflicted ? null : monetaryCost(resolved.usage, input.fixedRate)
    })
  }
  calls.sort((a, b) => a.jobId.localeCompare(b.jobId) || a.callId.localeCompare(b.callId))

  const jobsWithCalls = new Set(calls.map((call) => call.jobId))
  for (const job of includedJobs.values()) {
    if (!jobsWithCalls.has(job.id)) {
      warnings.push({
        code: 'MISSING_JOB_TELEMETRY',
        message: `已归属任务 ${job.id} 没有可按 callId 统计的遥测；${job.status === 'failed' ? '失败成本未知。' : '不能视为零成本。'}`,
        relatedIds: [job.id]
      })
    }
  }
  for (const commit of lineage.revisionCommits) {
    if (commit.revisedBy === 'user') continue
    const revisionVersionId = commit.revisionVersionId ?? commit.revisionVersion?.id ?? null
    const linkedTrace = traceSources.map((item) => item.trace).find((trace) => trace.id === commit.linkedGenerationRunTraceId)
    const hasLinkedRevisionCall = Boolean(
      revisionVersionId && linkedTrace?.acceptedRevisionVersionId === revisionVersionId &&
      linkedTrace.aiCalls.some((call) => call.role === 'revision' && call.callId)
    )
    if (!hasLinkedRevisionCall) {
      warnings.push({
        code: 'MISSING_REVISION_TELEMETRY',
        message: `正式修订 ${commit.revisionCommitId} 没有可严格绑定到修订版本的 AI 遥测，修订成本未知。`,
        relatedIds: [commit.revisionCommitId, ...(revisionVersionId ? [revisionVersionId] : [])]
      })
    }
  }
  const warnedRevisionCandidates = new Set<string>()
  for (const commit of lineage.chapterCommits) {
    const draftId = commit.generatedDraftId ?? commit.generatedDraft?.id ?? null
    const commitJobId = commit.jobId ?? commit.generatedDraft?.jobId ?? null
    if (!draftId) continue
    for (const candidate of data.revisionCandidates) {
      if (
        candidate.projectId !== projectId || candidate.jobId !== commitJobId || candidate.draftId !== draftId ||
        candidate.status !== 'accepted' || candidate.revisedText !== commit.chapter.body || warnedRevisionCandidates.has(candidate.id)
      ) continue
      warnedRevisionCandidates.add(candidate.id)
      warnings.push({
        code: 'MISSING_REVISION_TELEMETRY',
        message: `已采纳草稿包含修订候选 ${candidate.id}，但该候选没有持久化 AI 遥测，修订成本未知。`,
        relatedIds: [candidate.id, draftId, commit.commitId]
      })
    }
  }

  const durationMs = durationMetric(calls)
  const promptTokens = metric(calls, 'promptTokens')
  const completionTokens = metric(calls, 'completionTokens')
  const totalTokens = metric(calls, 'totalTokens')
  const reasoningTokens = metric(calls, 'reasoningTokens')
  const cachedPromptTokens = metric(calls, 'cachedPromptTokens')
  const materialGapCodes = new Set<AcceptedChapterCostWarning['code']>([
    'NO_FORMAL_ACCEPTED_VERSION', 'AMBIGUOUS_CURRENT_VERSION', 'BROKEN_VERSION_CHAIN', 'VERSION_CHAIN_CYCLE',
    'MISSING_JOB', 'JOB_SCOPE_MISMATCH', 'TRACE_SCOPE_MISMATCH', 'REJECTED_RELATED_JOB',
    'UNATTRIBUTED_FAILED_JOB', 'MISSING_JOB_TELEMETRY', 'MISSING_REVISION_TELEMETRY', 'MISSING_CALL_ID',
    'CALL_ID_CONFLICT', 'CROSS_JOB_STEP', 'INVALID_USAGE', 'RETRY_USAGE_MAY_BE_INCOMPLETE'
  ])
  const hasMaterialGap = warnings.some((warning) => materialGapCodes.has(warning.code)) || calls.some((call) => call.usageStatus !== 'complete')
  const status: AcceptedChapterCostStatus = !hasAnyUsage ? 'unknown' : hasMaterialGap ? 'partial' : 'complete'
  const pricedCalls = calls.filter((call) => call.monetaryCost !== null)
  const monetary: AcceptedChapterMonetaryCost | null = input.fixedRate
    ? {
        currency: input.fixedRate.currency.trim(),
        status: pricedCalls.length === 0 ? 'unknown' : pricedCalls.length === calls.length && status === 'complete' ? 'complete' : 'partial',
        knownAmount: Number(pricedCalls.reduce((total, call) => total + (call.monetaryCost ?? 0), 0).toFixed(12)),
        unknownCallCount: calls.length - pricedCalls.length + unidentifiedTelemetryRecordCount
      }
    : null

  return {
    projectId,
    chapterId,
    chapterOrder: chapter.order,
    status,
    currentVersionId: lineage.currentVersionId,
    chapterCommitIds: lineage.chapterCommits.map((commit) => commit.commitId),
    revisionCommitIds: lineage.revisionCommits.map((commit) => commit.revisionCommitId),
    includedJobIds: [...includedJobs.keys()],
    includedTraceIds: unique(traceSources.map((item) => item.trace.id)),
    callCount: calls.length,
    observedTelemetryRecordCount,
    unidentifiedTelemetryRecordCount,
    successfulCallCount: calls.filter((call) => call.outcome === 'success').length,
    failedCallCount: calls.filter((call) => call.outcome === 'failed').length,
    unknownOutcomeCallCount: calls.filter((call) => call.outcome === 'unknown').length,
    attemptCount: calls.reduce((total, call) => total + call.attempts, 0),
    retryCount: calls.reduce((total, call) => total + call.retryCount, 0),
    responseFormatFallbackCount: calls.filter((call) => call.responseFormatFallback).length,
    durationMs,
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens,
    cachedPromptTokens,
    monetaryCost: monetary,
    phases: ROLES.map((role) => phaseSummary(calls, role)).filter((phase) => phase.callCount > 0),
    calls,
    warnings
  }
}
