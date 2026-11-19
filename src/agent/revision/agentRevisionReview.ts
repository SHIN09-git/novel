import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { MainAIJsonClient } from '../../main/services/MainAIJsonClient'
import { agentApiKey, apiEndpoint, readApiRegistry } from '../../main/services/ApiRegistry'
import { deriveConsistencyReviewFromQualityGate } from '../../services/CombinedSemanticReviewService'
import { NoveltyDetector } from '../../services/NoveltyDetector'
import { resolvePipelineRoleSettings, resolvePipelineRunSettings } from '../../services/PipelineRunContextService'
import { QualityGateService } from '../../services/QualityGateService'
import { QualityGateAI } from '../../services/ai/QualityGateAI'
import { qualityGateEffectivelyPassed } from '../../shared/qualityGatePolicy'
import { redactSensitiveText } from '../../shared/errorUtils'
import type { AppData, QualityGateReport } from '../../shared/types'
import { createHeadlessTransport } from '../AgentPipelineExecutor'
import { loadAgentRuntimeData, saveAgentRuntimeData, type AgentRuntimeData } from '../AgentRuntime'
import { assertRevisionBatchTarget } from '../agentBatchWriteback'
import { claimAgentJobExecution } from '../agentJobExecution'
import { findProjectId, readOptions, requiredString } from '../tools/agentToolArguments'
import { redactCandidateValue } from '../tools/agentCandidateDecisionOutput'
import { latestRevisionReview, revisionReviewBasis } from './agentRevisionReviewEvidence'
import {
  assertRevisionWritable, checkKnownAgentSource, checkRevisionFields, checkSourceHashes, checkVersionSource,
  commandIdentity, resolveRevisionSource, revisionCommonFields, revisionFingerprint, revisionHashFields, revisionRun,
  revisionVersion, revisionWriteFields
} from './agentRevisionModel'

function subject(data: AppData, projectId: string, runId: string, args: Record<string, unknown>) {
  const run = revisionRun(data, projectId, runId)
  const { session, version } = revisionVersion(data, projectId, requiredString(args, 'versionId'))
  const resolved = resolveRevisionSource(data, projectId, session.chapterId, session.sourceDraftId)
  assertRevisionWritable(resolved)
  if (!resolved.chapter || session.status !== 'active' || !['pending', 'draft'].includes(version.status)) {
    throw new Error('只能审查当前待提交的正式章节修订候选。')
  }
  const versionHash = revisionFingerprint(version)
  if (versionHash !== requiredString(args, 'expectedVersionHash')) throw new Error('修订版本已变化。')
  checkSourceHashes(resolved.source, args)
  checkVersionSource(version, resolved)
  checkKnownAgentSource(data, resolved.source, 'version', version.id, versionHash)
  assertRevisionBatchTarget(data, run, resolved.chapter.id)
  return { chapter: resolved.chapter, version, versionHash, sourceJobId: resolved.source.sourceJobId }
}

function reviewSummary(report: QualityGateReport, apiKey: string) {
  return { reportId: report.id, consistencyReviewReportId: report.revisionReview?.consistencyReviewReportId,
    versionId: report.revisionReview?.revisionVersionId, draftContentHash: report.draftContentHash,
    score: report.overallScore, passed: qualityGateEffectivelyPassed(report), issues: report.issues.length,
    requiredFixes: report.requiredFixes.slice(0, 3).map(item => redactSensitiveText(item, [apiKey])),
    read: { tool: 'agent.getRevisionReview', arguments: { projectId: report.projectId, agentRunId: report.revisionReview?.agentRunId,
      versionId: report.revisionReview?.revisionVersionId, reportId: report.id, detail: 'full' } } }
}

function replay(data: AppData, projectId: string, reportId: string, commandHash: string) {
  const report = data.qualityGateReports.find(item => item.id === reportId)
  if (!report) return null
  if (report.projectId !== projectId || report.revisionReview?.commandHash !== commandHash) {
    throw new Error('此操作编号已用于不同的修订审稿。')
  }
  return { ...reviewSummary(report, data.settings.apiKey), replayed: true }
}

export async function reviewAgentRevisionVersion(runtime: AgentRuntimeData, args: Record<string, unknown>) {
  checkRevisionFields(args, [...revisionWriteFields, ...revisionHashFields, 'versionId', 'expectedVersionHash'])
  const projectId = findProjectId(runtime.data, args)
  const identity = commandIdentity(args, 'review_revision_version', projectId)
  const reportId = `${identity.id}-quality`
  if (!runtime.storagePath) throw new Error('没有可写入的书库。')
  const previous = replay(runtime.data, projectId, reportId, identity.hash)
  if (previous) return previous
  // Prevent paying twice for a concurrently retried review command; different chapters
  // in a batch may enter review only after the previous one has a verified commit.
  const release = await claimAgentJobExecution(runtime.storagePath, reportId)
  try {
    return await runReview(runtime, args, projectId, identity.agentRunId, reportId, identity.hash)
  } finally { await release() }
}

async function runReview(runtime: AgentRuntimeData, args: Record<string, unknown>, projectId: string, runId: string, reportId: string, commandHash: string) {
  const fresh = () => loadAgentRuntimeData({ storagePath: runtime.storagePath!, userDataPath: runtime.userDataPath })
  const initial = await fresh()
  const { data, storagePath, userDataPath } = initial
  if (!storagePath || storagePath !== runtime.storagePath || initial.source === 'empty') throw new Error('书库位置已变化，请重读工作单。')
  const duplicate = replay(data, projectId, reportId, commandHash)
  if (duplicate) return duplicate
  const { chapter, version, versionHash, sourceJobId } = subject(data, projectId, runId, args)
  const auth = new AgentAuthorizationService(userDataPath)
  const scope = { storagePath, projectId, chapterOrder: chapter.order, actions: ['apply_revision'] } as const
  const requireGrant = async () => {
    if (!await auth.findGrant(scope)) throw new Error('该章节没有有效修订授权，未调用审稿模型。')
  }
  await requireGrant()
  const basis = revisionReviewBasis(data, chapter, version)
  const frozen = data.chapterGenerationJobs.find(job => job.id === sourceJobId && job.projectId === projectId)?.aiRunConfig
  const base = resolvePipelineRunSettings(frozen, data.settings)
  const reviewer = resolvePipelineRoleSettings(frozen, data.settings, 'reviewer')
  const remote = reviewer.apiProvider === 'compatible' || reviewer.apiProvider === 'openai'
  const registry = remote ? await readApiRegistry() : new Map()
  const settings = { ...reviewer, hasApiKey: remote && Boolean(agentApiKey(registry, reviewer.baseUrl, base.baseUrl)) }
  if (remote && !settings.hasApiKey) throw new Error(`审稿模型缺少 ${registry.get(apiEndpoint(settings.baseUrl))?.keyEnv ?? 'NOVEL_DIRECTOR_API_KEY'}。`)
  const transport = createHeadlessTransport(base, registry, storagePath, requireGrant).transport
  const ai = new QualityGateAI(new MainAIJsonClient(settings, transport, runId, projectId))
  const chapterDraft = { title: chapter.title, body: version.body }
  const report = await QualityGateService.evaluateChapterDraft({
    projectId, chapterId: chapter.id, jobId: runId, draftId: null, chapterDraft,
    context: basis.context, chapterPlan: null, consistencyReports: [],
    characterStateFacts: basis.characterStateFacts, characters: basis.characters,
    hardCanonAudit: basis.canon ?? undefined, targetChapterOrder: chapter.order,
    hasAuthoritativeChapterTask: chapter.order === 1,
    noveltyAuditResult: NoveltyDetector.audit({ generatedText: version.body, context: basis.context,
      chapterPlan: null, project: basis.project, ...basis.refs }),
    aiService: { generateQualityGateReport: async (...input) => {
      const result = await ai.generateQualityGateReport(...input)
      if (!result.ok || !result.usedAI || !result.data) throw new Error(result.error || '审稿模型未返回有效报告，不能以本地模板代替。')
      return result
    } }
  })
  const combined = deriveConsistencyReviewFromQualityGate({ ...report, id: reportId }, null)
  const quality = { ...combined.qualityGateReport, revisionReview: { agentRunId: runId, revisionVersionId: version.id,
    versionHash, contextHash: basis.contextHash, commandHash, consistencyReviewReportId: combined.consistencyReviewReport.id } }
  return auth.withAuthorization(scope, async () => {
    const current = await fresh()
    if (current.storagePath !== storagePath || current.source === 'empty') throw new Error('书库位置已变化，未保存审稿。')
    const target = subject(current.data, projectId, runId, args)
    if (target.chapter.order !== chapter.order || revisionReviewBasis(current.data, target.chapter, target.version).contextHash !== basis.contextHash) {
      throw new Error('审稿期间上下文或章节顺序已变化，请重审。')
    }
    const saved = await saveAgentRuntimeData({ ...current.data,
      qualityGateReports: [...current.data.qualityGateReports, quality],
      consistencyReviewReports: [...current.data.consistencyReviewReports, combined.consistencyReviewReport] }, current)
    Object.assign(runtime, current)
    return { ...reviewSummary(quality, data.settings.apiKey), replayed: false, saved }
  })
}

export function readAgentRevisionReview(data: AppData, args: Record<string, unknown>) {
  checkRevisionFields(args, [...revisionCommonFields, 'agentRunId', 'versionId', 'reportId', 'detail'])
  const projectId = findProjectId(data, args)
  const runId = requiredString(args, 'agentRunId')
  revisionRun(data, projectId, runId)
  const { session, version } = revisionVersion(data, projectId, requiredString(args, 'versionId'))
  const chapter = data.chapters.find(item => item.id === session.chapterId && item.projectId === projectId)
  if (!chapter) throw new Error('缺少本书章节。')
  const report = args.reportId === undefined ? latestRevisionReview(data, runId, chapter, version) : data.qualityGateReports.find(item =>
    item.id === requiredString(args, 'reportId') && item.projectId === projectId && item.chapterId === chapter.id &&
    item.revisionReview?.agentRunId === runId && item.revisionReview.revisionVersionId === version.id)
  if (!report) throw new Error('没有此修订的审稿报告。')
  const summary = reviewSummary(report, data.settings.apiKey)
  if (readOptions(args).detail !== 'full') return summary
  const evidence = { qualityGateReport: report, consistencyReviewReport: data.consistencyReviewReports.find(item =>
    item.id === report.revisionReview?.consistencyReviewReportId && item.projectId === projectId && item.chapterId === chapter.id) ?? null }
  return { ...summary, ...redactCandidateValue(evidence, data) }
}
