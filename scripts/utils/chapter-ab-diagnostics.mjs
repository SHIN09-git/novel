const DEFAULT_OPPRESSIVE_TERMS = [
  '梦境',
  '阴影',
  '寒意',
  '冷意',
  '命运',
  '宿命',
  '危险',
  '不安',
  '恐惧',
  '深渊',
  '血色',
  '倒计时',
  '真相',
  '杀意',
  '心脏一紧',
  '后背发凉',
  '没来由'
]

const DEFAULT_WEB_NOVEL_HOOK_PATTERNS = [
  '一切(?:才|只是)?刚刚开始',
  '命运(?:的)?齿轮',
  '平静(?:从此|就此)?被打破',
  '(?:真正的)?(?:危险|故事|噩梦)(?:才)?(?:刚刚)?开始',
  '而我(?:却)?(?:还)?不知道',
  '等待(?:着)?我(?:的)?',
  '风暴将至',
  '无人知道',
  '后来我才知道',
  '这只是开始',
  '(?:通知|消息|那行字|那几个字)?[^。！？\\n]{0,30}像一粒沙子[^。！？\\n]{0,80}(?:涟漪|沉(?:了)?下去)',
  '(?:通知|消息|那行字|那几个字)[^。！？\\n]{0,24}(?:像|仿佛)[^。！？\\n]{0,60}(?:涟漪|沉(?:了)?下去)'
]

const DEFAULT_DOMESTIC_ACTION_TERMS = [
  '买',
  '挑',
  '拎',
  '提',
  '摔',
  '裂',
  '捡',
  '擦',
  '洗',
  '切',
  '剥',
  '拍',
  '炒',
  '煮',
  '烧',
  '盛',
  '端',
  '放',
  '拿',
  '递',
  '倒',
  '开火',
  '关火',
  '调小',
  '收拾',
  '扫',
  '拖',
  '刷',
  '尝',
  '闻',
  '系上',
  '摆好',
  '装进',
  '翻面'
]

const DEFAULT_EXPLANATION_MARKERS = [
  '因为',
  '所以',
  '意味着',
  '显然',
  '我知道',
  '我意识到',
  '我明白',
  '这说明',
  '换句话说',
  '也就是说',
  '其实',
  '原来',
  '可见',
  '原因是',
  '之所以',
  '那代表',
  '这代表',
  '不得不承认'
]

const DEFAULT_ORDINARY_TEXTURE_TERMS = [
  '菜篮',
  '布袋',
  '塑料袋',
  '摊位',
  '菜叶',
  '葱',
  '姜',
  '蒜',
  '土豆',
  '番茄',
  '青菜',
  '豆腐',
  '米',
  '油',
  '盐',
  '酱油',
  '砧板',
  '菜刀',
  '锅',
  '锅铲',
  '碗',
  '盘子',
  '筷子',
  '水槽',
  '抹布',
  '围裙',
  '冰箱',
  '料理台',
  '灶火',
  '蛋液',
  '蛋壳',
  '垃圾桶',
  '洗碗',
  '沥水'
]

const DEFAULT_INSTRUCTION_REGISTER_TERMS = [
  '本章',
  '不得',
  '不要',
  '只允许',
  '唯一允许',
  '全文',
  '首次出现',
  '前85%',
  '除此以外',
  '文风要求',
  '读者应该'
]

const DEFAULT_CONSTRAINT_MARKERS = [
  '必须',
  '不得',
  '不要',
  '禁止',
  '只能',
  '唯一',
  '不可',
  '不应',
  '避免',
  'hard rules',
  'do not',
  'must',
  'only'
]

const COMMON_CHINESE_SURNAMES =
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章云苏潘葛奚范彭郎鲁韦昌马苗方俞任袁柳唐罗薛伍余米贝姚孟顾尹江钟蔡田樊胡凌霍虞万柯管卢莫房裘解应宗丁宣邓郁单杭洪包诸左石崔吉龚程嵇邢裴陆荣翁荀羊惠甄曲封芮储靳段富巫乌焦巴牧山谷车侯全班秋仲伊宫宁仇栾甘厉祖武符刘景詹龙叶黎乔闻谭劳申冉牛寿边燕尚农温庄晏柴瞿阎艾鱼容向古易慎戈廖庾居衡步都耿满弘匡国文寇广东欧沃利越隆师巩聂晁融冷辛那简饶曾沙鞠丰巢关相查红游竺权盖益桓'

export const DEFAULT_CHAPTER_AB_DIAGNOSTIC_PROFILE = Object.freeze({
  oppressiveTerms: DEFAULT_OPPRESSIVE_TERMS,
  webNovelHookPatterns: DEFAULT_WEB_NOVEL_HOOK_PATTERNS,
  domesticActionTerms: DEFAULT_DOMESTIC_ACTION_TERMS,
  explanationMarkers: DEFAULT_EXPLANATION_MARKERS,
  ordinaryTextureTerms: DEFAULT_ORDINARY_TEXTURE_TERMS,
  instructionRegisterTerms: DEFAULT_INSTRUCTION_REGISTER_TERMS,
  constraintMarkers: DEFAULT_CONSTRAINT_MARKERS,
  tailCharacterCount: 500,
  dailyCoverageBins: 10,
  minimumDialogueTurns: 2,
  explanationRatioWarning: 0.28,
  dailySentenceRatioWarning: 0.35,
  dailyBinCoverageWarning: 0.4,
  ordinaryTextureWarning: 3
})

function text(value) {
  return String(value ?? '')
}

function unique(values) {
  return [...new Set(values.map((value) => text(value).trim()).filter(Boolean))]
}

function uniquePatterns(values) {
  const patterns = new Map()
  for (const value of values ?? []) {
    const key = value instanceof RegExp ? `regexp:${value.source}/${value.flags}` : `string:${text(value)}`
    if (!patterns.has(key)) patterns.set(key, value)
  }
  return [...patterns.values()]
}

function countOccurrences(value, needle) {
  const source = text(value)
  const candidate = text(needle)
  if (!candidate) return 0
  let count = 0
  let offset = 0
  while (offset <= source.length - candidate.length) {
    const index = source.indexOf(candidate, offset)
    if (index < 0) break
    count += 1
    offset = index + candidate.length
  }
  return count
}

function codePointLength(value) {
  return [...text(value)].length
}

function visibleLength(value) {
  return codePointLength(text(value).replace(/\s/gu, ''))
}

function normalizeForComparison(value) {
  return text(value).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
}

function numericUsageObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const sanitized = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      sanitized[key] = item
      continue
    }
    const nested = numericUsageObject(item)
    if (nested && Object.keys(nested).length > 0) sanitized[key] = nested
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null
}

export function extractModelResponseTelemetry(responseBody) {
  try {
    const payload = JSON.parse(text(responseBody))
    const finishReason =
      typeof payload?.choices?.[0]?.finish_reason === 'string' ? payload.choices[0].finish_reason : null
    return { finishReason, usage: numericUsageObject(payload?.usage) }
  } catch {
    return { finishReason: null, usage: null }
  }
}

export function auditWorkbenchRequests(recordsInput, options = {}) {
  const records = Array.isArray(recordsInput) ? recordsInput : []
  const expectedModelName = text(options.expectedModelName)
  const preflightOnly = options.preflightOnly === true
  const preflightDraftStopError = text(options.preflightDraftStopError)
  const planRequests = records.filter((record) => record?.stage === 'plan')
  const draftRequests = records.filter((record) => record?.stage === 'draft')
  const writingRequests = [...planRequests, ...draftRequests]
  const realStagesOrdered =
    draftRequests.length >= 1 &&
    records.slice(0, draftRequests.length).every((record) => record?.stage === 'draft') &&
    records.slice(draftRequests.length).every((record) => record?.stage === 'other')
  const checks = {
    requestsPresent: records.length > 0,
    expectedRouteAndMethod: records.every(
      (record) => record?.method === 'POST' && record?.pathname === '/chat/completions'
    ),
    exactModel: Boolean(expectedModelName) && records.every((record) => record?.model === expectedModelName),
    writingPromptsSafe:
      writingRequests.length > 0 && writingRequests.every((record) => record?.promptAudit?.hardPass === true),
    planRequestCount: planRequests.length === 0,
    draftRequestCount: preflightOnly
      ? draftRequests.length === 1
      : draftRequests.length >= 1 && draftRequests.length <= 2,
    expectedStages: preflightOnly
      ? records.length === 1 && records[0]?.stage === 'draft'
      : realStagesOrdered,
    openingPlanRequestSkipped: planRequests.length === 0,
    preflightDraftStopped:
      !preflightOnly ||
      (draftRequests[0]?.responseMode === 'intentional_draft_stop' &&
        !draftRequests[0]?.forwarded &&
        draftRequests[0]?.error === preflightDraftStopError),
    forwardingPolicySatisfied:
      preflightOnly || records.every((record) => record?.forwarded && record?.responseMode === 'forwarded')
  }
  return {
    requestCount: records.length,
    planRequestCount: planRequests.length,
    draftRequestCount: draftRequests.length,
    checks,
    hardPass: Object.values(checks).every(Boolean)
  }
}

export function summarizeDraftRequestTelemetry(recordsInput) {
  const records = Array.isArray(recordsInput) ? recordsInput : []
  return records
    .filter((record) => record?.stage === 'draft')
    .map((record) => ({
      index: Number.isInteger(record?.index) ? record.index : null,
      forwarded: record?.forwarded === true,
      responseMode: typeof record?.responseMode === 'string' ? record.responseMode : null,
      finishReason: typeof record?.finishReason === 'string' ? record.finishReason : null,
      usage: numericUsageObject(record?.usage)
    }))
}

function parseExpectedLength(value) {
  const values = text(value).match(/\d+/g)?.map(Number) ?? []
  return values.length >= 2 ? [values[0], values[1]] : [0, Number.POSITIVE_INFINITY]
}

function termHitDetails(value, terms) {
  const source = text(value)
  return unique(terms)
    .map((term) => {
      const count = countOccurrences(source, term)
      return count > 0 ? { term, count, firstIndex: source.indexOf(term) } : null
    })
    .filter(Boolean)
}

function instructionRegisterHitDetails(value, terms) {
  const source = text(value)
  return unique(terms)
    .map((term) => {
      const indexes = []
      let offset = 0
      while (offset <= source.length - term.length) {
        const index = source.indexOf(term, offset)
        if (index < 0) break
        const lexicalUse =
          (term === '不得' && source.startsWith('不得不', index)) ||
          (term === '不要' && source.slice(Math.max(0, index - 1), index + term.length) === '要不要')
        if (!lexicalUse) indexes.push(index)
        offset = index + term.length
      }
      return indexes.length > 0 ? { term, count: indexes.length, firstIndex: indexes[0] } : null
    })
    .filter(Boolean)
}

function oppressiveTermHitDetails(value, terms) {
  const source = text(value)
  return unique(terms)
    .map((term) => {
      const indexes = []
      let offset = 0
      while (offset <= source.length - term.length) {
        const index = source.indexOf(term, offset)
        if (index < 0) break
        const context = source.slice(Math.max(0, index - 60), Math.min(source.length, index + term.length + 60))
        const neutralWaterSound =
          term === '水声' &&
          !/(?:诡异|死寂|空荡|阴冷|寒意|危险|回荡|放大|刺耳|不安|心里一沉|后背发凉|像[^。！？]{0,24}(?:哭|喘息|脚步|低语|警告))/u.test(context)
        if (!neutralWaterSound) indexes.push(index)
        offset = index + term.length
      }
      return indexes.length > 0 ? { term, count: indexes.length, firstIndex: indexes[0] } : null
    })
    .filter(Boolean)
}

function splitSentences(value) {
  return text(value)
    .split(/(?<=[。！？!?…])|[\r\n]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function quoteMetrics(value) {
  const source = text(value)
  const patterns = [/“([^”]*)”/gu, /「([^」]*)」/gu, /『([^』]*)』/gu, /"([^"\r\n]*)"/gu]
  let quotedCharacters = 0
  let turns = 0
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      quotedCharacters += visibleLength(match[1])
      turns += 1
    }
  }
  return {
    dialogueCharacterCount: quotedCharacters,
    dialogueTurnCount: turns,
    dialogueCharacterRatio: visibleLength(source) > 0 ? quotedCharacters / visibleLength(source) : 0
  }
}

function narrationWithoutDialogue(value) {
  return text(value)
    .replace(/“[^”]*”/gu, '')
    .replace(/「[^」]*」/gu, '')
    .replace(/『[^』]*』/gu, '')
    .replace(/"[^"\r\n]*"/gu, '')
}

function delimiterAudit(value) {
  const pairs = new Map([
    ['“', '”'],
    ['「', '」'],
    ['『', '』'],
    ['（', '）'],
    ['(', ')'],
    ['【', '】'],
    ['[', ']'],
    ['《', '》']
  ])
  const closing = new Map([...pairs].map(([open, close]) => [close, open]))
  const stack = []
  const problems = []
  for (const [index, character] of [...text(value)].entries()) {
    if (pairs.has(character)) {
      stack.push({ character, index })
    } else if (closing.has(character)) {
      const expectedOpen = closing.get(character)
      const actual = stack.pop()
      if (actual?.character !== expectedOpen) {
        problems.push({ type: 'unexpected_closer', character, index, expectedOpen, actualOpen: actual?.character ?? null })
      }
    }
  }
  for (const item of stack) problems.push({ type: 'unclosed_opener', ...item })
  const asciiQuoteCount = countOccurrences(text(value), '"')
  if (asciiQuoteCount % 2 !== 0) problems.push({ type: 'unbalanced_ascii_quotes', count: asciiQuoteCount })
  return { balanced: problems.length === 0, problems }
}

function hasCompleteTerminal(value) {
  return /[。！？!?…](?:[”」』）)】\]》])*$/u.test(text(value).trim())
}

function forbiddenActionDetails(value, actions) {
  const source = text(value)
  const strictContextTerms = new Set(['附件里', '附件中'])
  const violations = []
  for (const action of unique(actions)) {
    let offset = 0
    while (offset <= source.length - action.length) {
      const index = source.indexOf(action, offset)
      if (index < 0) break
      const prefix = normalizeForComparison(source.slice(Math.max(0, index - 18), index))
      const negated =
        !strictContextTerms.has(action) &&
        /(?:没有|并没有|并未|未曾|从未|没再|不再|没|未|不|拒绝|放弃|避免)(?:打算|准备|决定|选择|继续|真的|去|再)?$/u.test(prefix)
      if (!negated) violations.push({ action, index })
      offset = index + action.length
    }
  }
  return violations
}

function isNegatedInquiryContext(value, matchIndex) {
  const sentenceStart = Math.max(
    value.lastIndexOf('。', matchIndex - 1),
    value.lastIndexOf('！', matchIndex - 1),
    value.lastIndexOf('？', matchIndex - 1),
    value.lastIndexOf('!', matchIndex - 1),
    value.lastIndexOf('?', matchIndex - 1),
    value.lastIndexOf('\n', matchIndex - 1)
  )
  const prefix = value.slice(sentenceStart + 1, matchIndex)
  const inquiryVerbs = [...prefix.matchAll(/(?:追问|询问|打听|问)/gu)]
  const lastInquiry = inquiryVerbs.at(-1)
  if (!lastInquiry || lastInquiry.index === undefined) return false
  const beforeInquiry = prefix.slice(Math.max(0, lastInquiry.index - 12), lastInquiry.index)
  return /(?:并没有|没有|并未|未曾|从未|没|未|并不|不)(?:再|曾|会|想|愿|打算|准备|继续|主动|开口|去)?\s*$/u.test(beforeInquiry)
}

function explicitTaskBehaviorViolations(value, task) {
  const source = text(value)
  const taskText = Object.values(task ?? {}).filter((item) => typeof item === 'string').join('\n')
  const violations = []
  const recordFirst = (action, patterns, options = {}) => {
    const candidates = []
    for (const pattern of patterns) {
      const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
      for (const match of source.matchAll(new RegExp(pattern.source, flags))) {
        const index = match.index ?? -1
        if (index < 0 || !match[0]) continue
        if (options.ignoreNegatedInquiry === true && isNegatedInquiryContext(source, index)) continue
        candidates.push({ action, index, evidence: match[0].replace(/\s+/gu, ' ').slice(0, 180) })
      }
    }
    candidates.sort((left, right) => left.index - right.index)
    if (candidates[0]) violations.push(candidates[0])
  }
  if (/不追问(?:通知|消息)?来源/u.test(taskText)) {
    recordFirst('追问通知来源', [
      /[“"「『]?(?:谁|哪(?:个|里|儿|边)|什么(?:人|单位|部门))[^。！？!?\n]{0,16}(?:发(?:来|的)|送来|通知)/u,
      /(?:通知|消息)[^。！？!?\n]{0,18}(?:谁发|哪(?:里|儿)来|来源)/u
    ], { ignoreNegatedInquiry: true })
  }
  if (/不作出(?:任何)?出行决定/u.test(taskText)) {
    recordFirst('作出后续出行决定', [
      /(?:明天|后天|改天|周末|下午|晚上)[\s\S]{0,180}?(?:去|出去|走走|逛逛|公园|超市|商场|旅行)[\s\S]{0,180}?[“"「『](?:行|好|可以|那就)(?:啊|呀|吧)?[。！？!?？”"」』]/u,
      /(?:明天|后天|改天|周末|下午|晚上)[\s\S]{0,180}?(?:去|出去|走走|逛逛|公园|超市|商场|旅行)[\s\S]{0,120}?(?:我答应|我同意|我点了点头|就这么定)/u
    ])
  }
  if (/陈航回家后两人一直留在家里/u.test(taskText)) {
    recordFirst('陈航回家后林雯外出返家', [
      /林雯(?:才|也)?(?:回来|回家|进门)时/u,
      /(?:到家|回到家|进门|把菜拎进厨房)[\s\S]{0,1600}?林雯(?:才|也)?(?:回来|回家|进门)/u
    ])
  }
  return violations
}

function sentenceRatio(sentences, terms) {
  if (!sentences.length || !terms.length) return 0
  const matched = sentences.filter((sentence) => terms.some((term) => sentence.includes(term))).length
  return matched / sentences.length
}

function termCoverageBins(value, terms, requestedBins) {
  const characters = [...text(value)]
  if (!characters.length || !terms.length) return { binCount: 0, coveredBins: 0, ratio: 0, bins: [] }
  const binCount = Math.max(1, Math.min(requestedBins, characters.length))
  const bins = []
  for (let index = 0; index < binCount; index += 1) {
    const start = Math.floor((characters.length * index) / binCount)
    const end = Math.floor((characters.length * (index + 1)) / binCount)
    const content = characters.slice(start, end).join('')
    const hits = terms.filter((term) => content.includes(term))
    bins.push({ index, hits })
  }
  const coveredBins = bins.filter((bin) => bin.hits.length > 0).length
  return { binCount, coveredBins, ratio: coveredBins / binCount, bins }
}

function scenePhaseDetail(value, phase, terms) {
  const source = text(value)
  const values = unique(Array.isArray(terms) ? terms : [terms])
  const exactPositions = values.map((term) => source.indexOf(term)).filter((index) => index >= 0)
  if (exactPositions.length > 0) {
    return { phase, terms: values, present: true, firstIndex: Math.min(...exactPositions), semanticHits: [] }
  }
  if (/(?:商量|安排).*(?:饭|吃)|(?:饭|吃).*(?:商量|安排)/u.test(text(phase))) {
    const mealDecisionPatterns = [
      /[“"「『][^”"」』\r\n]{0,48}(?:吃什么|打算怎么(?:做|烧)|怎么(?:做|烧)|要不要(?:吃|做)|(?:再|还)?(?:做|炒|煮|炖|烧)(?:个|点|些)?[^”"」』\r\n]{0,16})[？?][”"」』]/gu,
      /(?:问|商量|盘算|决定)[^。！？!?\n]{0,28}(?:吃什么|怎么(?:做|烧)|(?:做|炒|煮|炖|烧)(?:个|点|些)?菜)/gu
    ]
    const semanticHits = mealDecisionPatterns.flatMap((pattern) =>
      [...source.matchAll(pattern)].map((match) => ({ term: match[0], index: match.index ?? 0 }))
    ).sort((left, right) => left.index - right.index)
    return {
      phase,
      terms: values,
      present: semanticHits.length > 0,
      firstIndex: semanticHits[0]?.index ?? null,
      semanticHits
    }
  }
  if (!/(?:做饭|下厨|烹饪|备餐)/u.test(text(phase))) {
    return { phase, terms: values, present: false, firstIndex: null, semanticHits: [] }
  }
  const cookingEvidenceTerms = [
    '下厨',
    '炒',
    '煮',
    '炖',
    '焯',
    '切',
    '打散',
    '调味',
    '开火',
    '下锅',
    '砂锅',
    '锅铲',
    '灶台',
    '蛋液'
  ]
  const semanticHits = cookingEvidenceTerms
    .map((term) => ({ term, index: source.indexOf(term) }))
    .filter((item) => item.index >= 0)
  return {
    phase,
    terms: values,
    present: semanticHits.length >= 2,
    firstIndex: semanticHits.length >= 2 ? Math.min(...semanticHits.map((item) => item.index)) : null,
    semanticHits
  }
}

function taskClauses(task, ignoredTerms) {
  const ignored = new Set(unique(ignoredTerms).map(normalizeForComparison))
  const clauses = []
  for (const value of Object.values(task ?? {})) {
    if (typeof value !== 'string') continue
    for (const clause of value.split(/[\r\n。！？!?；;]+/u)) {
      const trimmed = clause.trim()
      const normalized = normalizeForComparison(trimmed)
      if (normalized.length < 8 || ignored.has(normalized)) continue
      clauses.push({ clause: trimmed, normalized })
    }
  }
  const byNormalized = new Map()
  for (const clause of clauses) if (!byNormalized.has(clause.normalized)) byNormalized.set(clause.normalized, clause)
  return [...byNormalized.values()]
}

function taskEchoMetrics(body, task, ignoredTerms) {
  const normalizedBody = normalizeForComparison(body)
  const hits = []
  let copiedCharacters = 0
  for (const item of taskClauses(task, ignoredTerms)) {
    const count = countOccurrences(normalizedBody, item.normalized)
    if (count < 1) continue
    copiedCharacters += item.normalized.length * count
    hits.push({ clause: item.clause, count, normalizedLength: item.normalized.length })
  }
  return {
    hits,
    copiedCharacterEstimate: copiedCharacters,
    copiedCharacterRatio: normalizedBody.length > 0 ? Math.min(1, copiedCharacters / normalizedBody.length) : 0
  }
}

function patternHits(value, patterns) {
  const source = text(value)
  const hits = []
  for (const pattern of patterns) {
    const expression = pattern instanceof RegExp ? new RegExp(pattern.source, pattern.flags.replace('g', '')) : new RegExp(text(pattern), 'iu')
    const match = expression.exec(source)
    if (!match) continue
    const matchEnd = match.index + match[0].length
    const overlapsExistingEquivalent = hits.some((hit) => {
      const hitEnd = hit.index + hit.match.length
      const overlaps = match.index < hitEnd && hit.index < matchEnd
      return overlaps && (hit.match.includes(match[0]) || match[0].includes(hit.match))
    })
    if (overlapsExistingEquivalent) continue
    hits.push({ pattern: expression.source, match: match[0], index: match.index })
  }
  return hits
}

function unknownProperNameCandidates(value, allowedValues) {
  const source = text(value)
  const allowed = unique(allowedValues)
  const isAllowed = (candidate) => {
    if (allowed.some((item) => item === candidate || item.includes(candidate))) return true
    const honorificSurname = /^[老小阿]([\p{Script=Han}])(?:头)?$/u.exec(candidate)?.[1]
    return Boolean(honorificSurname && allowed.some((item) => item.startsWith(honorificSurname)))
  }
  const candidates = []
  const personPattern = new RegExp(
    `(?:^|[，。！？；：“”「」『』、\\s]|看见|遇见|名叫|叫作)([${COMMON_CHINESE_SURNAMES}][\\p{Script=Han}]{1,2})(?=(?:说|问|喊|笑|答|递|接|摇头|点头|抬头|回道|发来|进门|出门|站起|站在|坐下|走来|走进))`,
    'gu'
  )
  for (const match of source.matchAll(personPattern)) {
    const candidate = match[1]
    if (isAllowed(candidate)) continue
    const index = match.index + match[0].lastIndexOf(candidate)
    candidates.push({ type: 'person', value: candidate, index, snippet: source.slice(Math.max(0, index - 12), index + candidate.length + 18) })
  }
  const appellationPattern = new RegExp(
    `(?:^|[，。！？；：“”「」『』、\\s]|的|叫|称|保安|老板|老板娘|摊主|邻居|隔壁)([老小阿][${COMMON_CHINESE_SURNAMES}](?:头)?)(?=(?:正|正在|说|问|喊|笑|答|递|接|摇头|点头|抬头|回道|发来|走来|走进|聊天|看着|摊位|家|店|[，,:：。！？；“”「」『』、\\s]|$))`,
    'gu'
  )
  for (const match of source.matchAll(appellationPattern)) {
    const candidate = match[1]
    if (isAllowed(candidate)) continue
    const index = match.index + match[0].lastIndexOf(candidate)
    candidates.push({ type: 'person_appellation', value: candidate, index, snippet: source.slice(Math.max(0, index - 12), index + candidate.length + 18) })
  }
  const surnameRolePattern = new RegExp(
    `(?:^|[，。！？；：“”「」『』、\\s]|叫|称|遇见|看见)([${COMMON_CHINESE_SURNAMES}](?:阿姨|大姐|大哥|师傅|叔叔|大叔|大妈|老板|老师))(?=(?:正|正在|说|问|喊|笑|答|递|接|摇头|点头|抬头|回道|发来|走来|走进|聊天|看着|遛|带|牵|[，,:：。！？；“”「」『』、\\s]|$))`,
    'gu'
  )
  for (const match of source.matchAll(surnameRolePattern)) {
    const candidate = match[1]
    if (isAllowed(candidate)) continue
    const index = match.index + match[0].lastIndexOf(candidate)
    candidates.push({ type: 'person_role_appellation', value: candidate, index, snippet: source.slice(Math.max(0, index - 12), index + candidate.length + 18) })
  }
  const explicitPlacePattern =
    /(?:名为|叫作|位于|来自|前往|去往|任职于|就读于|送到)([\p{Script=Han}A-Za-z0-9·-]{2,16}(?:公司|集团|研究所|中心|协会|大学|医院|小区|水文站|路|街|巷|馆|局))/gu
  for (const match of source.matchAll(explicitPlacePattern)) {
    const candidate = match[1]
    if (isAllowed(candidate)) continue
    const index = match.index + match[0].lastIndexOf(candidate)
    candidates.push({ type: 'organization_or_place', value: candidate, index, snippet: source.slice(Math.max(0, index - 12), index + candidate.length + 18) })
  }
  const latinPattern = /\b[A-Z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+\b/gu
  for (const match of source.matchAll(latinPattern)) {
    const candidate = match[0]
    if (isAllowed(candidate)) continue
    candidates.push({ type: 'latin_or_code', value: candidate, index: match.index, snippet: source.slice(Math.max(0, match.index - 12), match.index + candidate.length + 18) })
  }
  const uniqueCandidates = new Map()
  for (const candidate of candidates) {
    const key = `${candidate.type}:${candidate.value}`
    if (!uniqueCandidates.has(key)) uniqueCandidates.set(key, candidate)
  }
  return [...uniqueCandidates.values()]
}

function styleRisk(flags) {
  const weights = {
    web_novel_hook: 25,
    oppressive_tone: 15,
    task_echo: 20,
    unknown_proper_name: 10,
    explanation_heavy: 15,
    thin_daily_scene: 10,
    sparse_ordinary_texture: 5,
    low_dialogue: 5
  }
  return Math.min(100, flags.reduce((total, flag) => total + (weights[flag.code] ?? 0), 0))
}

function profileFrom(input) {
  const profileOverrides = input.profile ?? {}
  const profile = { ...DEFAULT_CHAPTER_AB_DIAGNOSTIC_PROFILE, ...profileOverrides }
  for (const key of [
    'oppressiveTerms',
    'domesticActionTerms',
    'explanationMarkers',
    'ordinaryTextureTerms',
    'instructionRegisterTerms',
    'constraintMarkers'
  ]) {
    profile[key] = unique(profile[key] ?? [])
  }
  profile.webNovelHookPatterns = uniquePatterns([
    ...DEFAULT_WEB_NOVEL_HOOK_PATTERNS,
    ...(profileOverrides.webNovelHookPatterns ?? [])
  ])
  return profile
}

function strictPostPhraseEnding(task, phrase) {
  if (!phrase) return false
  for (const value of Object.values(task ?? {})) {
    if (typeof value !== 'string') continue
    const direct = /[“「『"]([^”」』"\r\n]{2,120})[”」』"]出现(?:后|以后|之后)[^。；;\r\n]{0,40}?(?:只|仅)保留[^。；;\r\n]{0,100}?(?:动作|反应|回应|收尾|场面|停笔|结束)/u.exec(value)
    if (direct?.[1]?.trim() === phrase) return true
    const referential = /(?:该|上述|这个|此)?(?:锁屏|通知)?(?:标题|短语)出现(?:后|以后|之后)[^。；;\r\n]{0,40}?(?:只|仅)保留[^。；;\r\n]{0,100}?(?:动作|反应|回应|收尾|场面|停笔|结束)/u.exec(value)
    if (!referential) continue
    const candidates = [...value.slice(0, referential.index).matchAll(/(?:锁屏|通知)?标题[^。；;\r\n]{0,16}[“「『"]([^”」』"\r\n]{2,120})[”」』"]/gu)]
      .map((match) => match[1].trim())
      .filter(Boolean)
    const uniqueCandidates = [...new Set(candidates)]
    if (uniqueCandidates.length === 1 && uniqueCandidates[0] === phrase) return true
  }
  return false
}

export function diagnoseChapterBody(input = {}) {
  const body = text(input.body)
  const title = text(input.title)
  const task = input.task ?? {}
  const contract = input.contract ?? input.audit ?? {}
  const profile = profileFrom(input)
  const completeText = `${title}\n${body}`
  const notificationPhrase = text(contract.notificationPhrase)
  const bodyNotificationCount = notificationPhrase ? countOccurrences(body, notificationPhrase) : 0
  const titleNotificationCount = notificationPhrase ? countOccurrences(title, notificationPhrase) : 0
  const notificationIndex = notificationPhrase ? body.indexOf(notificationPhrase) : -1
  const notificationPositionRatio =
    notificationIndex >= 0 && visibleLength(body) > 0 ? visibleLength(body.slice(0, notificationIndex)) / visibleLength(body) : null
  const notificationPositionToleranceRatio = Math.max(0, Number(contract.notificationPositionToleranceRatio ?? 0.01))
  const notificationTrailingVisibleCharacterCount = notificationIndex >= 0
    ? visibleLength(body.slice(notificationIndex + notificationPhrase.length))
    : null
  const notificationTailLimit = strictPostPhraseEnding(task, notificationPhrase)
    ? Math.max(1, Number(contract.notificationTailMaxVisibleCharacters ?? 240))
    : null
  const [minimumLength, maximumLength] = parseExpectedLength(task.targetWordCount ?? contract.targetWordCount)
  const bodyVisibleLength = visibleLength(body)
  const delimiters = delimiterAudit(body)
  const forbiddenTermHits = termHitDetails(completeText, contract.forbiddenTerms ?? [])
  const forbiddenActions = [
    ...forbiddenActionDetails(completeText, contract.forbiddenActions ?? []),
    ...explicitTaskBehaviorViolations(completeText, task)
  ]
  const supportingNames = (contract.allowedNamedCharacters ?? []).slice(1)
  const dailyTerms = unique(contract.dailyTerms ?? [])
  const narrativeBody = narrationWithoutDialogue(body)
  const preNotificationBody = notificationIndex >= 0 ? body.slice(0, notificationIndex) : body
  const configuredScenePhases = contract.scenePhases ?? input.profile?.scenePhases
  const scenePhases = configuredScenePhases ?? Object.fromEntries(dailyTerms.map((term) => [term, [term]]))
  const scenePhaseDetails = Object.entries(scenePhases).map(([phase, terms]) =>
    scenePhaseDetail(preNotificationBody, phase, terms)
  )
  const usesSemanticScenePhases = Boolean(configuredScenePhases && scenePhaseDetails.length > 0)
  const hardChecks = {
    expectedLength: bodyVisibleLength >= minimumLength && bodyVisibleLength <= maximumLength,
    completeTerminal: hasCompleteTerminal(body),
    balancedDelimiters: delimiters.balanced,
    noForbiddenTerms: forbiddenTermHits.length === 0,
    noForbiddenActions: forbiddenActions.length === 0,
    requiredPerspective:
      !(contract.requireFirstPerson ?? text(task.styleRequirement).includes('第一人称')) || narrativeBody.includes('我'),
    requiredNamedCharacters: supportingNames.every((name) => body.includes(name))
  }
  if (notificationPhrase) {
    hardChecks.notificationInBody = bodyNotificationCount === 1
    hardChecks.notificationExactlyOnceAcrossOutput = bodyNotificationCount + titleNotificationCount === 1
    hardChecks.notificationLateEnough =
      notificationPositionRatio !== null &&
      notificationPositionRatio >= Number(contract.notificationMinPositionRatio ?? 0) - notificationPositionToleranceRatio - 1e-9
    if (notificationTailLimit !== null) {
      hardChecks.notificationTailWithinLimit =
        bodyNotificationCount === 1 &&
        notificationTrailingVisibleCharacterCount !== null &&
        notificationTrailingVisibleCharacterCount <= notificationTailLimit
    }
  }
  if (dailyTerms.length > 0 || usesSemanticScenePhases) {
    hardChecks.allRequiredDailyAnchorsPresent = usesSemanticScenePhases
      ? scenePhaseDetails.every((item) => item.present)
      : dailyTerms.every((term) => body.includes(term))
  }

  const sentences = splitSentences(body)
  const preNotificationSentences = splitSentences(preNotificationBody)
  const quote = quoteMetrics(body)
  const ordinaryTextureHits = termHitDetails(body, profile.ordinaryTextureTerms)
  const oppressiveTermHits = oppressiveTermHitDetails(completeText, profile.oppressiveTerms)
  const tail = [...completeText].slice(-Math.max(1, Number(profile.tailCharacterCount) || 500)).join('')
  const webNovelHookHits = patternHits(tail, profile.webNovelHookPatterns)
  const taskEcho = taskEchoMetrics(body, task, [notificationPhrase])
  const instructionRegisterHits = instructionRegisterHitDetails(body, profile.instructionRegisterTerms)
  const allowedProperNames = [
    ...(contract.allowedNamedCharacters ?? []),
    ...(contract.allowedProperNames ?? []),
    notificationPhrase
  ]
  const properNameCandidates = unknownProperNameCandidates(completeText, allowedProperNames)
  const everydayTerms = unique([...dailyTerms, ...profile.domesticActionTerms, ...profile.ordinaryTextureTerms])
  const dailyCoverage = termCoverageBins(preNotificationBody, everydayTerms, Number(profile.dailyCoverageBins) || 10)
  const actionSentenceRatio = sentenceRatio(sentences, profile.domesticActionTerms)
  const explanationSentenceRatio = sentenceRatio(sentences, profile.explanationMarkers)
  const dailySentenceRatio = sentenceRatio(preNotificationSentences, everydayTerms)
  const instructionRegisterCount = instructionRegisterHits.reduce((total, item) => total + item.count, 0)
  const oppressiveTermCount = oppressiveTermHits.reduce((total, item) => total + item.count, 0)
  const flags = []
  if (webNovelHookHits.length > 0) flags.push({ code: 'web_novel_hook', evidence: webNovelHookHits })
  if (oppressiveTermCount >= 2) flags.push({ code: 'oppressive_tone', evidence: oppressiveTermHits })
  if (taskEcho.hits.length > 0 || instructionRegisterCount >= 2) {
    flags.push({ code: 'task_echo', evidence: { clauses: taskEcho.hits, instructionRegisterHits } })
  }
  if (properNameCandidates.length > 0) flags.push({ code: 'unknown_proper_name', evidence: properNameCandidates })
  if (sentences.length >= 5 && explanationSentenceRatio >= Number(profile.explanationRatioWarning)) {
    flags.push({ code: 'explanation_heavy', evidence: { sentenceCount: sentences.length, explanationSentenceRatio } })
  }
  if (
    dailyTerms.length > 0 &&
    (dailySentenceRatio < Number(profile.dailySentenceRatioWarning) || dailyCoverage.ratio < Number(profile.dailyBinCoverageWarning))
  ) {
    flags.push({ code: 'thin_daily_scene', evidence: { dailySentenceRatio, dailyCoverage } })
  }
  if (bodyVisibleLength >= 500 && ordinaryTextureHits.length < Number(profile.ordinaryTextureWarning)) {
    flags.push({ code: 'sparse_ordinary_texture', evidence: { ordinaryTextureHits } })
  }
  if ((contract.allowedNamedCharacters ?? []).length > 1 && bodyVisibleLength >= 500 && quote.dialogueTurnCount < Number(profile.minimumDialogueTurns)) {
    flags.push({ code: 'low_dialogue', evidence: quote })
  }

  const heuristicMetrics = {
    sentenceCount: sentences.length,
    paragraphCount: body.split(/\r?\n\s*\r?\n/u).filter((item) => item.trim()).length,
    narrativeFirstPersonCount: countOccurrences(narrativeBody, '我'),
    ...quote,
    domesticActionSentenceRatio: actionSentenceRatio,
    explanationSentenceRatio,
    dailySentenceRatioBeforeNotification: dailySentenceRatio,
    dailyCoverageBinRatioBeforeNotification: dailyCoverage.ratio,
    dailyCoverage,
    scenePhaseCoverageRatio:
      scenePhaseDetails.length > 0 ? scenePhaseDetails.filter((item) => item.present).length / scenePhaseDetails.length : null,
    scenePhases: scenePhaseDetails,
    ordinaryTextureUniqueCount: ordinaryTextureHits.length,
    ordinaryTextureHits,
    oppressiveTermCount,
    oppressiveTermRatePerThousand: bodyVisibleLength > 0 ? (oppressiveTermCount * 1000) / bodyVisibleLength : 0,
    oppressiveTermHits,
    webNovelHookCount: webNovelHookHits.length,
    webNovelHookHits,
    taskEchoClauseCount: taskEcho.hits.length,
    taskEchoCopiedCharacterRatio: taskEcho.copiedCharacterRatio,
    taskEchoHits: taskEcho.hits,
    instructionRegisterCount,
    instructionRegisterHits,
    unknownProperNameCount: properNameCandidates.length,
    unknownProperNameCandidates: properNameCandidates
  }

  return {
    hardContract: {
      pass: Object.values(hardChecks).every(Boolean),
      checks: hardChecks,
      measurements: {
        rawCharacterCount: codePointLength(body),
        visibleCharacterCount: bodyVisibleLength,
        expectedLengthRange: [minimumLength, maximumLength],
        notificationPhrase: notificationPhrase || null,
        bodyNotificationCount,
        titleNotificationCount,
        notificationPositionRatio,
        notificationPositionToleranceRatio,
        notificationTrailingVisibleCharacterCount,
        notificationTailLimit,
        forbiddenTermHits,
        forbiddenActionDetails: forbiddenActions,
        delimiterProblems: delimiters.problems,
        narrativeFirstPersonCount: countOccurrences(narrativeBody, '我'),
        dailyAnchorMode: usesSemanticScenePhases ? 'scene_phases' : 'literal_terms',
        dailyTermCounts: Object.fromEntries(dailyTerms.map((term) => [term, countOccurrences(body, term)])),
        scenePhases: scenePhaseDetails
      }
    },
    heuristicStyle: {
      advisoryOnly: true,
      riskScore: styleRisk(flags),
      flags,
      metrics: heuristicMetrics
    }
  }
}

export function diagnoseChapterPrompt(input = {}) {
  const prompt = text(input.prompt)
  const task = input.task ?? {}
  const profile = profileFrom(input)
  const taskFieldOccurrences = {}
  const missingTaskFields = []
  for (const [field, value] of Object.entries(task)) {
    if (typeof value !== 'string' || !value.trim()) continue
    const count = countOccurrences(prompt, value)
    taskFieldOccurrences[field] = count
    if (count === 0) missingTaskFields.push(field)
  }
  const repeatedTaskFields = Object.entries(taskFieldOccurrences)
    .filter(([, count]) => count > 1)
    .map(([field, count]) => ({ field, count, surplus: count - 1 }))
  const constraintMarkerHits = termHitDetails(prompt.toLowerCase(), profile.constraintMarkers.map((term) => term.toLowerCase()))
  const constraintMarkerCount = constraintMarkerHits.reduce((total, item) => total + item.count, 0)
  const repeatedTaskFieldSurplus = repeatedTaskFields.reduce((total, item) => total + item.surplus, 0)
  const promptCharacterCount = codePointLength(prompt)
  const baselineCharacterCount = Number(input.baselinePromptCharacterCount)
  const amplificationRatio = Number.isFinite(baselineCharacterCount) && baselineCharacterCount > 0 ? promptCharacterCount / baselineCharacterCount : null
  const flags = []
  if (repeatedTaskFields.length > 0) flags.push({ code: 'repeated_task_fields', evidence: repeatedTaskFields })
  if (constraintMarkerCount >= 20) flags.push({ code: 'high_absolute_constraint_load', evidence: { constraintMarkerCount } })
  if (amplificationRatio !== null && amplificationRatio >= 2) flags.push({ code: 'prompt_amplification', evidence: { amplificationRatio } })
  const pressureScore = Math.min(
    100,
    repeatedTaskFieldSurplus * 4 + Math.min(30, constraintMarkerCount) + (amplificationRatio === null ? 0 : Math.min(30, Math.max(0, amplificationRatio - 1) * 8))
  )
  return {
    hardContract: {
      pass: missingTaskFields.length === 0,
      checks: { allTaskFieldsPresent: missingTaskFields.length === 0 },
      missingTaskFields
    },
    heuristicPressure: {
      advisoryOnly: true,
      riskScore: pressureScore,
      flags,
      metrics: {
        characterCount: promptCharacterCount,
        taskFieldOccurrences,
        repeatedTaskFields,
        repeatedTaskFieldSurplus,
        constraintMarkerCount,
        constraintMarkerRatePerThousand: promptCharacterCount > 0 ? (constraintMarkerCount * 1000) / promptCharacterCount : 0,
        constraintMarkerHits,
        baselinePromptCharacterCount: Number.isFinite(baselineCharacterCount) ? baselineCharacterCount : null,
        amplificationRatio
      }
    }
  }
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function range(values) {
  const numbers = values.map(Number).filter(Number.isFinite)
  return numbers.length > 0 ? [Math.min(...numbers), Math.max(...numbers)] : null
}

function bodyDiagnosticFromSample(sample) {
  return sample?.bodyDiagnostics ?? sample?.bodyDiagnostic ?? sample
}

function promptDiagnosticFromSample(sample) {
  return sample?.promptDiagnostics ?? sample?.promptDiagnostic ?? null
}

function aggregateArm(samples) {
  const values = Array.isArray(samples) ? samples : []
  const bodyRiskScores = values.map((sample) => finiteNumber(bodyDiagnosticFromSample(sample)?.heuristicStyle?.riskScore, Number.NaN))
  const promptRiskScores = values.map((sample) => finiteNumber(promptDiagnosticFromSample(sample)?.heuristicPressure?.riskScore, Number.NaN))
  const hardContractPassCount = values.filter((sample) => bodyDiagnosticFromSample(sample)?.hardContract?.pass === true).length
  return {
    sampleCount: values.length,
    hardContractPassCount,
    hardContractPassRate: values.length > 0 ? hardContractPassCount / values.length : null,
    bodyStyleRiskMedian: median(bodyRiskScores),
    bodyStyleRiskRange: range(bodyRiskScores),
    promptPressureMedian: median(promptRiskScores),
    promptPressureRange: range(promptRiskScores)
  }
}

function hypothesis(status, evidence, reason) {
  return { status, evidence, reason }
}

export function aggregateChapterAbDiagnostics(input = {}) {
  const minimumRuns = Math.max(1, Math.trunc(finiteNumber(input.minimumRuns, 3)))
  const armsInput = input.arms ?? input
  const arms = {
    directMinimal: aggregateArm(armsInput.directMinimal ?? []),
    directContract: aggregateArm(armsInput.directContract ?? armsInput.direct ?? []),
    workbench: aggregateArm(armsInput.workbench ?? [])
  }
  const contextEvidence = input.contextEvidence ?? {}
  const promptLeakHits = Array.isArray(contextEvidence.promptLeakHits) ? contextEvidence.promptLeakHits : []
  const legacyBodyHits = Array.isArray(contextEvidence.legacyBodyHits) ? contextEvidence.legacyBodyHits : []
  const traceExact = contextEvidence.traceExact
  const contextEvidencePresent =
    Array.isArray(contextEvidence.promptLeakHits) &&
    Array.isArray(contextEvidence.legacyBodyHits) &&
    typeof traceExact === 'boolean'
  const contextLeakDetected = promptLeakHits.length > 0 || legacyBodyHits.length > 0 || traceExact === false
  const enoughMinimal = arms.directMinimal.sampleCount >= minimumRuns
  const enoughContract = arms.directContract.sampleCount >= minimumRuns
  const enoughWorkbench = arms.workbench.sampleCount >= minimumRuns
  const minimalRisk = arms.directMinimal.bodyStyleRiskMedian
  const contractRisk = arms.directContract.bodyStyleRiskMedian
  const workbenchRisk = arms.workbench.bodyStyleRiskMedian
  const contractDelta = minimalRisk === null || contractRisk === null ? null : contractRisk - minimalRisk
  const workbenchDelta = contractRisk === null || workbenchRisk === null ? null : workbenchRisk - contractRisk

  const hypotheses = {}
  if (!enoughMinimal || minimalRisk === null) {
    hypotheses.modelStyleBias = hypothesis('indeterminate', { minimumRuns, arm: arms.directMinimal }, '缺少足量的最小正向简报样本。')
  } else if (minimalRisk >= 45) {
    hypotheses.modelStyleBias = hypothesis('supported', { minimalRisk }, '最小正向简报下仍持续出现较高风格风险。')
  } else if (minimalRisk <= 30) {
    hypotheses.modelStyleBias = hypothesis('contradicted', { minimalRisk }, '最小正向简报下模型能稳定写出低风险正文。')
  } else {
    hypotheses.modelStyleBias = hypothesis('indeterminate', { minimalRisk }, '最小简报样本处于中间区间。')
  }

  if (!enoughMinimal || !enoughContract || contractDelta === null) {
    hypotheses.taskContractPressure = hypothesis('indeterminate', { minimumRuns, contractDelta, arms }, '缺少足量的最小简报与完整契约对照。')
  } else if (contractDelta >= 15) {
    hypotheses.taskContractPressure = hypothesis('supported', { minimalRisk, contractRisk, contractDelta }, '完整契约相对最小简报显著提高正文风格风险。')
  } else if (contractDelta <= 5) {
    hypotheses.taskContractPressure = hypothesis('contradicted', { minimalRisk, contractRisk, contractDelta }, '完整契约没有造成有意义的增量风险。')
  } else {
    hypotheses.taskContractPressure = hypothesis('indeterminate', { minimalRisk, contractRisk, contractDelta }, '契约增量存在，但未达到预设判别阈值。')
  }

  if (contextLeakDetected) {
    hypotheses.contextLeak = hypothesis('supported', { promptLeakHits, legacyBodyHits, traceExact }, '工作台请求、trace 或正文出现了不应存在的旧资料证据。')
  } else if (!contextEvidencePresent) {
    hypotheses.contextLeak = hypothesis('indeterminate', { contextEvidence }, '缺少 prompt、trace 与正文旧资料命中的完整证据。')
  } else {
    hypotheses.contextLeak = hypothesis('contradicted', { promptLeakHits, legacyBodyHits, traceExact }, '请求审计与 trace 均保持净室边界，正文也无旧资料命中。')
  }

  if (!enoughContract || !enoughWorkbench || workbenchDelta === null) {
    hypotheses.workbenchConstraintPressure = hypothesis('indeterminate', { minimumRuns, workbenchDelta, arms }, '缺少足量的完整契约 direct 与工作台对照。')
  } else if (!contextEvidencePresent || contextLeakDetected) {
    hypotheses.workbenchConstraintPressure = hypothesis(
      'indeterminate',
      { workbenchDelta, contextEvidence },
      '上下文边界未获证实或已发生泄漏，不能把工作台增量风险归因于约束编排。'
    )
  } else if (workbenchDelta >= 15) {
    hypotheses.workbenchConstraintPressure = hypothesis(
      'supported',
      { contractRisk, workbenchRisk, workbenchDelta, promptPressure: arms.workbench.promptPressureMedian },
      '净室边界成立时，工作台相对同契约 direct 显著提高正文风格风险。'
    )
  } else if (workbenchDelta <= 5) {
    hypotheses.workbenchConstraintPressure = hypothesis(
      'contradicted',
      { contractRisk, workbenchRisk, workbenchDelta },
      '工作台没有造成有意义的增量风格风险。'
    )
  } else {
    hypotheses.workbenchConstraintPressure = hypothesis(
      'indeterminate',
      { contractRisk, workbenchRisk, workbenchDelta },
      '工作台增量存在，但未达到预设判别阈值。'
    )
  }

  return {
    minimumRuns,
    arms,
    deltas: {
      taskContractMinusMinimal: contractDelta,
      workbenchMinusDirectContract: workbenchDelta
    },
    contextEvidence: {
      complete: contextEvidencePresent,
      promptLeakHits,
      legacyBodyHits,
      traceExact: typeof traceExact === 'boolean' ? traceExact : null
    },
    hypotheses,
    limitations: [
      ...(!enoughMinimal || !enoughContract || !enoughWorkbench
        ? [`至少需要每臂 ${minimumRuns} 个样本；不足的归因保持 indeterminate。`]
        : []),
      '风格分数来自可解释启发式，只用于组间诊断，不参与 hard contract 判定。',
      'supported 表示本次对照支持该解释，不等同于跨模型、跨任务的普遍因果结论。'
    ]
  }
}
