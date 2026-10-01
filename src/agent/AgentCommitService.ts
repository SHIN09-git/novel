import { randomUUID } from 'node:crypto'
import { AgentRunService } from './AgentRunService'
import type {
  AgentActionPreview,
  AgentDecision,
  AppData,
  ChapterCommitBundle,
  GeneratedChapterDraft,
  ID,
  RevisionCommitBundle
} from '../shared/types'
import { isChapterArchived } from '../services/ChapterLifecycleService'
import { applyChapterCommitBundleToAppData, buildAcceptedDraftCommitBundle } from '../services/ChapterCommitBundleService'
import { applyRevisionCommitBundleToAppData } from '../services/RevisionCommitBundleService'

export type AgentAppliedCommit =
  | {
      kind: 'chapter_commit'
      bundle: ChapterCommitBundle
    }
  | {
      kind: 'revision_commit'
      bundle: RevisionCommitBundle
    }

export interface ApplyAgentActionPreviewInput {
  appData: AppData
  previewId: ID
  confirm?: boolean
}

export interface ApplyAgentActionPreviewResult {
  appData: AppData
  preview: AgentActionPreview
  decision: AgentDecision
  appliedCommit: AgentAppliedCommit
}

function now(): string {
  return new Date().toISOString()
}

function newId(prefix: string): ID {
  return `${prefix}-${randomUUID()}`
}

function upsertById<T extends { id: ID }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id)
  if (index < 0) return [...items, next]
  return items.map((item, itemIndex) => (itemIndex === index ? next : item))
}

function latestDraftForPreview(appData: AppData, preview: AgentActionPreview): GeneratedChapterDraft {
  const draftId = preview.affectedIds.find((id) => appData.generatedChapterDrafts.some((draft) => draft.id === id))
  const draft =
    (draftId ? appData.generatedChapterDrafts.find((item) => item.id === draftId) : null) ??
    (preview.jobId
      ? [...appData.generatedChapterDrafts]
          .filter((item) => item.jobId === preview.jobId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
      : null)
  if (!draft) throw new Error(`AgentActionPreview ${preview.id} cannot find a generated draft.`)
  return draft
}

function removeId(values: ID[], id: ID): ID[] {
  return values.filter((value) => value !== id)
}

function markPreviewApplied(appData: AppData, preview: AgentActionPreview, appliedAt: string): AppData {
  return {
    ...appData,
    agentActionPreviews: upsertById(appData.agentActionPreviews ?? [], {
      ...preview,
      status: 'applied',
      updatedAt: appliedAt
    })
  }
}

function updateAgentRunAfterApply(input: {
  appData: AppData
  preview: AgentActionPreview
  decision: AgentDecision
  draftId?: ID | null
  commitId: ID
}): AppData {
  const run = input.appData.agentRuns.find((item) => item.id === input.preview.agentRunId)
  if (!run) throw new Error(`AgentRun not found: ${input.preview.agentRunId}`)
  const nextRun = {
    ...run,
    createdDraftIds: input.draftId ? [...new Set([...run.createdDraftIds, input.draftId])] : run.createdDraftIds,
    createdCommitIds: [...new Set([...run.createdCommitIds, input.commitId])],
    pendingHumanReviewItemIds: removeId(run.pendingHumanReviewItemIds, input.preview.id),
    decisions: upsertById(run.decisions, input.decision),
    updatedAt: input.decision.createdAt
  }
  return AgentRunService.upsertAgentRunToAppData(input.appData, nextRun)
}

export class AgentCommitService {
  static applyActionPreview(input: ApplyAgentActionPreviewInput): ApplyAgentActionPreviewResult {
    const preview = input.appData.agentActionPreviews.find((item) => item.id === input.previewId)
    if (!preview) throw new Error(`AgentActionPreview not found: ${input.previewId}`)
    if (preview.evidence.some((item) => item.startsWith('chapter-acceptance-v1:'))) {
      throw new Error('Use agent.applyChapterAcceptance for this body-bound project-authorized preview.')
    }
    if (preview.status === 'applied') {
      throw new Error(`AgentActionPreview already applied: ${input.previewId}`)
    }
    if (preview.status === 'dismissed') {
      throw new Error(`AgentActionPreview was dismissed: ${input.previewId}`)
    }
    if (preview.requiresHumanApproval && !input.confirm) {
      throw new Error(`AgentActionPreview ${input.previewId} requires explicit --confirm.`)
    }
    if (preview.actionType === 'revision_commit') {
      throw new Error('Agent revision commit previews require an existing revision bundle and are not applied by this P3 command yet.')
    }
    if (preview.actionType !== 'chapter_commit') {
      throw new Error(`AgentActionPreview ${input.previewId} is not a commit preview.`)
    }
    if (preview.recommendation !== 'accept') {
      throw new Error(`AgentActionPreview ${preview.id} does not recommend accepting the draft.`)
    }

    const appliedAt = now()
    const commitId = `agent-chapter-commit-${preview.id}`
    const existingCommit = input.appData.chapterCommitBundles.find(
      (bundle) => bundle.commitId === commitId || bundle.id === commitId
    )
    if (existingCommit) {
      if (existingCommit.projectId !== preview.projectId) {
        throw new Error(`Existing ChapterCommitBundle ${commitId} does not match preview project ${preview.projectId}.`)
      }
      if (preview.jobId && existingCommit.jobId && preview.jobId !== existingCommit.jobId) {
        throw new Error(`Existing ChapterCommitBundle ${commitId} does not match preview job ${preview.jobId}.`)
      }
      const decision: AgentDecision = {
        id: newId('agent-decision'),
        agentRunId: preview.agentRunId,
        projectId: preview.projectId,
        chapterId: existingCommit.chapterId,
        jobId: preview.jobId ?? existingCommit.jobId ?? null,
        step: 'apply_action_preview',
        action: 'accept_draft',
        reason: `Recovered already persisted ChapterCommitBundle ${commitId} and completed Agent metadata.`,
        evidence: [
          ...preview.evidence,
          ...(existingCommit.generatedDraftId ? [`draftId=${existingCommit.generatedDraftId}`] : []),
          `commitId=${commitId}`
        ],
        riskLevel: preview.riskLevel,
        result: 'applied',
        createdAt: appliedAt
      }
      const committed = applyChapterCommitBundleToAppData(input.appData, existingCommit)
      const withPreview = markPreviewApplied(committed, preview, appliedAt)
      const appData = updateAgentRunAfterApply({
        appData: withPreview,
        preview,
        decision,
        draftId: existingCommit.generatedDraftId,
        commitId
      })
      return {
        appData,
        preview: appData.agentActionPreviews.find((item) => item.id === preview.id) ?? preview,
        decision,
        appliedCommit: { kind: 'chapter_commit', bundle: existingCommit }
      }
    }

    const draft = latestDraftForPreview(input.appData, preview)
    const job = input.appData.chapterGenerationJobs.find((item) => item.id === draft.jobId)
    if (!job) throw new Error(`Generated draft ${draft.id} references missing job ${draft.jobId}.`)

    const existingChapter = input.appData.chapters.find((chapter) => chapter.projectId === draft.projectId && chapter.order === job.targetChapterOrder) ?? null
    if (existingChapter && isChapterArchived(existingChapter)) {
      throw new Error(`Chapter ${job.targetChapterOrder} is archived. Restore it before accepting a generated draft.`)
    }
    const bundle = buildAcceptedDraftCommitBundle({
      appData: input.appData,
      projectId: draft.projectId,
      draftId: draft.id,
      targetChapterOrder: job.targetChapterOrder,
      commitId,
      chapterId: existingChapter?.id ?? draft.chapterId ?? newId('agent-chapter'),
      acceptedAt: appliedAt,
      chapterVersionId: `agent-accepted-${preview.id}`,
      commitNote: `Applied by Agent Runtime from preview ${preview.id}.`
    })
    bundle.acceptedBy = 'agent'
    bundle.actor = { kind: 'agent', agentRunId: preview.agentRunId, actionPreviewId: preview.id }

    const decision: AgentDecision = {
      id: newId('agent-decision'),
      agentRunId: preview.agentRunId,
      projectId: preview.projectId,
      chapterId: bundle.chapterId,
      jobId: preview.jobId ?? draft.jobId,
      step: 'apply_action_preview',
      action: 'accept_draft',
      reason: `Applied action preview ${preview.id} through ChapterCommitBundle ${bundle.commitId}.`,
      evidence: [...preview.evidence, `draftId=${draft.id}`, `commitId=${bundle.commitId}`],
      riskLevel: preview.riskLevel,
      result: 'applied',
      createdAt: appliedAt
    }

    const committed = applyChapterCommitBundleToAppData(input.appData, bundle)
    const withPreview = markPreviewApplied(committed, preview, appliedAt)
    const appData = updateAgentRunAfterApply({
      appData: withPreview,
      preview,
      decision,
      draftId: draft.id,
      commitId: bundle.commitId
    })

    return {
      appData,
      preview: appData.agentActionPreviews.find((item) => item.id === preview.id) ?? preview,
      decision,
      appliedCommit: {
        kind: 'chapter_commit',
        bundle
      }
    }
  }

  static applyRevisionCommitBundleForAgent(input: {
    appData: AppData
    preview: AgentActionPreview
    bundle: RevisionCommitBundle
    confirm?: boolean
  }): ApplyAgentActionPreviewResult {
    const preview = input.appData.agentActionPreviews.find((item) => item.id === input.preview.id)
    if (!preview) throw new Error(`AgentActionPreview not found: ${input.preview.id}`)
    if (preview.status === 'applied' || preview.status === 'dismissed') {
      throw new Error(`AgentActionPreview ${preview.id} is already ${preview.status}.`)
    }
    if (preview.actionType !== 'revision_commit') {
      throw new Error(`AgentActionPreview ${preview.id} is not a revision commit preview.`)
    }
    if (preview.recommendation !== 'revise') {
      throw new Error(`AgentActionPreview ${preview.id} does not recommend a revision.`)
    }
    if (preview.projectId !== input.bundle.projectId) {
      throw new Error(`AgentActionPreview ${preview.id} projectId does not match the revision bundle.`)
    }
    if (preview.chapterId && preview.chapterId !== input.bundle.chapterId) {
      throw new Error(`AgentActionPreview ${preview.id} chapterId does not match the revision bundle.`)
    }
    if (preview.requiresHumanApproval && !input.confirm) {
      throw new Error(`AgentActionPreview ${preview.id} requires explicit confirmation.`)
    }
    const appliedAt = now()
    const decision: AgentDecision = {
      id: newId('agent-decision'),
      agentRunId: preview.agentRunId,
      projectId: preview.projectId,
      chapterId: input.bundle.chapterId,
      jobId: preview.jobId ?? null,
      step: 'apply_action_preview',
      action: 'revise_draft',
      reason: `Applied revision preview ${preview.id} through RevisionCommitBundle ${input.bundle.revisionCommitId}.`,
      evidence: [...preview.evidence, `revisionCommitId=${input.bundle.revisionCommitId}`],
      riskLevel: preview.riskLevel,
      result: 'applied',
      createdAt: appliedAt
    }
    const committed = applyRevisionCommitBundleToAppData(input.appData, input.bundle)
    const withPreview = markPreviewApplied(committed, preview, appliedAt)
    const appData = updateAgentRunAfterApply({
      appData: withPreview,
      preview,
      decision,
      commitId: input.bundle.revisionCommitId
    })
    return {
      appData,
      preview: appData.agentActionPreviews.find((item) => item.id === preview.id) ?? preview,
      decision,
      appliedCommit: {
        kind: 'revision_commit',
        bundle: input.bundle
      }
    }
  }
}
