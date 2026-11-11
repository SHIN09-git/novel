import { loadAgentBookProjection } from './agentBookProjection'
import { loadSqliteUsageHistoryReadonly } from '../../storage/SqliteStorageService'
import { reportFromHistory } from '../../storage/readProjectUsage'
import { projectUsageHistory } from '../../services/projectUsageHistory'
import type { AgentToolCallResult } from './agentToolTypes'
import type { ApiProvider } from '../../shared/types/base'
import { modelRateOrigin } from '../../shared/projectUsagePricing'
import { estimateProjectUsage } from '../../services/ProjectUsagePricing'

export async function readAgentProjectUsage(args: Record<string, unknown>): Promise<AgentToolCallResult> {
  const { data, projectId, storage } = await loadAgentBookProjection(args, ['projects'])
  if (!storage.storagePath) throw new Error('未找到项目书库。')
  const h = storage.source === 'sqlite' ? loadSqliteUsageHistoryReadonly(storage.storagePath, projectId) :
    { history: projectUsageHistory(data, projectId), revision:storage.revision }
  return { tool:'agent.getProjectUsage', ok:true, storage:{ ...storage, revision:h.revision },
    data:await reportFromHistory(storage.storagePath, h.history) }
}

export async function estimateAgentProjectUsage(args: Record<string, unknown>): Promise<AgentToolCallResult> {
  const { provider, model, endpoint, inputTokens, maxOutputTokens, snapshotId } = args
  if (typeof provider !== 'string' || !['openai','compatible','local','codex_cli'].includes(provider) || typeof model !== 'string' || !model.trim() ||
    (provider !== 'codex_cli' && !modelRateOrigin(endpoint))) throw new Error('请指定供应商、模型和有效的服务地址。')
  if ((inputTokens !== undefined && (typeof inputTokens !== 'number' || !Number.isSafeInteger(inputTokens) || inputTokens < 0)) ||
    (maxOutputTokens !== undefined && (typeof maxOutputTokens !== 'number' || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)) ||
    (snapshotId !== undefined && (typeof snapshotId !== 'string' || !snapshotId.trim() || inputTokens !== undefined))) {
    throw new Error('请给出有效的 token 数；输入计数和快照只能选一个。')
  }
  const { data, projectId, storage } = await loadAgentBookProjection(args, snapshotId ? ['projects','promptContextSnapshots'] : ['projects'])
  const snap = snapshotId && data.promptContextSnapshots.find(s => s.id === snapshotId && s.projectId === projectId)
  if (snapshotId && !snap) throw new Error('本项目中找不到指定的 Prompt 快照。')
  const result = estimateProjectUsage({ provider:provider as ApiProvider, endpoint:typeof endpoint === 'string' ? endpoint : '', model,
    messages:snap ? [{ content:snap.finalPrompt }] : null, countedInputTokens:inputTokens, maxTokens:maxOutputTokens ?? null,
    rates:data.projects.find(p => p.id === projectId)?.modelRates })
  return { tool:'agent.estimateProjectUsage', ok:true, storage, data:{ projectId, ...result,
    inputBasis:snap ? 'snapshot_only' : inputTokens !== undefined ? 'caller_count' : 'unknown' } }
}
