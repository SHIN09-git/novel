import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { decisionFingerprint } from '../../services/candidateDecisionPrimitives'
import { isChapterArchived } from '../../services/ChapterLifecycleService'
import type { AgentRun } from '../../shared/types'
import { saveAgentRuntimeData, type AgentRuntimeData } from '../AgentRuntime'
import { findProjectId, requiredString } from '../tools/agentToolArguments'
import { checkRevisionFields, revisionCommonFields } from './agentRevisionModel'

export async function startAgentBookRevisionBatch(runtime: AgentRuntimeData, args: Record<string, unknown>) {
  checkRevisionFields(args, [...revisionCommonFields, 'operationId', 'goal', 'chapterIds', 'stageNeighbors'])
  if (args.stageNeighbors !== undefined && typeof args.stageNeighbors !== 'boolean') throw new Error('stageNeighbors 必须为布尔值。')
  const { data, storagePath, userDataPath } = runtime
  if (!storagePath) throw new Error('没有可写入的书库。')
  const projectId = findProjectId(data, args)
  const operationId = requiredString(args, 'operationId')
  const goal = requiredString(args, 'goal')
  const ids = args.chapterIds
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error('chapterIds 需为本书不重复的章节 ID 列表。')
  }
  const chapters = ids.map(id => {
    const chapter = data.chapters.find(item => item.id === id && item.projectId === projectId && !isChapterArchived(item))
    if (!chapter || !chapter.body.trim()) throw new Error(`没有可修订的正式章节：${id}。`)
    return chapter
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const id = `agent-book-revision-${decisionFingerprint([projectId, operationId])}`
  const chapterIds = chapters.map(chapter => chapter.id)
  const chapterOrders = chapters.map(chapter => chapter.order)
  return new AgentAuthorizationService(userDataPath).withAuthorization({
    storagePath, projectId, actions: ['apply_revision'], chapterOrders
  }, async grant => {
    const existing = data.agentRuns.find(item => item.id === id)
    if (existing) {
      if (existing.projectId !== projectId || existing.mode !== 'book_revision' || existing.goal !== goal || !!existing.stageNeighbors !== (args.stageNeighbors === true) ||
        decisionFingerprint(existing.revisionChapterIds) !== decisionFingerprint(chapterIds)) throw new Error('该批次操作编号已用于其他目标。')
      return { projectId, agentRunId: id, replayed: true }
    }
    const now = new Date().toISOString()
    const run: AgentRun = { id, projectId, goal, mode: 'book_revision', safetyMode: 'autonomous', targetChapterOrders: chapterOrders,
      revisionChapterIds: chapterIds, ...(args.stageNeighbors === true ? { stageNeighbors: true } : {}),
      status: 'paused', createdJobIds: [], createdDraftIds: [], createdCommitIds: [],
      pendingHumanReviewItemIds: [], warnings: [], summary: '逐章审稿、通过门禁并提交修订。', startedAt: now, updatedAt: now,
      schemaVersion: 1, completedAt: null,
      decisions: [{ id: `${id}-start`, agentRunId: id, projectId, step: 'start_book_revision_batch', action: 'revise_draft',
        reason: goal, evidence: [`authorizationGrantId=${grant.id}`], riskLevel: 'low', result: 'applied', createdAt: now }] }
    const saved = await saveAgentRuntimeData({ ...data, agentRuns: [...data.agentRuns, run] }, runtime)
    return { projectId, agentRunId: id, saved, replayed: false }
  })
}
