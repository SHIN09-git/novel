#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const root = dirname(scriptsDir)

const tests = [
  ['validate-hig-workspace.mjs'],
  ['validate-character-workspace-drafts.mjs'],
  ['validate-home-workspace.mjs'],
  ['validate-prompt-snapshot-consistency.mjs'],
  ['validate-revision-editor-save-race.mjs'],
  ['rc-regression.mjs'],
  ['validate-app-data.mjs', 'tmp/rc-regression/novel-director-data.json'],
  ['validate-ai-modules.mjs'],
  ['validate-unified-post-draft-analysis.mjs'],
  ['validate-codex-cli-provider.mjs'],
  ['validate-ai-workflow-prompt-boundaries.mjs'],
  ['validate-main-diagnostics-boundary.mjs'],
  ['validate-ai-schema-validator.mjs'],
  ['validate-ai-chapter-draft-recovery.mjs'],
  ['validate-ai-retry-backoff.mjs'],
  ['validate-ai-empty-response-recovery.mjs'],
  ['validate-ai-http-cancellation.mjs'],
  ['validate-ai-call-cancellation.mjs'],
  ['validate-revision-merge.mjs'],
  ['validate-revision-writeback.mjs'],
  ['validate-revision-confirmation-snapshot.mjs'],
  ['validate-revision-late-response.mjs'],
  ['validate-revision-response-preservation.mjs'],
  ['validate-revision-contract.mjs'],
  ['validate-revision-diff-view.mjs'],
  ['validate-ai-rewrite-context-menu.mjs'],
  ['validate-ai-rewrite-call-control.mjs'],
  ['validate-ai-rewrite-result.mjs'],
  ['validate-quick-rewrite-persistence.mjs'],
  ['validate-ai-call-progress.mjs'],
  ['validate-backend-ai-performance.mjs'],
  ['validate-ai-call-progress-ui.mjs'],
  ['validate-reading-view.mjs'],
  ['validate-reading-position.mjs'],
  ['validate-chapter-editor-state.mjs'],
  ['validate-chapter-archive.mjs'],
  ['validate-project-list-recent-open-order.mjs'],
  ['validate-appdata-project-boundaries.mjs'],
  ['validate-p0-stability.mjs'],
  ['validate-renderer-save-consistency.mjs'],
  ['validate-buffered-form-persistence.mjs'],
  ['validate-app-config-safety.mjs'],
  ['validate-runtime-info.mjs'],
  ['validate-context-budget-consistency.mjs'],
  ['validate-context-relevance-scoring.mjs'],
  ['validate-context-need-planner.mjs'],
  ['validate-opening-context-invariant.mjs'],
  ['validate-context-budget-planner.mjs'],
  ['validate-context-selection-trace-runtime.mjs'],
  ['validate-prompt-contract-replay.mjs'],
  ['validate-plan-context-gap-closure.mjs'],
  ['validate-generation-run-bundle.mjs'],
  ['validate-generation-bundle-scoped-read.mjs'],
  ['validate-accepted-chapter-cost.mjs'],
  ['validate-model-comparison-preparation.mjs'],
  ['validate-pipeline-bundle-handoff.mjs', '--require-native'],
  ['validate-chapter-task-editing.mjs'],
  ['validate-pipeline-task-editor.mjs'],
  ['validate-chapter-commit-bundle.mjs'],
  ['validate-draft-acceptance-trace.mjs'],
  ['validate-unreviewed-draft-acceptance.mjs'],
  ['validate-p2c-revision-commit-bundle.mjs'],
  ['validate-revision-source-binding.mjs'],
  ['validate-revision-request-relocation.mjs'],
  ['validate-agent-revision-tools.mjs'],
  ['validate-version-chain-restore.mjs'],
  ['validate-empty-chapter-restore.mjs'],
  ['validate-version-report-provenance.mjs'],
  ['validate-virtual-revision-baseline-restore.mjs'],
  ['validate-run-trace-author-summary.mjs'],
  ['validate-editorial-verdict.mjs'],
  ['validate-editorial-verdict-policy.mjs'],
  ['validate-editorial-verdict-persistence.mjs'],
  ['validate-editorial-verdict-workflow.mjs'],
  ['validate-editorial-revision-entry.mjs'],
  ['validate-character-state-ledger.mjs'],
  ['validate-story-direction-board.mjs'],
  ['validate-hard-canon-pack.mjs'],
  ['validate-pipeline-context-trace-alignment.mjs'],
  ['validate-revision-candidate-context-source.mjs'],
  ['validate-secure-credentials.mjs'],
  ['validate-memory-patch-structure.mjs'],
  ['validate-storage-migration-merge.mjs'],
  ['validate-import-safety.mjs'],
  ['validate-sqlite-storage.mjs'],
  ['validate-backend-backup-laziness.mjs'],
  ['validate-sqlite-initialization.mjs'],
  ['validate-sqlite-differential-save.mjs'],
  ['validate-prompt-compression-replacement.mjs'],
  ['validate-prompt-priority-stack.mjs'],
  ['validate-prompt-authority-alignment.mjs'],
  ['validate-prompt-composition-metrics.mjs'],
  ['validate-foreshadowing-prompt-limit.mjs'],
  ['validate-writing-prompt-hygiene.mjs'],
  ['validate-ui-placeholder-hygiene.mjs'],
  ['validate-runtime-prompt-lint-guard.mjs'],
  ['validate-novelty-guardrails.mjs'],
  ['validate-novelty-chinese-matching.mjs'],
  ['validate-novelty-audit-memo.mjs'],
  ['validate-chapter-ab-diagnostics.mjs'],
  ['validate-chapter-task-contract.mjs'],
  ['validate-chapter-task-contract-generic.mjs'],
  ['validate-pipeline-diagnostic-reliability.mjs'],
  ['validate-quality-gate-diagnostic-reuse.mjs'],
  ['validate-combined-semantic-review.mjs'],
  ['validate-pipeline-ai-role-routing.mjs'],
  ['validate-pipeline-ai-call-trace.mjs'],
  ['validate-pipeline-recipes.mjs'],
  ['validate-legacy-pipeline-mode-index.mjs'],
  ['validate-pipeline-stage-ui.mjs'],
  ['validate-prose-first-workspaces.mjs'],
  ['validate-workflow-usability-fixes.mjs'],
  ['validate-app-view-rendering-and-styles.mjs'],
  ['validate-director-dashboard.mjs'],
  ['validate-decision-inbox-service.mjs'],
  ['validate-decision-inbox-amendment-ui.mjs'],
  ['validate-candidate-decisions.mjs'],
  ['validate-candidate-decision-undo.mjs'],
  ['validate-decision-inbox-history-ui.mjs'],
  ['validate-candidate-specialty-coverage.mjs'],
  ['validate-candidate-decision-undo-storage.mjs'],
  ['validate-agent-candidate-undo.mjs'],
  ['validate-candidate-decision-continuation.mjs'],
  ['validate-memory-candidate-report-binding.mjs'],
  ['validate-json-write-concurrency.mjs'],
  ['validate-agent-candidate-decisions.mjs'],
  ['validate-agent-authorization.mjs'],
  ['validate-agent-authorization-ui.mjs'],
  ['validate-agent-project-grant-workflow.mjs'],
  ['validate-agent-director-journey.mjs'],
  ['validate-agent-chapter-task-tools.mjs'],
  ['validate-agent-world-tools.mjs'],
  ['validate-functional-save-coverage.mjs'],
  ['validate-lazy-views-and-scoped-styles.mjs'],
  ['validate-electron-security-p0.mjs'],
  ['validate-architecture-p2.mjs'],
  ['validate-author-decision-policy.mjs'],
  ['validate-agent-runtime-p0.mjs'],
  ['validate-agent-overview-scoped-read.mjs'],
  ['validate-agent-runtime-p1.mjs'],
  ['validate-agent-runtime-p2.mjs'],
  ['validate-agent-runtime-p3.mjs'],
  ['validate-agent-pipeline-execution.mjs'],
  ['validate-agent-runtime-p5.mjs'],
  ['validate-agent-runtime-p6.mjs'],
  ['validate-core-modularization.mjs'],
  ['validate-release-p0-readiness.mjs'],
  ['validate-no-mojibake.mjs'],
  ['validate-public-release-cleanup.mjs']
]

function testName([script]) {
  return script.replace(/\.mjs$/, '')
}

function matchesFilter(test, filters) {
  if (!filters.length) return true
  const name = testName(test)
  return filters.some((filter) => name.includes(filter) || test[0].includes(filter))
}

async function runTest(test, index, total) {
  const [script, ...args] = test
  const scriptPath = join(scriptsDir, script)
  console.log(`\n[${index}/${total}] ${testName(test)}`)

  await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [scriptPath, ...args], {
      cwd: root,
      stdio: 'inherit',
      shell: false
    })

    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${script} failed with code ${code}`))
    })
  })
}

async function main() {
  const filters = process.argv.slice(2)
  const selectedTests = tests.filter((test) => matchesFilter(test, filters))
  if (!selectedTests.length) {
    console.error(`No validation tests matched: ${filters.join(', ')}`)
    process.exit(1)
  }

  console.log(`Running ${selectedTests.length} validation test(s).`)
  for (let i = 0; i < selectedTests.length; i += 1) {
    await runTest(selectedTests[i], i + 1, selectedTests.length)
  }
  console.log(`\nAll ${selectedTests.length} validation test(s) passed.`)
}

main().catch((error) => {
  console.error('\nTest runner failed.')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
