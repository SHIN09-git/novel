#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot

function check(condition, message) {
  if (!condition) throw new Error(message)
}

async function loadModel() {
  const result = await build({
    entryPoints: [join(root, 'src/renderer/src/components/aiCallProgressModel.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false
  })
  const source = Buffer.from(result.outputFiles[0].contents).toString('base64')
  return import(`data:text/javascript;base64,${source}`)
}

async function loadPipelineRoles() {
  const result = await build({
    entryPoints: [join(root, 'src/services/PipelineRunContextService.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false
  })
  const source = Buffer.from(result.outputFiles[0].contents).toString('base64')
  return import(`data:text/javascript;base64,${source}`)
}

async function main() {
  const model = await loadModel()
  const pipelineRoles = await loadPipelineRoles()
  const waiting = model.parseAiCallProgressSnapshot({
    callId: 'call-1', runId: 'run-1', stage: 'waiting_response', elapsedMs: 12_000, attempt: 1,
    retryDelayMs: null, provider: 'openai', model: 'gpt-test', startedAt: '2026-09-06T09:59:00.000Z',
    lastActivityAt: '2026-09-06T10:00:00.000Z'
  })
  check(waiting?.stage === 'waiting_response' && waiting.elapsedMs === 12_000,
    'The real waiting-response contract should be retained.')
  check(model.getAiCallModelLabel(waiting) === 'openai / gpt-test',
    'Provider and model name should be shown without inventing a model.')

  const retry = model.parseAiCallProgressSnapshot({
    callId: 'call-2', runId: 'run-1', stage: 'retry_wait', elapsedMs: 21_000, attempt: 2,
    retryDelayMs: 3_500, provider: 'compatible', model: 'author-model', startedAt: '2026-09-06T10:00:00.000Z', lastActivityAt: null
  })
  check(model.getAiCallProgressCopy(retry).detail.includes('4 秒后重试'),
    'Retry wait should explain the actual retry delay.')
  check(model.formatAiCallElapsed(62_000) === '1:02', 'Elapsed time should remain compact and readable.')
  check(model.isTerminalAiCallProgressStage('completed') && !model.isTerminalAiCallProgressStage('reading_response'),
    'Only completed, failed, and cancelled calls should stop live polling.')
  const oldCompleted = model.parseAiCallProgressSnapshot({
    callId: 'call-old', runId: 'run-1', stage: 'completed', elapsedMs: 5_000, attempt: 1,
    provider: 'openai', model: 'gpt-test', startedAt: '2026-09-06T09:00:00.000Z', lastActivityAt: '2026-09-06T09:00:05.000Z'
  })
  check(!model.isAiCallProgressCurrentForStartedAt(oldCompleted, '2026-09-06T09:01:00.000Z') &&
    model.isAiCallProgressCurrentForStartedAt(waiting, '2026-09-06T10:01:00.000Z'),
  'A terminal call from an earlier pipeline step must not replace the next step status.')
  check(model.parseAiCallProgressSnapshot({ callId: 'call-3', model: 'author-model', stage: 'made_up_progress', elapsedMs: 1, attempt: 1 }) === null,
    'Unknown statuses must not be rendered as real progress.')
  check(model.parseAiCallProgressSnapshot({ callId: 'call-3', model: 'author-model', stage: 'reading_response', elapsedMs: -1, attempt: 1 }) === null,
    'Invalid elapsed values must not replace the local timer.')
  check(!model.isAiCallProgressInScope(waiting, { runId: 'run-other' }) &&
    model.isAiCallProgressInScope(waiting, { runId: 'run-1', callId: 'call-1' }),
  'Returned call progress must remain within the current run and call scope.')
  check(model.getAiCallProgressCopy(null).label === '调用状态暂不可用',
    'Missing bridge data should use an explicit timed fallback rather than a fabricated stage.')
  check(pipelineRoles.getPipelineRoleForStep('generate_chapter_draft') === 'prose' &&
    pipelineRoles.getPipelineRoleForStep('build_context') === null &&
    pipelineRoles.getPipelineRoleForStep('context_budget_selection') === null,
  'Only pipeline steps with an existing AI role should show call progress.')

  const hook = await readFile(join(root, 'src/renderer/src/components/useAiCallProgress.ts'), 'utf8')
  const component = await readFile(join(root, 'src/renderer/src/components/AiCallProgress.tsx'), 'utf8')
  const rail = await readFile(join(root, 'src/renderer/src/components/pipeline/PipelineStepRail.tsx'), 'utf8')
  check(hook.includes('POLL_INTERVAL_MS = 1_500') && hook.includes('if (!active) return'),
    'Polling must be scoped to a live run and stay within the requested cadence.')
  check(hook.includes('requestVersion') && hook.includes('disposed') && hook.includes('clearTimeout') &&
    hook.includes('window.clearInterval(clockTimer)') &&
    hook.includes('inFlight') && hook.includes('scheduleNextPoll') && hook.includes('!terminal || !callId') &&
    hook.includes('isAiCallProgressCurrentForStartedAt'),
  'Polling must serialize requests, clean up timers, and ignore terminal results from an earlier step.')
  check(component.includes('模型信息待服务提供') && component.includes('已耗时'),
    'The compact UI should retain elapsed time even when the old bridge lacks call progress.')
  check(rail.includes('getPipelineRoleForStep') && rail.includes('isAiStep') &&
    rail.includes('正在整理本章资料（本地处理）') && rail.includes('onCancel(job)'),
  'Pipeline status must distinguish local work from real model calls while retaining cancellation.')
  console.log('validate-ai-call-progress-ui: ok')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
