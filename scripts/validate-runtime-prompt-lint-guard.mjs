import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'runtime-prompt-lint-guard-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function rewriteRelativeImports(source) {
  return source.replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(['"])/g, (_match, prefix, specifier, suffix) => {
    if (/\.(mjs|js|json)$/.test(specifier)) return `${prefix}${specifier}${suffix}`
    return `${prefix}${specifier}.mjs${suffix}`
  })
}

async function compileTsTree(files) {
  await rm(outDir, { recursive: true, force: true })
  for (const relativePath of files) {
    const source = await readFile(join(root, relativePath), 'utf-8')
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        useDefineForClassFields: true
      }
    })
    const outPath = join(outDir, relativePath).replace(/\.tsx?$/, '.mjs')
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, rewriteRelativeImports(compiled.outputText), 'utf-8')
  }
}

async function loadPromptLintService() {
  await compileTsTree(['src/services/TokenEstimator.ts', 'src/services/PromptLintService.ts'])
  return import(`${pathToFileURL(join(outDir, 'src/services/PromptLintService.mjs')).href}?t=${Date.now()}`)
}

async function main() {
  const checks = []
  const { PromptLintService } = await loadPromptLintService()

  const rawPrompt = [
    '# 第 18 章写作 Prompt',
    '## 本章任务契约',
    '本章目标：待补充',
    '本章必须推进的冲突：',
    '风险：本章对某伏笔进行了超出允许范围的推进。建议后续章节保持克制。',
    '不得新增未铺垫救命规则。',
    '不得新增未铺垫救命规则。',
    'Novelty guardrail: Do not introduce unforeshadowed rescue rules.',
    '直接输出正文。'
  ].join('\n')

  const guarded = PromptLintService.guardWritingPrompt(rawPrompt)
  checks.push(assert(!guarded.guardedPrompt.includes('待补充'), 'runtime guard removes placeholder text'))
  checks.push(assert(!guarded.guardedPrompt.includes('风险：') && !guarded.guardedPrompt.includes('建议后续章节'), 'runtime guard removes audit/review wording'))
  checks.push(assert(guarded.guardedPrompt.includes('不得继续解释、揭底或回收'), 'runtime guard rewrites useful audit risk into an actionable writing constraint'))
  checks.push(assert(!guarded.guardedPrompt.includes('Novelty guardrail:'), 'runtime guard removes duplicate English guardrails'))
  checks.push(
    assert((guarded.guardedPrompt.match(/不得新增未铺垫救命规则/g) ?? []).length === 1, 'runtime guard dedupes repeated Chinese guardrails')
  )
  checks.push(assert(guarded.result.issueCount >= 4, 'runtime guard returns structured lint issues', guarded.result))
  checks.push(assert(guarded.result.rewrittenLineCount >= 1, 'runtime guard records rewritten diagnostic lines', guarded.result))
  checks.push(assert(guarded.result.guardedTokenEstimate <= guarded.result.originalTokenEstimate, 'runtime guard records token estimates'))
  checks.push(assert(!JSON.stringify(guarded.result).includes('# 第 18 章写作 Prompt'), 'lint result does not copy the full prompt'))

  const promptBuilder = read('src/services/PromptBuilderService.ts')
  checks.push(assert(promptBuilder.includes('PromptLintService'), 'PromptBuilderService runs PromptLintService at buildResult runtime'))
  checks.push(assert(promptBuilder.includes('promptLintResult'), 'BuildPromptResult includes promptLintResult from runtime guard'))

  const appDataTypes = read('src/shared/types/appData.ts')
  const traceTypes = read('src/shared/types/trace.ts')
  const traceNormalizer = read('src/shared/normalizers/runTrace.ts')
  checks.push(assert(appDataTypes.includes('promptLintResult: PromptLintResult'), 'BuildPromptResult exposes PromptLintResult'))
  checks.push(assert(traceTypes.includes('promptLintWarnings') && traceTypes.includes('promptLintIssueCount'), 'GenerationRunTrace stores prompt lint summary'))
  checks.push(assert(traceNormalizer.includes('promptLintWarnings') && traceNormalizer.includes('promptLintIssueCount'), 'run trace normalizer preserves prompt lint summary'))

  const contextPlanning = read('src/renderer/src/views/generation/pipelineSteps/contextPlanning.ts')
  const chapterGeneration = read('src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts')
  checks.push(assert(contextPlanning.includes('PromptLintService') && contextPlanning.includes('promptLintWarnings'), 'build_context guards snapshot prompts and traces lint warnings'))
  checks.push(assert(chapterGeneration.includes('PromptLintService') && chapterGeneration.includes('promptLintIssueCount'), 'rebuild_context_with_plan guards snapshot prompts and traces lint issue count'))

  const promptBuilderView = read('src/renderer/src/views/PromptBuilderView.tsx')
  checks.push(assert(promptBuilderView.includes('PromptLintService.guardWritingPrompt'), 'PromptBuilderView guards manually edited snapshots and saved prompt versions'))

  const runTests = read('scripts/run-tests.mjs')
  checks.push(assert(runTests.includes('validate-runtime-prompt-lint-guard.mjs'), 'npm test runs runtime prompt lint guard validation'))

  const failed = checks.filter((check) => !check.ok)
  for (const check of checks) {
    console.log(`${check.ok ? '✓' : '✗'} ${check.message}`)
    if (!check.ok) console.log(JSON.stringify(check.details, null, 2))
  }
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
