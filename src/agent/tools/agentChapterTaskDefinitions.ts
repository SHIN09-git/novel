import type { AgentToolDefinition, JsonSchema } from './agentToolTypes'

const string = { type: 'string', minLength: 1 }
const nullableString = { type: ['string', 'null'], minLength: 1 }
const project = { projectId: string, project: string }
const source = {
  chapterOrder: { type: 'integer', minimum: 1 },
  sourceJobId: nullableString,
  sourceUpdatedAt: string,
  sourceSnapshotId: nullableString,
  sourceSnapshotUpdatedAt: string
}
const task: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Complete replacement chapter task, as used by the UI task editor.',
  properties: Object.fromEntries([
    'goal', 'conflict', 'suspenseToKeep', 'allowedPayoffs', 'forbiddenPayoffs',
    'endingHook', 'readerEmotion', 'targetWordCount', 'styleRequirement'
  ].map((field) => [field, { type: 'string' }])),
  required: [
    'goal', 'conflict', 'suspenseToKeep', 'allowedPayoffs', 'forbiddenPayoffs',
    'endingHook', 'readerEmotion', 'targetWordCount', 'styleRequirement'
  ]
}
const edit = {
  ...project,
  ...source,
  agentRunId: string,
  operationId: { ...string, description: 'Stable ID for this exact edit; reuse it on retry.' },
  reason: string,
  task,
  budgetMode: { type: 'string', enum: ['light', 'standard', 'full', 'custom'] },
  budgetMaxTokens: { type: 'integer', minimum: 1000 },
  pipelineMode: { type: 'string', enum: ['conservative', 'standard', 'aggressive'] },
  refreshContext: {
    type: 'boolean',
    description: 'Explicitly build from current project facts. Required when editing a manual prompt snapshot.'
  }
}

function schema(properties: JsonSchema, required: string[] = []): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      storagePath: { type: 'string', description: 'Optional SQLite or JSON storage path.' },
      userDataPath: { type: 'string', description: 'Optional Electron userData directory.' },
      ...properties
    },
    required
  }
}

export const AGENT_CHAPTER_TASK_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: 'agent.getChapterTask',
    riskLevel: 'read',
    description: 'Read the complete editable chapter task and exact source references. Defaults to the latest job for chapterOrder; pass sourceJobId or sourceSnapshotId for an exact source.',
    inputSchema: schema({ ...project, ...source })
  },
  {
    name: 'agent.previewChapterTaskEdit',
    riskLevel: 'write_preview',
    description: 'Preview a chapter-task replacement through the same deterministic W06 service as the UI. Creates no records and calls no model. Returns impact, immutable operation hash, authorization action metadata and the next pipeline command.',
    inputSchema: schema(edit, [
      'agentRunId', 'operationId', 'reason', 'chapterOrder', 'task',
      'budgetMode', 'budgetMaxTokens', 'pipelineMode'
    ])
  },
  {
    name: 'agent.applyChapterTaskEdit',
    riskLevel: 'write_commit',
    description: 'Apply an exact previewed chapter-task edit under an active author-issued edit_chapter_task grant. Creates a new idle job while preserving the source run, draft and manual snapshot. This only saves deterministic context and never starts AI.',
    inputSchema: schema({
      ...edit,
      expectedPreviewHash: string,
      expectedRevision: { ...string, description: 'Storage revision returned by previewChapterTaskEdit.' }
    }, [
      'agentRunId', 'operationId', 'reason', 'chapterOrder', 'task',
      'budgetMode', 'budgetMaxTokens', 'pipelineMode', 'expectedPreviewHash', 'expectedRevision'
    ])
  }
]
