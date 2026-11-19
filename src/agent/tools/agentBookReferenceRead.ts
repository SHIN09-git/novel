import { redactSensitiveText } from '../../shared/errorUtils'
import type { StageSummary, StoryBible } from '../../shared/types'
import { STORY_BIBLE_FIELDS } from '../../services/BookReferenceEditService'
import { compact } from '../agentReadableText'
import { loadAgentBookProjection } from './agentBookProjection'
import { readOptions, requiredString } from './agentToolArguments'
import type { AgentToolCallResult, AgentToolDefinition, JsonSchema } from './agentToolTypes'

const storyBibleTool = 'agent.getStoryBible'
const stageSummariesTool = 'agent.getStageSummaries'
const defaultPageSize = 10
const maxPageSize = 50
const previewLength = 180

const identifier = { type: 'string', minLength: 1 }
const positiveInteger = { type: 'integer', minimum: 1 }
const commonProperties = {
  projectId: identifier, project: identifier, storagePath: identifier, userDataPath: identifier,
  detail: { type: 'string', enum: ['summary', 'compact', 'full'], default: 'compact' }
}
const stageProperties = {
  summaryId: identifier,
  fromChapter: { ...positiveInteger, description: 'First chapter of the requested inclusive range. Include overlapping summaries.' },
  toChapter: { ...positiveInteger, description: 'Last chapter of the requested inclusive range.' },
  limit: { ...positiveInteger, maximum: maxPageSize, default: defaultPageSize },
  offset: { type: 'integer', minimum: 0, default: 0 }
}
function schema(properties: JsonSchema = {}): JsonSchema {
  return {
    type: 'object', additionalProperties: false, properties: { ...commonProperties, ...properties },
    anyOf: [{ required: ['projectId'] }, { required: ['project'] }]
  }
}

export const AGENT_BOOK_REFERENCE_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: storyBibleTool, riskLevel: 'read', annotations: { readOnlyHint: true },
    description: 'Read the saved Story Bible. Compact gives populated fields and short excerpts; detail=full returns all saved Bible fields, without prompt compression.',
    inputSchema: schema()
  },
  {
    name: stageSummariesTool, riskLevel: 'read', annotations: { readOnlyHint: true },
    description: 'List saved stage summaries, newest chapter range first. Filter by overlapping chapter range or exact summaryId. Set detail=full for complete saved fields, including legacy notes.',
    inputSchema: schema(stageProperties)
  }
]

function parseRead(args: Record<string, unknown>, allowed: JsonSchema = {}): boolean {
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(commonProperties, key) && !Object.hasOwn(allowed, key)) {
      throw new Error(`Unsupported book reference argument: ${key}.`)
    }
  }
  for (const key of ['projectId', 'project', 'storagePath', 'userDataPath']) {
    if (args[key] !== undefined) requiredString(args, key)
  }
  return readOptions(args).detail === 'full'
}

function optionalInteger(args: Record<string, unknown>, key: string, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${key}.`)
  }
  return value
}

function safeText(value: unknown, apiKey: string): string {
  return typeof value === 'string' ? redactSensitiveText(value, [apiKey]) : ''
}

function fullStageSummary(summary: StageSummary, apiKey: string) {
  return Object.fromEntries(Object.entries(summary).map(([key, value]) =>
    [key, typeof value === 'string' ? safeText(value, apiKey) : value]))
}

export async function readAgentStoryBible(args: Record<string, unknown>): Promise<AgentToolCallResult> {
  const full = parseRead(args)
  const { data, projectId, storage } = await loadAgentBookProjection(args, ['projects', 'storyBibles'])
  const saved = data.storyBibles.find(item => item?.projectId === projectId)
  // Older imports may lack fields or have extra properties that the editor does not use.
  const field = (key: keyof StoryBible) => safeText(saved?.[key], data.settings.apiKey)
  const metadata = { projectId, updatedAt: field('updatedAt') }
  // Full reads retain saved whitespace; only excerpts are shortened and flattened.
  const bible = !saved ? null : full ? {
    ...metadata, ...Object.fromEntries(STORY_BIBLE_FIELDS.map(key => [key, field(key)]))
  } : {
    ...metadata, populatedFields: STORY_BIBLE_FIELDS.filter(key => typeof saved[key] === 'string' && saved[key].trim()),
    corePremise: compact(field('corePremise'), previewLength), immutableFacts: compact(field('immutableFacts'), previewLength)
  }
  return { tool: storyBibleTool, ok: true, storage, data: {
    projectId, bible, ...(saved && !full ? { fullRead: { tool: storyBibleTool, arguments: { projectId, detail: 'full' } } } : {})
  } }
}

export async function readAgentStageSummaries(args: Record<string, unknown>): Promise<AgentToolCallResult> {
  const full = parseRead(args, stageProperties)
  const summaryId = args.summaryId === undefined ? undefined : requiredString(args, 'summaryId')
  const from = optionalInteger(args, 'fromChapter')
  const to = optionalInteger(args, 'toChapter')
  if (from !== undefined && to !== undefined && from > to) throw new Error('fromChapter must not exceed toChapter.')
  const offset = optionalInteger(args, 'offset', 0) ?? 0
  const limit = optionalInteger(args, 'limit', 1, maxPageSize) ?? defaultPageSize
  const { data, projectId, storage } = await loadAgentBookProjection(args, ['projects', 'stageSummaries'])
  const matches = data.stageSummaries.filter(item => item.projectId === projectId &&
    (summaryId === undefined || item.id === summaryId) &&
    (from === undefined || item.chapterEnd >= from) && (to === undefined || item.chapterStart <= to))
    .sort((a, b) => b.chapterEnd - a.chapterEnd || b.chapterStart - a.chapterStart || a.id.localeCompare(b.id))
  const summaries = matches.slice(offset, offset + limit).map(item => {
    if (full) return fullStageSummary(item, data.settings.apiKey)
    const { id, chapterStart, chapterEnd, updatedAt } = item
    return {
      id, chapterStart, chapterEnd, updatedAt,
      excerpt: compact(safeText(item.compressedPlotSummary ?? item.plotProgress, data.settings.apiKey), previewLength),
      fullRead: { tool: stageSummariesTool, arguments: { projectId, summaryId: id, detail: 'full' } }
    }
  })
  return { tool: stageSummariesTool, ok: true, storage, data: {
    projectId, summaries, total: matches.length, offset, limit, nextOffset: offset + limit < matches.length ? offset + limit : null
  } }
}
