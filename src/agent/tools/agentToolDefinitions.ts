import type { AgentToolDefinition, JsonSchema } from './agentToolTypes'
import { AGENT_REVISION_TOOL_DEFINITIONS } from './agentRevisionToolDefinitions'
import { AGENT_CANDIDATE_UNDO_DEFINITIONS } from './agentCandidateUndoDefinitions'
import { AGENT_CHAPTER_ACCEPTANCE_DEFINITIONS } from './agentChapterAcceptanceTools'
import { AGENT_CHAPTER_TASK_TOOL_DEFINITIONS } from './agentChapterTaskDefinitions'
import { AGENT_WORLD_TOOL_DEFINITIONS } from './agentWorldDefinitions'

const storageProperties = {
  storagePath: { type: 'string', description: 'Optional SQLite or JSON storage path.' },
  userDataPath: { type: 'string', description: 'Optional Electron userData directory.' }
}

function schema(properties: JsonSchema, required: string[] = []): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { ...storageProperties, ...properties },
    required
  }
}

function readInputProperties(extra: JsonSchema): JsonSchema {
  return {
    ...extra,
    detail: { type: 'string', enum: ['summary', 'compact', 'full'] },
    includeProse: { type: 'boolean' },
    includePrompt: { type: 'boolean' },
    includeDiagnostics: { type: 'boolean' },
    maxChars: { type: 'number', minimum: 1 }
  }
}

const chapterTaskSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Immutable chapter-level creative contract. This is separate from the AgentRun audit goal and is reused by retries.',
  properties: {
    goal: { type: 'string' },
    conflict: { type: 'string' },
    suspenseToKeep: { type: 'string' },
    allowedPayoffs: { type: 'string' },
    forbiddenPayoffs: { type: 'string' },
    endingHook: { type: 'string' },
    readerEmotion: { type: 'string' },
    targetWordCount: { type: 'string' },
    styleRequirement: { type: 'string' }
  },
  required: ['goal']
}

function candidateDecisionsSchema(apply: boolean): JsonSchema {
  const amendmentStringProperties = (fields: string[]): JsonSchema =>
    Object.fromEntries(fields.map((field) => [field, { type: 'string' }]))
  const amendmentStringObject = (fields: string[], required: string[] = []): JsonSchema => ({
    type: 'object', additionalProperties: false,
    properties: amendmentStringProperties(fields), required
  })
  const continuityBridgeSchema: JsonSchema = {
    type: 'object', additionalProperties: false,
    properties: amendmentStringProperties([
      'lastSceneLocation', 'lastPhysicalState', 'lastEmotionalState', 'lastUnresolvedAction',
      'lastDialogueOrThought', 'immediateNextBeat', 'mustContinueFrom', 'mustNotReset', 'openMicroTensions'
    ]),
    required: [
      'lastSceneLocation', 'lastPhysicalState', 'lastEmotionalState', 'lastUnresolvedAction',
      'lastDialogueOrThought', 'immediateNextBeat', 'mustContinueFrom', 'mustNotReset', 'openMicroTensions'
    ]
  }
  const memoryAmendmentPatchSchemas: JsonSchema[] = [
    {
      ...amendmentStringObject(['summary']),
      properties: {
        kind: { type: 'string', enum: ['chapter_review_update'] },
        summary: { type: 'string' },
        review: amendmentStringObject([
          'summary', 'newInformation', 'characterChanges', 'newForeshadowing',
          'resolvedForeshadowing', 'endingHook', 'riskWarnings'
        ]),
        continuityBridgeSuggestion: { oneOf: [{ type: 'null' }, continuityBridgeSchema] }
      }, required: ['kind']
    },
    {
      ...amendmentStringObject([]),
      properties: {
        kind: { type: 'string', enum: ['character_state_update'] },
        ...amendmentStringProperties([
          'summary', 'changeSummary', 'newCurrentEmotionalState',
          'newRelationshipWithProtagonist', 'newNextActionTendency'
        ])
      }, required: ['kind']
    },
    {
      ...amendmentStringObject(['summary']),
      properties: {
        kind: { type: 'string', enum: ['foreshadowing_create'] },
        summary: { type: 'string' },
        candidate: {
          type: 'object', additionalProperties: false,
          properties: {
            title: { type: 'string' }, description: { type: 'string' },
            suggestedWeight: { type: 'string', enum: ['low', 'medium', 'high', 'payoff'] },
            recommendedTreatmentMode: { type: 'string', enum: ['hidden', 'hint', 'advance', 'mislead', 'pause', 'payoff'] },
            expectedPayoff: { type: 'string' },
            relatedCharacterIds: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' }
          }, required: []
        }
      }, required: ['kind']
    },
    {
      ...amendmentStringObject(['summary', 'evidenceText', 'notes']),
      properties: {
        kind: { type: 'string', enum: ['foreshadowing_status_update'] },
        summary: { type: 'string' },
        suggestedStatus: { type: 'string', enum: ['unresolved', 'partial', 'resolved', 'abandoned'] },
        recommendedTreatmentMode: { type: 'string', enum: ['hidden', 'hint', 'advance', 'mislead', 'pause', 'payoff'] },
        evidenceText: { type: 'string' }, notes: { type: 'string' }
      }, required: ['kind']
    },
    {
      ...amendmentStringObject(['summary']),
      properties: {
        kind: { type: 'string', enum: ['stage_summary_create'] },
        summary: { type: 'string' },
        stageSummary: amendmentStringObject([
          'compressedPlotSummary', 'irreversibleChanges', 'endingCarryoverState',
          'emotionalAftertaste', 'pacingState'
        ])
      }, required: ['kind']
    },
    {
      ...amendmentStringObject(['summary']),
      properties: {
        kind: { type: 'string', enum: ['timeline_event_create'] },
        summary: { type: 'string' },
        event: {
          type: 'object', additionalProperties: false,
          properties: {
            title: { type: 'string' }, storyTime: { type: 'string' },
            participantCharacterIds: { type: 'array', items: { type: 'string' } },
            result: { type: 'string' }, downstreamImpact: { type: 'string' }
          }, required: []
        }
      }, required: ['kind']
    }
  ]
  const amendmentSchema: JsonSchema = {
    oneOf: [
      { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['memory'] }, patch: { oneOf: memoryAmendmentPatchSchemas } }, required: ['kind', 'patch'] },
      {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['character_state'] },
          label: { type: 'string' },
          category: { type: 'string', enum: ['resource', 'inventory', 'location', 'physical', 'mental', 'knowledge', 'relationship', 'goal', 'promise', 'secret', 'ability', 'status', 'custom'] },
          targetValue: {
            oneOf: [
              { type: 'null' }, { type: 'string' }, { type: 'number' }, { type: 'boolean' },
              { type: 'array', items: { type: 'string' } }
            ]
          },
          linkedCardFields: {
            type: 'array', items: {
              type: 'string', enum: [
                'roleFunction', 'surfaceGoal', 'deepNeed', 'coreFear', 'decisionLogic',
                'abilitiesAndResources', 'weaknessAndCost', 'relationshipTension', 'futureHooks'
              ]
            }
          }
        }, required: ['kind']
      }
    ]
  }
  return {
    type: 'array', minItems: 1, maxItems: 100,
    items: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['memory', 'character_state'] },
        candidateId: { type: 'string', minLength: 1 },
        decision: { type: 'string', enum: ['accept', 'reject'] },
        amendment: amendmentSchema,
        ...(apply ? { expectedFingerprint: { type: 'string', minLength: 1 } } : {})
      },
      required: ['kind', 'candidateId', 'decision', ...(apply ? ['expectedFingerprint'] : [])]
    }
  }
}

const candidateReadProperties = {
  projectId: { type: 'string' }, project: { type: 'string' },
  detail: { type: 'string', enum: ['summary', 'compact', 'full'], default: 'compact' },
  maxChars: { type: 'integer', minimum: 1 }
}

export const AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  ...AGENT_CHAPTER_ACCEPTANCE_DEFINITIONS,
  ...AGENT_CHAPTER_TASK_TOOL_DEFINITIONS,
  ...AGENT_WORLD_TOOL_DEFINITIONS,
  {
    name: 'agent.getProjectAuthorization', riskLevel: 'read',
    description: 'Read author-issued grants for this project and database. Only the desktop author UI can grant or revoke; imported AppData and confirm flags cannot grant authority.',
    inputSchema: schema({ projectId: { type: 'string' }, project: { type: 'string' } })
  },
  ...AGENT_REVISION_TOOL_DEFINITIONS,
  ...AGENT_CANDIDATE_UNDO_DEFINITIONS,
  {
    name: 'agent.getDecisionInbox',
    description: 'Read pending candidate event groups using the shared inbox grouping. Compact by default; no candidate is accepted.',
    riskLevel: 'read',
    inputSchema: schema({
      ...candidateReadProperties,
      chapterOrder: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      offset: { type: 'integer', minimum: 0, default: 0 }
    })
  },
  {
    name: 'agent.previewCandidateDecisions',
    description: 'Preview memory and character-state decisions with shared-kernel fingerprints and risk warnings. Read-only; compact by default.',
    riskLevel: 'read',
    inputSchema: schema({ ...candidateReadProperties, decisions: candidateDecisionsSchema(false) }, ['decisions'])
  },
  {
    name: 'agent.applyCandidateDecisions',
    description: 'Apply previewed candidate decisions atomically as an agent. High-risk acceptance requires an active author-issued accept_high_risk_candidates project grant; client flags do not grant permission. Keep operationId and command fields stable for retries.',
    riskLevel: 'write_commit',
    inputSchema: schema({
      projectId: { type: 'string' }, project: { type: 'string' },
      operationId: { type: 'string', minLength: 1 },
      decisions: candidateDecisionsSchema(true),
      reason: { type: 'string', minLength: 1 },
      agentRunId: { type: 'string' },
      decidedAt: { type: 'string', description: 'Optional fixed ISO timestamp. When omitted, an existing receipt timestamp is reused on retry.' },
      expectedRevision: { type: 'string', minLength: 1, description: 'Revision returned by the preview read. Defaults to the loaded runtime revision.' },
      confirmedHighRisk: { type: 'boolean', description: 'Legacy acknowledgement retained for exact receipt replay; cannot authorize new high-risk acceptance.' },
      confirm: { type: 'boolean' },
      approvalToken: { type: 'string', description: 'Existing orchestrator acknowledgement (at least 8 characters), not an authentication secret.' }
    }, ['operationId', 'decisions', 'reason'])
  },
  {
    name: 'agent.listProjects',
    description: 'List projects using compact metadata only.',
    riskLevel: 'read',
    inputSchema: schema({})
  },
  {
    name: 'agent.getProjectDigest',
    description: 'Read a compact project digest, latest chapters, active direction, and pending review counts.',
    riskLevel: 'read',
    inputSchema: schema({ projectId: { type: 'string' }, project: { type: 'string' } })
  },
  {
    name: 'agent.getNextChapterTarget',
    description: 'Find the next chapter order for a project.',
    riskLevel: 'read',
    inputSchema: schema({ projectId: { type: 'string' }, project: { type: 'string' } })
  },
  {
    name: 'agent.getArchivedChapters',
    description: 'List archived chapters and retained version counts for a project.',
    riskLevel: 'read',
    inputSchema: schema({ projectId: { type: 'string' }, project: { type: 'string' } })
  },
  {
    name: 'agent.getChapterProductionState',
    description: 'Read current chapter, latest job, drafts, diagnostics, version count, and pending review counts.',
    riskLevel: 'read',
    inputSchema: schema({ projectId: { type: 'string' }, project: { type: 'string' }, chapterOrder: { type: 'integer', minimum: 1 } }, ['chapterOrder'])
  },
  {
    name: 'agent.getChapterVersionChain',
    description: 'Read the version chain for a chapter.',
    riskLevel: 'read',
    inputSchema: schema({ projectId: { type: 'string' }, project: { type: 'string' }, chapterOrder: { type: 'integer', minimum: 1 } }, ['chapterOrder'])
  },
  {
    name: 'agent.getChapterText',
    description: 'Read chapter text with compact defaults. Full prose requires detail=full or includeProse=true.',
    riskLevel: 'read',
    inputSchema: schema(readInputProperties({ chapterOrder: { type: 'integer', minimum: 1 }, projectId: { type: 'string' }, project: { type: 'string' } }), ['chapterOrder'])
  },
  {
    name: 'agent.getDraftText',
    description: 'Read draft text with compact defaults. Full prose requires detail=full or includeProse=true.',
    riskLevel: 'read',
    inputSchema: schema(readInputProperties({ draftId: { type: 'string' } }), ['draftId'])
  },
  {
    name: 'agent.getPromptSnapshot',
    description: 'Read a prompt context snapshot summary or full prompt when explicitly requested.',
    riskLevel: 'read',
    inputSchema: schema(readInputProperties({ snapshotId: { type: 'string' } }), ['snapshotId'])
  },
  {
    name: 'agent.getGenerationPrompt',
    description: 'Read the generation prompt for a job with compact defaults. Full prompt requires detail=full or includePrompt=true.',
    riskLevel: 'read',
    inputSchema: schema(readInputProperties({ jobId: { type: 'string' } }), ['jobId'])
  },
  {
    name: 'agent.getVersionDetail',
    description: 'Read a chapter version body with compact defaults.',
    riskLevel: 'read',
    inputSchema: schema(readInputProperties({ projectId: { type: 'string' }, project: { type: 'string' }, chapterOrder: { type: 'integer', minimum: 1 }, versionId: { type: 'string' } }), ['chapterOrder', 'versionId'])
  },
  {
    name: 'agent.getVersionDiff',
    description: 'Read a compact diff between two chapter versions.',
    riskLevel: 'read',
    inputSchema: schema({ projectId: { type: 'string' }, project: { type: 'string' }, chapterOrder: { type: 'integer', minimum: 1 }, fromVersionId: { type: 'string' }, toVersionId: { type: 'string' }, maxChars: { type: 'integer', minimum: 1 } }, ['chapterOrder', 'fromVersionId', 'toVersionId'])
  },
  {
    name: 'agent.getRunDiagnostics',
    description: 'Read job steps, trace counters, and author summary.',
    riskLevel: 'read',
    inputSchema: schema({ jobId: { type: 'string' } }, ['jobId'])
  },
  {
    name: 'agent.inspectPipelineJob',
    description: 'Alias of agent.getRunDiagnostics for CLI/MCP parity.',
    riskLevel: 'read',
    inputSchema: schema({ jobId: { type: 'string' } }, ['jobId'])
  },
  {
    name: 'agent.getFullRunTrace',
    description: 'Read run trace with compact defaults. Full diagnostics require detail=full or includeDiagnostics=true.',
    riskLevel: 'read',
    inputSchema: schema(readInputProperties({ traceId: { type: 'string' }, jobId: { type: 'string' } }))
  },
  {
    name: 'agent.getCandidateDetail',
    description: 'Read memory or character-state candidate details.',
    riskLevel: 'read',
    inputSchema: schema(readInputProperties({ candidateId: { type: 'string' } }), ['candidateId'])
  },
  {
    name: 'agent.getPendingHumanReviewItems',
    description: 'Read pending review counts for a project.',
    riskLevel: 'read',
    inputSchema: schema({ projectId: { type: 'string' }, project: { type: 'string' } })
  },
  {
    name: 'agent.getAcceptanceRecommendation',
    description: 'Build an acceptance/revise/reject recommendation for a completed job.',
    riskLevel: 'read',
    inputSchema: schema({ jobId: { type: 'string' } }, ['jobId'])
  },
  {
    name: 'agent.startAgentRun',
    description: 'Create a single-chapter AgentRun and matching pipeline job/steps. Does not execute the AI provider.',
    riskLevel: 'write_preview',
    inputSchema: schema({ projectId: { type: 'string' }, project: { type: 'string' }, chapterOrder: { type: 'integer', minimum: 1 }, goal: { type: 'string', description: 'Run-level audit/operations goal; not the prose instruction.' }, chapterTask: chapterTaskSchema, temperature: { type: 'number', minimum: 0, maximum: 2 }, safetyMode: { type: 'string' } }, ['chapterOrder'])
  },
  {
    name: 'agent.runChapterPipeline',
    description: 'Execute one complete standard chapter workflow through context planning, generation, review, diagnostics, and quality gate. It stops before acceptance.',
    riskLevel: 'write_preview',
    inputSchema: schema({
      projectId: { type: 'string' },
      project: { type: 'string' },
      chapterOrder: { type: 'integer', minimum: 1 },
      goal: { type: 'string', description: 'Run-level audit/operations goal; not the prose instruction.' },
      chapterTask: chapterTaskSchema,
      safetyMode: { type: 'string' },
      pipelineMode: { type: 'string', enum: ['conservative', 'standard', 'aggressive'] },
      estimatedWordCount: { type: 'string' },
      readerEmotionTarget: { type: 'string' },
      temperature: { type: 'number', minimum: 0, maximum: 2 },
      budgetMaxTokens: { type: 'integer', minimum: 1000 }
    }, ['chapterOrder'])
  },
  {
    name: 'agent.retryChapterPipeline',
    description: 'Resume an existing Agent chapter job from its first failed or unfinished step. Completed earlier steps are restored, not rerun.',
    riskLevel: 'write_preview',
    inputSchema: schema({
      agentRunId: { type: 'string' },
      jobId: { type: 'string' },
      pipelineMode: { type: 'string', enum: ['conservative', 'standard', 'aggressive'] },
      estimatedWordCount: { type: 'string' },
      readerEmotionTarget: { type: 'string' },
      budgetMaxTokens: { type: 'integer', minimum: 1000 }
    }, ['agentRunId', 'jobId'])
  },
  {
    name: 'agent.getPipelineProgress',
    description: 'Read structured progress, elapsed time, cancellation state, and the recoverable step for an existing pipeline job.',
    riskLevel: 'read',
    inputSchema: schema({ jobId: { type: 'string' } }, ['jobId'])
  },
  {
    name: 'agent.cancelChapterPipeline',
    description: 'Request cancellation of a running Agent pipeline without concurrently rewriting AppData. Completed steps remain recoverable.',
    riskLevel: 'write_preview',
    inputSchema: schema({ jobId: { type: 'string' }, reason: { type: 'string' } }, ['jobId'])
  },
  {
    name: 'agent.continueAgentRun',
    description: 'Create a multi-chapter AgentRun queue while preparing only the current chapter job.',
    riskLevel: 'write_preview',
    inputSchema: schema({ projectId: { type: 'string' }, project: { type: 'string' }, startChapterOrder: { type: 'integer', minimum: 1 }, chapterCount: { type: 'integer', minimum: 1, maximum: 1000 }, goal: { type: 'string' }, safetyMode: { type: 'string' } }, ['startChapterOrder', 'chapterCount'])
  },
  {
    name: 'agent.recordAcceptanceDecision',
    description: 'Create an AgentDecision and AgentActionPreview for a job. This does not apply the commit.',
    riskLevel: 'write_preview',
    inputSchema: schema({ agentRunId: { type: 'string' }, jobId: { type: 'string' } }, ['agentRunId', 'jobId'])
  },
  {
    name: 'agent.getActionPreviews',
    description: 'List action previews for an AgentRun.',
    riskLevel: 'read',
    inputSchema: schema({ agentRunId: { type: 'string' } }, ['agentRunId'])
  },
  {
    name: 'agent.archiveChapter',
    description: 'Archive a chapter without deleting its prose, versions, commits, or diagnostics. Accepts explicit Agent acknowledgement or an active manage_chapters grant covering this chapter.',
    riskLevel: 'write_commit',
    inputSchema: schema({ projectId: { type: 'string' }, project: { type: 'string' }, chapterId: { type: 'string' }, confirm: { type: 'boolean' }, approvalToken: { type: 'string' } }, ['chapterId'])
  },
  {
    name: 'agent.restoreArchivedChapter',
    description: 'Restore an archived chapter. If its former order is occupied, it moves to the current end. Accepts explicit Agent acknowledgement or a manage_chapters grant covering both old and new orders.',
    riskLevel: 'write_commit',
    inputSchema: schema({ projectId: { type: 'string' }, project: { type: 'string' }, chapterId: { type: 'string' }, confirm: { type: 'boolean' }, approvalToken: { type: 'string' } }, ['chapterId'])
  },
  {
    name: 'agent.applyApprovedChapterCommit',
    description: 'Apply an approved chapter commit preview through the same transaction-backed commit path as the desktop app.',
    riskLevel: 'write_commit',
    inputSchema: schema({ previewId: { type: 'string' }, confirm: { type: 'boolean' }, approvalToken: { type: 'string' } }, ['previewId'])
  },
  {
    name: 'agent.getAgentRunSummary',
    description: 'Read a compact AgentRun summary.',
    riskLevel: 'read',
    inputSchema: schema({ agentRunId: { type: 'string' } }, ['agentRunId'])
  }
]
