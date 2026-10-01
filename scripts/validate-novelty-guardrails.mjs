import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'novelty-guardrails-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function loadTsModule(relativePath) {
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `${relativePath.replace(/[\\/.:]/g, '-')}.mjs`)
  await build({
    entryPoints: [join(root, relativePath)],
    outfile: outPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
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
  const promptPolicySource = `${promptBuilderSource}\n${await readFile(join(root, 'src', 'services', 'promptFormatters', 'promptUtils.ts'), 'utf-8')}`
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
        'src/renderer/src/views/generation/pipelineSteps/postDraftAnalysis.ts',
        'src/renderer/src/views/generation/pipelineSteps/memoryExtraction.ts',
        'src/renderer/src/views/generation/pipelineSteps/qualityCheck.ts',
        'src/renderer/src/views/generation/pipelineUtils.ts'
      ].map((file) => readFile(join(root, file), 'utf-8'))
    )
  ).join('\n')
  const runTraceSource = await readFile(join(root, 'src', 'renderer', 'src', 'components', 'pipeline', 'PipelineTracePanel.tsx'), 'utf-8')
  const runTests = await readFile(join(root, 'scripts', 'run-tests.mjs'), 'utf-8')

  checks.push(assert(typesSource.includes('interface ChapterNoveltyPolicy'), 'ChapterNoveltyPolicy type exists'))
  checks.push(
    assert(
      typesSource.includes('allowedSystemMechanicTopics') &&
        typesSource.includes('allowedOrganizationOrRankTopics') &&
        typesSource.includes('forbiddenSystemMechanicTopics') &&
        typesSource.includes('sourceHint?: string | null') &&
        typesSource.includes('interface NoveltySemanticEvidence'),
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
      promptPolicySource.includes('NoveltyPolicy：不得新增任务未授权的人物、地点、组织、规则、机制或关键道具。') &&
        promptPolicySource.includes('不得为了让角色脱困而临时新增刚好可用的设定') &&
        promptPolicySource.includes('不得给未知人物擅自命名'),
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
      pipelineAiSource.includes('Do not solve a small conflict with a new convenience introduced only in this draft') &&
        pipelineAiSource.includes('Crisis resolution must come from provided rules, already foreshadowed clues, existing character abilities/resources, or mechanisms explicitly allowed in the chapter plan') &&
        pipelineAiSource.includes('Do not convert unauthorized new lore into stable canon'),
      'opening and later-chapter draft prompts reject convenient new rules and unauthorized stable canon'
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
        runnerSource.includes('auditNoveltyDiagnostic') &&
        runnerSource.includes('noveltyWarnings') &&
        runnerSource.includes('noveltyAdjustedConfidence'),
      'pipeline stores novelty audit and marks memory candidates with novelty warnings'
    )
  )
  checks.push(
    assert(
      runTraceSource.includes('noveltyAuditResult') && runTraceSource.includes('noveltySemanticSummary'),
      'Run Trace displays novelty audit result and structured semantic evidence'
    )
  )

  const { NoveltyDetector, createDefaultNoveltyPolicy } = await loadTsModule('src/services/NoveltyDetector.ts')
  const { QualityGateService } = await loadTsModule('src/services/QualityGateService.ts')
  const { collectNoveltyReviewFindings } = await loadTsModule('src/shared/noveltyReview.ts')
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
      ruleAudit.suspiciousDeusExRules.length === 1,
      'one rescue-rule incident produces one primary deus-ex finding',
      ruleAudit.suspiciousDeusExRules
    )
  )
  const ruleReviewFindings = collectNoveltyReviewFindings(ruleAudit)
  checks.push(
    assert(
      ruleReviewFindings.filter((finding) => finding.kind === 'deus_ex_rule').length === 1 &&
        !ruleReviewFindings.some(
          (finding) => finding.kind === 'new_world_rule' || finding.kind === 'new_system_mechanic'
        ),
      'author-facing novelty review collapses ordinary rule duplicates behind the deus-ex finding',
      ruleReviewFindings
    )
  )
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

  const synonymPriorAudit = NoveltyDetector.audit({
    generatedText: '紧急通行权再次亮起，但没有改变既有规则，也没有解除眼前危机。',
    context: '已知规则：临时权限只能使用一次。',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      synonymPriorAudit.severity === 'pass',
      'NoveltyDetector uses rule synonyms when checking prior context',
      synonymPriorAudit
    )
  )

  const ordinaryPanelAudit = NoveltyDetector.audit({
    generatedText: '系统面板亮起，显示倒计时还剩三分钟。',
    context: '系统面板用于显示任务倒计时。',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      ordinaryPanelAudit.newSystemMechanics.length === 0 && ordinaryPanelAudit.severity === 'pass',
      'ordinary system-panel references are not treated as new mechanics',
      ordinaryPanelAudit
    )
  )

  const mundaneSourceAudit = NoveltyDetector.audit({
    generatedText: '他循着脚步声找到了声音源头。',
    context: '',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      mundaneSourceAudit.majorLoreReveals.length === 0,
      'mundane sensory source wording is not treated as a lore reveal',
      mundaneSourceAudit
    )
  )

  const physicalRangeAudit = NoveltyDetector.audit({
    generatedText: '五米范围内灯光昏暗，墙边堆着潮湿的纸箱。',
    context: '',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      physicalRangeAudit.newWorldRules.length === 0 && physicalRangeAudit.newSystemMechanics.length === 0,
      'ordinary physical ranges are not treated as system rules',
      physicalRangeAudit
    )
  )

  const routineHierarchyAudit = NoveltyDetector.audit({
    generatedText: '值班员向上级汇报了伤亡情况。',
    context: '',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      routineHierarchyAudit.newOrganizationsOrRanks.length === 0,
      'routine references to an unspecified superior do not invent a hierarchy',
      routineHierarchyAudit
    )
  )

  const costlyRuleAudit = NoveltyDetector.audit({
    generatedText: '\u7cfb\u7edf\u9762\u677f\u5f39\u51fa\u8865\u5145\u8bf4\u660e\uff1a\u53ef\u4ee5\u5f00\u542f\u7279\u6b8a\u901a\u9053\uff0c\u4f46\u9700\u8981\u6c38\u4e45\u5931\u53bb\u4e00\u9879\u5df2\u6709\u6743\u9650\u4f5c\u4e3a\u4ee3\u4ef7\u3002',
    context: '\u5df2\u77e5\u89c4\u5219\uff1a\u95e8\u7981\u5fc5\u987b\u4f7f\u7528\u5df2\u6709\u8eab\u4efd\u901a\u8fc7\u3002',
    chapterPlan: strictPlan
  })
  checks.push(assert(costlyRuleAudit.severity === 'warning', 'unauthorized but costly new rule is downgraded to review warning, not hard fail', costlyRuleAudit))

  const unrelatedCostAudit = NoveltyDetector.audit({
    generatedText: '系统突然授予临时权限，门禁立即强制放行。陈屿仍在为昨天的旧伤付出代价。',
    context: '已知规则：门禁只识别原有身份。',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      unrelatedCostAudit.severity === 'fail' && unrelatedCostAudit.suspiciousDeusExRules.length > 0,
      'an unrelated nearby cost does not excuse a deus-ex rule',
      unrelatedCostAudit
    )
  )

  const unrelatedMediumAudit = NoveltyDetector.audit({
    generatedText: '他把旧档案塞进口袋。系统突然授予临时权限，门禁立即强制放行。',
    context: '已知规则：门禁只识别原有身份。',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      unrelatedMediumAudit.severity === 'fail' && unrelatedMediumAudit.suspiciousDeusExRules.length > 0,
      'an unrelated record or archive does not authorize a rescue rule',
      unrelatedMediumAudit
    )
  )

  const linkedCostAudit = NoveltyDetector.audit({
    generatedText: '系统授予临时权限，可立即放行，但使用该权限会永久失去一段记忆。',
    context: '已知规则：门禁只识别原有身份。',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      linkedCostAudit.suspiciousDeusExRules.length === 0 && linkedCostAudit.severity === 'warning',
      'a cost directly linked to the new rule downgrades it to review instead of deus-ex fail',
      linkedCostAudit
    )
  )

  const repeatedKeywordAudit = NoveltyDetector.audit({
    generatedText: '临时权限四个字在旧记录里一闪而过。追兵逼近时，系统突然授予临时权限，门禁立即强制放行。',
    context: '已知规则：门禁只识别原有身份。',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      repeatedKeywordAudit.suspiciousDeusExRules.length > 0,
      'a benign first mention cannot hide a later deus-ex occurrence of the same keyword',
      repeatedKeywordAudit
    )
  )

  const beneficiaryAudit = NoveltyDetector.audit({
    generatedText: '追兵已经封锁出口。五米保护范围内，全员共享临时身份，因此门禁直接放行。',
    context: '已知规则：每人只能使用自己的身份。',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      beneficiaryAudit.suspiciousDeusExRules.some(
        (finding) => finding.semanticEvidence?.beneficiary === '全员' && Boolean(finding.semanticEvidence?.resolutionCue)
      ),
      'deus-ex findings retain beneficiary and crisis-resolution evidence',
      beneficiaryAudit
    )
  )

  const openingRuleAudit = NoveltyDetector.audit({
    generatedText:
      '\u516c\u544a\u724c\u4e0a\u5199\u7740\u65b0\u526f\u672c\u89c4\u5219\uff1a\u624b\u52a8\u8bc4\u5b9a\u53ef\u4ee5\u5f00\u542f\uff0c\u4f46\u6bcf\u6b21\u4f7f\u7528\u90fd\u9700\u8981\u5931\u53bb\u4e00\u6b21\u6295\u7968\u8d44\u683c\u3002',
    context: '\u4e3b\u89d2\u521a\u8fdb\u5165\u65b0\u526f\u672c\u95e8\u5385\u3002',
    chapterPlan: {
      ...strictPlan,
      chapterGoal: '\u65b0\u526f\u672c\u5f00\u573a\uff0c\u901a\u8fc7\u516c\u544a\u5448\u73b0\u5165\u573a\u89c4\u5219',
      allowedNovelty: '\u5141\u8bb8\u65b0\u589e\u526f\u672c\u89c4\u5219\uff1a\u624b\u52a8\u8bc4\u5b9a\uff0c\u5fc5\u987b\u901a\u8fc7\u516c\u544a\u5448\u73b0\u5e76\u5e26\u6765\u4ee3\u4ef7',
      forbiddenNovelty: ''
    }
  })
  checks.push(assert(openingRuleAudit.severity === 'pass', 'new instance opening rule through an in-world medium with cost is not escalated', openingRuleAudit))

  const climaxPatchAudit = NoveltyDetector.audit({
    generatedText:
      '\u7cfb\u7edf\u9762\u677f\u7a81\u7136\u5f39\u51fa\u8865\u5145\u6761\u6b3e\uff1a\u6838\u5fc3\u5355\u5143\u53ef\u7acb\u5373\u5f3a\u5236\u653e\u884c\uff0c\u6240\u6709\u60e9\u7f5a\u8c41\u514d\u3002',
    context: '\u5df2\u77e5\u89c4\u5219\uff1a\u53ea\u80fd\u4f7f\u7528\u5df2\u6709\u8eab\u4efd\u901a\u8fc7\u95e8\u7981\u3002',
    chapterPlan: { ...strictPlan, chapterGoal: '\u9ad8\u6f6e\u89e3\u6cd5\u7ae0\uff0c\u4e3b\u89d2\u5fc5\u987b\u5229\u7528\u5df2\u6709\u89c4\u5219\u8131\u56f0' }
  })
  checks.push(assert(climaxPatchAudit.severity === 'fail', 'climax solution still fails unearned rescue patches', climaxPatchAudit))
  checks.push(assert(climaxPatchAudit.suspiciousDeusExRules.length > 0, 'climax rescue patches remain classified as deus-ex findings even when presented as system UI', climaxPatchAudit))

  const allowedNameAudit = NoveltyDetector.audit({
    generatedText: '\u95e8\u540e\u7684\u5973\u5b69\u540d\u53eb\u6797\u5c0f\u96e8\uff0c\u5979\u662f\u4efb\u52a1\u4e66\u5141\u8bb8\u51fa\u573a\u7684\u65b0\u89d2\u8272\u3002',
    context: '\u5df2\u6709\u89d2\u8272\uff1a\u5468\u70ec\u3001\u6c88\u77e5\u4e88\u3002',
    chapterPlan: { ...strictPlan, allowedNovelty: '\u5141\u8bb8\u65b0\u589e\u547d\u540d\u89d2\u8272\uff1a\u6797\u5c0f\u96e8', forbiddenNovelty: '' }
  })
  checks.push(assert(allowedNameAudit.severity === 'pass', 'task-allowed named character is recorded without warning/fail severity', allowedNameAudit))

  const limitedNameAudit = NoveltyDetector.audit({
    generatedText: '门后名叫林小雨的女孩伸出手，旁边名叫周小雪的女孩也报上姓名。',
    context: '已有角色：周烬。',
    chapterPlan: { ...strictPlan, allowedNovelty: '允许新增命名角色', forbiddenNovelty: '' },
    noveltyPolicy: {
      ...createDefaultNoveltyPolicy({ ...strictPlan, allowedNovelty: '允许新增命名角色', forbiddenNovelty: '' }),
      allowNewNamedCharacters: true,
      maxNewNamedCharacters: 1
    }
  })
  checks.push(
    assert(
      limitedNameAudit.newNamedCharacters.some((finding) => finding.sourceHint === 'novelty_policy_limit_exceeded'),
      'NoveltyPolicy maxNewNamedCharacters 会标记超额新增角色',
      limitedNameAudit
    )
  )

  const knownReferenceAudit = NoveltyDetector.audit({
    generatedText: '林小雨低声说道：“继续走。”系统再次启用手动评定。',
    context: '',
    knownCharacterNames: ['林小雨'],
    knownCanonTexts: ['手动评定是既有规则，需要扣除一次投票资格。'],
    chapterPlan: strictPlan
  })
  checks.push(assert(knownReferenceAudit.newNamedCharacters.length === 0, 'NoveltyDetector 会读取结构化已知角色引用，避免未选中角色误报', knownReferenceAudit))
  checks.push(assert(knownReferenceAudit.severity === 'pass', 'HardCanon 中已有规则复用不会被误判为新规则', knownReferenceAudit))

  const knownNameAudit = NoveltyDetector.audit({
    generatedText: '\u5468\u70ec\u4f4e\u58f0\u8bf4\u9053\uff1a\u201c\u8fd9\u6761\u8def\u4e0d\u80fd\u8d70\u3002\u201d',
    context: '\u5df2\u6709\u89d2\u8272\uff1a\u5468\u70ec\u3001\u6c88\u77e5\u4e88\u3002',
    chapterPlan: strictPlan
  })
  checks.push(assert(knownNameAudit.newNamedCharacters.length === 0, 'existing character names are not reported as new named characters', knownNameAudit))

  const actionAdverbAudit = NoveltyDetector.audit({
    generatedText:
      '\u963f\u9619\u6ca1\u6709\u7acb\u523b\u56de\u7b54\u3002\u5c9a\u5f26\u6ca1\u6709\u56de\u7b54\u3002\u606f\u70ec\u7acb\u523b\u6309\u4f4f\u5979\u7684\u624b\u81c2\u3002',
    context: '\u5df2\u6709\u89d2\u8272\uff1a\u963f\u9619\u3001\u5c9a\u5f26\u3001\u606f\u70ec\u3002',
    chapterPlan: strictPlan
  })
  checks.push(
    assert(
      actionAdverbAudit.newNamedCharacters.length === 0,
      'Chinese action adverbs after known names are not reported as new named characters',
      actionAdverbAudit
    )
  )

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

  const strongDimensions = {
    plotCoherence: 92,
    characterConsistency: 92,
    characterStateConsistency: 92,
    foreshadowingControl: 92,
    chapterContinuity: 92,
    redundancyControl: 92,
    styleMatch: 92,
    pacing: 92,
    emotionalPayoff: 92,
    originality: 92,
    promptCompliance: 92,
    contextRelevanceCompliance: 92
  }
  const optimisticAi = {
    async generateQualityGateReport() {
      return { data: { overallScore: 92, pass: true, dimensions: strongDimensions, issues: [], requiredFixes: [], optionalSuggestions: [] } }
    }
  }
  const suppliedAuditReport = await QualityGateService.evaluateChapterDraft({
    projectId: 'project-1',
    jobId: 'job-1',
    chapterId: null,
    draftId: 'draft-1',
    chapterDraft: { title: '测试章', body: '他沿着长廊继续前进。'.repeat(300) },
    context: '',
    chapterPlan: null,
    noveltyAuditResult: ruleAudit,
    aiService: optimisticAi
  })
  checks.push(assert(!suppliedAuditReport.pass && suppliedAuditReport.issues.some((issue) => issue.type === 'deus_ex_rule_patch'), '质量门禁复用流水线 NoveltyAuditResult，不会独立重算出分叉结论', suppliedAuditReport))
  checks.push(
    assert(
      suppliedAuditReport.issues.filter((issue) => issue.type === 'deus_ex_rule_patch').length === 1 &&
        !suppliedAuditReport.issues.some((issue) => issue.type === 'unauthorized_new_rule'),
      '质量门禁不会为同一机械降神事件重复生成普通规则问题',
      suppliedAuditReport
    )
  )
  checks.push(
    assert(
      suppliedAuditReport.issues.some(
        (issue) => issue.type === 'deus_ex_rule_patch' && /受益对象|解除动作/.test(issue.evidence)
      ),
      '质量门禁保留机械降神规则的结构化语义证据',
      suppliedAuditReport
    )
  )

  const structuredStateReport = await QualityGateService.evaluateChapterDraft({
    projectId: 'project-1',
    jobId: 'job-2',
    chapterId: null,
    draftId: 'draft-2',
    chapterDraft: { title: '交易章', body: `林克花费 8000 买下装备。${'随后他继续检查走廊与门锁。'.repeat(300)}` },
    context: '',
    chapterPlan: null,
    noveltyAuditResult: { newNamedCharacters: [], newWorldRules: [], newSystemMechanics: [], newOrganizationsOrRanks: [], majorLoreReveals: [], suspiciousDeusExRules: [], untracedNames: [], severity: 'pass', summary: 'pass' },
    characterStateFacts: [{ id: 'cash-1', projectId: 'project-1', characterId: 'character-1', category: 'resource', key: 'cash', label: '现金余额', valueType: 'number', value: 5000, unit: '元', linkedCardFields: ['abilitiesAndResources'], trackingLevel: 'hard', promptPolicy: 'when_relevant', status: 'active', sourceChapterId: null, sourceChapterOrder: 1, evidence: '', confidence: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    characters: [{ id: 'character-1', projectId: 'project-1', name: '林克', role: '', surfaceGoal: '', deepDesire: '', coreFear: '', selfDeception: '', knownInformation: '', unknownInformation: '', protagonistRelationship: '', emotionalState: '', nextActionTendency: '', forbiddenWriting: '', lastChangedChapter: null, isMain: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    aiService: optimisticAi
  })
  checks.push(assert(!structuredStateReport.pass && structuredStateReport.issues.some((issue) => issue.type === 'resource_underflow'), '即使 AI 门禁乐观通过，结构化状态账本硬规则仍会阻止超额支出', structuredStateReport))

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
  const noveltyKeywordsSource = await readFile(join(root, 'src', 'services', 'novelty', 'noveltyKeywords.ts'), 'utf-8')
  const noveltyTextSource = await readFile(join(root, 'src', 'services', 'novelty', 'noveltyText.ts'), 'utf-8')
  const noveltySemanticsSource = await readFile(join(root, 'src', 'services', 'novelty', 'noveltySemantics.ts'), 'utf-8')
  const noveltyReviewSource = await readFile(join(root, 'src', 'shared', 'noveltyReview.ts'), 'utf-8')
  checks.push(
    assert(
      detectorSource.includes("from './novelty/noveltyKeywords'") &&
        detectorSource.includes("from './novelty/noveltyText'") &&
        detectorSource.includes("from './novelty/noveltySemantics'") &&
        detectorSource.includes("from './novelty/noveltyFindings'"),
      'NoveltyDetector delegates keyword tables, semantic analysis, and finding construction'
    )
  )
  checks.push(
    assert(
      noveltyReviewSource.includes('collectNoveltyReviewFindings') &&
        runnerSource.includes('collectNoveltyReviewFindings') &&
        runTraceSource.includes('collectNoveltyReviewFindings'),
      'quality/memory/trace review surfaces share one novelty finding consolidation policy'
    )
  )
  checks.push(
    assert(
      noveltyKeywordsSource.includes('RULE_KEYWORDS') && noveltyKeywordsSource.includes('COMMON_FALSE_NAMES'),
      'Novelty keyword tables live in noveltyKeywords helper'
    )
  )
  checks.push(
    assert(
      noveltyTextSource.includes('normalizeForMatch') && noveltyTextSource.includes('keywordOccurrences'),
      'Novelty text matching and all-occurrence scanning live in noveltyText helper'
    )
  )
  checks.push(
    assert(
      noveltySemanticsSource.includes('resolvesCurrentCrisis') &&
        noveltySemanticsSource.includes('hasLinkedCostOrLimit') &&
        noveltySemanticsSource.includes('mundaneUsage'),
      'Novelty semantic analysis links crisis resolution and costs while filtering mundane usage'
    )
  )
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
