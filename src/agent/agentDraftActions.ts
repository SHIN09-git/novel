import type { AgentRun, AppData, GeneratedChapterDraft } from '../shared/types'
import { redactSensitiveText } from '../shared/errorUtils'
import { hasCurrentChapterFragment } from '../shared/chapterStepFragment'
import { draftContentHash } from '../services/DraftDiagnosticBindingService'
import { decisionFingerprint } from '../services/candidateDecisionPrimitives'
import { firstPendingRunTarget } from './agentBatchWriteback'
import { readAgentJobExecution } from './agentJobExecution'
import { assertAgentDraftContent } from './agentDraftReview'
import { AgentRunService } from './AgentRunService'
import { saveAgentRuntimeData, type AgentRuntimeData } from './AgentRuntime'
import { findProjectId, requiredString } from './tools/agentToolArguments'

export function latestAgentDraft(data: AppData, projectId: string, jobId: string) {
  return data.generatedChapterDrafts.filter(item => item.jobId === jobId && item.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))[0]
}

export async function requireAgentPendingDraft(
  runtime: AgentRuntimeData, projectId: string, agentRunId: string, draftId: string
): Promise<GeneratedChapterDraft> {
  const { data } = runtime
  const draft = data.generatedChapterDrafts.find(item => item.id === draftId && item.projectId === projectId)
  const run = data.agentRuns.find(item => item.id === agentRunId && item.projectId === projectId)
  const job = draft && data.chapterGenerationJobs.find(item => item.id === draft.jobId && item.projectId === projectId)
  if (!draft || !job || !run || firstPendingRunTarget(data, run)?.jobId !== job.id || draft.status !== 'draft' || !draft.body.trim() ||
    latestAgentDraft(data, projectId, job.id)?.id !== draftId || hasCurrentChapterFragment(data.chapterGenerationSteps, job.id, draft)) {
    throw new Error('该草稿不是指定批次的当前待处理稿。请重新读取工作单。')
  }
  const execution = await readAgentJobExecution(runtime.storagePath, job.id)
  if (execution === 'active' || (job.status === 'running' && execution === 'untracked')) {
    throw new Error('章节仍在执行，请先完成或停止生成后再修改草稿。')
  }
  return draft
}

const decisionStep = 'record_draft_decision'

export function currentAgentDraftDecision(run: AgentRun, draft: GeneratedChapterDraft) {
  const key = `draft=${draft.id};hash=${draftContentHash(draft.body)}`
  return [...run.decisions].reverse().find(item =>
    item.step === decisionStep && item.jobId === draft.jobId && item.evidence.includes(key))
}

export async function recordAgentDraftDecision(runtime: AgentRuntimeData, args: Record<string, unknown>) {
  const { data } = runtime
  const projectId = findProjectId(data, args)
  const agentRunId = requiredString(args, 'agentRunId')
  const draftId = requiredString(args, 'draftId')
  const operationId = requiredString(args, 'operationId')
  const contentHash = requiredString(args, 'expectedDraftContentHash')
  const reason = redactSensitiveText(requiredString(args, 'reason'), [data.settings.apiKey])
  const decision = args.decision
  if (decision !== 'reject' && decision !== 'defer') throw new Error('decision 必须为 reject 或 defer。')
  const id = `agent-draft-decision-${decisionFingerprint([projectId, operationId])}`
  const command = decisionFingerprint([projectId, agentRunId, draftId, contentHash, decision, reason])
  const previous = data.agentRuns.filter(item => item.projectId === projectId)
    .flatMap(item => item.decisions).find(item => item.id === id)
  if (previous) {
    if (!previous.evidence.includes(command)) throw new Error('此操作编号已用于不同的草稿决定。')
    return { projectId, agentRunId, draftId, decisionId: id, decision, replayed: true }
  }
  const draft = await requireAgentPendingDraft(runtime, projectId, agentRunId, draftId)
  assertAgentDraftContent(draft, contentHash)
  const timestamp = new Date().toISOString()
  const next = AgentRunService.recordAgentDecision(decision === 'defer' ? data : {
    ...data, generatedChapterDrafts: data.generatedChapterDrafts.map(item => item.id === draft.id && item.projectId === projectId
      ? { ...item, status: 'rejected' as const } : item)
  }, {
    id, agentRunId, projectId, jobId: draft.jobId, chapterId: draft.chapterId,
    step: decisionStep, action: decision === 'reject' ? 'reject_draft' : 'pause_for_human',
    reason, evidence: [`draft=${draft.id};hash=${contentHash}`, command],
    result: 'applied', riskLevel: 'low', createdAt: timestamp
  })
  const saved = await saveAgentRuntimeData(next, runtime)
  return { projectId, agentRunId, draftId, decisionId: id, decision, replayed: false, saved }
}
