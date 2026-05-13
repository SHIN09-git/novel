#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const promptBuilder = [
  'src/services/PromptBuilderService.ts',
  'src/services/promptFormatters/foreshadowingFormatters.ts'
]
  .map((file) => readFileSync(join(root, file), 'utf8'))
  .join('\n')
const budgetManager = [
  'src/services/ContextBudgetManager.ts',
  'src/services/contextBudget/scoringEngine.ts'
]
  .map((file) => readFileSync(join(root, file), 'utf8'))
  .join('\n')

function assert(condition, message) {
  if (!condition) {
    console.error(`validate-foreshadowing-prompt-limit failed: ${message}`)
    process.exit(1)
  }
}

assert(
  /const MAX_PROMPT_FORESHADOWINGS = 10/.test(promptBuilder),
  'PromptBuilderService must define a 10-item foreshadowing prompt limit.'
)
assert(
  /limitForeshadowingsForPrompt\([\s\S]*slice\(0, MAX_PROMPT_FORESHADOWINGS\)/.test(promptBuilder),
  'PromptBuilderService must cap selected foreshadowings before writing the prompt.'
)
assert(
  /selectedForeshadowings[\s\S]*limitForeshadowingsForPrompt/.test(promptBuilder),
  'selectedForeshadowings must use the capped prompt selection.'
)
assert(
  /FORESHADOWING_WEIGHT_PRIORITY/.test(promptBuilder) && /compareForeshadowingForPrompt/.test(promptBuilder),
  'PromptBuilderService must sort foreshadowings by weight-aware prompt priority.'
)
assert(
  /\[\.\.\.grouped\[key\]\][\s\S]*compareForeshadowingForPrompt/.test(promptBuilder),
  'Foreshadowing operation groups must preserve weight-aware ordering.'
)

assert(
  /const MAX_PROMPT_FORESHADOWINGS = 10/.test(budgetManager),
  'ContextBudgetManager must define the same 10-item foreshadowing limit.'
)
assert(
  /rankedForeshadowings[\s\S]*slice\(0, MAX_PROMPT_FORESHADOWINGS\)/.test(budgetManager),
  'ContextBudgetManager must cap selected foreshadowings before context selection is finalized.'
)
assert(
  /foreshadowingLimitOmittedIds/.test(budgetManager),
  'ContextBudgetManager must track foreshadowings omitted by the prompt limit.'
)
assert(
  /最多推进 \$\{MAX_PROMPT_FORESHADOWINGS\} 条伏笔/.test(budgetManager),
  'Omitted foreshadowings must explain that the prompt limit caused the drop.'
)

console.log('validate-foreshadowing-prompt-limit passed.')
