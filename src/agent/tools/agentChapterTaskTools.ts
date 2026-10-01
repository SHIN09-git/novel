import { createHash } from 'node:crypto'
import type {
  AgentDecision,
  AgentRun,
  AppData,
  ChapterGenerationJob,
  ChapterTask,
  ContextBudgetMode,
  ID,
  PipelineMode,
  PromptContextSnapshot
} from '../../shared/types'
import { AgentAuthorizationService } from '../../main/services/AgentAuthorizationService'
import { getChapterTaskForJob, prepareChapterTaskEdit, TASK_SCOPE_LABELS } from '../../services/ChapterTaskEditService'
import { stableDecisionJson } from '../../services/candidateDecisionPrimitives'
import type { AgentRuntimeData } from '../AgentRuntime'
import { saveAgentRuntimeData } from '../AgentRuntime'
import { booleanArg, findProjectId, requiredPositiveInteger, requiredString } from './agentToolArguments'
import type { AgentToolHandlerResult } from './agentToolTypes'

const TASK_FIELDS = [
  'goal', 'conflict', 'suspenseToKeep', 'allowedPayoffs', 'forbiddenPayoffs',
  'endingHook', 'readerEmotion', 'targetWordCount', 'styleRequirement'
] as const satisfies readonly (keyof ChapterTask)[]

const COMMON_FIELDS = ['storagePath', 'userDataPath', 'projectId', 'project'] as const
const SOURCE_FIELDS = ['chapterOrder', 'sourceJobId', 'sourceUpdatedAt', 'sourceSnapshotId', 'sourceSnapshotUpdatedAt'] as const
const EDIT_FIELDS = [
  ...COMMON_FIELDS, ...SOURCE_FIELDS, 'agentRunId', 'operationId', 'reason', 'task',
  'budgetMode', 'budgetMaxTokens', 'pipelineMode', 'refreshContext'
] as const

interface ChapterTaskSource {
  projectId: ID
  targetChapterOrder: number
  sourceJob: ChapterGenerationJob | null
  sourceSnapshot: PromptContextSnapshot | null
}

interface ChapterTaskEditCommand extends ChapterTaskSource {
  agentRun: AgentRun
  operationId: string
  reason: string
  task: ChapterTask
  budgetMode: ContextBudgetMode
  budgetMaxTokens: number
  pipelineMode: PipelineMode
  refreshContext: boolean
  jobId: ID
  sourceExpectedUpdatedAt: string | null
  sourceSnapshotExpectedUpdatedAt: string | null
}

function checkFields(args: Record<string, unknown>, allowed: readonly string[]): void {
  const supported = new Set(allowed)
  const unknown = Object.keys(args).filter((key) => !supported.has(key))
  if (unknown.length) throw new Error(`Unsupported chapter task fields: ${unknown.join(', ')}.`)
}

function optionalPositiveInteger(args: Record<string, unknown>, key: string): number | null {
  if (args[key] === undefined) return null
  return requiredPositiveInteger(args, key)
}

function optionalNullableString(args: Record<string, unknown>, key: string): string | null | undefined {
  if (args[key] === null) return null
  if (args[key] === undefined) return undefined
  return requiredString(args, key)
}

function latestChapterJob(data: AppData, projectId: ID, chapterOrder: number): ChapterGenerationJob | null {
  return [...data.chapterGenerationJobs]
    .filter((job) => job.projectId === projectId && job.targetChapterOrder === chapterOrder)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

function resolveSource(data: AppData, args: Record<string, unknown>, inferLatest: boolean): ChapterTaskSource {
  const projectId = findProjectId(data, args)
  const requestedOrder = optionalPositiveInteger(args, 'chapterOrder')
  const sourceJobId = optionalNullableString(args, 'sourceJobId')
  const sourceSnapshotId = optionalNullableString(args, 'sourceSnapshotId')
  if (sourceJobId && sourceSnapshotId) throw new Error('Use sourceJobId or sourceSnapshotId, not both.')

  let sourceJob: ChapterGenerationJob | null = null
  if (sourceJobId) {
    sourceJob = data.chapterGenerationJobs.find((job) => job.id === sourceJobId && job.projectId === projectId) ?? null
    if (!sourceJob) throw new Error(`Chapter task source job not found in project: ${sourceJobId}`)
  } else if (inferLatest && sourceJobId === undefined && sourceSnapshotId === undefined && requestedOrder) {
    sourceJob = latestChapterJob(data, projectId, requestedOrder)
  }

  const sourceSnapshot = sourceSnapshotId
    ? data.promptContextSnapshots.find((snapshot) => snapshot.id === sourceSnapshotId && snapshot.projectId === projectId) ?? null
    : null
  if (sourceSnapshotId && !sourceSnapshot) throw new Error(`Chapter task source snapshot not found in project: ${sourceSnapshotId}`)

  const targetChapterOrder = sourceJob?.targetChapterOrder ?? sourceSnapshot?.targetChapterOrder ?? requestedOrder
  if (!targetChapterOrder) throw new Error('Missing chapterOrder when no source job or snapshot determines it.')
  if (requestedOrder && requestedOrder !== targetChapterOrder) throw new Error('chapterOrder does not match the selected task source.')
  return { projectId, targetChapterOrder, sourceJob, sourceSnapshot }
}

function completeTaskArg(args: Record<string, unknown>): ChapterTask {
  const value = args.task
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('task must be a complete chapter task object.')
  const raw = value as Record<string, unknown>
  const unknown = Object.keys(raw).filter((field) => !(TASK_FIELDS as readonly string[]).includes(field))
  if (unknown.length) throw new Error(`task contains unsupported fields: ${unknown.join(', ')}.`)
  const missing = TASK_FIELDS.filter((field) => typeof raw[field] !== 'string')
  if (missing.length) throw new Error(`task must include text fields: ${missing.join(', ')}.`)
  const task = Object.fromEntries(TASK_FIELDS.map((field) => [field, raw[field]])) as unknown as ChapterTask
  if (!task.goal.trim()) throw new Error('task.goal is required.')
  if (!task.targetWordCount.trim()) throw new Error('task.targetWordCount is required.')
  return task
}

function budgetModeArg(args: Record<string, unknown>): ContextBudgetMode {
  const value = requiredString(args, 'budgetMode')
  if (value !== 'light' && value !== 'standard' && value !== 'full' && value !== 'custom') {
    throw new Error('budgetMode must be light, standard, full, or custom.')
  }
  return value
}

function budgetMaxTokensArg(args: Record<string, unknown>): number {
  const value = args.budgetMaxTokens
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1000) {
    throw new Error('budgetMaxTokens must be an integer of at least 1000.')
  }
  return value
}

function pipelineModeArg(args: Record<string, unknown>): PipelineMode {
  const value = requiredString(args, 'pipelineMode')
  if (value !== 'conservative' && value !== 'standard' && value !== 'aggressive') {
    throw new Error('pipelineMode must be conservative, standard, or aggressive.')
  }
  return value
}

function operationEntityId(prefix: string, projectId: ID, operationId: string): ID {
  const digest = createHash('sha256').update(`${projectId}\0${operationId}`).digest('hex').slice(0, 24)
  return `${prefix}-${digest}`
}

function resolveCommand(data: AppData, args: Record<string, unknown>): ChapterTaskEditCommand {
  const source = resolveSource(data, args, false)
  const agentRunId = requiredString(args, 'agentRunId')
  const agentRun = data.agentRuns.find((run) => run.id === agentRunId && run.projectId === source.projectId)
  if (!agentRun) throw new Error(`AgentRun does not belong to project: ${agentRunId}`)
  const operationId = requiredString(args, 'operationId')
  return {
    ...source,
    agentRun,
    operationId,
    reason: requiredString(args, 'reason'),
    task: completeTaskArg(args),
    budgetMode: budgetModeArg(args),
    budgetMaxTokens: budgetMaxTokensArg(args),
    pipelineMode: pipelineModeArg(args),
    refreshContext: booleanArg(args, 'refreshContext'),
    jobId: operationEntityId('agent-task-edit', source.projectId, operationId),
    sourceExpectedUpdatedAt: source.sourceJob ? requiredString(args, 'sourceUpdatedAt') : null,
    sourceSnapshotExpectedUpdatedAt: source.sourceSnapshot ? requiredString(args, 'sourceSnapshotUpdatedAt') : null
  }
}

function validateSourceVersions(command: ChapterTaskEditCommand, args: Record<string, unknown>): void {
  if (command.sourceJob) {
    if (command.sourceExpectedUpdatedAt !== command.sourceJob.updatedAt) throw new Error('The source chapter task changed; read it again before previewing.')
  }
  if (command.sourceSnapshot) {
    if (command.sourceSnapshotExpectedUpdatedAt !== command.sourceSnapshot.updatedAt) throw new Error('The source prompt snapshot changed; read it again before previewing.')
  }
}

function editRequest(command: ChapterTaskEditCommand) {
  return {
    projectId: command.projectId,
    sourceJobId: command.sourceJob?.id ?? null,
    sourceUpdatedAt: command.sourceExpectedUpdatedAt ?? undefined,
    sourceSnapshotId: command.sourceSnapshot?.id ?? null,
    targetChapterOrder: command.targetChapterOrder,
    task: command.task,
    jobId: command.jobId,
    createdAt: new Date().toISOString(),
    budgetMode: command.budgetMode,
    budgetMaxTokens: command.budgetMaxTokens,
    pipelineMode: command.pipelineMode,
    refreshContext: command.refreshContext
  }
}

function authorizationRequirements(command: ChapterTaskEditCommand) {
  return {
    evaluatedByTool: false,
    currentAction: 'edit_chapter_task',
    scope: {
      projectId: command.projectId,
      chapterOrder: command.targetChapterOrder,
      actions: ['edit_chapter_task'],
      operationId: command.operationId
    },
    writesProjectData: true,
    invokesAI: false,
    nextCommand: {
      action: 'run_chapter_pipeline',
      coveredByThisCheck: false,
      invokesAI: true
    }
  }
}

function nextExecution(command: ChapterTaskEditCommand, job: ChapterGenerationJob) {
  return {
    ready: job.status === 'idle',
    tool: 'agent.retryChapterPipeline',
    startsAI: true,
    fromStep: job.taskEdit?.resumeStep ?? job.currentStep,
    arguments: {
      agentRunId: command.agentRun.id,
      jobId: job.id,
      pipelineMode: job.pipelineMode ?? command.pipelineMode,
      estimatedWordCount: job.chapterTaskSnapshot?.targetWordCount ?? command.task.targetWordCount,
      readerEmotionTarget: job.chapterTaskSnapshot?.readerEmotion ?? command.task.readerEmotion,
      budgetMaxTokens: command.budgetMaxTokens
    }
  }
}

function previewFingerprint(command: ChapterTaskEditCommand, impact: ChapterGenerationJob['taskEdit']): string {
  const value = {
    schemaVersion: 1,
    projectId: command.projectId,
    agentRunId: command.agentRun.id,
    operationId: command.operationId,
    reason: command.reason,
    targetChapterOrder: command.targetChapterOrder,
    sourceJobId: command.sourceJob?.id ?? null,
    sourceUpdatedAt: command.sourceExpectedUpdatedAt,
    sourceSnapshotId: command.sourceSnapshot?.id ?? null,
    sourceSnapshotUpdatedAt: command.sourceSnapshotExpectedUpdatedAt,
    task: command.task,
    budgetMode: command.budgetMode,
    budgetMaxTokens: command.budgetMaxTokens,
    pipelineMode: command.pipelineMode,
    refreshContext: command.refreshContext,
    impact
  }
  return createHash('sha256').update(stableDecisionJson(value)).digest('hex')
}

function sourcePayload(source: ChapterTaskSource) {
  const jobSnapshot = source.sourceJob?.contextSource === 'prompt_snapshot'
    ? source.sourceJob.promptContextSnapshotId ?? null
    : null
  return {
    kind: source.sourceJob ? 'job' : source.sourceSnapshot ? 'prompt_snapshot' : 'derived',
    jobId: source.sourceJob?.id ?? null,
    jobUpdatedAt: source.sourceJob?.updatedAt ?? null,
    jobStatus: source.sourceJob?.status ?? null,
    promptSnapshotId: source.sourceSnapshot?.id ?? jobSnapshot,
    promptSnapshotUpdatedAt: source.sourceSnapshot?.updatedAt ?? null,
    contextSource: source.sourceJob?.contextSource ?? (source.sourceSnapshot ? 'prompt_snapshot' : 'auto'),
    manualSnapshotRequiresRefresh: Boolean(source.sourceSnapshot || jobSnapshot)
  }
}

function taskForSource(data: AppData, source: ChapterTaskSource, wordCount: string, emotion: string): ChapterTask {
  if (source.sourceSnapshot) return { ...source.sourceSnapshot.chapterTask }
  return getChapterTaskForJob(
    data,
    source.projectId,
    source.sourceJob,
    source.targetChapterOrder,
    wordCount,
    emotion
  )
}

export function getAgentChapterTask(data: AppData, args: Record<string, unknown>) {
  checkFields(args, [...COMMON_FIELDS, ...SOURCE_FIELDS])
  const source = resolveSource(data, args, true)
  const project = data.projects.find((item) => item.id === source.projectId)!
  const task = taskForSource(data, source, '3000-5000', project.coreAppeal)
  return {
    projectId: source.projectId,
    chapterOrder: source.targetChapterOrder,
    task,
    editableFields: TASK_FIELDS,
    source: sourcePayload(source),
    editReference: {
      chapterOrder: source.targetChapterOrder,
      sourceJobId: source.sourceJob?.id ?? null,
      sourceUpdatedAt: source.sourceJob?.updatedAt ?? null,
      sourceSnapshotId: source.sourceSnapshot?.id ?? null,
      sourceSnapshotUpdatedAt: source.sourceSnapshot?.updatedAt ?? null
    },
    canCreateNewJob: source.sourceJob?.status !== 'running',
    behavior: {
      savesAsNewJob: true,
      preservesSourceRun: true,
      invokesAI: false
    }
  }
}

export async function previewAgentChapterTaskEdit(data: AppData, args: Record<string, unknown>) {
  checkFields(args, EDIT_FIELDS)
  const command = resolveCommand(data, args)
  validateSourceVersions(command, args)
  const prepared = await prepareChapterTaskEdit(data, editRequest(command))
  const previewHash = previewFingerprint(command, prepared.impact)
  return {
    previewHash,
    operationId: command.operationId,
    projectId: command.projectId,
    chapterOrder: command.targetChapterOrder,
    source: sourcePayload(command),
    before: taskForSource(data, command, command.task.targetWordCount, command.task.readerEmotion),
    after: command.task,
    newJobId: prepared.job.id,
    impact: {
      ...prepared.impact,
      label: TASK_SCOPE_LABELS[prepared.impact.scope]
    },
    persisted: false,
    invokesAI: false,
    authorization: authorizationRequirements(command),
    nextExecution: nextExecution(command, prepared.job)
  }
}

function attachJobToAgentRun(
  data: AppData,
  command: ChapterTaskEditCommand,
  job: ChapterGenerationJob,
  timestamp: string,
  authorizationGrantId: string
): AppData {
  const decision: AgentDecision = {
    id: operationEntityId('agent-task-edit-decision', command.projectId, command.operationId),
    agentRunId: command.agentRun.id,
    projectId: command.projectId,
    chapterId: data.chapters.find((chapter) => chapter.projectId === command.projectId && chapter.order === command.targetChapterOrder)?.id ?? null,
    jobId: job.id,
    step: 'edit_chapter_task',
    action: 'run_pipeline',
    reason: command.reason,
    evidence: [
      `operationId=${command.operationId}`,
      `sourceJobId=${command.sourceJob?.id ?? 'none'}`,
      `newJobId=${job.id}`,
      `resumeStep=${job.taskEdit?.resumeStep ?? job.currentStep ?? 'unknown'}`,
      `authorizationGrantId=${authorizationGrantId}`
    ],
    riskLevel: 'low',
    result: 'applied',
    createdAt: timestamp
  }
  const run: AgentRun = {
    ...command.agentRun,
    status: command.agentRun.status === 'running' ? 'running' : 'paused',
    targetChapterOrders: [...new Set([...command.agentRun.targetChapterOrders, command.targetChapterOrder])].sort((a, b) => a - b),
    createdJobIds: [...new Set([...command.agentRun.createdJobIds, job.id])],
    decisions: [...command.agentRun.decisions.filter((item) => item.id !== decision.id), decision],
    summary: `Chapter ${command.targetChapterOrder} task edit is saved as job ${job.id}; pipeline execution has not started.`,
    updatedAt: timestamp,
    completedAt: null
  }
  return { ...data, agentRuns: data.agentRuns.map((item) => item.id === run.id ? run : item) }
}

export async function applyAgentChapterTaskEdit(
  data: AppData,
  args: Record<string, unknown>,
  runtime: AgentRuntimeData
) {
  checkFields(args, [...EDIT_FIELDS, 'expectedPreviewHash', 'expectedRevision'])
  const command = resolveCommand(data, args)
  const existing = data.chapterGenerationJobs.find((job) => job.id === command.jobId) ?? null
  if (!existing) {
    if (requiredString(args, 'expectedRevision') !== runtime.revision) {
      throw new Error('Storage changed after the task preview; preview the edit again before applying.')
    }
    validateSourceVersions(command, args)
  }

  if (existing) {
    const prepared = await prepareChapterTaskEdit(data, editRequest(command))
    const previewHash = previewFingerprint(command, prepared.impact)
    if (requiredString(args, 'expectedPreviewHash') !== previewHash) {
      throw new Error('Chapter task preview does not match this edit; preview it again before applying.')
    }
    if (!command.agentRun.createdJobIds.includes(existing.id)) {
      throw new Error('The operation job already exists but is not owned by this AgentRun.')
    }
    return {
      replayed: true,
      previewHash,
      operationId: command.operationId,
      projectId: command.projectId,
      chapterOrder: command.targetChapterOrder,
      job: existing,
      impact: { ...existing.taskEdit, label: existing.taskEdit ? TASK_SCOPE_LABELS[existing.taskEdit.scope] : null },
      saved: null,
      invokesAI: false,
      authorization: authorizationRequirements(command),
      nextExecution: nextExecution(command, existing)
    }
  }

  if (!runtime.storagePath) throw new Error('No writable project storage is available.')
  return new AgentAuthorizationService(runtime.userDataPath).withAuthorization({
    storagePath: runtime.storagePath,
    projectId: command.projectId,
    chapterOrder: command.targetChapterOrder,
    actions: ['edit_chapter_task']
  }, async (grant) => {
    const prepared = await prepareChapterTaskEdit(data, editRequest(command))
    const previewHash = previewFingerprint(command, prepared.impact)
    if (requiredString(args, 'expectedPreviewHash') !== previewHash) {
      throw new Error('Chapter task preview does not match this edit; preview it again before applying.')
    }
    const timestamp = prepared.job.createdAt
    const nextData = attachJobToAgentRun(prepared.data, command, prepared.job, timestamp, grant.id)
    const saved = await saveAgentRuntimeData(nextData, runtime)
    return {
      replayed: false,
      previewHash,
      operationId: command.operationId,
      projectId: command.projectId,
      chapterOrder: command.targetChapterOrder,
      job: prepared.job,
      impact: { ...prepared.impact, label: TASK_SCOPE_LABELS[prepared.impact.scope] },
      authorizationGrantId: grant.id,
      saved,
      invokesAI: false,
      authorization: { ...authorizationRequirements(command), evaluatedByTool: true },
      nextExecution: nextExecution(command, prepared.job)
    }
  })
}

export function handleAgentChapterTaskReadTool(
  name: string,
  args: Record<string, unknown>,
  data: AppData
): AgentToolHandlerResult {
  if (name !== 'agent.getChapterTask') return { handled: false }
  return { handled: true, payload: getAgentChapterTask(data, args) }
}

export async function handleAgentChapterTaskWriteTool(
  name: string,
  args: Record<string, unknown>,
  data: AppData,
  runtime: AgentRuntimeData
): Promise<AgentToolHandlerResult> {
  if (name === 'agent.previewChapterTaskEdit') {
    return { handled: true, payload: await previewAgentChapterTaskEdit(data, args) }
  }
  if (name === 'agent.applyChapterTaskEdit') {
    return { handled: true, payload: await applyAgentChapterTaskEdit(data, args, runtime) }
  }
  return { handled: false }
}
