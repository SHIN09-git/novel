import type {
  ChapterNoveltyPolicy,
  ChapterPlan,
  ChapterAllowedNovelty,
  ChapterForbiddenNovelty,
  ContextCompressionRecord,
  ContextSelectionResult,
  ForcedContextBlock,
  NoveltyAuditResult,
  NoveltyFinding,
  NoveltyFindingSeverity,
  NoveltyFindingKind,
  Project,
  PromptBlockOrderItem,
  AppData
} from '../shared/types'

const RULE_KEYWORDS = [
  '附加条款',
  '补充说明',
  '临时权限',
  '立即触发',
  '手动评定',
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
  '附加条款',
  '补充说明',
  '临时权限',
  '立即触发',
  '手动评定',
  '豁免',
  '共享身份',
  '核心单元',
  '协同单元',
  '五米保护范围',
  '贡献值集中分配'
]

const SYSTEM_MECHANIC_KEYWORDS = [
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
  '五米范围',
  '临时身份',
  '自动升级',
  '权限授予',
  '意识剥离',
  '冗余池存储',
  '规则补丁',
  '系统面板',
  '核心权限',
  '权限继承',
  '存储机制',
  '回收机制'
]

const ORGANIZATION_KEYWORDS = ['区域管理员', '上级管理员', '管理员', '总部', '审查员', '仲裁员', '编号人员']
const LORE_KEYWORDS = ['真正机制', '完整真相', '系统核心', '源头', '意识剥离', '回收站', '冗余池', '底层规则']
const DEUS_EX_KEYWORDS = ['解除危机', '脱困', '豁免惩罚', '立即生效', '刚好', '免除', '救命', '安全通行', '临时权限']
RULE_KEYWORDS.push(
  '\u9644\u52a0\u6761\u6b3e',
  '\u8865\u5145\u8bf4\u660e',
  '\u4e34\u65f6\u6743\u9650',
  '\u7acb\u5373\u89e6\u53d1',
  '\u624b\u52a8\u8bc4\u5b9a',
  '\u8c41\u514d',
  '\u5171\u4eab\u8eab\u4efd',
  '\u6838\u5fc3\u5355\u5143',
  '\u534f\u540c\u5355\u5143',
  '\u6743\u9650\u6388\u4e88',
  '\u7279\u6b8a\u901a\u9053',
  '\u4f8b\u5916\u673a\u5236',
  '\u7cfb\u7edf\u6f0f\u6d1e',
  '\u89c4\u5219\u51b2\u7a81',
  '\u65b0\u589e\u6743\u9650',
  '\u4e34\u65f6\u8eab\u4efd',
  '\u81ea\u52a8\u5347\u7ea7',
  '\u5f3a\u5236\u653e\u884c',
  '\u4e94\u7c73\u8303\u56f4'
)
SYSTEM_MECHANIC_KEYWORDS.push(
  '\u610f\u8bc6\u5265\u79bb',
  '\u5197\u4f59\u6c60\u5b58\u50a8',
  '\u89c4\u5219\u8865\u4e01',
  '\u7cfb\u7edf\u9762\u677f',
  '\u6838\u5fc3\u6743\u9650',
  '\u6743\u9650\u7ee7\u627f',
  '\u6838\u5fc3\u5355\u5143',
  '\u534f\u540c\u5355\u5143',
  '\u5171\u4eab\u8eab\u4efd',
  '\u4e94\u7c73\u8303\u56f4',
  '\u4e34\u65f6\u8eab\u4efd',
  '\u81ea\u52a8\u5347\u7ea7'
)
ORGANIZATION_KEYWORDS.push(
  '\u533a\u57df\u7ba1\u7406\u5458',
  '\u4e0a\u7ea7',
  '\u603b\u90e8',
  '\u5ba1\u67e5\u5458',
  '\u59d4\u5458\u4f1a',
  '\u63a7\u5236\u4e2d\u5fc3',
  '\u8c03\u5ea6\u5c42',
  '\u76d1\u7ba1\u5c42',
  '\u88c1\u5b9a\u5458',
  '\u4ef2\u88c1\u5458',
  '\u603b\u63a7',
  '\u9ad8\u7ea7\u6743\u9650'
)
LORE_KEYWORDS.push(
  '\u610f\u8bc6\u5265\u79bb',
  '\u6e90\u5934',
  '\u771f\u6b63\u673a\u5236',
  '\u5b8c\u6574\u771f\u76f8',
  '\u7cfb\u7edf\u6838\u5fc3',
  '\u56de\u6536\u7ad9',
  '\u5197\u4f59\u6c60',
  '\u6570\u636e\u533a',
  '\u610f\u8bc6\u5b58\u50a8',
  '\u8bb0\u5fc6\u951a\u5b9a',
  '\u526f\u672c\u6e90\u4ee3\u7801',
  '\u5e95\u5c42\u534f\u8bae',
  '\u57ce\u5e02\u6838\u5fc3',
  '\u89c4\u5219\u5236\u5b9a\u8005',
  '\u539f\u59cb\u89c4\u5219'
)
DEUS_EX_KEYWORDS.push(
  '\u89e3\u9664\u5371\u673a',
  '\u8131\u56f0',
  '\u8c41\u514d\u60e9\u7f5a',
  '\u7acb\u5373\u751f\u6548',
  '\u521a\u597d',
  '\u514d\u9664',
  '\u6551\u547d',
  '\u5b89\u5168\u901a\u884c',
  '\u7cfb\u7edf\u7a81\u7136',
  '\u9762\u677f\u5f39\u51fa',
  '\u5f3a\u5236\u653e\u884c',
  '\u4e34\u65f6\u8c41\u514d'
)
const COMMON_FALSE_NAMES = new Set([
  '系统',
  '规则',
  '管理员',
  '上级',
  '总部',
  '审查员',
  '主角',
  '女主',
  '反派',
  '队长',
  '医生',
  '老师',
  '男人',
  '女人',
  '少年',
  '少女'
])

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => keyword && text.includes(keyword))
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[；;,\n]/).map((item) => item.trim()).filter(Boolean)
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

function nearby(text: string, index: number, radius = 80): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius)).trim()
}

function policyText(policy: ChapterNoveltyPolicy, plan: ChapterPlan | null): string {
  return [
    allowedNoveltyText(plan?.allowedNovelty),
    forbiddenNoveltyText(plan?.forbiddenNovelty),
    policy.allowedNewCharacterNames?.join(' '),
    policy.allowedNewRuleTopics?.join(' '),
    policy.allowedSystemMechanicTopics?.join(' '),
    policy.allowedOrganizationOrRankTopics?.join(' '),
    policy.allowedLoreRevealTopics?.join(' '),
    policy.forbiddenNewRuleTopics?.join(' '),
    policy.forbiddenSystemMechanicTopics?.join(' '),
    policy.forbiddenOrganizationOrRankTopics?.join(' '),
    policy.forbiddenRevealTopics?.join(' ')
  ]
    .filter(Boolean)
    .join('\n')
}

function allowedByText(text: string, plan: ChapterPlan | null, policy: ChapterNoveltyPolicy, term: string): boolean {
  if (!term) return false
  const allowedText = [
    allowedNoveltyText(plan?.allowedNovelty),
    policy.allowedNewCharacterNames?.join(' '),
    policy.allowedNewRuleTopics?.join(' '),
    policy.allowedSystemMechanicTopics?.join(' '),
    policy.allowedOrganizationOrRankTopics?.join(' '),
    policy.allowedLoreRevealTopics?.join(' ')
  ]
    .filter(Boolean)
    .join('\n')
  return allowedText.includes(term)
}

function forbiddenByText(text: string, plan: ChapterPlan | null, policy: ChapterNoveltyPolicy, term: string): boolean {
  if (!term) return false
  const forbiddenText = [
    forbiddenNoveltyText(plan?.forbiddenNovelty),
    policy.forbiddenNewRuleTopics?.join(' '),
    policy.forbiddenSystemMechanicTopics?.join(' '),
    policy.forbiddenOrganizationOrRankTopics?.join(' '),
    policy.forbiddenRevealTopics?.join(' ')
  ]
    .filter(Boolean)
    .join('\n')
  return forbiddenText.includes(term)
}

function findingSeverity(kind: NoveltyFindingKind, allowedByTask: boolean, hasPriorForeshadowing: boolean, explicitlyForbidden: boolean): NoveltyFindingSeverity {
  if (allowedByTask && !explicitlyForbidden) return 'info'
  if (explicitlyForbidden) return 'fail'
  if (kind === 'deus_ex_rule' || kind === 'suspicious_deus_ex_rule') return 'fail'
  if (kind === 'new_named_character' || kind === 'untraced_name') return hasPriorForeshadowing ? 'info' : 'warning'
  if (hasPriorForeshadowing) return 'warning'
  return 'fail'
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
  const allowedByTask = allowedByText(policyText(policy, plan), plan, policy, text)
  const explicitlyForbidden = forbiddenByText(policyText(policy, plan), plan, policy, text)
  const hasPriorForeshadowing = context.includes(text)
  const severity = findingSeverity(kind, allowedByTask, hasPriorForeshadowing, explicitlyForbidden)
  return {
    kind,
    text,
    evidenceExcerpt,
    reason,
    severity,
    allowedByTask,
    hasPriorForeshadowing,
    sourceHint: hasPriorForeshadowing ? 'selected_context_or_foreshadowing' : allowedByTask ? 'chapter_allowed_novelty' : explicitlyForbidden ? 'chapter_forbidden_novelty' : null,
    suggestedAction:
      severity === 'fail'
        ? 'Remove this novelty, revise it into an already foreshadowed rule/entity, or explicitly add it to the chapter task before accepting.'
        : 'Keep only if the author confirms this novelty has prior setup or is intentionally allowed for this chapter.'
  }
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
  return keywords
    .filter((keyword) => text.includes(keyword))
    .map((keyword) => {
      const index = text.indexOf(keyword)
      return createFinding(kind, keyword, nearby(text, index), context, plan, policy, reason)
    })
}

function extractPotentialNames(text: string): Array<{ name: string; evidence: string }> {
  const findings: Array<{ name: string; evidence: string }> = []
  const patterns = [
    /(?:名叫|叫作|叫做|名字是)([\u4e00-\u9fa5]{2,4})/g,
    /([\u4e00-\u9fa5]{2,4})(?:说|问道|问|道|回答|喊|低声说|走来|站起|抬头)/g
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1]?.trim()
      if (!name || COMMON_FALSE_NAMES.has(name)) continue
      if (/^(这个|那个|他们|我们|你们|有人|众人|系统|规则)/.test(name)) continue
      findings.push({ name, evidence: nearby(text, match.index ?? 0) })
    }
  }
  return unique(findings.map((item) => item.name)).map((name) => findings.find((item) => item.name === name)!)
}

export function createDefaultNoveltyPolicy(chapterPlan: ChapterPlan | null = null): ChapterNoveltyPolicy {
  const allowed = allowedNoveltyText(chapterPlan?.allowedNovelty)
  const forbidden = forbiddenNoveltyText(chapterPlan?.forbiddenNovelty)
  const revealLike = /揭露|真相|回收|新副本|新规则|规则说明|设定/.test([allowed, chapterPlan?.chapterGoal].filter(Boolean).join('\n'))
  return {
    allowNewNamedCharacters: /允许新增角色|新角色|命名角色/.test(allowed),
    maxNewNamedCharacters: /允许新增角色|新角色|命名角色/.test(allowed) ? 2 : 0,
    allowNewWorldRules: /允许新增规则|新副本规则|新规则/.test(allowed),
    maxNewWorldRules: /允许新增规则|新副本规则|新规则/.test(allowed) ? 2 : 0,
    allowNewSystemMechanics: /允许新增机制|新机制|系统机制/.test(allowed),
    maxNewSystemMechanics: /允许新增机制|新机制|系统机制/.test(allowed) ? 1 : 0,
    allowNewOrganizationsOrRanks: /允许新增组织|新组织|新层级|管理员/.test(allowed),
    maxNewOrganizationsOrRanks: /允许新增组织|新组织|新层级|管理员/.test(allowed) ? 1 : 0,
    allowMajorLoreReveal: revealLike,
    allowedNewCharacterNames: [],
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
  return [
    options.context,
    options.project ? `${options.project.name} ${options.project.genre} ${options.project.description}` : '',
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

export class NoveltyDetector {
  static audit(options: NoveltyAuditOptions): NoveltyAuditResult {
    const text = options.generatedText ?? ''
    const context = traceContextText(options)
    const plan = options.chapterPlan ?? null
    const policy = options.noveltyPolicy ?? createDefaultNoveltyPolicy(plan)

    const newWorldRules = scanKeywordFindings(
      text,
      context,
      plan,
      policy,
      RULE_KEYWORDS,
      'new_world_rule',
      'The draft introduces a world/sub-instance rule keyword that may not be authorized by the chapter task.'
    ).filter((finding) => policy.allowNewWorldRules || !finding.allowedByTask ? true : finding.severity !== 'info')

    const newSystemMechanics = scanKeywordFindings(
      text,
      context,
      plan,
      policy,
      SYSTEM_MECHANIC_KEYWORDS,
      'new_system_mechanic',
      'The draft introduces a system mechanic keyword that may expand canon.'
    )

    const newOrganizationsOrRanks = scanKeywordFindings(
      text,
      context,
      plan,
      policy,
      ORGANIZATION_KEYWORDS,
      'new_organization_or_rank',
      'The draft introduces an organization, administrator, or hierarchy term.'
    )

    const majorLoreReveals = scanKeywordFindings(
      text,
      context,
      plan,
      policy,
      LORE_KEYWORDS,
      'major_lore_reveal',
      'The draft appears to reveal major lore or core mechanism.'
    )

    const suspiciousDeusExRules = scanKeywordFindings(
      text,
      context,
      plan,
      policy,
      RULE_KEYWORDS.filter((keyword) => includesAny(text, [keyword]) && includesAny(nearby(text, text.indexOf(keyword), 120), DEUS_EX_KEYWORDS)),
      'deus_ex_rule',
      'A newly introduced rule appears near crisis-resolution language and may be a deus-ex-machina patch.'
    )

    const newNamedCharacters = extractPotentialNames(text)
      .filter(({ name }) => !context.includes(name))
      .map(({ name, evidence }) =>
        createFinding('new_named_character', name, evidence, context, plan, policy, 'The draft names a character not present in the selected context.')
      )

    const untracedNames = newNamedCharacters.filter((finding) => !finding.allowedByTask && !finding.hasPriorForeshadowing)
    const allFindings = [
      ...newNamedCharacters,
      ...newWorldRules,
      ...newSystemMechanics,
      ...newOrganizationsOrRanks,
      ...majorLoreReveals,
      ...suspiciousDeusExRules,
      ...untracedNames
    ]
    const hasHigh = allFindings.some((finding) => finding.severity === 'fail' && !finding.allowedByTask)
    const hasAny = allFindings.length > 0
    return {
      newNamedCharacters,
      newWorldRules,
      newSystemMechanics,
      newOrganizationsOrRanks,
      majorLoreReveals,
      suspiciousDeusExRules,
      untracedNames,
      severity: hasHigh ? 'fail' : hasAny ? 'warning' : 'pass',
      summary: hasHigh
        ? 'Detected unauthorized novelty that may invent rules, entities, or lore without setup.'
        : hasAny
          ? 'Detected possible new content. Human confirmation is recommended before accepting memory updates.'
          : 'No obvious unauthorized novelty detected by local rules.'
    }
  }
}
