import { BOOK_PROGRESS_COLLECTIONS, buildBookProgress } from '../../services/BookProgressService'
import { loadAgentBookProjection } from './agentBookProjection'
import type { AgentToolCallResult } from './agentToolTypes'

export async function readAgentBookProgress(args: Record<string, unknown>): Promise<AgentToolCallResult> {
  const numericOption = (key: string) => {
    const v = args[key]
    if (v === undefined) return undefined
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < (key === 'offset' ? 0 : 1) || (key === 'limit' && v > 200)) {
      throw new Error(`Invalid ${key}.`)
    }
    return v
  }
  if (args.issuesOnly !== undefined && typeof args.issuesOnly !== 'boolean') throw new Error('Invalid issuesOnly.')
  const options = { fromChapter: numericOption('fromChapter'), toChapter: numericOption('toChapter'),
    offset: numericOption('offset'), limit: numericOption('limit'), issuesOnly: args.issuesOnly }
  const { data, projectId, storage } = await loadAgentBookProjection(args, BOOK_PROGRESS_COLLECTIONS)
  return { tool: 'agent.getBookProgress', ok: true, storage, data: buildBookProgress(data, projectId, options) }
}
