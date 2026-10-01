#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'chapter-contract-test')

function assert(condition, message, details) {
  if (condition) return
  throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`)
}

async function bundle(entryPoint, outfileName) {
  const outfile = join(outDir, outfileName)
  await build({
    entryPoints: [join(root, entryPoint)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function task(overrides = {}) {
  return {
    goal: '写一个普通周六。',
    conflict: '',
    suspenseToKeep: '',
    allowedPayoffs: '',
    forbiddenPayoffs: '',
    endingHook: '',
    readerEmotion: '松弛、日常。',
    targetWordCount: '500-2000',
    styleRequirement: '陈航第一人称限知。',
    ...overrides
  }
}

function passNoveltyAudit() {
  return {
    severity: 'pass',
    summary: 'pass',
    newNamedCharacters: [],
    newWorldRules: [],
    newSystemMechanics: [],
    newOrganizationsOrRanks: [],
    majorLoreReveals: [],
    suspiciousDeusExRules: [],
    untracedNames: []
  }
}

function strongDimensions(score = 92) {
  return {
    plotCoherence: score,
    characterConsistency: score,
    characterStateConsistency: score,
    foreshadowingControl: score,
    chapterContinuity: score,
    redundancyControl: score,
    styleMatch: score,
    pacing: score,
    emotionalPayoff: score,
    originality: score,
    promptCompliance: score,
    contextRelevanceCompliance: score
  }
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const { ChapterTaskContractService } = await bundle('src/services/ChapterTaskContractService.ts', 'contract-service.mjs')
const { QualityGateService } = await bundle('src/services/QualityGateService.ts', 'quality-gate-service.mjs')
const { shouldQualityGateRequireHumanReview } = await bundle('src/shared/qualityGatePolicy.ts', 'quality-policy.mjs')
const { buildAuthoritativeOpeningDraftPrompt } = await bundle('src/services/ai/GenerationPipelineAI.ts', 'generation-prompt.mjs')
const { validateAuthoritativeChapterTaskDraft } = await bundle('src/renderer/src/views/generation/pipelineUtils.ts', 'pipeline-utils.mjs')

const shortBody = `我${'做饭'.repeat(1144)}呀。`
assert([...shortBody.replace(/\s/gu, '')].length === 2291, 'Short-body regression fixture must remain exactly 2291 visible characters.')
const shortResult = ChapterTaskContractService.evaluate({ body: shortBody, chapterTask: task({ targetWordCount: '3500-4500' }) })
assert(!shortResult.pass, '2291 visible characters must fail a 3500-4500 authoritative task.', shortResult)
assert(shortResult.issues.some((issue) => issue.type === 'chapter_task_length'), 'Short draft must emit a high ChapterTask length issue.', shortResult)

const thirdPerson = '他走进厨房，把碗放在水槽边。“我来洗碗。”林雯说。他点点头，又去收拾桌子。'
const perspectiveResult = ChapterTaskContractService.evaluate({
  body: thirdPerson,
  chapterTask: task({ targetWordCount: '20-200', styleRequirement: '陈航第一人称限知。' })
})
assert(perspectiveResult.measurements.firstPersonNarrationCount === 0, '对白中的“我”不计入叙述统计。', perspectiveResult)
assert(perspectiveResult.pass && perspectiveResult.retryReason === null && perspectiveResult.warnings.length > 0,
  '视角需语义核对，不能仅凭“我”的数量强制重试。', perspectiveResult)

const notification = '九号水文站遗留资料核对'
const earlyPhraseBody = `我看见“${notification}”。${'我继续收拾厨房。'.repeat(30)}`
const phraseResult = ChapterTaskContractService.evaluate({
  body: earlyPhraseBody,
  chapterTask: task({
    targetWordCount: '100-1000',
    allowedPayoffs: `锁屏标题“${notification}”，全文只出现一次，并且首次出现位置不得早于正文85%。`
  })
})
assert(phraseResult.issues.some((issue) => issue.type === 'chapter_task_phrase_position'), '明确的引号短语位置约束必须硬失败。', phraseResult)
assert(ChapterTaskContractService.isLocallyRepairable(phraseResult), '仅短语位置失败时，首稿应被识别为可定点修订。', phraseResult)

const notificationLength = [...notification].length
const nearBoundaryBody = `${'我'.repeat(843)}${notification}${'呀'.repeat(1000 - 843 - notificationLength)}`
const nearBoundaryResult = ChapterTaskContractService.evaluate({
  body: nearBoundaryBody,
  chapterTask: task({
    targetWordCount: '100-2000',
    allowedPayoffs: `锁屏标题“${notification}”，全文只出现一次，并且首次出现位置不得早于正文85%。`
  })
})
assert(
  nearBoundaryResult.issues.some((issue) => issue.type === 'chapter_task_phrase_position'),
  '84.3% 不满足作者明确的 85%，不能另加一个百分点的隐式容差。',
  nearBoundaryResult
)

const outsideToleranceBody = `${'我'.repeat(839)}${notification}${'呀'.repeat(1000 - 839 - notificationLength)}`
const outsideToleranceResult = ChapterTaskContractService.evaluate({
  body: outsideToleranceBody,
  chapterTask: task({
    targetWordCount: '100-2000',
    allowedPayoffs: `锁屏标题“${notification}”，全文只出现一次，并且首次出现位置不得早于正文85%。`
  })
})
assert(
  outsideToleranceResult.issues.some((issue) => issue.type === 'chapter_task_phrase_position'),
  '明确位置边界外的短语仍必须硬失败。',
  outsideToleranceResult
)

const compactEndingTask = task({
  targetWordCount: '100-3000',
  suspenseToKeep: `通知只显示标题“${notification}”。标题出现后，场面只保留陈航扣回手机并擦完碗的动作。`
})
const extendedPostPhraseBody = `${'我继续收拾厨房。'.repeat(120)}${notification}${'我又去了客厅，打开电视，坐在沙发上想这条通知。'.repeat(20)}`
const extendedPostPhraseResult = ChapterTaskContractService.evaluate({ body: extendedPostPhraseBody, chapterTask: compactEndingTask })
assert(
  !extendedPostPhraseResult.issues.some((issue) => issue.type === 'chapter_task_post_phrase_tail') && extendedPostPhraseResult.warnings.length > 0,
  '只留动作的原复现文本保留为语义建议，不能推导出 240 字硬上限。',
  extendedPostPhraseResult
)
assert(!ChapterTaskContractService.isLocallyRepairable(extendedPostPhraseResult) && extendedPostPhraseResult.retryReason === null,
  '隐式收尾要求不进入定点重试。', extendedPostPhraseResult)

const compactPostPhraseBody = `${'我继续收拾厨房。'.repeat(120)}${notification}我把手机扣回料理台，擦干最后一只碗并把它放好。`
const compactPostPhraseResult = ChapterTaskContractService.evaluate({ body: compactPostPhraseBody, chapterTask: compactEndingTask })
assert(
  !compactPostPhraseResult.issues.some((issue) => issue.type === 'chapter_task_post_phrase_tail'),
  '标题后只有任务指定的短动作时不得误报尾声过长。',
  compactPostPhraseResult
)

const exactTailLimitBody = `${'我继续收拾厨房。'.repeat(120)}${notification}${'尾'.repeat(240)}`
const explicitNumericEndingTask = task({ targetWordCount: '100-3000',
  suspenseToKeep: `短语“${notification}”出现后不得超过240字。` })
const exactTailLimitResult = ChapterTaskContractService.evaluate({ body: exactTailLimitBody, chapterTask: explicitNumericEndingTask })
assert(
  !exactTailLimitResult.issues.some((issue) => issue.type === 'chapter_task_post_phrase_tail'),
  '严格收尾上限本身应通过。',
  exactTailLimitResult
)
const overTailLimitBody = `${'我继续收拾厨房。'.repeat(120)}${notification}${'尾'.repeat(241)}`
const overTailLimitResult = ChapterTaskContractService.evaluate({ body: overTailLimitBody, chapterTask: explicitNumericEndingTask })
assert(
  overTailLimitResult.issues.some((issue) => issue.type === 'chapter_task_post_phrase_tail'),
  '严格收尾上限多一个可见字符就应失败。',
  overTailLimitResult
)

const toneOnlyEndingResult = ChapterTaskContractService.evaluate({
  body: extendedPostPhraseBody,
  chapterTask: task({
    targetWordCount: '100-3000',
    suspenseToKeep: `通知只显示标题“${notification}”。标题出现后保持日常语调。`
  })
})
assert(
  !toneOnlyEndingResult.issues.some((issue) => issue.type === 'chapter_task_post_phrase_tail'),
  '只有语调要求、没有“只保留动作/收尾”的明确边界时不得猜测尾部上限。',
  toneOnlyEndingResult
)

const unquotedStyleResult = ChapterTaskContractService.evaluate({
  body: '我在厨房听见水声，低头继续洗碗。'.repeat(30),
  chapterTask: task({ targetWordCount: '400-2000', styleRequirement: '陈航第一人称限知；不写水声、寒意，不用网文式钩子句。' })
})
assert(unquotedStyleResult.pass && unquotedStyleResult.warnings.length > 0, '未声明字面禁词的描写要求需语义核对。', unquotedStyleResult)
const forbiddenStyleResult = ChapterTaskContractService.evaluate({
  body: '我在厨房听见水声，低头继续洗碗。'.repeat(30),
  chapterTask: task({ styleRequirement: '禁止使用词语“水声”、“寒意”。' })
})
assert(forbiddenStyleResult.issues.some((issue) => issue.type === 'chapter_task_style_forbidden_term'), '明确字面禁用词仍须硬检验。', forbiddenStyleResult)

const sourceInquiryResult = ChapterTaskContractService.evaluate({
  body: '我把手机扣回桌上。林雯问：“谁发的？”我说不知道。',
  chapterTask: task({
    targetWordCount: '20-200',
    suspenseToKeep: '通知只显示标题；陈航不追问来源。'
  })
})
assert(
  sourceInquiryResult.pass && sourceInquiryResult.warnings.length > 0,
  '来源询问旧个案需要核对人物与语境，不能作为通用硬规则。',
  sourceInquiryResult
)

const negatedSourceInquiryResult = ChapterTaskContractService.evaluate({
  body: '我把手机扣回桌上。林雯看了我一眼，没问是谁发的。我继续把碗放进沥水架。',
  chapterTask: task({
    targetWordCount: '20-200',
    suspenseToKeep: '通知只显示标题；陈航不追问来源。'
  })
})
assert(
  !negatedSourceInquiryResult.issues.some((issue) => issue.type === 'chapter_task_forbidden_source_inquiry'),
  '“没问是谁发的”描述的是遵守禁令，不得被误判成来源追问。',
  negatedSourceInquiryResult
)

const negatedThenPositiveSourceInquiryResult = ChapterTaskContractService.evaluate({
  body: '林雯没问别的，只把抹布挂好，随后又问：“谁发的？”我说不知道。',
  chapterTask: task({
    targetWordCount: '20-200',
    suspenseToKeep: '通知只显示标题；陈航不追问来源。'
  })
})
assert(
  negatedThenPositiveSourceInquiryResult.pass && negatedThenPositiveSourceInquiryResult.warnings.length > 0,
  '否定与追问并列的原复现保留给语义复核，不冒充确定性判断。',
  negatedThenPositiveSourceInquiryResult
)

const outingDecisionResult = ChapterTaskContractService.evaluate({
  body: '我收好碗筷。林雯问：“明天要不要出去走走？”我说：“行啊。”',
  chapterTask: task({ targetWordCount: '20-200', conflict: '本章不作出出行决定。' })
})
assert(
  outingDecisionResult.pass && outingDecisionResult.warnings.length > 0,
  '出行个案降为语义建议，不以通用关键词强制重试。',
  outingDecisionResult
)

const sameDayErrandResult = ChapterTaskContractService.evaluate({
  body: '我问：“下午干嘛？”林雯说：“那我去趟超市，买点洗衣液。晚上想吃什么？”我说：“你定。”后来她带回草莓，问：“洗了吃？”我说：“好。”',
  chapterTask: task({ targetWordCount: '20-300', conflict: '本章不作出出行决定。' })
})
assert(
  !sameDayErrandResult.issues.some((issue) => issue.type === 'chapter_task_forbidden_outing_decision'),
  '同一天已经发生的普通 errands 与后文无关的“好”不得被跨句拼成未来出行决定。',
  sameDayErrandResult
)

const postReturnPresenceResult = ChapterTaskContractService.evaluate({
  body: '我拎着菜到家，把鸡蛋放在料理台上。林雯回来时，我正在洗番茄。',
  chapterTask: task({
    targetWordCount: '20-200',
    conflict: '陈航回家后两人一直留在家里。'
  })
})
assert(
  postReturnPresenceResult.pass && postReturnPresenceResult.warnings.length > 0,
  '原人物在家约束保留为建议，不在通用校验中硬编码人名。',
  postReturnPresenceResult
)

const continuousPresenceResult = ChapterTaskContractService.evaluate({
  body: '我拎着菜到家，林雯从厨房探出头，接过我手里的青菜。我们一直在厨房忙到吃饭。',
  chapterTask: task({
    targetWordCount: '20-200',
    conflict: '陈航回家后两人一直留在家里。'
  })
})
assert(
  !continuousPresenceResult.issues.some((issue) => issue.type === 'chapter_task_post_return_presence_break'),
  '林雯已经在家并从厨房出现时，不得误判为外出返家。',
  continuousPresenceResult
)

const retryEvidenceMarker = 'RAW_PROSE_MUST_NOT_ENTER_RETRY_PROMPT'
const retrySafetyResult = ChapterTaskContractService.evaluate({
  body: `我收好碗筷。林雯问：“明天要不要去公园？”我把写着${retryEvidenceMarker}的普通便签压在杯子下，说：“行啊。”`,
  chapterTask: task({ targetWordCount: '3500-4500', conflict: '本章不作出出行决定。' })
})
assert(
  retrySafetyResult.issues.every((issue) => issue.type === 'chapter_task_length') && retrySafetyResult.warnings.length > 0,
  '正文个案不再产生剧情硬门禁，明确篇幅不足仍需重试。',
  retrySafetyResult
)
assert(
  !retrySafetyResult.retryReason?.includes(retryEvidenceMarker),
  '重试理由不得回灌原正文证据片段。',
  retrySafetyResult
)

const longerUnderflow = `我${'做饭'.repeat(1449)}呀。`
const shorterUnderflow = `我${'做饭'.repeat(1224)}呀。`
assert([...longerUnderflow.replace(/\s/gu, '')].length === 2901, 'Earlier-attempt fixture must remain exactly 2901 visible characters.')
assert([...shorterUnderflow.replace(/\s/gu, '')].length === 2451, 'Later-attempt fixture must remain exactly 2451 visible characters.')
assert(
  ChapterTaskContractService.shouldPreferEarlierLengthUnderflow({
    earlier: { title: '星期六的鸡蛋', body: longerUnderflow },
    later: { title: '裂痕', body: shorterUnderflow },
    chapterTask: task({ targetWordCount: '3500-4500' })
  }),
  '当两稿都只有长度不足时，重试变短不得覆盖更接近目标的首稿。'
)

const nearMinimumBody = `我${'做饭'.repeat(1660)}呀。`
assert([...nearMinimumBody.replace(/\s/gu, '')].length === 3323, 'Near-minimum fixture must remain exactly 3323 visible characters.')
assert(
  validateAuthoritativeChapterTaskDraft(nearMinimumBody, '普通周六', '3500-4500', true, task({ targetWordCount: '3500-4500' })) !== null,
  '3323 字符仍然不应被误标为满足正式 ChapterTask。'
)
assert(
  validateAuthoritativeChapterTaskDraft(
    nearMinimumBody,
    '普通周六',
    '3500-4500',
    true,
    task({ targetWordCount: '3500-4500' }),
    { allowReviewableLengthUnderflow: true }
  ) === null,
  '达到下限 90% 且仅有长度问题的二稿应进入完整质量审查，但稍后仍不得通过正式质量门。'
)

const openingPrompt = buildAuthoritativeOpeningDraftPrompt(task({ targetWordCount: '3500-4500' }), '正文仅 2923 个可见字符，低于任务下限')
assert(openingPrompt.includes('约 4000 个可见字符'), '首章模型提示应瞄准字数区间中部并明确可见字符口径。', openingPrompt)
assert(openingPrompt.includes('完整、有因果的场景互动'), '长度重写应要求增加关系/冲突场景，而不是重复家务凑字。', openingPrompt)
assert((openingPrompt.match(/写一个普通周六。/g) ?? []).length === 1, '模型提示中的 ChapterTask 正文值必须只序列化一次。', openingPrompt)
assert((openingPrompt.match(/3500-4500/g) ?? []).length === 1, '重写提示不得在 ChapterTask 之外重复完整目标区间。', openingPrompt)

const revisionBaseMarker = 'FIRST_DRAFT_RELATIONSHIP_BEAT'
const targetedRevisionPrompt = buildAuthoritativeOpeningDraftPrompt(
  task({ targetWordCount: '3500-4500' }),
  '正文仅 2923 个可见字符，低于任务下限',
  { title: '碎鸡蛋', body: `我保留已经成立的生活场景。${revisionBaseMarker}` }
)
assert(targetedRevisionPrompt.includes(revisionBaseMarker), '局部可修约束触发重试时，提示必须携带完整首稿作为修订对象。', targetedRevisionPrompt)
assert(targetedRevisionPrompt.includes('仍须返回完整正文，不要只返回新增段落'), '定点修订仍必须返回完整正文，保持现有解析和质量门语义。', targetedRevisionPrompt)
assert(targetedRevisionPrompt.includes('不是新的设定来源'), '首稿必须被标记为修订对象而非新增设定来源。', targetedRevisionPrompt)

const phraseRevisionPrompt = buildAuthoritativeOpeningDraftPrompt(
  task({
    targetWordCount: '3500-4500',
    suspenseToKeep: `锁屏标题“${notification}”出现后只保留收尾动作。`
  }),
  `将“${notification}”的首次出现移到正文 85% 之后。`,
  { title: '裂蛋', body: `我保留已经成立的生活场景。${revisionBaseMarker}` },
  ['chapter_task_phrase_position']
)
assert(phraseRevisionPrompt.includes(revisionBaseMarker), '短语位置失败时也必须携带完整首稿作为修订对象。', phraseRevisionPrompt)
assert(phraseRevisionPrompt.includes('只修复上述失败项，不要另起一稿'), '定点重试必须明确禁止盲目重采样。', phraseRevisionPrompt)
assert(phraseRevisionPrompt.includes('将指定短语及其触发动作整体移入任务规定的最后收尾段'), '短语位置重试必须明确删除标题后的场景延伸。', phraseRevisionPrompt)
assert(!phraseRevisionPrompt.includes('深化一段完整、有因果的场景互动'), '只有短语位置问题时不得额外要求增加关系戏。', phraseRevisionPrompt)

const newViolationRetry = ChapterTaskContractService.shouldPreferEarlierAfterRetry({
  earlier: { title: '首稿', body: longerUnderflow },
  later: { title: '重试稿', body: `他禁用片段${'做饭'.repeat(1660)}呀。` },
  chapterTask: task({
    targetWordCount: '3500-4500',
    styleRequirement: '陈航第一人称限知；禁止使用“禁用片段”。'
  })
})
assert(newViolationRetry, '重试稿即使更长，只要新增明确禁词等硬违约，就不得覆盖首稿。')

const reviewablePhraseTask = task({
  targetWordCount: '3500-4500',
  allowedPayoffs: `锁屏标题“${notification}”，全文只出现一次，并且首次出现位置不得早于正文85%。`
})
const earlyFullLengthBody = `${notification}${'我'.repeat(3600 - notificationLength)}。`
const revisedNearMinimumBody = `${'我'.repeat(3322 - notificationLength)}${notification}。`
assert(
  !ChapterTaskContractService.shouldPreferEarlierAfterRetry({
    earlier: { title: '位置错误首稿', body: earlyFullLengthBody },
    later: { title: '定点修订稿', body: revisedNearMinimumBody },
    chapterTask: reviewablePhraseTask
  }),
  '重试稿修复短语硬问题且只剩达到下限 90% 的字数不足时，应采用重试稿进入完整质量审查。'
)

const ordinaryBody = '我在厨房洗菜，林雯在旁边擦桌子，我们聊着晚饭要放多少盐。'.repeat(35)
const ordinaryTask = task()
const ordinaryResult = ChapterTaskContractService.evaluate({ body: ordinaryBody, chapterTask: ordinaryTask })
assert(ordinaryResult.pass, '满足明确合约的普通草稿应保持通过语义。', ordinaryResult)

const qualityReport = await QualityGateService.evaluateChapterDraft({
  projectId: 'project-1',
  jobId: 'job-1',
  chapterId: null,
  draftId: 'draft-1',
  chapterDraft: { title: '普通周六', body: shortBody },
  context: '',
  chapterPlan: null,
  chapterTask: task({ targetWordCount: '3500-4500' }),
  noveltyAuditResult: passNoveltyAudit(),
  aiService: {
    async generateQualityGateReport() {
      return {
        ok: true,
        usedAI: true,
        data: { overallScore: 92, pass: true, dimensions: strongDimensions(), issues: [], requiredFixes: [], optionalSuggestions: [] }
      }
    }
  }
})
assert(qualityReport.pass === false, '高分 AI 审稿不得覆盖 ChapterTask 硬违约。', qualityReport)
assert(qualityReport.issues.some((issue) => issue.type === 'chapter_task_length' && issue.severity === 'high'), '质量报告必须持久化高风险合约问题。', qualityReport)
assert(qualityReport.requiredFixes.length > 0, '高风险合约问题必须生成 requiredFixes。', qualityReport)
assert(qualityReport.dimensions.plotCoherence === 45, '长度违约必须压低 plotCoherence，不能保留 AI 高分。', qualityReport)
assert(qualityReport.dimensions.pacing === 45, '长度违约必须压低 pacing，不能保留 AI 高分。', qualityReport)
assert(qualityReport.dimensions.promptCompliance === 45, '长度违约必须压低 promptCompliance，不能保留 AI 高分。', qualityReport)

const perspectiveQualityReport = await QualityGateService.evaluateChapterDraft({
  projectId: 'project-1',
  jobId: 'job-perspective',
  chapterId: null,
  draftId: 'draft-perspective',
  chapterDraft: { title: '普通周六', body: thirdPerson },
  context: '',
  chapterPlan: null,
  chapterTask: task({ targetWordCount: '20-200', styleRequirement: '陈航第一人称限知。' }),
  noveltyAuditResult: passNoveltyAudit(),
  aiService: {
    async generateQualityGateReport() {
      return {
        ok: true,
        usedAI: true,
        data: { overallScore: 95, pass: true, dimensions: strongDimensions(95), issues: [], requiredFixes: [], optionalSuggestions: [] }
      }
    }
  }
})
assert(perspectiveQualityReport.dimensions.styleMatch === 95, '视角语义建议不得压低 AI styleMatch 高分。', perspectiveQualityReport)
assert(perspectiveQualityReport.dimensions.promptCompliance === 95, '视角语义建议不得压低 promptCompliance 高分。', perspectiveQualityReport)

const phraseQualityReport = await QualityGateService.evaluateChapterDraft({
  projectId: 'project-1',
  jobId: 'job-phrase',
  chapterId: null,
  draftId: 'draft-phrase',
  chapterDraft: { title: '普通周六', body: earlyPhraseBody },
  context: '',
  chapterPlan: null,
  chapterTask: task({
    targetWordCount: '100-1000',
    allowedPayoffs: `锁屏标题“${notification}”，全文只出现一次，并且首次出现位置不得早于正文85%。`
  }),
  noveltyAuditResult: passNoveltyAudit(),
  aiService: {
    async generateQualityGateReport() {
      return {
        ok: true,
        usedAI: true,
        data: { overallScore: 95, pass: true, dimensions: strongDimensions(95), issues: [], requiredFixes: [], optionalSuggestions: [] }
      }
    }
  }
})
assert(phraseQualityReport.dimensions.foreshadowingControl === 45, '短语位置违约必须压低 foreshadowingControl，不能保留 AI 高分。', phraseQualityReport)
assert(phraseQualityReport.dimensions.promptCompliance === 45, '短语位置违约必须压低 promptCompliance，不能保留 AI 高分。', phraseQualityReport)

const postPhraseTailQualityReport = await QualityGateService.evaluateChapterDraft({
  projectId: 'project-1',
  jobId: 'job-post-phrase-tail',
  chapterId: null,
  draftId: 'draft-post-phrase-tail',
  chapterDraft: { title: '普通周六', body: extendedPostPhraseBody },
  context: '',
  chapterPlan: null,
  chapterTask: explicitNumericEndingTask,
  noveltyAuditResult: passNoveltyAudit(),
  aiService: {
    async generateQualityGateReport() {
      return {
        ok: true,
        usedAI: true,
        data: { overallScore: 95, pass: true, dimensions: strongDimensions(95), issues: [], requiredFixes: [], optionalSuggestions: [] }
      }
    }
  }
})
assert(postPhraseTailQualityReport.dimensions.foreshadowingControl === 45, '标题后场景越界必须压低 foreshadowingControl。', postPhraseTailQualityReport)
assert(postPhraseTailQualityReport.dimensions.promptCompliance === 45, '标题后场景越界必须压低 promptCompliance。', postPhraseTailQualityReport)

const ordinaryQualityReport = await QualityGateService.evaluateChapterDraft({
  projectId: 'project-1',
  jobId: 'job-ordinary',
  chapterId: null,
  draftId: 'draft-ordinary',
  chapterDraft: { title: '普通周六', body: ordinaryBody },
  context: '',
  chapterPlan: null,
  chapterTask: ordinaryTask,
  noveltyAuditResult: passNoveltyAudit(),
  aiService: {
    async generateQualityGateReport() {
      return {
        ok: true,
        usedAI: true,
        data: { overallScore: 92, pass: true, dimensions: strongDimensions(), issues: [], requiredFixes: [], optionalSuggestions: [] }
      }
    }
  }
})
assert(ordinaryQualityReport.pass, '满足 ChapterTask 的普通草稿必须保留质量门通过语义。', ordinaryQualityReport)
assert(ordinaryQualityReport.requiredFixes.length === 0, '普通合规草稿不得产生 ChapterTask requiredFixes。', ordinaryQualityReport)

const lowPromptComplianceReport = {
  ...qualityReport,
  pass: true,
  overallScore: 90,
  issues: [],
  requiredFixes: [],
  dimensions: { ...strongDimensions(90), promptCompliance: 65 }
}
for (const dimension of ['promptCompliance', 'pacing', 'styleMatch']) {
  const report = { ...lowPromptComplianceReport, dimensions: { ...strongDimensions(90), [dimension]: 65 } }
  assert(shouldQualityGateRequireHumanReview(report), `${dimension}=65 的存量报告必须进入人工复核。`)
}

const chapterGeneration = await readFile(join(root, 'src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts'), 'utf8')
assert((chapterGeneration.match(/validateAuthoritativeChapterTaskDraft/g) ?? []).length === 3, '权威任务合约必须在首次草稿和择优后的最终草稿上都校验。')

console.log('ChapterTask contract validation passed.')
