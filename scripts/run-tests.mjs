#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))

const tests = [
  ['rc-regression.mjs'],
  ['validate-app-data.mjs', 'tmp/rc-regression/novel-director-data.json'],
  ['validate-ai-modules.mjs'],
  ['validate-ai-schema-validator.mjs'],
  ['validate-revision-merge.mjs'],
  ['validate-revision-writeback.mjs'],
  ['validate-revision-contract.mjs'],
  ['validate-revision-diff-view.mjs'],
  ['validate-p0-stability.mjs'],
  ['validate-app-config-safety.mjs'],
  ['validate-context-budget-consistency.mjs'],
  ['validate-context-relevance-scoring.mjs'],
  ['validate-context-need-planner.mjs'],
  ['validate-context-budget-planner.mjs'],
  ['validate-plan-context-gap-closure.mjs'],
  ['validate-generation-run-bundle.mjs'],
  ['validate-chapter-commit-bundle.mjs'],
  ['validate-p2c-revision-commit-bundle.mjs'],
  ['validate-version-chain-restore.mjs'],
  ['validate-run-trace-author-summary.mjs'],
  ['validate-character-state-ledger.mjs'],
  ['validate-story-direction-board.mjs'],
  ['validate-hard-canon-pack.mjs'],
  ['validate-pipeline-context-trace-alignment.mjs'],
  ['validate-revision-candidate-context-source.mjs'],
  ['validate-secure-credentials.mjs'],
  ['validate-memory-patch-structure.mjs'],
  ['validate-storage-migration-merge.mjs'],
  ['validate-sqlite-storage.mjs'],
  ['validate-prompt-compression-replacement.mjs'],
  ['validate-prompt-priority-stack.mjs'],
  ['validate-writing-prompt-hygiene.mjs'],
  ['validate-novelty-guardrails.mjs'],
  ['validate-app-view-rendering-and-styles.mjs'],
  ['validate-functional-save-coverage.mjs'],
  ['validate-lazy-views-and-scoped-styles.mjs'],
  ['validate-electron-security-p0.mjs'],
  ['validate-architecture-p2.mjs'],
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
