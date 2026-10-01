#!/usr/bin/env node
import { AgentToolService, type AgentToolCallInput, type AgentToolCallResult } from './tools/AgentToolService'
import { buildNamedAgentToolCall } from './tools/agentCliToolCall'

interface ParsedArgs {
  command: string
  flags: Record<string, string | boolean>
}

interface CliOutput {
  ok: boolean
  command: string
  tool?: string
  storage?: AgentToolCallResult['storage']
  data?: unknown
  error?: string
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv
  const flags: Record<string, string | boolean> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = rest[index + 1]
    if (!next || next.startsWith('--')) {
      flags[key] = true
      continue
    }
    flags[key] = next
    index += 1
  }
  return { command, flags }
}

function flag(flags: ParsedArgs['flags'], key: string): string | undefined {
  const value = flags[key]
  return typeof value === 'string' ? value : undefined
}

function intFlag(flags: ParsedArgs['flags'], key: string, fallback?: number): number {
  const value = flag(flags, key)
  if (!value) {
    if (fallback !== undefined) return fallback
    throw new Error(`Missing --${key}.`)
  }
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) throw new Error(`Invalid --${key}; expected a positive integer.`)
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid --${key}; expected a positive integer.`)
  return parsed
}

function numberFlag(flags: ParsedArgs['flags'], key: string): number | undefined {
  const value = flag(flags, key)
  if (!value) return undefined
  const normalized = value.trim()
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) {
    throw new Error(`Invalid --${key}; expected a number.`)
  }
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid --${key}; expected a finite number.`)
  return parsed
}

function objectJsonFlag(flags: ParsedArgs['flags'], key: string): Record<string, unknown> | undefined {
  const raw = flag(flags, key)
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid --${key}; expected a JSON object. ${reason}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid --${key}; expected a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function baseToolArgs(flags: ParsedArgs['flags']): Record<string, unknown> {
  return {
    storagePath: flag(flags, 'storage'),
    userDataPath: flag(flags, 'user-data')
  }
}

function projectArgs(flags: ParsedArgs['flags']): Record<string, unknown> {
  return {
    projectId: flag(flags, 'project-id'),
    project: flag(flags, 'project')
  }
}

function readArgs(flags: ParsedArgs['flags']): Record<string, unknown> {
  const maxChars = flag(flags, 'max-chars')
  return {
    detail: flag(flags, 'detail'),
    includeProse: flags['include-prose'] === true,
    includePrompt: flags['include-prompt'] === true,
    includeDiagnostics: flags['include-diagnostics'] === true,
    maxChars: maxChars ? intFlag(flags, 'max-chars') : undefined
  }
}

function safetyModeArg(flags: ParsedArgs['flags']): string | undefined {
  const value = flag(flags, 'safety-mode')
  return value === 'conservative' || value === 'experimental' || value === 'autonomous' ? value : undefined
}

function printHelp(): void {
  console.log(`Novel Director Agent Runtime

Commands:
  call-tool --name <agent.toolName> --arguments-json <JSON object>
  list-projects
  project-digest --project-id <id> | --project <name-or-id>
  next-chapter-target --project-id <id> | --project <name-or-id>
  chapter-state --project-id <id> | --project <name-or-id> --chapter <order>
  chapter-text --project-id <id> | --project <name-or-id> --chapter <order> [--detail full] [--include-prose] [--max-chars <n>]
  draft-text --draft-id <id> [--detail full] [--include-prose] [--max-chars <n>]
  prompt-snapshot --snapshot-id <id> [--detail full] [--include-prompt] [--max-chars <n>]
  version-chain --project-id <id> | --project <name-or-id> --chapter <order>
  version-detail --project-id <id> | --project <name-or-id> --chapter <order> --version-id <id> [--detail full]
  version-diff --project-id <id> | --project <name-or-id> --chapter <order> --from-version-id <id> --to-version-id <id>
  generation-prompt --job-id <id> [--detail full] [--include-prompt] [--max-chars <n>]
  run-diagnostics --job-id <id>
  inspect-job --job-id <id>
  watch-job --job-id <id> [--timeout-ms <n>] [--interval-ms <n>]
  full-run-trace --trace-id <id> | --job-id <id> [--detail full] [--include-diagnostics]
  candidate-detail --candidate-id <id> [--detail full] [--include-diagnostics]
  acceptance-recommendation --job-id <id>
  record-acceptance-decision --agent-run-id <id> --job-id <id>
  action-previews --agent-run-id <id>
  apply-action-preview --preview-id <id> [--confirm]
  agent-run-summary --agent-run-id <id>
  pending-review --project-id <id> | --project <name-or-id>
  run-chapter --project-id <id> | --project <name-or-id> --chapter <order> [--goal <run-audit-text>] [--chapter-task-json <json>]
              [--safety-mode autonomous|conservative|experimental]
              [--pipeline-mode conservative|standard|aggressive] [--estimated-words <range>] [--reader-emotion <text>]
              [--temperature <0-2>] [--budget-max-tokens <n>]
  retry-chapter --agent-run-id <id> --job-id <id> [--pipeline-mode conservative|standard|aggressive]
                [--estimated-words <range>] [--reader-emotion <text>] [--budget-max-tokens <n>]
  pipeline-progress --job-id <id>
  cancel-chapter --job-id <id> [--reason <text>]
  continue --project-id <id> | --project <name-or-id> --start-chapter <order> --chapters <count> [--goal <text>] [--safety-mode autonomous|conservative|experimental]

Storage flags:
  --storage <path>      SQLite/JSON data path. Defaults to app-config or userData.
  --user-data <path>    Electron userData folder. Defaults to platform userData.
`)
}

function buildToolCall(parsed: ParsedArgs): AgentToolCallInput {
  const flags = parsed.flags
  const storage = baseToolArgs(flags)
  switch (parsed.command) {
    case 'call-tool':
      return buildNamedAgentToolCall(flags)
    case 'list-projects':
      return { name: 'agent.listProjects', arguments: storage }
    case 'project-digest':
      return { name: 'agent.getProjectDigest', arguments: { ...storage, ...projectArgs(flags) } }
    case 'next-chapter-target':
      return { name: 'agent.getNextChapterTarget', arguments: { ...storage, ...projectArgs(flags) } }
    case 'chapter-state':
      return { name: 'agent.getChapterProductionState', arguments: { ...storage, ...projectArgs(flags), chapterOrder: intFlag(flags, 'chapter') } }
    case 'chapter-text':
      return { name: 'agent.getChapterText', arguments: { ...storage, ...projectArgs(flags), chapterOrder: intFlag(flags, 'chapter'), ...readArgs(flags) } }
    case 'draft-text':
      return { name: 'agent.getDraftText', arguments: { ...storage, draftId: flag(flags, 'draft-id'), ...readArgs(flags) } }
    case 'prompt-snapshot':
      return { name: 'agent.getPromptSnapshot', arguments: { ...storage, snapshotId: flag(flags, 'snapshot-id'), ...readArgs(flags) } }
    case 'version-chain':
      return { name: 'agent.getChapterVersionChain', arguments: { ...storage, ...projectArgs(flags), chapterOrder: intFlag(flags, 'chapter') } }
    case 'version-detail':
      return { name: 'agent.getVersionDetail', arguments: { ...storage, ...projectArgs(flags), chapterOrder: intFlag(flags, 'chapter'), versionId: flag(flags, 'version-id'), ...readArgs(flags) } }
    case 'version-diff':
      return {
        name: 'agent.getVersionDiff',
        arguments: {
          ...storage,
          ...projectArgs(flags),
          chapterOrder: intFlag(flags, 'chapter'),
          fromVersionId: flag(flags, 'from-version-id'),
          toVersionId: flag(flags, 'to-version-id'),
          maxChars: readArgs(flags).maxChars
        }
      }
    case 'generation-prompt':
      return { name: 'agent.getGenerationPrompt', arguments: { ...storage, jobId: flag(flags, 'job-id'), ...readArgs(flags) } }
    case 'run-diagnostics':
      return { name: 'agent.getRunDiagnostics', arguments: { ...storage, jobId: flag(flags, 'job-id') } }
    case 'inspect-job':
      return { name: 'agent.inspectPipelineJob', arguments: { ...storage, jobId: flag(flags, 'job-id') } }
    case 'full-run-trace':
      return { name: 'agent.getFullRunTrace', arguments: { ...storage, traceId: flag(flags, 'trace-id'), jobId: flag(flags, 'job-id'), ...readArgs(flags) } }
    case 'candidate-detail':
      return { name: 'agent.getCandidateDetail', arguments: { ...storage, candidateId: flag(flags, 'candidate-id'), ...readArgs(flags) } }
    case 'acceptance-recommendation':
      return { name: 'agent.getAcceptanceRecommendation', arguments: { ...storage, jobId: flag(flags, 'job-id') } }
    case 'record-acceptance-decision':
      return { name: 'agent.recordAcceptanceDecision', arguments: { ...storage, agentRunId: flag(flags, 'agent-run-id'), jobId: flag(flags, 'job-id') } }
    case 'action-previews':
      return { name: 'agent.getActionPreviews', arguments: { ...storage, agentRunId: flag(flags, 'agent-run-id') } }
    case 'apply-action-preview':
      return { name: 'agent.applyApprovedChapterCommit', arguments: { ...storage, previewId: flag(flags, 'preview-id'), confirm: flags.confirm === true } }
    case 'agent-run-summary':
      return { name: 'agent.getAgentRunSummary', arguments: { ...storage, agentRunId: flag(flags, 'agent-run-id') } }
    case 'pending-review':
      return { name: 'agent.getPendingHumanReviewItems', arguments: { ...storage, ...projectArgs(flags) } }
    case 'run-chapter':
      return {
        name: 'agent.runChapterPipeline',
        arguments: {
          ...storage,
          ...projectArgs(flags),
          chapterOrder: intFlag(flags, 'chapter'),
          goal: flag(flags, 'goal'),
          chapterTask: objectJsonFlag(flags, 'chapter-task-json'),
          safetyMode: safetyModeArg(flags),
          pipelineMode: flag(flags, 'pipeline-mode'),
          estimatedWordCount: flag(flags, 'estimated-words'),
          readerEmotionTarget: flag(flags, 'reader-emotion'),
          temperature: numberFlag(flags, 'temperature'),
          budgetMaxTokens: flag(flags, 'budget-max-tokens') ? intFlag(flags, 'budget-max-tokens') : undefined
        }
      }
    case 'retry-chapter':
      return {
        name: 'agent.retryChapterPipeline',
        arguments: {
          ...storage,
          agentRunId: flag(flags, 'agent-run-id'),
          jobId: flag(flags, 'job-id'),
          pipelineMode: flag(flags, 'pipeline-mode'),
          estimatedWordCount: flag(flags, 'estimated-words'),
          readerEmotionTarget: flag(flags, 'reader-emotion'),
          budgetMaxTokens: flag(flags, 'budget-max-tokens') ? intFlag(flags, 'budget-max-tokens') : undefined
        }
      }
    case 'pipeline-progress':
      return { name: 'agent.getPipelineProgress', arguments: { ...storage, jobId: flag(flags, 'job-id') } }
    case 'cancel-chapter':
      return {
        name: 'agent.cancelChapterPipeline',
        arguments: { ...storage, jobId: flag(flags, 'job-id'), reason: flag(flags, 'reason') }
      }
    case 'continue':
      return {
        name: 'agent.continueAgentRun',
        arguments: {
          ...storage,
          ...projectArgs(flags),
          startChapterOrder: intFlag(flags, 'start-chapter'),
          chapterCount: intFlag(flags, 'chapters'),
          goal: flag(flags, 'goal'),
          safetyMode: safetyModeArg(flags)
        }
      }
    default:
      throw new Error(`Unknown agent command: ${parsed.command}`)
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function jobStatus(result: AgentToolCallResult): string | null {
  const data = result.data
  if (!data || typeof data !== 'object' || !('job' in data)) return null
  const job = (data as { job?: unknown }).job
  if (!job || typeof job !== 'object' || !('status' in job)) return null
  const status = (job as { status?: unknown }).status
  return typeof status === 'string' ? status : null
}

async function callTool(parsed: ParsedArgs): Promise<AgentToolCallResult> {
  if (parsed.command !== 'watch-job') {
    return AgentToolService.callTool(buildToolCall(parsed))
  }

  const flags = parsed.flags
  const timeoutMs = intFlag(flags, 'timeout-ms', 5000)
  const intervalMs = intFlag(flags, 'interval-ms', 1000)
  const deadline = Date.now() + timeoutMs
  const inspectCall: AgentToolCallInput = {
    name: 'agent.inspectPipelineJob',
    arguments: { ...baseToolArgs(flags), jobId: flag(flags, 'job-id') }
  }
  let latest = await AgentToolService.callTool(inspectCall)
  while (Date.now() < deadline && ['idle', 'running'].includes(jobStatus(latest) ?? '')) {
    await sleep(intervalMs)
    latest = await AgentToolService.callTool(inspectCall)
  }
  return latest
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.command === 'help' || parsed.flags.help) {
    printHelp()
    return
  }

  const result = await callTool(parsed)
  const output: CliOutput = {
    ok: result.ok,
    command: parsed.command,
    tool: result.tool,
    storage: result.storage,
    data: result.data
  }
  console.log(JSON.stringify(output, null, 2))
}

main().catch((error) => {
  const output: CliOutput = {
    ok: false,
    command: process.argv[2] ?? 'help',
    error: error instanceof Error ? error.message : String(error)
  }
  console.error(JSON.stringify(output, null, 2))
  process.exit(1)
})
