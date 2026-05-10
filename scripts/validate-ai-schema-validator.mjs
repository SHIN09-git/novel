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
      useDefineForClassFields: true,
      verbatimModuleSyntax: false
    }
  })
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `${relativePath.replace(/[\\/.:]/g, '-')}.mjs`)
  await writeFile(outPath, compiled.outputText, 'utf-8')
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

function dimensionScores(overrides = {}) {
  return {
    plotCoherence: 70,
    characterConsistency: 80,
    characterStateConsistency: 76,
    foreshadowingControl: 64,
    chapterContinuity: 88,
    redundancyControl: 92,
    styleMatch: 75,
    pacing: 77,
    emotionalPayoff: 73,
    originality: 80,
    promptCompliance: 82,
    contextRelevanceCompliance: 74,
    ...overrides
  }
}

async function main() {
  const checks = []
  const validator = await loadTsModule('src/services/ai/AISchemaValidator.ts')
  const clientSource = await readFile(join(root, 'src', 'services', 'ai', 'AIClient.ts'), 'utf-8')
  const normalizerSource = await readFile(join(root, 'src', 'services', 'ai', 'AIResponseNormalizer.ts'), 'utf-8')
  const chapterReviewSource = await readFile(join(root, 'src', 'services', 'ai', 'ChapterReviewAI.ts'), 'utf-8')
  const pipelineSource = await readFile(join(root, 'src', 'services', 'ai', 'GenerationPipelineAI.ts'), 'utf-8')
  const qualitySource = await readFile(join(root, 'src', 'services', 'ai', 'QualityGateAI.ts'), 'utf-8')
  const revisionSource = await readFile(join(root, 'src', 'services', 'ai', 'RevisionAI.ts'), 'utf-8')

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

  const flexibleReview = validator.validateChapterReviewSchema({
    summary: ['previous chapter ended at a locked gate', 'the arm mutation continues'],
    newInformation: { rule: 'old key reacts to silver cracks', cost: 'temperature drops nearby' },
    characterChanges: ['the heroine starts doubting the protagonist'],
    newForeshadowing: ['old key heats up', 'silver crack appears on the wall'],
    resolvedForeshadowing: ['photo symbol is partially explained'],
    endingHook: 'familiar breathing behind the door',
    riskWarnings: ['do not pay off the main mystery', 'do not let a character explain the clue directly'],
    continuityBridgeSuggestion: {
      lastSceneLocation: 'in front of the iron door',
      lastPhysicalState: ['right arm burning', 'breathing uneven'],
      lastEmotionalState: 'alert and shocked',
      lastUnresolvedAction: 'hand on the handle, door not opened',
      lastDialogueOrThought: { thought: 'why does the person behind the door know my name' },
      immediateNextBeat: 'begin seconds after opening the door',
      mustContinueFrom: 'carry the breathing hook',
      mustNotReset: ['do not reintroduce the inverted city', 'do not re-explain the silver crack'],
      openMicroTensions: ['Link has not answered Zelda', 'right arm mutation is spreading']
    }
  })
  checks.push(assert(flexibleReview.ok, 'chapter review validator accepts arrays and objects as text-like output', flexibleReview))

  const invalidReview = validator.validateChapterReviewSchema({ summary: '', continuityBridgeSuggestion: {} })
  checks.push(
    assert(
      !invalidReview.ok && invalidReview.issues.some((issue) => issue.path === '$.endingHook'),
      'missing chapter review fields are reported before normalization can fill blanks',
      invalidReview
    )
  )

  const chapterDraft = validator.validateChapterDraftSchema({ chapterText: 'chapter body' })
  checks.push(assert(chapterDraft.ok, 'chapter draft validator accepts normalizer body aliases', chapterDraft))

  const flexibleChapterPlan = validator.validateChapterPlanSchema({
    chapterTitle: 'Chapter 4',
    chapterGoal: 'Continue from previous ending',
    conflictToPush: 'Push the central conflict',
    characterBeats: ['protagonist remains suspicious', 'heroine suppresses fear'],
    foreshadowingToUse: ['hint the silver crack', 'advance the old key clue'],
    foreshadowingNotToReveal: ['do not pay off the royal truth', 'do not explain the key origin'],
    endingHook: 'familiar breathing behind the door',
    readerEmotionTarget: 'tension and curiosity',
    estimatedWordCount: 4500,
    openingContinuationBeat: 'start seconds after the previous door opening',
    carriedPhysicalState: 'right arm burning',
    carriedEmotionalState: 'alert and shocked',
    unresolvedMicroTensions: ['Link has not answered Zelda', 'right arm mutation is spreading'],
    forbiddenResets: 'do not reintroduce the inverted city',
    allowedNovelty: ['allow one costly new instance hint'],
    forbiddenNovelty: ['forbid unforeshadowed rescue rules', 'forbid unauthorized named characters']
  })
  checks.push(assert(flexibleChapterPlan.ok, 'chapter plan validator accepts text-like output and novelty fields', flexibleChapterPlan))

  const invalidChapterPlan = validator.validateChapterPlanSchema({
    chapterTitle: 'Chapter 4',
    chapterGoal: 'Continue from previous ending',
    conflictToPush: 'Push central conflict',
    characterBeats: 'protagonist remains suspicious',
    foreshadowingToUse: null,
    foreshadowingNotToReveal: 'do not reveal the royal truth',
    endingHook: 'familiar breathing behind the door',
    readerEmotionTarget: 'tension and curiosity',
    estimatedWordCount: 4500,
    openingContinuationBeat: 'start seconds after door opening',
    carriedPhysicalState: 'right arm burning',
    carriedEmotionalState: 'alert and shocked',
    unresolvedMicroTensions: 'Link has not answered Zelda',
    forbiddenResets: 'do not reintroduce the inverted city',
    allowedNovelty: 'none',
    forbiddenNovelty: 'forbid unforeshadowed rescue rules'
  })
  checks.push(
    assert(
      !invalidChapterPlan.ok && invalidChapterPlan.issues.some((issue) => issue.path === '$.foreshadowingToUse'),
      'chapter plan validator still rejects null fields that cannot be safely converted into prompt text',
      invalidChapterPlan
    )
  )

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

  const invalidGateIssue = validator.validateQualityGateSchema({
    overallScore: 72,
    pass: false,
    dimensions: dimensionScores(),
    issues: [{ severity: 'urgent', type: 'foreshadowing_treatment_violation', description: 'early payoff' }],
    requiredFixes: [],
    optionalSuggestions: []
  })
  checks.push(
    assert(
      !invalidGateIssue.ok && invalidGateIssue.issues.some((issue) => issue.path === '$.issues[0].severity'),
      'quality gate validator checks issue severity and required issue fields',
      invalidGateIssue
    )
  )

  const invalidRevision = validator.validateRevisionResultSchema({ revisedText: 'revised text' })
  checks.push(
    assert(
      !invalidRevision.ok && invalidRevision.issues.some((issue) => issue.path === '$.changedSummary'),
      'revision result validator reports missing required metadata fields',
      invalidRevision
    )
  )

  const flexibleRevision = validator.validateRevisionResultSchema({
    revisedText: 'revised text',
    changedSummary: ['compressed repeated description', 'preserved facts'],
    risks: ['may reduce atmosphere'],
    preservedFacts: { location: 'old harbor', hook: 'breathing behind the door' }
  })
  checks.push(assert(flexibleRevision.ok, 'revision result validator accepts text-like metadata fields', flexibleRevision))

  const validMemoryPatch = validator.validateMemoryUpdatePatchSchema({
    schemaVersion: 1,
    kind: 'foreshadowing_status_update',
    summary: 'advance the silver key clue',
    sourceChapterOrder: 4,
    foreshadowingId: 'f1',
    suggestedStatus: 'partial',
    recommendedTreatmentMode: 'advance',
    actualPayoffChapter: null,
    evidenceText: 'the key heats up',
    notes: 'advance only, no payoff',
    warnings: []
  })
  checks.push(assert(validMemoryPatch.ok, 'structured memory update patch passes schema validation', validMemoryPatch))

  const invalidMemoryPatch = validator.validateMemoryUpdatePatchSchema({
    schemaVersion: 1,
    kind: 'foreshadowing_status_update',
    summary: 'bad status',
    foreshadowingId: 'f1',
    suggestedStatus: 'done',
    evidenceText: 'evidence',
    notes: ''
  })
  checks.push(
    assert(
      !invalidMemoryPatch.ok && invalidMemoryPatch.issues.some((issue) => issue.path === '$.suggestedStatus'),
      'memory update patch validator rejects invalid foreshadowing status',
      invalidMemoryPatch
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
      normalizerSource.includes('asText(obj.allowedNovelty)') && normalizerSource.includes('asText(obj.forbiddenNovelty)'),
      'AIResponseNormalizer normalizes novelty fields on chapter plans'
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
        pipelineSource.includes('allowedNovelty') &&
        pipelineSource.includes('forbiddenNovelty'),
      'generation pipeline AI calls pass schema validators and novelty fields'
    )
  )

  checks.push(
    assert(
      qualitySource.includes('validateQualityGateSchema') &&
        qualitySource.includes('validateRevisionCandidateSchema') &&
        qualitySource.includes('unauthorized_new_rule'),
      'quality gate AI calls pass schema validators and novelty guardrail instructions'
    )
  )

  checks.push(
    assert(
      qualitySource.includes('score < 80') &&
        normalizerSource.includes('overallScore >= 80') &&
        (await readFile(join(root, 'src', 'services', 'QualityGateService.ts'), 'utf-8')).includes('QUALITY_GATE_PASS_SCORE = 80'),
      'quality gate pass threshold is consistently set to 80'
    )
  )

  checks.push(
    assert(
      revisionSource.includes('validateRevisionResultSchema'),
      'revision AI calls pass revision result schema validator'
    )
  )

  const failed = checks.filter((check) => !check.ok)
  for (const check of checks) {
    console.log(`${check.ok ? '✓' : '✗'} ${check.message}`)
    if (!check.ok) console.log(JSON.stringify(check.details, null, 2))
  }
  if (failed.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
