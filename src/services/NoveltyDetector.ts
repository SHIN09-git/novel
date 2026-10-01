import type {
  AppData,
  ChapterNoveltyPolicy,
  ChapterPlan,
  ContextCompressionRecord,
  ContextSelectionResult,
  ForcedContextBlock,
  NoveltyAuditResult,
  NoveltyFinding,
  NoveltyFindingKind,
  Project,
  PromptBlockOrderItem
} from '../shared/types'
import {
  LORE_KEYWORDS,
  ORGANIZATION_KEYWORDS,
  RULE_KEYWORDS,
  SYSTEM_MECHANIC_KEYWORDS
} from './novelty/noveltyKeywords'
import { extractPotentialNames } from './novelty/noveltyNames'
import {
  createNoveltyFinding,
  noveltyAliasesAllowed,
  noveltyAliasesMatch,
  uniqueNoveltyFindings
} from './novelty/noveltyFindings'
import { createDefaultNoveltyPolicy, enforceNoveltyQuota } from './novelty/noveltyPolicy'
import { analyzeNoveltyOccurrence } from './novelty/noveltySemantics'
import { keywordOccurrences, textMatches, withNoveltyAuditMemo, type KeywordOccurrence } from './novelty/noveltyText'

export { createDefaultNoveltyPolicy } from './novelty/noveltyPolicy'

function scanKeywordFindings(
  occurrences: KeywordOccurrence[],
  context: string,
  plan: ChapterPlan | null,
  policy: ChapterNoveltyPolicy,
  keywords: string[],
  kind: NoveltyFindingKind,
  reason: string
): NoveltyFinding[] {
  const keywordSet = new Set(keywords)
  const findings = occurrences.filter((occurrence) => keywordSet.has(occurrence.keyword)).flatMap((occurrence) => {
    const semanticSignals = analyzeNoveltyOccurrence(kind, occurrence)
    if (semanticSignals.mundaneUsage) return []
    return [
      createNoveltyFinding({
        kind,
        text: occurrence.keyword,
        evidenceExcerpt: occurrence.evidenceExcerpt,
        context,
        plan,
        policy,
        reason,
        semanticSignals
      })
    ]
  })
  return enforceNoveltyQuota(uniqueNoveltyFindings(findings), kind, policy)
}

export interface NoveltyAuditOptions {
  generatedText: string
  context: string
  chapterPlan: ChapterPlan | null
  noveltyPolicy?: ChapterNoveltyPolicy
  project?: Project | null
  appData?: AppData | null
  knownCharacterNames?: string[]
  knownForeshadowingTexts?: string[]
  knownCanonTexts?: string[]
  contextSelection?: ContextSelectionResult | null
  promptBlockOrder?: PromptBlockOrderItem[] | null
  forcedContextBlocks?: ForcedContextBlock[] | null
  compressionRecords?: ContextCompressionRecord[] | null
}

function selectedContextText(options: NoveltyAuditOptions, projectId: string | undefined): string {
  if (!options.appData || !options.contextSelection) return ''
  const selected = options.contextSelection
  const inProject = <T extends { projectId: string }>(item: T) => !projectId || item.projectId === projectId
  return [
    options.appData.characters
      .filter(inProject)
      .filter((item) => selected.selectedCharacterIds.includes(item.id))
      .map((item) => item.name)
      .join(' '),
    options.appData.foreshadowings
      .filter(inProject)
      .filter((item) => selected.selectedForeshadowingIds.includes(item.id))
      .map((item) => `${item.title} ${item.description} ${item.expectedPayoff}`)
      .join('\n'),
    options.appData.timelineEvents
      .filter(inProject)
      .filter((item) => selected.selectedTimelineEventIds.includes(item.id))
      .map((item) => `${item.title} ${item.result} ${item.downstreamImpact}`)
      .join('\n')
  ]
    .filter(Boolean)
    .join('\n')
}

function traceContextText(options: NoveltyAuditOptions): string {
  const projectId = options.project?.id
  const appDataCanon = options.appData?.hardCanonPacks
    ?.filter((pack) => !projectId || pack.projectId === projectId)
    .flatMap((pack) => pack.items.filter((item) => item.status === 'active').map((item) => `${item.title} ${item.content}`))
    .join('\n')
  return [
    options.context,
    options.project ? `${options.project.name} ${options.project.genre} ${options.project.description}` : '',
    options.knownCharacterNames?.join(' '),
    options.knownForeshadowingTexts?.join('\n'),
    options.knownCanonTexts?.join('\n'),
    selectedContextText(options, projectId),
    appDataCanon,
    options.promptBlockOrder?.map((block) => `${block.kind} ${block.title} ${(block.sourceIds ?? []).join(' ')}`).join('\n') ?? '',
    options.forcedContextBlocks?.map((block) => `${block.kind} ${block.title} ${block.sourceId ?? ''}`).join('\n') ?? '',
    options.compressionRecords?.map((record) => `${record.kind} ${record.replacementKind} ${record.replacementText ?? ''}`).join('\n') ?? ''
  ]
    .filter(Boolean)
    .join('\n')
}

function buildDeusExFindings(occurrences: KeywordOccurrence[], context: string, plan: ChapterPlan | null, policy: ChapterNoveltyPolicy): NoveltyFinding[] {
  const noveltyKeywords = new Set([...RULE_KEYWORDS, ...SYSTEM_MECHANIC_KEYWORDS])
  const candidates = occurrences.filter((occurrence) => noveltyKeywords.has(occurrence.keyword))
    .map((occurrence) => {
      const semanticSignals = analyzeNoveltyOccurrence('deus_ex_rule', occurrence)
      if (semanticSignals.mundaneUsage) return null
      const allowed = noveltyAliasesAllowed(plan, policy, semanticSignals.aliases, 'deus_ex_rule')
      const prior = noveltyAliasesMatch(context, semanticSignals.aliases)
      if (
        !semanticSignals.resolvesCurrentCrisis ||
        allowed ||
        prior ||
        semanticSignals.hasLinkedCostOrLimit
      ) {
        return null
      }
      return { occurrence, semanticSignals }
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))

  const bySentence = new Map<string, (typeof candidates)[number]>()
  for (const candidate of candidates) {
    const key = candidate.occurrence.sentence || candidate.occurrence.evidenceExcerpt
    const current = bySentence.get(key)
    const score = (value: (typeof candidates)[number]) => {
      const keyword = value.occurrence.keyword
      const ruleForm = /(条款|规则|权限|机制|通行权|评定|裁定)/.test(keyword) ? 20 : 0
      const genericPanel = keyword === '系统面板' ? -20 : 0
      return ruleForm + genericPanel + keyword.length
    }
    if (!current || score(candidate) > score(current)) bySentence.set(key, candidate)
  }

  return [...bySentence.values()].map(({ occurrence, semanticSignals }) =>
    createNoveltyFinding({
        kind: 'deus_ex_rule',
        text: occurrence.keyword,
        evidenceExcerpt: occurrence.evidenceExcerpt,
        context,
        plan,
        policy,
        reason: '新规则直接服务于当前危机解除，但没有任务书许可、既有来源或与该规则关联的明确代价。',
        semanticSignals
      })
  )
}

export class NoveltyDetector {
  static audit(options: NoveltyAuditOptions): NoveltyAuditResult {
    return withNoveltyAuditMemo(() => NoveltyDetector.auditWithinScope(options))
  }

  private static auditWithinScope(options: NoveltyAuditOptions): NoveltyAuditResult {
    const text = options.generatedText ?? ''
    const context = traceContextText(options)
    const plan = options.chapterPlan ?? null
    const policy = options.noveltyPolicy ?? createDefaultNoveltyPolicy(plan)
    // Scan the generated chapter once, then classify the same offset-preserving
    // occurrences by novelty category. This keeps long Chinese chapters linear
    // in text size instead of rescanning once for every keyword table.
    const keywordOccurrenceIndex = keywordOccurrences(
      text,
      [...RULE_KEYWORDS, ...SYSTEM_MECHANIC_KEYWORDS, ...ORGANIZATION_KEYWORDS, ...LORE_KEYWORDS]
    )
    const newWorldRules = scanKeywordFindings(keywordOccurrenceIndex, context, plan, policy, RULE_KEYWORDS, 'new_world_rule', '正文出现可能扩展世界规则的内容。')
    const newSystemMechanics = scanKeywordFindings(
      keywordOccurrenceIndex,
      context,
      plan,
      policy,
      SYSTEM_MECHANIC_KEYWORDS,
      'new_system_mechanic',
      '正文出现可能扩展长期设定的系统机制。'
    )
    const newOrganizationsOrRanks = scanKeywordFindings(
      keywordOccurrenceIndex,
      context,
      plan,
      policy,
      ORGANIZATION_KEYWORDS,
      'new_organization_or_rank',
      '正文出现新的组织、管理员或层级身份。'
    )
    const majorLoreReveals = scanKeywordFindings(keywordOccurrenceIndex, context, plan, policy, LORE_KEYWORDS, 'major_lore_reveal', '正文可能提前揭露核心设定或世界真相。')
    const suspiciousDeusExRules = uniqueNoveltyFindings(buildDeusExFindings(keywordOccurrenceIndex, context, plan, policy))
    const newNamedCharacters = enforceNoveltyQuota(
      uniqueNoveltyFindings(
        extractPotentialNames(text, options.knownCharacterNames ?? [])
          .filter(({ name }) => !textMatches(context, name))
          .map(({ name, evidence, confidence }) =>
            createNoveltyFinding({
              kind: 'new_named_character',
              text: name,
              evidenceExcerpt: evidence,
              context,
              plan,
              policy,
              reason: confidence === 'low'
                ? '正文可能出现上下文中不存在的人名，但当前仅由动作归属句式推断，需要作者确认。'
                : '正文明确命名了上下文中不存在的角色。',
              confidence
            })
          )
      ),
      'new_named_character',
      policy
    )
    const untracedNames = newNamedCharacters
      .filter((finding) => !finding.allowedByTask && !finding.hasPriorForeshadowing)
      .map((finding) => ({ ...finding, kind: 'untraced_name' as const }))
    const allFindings = uniqueNoveltyFindings([
      ...newNamedCharacters,
      ...newWorldRules,
      ...newSystemMechanics,
      ...newOrganizationsOrRanks,
      ...majorLoreReveals,
      ...suspiciousDeusExRules
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
        ? '检测到未授权新增内容，可能引入无铺垫规则、实体或核心设定。'
        : hasWarning
          ? '检测到需要作者确认的新增内容，接受正文前建议核对来源和代价。'
          : hasInfo
            ? '检测到任务书已授权或已有来源的新信息，已保留审计记录。'
            : '本地规则未发现明显的未授权新增内容。'
    }
  }
}
