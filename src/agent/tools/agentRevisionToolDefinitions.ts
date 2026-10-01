import { revisionTypeOptions } from '../../renderer/src/views/revision/revisionTypeCatalog'
import type { AgentToolDefinition, JsonSchema } from './agentToolTypes'

const string = { type: 'string', minLength: 1 }
const common = { storagePath: string, userDataPath: string, projectId: string, project: string }
const reading = { detail: { type: 'string', enum: ['summary', 'compact', 'full'] }, maxChars: { type: 'integer', minimum: 1 } }
const write = { agentRunId: string, operationId: { ...string, description: 'Stable ID for this exact command; reuse on retry.' }, reason: string }
const hashes = { expectedSourceHash: string, expectedChapterHash: { type: ['string', 'null'], description: 'Current chapter hash, or null for an unlinked draft.' } }
const writeRequired = ['agentRunId', 'operationId', 'reason']
const hashRequired = ['expectedSourceHash', 'expectedChapterHash']
const schema = (properties: JsonSchema, required: string[]): JsonSchema => ({
  type: 'object', additionalProperties: false, properties: { ...common, ...properties }, required
})

export const AGENT_REVISION_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: 'agent.getRevisionSessions', riskLevel: 'read',
    description: 'Read project-scoped revision sessions, requests and candidates. Supply chapterId or draftId to obtain current source hashes even before creating a session. Full text requires detail=full.',
    inputSchema: schema({ ...reading, chapterId: string, draftId: string }, [])
  },
  {
    name: 'agent.getRevisionVersion', riskLevel: 'read',
    description: 'Read a revision candidate, its source binding, request hash and version hash. A saved candidate is not a formal commit.',
    inputSchema: schema({ ...reading, versionId: string }, ['versionId'])
  },
  {
    name: 'agent.createRevisionRequest', riskLevel: 'write_preview',
    description: 'Create a source-bound revision request in an existing or new revision session. Requires an existing project AgentRun. Does not generate or replace prose.',
    inputSchema: schema({ ...write, ...hashes, chapterId: string, draftId: string, sessionId: string,
      type: { type: 'string', enum: revisionTypeOptions.map((item) => item.value) }, instruction: string, targetRange: string
    }, [...writeRequired, ...hashRequired, 'instruction'])
  },
  {
    name: 'agent.generateRevisionVersion', riskLevel: 'write_preview',
    description: 'Generate a pending revision through AIService using the persisted request, rebuilt project context and the same revision-role settings as UI (frozen source job config for drafts, current global role otherwise). Never saves fallback prose or commits a chapter.',
    inputSchema: schema({ ...write, ...hashes, requestId: string, expectedRequestHash: string }, [...writeRequired, ...hashRequired, 'requestId', 'expectedRequestHash'])
  },
  {
    name: 'agent.editRevisionVersion', riskLevel: 'write_preview',
    description: 'Explicitly fork-edit a pending/draft candidate as an Agent; preserves the previous text as superseded history. Requires current candidate and source hashes. Not formal acceptance.',
    inputSchema: schema({ ...write, ...hashes, versionId: string, expectedVersionHash: string, body: string }, [...writeRequired, ...hashRequired, 'versionId', 'expectedVersionHash', 'body'])
  },
  {
    name: 'agent.previewRevisionCommit', riskLevel: 'write_preview',
    description: 'Persist an exact source/candidate-bound AgentActionPreview for any current bound candidate, including UI-created versions without Agent generation/edit history. Requires an existing chapter; no fork-edit is needed for approval. Changes no chapter/canon/memory.',
    inputSchema: schema({ ...write, ...hashes, versionId: string, expectedVersionHash: string }, [...writeRequired, ...hashRequired, 'versionId', 'expectedVersionHash'])
  },
  {
    name: 'agent.applyApprovedRevisionCommit', riskLevel: 'write_commit',
    description: 'Apply an exact revision preview through RevisionCommitBundle storage with revisedBy=agent and Agent provenance; chapter version source is agent_revision. Use ordinary confirm=true acknowledgement or an active apply_revision grant. Previews requiring human authorization always need the grant; confirm is not authority. Retries recover the same commit without rolling back later prose. No automatic canon updates.',
    inputSchema: schema({ agentRunId: string, previewId: string, expectedPreviewHash: string,
      confirm: { type: 'boolean' }, acceptBroaderResponse: { type: 'boolean' }
    }, ['agentRunId', 'previewId', 'expectedPreviewHash'])
  }
]
