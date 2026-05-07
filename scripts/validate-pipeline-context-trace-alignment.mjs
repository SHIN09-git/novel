import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('.')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function main() {
  const checks = []
  const typesSource = await readFile(join(root, 'src', 'shared', 'types.ts'), 'utf-8')
  const runnerSource = await readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'usePipelineRunner.ts'), 'utf-8')
  const runTraceSource = await readFile(join(root, 'src', 'renderer', 'src', 'utils', 'runTrace.ts'), 'utf-8')
  const promptBuilderSource = await readFile(join(root, 'src', 'services', 'PromptBuilderService.ts'), 'utf-8')
  const fixture = JSON.parse(await readFile(join(root, 'tmp', 'rc-regression', 'novel-director-data.json'), 'utf-8'))

  checks.push(
    assert(
      typesSource.includes('export interface ForcedContextBlock') &&
        typesSource.includes('forcedContextBlocks: ForcedContextBlock[]') &&
        typesSource.includes('compressionRecords: ContextCompressionRecord[]') &&
        typesSource.includes('contextTokenEstimate: number'),
      'GenerationRunTrace models forced context blocks and compression records separately from budget-selected ids'
    )
  )

  checks.push(
    assert(
      runnerSource.includes("kind: 'continuity_bridge'") &&
        runnerSource.includes('forcedContextBlocks') &&
        runnerSource.includes('contextTokenEstimate') &&
        runnerSource.includes('estimateForcedContextTokens(forcedContextBlocks)'),
      'build_context records continuity bridge as a forced context block and estimates budget-vs-final token delta'
    )
  )

  checks.push(
    assert(
      runTraceSource.includes('appendGenerationRunTraceForcedContextBlocks') &&
        runTraceSource.includes('uniqueForcedContextBlocks') &&
        runTraceSource.includes('estimateForcedContextTokens'),
      'Run Trace utilities can append and dedupe forced context blocks'
    )
  )

  checks.push(
    assert(
      promptBuilderSource.includes('formatCompressedChapterRecap') &&
        promptBuilderSource.includes('compressionByChapterId') &&
        runnerSource.includes('compressionRecords: budgetSelection?.compressionRecords'),
      'compressed chapter recap replacements are rendered in final prompts and recorded into Run Trace'
    )
  )

  for (const trace of fixture.generationRunTraces ?? []) {
    const forcedBlocks = trace.forcedContextBlocks ?? []
    const compressionRecords = trace.compressionRecords ?? []
    const selectedIds = new Set([
      ...(trace.selectedChapterIds ?? []),
      ...(trace.selectedStageSummaryIds ?? []),
      ...(trace.selectedCharacterIds ?? []),
      ...(trace.selectedForeshadowingIds ?? [])
    ])
    checks.push(
      assert(Array.isArray(forcedBlocks), 'trace forcedContextBlocks is always serializable array', { traceId: trace.id })
    )
    checks.push(
      assert(Array.isArray(compressionRecords), 'trace compressionRecords is always serializable array', { traceId: trace.id })
    )
    checks.push(
      assert(
        !compressionRecords.some((record) => forcedBlocks.some((block) => block.sourceId === record.id)),
        'compression records do not pollute forcedContextBlocks',
        { traceId: trace.id, compressionRecords, forcedBlocks }
      )
    )
    checks.push(
      assert(
        typeof trace.finalPromptTokenEstimate === 'number' && typeof trace.contextTokenEstimate === 'number',
        'trace records both contextTokenEstimate and finalPromptTokenEstimate',
        { traceId: trace.id, contextTokenEstimate: trace.contextTokenEstimate, finalPromptTokenEstimate: trace.finalPromptTokenEstimate }
      )
    )
    if (trace.continuityBridgeId) {
      const continuityBlock = forcedBlocks.find((block) => block.kind === 'continuity_bridge' && block.sourceId === trace.continuityBridgeId)
      checks.push(
        assert(Boolean(continuityBlock), 'continuity bridge in build_context is explained by forcedContextBlocks', {
          traceId: trace.id,
          continuityBridgeId: trace.continuityBridgeId,
          forcedBlocks
        })
      )
      checks.push(
        assert(!selectedIds.has(trace.continuityBridgeId), 'continuity bridge does not pollute budget selection ids', {
          traceId: trace.id,
          continuityBridgeId: trace.continuityBridgeId
        })
      )
    }
    const forcedTokenEstimate = forcedBlocks.reduce((total, block) => total + Math.max(0, Number(block.tokenEstimate) || 0), 0)
    const delta = trace.finalPromptTokenEstimate - trace.contextTokenEstimate
    checks.push(
      assert(
        Math.abs(delta - forcedTokenEstimate) <= Math.max(25, Math.ceil(trace.finalPromptTokenEstimate * 0.15)),
        'context token estimate plus forced context estimate explains final prompt estimate within tolerance',
        { traceId: trace.id, delta, forcedTokenEstimate }
      )
    )
  }

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
