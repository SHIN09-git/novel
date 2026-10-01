import { COMMON_FALSE_NAMES, NAME_ACTION_NOISE_WORDS, NAME_ACTION_SUFFIX_NOISE, ORGANIZATION_KEYWORDS } from './noveltyKeywords'
import { includesAny, nearby, unique } from './noveltyText'

export interface PotentialNameFinding {
  name: string
  evidence: string
  confidence: 'high' | 'medium' | 'low'
  detection: 'explicit_introduction' | 'self_introduction' | 'action_attribution' | 'surname_alias'
}

const COMMON_CHINESE_SURNAMES = new Set(
  [...'赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴宋茅庞熊纪舒屈项祝董梁杜阮蓝闵季贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉龚程嵇邢滑裴陆荣翁荀羊甄曲封芮储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶黎乔苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍璩桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧利师巩聂晁勾敖融冷辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公'].map((value) => value)
)
const COMPOUND_SURNAMES = ['欧阳', '太史', '端木', '上官', '司马', '东方', '独孤', '南宫', '万俟', '闻人', '夏侯', '诸葛', '尉迟', '公羊', '赫连', '澹台', '皇甫', '宗政', '濮阳', '公冶', '申屠', '公孙', '慕容', '仲孙', '钟离', '长孙', '宇文', '司徒', '鲜于', '司空', '闾丘', '子车', '亓官', '司寇']

function isRoleOrOrganizationIdentity(name: string): boolean {
  return (
    includesAny(name, ORGANIZATION_KEYWORDS) ||
    /(管理员|审查员|裁定员|仲裁员|委员会|总部|中心|总控|调度层|监管层|高级权限)/.test(name) ||
    /[-－]\d{1,4}$/.test(name)
  )
}

function normalizePotentialName(name: string): string {
  let next = name.trim()
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of NAME_ACTION_SUFFIX_NOISE) {
      if (!next.endsWith(suffix)) continue
      const candidate = next.slice(0, -suffix.length).trim()
      if (candidate.length >= 2) {
        next = candidate
        changed = true
        break
      }
    }
  }
  return NAME_ACTION_NOISE_WORDS.has(next) ? '' : next
}

function isLikelyChinesePersonalName(name: string): boolean {
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(name)) return false
  if (COMPOUND_SURNAMES.some((surname) => name.startsWith(surname))) return name.length >= 3
  return name.length <= 3 && COMMON_CHINESE_SURNAMES.has(name[0])
}

function isKnownName(name: string, knownCharacterNames: string[]): boolean {
  const normalized = name.replace(/\s/g, '').toLowerCase()
  if (knownCharacterNames.some((known) => known.replace(/\s/g, '').toLowerCase() === normalized)) return true
  const surnameAlias = normalized.match(/^[老小阿]([\u4e00-\u9fa5])(?:头)?$/)?.[1]
  if (!surnameAlias || !COMMON_CHINESE_SURNAMES.has(surnameAlias)) return false
  return knownCharacterNames.some((known) => {
    const normalizedKnown = known.replace(/\s/g, '').toLowerCase()
    return normalizedKnown.length >= 2 && normalizedKnown.startsWith(surnameAlias)
  })
}

export function extractPotentialNames(text: string, knownCharacterNames: string[] = []): PotentialNameFinding[] {
  const findings: PotentialNameFinding[] = []
  const explicitPatterns: Array<{
    pattern: RegExp
    confidence: PotentialNameFinding['confidence']
    detection: PotentialNameFinding['detection']
  }> = [
    {
      pattern: /(?:名叫|叫作|叫做|名字是|自称|代号(?:是|为)?|编号(?:是|为)?)([\u4e00-\u9fa5A-Za-z0-9_－-]{2,12})/g,
      confidence: 'high',
      detection: 'explicit_introduction'
    },
    {
      pattern: /[“"]我叫([\u4e00-\u9fa5A-Za-z0-9_－-]{2,12})(?:[，。！？!?])?[”"]/g,
      confidence: 'high',
      detection: 'self_introduction'
    }
  ]
  for (const { pattern, confidence, detection } of explicitPatterns) {
    for (const match of text.matchAll(pattern)) {
      const name = normalizePotentialName(match[1]?.replace(/[，。、“”‘’：:－,.!?！？]/g, '').trim() ?? '')
      if (!name || name.length < 2 || COMMON_FALSE_NAMES.has(name)) continue
      if (/^(这个|那个|他们|我们|你们|有人|众人|系统|规则|面板|声音|黑影|工作人员)/.test(name)) continue
      if (isRoleOrOrganizationIdentity(name)) continue
      if (isKnownName(name, knownCharacterNames)) continue
      findings.push({ name, evidence: nearby(text, match.index ?? 0), confidence, detection })
    }
  }

  // Everyday Chinese often identifies a person by a single-surname alias
  // (老周、小陈、阿李) instead of a full name. Require a person-like suffix so
  // ordinary words such as “小周末”“老周边”“小陈列柜” are not names. A
  // boundary or role/attribution cue before the alias also keeps “升得老高”
  // from turning the adjective complement into a person.
  const surnameCharacters = [...COMMON_CHINESE_SURNAMES].join('')
  const surnameAliasPattern = new RegExp(
    `(?:^|[，。！？!?；;：“”"「」『』、\\s]|的|叫|称|保安|摊主|老板|师傅|同事|邻居|隔壁)([老小阿][${surnameCharacters}](?:头)?)(?=(?:正|正在|说|问|喊|笑|答|递|接|摇头|点头|抬头|回道|发来|进门|出门|站起|站在|坐下|走来|走进|聊天|看着|按住|伸手|低声|摊位|家|店|师傅|老板|大叔|大妈|哥|姐|叔|姨|的|[，。！？!?；;：“”"「」『』、\\s]|$))`,
    'gu'
  )
  for (const match of text.matchAll(surnameAliasPattern)) {
    const name = match[1]
    if (!name || COMMON_FALSE_NAMES.has(name)) continue
    if (isKnownName(name, knownCharacterNames) || isRoleOrOrganizationIdentity(name)) continue
    findings.push({
      name,
      evidence: nearby(text, (match.index ?? 0) + match[0].indexOf(name)),
      confidence: 'medium',
      detection: 'surname_alias'
    })
  }

  const surnameRoleAliasPattern = new RegExp(
    `(?:^|[，。！？!?；;：“”"「」『』、\\s]|叫|称|遇见|碰见|看见)([${surnameCharacters}](?:阿姨|大姐|大哥|师傅|叔叔|大叔|大妈|老板|老师))(?=(?:正|正在|说|问|喊|笑|答|递|接|摇头|点头|抬头|回道|发来|进门|出门|站起|站在|坐下|走来|走进|聊天|看着|遛|带|牵|[，。！？!?；;：“”"「」『』、\\s]|$))`,
    'gu'
  )
  for (const match of text.matchAll(surnameRoleAliasPattern)) {
    const name = match[1]
    if (!name || COMMON_FALSE_NAMES.has(name)) continue
    if (isKnownName(name, knownCharacterNames) || isRoleOrOrganizationIdentity(name)) continue
    findings.push({
      name,
      evidence: nearby(text, (match.index ?? 0) + match[0].indexOf(name)),
      confidence: 'medium',
      detection: 'surname_alias'
    })
  }

  // Action attribution is useful for previously unseen characters, but only
  // when the candidate looks like a Chinese personal name and begins at a
  // sentence/dialogue boundary. It is deliberately low confidence.
  const actionPattern = /(?:^|[。！？!?；;\n“”"：:，,、])([\u4e00-\u9fa5]{2,4})(?=低声|问道|说道|回答|站起|抬头|摇头|笑了|推开|看着|按住|伸手)/gm
  for (const match of text.matchAll(actionPattern)) {
    const name = normalizePotentialName(match[1] ?? '')
    if (!name || COMMON_FALSE_NAMES.has(name) || !isLikelyChinesePersonalName(name)) continue
    if (isKnownName(name, knownCharacterNames) || isRoleOrOrganizationIdentity(name)) continue
    findings.push({
      name,
      evidence: nearby(text, (match.index ?? 0) + match[0].indexOf(match[1])),
      confidence: 'low',
      detection: 'action_attribution'
    })
  }

  return unique(findings.map((item) => item.name)).map((name) => findings.find((item) => item.name === name)!)
}
