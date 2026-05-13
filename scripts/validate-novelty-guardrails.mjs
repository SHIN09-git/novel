import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'novelty-guardrails-test')

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

async function main() {
  const checks = []
  const typesSource = (
    await Promise.all(
      [
        'src/shared/types.ts',
        'src/shared/types/generation.ts',
        'src/shared/types/memory.ts',
        'src/shared/types/quality.ts',
        'src/shared/types/trace.ts'
      ].map((file) => readFile(join(root, file), 'utf-8'))
    )
  ).join('\n')
  const promptBuilderSource = await readFile(join(root, 'src', 'services', 'PromptBuilderService.ts'), 'utf-8')
  const pipelineAiSource = await readFile(join(root, 'src', 'services', 'ai', 'GenerationPipelineAI.ts'), 'utf-8')
  const qualityGateSource = await readFile(join(root, 'src', 'services', 'QualityGateService.ts'), 'utf-8')
  const qualityGateAiSource = await readFile(join(root, 'src', 'services', 'ai', 'QualityGateAI.ts'), 'utf-8')
  const runnerSource = (
    await Promise.all(
      [
        'src/renderer/src/views/generation/usePipelineRunner.ts',
        'src/renderer/src/views/generation/usePipelineRunnerCore.ts',
        'src/renderer/src/views/generation/pipelineRunnerEngine.ts',
        'src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts',
        'src/renderer/src/views/generation/pipelineSteps/memoryExtraction.ts',
        'src/renderer/src/views/generation/pipelineSteps/qualityCheck.ts',
        'src/renderer/src/views/generation/pipelineUtils.ts'
      ].map((file) => readFile(join(root, file), 'utf-8'))
    )
  ).join('\n')
  const runTraceSource = await readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'RunTracePanel.tsx'), 'utf-8')
  const runTests = await readFile(join(root, 'scripts', 'run-tests.mjs'), 'utf-8')

  checks.push(assert(typesSource.includes('interface ChapterNoveltyPolicy'), 'ChapterNoveltyPolicy type exists'))
  checks.push(
    assert(
      typesSource.includes('allowedSystemMechanicTopics') &&
        typesSource.includes('allowedOrganizationOrRankTopics') &&
        typesSource.includes('forbiddenSystemMechanicTopics') &&
        typesSource.includes('sourceHint?: string | null'),
      'ChapterNoveltyPolicy and NoveltyFinding carry extended trace fields'
    )
  )
  checks.push(assert(typesSource.includes("'deus_ex_rule'"), 'NoveltyFindingKind supports deus_ex_rule'))
  checks.push(assert(typesSource.includes('allowedNovelty') && typesSource.includes('forbiddenNovelty'), 'ChapterPlan carries allowedNovelty / forbiddenNovelty'))
  checks.push(
    assert(
      pipelineAiSource.includes('allowedNovelty') &&
        pipelineAiSource.includes('forbiddenNovelty') &&
        pipelineAiSource.includes('unforeshadowed rescue rules') &&
        pipelineAiSource.includes('Do not name unknown people'),
      'chapter plan and draft prompts include novelty guardrails'
    )
  )
  checks.push(
    assert(
      !promptBuilderSource.includes('Novelty guardrail:') &&
        !promptBuilderSource.includes('Rule horror / infinite-flow constraint:') &&
        promptBuilderSource.includes('NoveltyPolicy'),
      'PromptBuilderService keeps novelty constraints in the Chinese final prompt without duplicate English guardrails'
    )
  )
  checks.push(
    assert(
      promptBuilderSource.includes('不得为了让主角脱困而临时新增刚好可用的规则') &&
        promptBuilderSource.includes('不得新增未授权命名角色') &&
        promptBuilderSource.includes('系统面板补充条款'),
      'final prose prompt includes concrete novelty hard constraints'
    )
  )
  checks.push(
    assert(
      qualityGateAiSource.includes('unauthorized_new_rule') && qualityGateAiSource.includes('deus_ex_rule_patch'),
      'quality gate AI prompt asks for novelty issues'
    )
  )
  checks.push(
    assert(
      pipelineAiSource.includes('Do not treat a convenient rule that first appears in the draft as established canon'),
      'draft prompt forbids treating newly convenient rules as established canon without trace/task support'
    )
  )
  checks.push(
    assert(
      qualityGateSource.includes('NoveltyDetector') && qualityGateSource.includes('applyNoveltyAudit'),
      'QualityGateService applies local novelty audit'
    )
  )
  checks.push(
    assert(
      runnerSource.includes('noveltyAuditResult') &&
        runnerSource.includes('NoveltyDetector.audit') &&
        runnerSource.includes('noveltyWarnings') &&
        runnerSource.includes('noveltyAdjustedConfidence'),
      'pipeline stores novelty audit and marks memory candidates with novelty warnings'
    )
  )
  checks.push(assert(runTraceSource.includes('noveltyAuditResult'), 'Run Trace displays novelty audit result'))

  const { NoveltyDetector, createDefaultNoveltyPolicy } = await loadTsModule('src/services/NoveltyDetector.ts')
  const strictPlan = {
    chapterTitle: '第 11 章',
    chapterGoal: '主角利用已知规则脱困',
    conflictToPush: '不要引入新系统条款',
    characterBeats: '',
    foreshadowingToUse: '',
    foreshadowingNotToReveal: '',
    endingHook: '',
    readerEmotionTarget: '',
    estimatedWordCount: '',
    openingContinuationBeat: '',
    carriedPhysicalState: '',
    carriedEmotionalState: '',
    unresolvedMicroTensions: '',
    forbiddenResets: '',
    allowedNovelty: '无',
    forbiddenNovelty: '禁止新增未铺垫救命规则；禁止新增未授权命名角色'
  }

  const nameAudit = NoveltyDetector.audit({
    generatedText: '门后站着一个名叫林小雨的女孩，她低声说这里还有另一套规则。',
    context: '已有角色：周烬、沈雁。',
    chapterPlan: strictPlan
  })
  checks.push(assert(nameAudit.newNamedCharacters.length > 0, 'NoveltyDetector detects unauthorized new named character', nameAudit))

  const ruleAudit = NoveltyDetector.audit({
    generatedText: '系统面板弹出附加条款：手动评定立即生效，所有人获得豁免并安全脱困。',
    context: '已知规则：午夜前必须离开大厅。',
    chapterPlan: strictPlan
  })
  checks.push(assert(ruleAudit.severity === 'fail' && ruleAudit.suspiciousDeusExRules.length > 0, 'NoveltyDetector fails deus-ex rescue rule patches', ruleAudit))
  checks.push(
    assert(
      ruleAudit.suspiciousDeusExRules.every((finding) => finding.severity === 'fail' && 'sourceHint' in finding),
      'NoveltyDetector findings use novelty severity and sourceHint',
      ruleAudit.suspiciousDeusExRules
    )
  )
  checks.push(
    assert(
      ruleAudit.suspiciousDeusExRules.some((finding) => finding.kind === 'deus_ex_rule' || finding.kind === 'suspicious_deus_ex_rule'),
      'NoveltyDetector labels deus-ex rule findings with a compatible kind',
      ruleAudit.suspiciousDeusExRules
    )
  )

  const mechanismAudit = NoveltyDetector.audit({
    generatedText:
      '\u6838\u5fc3\u5355\u5143\u53ef\u643a\u5e26\u4e09\u540d\u534f\u540c\u5355\u5143\uff0c\u4e94\u7c73\u8303\u56f4\u5185\u5171\u4eab\u8eab\u4efd\uff0c\u7acb\u5373\u5f3a\u5236\u653e\u884c\u3002',
    context: '\u5df2\u77e5\u89c4\u5219\uff1a\u53ea\u80fd\u4e00\u4eba\u901a\u8fc7\u95e8\u7981\u3002',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      mechanismAudit.newSystemMechanics.length > 0 && mechanismAudit.severity === 'fail',
      'NoveltyDetector flags core/cooperation/shared-identity system mechanic risks',
      mechanismAudit
    )
  )

  const allowedPolicy = createDefaultNoveltyPolicy({
    ...strictPlan,
    allowedNovelty: '允许新增副本规则：手动评定，但必须带来代价',
    forbiddenNovelty: ''
  })
  const allowedAudit = NoveltyDetector.audit({
    generatedText: '手动评定规则出现，但它要求主角失去一次投票资格作为代价。',
    context: '任务书允许新增副本规则：手动评定。',
    chapterPlan: { ...strictPlan, allowedNovelty: '允许新增副本规则：手动评定，但必须带来代价', forbiddenNovelty: '' },
    noveltyPolicy: allowedPolicy
  })
  checks.push(assert(allowedAudit.severity !== 'fail', 'task-allowed new rule with cost is not treated as hard fail', allowedAudit))

  const priorRuleAudit = NoveltyDetector.audit({
    generatedText: '\u4e3b\u89d2\u518d\u6b21\u4f7f\u7528\u624b\u52a8\u8bc4\u5b9a\u89c4\u5219\uff0c\u4ed8\u51fa\u4e00\u6b21\u6295\u7968\u8d44\u683c\u540e\u624d\u901a\u8fc7\u95e8\u7981\u3002',
    context: '\u5df2\u77e5\u89c4\u5219\uff1a\u624b\u52a8\u8bc4\u5b9a\u9700\u8981\u6263\u9664\u4e00\u6b21\u6295\u7968\u8d44\u683c\u4f5c\u4e3a\u4ee3\u4ef7\u3002',
    chapterPlan: strictPlan
  })
  checks.push(assert(priorRuleAudit.severity === 'pass', 'previously traced rule reuse is not escalated as new novelty', priorRuleAudit))

  const costlyRuleAudit = NoveltyDetector.audit({
    generatedText: '\u7cfb\u7edf\u9762\u677f\u5f39\u51fa\u8865\u5145\u8bf4\u660e\uff1a\u53ef\u4ee5\u5f00\u542f\u7279\u6b8a\u901a\u9053\uff0c\u4f46\u9700\u8981\u6c38\u4e45\u5931\u53bb\u4e00\u9879\u5df2\u6709\u6743\u9650\u4f5c\u4e3a\u4ee3\u4ef7\u3002',
    context: '\u5df2\u77e5\u89c4\u5219\uff1a\u95e8\u7981\u5fc5\u987b\u4f7f\u7528\u5df2\u6709\u8eab\u4efd\u901a\u8fc7\u3002',
    chapterPlan: strictPlan
  })
  checks.push(assert(costlyRuleAudit.severity === 'warning', 'unauthorized but costly new rule is downgraded to review warning, not hard fail', costlyRuleAudit))

  const allowedNameAudit = NoveltyDetector.audit({
    generatedText: '\u95e8\u540e\u7684\u5973\u5b69\u540d\u53eb\u6797\u5c0f\u96e8\uff0c\u5979\u662f\u4efb\u52a1\u4e66\u5141\u8bb8\u51fa\u573a\u7684\u65b0\u89d2\u8272\u3002',
    context: '\u5df2\u6709\u89d2\u8272\uff1a\u5468\u70ec\u3001\u6c88\u77e5\u4e88\u3002',
    chapterPlan: { ...strictPlan, allowedNovelty: '\u5141\u8bb8\u65b0\u589e\u547d\u540d\u89d2\u8272\uff1a\u6797\u5c0f\u96e8', forbiddenNovelty: '' }
  })
  checks.push(assert(allowedNameAudit.severity === 'pass', 'task-allowed named character is recorded without warning/fail severity', allowedNameAudit))

  const knownNameAudit = NoveltyDetector.audit({
    generatedText: '\u5468\u70ec\u4f4e\u58f0\u8bf4\u9053\uff1a\u201c\u8fd9\u6761\u8def\u4e0d\u80fd\u8d70\u3002\u201d',
    context: '\u5df2\u6709\u89d2\u8272\uff1a\u5468\u70ec\u3001\u6c88\u77e5\u4e88\u3002',
    chapterPlan: strictPlan
  })
  checks.push(assert(knownNameAudit.newNamedCharacters.length === 0, 'existing character names are not reported as new named characters', knownNameAudit))

  const numberedAdminAudit = NoveltyDetector.audit({
    generatedText: '\u533a\u57df\u7ba1\u7406\u5458-03\u5728\u95e8\u53e3\u8bb0\u5f55\u4e86\u6240\u6709\u4eba\u7684\u7f16\u53f7\u3002',
    context: '\u5df2\u6709\u89d2\u8272\uff1a\u5468\u70ec\u3002',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      numberedAdminAudit.newOrganizationsOrRanks.length > 0 && numberedAdminAudit.newNamedCharacters.length === 0,
      'numbered administrator identities are classified as organization/rank, not ordinary named characters',
      numberedAdminAudit
    )
  )

  const orgAudit = NoveltyDetector.audit({
    generatedText: '区域管理员推开门，宣布总部已经接管这个副本。',
    context: '已有角色：周烬。',
    chapterPlan: strictPlan
  })
  checks.push(assert(orgAudit.newOrganizationsOrRanks.length > 0, 'NoveltyDetector flags new admin / organization hierarchy', orgAudit))

  const loreAudit = NoveltyDetector.audit({
    generatedText: '他终于看见系统核心的完整真相：所有意识剥离后都会进入冗余池。',
    context: '本章没有允许揭示系统真相。',
    chapterPlan: strictPlan
  })
  checks.push(assert(loreAudit.majorLoreReveals.length > 0 && loreAudit.severity === 'fail', 'NoveltyDetector flags unauthorized major lore reveal', loreAudit))

  checks.push(
    assert(
      runnerSource.includes('warnings: auditWarnings') && runnerSource.includes('noveltyAdjustedConfidence'),
      'memory update candidates keep novelty warnings and lower confidence when audit fails'
    )
  )
  checks.push(
    assert(
      typesSource.includes('warnings?: string[]') && runnerSource.includes('warnings: auditWarnings'),
      'MemoryUpdatePatch/candidates can carry novelty risk warnings'
    )
  )
  checks.push(
    assert(
      runTraceSource.includes('noveltyAuditResult') && runTraceSource.includes('noveltyAuditResult.severity'),
      'Run Trace UI exposes a novelty audit section'
    )
  )
  const detectorSource = await readFile(join(root, 'src', 'services', 'NoveltyDetector.ts'), 'utf-8')
  checks.push(
    assert(
      detectorSource.includes('traceContextText') && detectorSource.includes('forcedContextBlocks') && detectorSource.includes('promptBlockOrder'),
      'NoveltyDetector can account for trace/forced context inputs without changing selection data'
    )
  )

  checks.push(
    assert(
      runTests.includes('validate-novelty-guardrails.mjs'),
      'npm test runs validate-novelty-guardrails.mjs'
    )
  )

  const failed = checks.filter((check) => !check.ok)
  for (const check of checks) {
    console.log(`${check.ok ? '✓' : '✗'} ${check.message}`)
    if (!check.ok) console.log(JSON.stringify(check.details, null, 2))
  }
  if (failed.length) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
