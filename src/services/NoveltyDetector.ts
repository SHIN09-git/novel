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
  '贡献值集中分配'
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
  '五米范围',
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

const DEUS_EX_KEYWORDS = unique([
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
  '临时豁免'
])

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
  if (typeof value === 'string') return value.split(/[，,、;\n]/).map((item) => item.trim()).filter(Boolean)
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

function allowedByText(plan: ChapterPlan | null, policy: ChapterNoveltyPolicy, term: string): boolean {
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

function forbiddenByText(plan: ChapterPlan | null, policy: ChapterNoveltyPolicy, term: string): boolean {
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
  const allowedByTask = allowedByText(plan, policy, text)
  const explicitlyForbidden = forbiddenByText(plan, policy, text)
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
  return unique(keywords)
    .filter((keyword) => text.includes(keyword))
    .map((keyword) => {
      const index = text.indexOf(keyword)
      return createFinding(kind, keyword, nearby(text, index), context, plan, policy, reason)
    })
}

function extractPotentialNames(text: string): Array<{ name: string; evidence: string }> {
  const findings: Array<{ name: string; evidence: string }> = []
  const patterns = [
    /(?:名叫|叫作|叫做|名字是|自称|代号是)([\u4e00-\u9fa5]{2,6}(?:-\d{1,4}|号)?)/g,
    /([\u4e00-\u9fa5]{2,4})(?:说|问道|回答|低声说|站起|抬头)/g
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
  const taskText = [allowed, chapterPlan?.chapterGoal].filter(Boolean).join('\n')
  const revealLike = /揭露|真相|回收|新副本|新规则|规则说明|设定/.test(taskText)
  const allowsCharacter = /允许新增角色|新角色|命名角色/.test(allowed)
  const allowsRule = /允许新增规则|新副本规则|新规则|规则说明/.test(allowed)
  const allowsMechanic = /允许新增机制|新机制|系统机制/.test(allowed)
  const allowsOrganization = /允许新增组织|新组织|新层级|管理员/.test(allowed)
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
    )

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

    const deusExKeywords = RULE_KEYWORDS.filter((keyword) => {
      if (!text.includes(keyword)) return false
      return includesAny(nearby(text, text.indexOf(keyword), 120), DEUS_EX_KEYWORDS)
    })
    const suspiciousDeusExRules = scanKeywordFindings(
      text,
      context,
      plan,
      policy,
      deusExKeywords,
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
