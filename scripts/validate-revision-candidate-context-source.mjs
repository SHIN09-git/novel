import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('.')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function main() {
  const checks = []
  const viewSource = await readFile(join(root, 'src', 'renderer', 'src', 'views', 'GenerationPipelineView.tsx'), 'utf-8')
  const promptContextSource = await readFile(join(root, 'src', 'renderer', 'src', 'utils', 'promptContext.ts'), 'utf-8')
  const promptBuilderSource = await readFile(join(root, 'src', 'services', 'PromptBuilderService.ts'), 'utf-8')
  const typesSource = await readFile(join(root, 'src', 'shared', 'types.ts'), 'utf-8')

  checks.push(
    assert(
      !viewSource.includes('buildPipelineContext('),
      'quality gate revision candidate flow no longer calls legacy buildPipelineContext auto-recommendation path'
    )
  )

  checks.push(
    assert(
      viewSource.includes('resolveRevisionCandidateContext') &&
        viewSource.includes('reused_current_job_context') &&
        viewSource.includes('rebuilt_from_explicit_selection'),
      'quality gate revision candidates record an explicit context source'
    )
  )

  checks.push(
    assert(
      viewSource.includes("step.type === 'build_context'") &&
        viewSource.includes('contextFromBuildContextOutput(buildContextStep.output)') &&
        viewSource.includes('selectedTraceSnapshot.finalPrompt'),
      'revision candidate context first reuses current job build_context output or bound prompt snapshot'
    )
  )

  checks.push(
    assert(
      viewSource.includes('selectBudgetContext(project, data, targetOrder, budgetProfile') &&
        viewSource.includes('chapterTask: {') &&
        viewSource.includes('buildPipelineContextFromSelection(project, data, targetOrder') &&
        promptContextSource.includes('explicitContextSelection: selection'),
      'context rebuild path uses ContextBudgetManager selection plus buildPipelineContextFromSelection'
    )
  )

  checks.push(
    assert(
      promptBuilderSource.includes('explicitContextSelection') &&
        promptBuilderSource.includes('input.explicitContextSelection') &&
        promptBuilderSource.includes('selectionIsExplicit'),
      'PromptBuilderService supports explicitContextSelection for rebuilt contexts'
    )
  )

  checks.push(
    assert(
      viewSource.includes("kind: 'quality_gate_issue'") &&
        viewSource.includes('appendGenerationRunTraceForcedContextBlocks') &&
        viewSource.includes('contextSource: revisionContext.contextSource') &&
        viewSource.includes('contextWarnings: revisionContext.contextWarnings'),
      'quality issue details are recorded as forced context and candidate metadata'
    )
  )

  checks.push(
    assert(
      typesSource.includes('RevisionCandidateContextSource') &&
        typesSource.includes('contextSource?: RevisionCandidateContextSource') &&
        typesSource.includes('contextWarnings?: string[]'),
      'RevisionCandidate has optional context source metadata for traceability'
    )
  )

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
