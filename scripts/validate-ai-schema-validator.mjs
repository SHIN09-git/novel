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
  const normalizerSource = await readFile(join(root, 'src', 'services', 'ai', 'AIResponseNormalizer.ts'), 'utf-8')
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

  const flexibleReview = validator.validateChapterReviewSchema({
    summary: ['上一章从密道钩子接起', '主角确认右臂异变仍在扩散'],
    newInformation: { rule: '银灰裂纹会响应旧钥匙', cost: '靠近时会短暂失温' },
    characterChanges: ['女主开始怀疑主角隐瞒关键事实'],
    newForeshadowing: ['旧钥匙发热', '墙上出现银灰裂纹'],
    resolvedForeshadowing: ['旧照片中的符号被部分解释'],
    endingHook: '门后传来熟悉的呼吸声',
    riskWarnings: ['不要回收主谜团', '不要让角色直接说破'],
    continuityBridgeSuggestion: {
      lastSceneLocation: '密道尽头的铁门前',
      lastPhysicalState: ['右臂灼痛', '呼吸紊乱'],
      lastEmotionalState: '警惕和震惊',
      lastUnresolvedAction: '刚把手按在门把上，还没有推开',
      lastDialogueOrThought: { thought: '门后的人为什么知道我的名字？' },
      immediateNextBeat: '从推门后的几秒开始',
      mustContinueFrom: '接住门后呼吸声这个钩子',
      mustNotReset: ['不要重新介绍倒悬都市', '不要重复解释银灰裂纹'],
      openMicroTensions: ['林克没有回答塞尔达', '右臂异变还在扩散']
    }
  })
  checks.push(
    assert(
      flexibleReview.ok,
      'chapter review validator accepts text-like AI outputs such as arrays and objects',
      flexibleReview
    )
  )

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


  const flexibleChapterPlan = validator.validateChapterPlanSchema({
    chapterTitle: '第 4 章',
    chapterGoal: '承接上一章结尾',
    conflictToPush: '推进主线冲突',
    characterBeats: ['主角保持怀疑', '女主压住恐惧'],
    foreshadowingToUse: ['只暗示银灰裂纹', '推进旧钥匙线索'],
    foreshadowingNotToReveal: ['不要回收王室真相', '不要解释钥匙来源'],
    endingHook: '门后传来熟悉的声音',
    readerEmotionTarget: '紧张、好奇',
    estimatedWordCount: 4500,
    openingContinuationBeat: '从上一章开门动作后的几秒开始',
    carriedPhysicalState: '右臂灼痛',
    carriedEmotionalState: '警惕和震惊',
    unresolvedMicroTensions: ['林克没有回答塞尔达', '右臂异变还在扩散'],
    forbiddenResets: '不要重新介绍倒悬都市'
  })
  checks.push(
    assert(
      flexibleChapterPlan.ok,
      'chapter plan validator accepts common text-like AI outputs such as arrays and numeric word counts',
      flexibleChapterPlan
    )
  )

  const invalidChapterPlan = validator.validateChapterPlanSchema({
    chapterTitle: '第 4 章',
    chapterGoal: '承接上一章结尾',
    conflictToPush: '推进主线冲突',
    characterBeats: '主角保持怀疑',
    foreshadowingToUse: null,
    foreshadowingNotToReveal: '不要回收王室真相',
    endingHook: '门后传来熟悉的声音',
    readerEmotionTarget: '紧张、好奇',
    estimatedWordCount: 4500,
    openingContinuationBeat: '从上一章开门动作后的几秒开始',
    carriedPhysicalState: '右臂灼痛',
    carriedEmotionalState: '警惕和震惊',
    unresolvedMicroTensions: '林克没有回答塞尔达',
    forbiddenResets: '不要重新介绍倒悬都市'
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
    dimensions: {
      plotCoherence: 70,
      characterConsistency: 80,
      foreshadowingControl: 64,
      chapterContinuity: 88,
      redundancyControl: 92,
      styleMatch: 75,
      pacing: 77,
      emotionalPayoff: 73,
      originality: 80,
      promptCompliance: 82
    },
    issues: [{ severity: 'urgent', type: 'foreshadowing_treatment_violation', description: '提前回收伏笔' }],
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

  const invalidRevision = validator.validateRevisionResultSchema({ revisedText: '修订文本' })
  checks.push(
    assert(
      !invalidRevision.ok && invalidRevision.issues.some((issue) => issue.path === '$.changedSummary'),
      'revision result validator reports missing required metadata fields',
      invalidRevision
    )
  )

  const flexibleRevision = validator.validateRevisionResultSchema({
    revisedText: '修订文本',
    changedSummary: ['压缩重复描写', '保留事实'],
    risks: ['可能削弱氛围'],
    preservedFacts: { location: '旧港区', hook: '门后有呼吸声' }
  })
  checks.push(assert(flexibleRevision.ok, 'revision result validator accepts text-like metadata fields', flexibleRevision))

  const validMemoryPatch = validator.validateMemoryUpdatePatchSchema({
    schemaVersion: 1,
    kind: 'foreshadowing_status_update',
    summary: '推进银灰钥匙伏笔',
    sourceChapterOrder: 4,
    foreshadowingId: 'f1',
    suggestedStatus: 'partial',
    recommendedTreatmentMode: 'advance',
    actualPayoffChapter: null,
    evidenceText: '钥匙发热',
    notes: '只推进，不回收',
    warnings: []
  })
  checks.push(assert(validMemoryPatch.ok, 'structured memory update patch passes schema validation', validMemoryPatch))

  const invalidMemoryPatch = validator.validateMemoryUpdatePatchSchema({
    schemaVersion: 1,
    kind: 'foreshadowing_status_update',
    summary: '错误状态',
    foreshadowingId: 'f1',
    suggestedStatus: 'done',
    evidenceText: '证据',
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
    assert(
      normalizerSource.includes('changedSummary: asText(obj.changedSummary)') &&
        normalizerSource.includes('risks: asText(obj.risks)') &&
        normalizerSource.includes('preservedFacts: asText(obj.preservedFacts)'),
      'revision normalizer preserves array/object metadata by converting it to text'
    )
  )

  checks.push(
    assert(
      normalizerSource.includes('newForeshadowing: asText(obj.newForeshadowing)') &&
        normalizerSource.includes('resolvedForeshadowing: asText(obj.resolvedForeshadowing)') &&
        normalizerSource.includes('riskWarnings: asText(obj.riskWarnings)') &&
        normalizerSource.includes('openMicroTensions: asText(bridge.openMicroTensions)'),
      'chapter review normalizer preserves array/object review fields by converting them to text'
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

