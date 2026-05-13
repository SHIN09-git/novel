import type {
  AppData,
  ChapterAllowedNovelty,
  ChapterForbiddenNovelty,
  ChapterNoveltyPolicy,
  ChapterPlan,
  ContextCompressionRecord,
  ContextSelectionResult,
  ForcedContextBlock,
  NoveltyAuditResult,
  NoveltyFinding,
  NoveltyFindingKind,
  NoveltyFindingSeverity,
  Project,
  PromptBlockOrderItem
} from '../shared/types'

const RULE_KEYWORDS = unique([
  '附加条款',
  '补充说明',
  '临时权限',
  '立即触发',
  '手动评定',
  '手动裁定',
  '豁免',
  '共享身份',
  '核心单元',
  '协同单元',
  '权限授予',
  '特殊通道',
  '例外机制',
  '系统漏洞',
  '规则冲突',
  '新增权限',
  '临时身份',
  '自动升级',
  '强制放行',
  '五米范围',
  '五米保护范围',
  '贡献值集中分配',
  '安全通行'
])

const SYSTEM_MECHANIC_KEYWORDS = unique([
  '意识剥离',
  '冗余池存储',
  '规则补丁',
  '系统面板',
  '核心权限',
  '权限继承',
  '存储机制',
  '回收机制',
  '核心单元',
  '协同单元',
  '共享身份',
  '身份共享',
  '五米范围',
  '保护范围',
  '临时身份',
  '自动升级',
  '权限授予',
  '意识存储',
  '记忆锚定',
  '副本源代码',
  '底层协议'
])

const ORGANIZATION_KEYWORDS = unique([
  '区域管理员',
  '上级管理员',
  '管理员',
  '上级',
  '总部',
  '审查员',
  '仲裁员',
  '编号人员',
  '委员会',
  '控制中心',
  '调度层',
  '监管层',
  '裁定员',
  '总控',
  '高级权限'
])

const LORE_KEYWORDS = unique([
  '真正机制',
  '完整真相',
  '系统核心',
  '源头',
  '意识剥离',
  '回收站',
  '冗余池',
  '数据区',
  '意识存储',
  '记忆锚定',
  '副本源代码',
  '底层协议',
  '城市核心',
  '规则制定者',
  '原始规则'
])

const DEUS_EX_CUE_KEYWORDS = unique([
  '解除危机',
  '脱困',
  '豁免惩罚',
  '立即生效',
  '刚好',
  '免除',
  '救命',
  '安全通行',
  '临时权限',
  '系统突然',
  '面板弹出',
  '强制放行',
  '临时豁免',
  '无需代价',
  '直接放行'
])

const COST_OR_LIMIT_KEYWORDS = unique([
  '代价',
  '惩罚',
  '副作用',
  '风险',
  '牺牲',
  '失去',
  '扣除',
  '消耗',
  '冷却',
  '限制',
  '只能',
  '必须',
  '不得',
  '否则',
  '会被记录',
  '需要支付',
  '不可逆'
])

const COMMON_FALSE_NAMES = new Set([
  '系统',
  '规则',
  '管理员',
  '区域管理员',
  '上级',
  '总部',
  '审查员',
  '裁定员',
  '仲裁员',
  '主角',
  '女主',
  '反派',
  '队长',
  '医生',
  '老师',
  '男人',
  '女人',
  '少年',
  '少女',
  '众人',
  '有人',
  '黑影',
  '工作人员'
])

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => keyword && text.includes(keyword))
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s　"'“”‘’`·,，.。;；:：、!?！？()[\]（）【】《》<>]/g, '')
    .trim()
}

function textMatches(source: string, term: string): boolean {
  const normalizedSource = normalizeForMatch(source)
  const normalizedTerm = normalizeForMatch(term)
  if (!normalizedSource || !normalizedTerm || normalizedTerm.length < 2) return false
  return normalizedSource.includes(normalizedTerm) || normalizedTerm.includes(normalizedSource)
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[、，,；;\n。]/).map((item) => item.trim()).filter(Boolean)
  return []
}

function allowedNoveltyText(value: ChapterPlan['allowedNovelty'] | null | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  const novelty = value as ChapterAllowedNovelty
  return [
    ...textList(novelty.allowedNewCharacters),
    ...textList(novelty.allowedNewRules),
    ...textList(novelty.allowedNewSystemMechanics),
    ...textList(novelty.allowedNewOrganizationsOrRanks),
    ...textList(novelty.allowedLoreReveals),
    novelty.notes
  ]
    .filter(Boolean)
    .join('\n')
}

function forbiddenNoveltyText(value: ChapterPlan['forbiddenNovelty'] | null | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  const novelty = value as ChapterForbiddenNovelty
  return [
    ...textList(novelty.forbiddenNewCharacters),
    ...textList(novelty.forbiddenNewRules),
    ...textList(novelty.forbiddenSystemMechanics),
    ...textList(novelty.forbiddenOrganizationsOrRanks),
    ...textList(novelty.forbiddenLoreReveals),
    novelty.notes
  ]
    .filter(Boolean)
    .join('\n')
}

function nearby(text: string, index: number, radius = 90): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius)).trim()
}

function allowedSourceText(plan: ChapterPlan | null, policy: ChapterNoveltyPolicy): string {
  return [
    allowedNoveltyText(plan?.allowedNovelty),
    policy.allowedNewCharacterNames?.join(' '),
    policy.allowedNewRuleTopics?.join(' '),
    policy.allowedSystemMechanicTopics?.join(' '),
    policy.allowedOrganizationOrRankTopics?.join(' '),
    policy.allowedLoreRevealTopics?.join(' ')
  ]
    .filter(Boolean)
    .join('\n')
}

function forbiddenSourceText(plan: ChapterPlan | null, policy: ChapterNoveltyPolicy): string {
  return [
    forbiddenNoveltyText(plan?.forbiddenNovelty),
    policy.forbiddenNewRuleTopics?.join(' '),
    policy.forbiddenSystemMechanicTopics?.join(' '),
    policy.forbiddenOrganizationOrRankTopics?.join(' '),
    policy.forbiddenRevealTopics?.join(' ')
  ]
    .filter(Boolean)
    .join('\n')
}

function categoryAllowedByPolicy(kind: NoveltyFindingKind, policy: ChapterNoveltyPolicy, allowedText: string): boolean {
  if (kind === 'new_named_character' || kind === 'untraced_name') {
    return policy.allowNewNamedCharacters || /允许.*(新角色|命名角色|新增角色|人物出场)/.test(allowedText)
  }
  if (kind === 'new_world_rule' || kind === 'deus_ex_rule' || kind === 'suspicious_deus_ex_rule') {
    return policy.allowNewWorldRules || /允许.*(新规则|新增规则|副本规则|规则公告|规则说明)/.test(allowedText)
  }
  if (kind === 'new_system_mechanic') {
    return policy.allowNewSystemMechanics || /允许.*(新机制|新增机制|系统机制|系统权限|权限规则)/.test(allowedText)
  }
  if (kind === 'new_organization_or_rank') {
    return policy.allowNewOrganizationsOrRanks || /允许.*(新组织|新增组织|新层级|管理员|身份层级)/.test(allowedText)
  }
  if (kind === 'major_lore_reveal') {
    return policy.allowMajorLoreReveal || /允许.*(揭示|揭露|真相|设定|世界观)/.test(allowedText)
  }
  return false
}

function categoryForbiddenByPolicy(kind: NoveltyFindingKind, forbiddenText: string): boolean {
  if (!forbiddenText) return false
  if (kind === 'new_named_character' || kind === 'untraced_name') {
    return /禁止.*(新角色|命名角色|新增角色|擅自命名|未知人物)/.test(forbiddenText)
  }
  if (kind === 'new_world_rule' || kind === 'deus_ex_rule' || kind === 'suspicious_deus_ex_rule') {
    return /禁止.*(新规则|新增规则|救命规则|补充条款|机械降神|临时权限)/.test(forbiddenText)
  }
  if (kind === 'new_system_mechanic') {
    return /禁止.*(新机制|新增机制|系统机制|系统权限|核心机制)/.test(forbiddenText)
  }
  if (kind === 'new_organization_or_rank') {
    return /禁止.*(新组织|新增组织|新层级|管理员|组织层级)/.test(forbiddenText)
  }
  if (kind === 'major_lore_reveal') {
    return /禁止.*(揭示|揭露|真相|设定|世界观|核心机制)/.test(forbiddenText)
  }
  return false
}

function allowedByText(plan: ChapterPlan | null, policy: ChapterNoveltyPolicy, term: string, kind: NoveltyFindingKind): boolean {
  if (!term) return false
  const source = allowedSourceText(plan, policy)
  if (textMatches(source, term)) return true
  return categoryAllowedByPolicy(kind, policy, source)
}

function directlyForbiddenByText(plan: ChapterPlan | null, policy: ChapterNoveltyPolicy, term: string): boolean {
  if (!term) return false
  const source = forbiddenSourceText(plan, policy)
  return textMatches(source, term)
}

function broadlyForbiddenByText(plan: ChapterPlan | null, policy: ChapterNoveltyPolicy, kind: NoveltyFindingKind): boolean {
  const source = forbiddenSourceText(plan, policy)
  return categoryForbiddenByPolicy(kind, source)
}

function hasCostOrLimit(evidenceExcerpt: string): boolean {
  return includesAny(evidenceExcerpt, COST_OR_LIMIT_KEYWORDS)
}

function findingSeverity(input: {
  kind: NoveltyFindingKind
  allowedByTask: boolean
  hasPriorForeshadowing: boolean
  explicitlyForbidden: boolean
  costOrLimit: boolean
}): NoveltyFindingSeverity {
  const { kind, allowedByTask, hasPriorForeshadowing, explicitlyForbidden, costOrLimit } = input
  if (explicitlyForbidden) return 'fail'
  if (allowedByTask) return 'info'
  if (kind === 'deus_ex_rule' || kind === 'suspicious_deus_ex_rule') return 'fail'
  if (kind === 'new_named_character' || kind === 'untraced_name') return hasPriorForeshadowing ? 'info' : 'warning'
  if (hasPriorForeshadowing) return kind === 'major_lore_reveal' ? 'warning' : 'info'
  if (costOrLimit && (kind === 'new_world_rule' || kind === 'new_system_mechanic' || kind === 'new_organization_or_rank')) return 'warning'
  return 'fail'
}

function sourceHintFor(input: {
  allowedByTask: boolean
  hasPriorForeshadowing: boolean
  explicitlyForbidden: boolean
  costOrLimit: boolean
}): string | null {
  if (input.explicitlyForbidden) return 'chapter_forbidden_novelty'
  if (input.allowedByTask) return 'chapter_allowed_novelty'
  if (input.hasPriorForeshadowing) return 'selected_context_or_foreshadowing'
  if (input.costOrLimit) return 'draft_contains_cost_or_limit'
  return null
}

function createFinding(
  kind: NoveltyFindingKind,
  text: string,
  evidenceExcerpt: string,
  context: string,
  plan: ChapterPlan | null,
  policy: ChapterNoveltyPolicy,
  reason: string
): NoveltyFinding {
  const hasPriorForeshadowing = textMatches(context, text)
  const costOrLimit = hasCostOrLimit(evidenceExcerpt)
  const allowedByTask = allowedByText(plan, policy, text, kind)
  const directForbidden = directlyForbiddenByText(plan, policy, text)
  const broadForbidden = broadlyForbiddenByText(plan, policy, kind)
  const explicitlyForbidden = directForbidden || (broadForbidden && !allowedByTask && !hasPriorForeshadowing && !costOrLimit)
  const severity = findingSeverity({ kind, allowedByTask, hasPriorForeshadowing, explicitlyForbidden, costOrLimit })
  return {
    kind,
    text,
    evidenceExcerpt,
    reason: costOrLimit && severity !== 'fail' ? `${reason} The draft also states a cost or limitation, so this is recorded for review instead of treated as an automatic hard fail.` : reason,
    severity,
    allowedByTask,
    hasPriorForeshadowing,
    sourceHint: sourceHintFor({ allowedByTask, hasPriorForeshadowing, explicitlyForbidden, costOrLimit }),
    suggestedAction:
      severity === 'fail'
        ? 'Remove this novelty, revise it into an already foreshadowed rule/entity, or explicitly add it to the chapter task before accepting.'
        : 'Keep only if the author confirms this novelty has prior setup, explicit task permission, or a clear cost that preserves story tension.'
  }
}

function uniqueFindings(findings: NoveltyFinding[]): NoveltyFinding[] {
  const seen = new Set<string>()
  const result: NoveltyFinding[] = []
  for (const finding of findings) {
    const key = `${finding.kind}:${normalizeForMatch(finding.text)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(finding)
  }
  return result
}

function longestKeywordMatches(text: string, keywords: string[]): string[] {
  const sorted = unique(keywords).sort((a, b) => b.length - a.length)
  const matches: string[] = []
  for (const keyword of sorted) {
    if (!keyword || !text.includes(keyword)) continue
    if (matches.some((existing) => existing.includes(keyword) || keyword.includes(existing))) {
      if (keyword.length > Math.max(...matches.filter((existing) => existing.includes(keyword) || keyword.includes(existing)).map((existing) => existing.length))) {
        matches.push(keyword)
      }
      continue
    }
    matches.push(keyword)
  }
  return unique(matches)
}

function scanKeywordFindings(
  text: string,
  context: string,
  plan: ChapterPlan | null,
  policy: ChapterNoveltyPolicy,
  keywords: string[],
  kind: NoveltyFindingKind,
  reason: string
): NoveltyFinding[] {
  return longestKeywordMatches(text, keywords).map((keyword) => {
    const index = text.indexOf(keyword)
    return createFinding(kind, keyword, nearby(text, index), context, plan, policy, reason)
  })
}

function isRoleOrOrganizationIdentity(name: string): boolean {
  return (
    includesAny(name, ORGANIZATION_KEYWORDS) ||
    /(管理员|审查员|裁定员|仲裁员|委员会|总部|中心|总控|调度层|监管层|高级权限)/.test(name) ||
    /[-－]\d{1,4}$/.test(name)
  )
}

function extractPotentialNames(text: string): Array<{ name: string; evidence: string }> {
  const findings: Array<{ name: string; evidence: string }> = []
  const patterns = [
    /(?:名叫|叫作|叫做|名字是|自称|代号(?:是|为)?|编号(?:是|为)?)([\u4e00-\u9fa5A-Za-z0-9_－-]{2,12})/g,
    /“我是([\u4e00-\u9fa5A-Za-z0-9_－-]{2,12})”/g,
    /([\u4e00-\u9fa5]{2,4}?)(?:低声|问道|说道|回答|站起|抬头|摇头|笑了|推开|看着|按住|伸手)/g
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1]?.replace(/[，。、“”‘’：:；;,.!?！？]/g, '').trim()
      if (!name || name.length < 2 || COMMON_FALSE_NAMES.has(name)) continue
      if (/^(这个|那个|他们|我们|你们|有人|众人|系统|规则|面板|声音|黑影|工作人员)/.test(name)) continue
      if (isRoleOrOrganizationIdentity(name)) continue
      findings.push({ name, evidence: nearby(text, match.index ?? 0) })
    }
  }
  return unique(findings.map((item) => item.name)).map((name) => findings.find((item) => item.name === name)!)
}

export function createDefaultNoveltyPolicy(chapterPlan: ChapterPlan | null = null): ChapterNoveltyPolicy {
  const allowed = allowedNoveltyText(chapterPlan?.allowedNovelty)
  const forbidden = forbiddenNoveltyText(chapterPlan?.forbiddenNovelty)
  const taskText = [allowed, chapterPlan?.chapterGoal, chapterPlan?.conflictToPush].filter(Boolean).join('\n')
  const revealLike = /揭露|揭示|真相|回收|新副本|新规则|规则说明|设定/.test(taskText)
  const allowsCharacter = /允许.*(新角色|新增角色|命名角色|人物出场)/.test(allowed)
  const allowsRule = /允许.*(新规则|新增规则|副本规则|规则公告|规则说明)/.test(allowed)
  const allowsMechanic = /允许.*(新机制|新增机制|系统机制|系统权限|权限规则)/.test(allowed)
  const allowsOrganization = /允许.*(新组织|新增组织|新层级|管理员|身份层级)/.test(allowed)
  return {
    allowNewNamedCharacters: allowsCharacter,
    maxNewNamedCharacters: allowsCharacter ? 2 : 0,
    allowNewWorldRules: allowsRule,
    maxNewWorldRules: allowsRule ? 2 : 0,
    allowNewSystemMechanics: allowsMechanic,
    maxNewSystemMechanics: allowsMechanic ? 1 : 0,
    allowNewOrganizationsOrRanks: allowsOrganization,
    maxNewOrganizationsOrRanks: allowsOrganization ? 1 : 0,
    allowMajorLoreReveal: revealLike,
    allowedNewCharacterNames: textList(allowed),
    allowedNewRuleTopics: allowed ? [allowed] : [],
    allowedSystemMechanicTopics: allowed ? [allowed] : [],
    allowedOrganizationOrRankTopics: allowed ? [allowed] : [],
    allowedLoreRevealTopics: allowed ? [allowed] : [],
    forbiddenNewRuleTopics: forbidden ? [forbidden] : [],
    forbiddenSystemMechanicTopics: forbidden ? [forbidden] : [],
    forbiddenOrganizationOrRankTopics: forbidden ? [forbidden] : [],
    forbiddenRevealTopics: forbidden ? [forbidden] : [],
    requireForeshadowingForNewRules: true,
    requireTraceForNewEntities: true
  }
}

interface NoveltyAuditOptions {
  generatedText: string
  context: string
  chapterPlan: ChapterPlan | null
  noveltyPolicy?: ChapterNoveltyPolicy
  project?: Project | null
  appData?: AppData | null
  contextSelection?: ContextSelectionResult | null
  promptBlockOrder?: PromptBlockOrderItem[] | null
  forcedContextBlocks?: ForcedContextBlock[] | null
  compressionRecords?: ContextCompressionRecord[] | null
}

function traceContextText(options: NoveltyAuditOptions): string {
  const projectId = options.project?.id
  return [
    options.context,
    options.project ? `${options.project.name} ${options.project.genre} ${options.project.description}` : '',
    options.appData?.characters?.filter((character) => !projectId || character.projectId === projectId).map((character) => character.name).join(' ') ?? '',
    options.appData?.foreshadowings?.filter((foreshadowing) => !projectId || foreshadowing.projectId === projectId).map((foreshadowing) => `${foreshadowing.title} ${foreshadowing.description}`).join('\n') ?? '',
    options.contextSelection
      ? [
          ...(options.contextSelection.selectedCharacterIds ?? []),
          ...(options.contextSelection.selectedForeshadowingIds ?? []),
          ...(options.contextSelection.selectedStageSummaryIds ?? []),
          ...(options.contextSelection.selectedTimelineEventIds ?? [])
        ].join(' ')
      : '',
    options.promptBlockOrder?.map((block) => `${block.kind} ${block.title} ${(block.sourceIds ?? []).join(' ')}`).join('\n') ?? '',
    options.forcedContextBlocks?.map((block) => `${block.kind} ${block.title} ${block.sourceId ?? ''}`).join('\n') ?? '',
    options.compressionRecords?.map((record) => `${record.kind} ${record.replacementKind} ${record.replacementText ?? ''}`).join('\n') ?? ''
  ]
    .filter(Boolean)
    .join('\n')
}

function buildDeusExFindings(text: string, context: string, plan: ChapterPlan | null, policy: ChapterNoveltyPolicy): NoveltyFinding[] {
  const candidates = longestKeywordMatches(text, [...RULE_KEYWORDS, ...SYSTEM_MECHANIC_KEYWORDS])
  return candidates
    .map((keyword) => {
      const excerpt = nearby(text, text.indexOf(keyword), 130)
      const baseKind: NoveltyFindingKind = 'deus_ex_rule'
      const allowed = allowedByText(plan, policy, keyword, baseKind)
      const prior = textMatches(context, keyword)
      const cost = hasCostOrLimit(excerpt)
      const convenience = includesAny(excerpt, DEUS_EX_CUE_KEYWORDS)
      if (!convenience || allowed || prior || cost) return null
      return createFinding(
        baseKind,
        keyword,
        excerpt,
        context,
        plan,
        policy,
        'A newly introduced rule appears near immediate rescue or exemption language, without task permission, prior trace, or an explicit cost.'
      )
    })
    .filter((finding): finding is NoveltyFinding => Boolean(finding))
}

export class NoveltyDetector {
  static audit(options: NoveltyAuditOptions): NoveltyAuditResult {
    const text = options.generatedText ?? ''
    const context = traceContextText(options)
    const plan = options.chapterPlan ?? null
    const policy = options.noveltyPolicy ?? createDefaultNoveltyPolicy(plan)

    const newWorldRules = uniqueFindings(
      scanKeywordFindings(
        text,
        context,
        plan,
        policy,
        RULE_KEYWORDS,
        'new_world_rule',
        'The draft introduces a world/sub-instance rule keyword that may not be authorized by the chapter task.'
      )
    )

    const newSystemMechanics = uniqueFindings(
      scanKeywordFindings(
        text,
        context,
        plan,
        policy,
        SYSTEM_MECHANIC_KEYWORDS,
        'new_system_mechanic',
        'The draft introduces a system mechanic keyword that may expand canon.'
      )
    )

    const newOrganizationsOrRanks = uniqueFindings(
      scanKeywordFindings(
        text,
        context,
        plan,
        policy,
        ORGANIZATION_KEYWORDS,
        'new_organization_or_rank',
        'The draft introduces an organization, administrator, or hierarchy term.'
      )
    )

    const majorLoreReveals = uniqueFindings(
      scanKeywordFindings(
        text,
        context,
        plan,
        policy,
        LORE_KEYWORDS,
        'major_lore_reveal',
        'The draft appears to reveal major lore or a core mechanism.'
      )
    )

    const suspiciousDeusExRules = uniqueFindings(buildDeusExFindings(text, context, plan, policy))

    const newNamedCharacters = uniqueFindings(
      extractPotentialNames(text)
        .filter(({ name }) => !textMatches(context, name))
        .map(({ name, evidence }) =>
          createFinding('new_named_character', name, evidence, context, plan, policy, 'The draft names a character not present in the selected context.')
        )
    )

    const untracedNames = uniqueFindings(newNamedCharacters.filter((finding) => !finding.allowedByTask && !finding.hasPriorForeshadowing))
    const allFindings = uniqueFindings([
      ...newNamedCharacters,
      ...newWorldRules,
      ...newSystemMechanics,
      ...newOrganizationsOrRanks,
      ...majorLoreReveals,
      ...suspiciousDeusExRules,
      ...untracedNames
    ])
    const hasHigh = allFindings.some((finding) => finding.severity === 'fail' && !finding.allowedByTask)
    const hasWarning = allFindings.some((finding) => finding.severity === 'warning')
    const hasInfo = allFindings.some((finding) => finding.severity === 'info')

    return {
      newNamedCharacters,
      newWorldRules,
      newSystemMechanics,
      newOrganizationsOrRanks,
      majorLoreReveals,
      suspiciousDeusExRules,
      untracedNames,
      severity: hasHigh ? 'fail' : hasWarning ? 'warning' : 'pass',
      summary: hasHigh
        ? 'Detected unauthorized novelty that may invent rules, entities, or lore without setup.'
        : hasWarning
          ? 'Detected possible new content. Human confirmation is recommended before accepting memory updates.'
          : hasInfo
            ? 'Detected task-authorized or traced novelty. Keep it visible in review, but it is not a hard blocker.'
            : 'No obvious unauthorized novelty detected by local rules.'
    }
  }
}
