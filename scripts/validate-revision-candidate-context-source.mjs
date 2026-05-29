import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('.')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function main() {
  const checks = []
  const viewSource = await readFile(join(root, 'src', 'renderer', 'src', 'views', 'GenerationPipelineView.tsx'), 'utf-8')
  const revisionContextSource = await readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'revisionCandidateContext.ts'), 'utf-8')
  const promptContextSource = await readFile(join(root, 'src', 'renderer', 'src', 'utils', 'promptContext.ts'), 'utf-8')
  const promptBuilderSource = await readFile(join(root, 'src', 'services', 'PromptBuilderService.ts'), 'utf-8')
  const typesSource = [
    await readFile(join(root, 'src', 'shared', 'types.ts'), 'utf-8'),
    await readFile(join(root, 'src', 'shared', 'types', 'revision.ts'), 'utf-8')
  ].join('\n')

  checks.push(
    assert(
      !viewSource.includes('buildPipelineContext('),
      'quality gate revision candidate flow no longer calls legacy buildPipelineContext auto-recommendation path'
    )
  )

  checks.push(
    assert(
      viewSource.includes("import('./generation/revisionCandidateContext')") &&
        !viewSource.includes("from '../utils/promptContext'") &&
        !viewSource.includes('buildPipelineContextFromSelection(project, data, targetOrder'),
      'GenerationPipelineView lazy-loads revision candidate context rebuild logic instead of importing prompt builders'
    )
  )

  checks.push(
    assert(
      revisionContextSource.includes('resolveRevisionCandidateContext') &&
        revisionContextSource.includes('reused_current_job_context') &&
        revisionContextSource.includes('rebuilt_from_explicit_selection'),
      'quality gate revision candidates record an explicit context source'
    )
  )

  checks.push(
    assert(
      revisionContextSource.includes("step.type === 'build_context'") &&
        revisionContextSource.includes('contextFromBuildContextOutput(buildContextStep.output)') &&
        revisionContextSource.includes('selectedTraceSnapshot.finalPrompt'),
      'revision candidate context first reuses current job build_context output or bound prompt snapshot'
    )
  )

  checks.push(
    assert(
      revisionContextSource.includes('selectBudgetContext(project, data, targetOrder, budgetProfile') &&
        revisionContextSource.includes('chapterTask: {') &&
        revisionContextSource.includes('buildPipelineContextFromSelection(project, data, targetOrder') &&
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
      revisionContextSource.includes("kind: 'quality_gate_issue'") &&
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
