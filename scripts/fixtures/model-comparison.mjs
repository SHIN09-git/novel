// Synthetic Chinese fiction only. These cases contain no author prose or model output.
export const MODEL_COMPARISON_FIXTURE_VERSION = 1

const FIXED_AT = '2026-09-07T08:00:00.000Z'

/** @typedef {import('../../src/shared/types.ts').AppData} AppData */
/** @typedef {import('../../src/shared/types.ts').ChapterTask} ChapterTask */
/** @typedef {import('../../src/shared/types.ts').Character} Character */
/** @typedef {import('../../src/shared/types.ts').CharacterCardField} CharacterCardField */
/** @typedef {import('../../src/shared/types.ts').CharacterStateFact} CharacterStateFact */
/** @typedef {import('../../src/shared/types.ts').Foreshadowing} Foreshadowing */
/** @typedef {import('../../src/shared/types.ts').ForeshadowingTreatmentMode} ForeshadowingTreatmentMode */
/** @typedef {import('../../src/shared/types.ts').HardCanonItem} HardCanonItem */

/**
 * @typedef {object} ModelComparisonExpected
 * @property {string[]} characterIds
 * @property {string[]} stateFactIds
 * @property {Record<string, ForeshadowingTreatmentMode>} foreshadowingModes
 * @property {string[]} hardCanonItemIds
 * @property {string[]} timelineEventIds
 * @property {string[]} bridgeFragments
 */

/**
 * @typedef {object} ModelComparisonCase
 * @property {string} id
 * @property {string} title
 * @property {string} purpose
 * @property {string} projectId
 * @property {number} targetChapterOrder
 * @property {Partial<AppData>} appData
 * @property {ChapterTask} chapterTask
 * @property {ModelComparisonExpected} expected
 * @property {Array<{id: string, label: string, question: string}>} rubric
 */

function project(id, name, genre, description, style) {
  return {
    id,
    name,
    genre,
    description,
    targetReaders: '偏好人物行动清楚、设定自洽的中文类型小说读者。',
    coreAppeal: '用有限信息与明确代价推动人物作出选择。',
    style,
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT
  }
}

function bible(projectId, values) {
  return {
    projectId,
    worldbuilding: values.worldbuilding,
    corePremise: values.corePremise,
    protagonistDesire: values.protagonistDesire,
    protagonistFear: values.protagonistFear,
    mainConflict: values.mainConflict,
    powerSystem: values.powerSystem ?? '',
    bannedTropes: values.bannedTropes,
    styleSample: values.styleSample,
    narrativeTone: values.narrativeTone,
    immutableFacts: values.immutableFacts,
    updatedAt: FIXED_AT
  }
}

/** @param {Omit<Character, 'createdAt' | 'updatedAt'>} values */
function character(values) {
  return { ...values, createdAt: FIXED_AT, updatedAt: FIXED_AT }
}

/**
 * @param {Omit<CharacterStateFact, 'createdAt' | 'updatedAt'>} values
 */
function stateFact(values) {
  return { ...values, createdAt: FIXED_AT, updatedAt: FIXED_AT }
}

function chapter(id, projectId, order, title, body, summary, endingHook, riskWarnings = '') {
  return {
    id,
    projectId,
    order,
    title,
    body,
    summary,
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook,
    riskWarnings,
    includedInStageSummary: false,
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT
  }
}

/** @param {Omit<Foreshadowing, 'createdAt' | 'updatedAt'>} values */
function foreshadowing(values) {
  return { ...values, createdAt: FIXED_AT, updatedAt: FIXED_AT }
}

function timelineEvent(id, projectId, title, chapterOrder, storyTime, narrativeOrder, participantCharacterIds, result, downstreamImpact) {
  return {
    id,
    projectId,
    title,
    chapterOrder,
    storyTime,
    narrativeOrder,
    participantCharacterIds,
    result,
    downstreamImpact,
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT
  }
}

/** @param {Omit<HardCanonItem, 'createdAt' | 'updatedAt'>} values */
function hardCanonItem(values) {
  return { ...values, createdAt: FIXED_AT, updatedAt: FIXED_AT }
}

function hardCanonPack(id, projectId, items) {
  return {
    id,
    projectId,
    title: '离线比较用不可违背设定',
    description: '仅包含本案例下一章必须遵守的少量约束。',
    items,
    maxPromptTokens: 900,
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
    schemaVersion: 1
  }
}

function continuityBridge(id, projectId, fromChapterId, toChapterOrder, values) {
  return {
    id,
    projectId,
    fromChapterId,
    toChapterOrder,
    lastSceneLocation: values.lastSceneLocation,
    lastPhysicalState: values.lastPhysicalState,
    lastEmotionalState: values.lastEmotionalState,
    lastUnresolvedAction: values.lastUnresolvedAction,
    lastDialogueOrThought: values.lastDialogueOrThought,
    immediateNextBeat: values.immediateNextBeat,
    mustContinueFrom: values.mustContinueFrom,
    mustNotReset: values.mustNotReset,
    openMicroTensions: values.openMicroTensions,
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT
  }
}

/** @returns {ModelComparisonCase} */
function createContinuityCase() {
  const projectId = 'model-case-01-rain-awning'
  const cenYaoId = 'mc01-character-cen-yao'
  const qiuHeId = 'mc01-character-qiu-he'
  const chapterOneId = 'mc01-chapter-01'
  const chapterTwoId = 'mc01-chapter-02'
  const cashFactId = 'mc01-fact-cash'
  const injuryFactId = 'mc01-fact-palm-injury'
  const inventoryFactId = 'mc01-fact-inventory'
  const qiuLocationFactId = 'mc01-fact-qiu-location'
  const watchHookId = 'mc01-foreshadow-stopped-watch'
  const timelineId = 'mc01-timeline-pawnshop-exit'
  const cashCanonId = 'mc01-canon-cash-balance'
  const injuryCanonId = 'mc01-canon-injury-and-ampoule'
  const bridgeAction = '岑遥已把细钩穿进卷帘门内侧的链环，正要向下拉开卡扣。'
  const bridgeNextBeat = '从细钩受力和巡夜脚步逼近的同一秒继续，岑遥与邱禾必须完成或放弃开门动作。'

  const characters = [
    character({
      id: cenYaoId,
      projectId,
      name: '岑遥',
      role: '主角，旧物修复师',
      surfaceGoal: '进入废弃钟表库，取回被调包的委托表。',
      deepDesire: '证明自己能靠准确判断而不是冒险运气解决困局。',
      coreFear: '因逞强再次让同伴承担代价。',
      selfDeception: '她声称只要动作够快，伤口就不会影响判断。',
      knownInformation: '知道仓库卷帘门卡扣可从缝隙拨开，也知道巡夜路线约三分钟一轮。',
      unknownInformation: '不知道委托表是否仍在库内。',
      protagonistRelationship: '与邱禾临时合作，信任建立在彼此兑现承诺上。',
      emotionalState: '紧张但专注，因左掌伤口重新渗血而克制急躁。',
      nextActionTendency: '优先完成已经开始的开门动作，失败后才撤离。',
      forbiddenWriting: '不得忽略现金余额、左掌伤势或凭空增加工具。',
      roleFunction: '执行开门并承担是否继续冒险的选择。',
      deepNeed: '学会在资源不足时接受同伴协助。',
      decisionLogic: '先核对代价和退路，再用手头工具完成最短动作。',
      abilitiesAndResources: '擅长修复小型机械；当前只有细钩、黄铜当票和密封药瓶，现金八十六元。',
      weaknessAndCost: '左掌割伤，持续握紧会使伤口裂开；现金不足以随意打车或采购。',
      relationshipTension: '不愿让邱禾看出自己握力下降，邱禾反对她继续硬撑。',
      futureHooks: '停摆的七码表为何出现在委托清单之外。',
      lastChangedChapter: 2,
      isMain: true
    }),
    character({
      id: qiuHeId,
      projectId,
      name: '邱禾',
      role: '同伴，夜班公交调度员',
      surfaceGoal: '在巡夜人回来前帮岑遥离开仓库后巷。',
      deepDesire: '让自己的谨慎被当作能力，而不是胆怯。',
      coreFear: '一次迟疑会让岑遥被困在门内。',
      selfDeception: '他认为只要守住后路，就不必参与开门。',
      knownInformation: '记得末班车发车时间和巡夜人刚转过的街口。',
      unknownInformation: '不知道岑遥左掌已经再次渗血。',
      protagonistRelationship: '与岑遥互相依赖，但常因风险尺度争执。',
      emotionalState: '警觉，压低声音催促撤离。',
      nextActionTendency: '先观察巷口，再在卡扣受阻时替岑遥接手。',
      forbiddenWriting: '不得突然拥有车辆、钥匙或额外现金。',
      roleFunction: '守住撤退窗口，并迫使岑遥正视伤势。',
      deepNeed: '在关键时刻从旁观者变成共同决策者。',
      decisionLogic: '以末班车时间和巡夜脚步为硬限，超过限度就撤。',
      abilitiesAndResources: '熟悉附近街巷与公交时刻，持有一支小手电。',
      weaknessAndCost: '没有仓库钥匙，也不能惊动单位同事。',
      relationshipTension: '愿意帮岑遥，但拒绝为她的逞强兜底。',
      futureHooks: '他认得当票背面的旧公交章。',
      lastChangedChapter: 2,
      isMain: false
    })
  ]

  const characterStateFacts = [
    stateFact({
      id: cashFactId,
      projectId,
      characterId: cenYaoId,
      category: 'resource',
      key: 'cash_balance',
      label: '随身现金',
      valueType: 'number',
      value: 86,
      unit: '元',
      linkedCardFields: /** @type {CharacterCardField[]} */ (['abilitiesAndResources', 'weaknessAndCost']),
      trackingLevel: 'hard',
      promptPolicy: 'always',
      status: 'active',
      sourceChapterId: chapterTwoId,
      sourceChapterOrder: 2,
      evidence: '岑遥在药店付款后数过钱包，只剩八十六元。',
      confidence: 1
    }),
    stateFact({
      id: injuryFactId,
      projectId,
      characterId: cenYaoId,
      category: 'physical',
      key: 'left_palm_cut',
      label: '左掌割伤',
      valueType: 'string',
      value: '伤口重新渗血，持续握紧会裂开，尚未包扎。',
      unit: '',
      linkedCardFields: /** @type {CharacterCardField[]} */ (['weaknessAndCost']),
      trackingLevel: 'hard',
      promptPolicy: 'always',
      status: 'active',
      sourceChapterId: chapterTwoId,
      sourceChapterOrder: 2,
      evidence: '卷帘门边缘擦过左掌，血浸到细钩握柄。',
      confidence: 1
    }),
    stateFact({
      id: inventoryFactId,
      projectId,
      characterId: cenYaoId,
      category: 'inventory',
      key: 'carried_items',
      label: '随身物品',
      valueType: 'list',
      value: ['细钩', '黄铜当票', '密封药瓶'],
      unit: '',
      linkedCardFields: /** @type {CharacterCardField[]} */ (['abilitiesAndResources']),
      trackingLevel: 'hard',
      promptPolicy: 'always',
      status: 'active',
      sourceChapterId: chapterTwoId,
      sourceChapterOrder: 2,
      evidence: '三件物品均在上一章结尾被逐一确认，没有仓库钥匙。',
      confidence: 1
    }),
    stateFact({
      id: qiuLocationFactId,
      projectId,
      characterId: qiuHeId,
      category: 'location',
      key: 'current_position',
      label: '当前位置',
      valueType: 'string',
      value: '仓库后巷卷帘门外，距岑遥两步。',
      unit: '',
      linkedCardFields: /** @type {CharacterCardField[]} */ (['roleFunction', 'surfaceGoal']),
      trackingLevel: 'hard',
      promptPolicy: 'always',
      status: 'active',
      sourceChapterId: chapterTwoId,
      sourceChapterOrder: 2,
      evidence: '邱禾贴墙盯着巷口，没有离开现场。',
      confidence: 1
    })
  ]

  const stoppedWatch = foreshadowing({
    id: watchHookId,
    projectId,
    title: '停摆的七码表',
    firstChapterOrder: 1,
    description: '委托清单没有这只七码表，但当票背面画着相同的七道刻线。',
    status: 'unresolved',
    weight: 'medium',
    treatmentMode: 'hint',
    expectedPayoff: '后续确认七码表与失踪委托人的关系。',
    payoffMethod: '先以刻线或表壳划痕轻触，不在本章解释来源。',
    relatedCharacterIds: [cenYaoId, qiuHeId],
    relatedMainPlot: '被调包的委托表',
    notes: '本章只允许轻微暗示。',
    actualPayoffChapter: null
  })

  const timeline = timelineEvent(
    timelineId,
    projectId,
    '离开南桥当铺',
    2,
    '周五 22:14',
    2,
    [cenYaoId, qiuHeId],
    '岑遥与邱禾带着黄铜当票抵达仓库后巷，末班车还有二十六分钟。',
    '第 3 章仍发生在同一夜，不能无说明跳到次日。'
  )

  const hardCanonItems = [
    hardCanonItem({
      id: cashCanonId,
      projectId,
      category: 'character_hard_state',
      title: '现金余额不可透支',
      content: '岑遥随身只有八十六元，任何消费都必须从这一余额中扣除，不能出现来源不明的钱。',
      priority: 'must',
      status: 'active',
      sourceType: 'character',
      sourceId: cashFactId,
      relatedCharacterIds: [cenYaoId],
      relatedForeshadowingIds: [],
      relatedTimelineEventIds: [timelineId]
    }),
    hardCanonItem({
      id: injuryCanonId,
      projectId,
      category: 'character_hard_state',
      title: '伤口与药瓶状态',
      content: '岑遥左掌伤口正在渗血，密封药瓶仍未开启；她不能毫无代价地持续用左手发力。',
      priority: 'must',
      status: 'active',
      sourceType: 'character',
      sourceId: injuryFactId,
      relatedCharacterIds: [cenYaoId],
      relatedForeshadowingIds: [],
      relatedTimelineEventIds: [timelineId]
    })
  ]

  /** @type {Partial<AppData>} */
  const appData = {
    schemaVersion: 3,
    projects: [project(projectId, '雨棚下的修表铺', '都市悬疑', '修复师追查一只被调包的委托表，所有解法都受现实资源约束。', '近距离第三人称；动作具体，环境描写简洁。')],
    storyBibles: [bible(projectId, {
      worldbuilding: '故事发生在多雨的临江市南桥旧街，交通、支付和伤势均遵循现实常识。',
      corePremise: '岑遥必须在不牺牲同伴的前提下找回被调包的委托表。',
      protagonistDesire: '找回委托表并查清调包者。',
      protagonistFear: '自己的冒险会让邱禾失去工作。',
      mainConflict: '证据藏在夜间封闭的旧仓库里，巡夜人正在折返。',
      bannedTropes: '禁止巧合送来钥匙、现金或即时痊愈。',
      styleSample: '雨从铁皮边缘落下。岑遥等脚步过去，才把手伸向门缝。',
      narrativeTone: '紧绷、克制，靠动作与代价制造悬念。',
      immutableFacts: '现实都市；没有超自然力量；人物只能使用明确持有的资源。'
    })],
    chapters: [
      chapter(
        chapterOneId,
        projectId,
        1,
        '当票背面',
        '岑遥在关门前赶到南桥当铺。柜员否认见过委托表，却把一张黄铜当票推回玻璃下。票背有七道极细的刻线，像某只表壳留下的拓印。她没有追问，只把当票收进口袋。邱禾在门外等她，提醒末班车不会为任何人延迟。两人核对旧仓库地址，决定先去看门，不带多余工具，也不惊动巡夜人。',
        '岑遥取得带七道刻线的黄铜当票，与邱禾前往旧仓库。',
        '仓库清单末尾多出一格空白编号。'
      ),
      chapter(
        chapterTwoId,
        projectId,
        2,
        '门缝里的链环',
        '药店收走最后一张整钞后，岑遥数了数，只剩八十六元。她买来的药瓶仍封着，因为后巷没有可以清洗伤口的水。卷帘门下沿有一道窄缝，她用随身细钩试探，左掌却被毛边割开。邱禾压着手电，报出末班车还剩二十六分钟。\n\n细钩终于绕过内侧链环。岑遥将黄铜当票和药瓶塞回右侧衣袋，改用受伤的左手稳住握柄。巷口传来巡夜人的咳嗽，比预计早了一轮。邱禾低声说“撤”，岑遥没有回头，细钩已经开始受力。',
        '两人抵达仓库后巷；岑遥左掌割伤，细钩已穿过门内链环，巡夜人提前折返。',
        bridgeAction,
        '巡夜脚步正在逼近，末班车窗口继续缩短。'
      )
    ],
    characters,
    characterStateFacts,
    foreshadowings: [stoppedWatch],
    timelineEvents: [timeline],
    hardCanonPacks: [hardCanonPack('mc01-hard-canon-pack', projectId, hardCanonItems)],
    chapterContinuityBridges: [continuityBridge('mc01-bridge-02-to-03', projectId, chapterTwoId, 3, {
      lastSceneLocation: '仓库后巷卷帘门外，巡夜人正从巷口折返。',
      lastPhysicalState: '岑遥左掌伤口渗血，左手仍稳着已经受力的细钩。',
      lastEmotionalState: '岑遥专注而逞强；邱禾警觉并主张立刻撤离。',
      lastUnresolvedAction: bridgeAction,
      lastDialogueOrThought: '邱禾刚低声说了一个“撤”字，岑遥还没有回应。',
      immediateNextBeat: bridgeNextBeat,
      mustContinueFrom: '巡夜人的咳嗽刚落，细钩已经绷紧。',
      mustNotReset: '不得重新抵达仓库、重新介绍门锁，或让左掌伤势与已持物品无解释消失。',
      openMicroTensions: '继续拉会加重伤口；撤离会失去当夜进入仓库的机会。'
    })]
  }

  return {
    id: 'continuity-hard-state',
    title: '续章承接与硬状态',
    purpose: '比较续章能否直接接住未完成动作，并同时遵守现金、伤势和持有物品的硬状态。',
    projectId,
    targetChapterOrder: 3,
    appData,
    chapterTask: {
      goal: '从细钩已经受力的瞬间续写：岑遥与邱禾必须行动，在巡夜人靠近前完成或放弃开门。',
      conflict: '岑遥的左掌伤势妨碍发力，邱禾要求撤离；两人还要核对钱、时间与现有物品能否支持选择。',
      suspenseToKeep: '保留停摆的七码表为何与黄铜当票刻线相同的疑问，本章只作轻微暗示。',
      allowedPayoffs: '允许暗示停摆的七码表与门内物件有关；允许决定是否打开卷帘门。',
      forbiddenPayoffs: '不得解释该表的来源；不得凭空增加现金、钥匙、车辆或工具；不得让左掌立刻痊愈。',
      endingHook: '以门是否打开后的一个具体新阻碍收束，不揭示调包者身份。',
      readerEmotion: '紧张，并能清楚感到每个选择的现实代价。',
      targetWordCount: '1800-2400',
      styleRequirement: '开头不得重置场景；动作连续、因果清楚，少作背景复述。'
    },
    expected: {
      characterIds: [cenYaoId, qiuHeId],
      stateFactIds: [cashFactId, injuryFactId, inventoryFactId, qiuLocationFactId],
      foreshadowingModes: { [watchHookId]: 'hint' },
      hardCanonItemIds: [cashCanonId, injuryCanonId],
      timelineEventIds: [timelineId],
      bridgeFragments: [bridgeAction, bridgeNextBeat]
    },
    rubric: [
      { id: 'mc01-direct-continuation', label: '直接承接', question: '开头是否从细钩受力与脚步逼近的同一时刻继续，而非另起场景或复述抵达过程？' },
      { id: 'mc01-hard-state', label: '硬状态准确', question: '现金八十六元、左掌渗血、三件随身物品和邱禾的位置是否都保持准确且影响行动？' },
      { id: 'mc01-action-causality', label: '动作因果', question: '开门或撤离的结果是否由人物动作、伤势与时间压力共同造成，而非巧合解决？' },
      { id: 'mc01-hook-restraint', label: '伏笔克制', question: '停摆的七码表是否只得到轻微暗示，没有被提前解释或回收？' },
      { id: 'mc01-prose-control', label: '叙事控制', question: '正文是否少复述背景，并让空间位置、动作先后和代价容易跟随？' }
    ]
  }
}

/** @returns {ModelComparisonCase} */
function createForeshadowingCase() {
  const projectId = 'model-case-02-tide-archive'
  const zhuXianId = 'mc02-character-zhu-xian'
  const muZhenId = 'mc02-character-mu-zhen'
  const chapterOneId = 'mc02-chapter-01'
  const chapterTwoId = 'mc02-chapter-02'
  const permitFactId = 'mc02-fact-reading-permit'
  const knowledgeFactId = 'mc02-fact-known-page-gap'
  const promiseFactId = 'mc02-fact-mu-promise'
  const blueReceiptId = 'mc02-foreshadow-blue-receipt'
  const missingPageId = 'mc02-foreshadow-missing-page-number'
  const northWindowId = 'mc02-foreshadow-north-window-salt'
  const timelineId = 'mc02-timeline-bell-inspection'
  const archiveRuleId = 'mc02-canon-bell-rule'
  const noTemporaryRuleId = 'mc02-canon-no-temporary-rule'
  const bridgeAction = '祝弦把第七码放到灯下，穆箴正翻到目录中被撕去的第二十一页。'
  const bridgeNextBeat = '先核对第七码与目录断口，再决定是否在闭馆钟响前提交缺页编号。'

  const characters = [
    character({
      id: zhuXianId,
      projectId,
      name: '祝弦',
      role: '主角，港务档案校对员',
      surfaceGoal: '在闭馆前证明航册缺页编号与蓝线收据属于同一批归档。',
      deepDesire: '让证据本身胜过资历与声望。',
      coreFear: '自己一次错误校对会毁掉无辜船员的申诉。',
      selfDeception: '她以为只要证据完整，就不必解释自己为何私查航册。',
      knownInformation: '知道第七码纸纤维与目录断口相合，也知道闭馆钟响后不得翻页。',
      unknownInformation: '不知道蓝线收据上的第二层墨迹写了谁的名字。',
      protagonistRelationship: '穆箴是协助者，也是负责追究违规的人。',
      emotionalState: '冷静中带着被审视的压力。',
      nextActionTendency: '先完成可复核的纸张比对，再提出结论。',
      forbiddenWriting: '不得凭直觉宣布幕后者，不得绕过闭馆钟规则继续翻页。',
      roleFunction: '完成缺页编号的证据回收，同时控制新线索的揭示量。',
      deepNeed: '承认程序约束也能保护真相。',
      decisionLogic: '只有纸张、编号与登记三项相互印证时才提交结论。',
      abilitiesAndResources: '熟悉航册编码，持有临时阅档证和第七码纸片。',
      weaknessAndCost: '阅档证只在闭馆钟前有效，违规会失去校对资格。',
      relationshipTension: '需要穆箴作证，却怀疑他隐瞒了审查范围。',
      futureHooks: '蓝线收据的复写墨迹可能对应另一批货。',
      lastChangedChapter: 2,
      isMain: true
    }),
    character({
      id: muZhenId,
      projectId,
      name: '穆箴',
      role: '同伴，档案馆夜间监理',
      surfaceGoal: '在不破坏封存程序的前提下核实祝弦的发现。',
      deepDesire: '证明守规则不等于掩盖错误。',
      coreFear: '父亲经手的旧档案被证实有人为篡改。',
      selfDeception: '他认为保持沉默就能保持中立。',
      knownInformation: '知道闭馆钟检查记录，也见过被撕页的目录。',
      unknownInformation: '不知道祝弦已找到第七码纸片。',
      protagonistRelationship: '与祝弦立场相左，但已承诺对可复核证据签字。',
      emotionalState: '戒备，仍维持职业礼貌。',
      nextActionTendency: '先查目录断口，再决定是否履行签字承诺。',
      forbiddenWriting: '不得无证据改口或突然承认篡改。',
      roleFunction: '提供程序阻力，并在证据成立时兑现见证承诺。',
      deepNeed: '把事实责任与家族羞耻分开。',
      decisionLogic: '程序没有被破坏且证据可复核时才支持祝弦。',
      abilitiesAndResources: '有权调阅闭馆钟检查簿，但无权延长阅档时间。',
      weaknessAndCost: '他的签字会触发对父亲旧案的复查。',
      relationshipTension: '既想制止祝弦越界，又不愿否认可验证的事实。',
      futureHooks: '他曾在北窗值班，却拒绝谈那夜的盐雾。',
      lastChangedChapter: 2,
      isMain: false
    })
  ]

  const characterStateFacts = [
    stateFact({
      id: permitFactId,
      projectId,
      characterId: zhuXianId,
      category: 'ability',
      key: 'reading_permit',
      label: '临时阅档证权限',
      valueType: 'string',
      value: '可查阅第三库航册；闭馆钟响即失效；不可带走原件。',
      unit: '',
      linkedCardFields: /** @type {CharacterCardField[]} */ (['abilitiesAndResources', 'weaknessAndCost']),
      trackingLevel: 'hard',
      promptPolicy: 'always',
      status: 'active',
      sourceChapterId: chapterOneId,
      sourceChapterOrder: 1,
      evidence: '阅档证背面印明权限与失效条件。',
      confidence: 1
    }),
    stateFact({
      id: knowledgeFactId,
      projectId,
      characterId: zhuXianId,
      category: 'knowledge',
      key: 'known_page_gap',
      label: '已确认的缺页事实',
      valueType: 'list',
      value: ['目录第二十一页被撕去', '第七码纸纤维与断口相合', '尚未识别蓝线收据第二层墨迹'],
      unit: '',
      linkedCardFields: /** @type {CharacterCardField[]} */ (['roleFunction', 'futureHooks']),
      trackingLevel: 'hard',
      promptPolicy: 'always',
      status: 'active',
      sourceChapterId: chapterTwoId,
      sourceChapterOrder: 2,
      evidence: '祝弦完成了纸纤维与目录断口的初步比对。',
      confidence: 1
    }),
    stateFact({
      id: promiseFactId,
      projectId,
      characterId: muZhenId,
      category: 'promise',
      key: 'witness_promise',
      label: '见证签字承诺',
      valueType: 'string',
      value: '若缺页编号能由目录断口与检查簿共同验证，穆箴会在闭馆前签字。',
      unit: '',
      linkedCardFields: /** @type {CharacterCardField[]} */ (['decisionLogic', 'relationshipTension']),
      trackingLevel: 'hard',
      promptPolicy: 'always',
      status: 'active',
      sourceChapterId: chapterTwoId,
      sourceChapterOrder: 2,
      evidence: '穆箴在第三库门口明确作出条件承诺。',
      confidence: 1
    })
  ]

  const foreshadowings = [
    foreshadowing({
      id: blueReceiptId,
      projectId,
      title: '蓝线收据',
      firstChapterOrder: 1,
      description: '收据夹层有受潮后才显出的第二层复写墨迹。',
      status: 'unresolved',
      weight: 'high',
      treatmentMode: 'hint',
      expectedPayoff: '后续通过可验证方法读出复写内容。',
      payoffMethod: '本章只让一道笔画或纸张反应出现，不读出完整姓名。',
      relatedCharacterIds: [zhuXianId],
      relatedMainPlot: '航册归档篡改',
      notes: '保持为 hint。',
      actualPayoffChapter: null
    }),
    foreshadowing({
      id: missingPageId,
      projectId,
      title: '缺页编号',
      firstChapterOrder: 1,
      description: '目录第二十一页被整齐撕去，第七码纸片保留半个编号。',
      status: 'partial',
      weight: 'payoff',
      treatmentMode: 'payoff',
      expectedPayoff: '第 3 章允许确认缺页完整编号为“潮历四十七年七码”。',
      payoffMethod: '以纸张断口和闭馆钟检查簿双重验证，不靠猜测。',
      relatedCharacterIds: [zhuXianId, muZhenId],
      relatedMainPlot: '航册归档篡改',
      notes: '这是本章唯一允许完整回收的既有伏笔。',
      actualPayoffChapter: null
    }),
    foreshadowing({
      id: northWindowId,
      projectId,
      title: '北窗盐痕',
      firstChapterOrder: 2,
      description: '北窗内侧有一道与海风方向相反的盐痕。',
      status: 'unresolved',
      weight: 'medium',
      treatmentMode: 'hidden',
      expectedPayoff: '更晚章节再调查盐痕形成原因。',
      payoffMethod: '当前章节不提及、不推进。',
      relatedCharacterIds: [muZhenId],
      relatedMainPlot: '夜间档案调包路线',
      notes: '严格 hidden。',
      actualPayoffChapter: null
    })
  ]

  const timeline = timelineEvent(
    timelineId,
    projectId,
    '闭馆钟首次检查',
    2,
    '潮历四十八年汛月十二日 20:42',
    2,
    [zhuXianId, muZhenId],
    '穆箴确认闭馆钟将在二十分钟后响起，并承诺证据成立便签字。',
    '第 3 章必须发生在钟响前，且不能新增延长阅档的例外。'
  )

  const hardCanonItems = [
    hardCanonItem({
      id: archiveRuleId,
      projectId,
      category: 'world_rule',
      title: '闭馆钟阅档规则',
      content: '闭馆钟响后，临时阅档证立即失效，所有人必须合上原件；没有口头延期或临时豁免。',
      priority: 'must',
      status: 'active',
      sourceType: 'story_bible',
      sourceId: null,
      relatedCharacterIds: [zhuXianId, muZhenId],
      relatedForeshadowingIds: [missingPageId],
      relatedTimelineEventIds: [timelineId]
    }),
    hardCanonItem({
      id: noTemporaryRuleId,
      projectId,
      category: 'foreshadowing_rule',
      title: '线索必须沿既有机制验证',
      content: '伏笔推进只能使用已经出现的纸张断口、复写墨迹和检查簿；任何解决办法都必须能由前章已有材料支持。',
      priority: 'must',
      status: 'active',
      sourceType: 'manual',
      sourceId: null,
      relatedCharacterIds: [zhuXianId, muZhenId],
      relatedForeshadowingIds: [blueReceiptId, missingPageId, northWindowId],
      relatedTimelineEventIds: [timelineId]
    })
  ]

  /** @type {Partial<AppData>} */
  const appData = {
    schemaVersion: 3,
    projects: [project(projectId, '潮声档案馆', '架空悬疑', '校对员在封闭档案馆内用可复核证据追查航册缺页。', '冷静、精确；设定通过人物操作体现，不作说明书式讲解。')],
    storyBibles: [bible(projectId, {
      worldbuilding: '临潮港以纸质航册登记货运。档案馆按闭馆钟统一封存原件，规则公开且稳定。',
      corePremise: '祝弦要在程序限制内证明航册被人替换，证据必须能由他人复核。',
      protagonistDesire: '恢复被错误注销的船员记录。',
      protagonistFear: '错误结论会让申诉者永久失去资格。',
      mainConflict: '闭馆时间逼近，穆箴只接受不破坏程序的证据。',
      bannedTropes: '禁止临时增加规则、万能药剂、神秘口令或无依据自白。',
      styleSample: '祝弦没有争辩。她把两片纸移到同一束灯下，让断口自己说话。',
      narrativeTone: '理性压迫感，发现必须有可见证据链。',
      immutableFacts: '闭馆钟规则对所有人相同；没有超自然显字机制。'
    })],
    chapters: [
      chapter(
        chapterOneId,
        projectId,
        1,
        '蓝线夹层',
        '祝弦从退回的申诉袋里找到一张蓝线收据。纸面只有普通运费数字，夹层却比边缘厚半分。她在登记台前拆不得、带不走，只能记下纸纹。临时阅档证准她进入第三库，条件写得清楚：闭馆钟一响，原件必须合上。穆箴查验印章后放她进去，没有承诺帮忙，只说程序留下什么，他就认什么。',
        '祝弦取得第三库临时阅档权限，发现蓝线收据夹层异常。',
        '第三库目录的第二十一页不在装订线上。'
      ),
      chapter(
        chapterTwoId,
        projectId,
        2,
        '撕页断口',
        '目录第二十一页被整齐撕去，装订线只剩一排浅毛边。祝弦取出申诉袋里的第七码纸片，纸纤维与断口相合，半个墨号停在边缘。蓝线收据受了库内潮气，夹层浮出一道新的笔画，但还拼不成名字。\n\n穆箴调来闭馆钟检查簿，指着剩下的二十分钟：“编号能同时对上断口和检查簿，我签字。对不上，你现在就停。”祝弦把第七码放到灯下，穆箴翻开目录，手指停在缺口旁。',
        '第七码纸纤维与目录断口相合；蓝线收据仅显出一道新笔画；穆箴作出有条件的签字承诺。',
        bridgeAction,
        '闭馆钟还有二十分钟，现有证据尚未完成双重验证。'
      )
    ],
    characters,
    characterStateFacts,
    foreshadowings,
    timelineEvents: [timeline],
    hardCanonPacks: [hardCanonPack('mc02-hard-canon-pack', projectId, hardCanonItems)],
    chapterContinuityBridges: [continuityBridge('mc02-bridge-02-to-03', projectId, chapterTwoId, 3, {
      lastSceneLocation: '档案馆第三库的目录台前，闭馆钟尚未响。',
      lastPhysicalState: '祝弦持有第七码纸片；穆箴的手指停在目录断口旁。',
      lastEmotionalState: '祝弦专注，穆箴戒备但已给出明确验证条件。',
      lastUnresolvedAction: bridgeAction,
      lastDialogueOrThought: '穆箴承诺：编号同时对上断口和检查簿，他就签字。',
      immediateNextBeat: bridgeNextBeat,
      mustContinueFrom: '两人已经开始比对，不得跳过验证过程直接宣布结论。',
      mustNotReset: '不得重新进入第三库，不得增加规则例外，也不得让蓝线收据突然显示完整姓名。',
      openMicroTensions: '缺页编号可回收；蓝线收据只能暗示；北窗盐痕必须隐藏。'
    })]
  }

  return {
    id: 'foreshadowing-bounded-progression',
    title: '伏笔分级推进与规则边界',
    purpose: '比较正文能否同时执行暗示、回收和隐藏三种伏笔处理，并只使用已建立的验证机制。',
    projectId,
    targetChapterOrder: 3,
    appData,
    chapterTask: {
      goal: '祝弦与穆箴继续核对缺页编号，在闭馆钟响前完成可复核的结论与签字选择。',
      conflict: '证据必须同时符合目录断口和闭馆钟检查簿，穆箴的签字又会触发对父亲旧案的复查。',
      suspenseToKeep: '蓝线收据只增加一个可见但不完整的笔画，继续保留第二层墨迹写了谁的疑问。',
      allowedPayoffs: '允许完整回收缺页编号，确认其为“潮历四十七年七码”；允许蓝线收据维持 hint，只展示不完整笔画。',
      forbiddenPayoffs: '禁止提及或推进北窗盐痕；禁止读出这张收据的完整姓名；不得新增临时规则、显字药水、秘密口令或闭馆豁免。',
      endingHook: '以穆箴是否签字及其直接后果收束，同时保留蓝线收据的身份悬念。',
      readerEmotion: '获得一次扎实的小回收，同时意识到更大的责任正在逼近。',
      targetWordCount: '1800-2400',
      styleRequirement: '证据推进必须展示核对过程；设定通过动作体现，不补写新机制。'
    },
    expected: {
      characterIds: [zhuXianId, muZhenId],
      stateFactIds: [permitFactId, knowledgeFactId, promiseFactId],
      foreshadowingModes: {
        [blueReceiptId]: 'hint',
        [missingPageId]: 'payoff'
      },
      hardCanonItemIds: [archiveRuleId, noTemporaryRuleId],
      timelineEventIds: [timelineId],
      bridgeFragments: [bridgeAction, bridgeNextBeat]
    },
    rubric: [
      { id: 'mc02-payoff-evidence', label: '回收有据', question: '缺页编号是否通过断口与检查簿完成双重验证，而非由人物猜中或旁白宣布？' },
      { id: 'mc02-hint-control', label: '暗示适量', question: '蓝线收据是否只新增有限、可见的提示，并继续隐藏完整姓名？' },
      { id: 'mc02-hidden-respected', label: '隐藏遵守', question: '正文是否完全没有提及、影射或推进北窗盐痕？' },
      { id: 'mc02-rule-integrity', label: '规则稳定', question: '解决过程是否只使用既有纸张、目录和检查簿，没有临时规则、工具或豁免？' },
      { id: 'mc02-character-cost', label: '人物代价', question: '穆箴的签字选择是否体现旧案复查的代价，而不是机械配合剧情？' }
    ]
  }
}

/** @returns {ModelComparisonCase} */
function createStyleCase() {
  const projectId = 'model-case-03-night-kitchen'
  const guWeiId = 'mc03-character-gu-wei'
  const qiaoLiId = 'mc03-character-qiao-li'
  const chapterOneId = 'mc03-chapter-01'
  const chapterTwoId = 'mc03-chapter-02'
  const debtFactId = 'mc03-fact-debt-total'
  const recipeFactId = 'mc03-fact-recipe-knowledge'
  const trustFactId = 'mc03-fact-trust-boundary'
  const signatureHookId = 'mc03-foreshadow-blank-signature'
  const timelineId = 'mc03-timeline-audit-notice'
  const factCanonId = 'mc03-canon-negotiation-facts'
  const styleCanonId = 'mc03-canon-restrained-dialogue'
  const bridgeAction = '谷惟把审计通知推到桌子中央，正等乔栎回答是否见过附件上的空白签收栏。'
  const bridgeNextBeat = '从乔栎看清空白签收栏后的停顿继续，让两人围绕已知事实作出是否共同赴约的决定。'

  const characters = [
    character({
      id: guWeiId,
      projectId,
      name: '谷惟',
      role: '主角，深夜面馆店主',
      surfaceGoal: '确认乔栎是否愿意共同出席次日九点的租约审计。',
      deepDesire: '保住面馆，也保住与乔栎平等合作的可能。',
      coreFear: '求助会被理解成把债务推给别人。',
      selfDeception: '他认为只陈述数字就不算请求。',
      knownInformation: '知道欠租共一万二千元、审计时间为次日九点，也知道乔栎看过旧配方。',
      unknownInformation: '不知道乔栎是否见过审计附件的空白签收栏。',
      protagonistRelationship: '与乔栎曾是合伙人，三个月前因经营分歧拆伙。',
      emotionalState: '疲惫，戒备，努力把请求说成事实核对。',
      nextActionTendency: '先问签收栏，再明确提出共同赴约。',
      forbiddenWriting: '不得长篇自白、反复解释欠租数字或突然和解。',
      roleFunction: '用一次克制询问推动共同赴约的决定。',
      deepNeed: '学会直接请求，而不是让对方猜测。',
      decisionLogic: '事实说清后只提出一个可执行请求，不拿旧情施压。',
      abilitiesAndResources: '持有审计通知、租约副本与当晚营业现金账。',
      weaknessAndCost: '欠租一万二千元，若审计失败将失去铺面。',
      relationshipTension: '乔栎愿意核对账目，但不接受谷惟替她决定。',
      futureHooks: '审计附件上的空白签收栏可能对应未登记的经手人。',
      lastChangedChapter: 2,
      isMain: true
    }),
    character({
      id: qiaoLiId,
      projectId,
      name: '乔栎',
      role: '前合伙人，食品检验员',
      surfaceGoal: '判断审计通知是否与自己保留的旧配方记录有关。',
      deepDesire: '在不重回旧关系的情况下保护自己参与建立的配方。',
      coreFear: '一次帮忙会被谷惟当成默认复合经营。',
      selfDeception: '她认为只谈文件就能避开彼此的怨气。',
      knownInformation: '知道旧配方第三页缺少签收记录，知道欠租金额但未承诺出席审计。',
      unknownInformation: '不知道谷惟已决定接受分期而非借新债。',
      protagonistRelationship: '前合伙人；仍尊重谷惟的手艺，不信任他的经营决定。',
      emotionalState: '冷静，保留，因空白签收栏产生警觉。',
      nextActionTendency: '先确认文件来源，再给出有条件的答复。',
      forbiddenWriting: '不得用讥讽替代观点，不得突然原谅或恢复合伙。',
      roleFunction: '以边界清楚的答复迫使谷惟把请求说完整。',
      deepNeed: '允许合作有临时、有限的形式。',
      decisionLogic: '只对与配方记录直接相关、边界明确的行动负责。',
      abilitiesAndResources: '保存旧配方复印件，熟悉检验与签收流程。',
      weaknessAndCost: '公开参与会让现单位追问她与面馆的利益关系。',
      relationshipTension: '反感谷惟含混求助，但愿意听一次明确请求。',
      futureHooks: '她的旧配方复印件上也可能缺少同一签名。',
      lastChangedChapter: 2,
      isMain: false
    })
  ]

  const characterStateFacts = [
    stateFact({
      id: debtFactId,
      projectId,
      characterId: guWeiId,
      category: 'resource',
      key: 'rent_debt',
      label: '欠租总额',
      valueType: 'number',
      value: 12000,
      unit: '元',
      linkedCardFields: /** @type {CharacterCardField[]} */ (['surfaceGoal', 'weaknessAndCost']),
      trackingLevel: 'hard',
      promptPolicy: 'always',
      status: 'active',
      sourceChapterId: chapterOneId,
      sourceChapterOrder: 1,
      evidence: '审计通知与租约副本均写明欠租一万二千元。',
      confidence: 1
    }),
    stateFact({
      id: recipeFactId,
      projectId,
      characterId: qiaoLiId,
      category: 'knowledge',
      key: 'recipe_record_knowledge',
      label: '乔栎已知的配方记录',
      valueType: 'list',
      value: ['旧配方第三页缺少签收记录', '审计通知来源尚未核实', '谷惟未说明是否接受分期'],
      unit: '',
      linkedCardFields: /** @type {CharacterCardField[]} */ (['decisionLogic', 'futureHooks']),
      trackingLevel: 'hard',
      promptPolicy: 'always',
      status: 'active',
      sourceChapterId: chapterTwoId,
      sourceChapterOrder: 2,
      evidence: '乔栎在后厨逐项说明自己已经知道与仍不知道的内容。',
      confidence: 1
    }),
    stateFact({
      id: trustFactId,
      projectId,
      characterId: qiaoLiId,
      category: 'relationship',
      key: 'cooperation_boundary',
      label: '合作边界',
      valueType: 'string',
      value: '乔栎只同意核对文件，尚未同意出席审计或恢复合伙。',
      unit: '',
      linkedCardFields: /** @type {CharacterCardField[]} */ (['relationshipTension', 'deepNeed']),
      trackingLevel: 'hard',
      promptPolicy: 'always',
      status: 'active',
      sourceChapterId: chapterTwoId,
      sourceChapterOrder: 2,
      evidence: '乔栎明确说“我只看文件，别替我答应别的”。',
      confidence: 1
    })
  ]

  const signatureHook = foreshadowing({
    id: signatureHookId,
    projectId,
    title: '空白签收栏',
    firstChapterOrder: 2,
    description: '审计附件与旧配方第三页都可能缺少同一处经手人签名。',
    status: 'unresolved',
    weight: 'medium',
    treatmentMode: 'hint',
    expectedPayoff: '后续通过两份文件比对确认缺失签名是否同源。',
    payoffMethod: '本章只确认乔栎是否见过类似空栏，不揭示经手人。',
    relatedCharacterIds: [guWeiId, qiaoLiId],
    relatedMainPlot: '面馆租约审计',
    notes: '服务于对话推进，不抢走关系选择。',
    actualPayoffChapter: null
  })

  const timeline = timelineEvent(
    timelineId,
    projectId,
    '收到租约审计通知',
    2,
    '周一 23:18',
    2,
    [guWeiId, qiaoLiId],
    '谷惟在打烊后向乔栎出示通知；审计定于周二 09:00，乔栎只同意先核对文件。',
    '本章仍在同一晚后厨，核心结果应是是否共同赴约，不能把审计写成已经发生。'
  )

  const hardCanonItems = [
    hardCanonItem({
      id: factCanonId,
      projectId,
      category: 'timeline_anchor',
      title: '审计与欠租事实',
      content: '当前是周一深夜；欠租总额为一万二千元；审计在周二上午九点，尚未发生；乔栎尚未答应出席。',
      priority: 'must',
      status: 'active',
      sourceType: 'timeline',
      sourceId: timelineId,
      relatedCharacterIds: [guWeiId, qiaoLiId],
      relatedForeshadowingIds: [signatureHookId],
      relatedTimelineEventIds: [timelineId]
    }),
    hardCanonItem({
      id: styleCanonId,
      projectId,
      category: 'style_boundary',
      title: '克制对白边界',
      content: '对白短而有潜台词；同一事实最多完整陈述一次；不得用长篇自白、连续反问或旁白复述刚说过的话制造强度。',
      priority: 'must',
      status: 'active',
      sourceType: 'manual',
      sourceId: null,
      relatedCharacterIds: [guWeiId, qiaoLiId],
      relatedForeshadowingIds: [],
      relatedTimelineEventIds: [timelineId]
    })
  ]

  /** @type {Partial<AppData>} */
  const appData = {
    schemaVersion: 3,
    projects: [project(projectId, '打烊后的两碗面', '现实题材', '一对拆伙的合伙人在深夜后厨处理租约审计与未说清的合作边界。', '克制、具体、少解释；对白有停顿和潜台词，不重复事实。')],
    storyBibles: [bible(projectId, {
      worldbuilding: '当代小城的普通面馆，合同、欠租和审计遵循现实程序。',
      corePremise: '谷惟必须直接提出一次有限请求，乔栎必须在保护边界的前提下回答。',
      protagonistDesire: '保住面馆并修复最低限度的合作。',
      protagonistFear: '请求帮助会重演过去不平等的合伙关系。',
      mainConflict: '审计迫近，两人却对“帮忙”意味着什么理解不同。',
      bannedTropes: '禁止突然和解、煽情长篇独白、隐藏遗产或巧合解债。',
      styleSample: '谷惟把通知压平。乔栎没接，只把最后一只碗扣在架上。',
      narrativeTone: '安静、疲惫，有现实压力但不煽情。',
      immutableFacts: '欠租一万二千元；审计尚未发生；两人已经拆伙三个月。'
    })],
    chapters: [
      chapter(
        chapterOneId,
        projectId,
        1,
        '账本最后一页',
        '打烊后，谷惟把租约和账本摊在最靠里的桌上。欠租一万二千元，数字在两份文件上相同。他没有再借新债，房东给出的选择只有分期审计或月底退租。乔栎来取落在仓库的旧配方复印件，只答应看一眼账目。她指出配方第三页没有签收记录，随即把复印件收回袋里。',
        '谷惟确认欠租一万二千元；乔栎只答应核对账目，并指出旧配方缺签收记录。',
        '门外有人把一只写着“审计附件”的信封塞进来。'
      ),
      chapter(
        chapterTwoId,
        projectId,
        2,
        '后厨的通知',
        '审计通知写明周二上午九点见面，附件最后一栏没有经手人签名。谷惟把欠租数字说了一遍，乔栎点头：“这个我知道。”他又提到旧配方，乔栎只说第三页也缺签收记录，通知来源她没见过。\n\n蒸汽散尽，后厨只剩排风扇的低响。谷惟没有解释自己为何叫她来，也没有问她是否愿意同行。他把审计通知推到桌子中央。乔栎终于低头，看见了附件上的空白签收栏。',
        '两人确认审计时间、欠租金额与两份文件的签收缺口；乔栎仍未答应出席。',
        bridgeAction,
        '谷惟的请求尚未说出口，乔栎的合作边界没有改变。'
      )
    ],
    characters,
    characterStateFacts,
    foreshadowings: [signatureHook],
    timelineEvents: [timeline],
    hardCanonPacks: [hardCanonPack('mc03-hard-canon-pack', projectId, hardCanonItems)],
    chapterContinuityBridges: [continuityBridge('mc03-bridge-02-to-03', projectId, chapterTwoId, 3, {
      lastSceneLocation: '打烊后的面馆后厨，审计通知摊在两人之间。',
      lastPhysicalState: '乔栎刚低头看清空白签收栏；谷惟的手还按在通知一角。',
      lastEmotionalState: '谷惟疲惫而难以开口；乔栎警觉并坚持边界。',
      lastUnresolvedAction: bridgeAction,
      lastDialogueOrThought: '谷惟尚未提出共同赴约，乔栎也没有作出承诺。',
      immediateNextBeat: bridgeNextBeat,
      mustContinueFrom: '以短暂停顿或一个具体动作接住，不重述通知送达过程。',
      mustNotReset: '不得重新介绍欠租、审计通知或拆伙背景；不得把审计写成已经发生。',
      openMicroTensions: '请求必须说清；答复可以有条件；旧关系不能因此自动修复。'
    })]
  }

  return {
    id: 'restrained-dialogue-fact-preservation',
    title: '克制对白与事实保真',
    purpose: '比较正文能否减少对白和旁白中的重复，同时保留金额、时间、知识差与关系边界。',
    projectId,
    targetChapterOrder: 3,
    appData,
    chapterTask: {
      goal: '谷惟直接询问空白签收栏并提出共同赴约，乔栎在边界清楚的前提下给出答复。',
      conflict: '谷惟需要帮助却习惯含混表达；乔栎愿意核对事实，但担心一次同行被视为恢复合伙。',
      suspenseToKeep: '保留空白签收栏对应哪位经手人的疑问，只确认乔栎是否见过类似空栏。',
      allowedPayoffs: '允许确定乔栎是否同意共同出席周二九点的审计；允许对空白签收栏作一次轻微暗示。',
      forbiddenPayoffs: '不得揭示该签收栏的经手人；不得让欠租消失；不得让两人突然和解或恢复合伙。',
      endingHook: '以一项明确、有限的同行条件或拒绝后的替代行动结束。',
      readerEmotion: '感到两人仍有距离，但这次把真正的问题说清了一点。',
      targetWordCount: '1400-2000',
      styleRequirement: '对白克制、句子自然，同一事实不完整重复；用停顿和动作承载潜台词，但必须保留欠租一万二千元、周二九点审计、乔栎尚未承诺和旧配方缺签收记录。'
    },
    expected: {
      characterIds: [guWeiId, qiaoLiId],
      stateFactIds: [debtFactId, recipeFactId, trustFactId],
      foreshadowingModes: { [signatureHookId]: 'hint' },
      hardCanonItemIds: [factCanonId, styleCanonId],
      timelineEventIds: [timelineId],
      bridgeFragments: [bridgeAction, bridgeNextBeat]
    },
    rubric: [
      { id: 'mc03-dialogue-restraint', label: '对白克制', question: '对白是否简短、自然且有潜台词，没有靠长篇自白或连续反问制造情绪？' },
      { id: 'mc03-repetition', label: '减少重复', question: '欠租、审计时间和拆伙背景是否只在必要处出现，没有被对白与旁白轮流复述？' },
      { id: 'mc03-fact-preservation', label: '事实保留', question: '一万二千元、周二九点、旧配方缺签收记录及乔栎尚未承诺等事实是否保持准确？' },
      { id: 'mc03-boundary', label: '关系边界', question: '乔栎的答复是否保留有限合作与恢复合伙之间的区别，没有突然和解？' },
      { id: 'mc03-subtext-clarity', label: '潜台词清楚', question: '即使减少解释，读者是否仍能理解谷惟在请求什么、乔栎担心什么，以及结尾决定了什么？' }
    ]
  }
}

/**
 * Returns fresh nested objects on every call so comparison runners can annotate
 * or normalize one run without leaking mutations into another.
 *
 * @returns {ModelComparisonCase[]}
 */
export function createModelComparisonCases() {
  return [createContinuityCase(), createForeshadowingCase(), createStyleCase()]
}
