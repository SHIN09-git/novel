import type { NoveltyFindingKind, NoveltySemanticEvidence } from '../../shared/types'
import {
  AUTHORIZED_RULE_MEDIUM_KEYWORDS,
  CRISIS_CUE_KEYWORDS,
  CRISIS_RESOLUTION_KEYWORDS,
  DEUS_EX_CUE_KEYWORDS,
  DIRECT_BENEFIT_KEYWORDS,
  NOVELTY_SYNONYM_GROUPS
} from './noveltyKeywords'
import type { KeywordOccurrence } from './noveltyText'
import { includesAny, unique } from './noveltyText'

export interface NoveltySemanticSignals {
  evidence: NoveltySemanticEvidence
  aliases: string[]
  hasLinkedCostOrLimit: boolean
  hasLinkedAuthorizedMedium: boolean
  resolvesCurrentCrisis: boolean
  genericReference: boolean
  mundaneUsage: boolean
}

const EXPANSION_MARKERS = [
  '新增',
  '附加',
  '补充',
  '追加',
  '授予',
  '授权',
  '解锁',
  '开放',
  '修改',
  '更新规则',
  '条款',
  '权限',
  '机制',
  '豁免',
  '共享',
  '身份',
  '单元',
  '协议',
  '补丁',
  '放行'
]

const RULE_RELATION_COST_PATTERN =
  /(?:使用|启用|触发|获得|维持|调用|激活|接受|借用)(?:该|此|这项|这种)?(?:规则|权限|机制|身份|通道|条款)?[^。！？\n]{0,24}(?:代价|消耗|扣除|失去|牺牲|惩罚|反噬|冷却|不可逆|只能使用|仅能使用|有效期|持续|会导致|将导致|否则)/

const COST_OR_LIMIT_CUE_PATTERN =
  /(?:代价(?:是|为|：|:)?[^，。；]{0,18}|消耗[^，。；]{0,18}|扣除[^，。；]{0,18}|失去[^，。；]{0,18}|牺牲[^，。；]{0,18}|反噬[^，。；]{0,18}|冷却[^，。；]{0,18}|不可逆|只能使用(?:一|1)次|仅能使用(?:一|1)次|仅限[^，。；]{1,18}|有效期[^，。；]{0,18}|持续(?:不超过)?[^，。；]{1,12}|必须由[^，。；]{1,18}(?:授权|确认|启动)|不得用于[^，。；]{1,18}|使用后[^，。；]{1,24})/

const NEGATED_COST_PATTERN =
  /(?:无|无需|无须|不用|不需要|免除|没有)[^，。；]{0,8}(?:代价|消耗|扣除|惩罚|风险|冷却)/

const MEDIUM_RELATION_PATTERN =
  /(?:公告|广播|票据|地图|门禁提示|系统提示|说明牌|记录|档案|墙面文字|环境线索)(?:上|中|里|内)?[^。！？\n]{0,20}(?:写着|显示|标注|宣布|播报|记载|说明|列出|公开|弹出|更新|浮现)/

function firstCue(text: string, keywords: string[]): string | null {
  return keywords.find((keyword) => keyword && text.includes(keyword)) ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function linkedCostOrLimit(sentence: string, keyword: string): string | null {
  if (NEGATED_COST_PATTERN.test(sentence)) return null
  const keywordPattern = new RegExp(
    `${escapeRegExp(keyword)}[^。！？\\n]{0,36}(?:代价|消耗|扣除|失去|牺牲|惩罚|反噬|冷却|不可逆|只能使用|仅能使用|仅限|有效期|持续|必须由|不得用于|使用后|否则)`
  )
  if (!keywordPattern.test(sentence) && !RULE_RELATION_COST_PATTERN.test(sentence)) return null
  return sentence.match(COST_OR_LIMIT_CUE_PATTERN)?.[0]?.trim() ?? '规则附带明确限制'
}

function linkedAuthorizedMedium(sentence: string): string | null {
  if (!MEDIUM_RELATION_PATTERN.test(sentence) && !/(?:根据|依照)(?:公告|广播|票据|地图|记录|档案|说明牌)/.test(sentence)) {
    return null
  }
  return firstCue(sentence, AUTHORIZED_RULE_MEDIUM_KEYWORDS)
}

function extractRuleTarget(sentence: string): string | null {
  const explicit = sentence.match(/(?:对|仅限于?|只允许|适用于|作用于)([^，。；：:]{1,18})(?:生效|有效|开放|适用|使用|获得|共享|豁免)/)
  if (explicit?.[1]) return explicit[1].trim()
  const scoped = sentence.match(/([^，。；：:]{1,16})(?:范围内|之内)(?:可以|可|将|会|自动|共享|获得|不受)/)
  return scoped?.[1]?.trim() ?? null
}

function extractBeneficiary(sentence: string): string | null {
  const explicit = sentence.match(/(主角|他|她|他们|众人|全员|队伍|所有人|持有者|使用者|参与者|玩家|核心单元|协同单元)[^，。；]{0,12}(?:获得|得到|共享|享有|被放行|可以|能够|免于|不受|通过|脱困)/)
  if (explicit?.[1]) return explicit[1]
  const granted = sentence.match(/(?:允许|授予|给予|为)([^，。；：:]{1,12})(?:临时|紧急|特殊)?(?:权限|身份|豁免|通行权)/)
  return granted?.[1]?.trim() ?? null
}

function occurrenceWindow(occurrence: KeywordOccurrence, sentence: string): { before: string; after: string; around: string } {
  const fallbackIndex = sentence.indexOf(occurrence.keyword)
  const relativeIndex = occurrence.sentenceStart === undefined
    ? Math.max(0, fallbackIndex)
    : Math.max(0, occurrence.index - occurrence.sentenceStart)
  const end = relativeIndex + occurrence.keyword.length
  return {
    before: sentence.slice(Math.max(0, relativeIndex - 24), relativeIndex),
    after: sentence.slice(end, Math.min(sentence.length, end + 28)),
    around: sentence.slice(Math.max(0, relativeIndex - 24), Math.min(sentence.length, end + 28))
  }
}

function isNegatedOrReportedOnly(occurrence: KeywordOccurrence, sentence: string): boolean {
  const { before, after } = occurrenceWindow(occurrence, sentence)
  const negatedBefore = /(?:没有|并无|不存在|从未|未曾|并未|不是|并非|不代表|不意味着|否认存在|(?:无法|不可能)(?:获得|取得|使用|触发)|禁止(?:新增|使用|提及|启用)?|不得(?:新增|使用|提及|启用)?|删除|划掉|作废)[^。！？\n]{0,10}$/
  const negatedAfter = /^(?:并不存在|不存在|并不成立|不成立|被否认|已作废|已删除|未出现|只是传言|仅是传言|只是引用)/
  if (negatedBefore.test(before) || negatedAfter.test(after)) return true

  // A quote is still evidence when a system notice actually announces a rule.
  // Suppress it only when the whole sentence explicitly frames it as a rejected
  // report, title or quotation rather than an in-world fact.
  return /(?:引用|复述|抄录|传言|说法|句子|词语|记录)[^。！？\n]{0,48}(?:不成立|被否认|已作废|被删除|被划掉|只是虚构|并非事实)/.test(sentence)
}

function isProperNameUsage(occurrence: KeywordOccurrence, sentence: string): boolean {
  const { before, after, around } = occurrenceWindow(occurrence, sentence)
  const withoutOccurrence = around.replace(occurrence.keyword, '')
  const namingCue = /(?:名为|叫作|题为|书名|店名|项目名|作品名|小说|电影|游戏|招牌|标题|代号)/.test(before)
  const placeOrWorkSuffix = /^(?:书店|咖啡馆|餐厅|车站|街|路|公司|项目|小说|游戏|电影|计划|行动)/.test(after)
  const enactedAsRule = /(?:宣布|颁布|授予|获得|生效|触发|开放|放行|豁免|规则|权限|机制|条款|真相|揭示)/.test(withoutOccurrence)
  return (namingCue || placeOrWorkSuffix) && !enactedAsRule
}

function isMundaneUsage(kind: NoveltyFindingKind, occurrence: KeywordOccurrence, sentence: string): boolean {
  const keyword = occurrence.keyword
  if (isNegatedOrReportedOnly(occurrence, sentence) || isProperNameUsage(occurrence, sentence)) return true
  if (kind === 'new_system_mechanic' && keyword === '系统面板' && !includesAny(sentence, EXPANSION_MARKERS)) {
    return true
  }
  if (
    (kind === 'new_system_mechanic' || kind === 'new_world_rule') &&
    (keyword === '五米范围' || keyword === '保护范围' || keyword === '五米保护范围') &&
    /(?:只是|仅是|不过是)[^。！？\n]{0,18}(?:物理|距离|长度|尺寸)/.test(sentence)
  ) {
    return true
  }
  if (
    (kind === 'new_system_mechanic' || kind === 'new_world_rule') &&
    (keyword === '五米范围' || keyword === '保护范围' || keyword === '五米保护范围') &&
    !/(规则|系统|权限|身份|单元|共享|生效|判定|豁免|保护机制)/.test(sentence)
  ) {
    return true
  }
  if (
    kind === 'major_lore_reveal' &&
    keyword === '源头' &&
    /(?:声音|脚步|气味|血迹|光线|水流|震动|信号|烟雾)(?:的)?源头|源头(?:传来|来自|位于)/.test(sentence) &&
    !/(真相|机制|系统|规则|世界|副本|意识|记忆)/.test(sentence)
  ) {
    return true
  }
  if (kind === 'new_organization_or_rank' && keyword === '上级' && /(?:向|给|联系|汇报|请示)[^，。；]{0,6}上级/.test(sentence)) {
    return true
  }
  if ((kind === 'new_world_rule' || kind === 'new_system_mechanic') && keyword === '立即触发' && !/(规则|系统|权限|机制|判定|条款|身份|惩罚)/.test(sentence)) {
    return true
  }
  return false
}

function isGenericReference(kind: NoveltyFindingKind, keyword: string, sentence: string): boolean {
  if (kind !== 'new_organization_or_rank') return false
  if (!['管理员', '上级', '总部', '审查员', '裁定员', '仲裁员'].includes(keyword)) return false
  return !/(区域|上级管理员|编号|新任|首次|自称|接管|成立|设立|任命|委员会|监管层|调度层|总控|高级权限|颁布|授予|权限|规则)/.test(sentence)
}

export function aliasesForNoveltyKeyword(keyword: string): string[] {
  const group = NOVELTY_SYNONYM_GROUPS.find((items) => items.includes(keyword as never))
  return unique(group ? [...group] : [keyword])
}

export function analyzeNoveltyOccurrence(
  kind: NoveltyFindingKind,
  occurrence: KeywordOccurrence
): NoveltySemanticSignals {
  const sentence = occurrence.sentence || occurrence.evidenceExcerpt
  const costOrLimitCue = linkedCostOrLimit(sentence, occurrence.keyword)
  const sourceMediumCue = linkedAuthorizedMedium(sentence)
  const crisisCue = firstCue(occurrence.evidenceExcerpt, CRISIS_CUE_KEYWORDS)
  const resolutionCue = firstCue(occurrence.evidenceExcerpt, CRISIS_RESOLUTION_KEYWORDS)
  const directBenefitCue = firstCue(sentence, DIRECT_BENEFIT_KEYWORDS)
  const immediateCue = firstCue(sentence, DEUS_EX_CUE_KEYWORDS)
  const resolvesCurrentCrisis = Boolean(
    resolutionCue && (crisisCue || directBenefitCue || immediateCue)
  )
  return {
    aliases: aliasesForNoveltyKeyword(occurrence.keyword),
    hasLinkedCostOrLimit: Boolean(costOrLimitCue),
    hasLinkedAuthorizedMedium: Boolean(sourceMediumCue),
    resolvesCurrentCrisis,
    genericReference: isGenericReference(kind, occurrence.keyword, sentence),
    mundaneUsage: isMundaneUsage(kind, occurrence, sentence),
    evidence: {
      ruleTarget: extractRuleTarget(sentence),
      beneficiary: extractBeneficiary(sentence),
      crisisCue,
      resolutionCue,
      costOrLimitCue,
      sourceMediumCue
    }
  }
}
