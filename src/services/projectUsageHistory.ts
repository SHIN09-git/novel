import type { AiCallTelemetry, AppData, GenerationRunTrace, PipelineAIRole, QualityGateReport } from '../shared/types'
import type { ProjectModelRate, UsagePhase } from '../shared/projectUsage'

export interface LegacyUsageCall { jobId: string; phase: UsagePhase; telemetry: AiCallTelemetry }
export interface UsageHistory {
  projectId: string
  rates: ProjectModelRate[]
  finishedJobs: string[]
  calls: LegacyUsageCall[]
}
const roles: Record<PipelineAIRole, UsagePhase> = { planner:'planning', prose:'writing', extraction:'extraction', reviewer:'review', revision:'revision' }
type Trace = Pick<GenerationRunTrace, 'projectId' | 'jobId' | 'aiCalls'>
type Report = Pick<QualityGateReport, 'projectId' | 'jobId' | 'aiTelemetry'>

export function collectLegacyCalls(projectId: string, jobs: { id:string; status:string }[], rates: ProjectModelRate[],
  traces: (Trace | null | undefined)[], reports: (Report | null | undefined)[]): UsageHistory {
  const ids = new Set(jobs.map(j => j.id))
  const calls: LegacyUsageCall[] = []
  const add = (jobId: string, phase: UsagePhase, telemetry: AiCallTelemetry) => {
    if (telemetry.attempts === 0 && !telemetry.usage && !telemetry.usageJournalIncomplete) return // Local validation is not a paid dispatch.
    calls.push({ jobId, phase, telemetry })
  }
  for (const t of traces) if (t?.projectId === projectId && ids.has(t.jobId) && Array.isArray(t.aiCalls)) {
    for (const call of t.aiCalls) if (call) add(t.jobId, Object.hasOwn(roles, call.role) ? roles[call.role] : 'other', call)
  }
  for (const r of reports) if (r?.projectId === projectId && ids.has(r.jobId) && r.aiTelemetry) add(r.jobId, 'review', r.aiTelemetry)
  return { projectId, rates, calls, finishedJobs: jobs.filter(j => j.status === 'failed' || j.status === 'completed').map(j => j.id) }
}

export function projectUsageHistory(data: AppData, projectId: string) {
  const project = data.projects.find(p => p.id === projectId)
  if (!project) throw new Error('找不到要统计用量的项目。')
  const commits = data.chapterCommitBundles.filter(c => c.projectId === projectId)
  const revisions = data.revisionCommitBundles.filter(c => c.projectId === projectId)
  return collectLegacyCalls(projectId, data.chapterGenerationJobs.filter(j => j.projectId === projectId), project.modelRates ?? [],
    [...data.generationRunTraces, ...commits.map(c => c.generationRunTrace), ...revisions.map(c => c.generationRunTrace)],
    [...data.qualityGateReports, ...commits.flatMap(c => c.qualityGateReports ?? [])])
}
