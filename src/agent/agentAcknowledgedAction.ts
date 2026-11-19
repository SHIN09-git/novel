import { AgentAuthorizationService } from '../main/services/AgentAuthorizationService'
import type { AgentGrantAction, AgentWriteGrant } from '../shared/types/agentAuthorization'
import type { AgentRuntimeData } from './AgentRuntime'

/** Ordinary explicit Agent acknowledgements remain compatible; elevated writes need a real author grant. */
export async function withAgentActionAcknowledgement<T>(input: {
  runtime: AgentRuntimeData
  projectId: string
  chapterOrder?: number
  chapterOrders?: number[]
  action: AgentGrantAction
  confirmed: boolean
  requiresGrant?: boolean
}, write: (grant: AgentWriteGrant | null, reviewedCommitsRequired: boolean) => Promise<T>): Promise<T> {
  if (!input.runtime.storagePath) throw new Error('没有可写入的数据源。')
  return new AgentAuthorizationService(input.runtime.userDataPath).withCommitAuthority({
    storagePath: input.runtime.storagePath, projectId: input.projectId,
    chapterOrder: input.chapterOrder, chapterOrders: input.chapterOrders, actions: [input.action]
  }, input.confirmed && !input.requiresGrant, write)
}
