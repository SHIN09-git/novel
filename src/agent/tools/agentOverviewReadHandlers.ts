import { loadAgentProjectOverview } from '../AgentProjectOverviewRuntime'
import { getNextChapterTarget, getProjectDigest, listProjects } from '../agentProjectSummaries'
import { findProjectId, stringArg } from './agentToolArguments'
import type { AgentToolCallResult } from './agentToolTypes'

const OVERVIEW_TOOLS = new Set([
  'agent.listProjects', 'agent.getProjectDigest',
  'agent.getNextChapterTarget', 'agent.getPendingHumanReviewItems'
])

export async function handleAgentOverviewReadTool(
  name: string, args: Record<string, unknown>
): Promise<AgentToolCallResult | null> {
  if (!OVERVIEW_TOOLS.has(name)) return null
  const runtime = await loadAgentProjectOverview({
    storagePath: stringArg(args, 'storagePath'), userDataPath: stringArg(args, 'userDataPath')
  })
  const { data, ...storage } = runtime
  const projectId = name === 'agent.listProjects' ? null : findProjectId(data, args)
  const payload = projectId === null ? listProjects(data)
    : name === 'agent.getNextChapterTarget' ? getNextChapterTarget(data, projectId)
    : name === 'agent.getPendingHumanReviewItems' ? getProjectDigest(data, projectId).pendingReview
    : getProjectDigest(data, projectId)
  return { tool: name, ok: true, storage, data: payload }
}
