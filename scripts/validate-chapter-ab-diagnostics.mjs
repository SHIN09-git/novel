import { readFileSync } from 'node:fs'
import {
  aggregateChapterAbDiagnostics,
  auditWorkbenchRequests,
  diagnoseChapterBody,
  diagnoseChapterPrompt,
  extractModelResponseTelemetry,
  summarizeDraftRequestTelemetry
} from './utils/chapter-ab-diagnostics.mjs'

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

const task = {
  goal: '写一个普通周六的买菜、摔鸡蛋、做晚饭和收拾厨房。',
  conflict: '本章只处理鸡蛋摔裂、晚饭安排和两个人的生活小摩擦。',
  suspenseToKeep: '通知只显示标题，不打开。',
  endingHook: '手机放回料理台，继续收拾鸡蛋。',
  readerEmotion: '松弛、温暖、略带笨拙。',
  targetWordCount: '300-2000',
  styleRequirement: '陈航第一人称限知；自然、生活化，少解释，不使用网文式钩子。'
}

const contract = {
  notificationPhrase: '九号水文站遗留资料核对',
  notificationMinPositionRatio: 0.75,
  allowedNamedCharacters: ['陈航', '林雯'],
  forbiddenTerms: ['B-7', '蓝卡'],
  forbiddenActions: ['打开通知', '点开通知', '查看附件'],
  dailyTerms: ['鸡蛋', '晚饭', '做饭', '厨房', '菜市场'],
  scenePhases: {
    菜市场采购: ['菜市场', '摊', '买菜'],
    鸡蛋摔裂: ['鸡蛋', '摔', '裂', '蛋液', '蛋壳'],
    商量晚饭: ['晚饭', '晚上吃', '晚上做', '晚餐'],
    共同做饭: ['做饭', '开火', '下锅', '炒菜', '切菜', '盛菜'],
    收拾厨房: ['收拾', '厨房', '水槽', '抹布', '洗碗']
  }
}

const badBlock =
  '本章只处理鸡蛋摔裂、晚饭安排和两个人的生活小摩擦。顾明站在厨房门边笑。命运的齿轮已经开始转动，一阵寒意从我背后升起。我和林雯提着菜市场买来的鸡蛋做饭，收拾厨房。'
const badBody = `${badBlock.repeat(8)}${contract.notificationPhrase}。我把手机扣下，一切才刚刚开始。`
const badDiagnostic = diagnoseChapterBody({ body: badBody, title: '第一章', task, contract })

const naturalBeforeNotification = [
  '周六早上，我拎着布袋去了菜市场。青菜叶上还沾着水珠，卖番茄的摊位前排了三个人，我就先去挑了两颗土豆。',
  '回到楼下时，袋底蹭到台阶，几枚鸡蛋隔着纸盒发出轻轻的碎响。我站住脚，把袋子换到另一只手上，慢慢走完最后几级台阶。',
  '林雯打开门，看见我护着纸盒，先接过青菜。她问：“还能吃吗？”我掀开盒盖，说：“今晚大概得多一道炒鸡蛋。”',
  '她把围裙递给我：“那少煮一点米，别又剩半锅。”我说好，转身淘米，她在砧板边切番茄，我们为最后一颗土豆该炒丝还是炖汤争了两句。',
  '锅热以后，我把蛋液倒进去，她拿锅铲帮我翻面。蛋壳挑干净了，灶台却溅了一圈油点，我们一边做饭一边互相嫌弃谁占了水槽。',
  '晚饭吃完，我洗碗，她用抹布擦料理台。垃圾桶换了新袋，菜刀和砧板也沥在架子上，厨房总算恢复成早上的样子。'
].join('\n\n')
const naturalBody = `${naturalBeforeNotification}\n\n手机在料理台边亮了一下，锁屏上只有一行“${contract.notificationPhrase}”。我把手机扣回台面，先将灶火调小，又拿抹布擦掉纸盒旁的一点蛋液。`
const naturalDiagnostic = diagnoseChapterBody({ body: naturalBody, title: '第一章 周六晚饭', task, contract })

const strictEndingTask = {
  ...task,
  targetWordCount: '100-5000',
  suspenseToKeep: `通知只显示标题“${contract.notificationPhrase}”。标题出现后，场面只保留陈航扣回手机并擦完碗的两个动作。`
}
const strictEndingContract = {
  ...contract,
  notificationMinPositionRatio: 0.85,
  allowedNamedCharacters: [],
  dailyTerms: [],
  scenePhases: {}
}
const strictPhraseLength = [...contract.notificationPhrase].length
const nearPositionPrefixLength = 2297
const strictBodyVisibleLength = 2725
const nearPositionBody = `${'我'.repeat(nearPositionPrefixLength)}${contract.notificationPhrase}${'尾'.repeat(strictBodyVisibleLength - nearPositionPrefixLength - strictPhraseLength - 1)}。`
const nearPositionDiagnostic = diagnoseChapterBody({ body: nearPositionBody, title: '第一章', task: strictEndingTask, contract: strictEndingContract })
const outsideTolerancePrefixLength = 2285
const outsideToleranceBody = `${'我'.repeat(outsideTolerancePrefixLength)}${contract.notificationPhrase}${'尾'.repeat(strictBodyVisibleLength - outsideTolerancePrefixLength - strictPhraseLength - 1)}。`
const outsideToleranceDiagnostic = diagnoseChapterBody({ body: outsideToleranceBody, title: '第一章', task: strictEndingTask, contract: strictEndingContract })

const duplicateNotificationDiagnostic = diagnoseChapterBody({
  body: naturalBody,
  title: contract.notificationPhrase,
  task,
  contract
})

const incompleteBody = `${naturalBeforeNotification}\n\n手机在料理台边亮了一下，锁屏上只有一行“${contract.notificationPhrase}”。我伸手把灶火调小，林雯忽然问：“你是不是还没来得及`
const incompleteDiagnostic = diagnoseChapterBody({ body: incompleteBody, title: '第一章', task, contract })

const thirdPersonWithQuotedFirstPerson =
  `周六早上，陈航去了菜市场，买了鸡蛋和青菜。回家时纸盒磕到台阶，裂了两枚。` +
  `林雯接过袋子，说：“我来洗菜，你去把鸡蛋放好。”陈航点点头，进厨房切菜、开火，又和她商量晚饭吃什么。` +
  `吃过饭，陈航洗碗、擦料理台，林雯说：“我去倒垃圾。”手机随后亮起，锁屏显示“${contract.notificationPhrase}”。陈航没有点开，把手机扣回台面。`
const thirdPersonDiagnostic = diagnoseChapterBody({
  body: thirdPersonWithQuotedFirstPerson,
  title: '第一章',
  task,
  contract
})

const ordinaryWaterSoundBody = naturalBody.replace(
  '晚饭吃完，我洗碗',
  '晚饭吃完，我拧开水龙头洗碗，水声哗哗响着，碗碟碰出的水声断断续续，我洗碗'
)
const ordinaryWaterSoundDiagnostic = diagnoseChapterBody({
  body: ordinaryWaterSoundBody,
  title: '第一章',
  task,
  contract,
  profile: { oppressiveTerms: ['水声'] }
})
const lexicalInstructionBody = naturalBody.replace(
  '她把围裙递给我',
  '我不得不承认她切得更快，问她要不要先把围裙系上。她把围裙递给我'
)
const lexicalInstructionDiagnostic = diagnoseChapterBody({ body: lexicalInstructionBody, title: '第一章', task, contract })
const ominousWaterSoundBody = naturalBody.replace(
  '晚饭吃完，我洗碗',
  '晚饭吃完，厨房空荡得过分，水声在墙间诡异地回荡，我洗碗'
)
const ominousWaterSoundDiagnostic = diagnoseChapterBody({
  body: ominousWaterSoundBody,
  title: '第一章',
  task,
  contract,
  profile: { oppressiveTerms: ['水声'] }
})

const suspenseMetaphorBody = naturalBody.replace(
  '我把手机扣回台面，先将灶火调小，又拿抹布擦掉纸盒旁的一点蛋液。',
  '我把手机扣回台面。那个通知像一粒沙子落进水里，只泛起极轻的涟漪，随即就沉了下去。'
)
const suspenseMetaphorDiagnostic = diagnoseChapterBody({
  body: suspenseMetaphorBody,
  title: '第一章',
  task,
  contract,
  profile: { webNovelHookPatterns: [] }
})

const nameHeuristicBody =
  '回家的路不长。我走到卖鸡蛋的老周摊位前，老周正跟旁边的人聊天。隔壁老张头正理货，张阿姨遛狗经过：“小陈，今天买了什么？”我说买了鸡蛋，转身上楼。'
const nameHeuristicDiagnostic = diagnoseChapterBody({ body: nameHeuristicBody, title: '第一章', task, contract })

const forbiddenBehaviorDiagnostic = diagnoseChapterBody({
  body: `${naturalBody}\n\n林雯问：“谁发的？”我说不知道。她又问：“明天要不要出去走走？”我说：“行啊。”`,
  title: '第一章',
  task: {
    ...task,
    conflict: `${task.conflict} 本章不作出出行决定。`,
    suspenseToKeep: `${task.suspenseToKeep} 陈航不追问来源。`
  },
  contract
})

const negatedSourceInquiryDiagnostic = diagnoseChapterBody({
  body: `${naturalBody}\n\n林雯看了我一眼，没问是谁发的。我把手机扣回桌面，继续收拾。`,
  title: '第一章',
  task: {
    ...task,
    suspenseToKeep: `${task.suspenseToKeep} 陈航不追问来源。`
  },
  contract
})

const postReturnPresenceDiagnostic = diagnoseChapterBody({
  body: '我拎着菜到家，把鸡蛋放在料理台上。林雯回来时，我正在洗番茄。',
  title: '第一章',
  task: {
    ...task,
    conflict: `${task.conflict} 陈航回家后两人一直留在家里。`
  },
  contract
})

const semanticDailyBody = naturalBody.replaceAll('做饭', '下厨')
const semanticDailyDiagnostic = diagnoseChapterBody({ body: semanticDailyBody, title: '第一章', task, contract })
const implicitMealDiscussionBody = naturalBody
  .replaceAll('晚饭', '饭')
  .replace('我们为最后一颗土豆该炒丝还是炖汤争了两句。', '我问：“番茄炒蛋，再炒个白菜？”她说：“够了。”')
const implicitMealDiscussionDiagnostic = diagnoseChapterBody({
  body: implicitMealDiscussionBody,
  title: '第一章',
  task,
  contract
})
const responseTelemetry = extractModelResponseTelemetry(
  JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: '正文不应进入观测记录' } }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 200,
      total_tokens: 300,
      prompt_tokens_details: { cached_tokens: 12 },
      provider_note: '非数值字段不应持久化'
    },
    api_key: '绝不应进入观测记录'
  })
)
const forwardedDraftRecord = {
  index: 1,
  stage: 'draft',
  method: 'POST',
  pathname: '/chat/completions',
  model: 'deepseek-v4-flash',
  promptAudit: { hardPass: true },
  forwarded: true,
  responseMode: 'forwarded',
  finishReason: 'length',
  usage: { prompt_tokens: 100, completion_tokens: 900, total_tokens: 1000, provider_note: 'drop me' },
  error: null
}
const rewrittenDraftRecord = {
  ...forwardedDraftRecord,
  index: 2,
  finishReason: 'stop',
  usage: { prompt_tokens: 120, completion_tokens: 1800, total_tokens: 1920, hidden_text: 'drop me too' }
}
const forwardedOtherRecord = {
  ...forwardedDraftRecord,
  index: 3,
  stage: 'other',
  promptAudit: null,
  finishReason: 'stop',
  usage: { total_tokens: 80 }
}
const requestAuditOptions = { expectedModelName: 'deepseek-v4-flash', preflightOnly: false }
const twoDraftRequestAudit = auditWorkbenchRequests(
  [forwardedDraftRecord, rewrittenDraftRecord, forwardedOtherRecord],
  requestAuditOptions
)
const threeDraftRequestAudit = auditWorkbenchRequests(
  [forwardedDraftRecord, rewrittenDraftRecord, { ...rewrittenDraftRecord, index: 3 }],
  requestAuditOptions
)
const unsafeRewriteRequestAudit = auditWorkbenchRequests(
  [forwardedDraftRecord, { ...rewrittenDraftRecord, promptAudit: { hardPass: false } }],
  requestAuditOptions
)
const interleavedRewriteRequestAudit = auditWorkbenchRequests(
  [forwardedDraftRecord, { ...forwardedOtherRecord, index: 2 }, { ...rewrittenDraftRecord, index: 3 }],
  requestAuditOptions
)
const preflightRequestAudit = auditWorkbenchRequests(
  [
    {
      ...forwardedDraftRecord,
      forwarded: false,
      responseMode: 'intentional_draft_stop',
      finishReason: null,
      usage: null,
      error: 'PREFLIGHT_DRAFT_INTENTIONAL_STOP'
    }
  ],
  {
    expectedModelName: 'deepseek-v4-flash',
    preflightOnly: true,
    preflightDraftStopError: 'PREFLIGHT_DRAFT_INTENTIONAL_STOP'
  }
)
const draftRequestTelemetry = summarizeDraftRequestTelemetry([
  { ...forwardedDraftRecord, prompt: 'first draft prompt must not be persisted here' },
  { ...rewrittenDraftRecord, prompt: 'second draft prompt must not be persisted here' },
  forwardedOtherRecord
])
const runnerSource = readFileSync(new URL('./run-deepseek-workbench-ab.mjs', import.meta.url), 'utf8')

const directPrompt = `请写第一章。\n${Object.values(task).join('\n')}`
const amplifiedPrompt = `${directPrompt}\n${task.goal}\n${task.goal}\n${task.conflict}\n${task.conflict}\n必须遵守。不得新增。不要偏离。只能照做。唯一允许。禁止解释。`
const directPromptDiagnostic = diagnoseChapterPrompt({ prompt: directPrompt, task })
const amplifiedPromptDiagnostic = diagnoseChapterPrompt({
  prompt: amplifiedPrompt,
  task,
  baselinePromptCharacterCount: directPromptDiagnostic.heuristicPressure.metrics.characterCount
})

function artificialSample(riskScore, promptRiskScore = 10) {
  return {
    bodyDiagnostics: {
      hardContract: { pass: true },
      heuristicStyle: { advisoryOnly: true, riskScore, flags: [], metrics: {} }
    },
    promptDiagnostics: {
      hardContract: { pass: true },
      heuristicPressure: { advisoryOnly: true, riskScore: promptRiskScore, flags: [], metrics: {} }
    }
  }
}

function samples(riskScore, promptRiskScore = 10) {
  return [artificialSample(riskScore, promptRiskScore), artificialSample(riskScore, promptRiskScore), artificialSample(riskScore, promptRiskScore)]
}

const cleanContext = { promptLeakHits: [], legacyBodyHits: [], traceExact: true }
const modelBias = aggregateChapterAbDiagnostics({
  arms: { directMinimal: samples(70), directContract: samples(72), workbench: samples(74, 80) },
  contextEvidence: cleanContext
})
const contractPressure = aggregateChapterAbDiagnostics({
  arms: { directMinimal: samples(20), directContract: samples(55, 55), workbench: samples(58, 80) },
  contextEvidence: cleanContext
})
const workbenchPressure = aggregateChapterAbDiagnostics({
  arms: { directMinimal: samples(20), directContract: samples(22, 30), workbench: samples(60, 85) },
  contextEvidence: cleanContext
})
const contextLeak = aggregateChapterAbDiagnostics({
  arms: { directMinimal: samples(20), directContract: samples(22, 30), workbench: samples(60, 85) },
  contextEvidence: { promptLeakHits: [{ term: 'B-7' }], legacyBodyHits: [], traceExact: false }
})

const checks = [
  assert(badDiagnostic.hardContract.pass, 'style counterexample remains a hard-contract pass', badDiagnostic),
  assert(
    badDiagnostic.heuristicStyle.flags.some((flag) => flag.code === 'unknown_proper_name') &&
      badDiagnostic.heuristicStyle.metrics.unknownProperNameCandidates.some((candidate) => candidate.value === '顾明'),
    'unauthorized proper-name heuristic identifies 顾明 without turning it into a hard-contract check',
    badDiagnostic
  ),
  assert(
    badDiagnostic.heuristicStyle.flags.some((flag) => flag.code === 'web_novel_hook') &&
      badDiagnostic.heuristicStyle.metrics.webNovelHookHits.some((hit) => hit.match.includes('命运') || hit.match.includes('刚刚开始')),
    'web-novel hook heuristic identifies 命运齿轮 / 一切才刚刚开始',
    badDiagnostic
  ),
  assert(
    badDiagnostic.heuristicStyle.flags.some((flag) => flag.code === 'oppressive_tone') &&
      badDiagnostic.heuristicStyle.metrics.oppressiveTermHits.some((hit) => hit.term === '寒意'),
    'oppressive-tone heuristic identifies 寒意',
    badDiagnostic
  ),
  assert(
    badDiagnostic.heuristicStyle.flags.some((flag) => flag.code === 'task_echo') &&
      badDiagnostic.heuristicStyle.metrics.taskEchoHits.some((hit) => hit.clause.includes('本章只处理鸡蛋摔裂')),
    'task-echo heuristic identifies copied task clauses',
    badDiagnostic
  ),
  assert(
    !duplicateNotificationDiagnostic.hardContract.pass &&
      duplicateNotificationDiagnostic.hardContract.checks.notificationInBody &&
      !duplicateNotificationDiagnostic.hardContract.checks.notificationExactlyOnceAcrossOutput &&
      duplicateNotificationDiagnostic.hardContract.measurements.titleNotificationCount === 1,
    'notification repeated in title and body fails the hard contract',
    duplicateNotificationDiagnostic
  ),
  assert(
    nearPositionDiagnostic.hardContract.checks.notificationLateEnough &&
      !nearPositionDiagnostic.hardContract.checks.notificationTailWithinLimit &&
      nearPositionDiagnostic.hardContract.measurements.notificationTrailingVisibleCharacterCount > 240,
    'one-point position tolerance accepts 84.3% while the explicit compact-ending tail still blocks 417 trailing characters',
    nearPositionDiagnostic
  ),
  assert(
    !outsideToleranceDiagnostic.hardContract.checks.notificationLateEnough,
    'notification position beyond the one-point tolerance still fails',
    outsideToleranceDiagnostic
  ),
  assert(
    !incompleteDiagnostic.hardContract.pass &&
      !incompleteDiagnostic.hardContract.checks.completeTerminal &&
      !incompleteDiagnostic.hardContract.checks.balancedDelimiters,
    'unclosed quote and half-sentence ending fail structural hard checks',
    incompleteDiagnostic
  ),
  assert(
    !thirdPersonDiagnostic.hardContract.checks.requiredPerspective &&
      thirdPersonDiagnostic.hardContract.measurements.narrativeFirstPersonCount === 0,
    'first-person requirement ignores 我 that appears only inside quoted dialogue',
    thirdPersonDiagnostic
  ),
  assert(
    !ordinaryWaterSoundDiagnostic.heuristicStyle.flags.some((flag) => flag.code === 'oppressive_tone') &&
      ordinaryWaterSoundDiagnostic.heuristicStyle.metrics.oppressiveTermHits.every((hit) => hit.term !== '水声'),
    'ordinary dishwashing and faucet water sounds do not trigger oppressive-tone diagnostics',
    ordinaryWaterSoundDiagnostic
  ),
  assert(
    !lexicalInstructionDiagnostic.heuristicStyle.flags.some((flag) => flag.code === 'task_echo') &&
      lexicalInstructionDiagnostic.heuristicStyle.metrics.instructionRegisterCount === 0,
    'lexical 不得不 and 要不要 are not mistaken for instruction-register task echo',
    lexicalInstructionDiagnostic
  ),
  assert(
    ominousWaterSoundDiagnostic.heuristicStyle.metrics.oppressiveTermHits.some((hit) => hit.term === '水声'),
    'water sound remains detectable when the prose explicitly renders it as ominous',
    ominousWaterSoundDiagnostic
  ),
  assert(
    suspenseMetaphorDiagnostic.heuristicStyle.flags.some((flag) => flag.code === 'web_novel_hook') &&
      suspenseMetaphorDiagnostic.heuristicStyle.metrics.webNovelHookCount === 1 &&
      suspenseMetaphorDiagnostic.heuristicStyle.metrics.webNovelHookHits.some(
        (hit) => hit.match.includes('一粒沙子') && (hit.match.includes('涟漪') || hit.match.includes('沉了下去'))
      ),
    'post-notification ripple/sinking suspense metaphor is detected even with an empty custom hook list',
    suspenseMetaphorDiagnostic
  ),
  assert(
    ['老周', '老张头', '张阿姨'].every((name) =>
      nameHeuristicDiagnostic.heuristicStyle.metrics.unknownProperNameCandidates.some((candidate) => candidate.value === name)
    ) &&
      !nameHeuristicDiagnostic.heuristicStyle.metrics.unknownProperNameCandidates.some((candidate) =>
        ['回家的路', '路过小区', '小陈'].includes(candidate.value)
      ),
    'proper-name heuristic reports unauthorized everyday surname labels without flagging route prose or the allowed surname alias 小陈',
    nameHeuristicDiagnostic
  ),
  assert(
    forbiddenBehaviorDiagnostic.hardContract.measurements.forbiddenActionDetails.some((item) => item.action === '追问通知来源') &&
      forbiddenBehaviorDiagnostic.hardContract.measurements.forbiddenActionDetails.some((item) => item.action === '作出后续出行决定') &&
      forbiddenBehaviorDiagnostic.hardContract.pass === false,
    'explicit source-inquiry and outing-decision bans are deterministic hard checks',
    forbiddenBehaviorDiagnostic
  ),
  assert(
    !negatedSourceInquiryDiagnostic.hardContract.measurements.forbiddenActionDetails.some(
      (item) => item.action === '追问通知来源'
    ),
    'negated source-inquiry narration is not treated as a forbidden action',
    negatedSourceInquiryDiagnostic
  ),
  assert(
    postReturnPresenceDiagnostic.hardContract.measurements.forbiddenActionDetails.some(
      (item) => item.action === '陈航回家后林雯外出返家'
    ),
    'post-return absence violates an explicit continuous-at-home task boundary',
    postReturnPresenceDiagnostic
  ),
  assert(
    semanticDailyDiagnostic.hardContract.checks.allRequiredDailyAnchorsPresent &&
      semanticDailyDiagnostic.hardContract.measurements.dailyTermCounts.做饭 === 0 &&
      semanticDailyDiagnostic.hardContract.measurements.dailyAnchorMode === 'scene_phases' &&
      semanticDailyDiagnostic.hardContract.measurements.scenePhases.every((phase) => phase.present) &&
      semanticDailyDiagnostic.hardContract.measurements.scenePhases.find((phase) => phase.phase === '共同做饭')?.semanticHits.length >= 2,
    'daily hard check prefers semantic scene-phase coverage over the literal token 做饭',
    semanticDailyDiagnostic
  ),
  assert(
    implicitMealDiscussionDiagnostic.hardContract.measurements.scenePhases.find(
      (phase) => phase.phase === '商量晚饭'
    )?.semanticHits.length > 0 &&
      implicitMealDiscussionDiagnostic.hardContract.checks.allRequiredDailyAnchorsPresent,
    'an explicit dish-choice question satisfies the meal-discussion phase without requiring the literal token 晚饭',
    implicitMealDiscussionDiagnostic
  ),
  assert(
    /summary\.workbench\.push\(\{\s*label,\s*title,/su.test(runnerSource),
    'workbench summary persists the generated chapter title',
    { sourcePath: 'scripts/run-deepseek-workbench-ab.mjs' }
  ),
  assert(
    responseTelemetry.finishReason === 'stop' &&
      responseTelemetry.usage?.total_tokens === 300 &&
      responseTelemetry.usage?.prompt_tokens_details?.cached_tokens === 12 &&
      !JSON.stringify(responseTelemetry).includes('正文不应进入') &&
      !JSON.stringify(responseTelemetry).includes('绝不应进入') &&
      !JSON.stringify(responseTelemetry).includes('非数值字段'),
    'loopback response telemetry retains only finish reason and numeric usage, never response content or credentials',
    responseTelemetry
  ),
  assert(
    twoDraftRequestAudit.hardPass &&
      twoDraftRequestAudit.draftRequestCount === 2 &&
      !threeDraftRequestAudit.hardPass &&
      threeDraftRequestAudit.checks.draftRequestCount === false &&
      !unsafeRewriteRequestAudit.hardPass &&
      unsafeRewriteRequestAudit.checks.writingPromptsSafe === false &&
      !interleavedRewriteRequestAudit.hardPass &&
      interleavedRewriteRequestAudit.checks.expectedStages === false &&
      preflightRequestAudit.hardPass,
    'request audit allows one contract rewrite, rejects extra/unsafe/interleaved drafts, and preserves one-stop preflight',
    {
      twoDraftRequestAudit,
      threeDraftRequestAudit,
      unsafeRewriteRequestAudit,
      interleavedRewriteRequestAudit,
      preflightRequestAudit
    }
  ),
  assert(
    draftRequestTelemetry.length === 2 &&
      draftRequestTelemetry[0]?.finishReason === 'length' &&
      draftRequestTelemetry[1]?.finishReason === 'stop' &&
      draftRequestTelemetry[1]?.usage?.total_tokens === 1920 &&
      !JSON.stringify(draftRequestTelemetry).includes('prompt must not be persisted') &&
      !JSON.stringify(draftRequestTelemetry).includes('drop me'),
    'draft telemetry keeps both attempts while excluding prompts and non-numeric provider data',
    draftRequestTelemetry
  ),
  assert(
    /const finalDraftTelemetry = draftRequestTelemetry\.at\(-1\) \?\? null/su.test(runnerSource) &&
      /finishReason:\s*finalDraftTelemetry\?\.finishReason\s*\?\?\s*null/su.test(runnerSource) &&
      /usage:\s*finalDraftTelemetry\?\.usage\s*\?\?\s*null/su.test(runnerSource) &&
      /hasApiKey:\s*true,\s*retryEnabled:\s*false,\s*maxRetries:\s*0,/su.test(runnerSource),
    'workbench summary reports the final draft attempt and the controlled experiment disables transport retries',
    { sourcePath: 'scripts/run-deepseek-workbench-ab.mjs' }
  ),
  assert(
    /draftResponseFile = `\$\{runLabel\}-\$\{String\(record\.index\)\.padStart\(2, '0'\)\}-draft-response\.txt`/su.test(runnerSource) &&
      /draftRawResponseFile = `\$\{runLabel\}-\$\{String\(record\.index\)\.padStart\(2, '0'\)\}-draft-raw-response\.txt`/su.test(runnerSource) &&
      /draftParseError:\s*record\.draftParseError/su.test(runnerSource) &&
      /const workbenchOnly = hasFlag\('workbench-only'\)/su.test(runnerSource) &&
      /workbenchOnly \|\|/su.test(runnerSource),
    'experiment runner preserves parsed and raw rejected draft responses with parse diagnostics and supports a workbench-only rerun',
    { sourcePath: 'scripts/run-deepseek-workbench-ab.mjs' }
  ),
  assert(
    /const attemptBodyAudits = draftRequests\.map/su.test(runnerSource) &&
      /attemptBodyAudits,/su.test(runnerSource) &&
      /bodyAudit:\s*record\.draftResponse\?\.body/su.test(runnerSource),
    'experiment runner audits every parsed draft attempt even when the pipeline rejects all attempts before persistence',
    { sourcePath: 'scripts/run-deepseek-workbench-ab.mjs' }
  ),
  assert(
    naturalDiagnostic.hardContract.pass && naturalDiagnostic.heuristicStyle.advisoryOnly === true,
    'natural daily sample passes hard contract and style diagnostics remain advisory',
    naturalDiagnostic
  ),
  assert(
    !naturalDiagnostic.heuristicStyle.flags.some((flag) => ['web_novel_hook', 'oppressive_tone', 'task_echo', 'unknown_proper_name'].includes(flag.code)),
    'natural daily sample does not trigger hook, oppressive, task-echo, or unknown-name flags',
    naturalDiagnostic
  ),
  assert(
    directPromptDiagnostic.hardContract.pass &&
      amplifiedPromptDiagnostic.hardContract.pass &&
      amplifiedPromptDiagnostic.heuristicPressure.metrics.repeatedTaskFieldSurplus > 0 &&
      amplifiedPromptDiagnostic.heuristicPressure.riskScore > directPromptDiagnostic.heuristicPressure.riskScore,
    'prompt diagnostics preserve hard task presence while exposing repeated-field pressure',
    { directPromptDiagnostic, amplifiedPromptDiagnostic }
  ),
  assert(
    modelBias.hypotheses.modelStyleBias.status === 'supported' &&
      modelBias.hypotheses.taskContractPressure.status === 'contradicted' &&
      modelBias.hypotheses.workbenchConstraintPressure.status === 'contradicted' &&
      modelBias.hypotheses.contextLeak.status === 'contradicted',
    'aggregation distinguishes model-style bias pattern',
    modelBias
  ),
  assert(
    contractPressure.hypotheses.modelStyleBias.status === 'contradicted' &&
      contractPressure.hypotheses.taskContractPressure.status === 'supported' &&
      contractPressure.hypotheses.workbenchConstraintPressure.status === 'contradicted',
    'aggregation distinguishes task-contract pressure pattern',
    contractPressure
  ),
  assert(
    workbenchPressure.hypotheses.modelStyleBias.status === 'contradicted' &&
      workbenchPressure.hypotheses.taskContractPressure.status === 'contradicted' &&
      workbenchPressure.hypotheses.workbenchConstraintPressure.status === 'supported' &&
      workbenchPressure.hypotheses.contextLeak.status === 'contradicted',
    'aggregation distinguishes workbench constraint-amplification pattern',
    workbenchPressure
  ),
  assert(
    contextLeak.hypotheses.contextLeak.status === 'supported' &&
      contextLeak.hypotheses.workbenchConstraintPressure.status === 'indeterminate',
    'aggregation identifies context leakage and refuses to misattribute its body delta to constraint amplification',
    contextLeak
  )
]

const failures = checks.filter((check) => !check.ok)
for (const check of checks) {
  console.log(`${check.ok ? '✓' : '✗'} ${check.message}`)
  if (!check.ok) console.log(JSON.stringify(check.details, null, 2))
}

if (failures.length > 0) {
  console.error(`\n${failures.length} chapter A/B diagnostic checks failed.`)
  process.exit(1)
}

console.log('\nChapter A/B diagnostics validation passed.')
