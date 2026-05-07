import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'ai-schema-validator-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function loadTsModule(relativePath) {
  const source = await readFile(join(root, relativePath), 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: true
    }
  })
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `${relativePath.replace(/[\\/.:]/g, '-')}.mjs`)
  await writeFile(outPath, compiled.outputText, 'utf-8')
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

async function main() {
  const checks = []
  const validator = await loadTsModule('src/services/ai/AISchemaValidator.ts')
  const clientSource = await readFile(join(root, 'src', 'services', 'ai', 'AIClient.ts'), 'utf-8')
  const chapterReviewSource = await readFile(join(root, 'src', 'services', 'ai', 'ChapterReviewAI.ts'), 'utf-8')
  const pipelineSource = await readFile(join(root, 'src', 'services', 'ai', 'GenerationPipelineAI.ts'), 'utf-8')
  const qualitySource = await readFile(join(root, 'src', 'services', 'ai', 'QualityGateAI.ts'), 'utf-8')
  const revisionSource = await readFile(join(root, 'src', 'services', 'ai', 'RevisionAI.ts'), 'utf-8')
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'))

  const validReview = validator.validateChapterReviewSchema({
    summary: '',
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '',
    riskWarnings: '',
    continuityBridgeSuggestion: {
      lastSceneLocation: '',
      lastPhysicalState: '',
      lastEmotionalState: '',
      lastUnresolvedAction: '',
      lastDialogueOrThought: '',
      immediateNextBeat: '',
      mustContinueFrom: '',
      mustNotReset: '',
      openMicroTensions: ''
    }
  })
  checks.push(assert(validReview.ok, 'valid chapter review response passes schema validation', validReview))

  const invalidReview = validator.validateChapterReviewSchema({ summary: '', continuityBridgeSuggestion: {} })
  checks.push(
    assert(
      !invalidReview.ok && invalidReview.issues.some((issue) => issue.path === '$.endingHook'),
      'missing chapter review fields are reported before normalization can fill blanks',
      invalidReview
    )
  )

  const chapterDraft = validator.validateChapterDraftSchema({ chapterText: '正文内容' })
  checks.push(assert(chapterDraft.ok, 'chapter draft validator accepts normalizer body aliases', chapterDraft))

  const invalidGate = validator.validateQualityGateSchema({
    overallScore: 80,
    pass: true,
    issues: [],
    requiredFixes: [],
    optionalSuggestions: []
  })
  checks.push(
    assert(
      !invalidGate.ok && invalidGate.issues.some((issue) => issue.path === '$.dimensions'),
      'quality gate validator rejects reports without dimensions',
      invalidGate
    )
  )

  const invalidRevision = validator.validateRevisionResultSchema({ revisedText: '修订文本' })
  checks.push(
    assert(
      !invalidRevision.ok && invalidRevision.issues.some((issue) => issue.path === '$.changedSummary'),
      'revision result validator reports missing required metadata fields',
      invalidRevision
    )
  )

  checks.push(
    assert(
      clientSource.includes('validate?: AISchemaValidator') &&
        clientSource.includes('validate?.(parsed.data)') &&
        clientSource.includes('formatSchemaValidationError(validation)') &&
        clientSource.indexOf('validate?.(parsed.data)') < clientSource.indexOf('data: normalize(parsed.data)'),
      'AIClient validates parsed JSON before normalizing it into application data'
    )
  )

  checks.push(
    assert(
      chapterReviewSource.includes('validateChapterReviewSchema') &&
        chapterReviewSource.includes('validateCharacterSuggestionsSchema') &&
        chapterReviewSource.includes('validateForeshadowingExtractionSchema') &&
        chapterReviewSource.includes('validateNextSuggestionsSchema'),
      'chapter review AI calls pass schema validators'
    )
  )

  checks.push(
    assert(
      pipelineSource.includes('validateChapterPlanSchema') &&
        pipelineSource.includes('validateChapterDraftSchema') &&
        pipelineSource.includes('validateConsistencyReviewSchema'),
      'generation pipeline AI calls pass schema validators'
    )
  )

  checks.push(
    assert(
      qualitySource.includes('validateQualityGateSchema') &&
        qualitySource.includes('validateRevisionCandidateSchema') &&
        revisionSource.includes('validateRevisionResultSchema'),
      'quality gate and revision AI calls pass schema validators'
    )
  )

  checks.push(
    assert(packageJson.scripts?.test?.includes('validate-ai-schema-validator.mjs'), 'npm test includes validate-ai-schema-validator.mjs')
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
