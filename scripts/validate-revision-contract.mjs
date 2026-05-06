import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve('.')
const templateSourcePath = join(root, 'src', 'services', 'ai', 'AIPromptTemplates.ts')
const studioSourcePath = join(root, 'src', 'renderer', 'src', 'views', 'RevisionStudioView.tsx')
const outDir = join(root, 'tmp', 'revision-contract-test')
const outPath = join(outDir, 'AIPromptTemplates.mjs')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function loadTemplateModule() {
  const source = await readFile(templateSourcePath, 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: true
    }
  })
  await mkdir(outDir, { recursive: true })
  await writeFile(outPath, compiled.outputText, 'utf-8')
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

async function main() {
  const { buildRevisionUserPrompt } = await loadTemplateModule()
  const studioSource = await readFile(studioSourcePath, 'utf-8')
  const checks = []

  const localPrompt = buildRevisionUserPrompt(
    {
      type: 'polish_style',
      instruction: 'Polish only the selected fragment.',
      revisionScope: 'local',
      fullChapterText: 'Full chapter opening. Target fragment. Full chapter ending.',
      targetRange: 'Target fragment.'
    },
    'Project context'
  )
  checks.push(
    assert(
      localPrompt.includes('revisionScope') &&
        localPrompt.includes('local') &&
        localPrompt.includes('fullChapterText') &&
        localPrompt.includes('Full chapter opening') &&
        localPrompt.includes('targetRange') &&
        localPrompt.includes('Target fragment') &&
        localPrompt.includes('revisedText'),
      'local revision prompt includes fullChapterText, targetRange, and explicit local scope'
    )
  )

  const fullPrompt = buildRevisionUserPrompt(
    {
      type: 'reduce_ai_tone',
      instruction: '',
      revisionScope: 'full',
      fullChapterText: 'Full chapter body.'
    },
    'Project context'
  )
  checks.push(
    assert(
      fullPrompt.includes('revisionScope') &&
        fullPrompt.includes('full') &&
        fullPrompt.includes('fullChapterText') &&
        fullPrompt.includes('targetRange') &&
        fullPrompt.includes('<none>') &&
        fullPrompt.includes('revisedText'),
      'full revision prompt declares full scope and no targetRange'
    )
  )

  checks.push(
    assert(
      studioSource.includes('revisionScope') &&
        studioSource.includes('fullChapterText') &&
        studioSource.includes('mergeLocalRevisionSafely') &&
        studioSource.includes('looksLikeFullChapterRevision') &&
        studioSource.includes('revisedText') &&
        studioSource.includes('revisedText 为空'),
      'RevisionStudioView sends explicit scope and keeps local merge in the UI layer'
    )
  )

  checks.push(
    assert(
      studioSource.includes('const finalBody = isLocalRevision') &&
        studioSource.includes('mergeLocalRevisionSafely(fullChapterText, rawTarget, result.data.revisedText)') &&
        !studioSource.includes('aiService.generateRevision(requestPayload, targetText, context)'),
      'full revisions bypass local merge while local revisions must use safe merge'
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
