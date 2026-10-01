import type {
  ChapterNoveltyPolicy,
  ChapterPlan,
  NoveltyFinding,
  NoveltyFindingKind,
  NoveltyFindingSeverity
} from '../../shared/types'
import {
  inferChapterNoveltyMode,
  noveltyAllowedByTask,
  noveltyCategoryForbidden,
  noveltyDirectlyForbidden
} from './noveltyPolicy'
import { aliasesForNoveltyKeyword, type NoveltySemanticSignals } from './noveltySemantics'
import { normalizeForMatch, textMatches } from './noveltyText'

export function noveltyAliasesMatch(source: string, aliases: string[]): boolean {
  return aliases.some((alias) => textMatches(source, alias))
}

export function noveltyAliasesAllowed(
  plan: ChapterPlan | null,
  policy: ChapterNoveltyPolicy,
  aliases: string[],
  kind: NoveltyFindingKind
): boolean {
  return aliases.some((alias) => noveltyAllowedByTask(plan, policy, alias, kind))
}

function findingSeverity(input: {
  kind: NoveltyFindingKind
  allowedByTask: boolean
  hasPriorForeshadowing: boolean
  explicitlyForbidden: boolean
  costOrLimit: boolean
  authorizedMedium: boolean
  genericReference: boolean
  chapterMode: ReturnType<typeof inferChapterNoveltyMode>
  confidence?: NoveltyFinding['confidence']
}): NoveltyFindingSeverity {
  const {
    kind,
    allowedByTask,
    hasPriorForeshadowing,
    explicitlyForbidden,
    costOrLimit,
    authorizedMedium,
    genericReference,
    chapterMode,
    confidence
  } = input
  if ((kind === 'new_named_character' || kind === 'untraced_name') && confidence === 'low') {
    return hasPriorForeshadowing ? 'info' : 'warning'
  }
  if (explicitlyForbidden) return 'fail'
  if (allowedByTask) return 'info'
  if (kind === 'deus_ex_rule' || kind === 'suspicious_deus_ex_rule') return 'fail'
  if (kind === 'new_named_character' || kind === 'untraced_name') {
    return hasPriorForeshadowing ? 'info' : 'warning'
  }
  if (hasPriorForeshadowing) return kind === 'major_lore_reveal' ? 'warning' : 'info'
  if (kind === 'new_organization_or_rank' && genericReference) return 'warning'
  if (
    chapterMode === 'new_instance_opening' &&
    authorizedMedium &&
    costOrLimit &&
    (kind === 'new_world_rule' || kind === 'new_system_mechanic')
  ) {
    return 'info'
  }
  if (chapterMode === 'reveal' && authorizedMedium && kind === 'major_lore_reveal') return 'warning'
  if (
    chapterMode === 'climax_solution' &&
    (kind === 'new_world_rule' || kind === 'new_system_mechanic') &&
    !costOrLimit
  ) {
    return 'fail'
  }
  if (
    costOrLimit &&
    (kind === 'new_world_rule' || kind === 'new_system_mechanic' || kind === 'new_organization_or_rank')
  ) {
    return 'warning'
  }
  if (kind === 'new_organization_or_rank') return 'warning'
  return 'fail'
}

function sourceHintFor(input: {
  allowedByTask: boolean
  hasPriorForeshadowing: boolean
  explicitlyForbidden: boolean
  costOrLimit: boolean
  authorizedMedium: boolean
  resolvesCurrentCrisis: boolean
  genericReference: boolean
}): string | null {
  if (input.explicitlyForbidden) return 'chapter_forbidden_novelty'
  if (input.allowedByTask) return 'chapter_allowed_novelty'
  if (input.hasPriorForeshadowing) return 'known_context_or_canon'
  if (input.resolvesCurrentCrisis) return 'unearned_crisis_resolution'
  if (input.genericReference) return 'generic_role_reference'
  if (input.authorizedMedium) return 'draft_contains_rule_medium'
  if (input.costOrLimit) return 'draft_contains_cost_or_limit'
  return null
}

export function createNoveltyFinding(input: {
  kind: NoveltyFindingKind
  text: string
  evidenceExcerpt: string
  context: string
  plan: ChapterPlan | null
  policy: ChapterNoveltyPolicy
  reason: string
  semanticSignals?: NoveltySemanticSignals
  confidence?: NoveltyFinding['confidence']
}): NoveltyFinding {
  const { kind, text, evidenceExcerpt, context, plan, policy, reason, semanticSignals, confidence } = input
  const aliases = semanticSignals?.aliases ?? aliasesForNoveltyKeyword(text)
  const hasPriorForeshadowing = noveltyAliasesMatch(context, aliases)
  const costOrLimit = semanticSignals?.hasLinkedCostOrLimit ?? false
  const authorizedMedium = semanticSignals?.hasLinkedAuthorizedMedium ?? false
  const resolvesCurrentCrisis = semanticSignals?.resolvesCurrentCrisis ?? false
  const genericReference = semanticSignals?.genericReference ?? false
  const allowedByTask = noveltyAliasesAllowed(plan, policy, aliases, kind)
  const directlyForbidden = aliases.some((alias) => noveltyDirectlyForbidden(plan, policy, alias))
  const explicitlyForbidden =
    directlyForbidden ||
    (noveltyCategoryForbidden(plan, policy, kind) && !allowedByTask && !hasPriorForeshadowing)
  const severity = findingSeverity({
    kind,
    allowedByTask,
    hasPriorForeshadowing,
    explicitlyForbidden,
    costOrLimit,
    authorizedMedium,
    genericReference,
    chapterMode: inferChapterNoveltyMode(plan),
    confidence
  })
  const reviewedReason =
    authorizedMedium && costOrLimit && severity !== 'fail'
      ? `${reason} 正文通过可追溯媒介呈现，并附带代价或限制，因此保留为人工复核项。`
      : costOrLimit && severity !== 'fail'
        ? `${reason} 正文写明了代价或限制，因此风险降级为人工复核。`
        : reason

  return {
    kind,
    text,
    evidenceExcerpt,
    reason: reviewedReason,
    severity,
    allowedByTask,
    hasPriorForeshadowing,
    sourceHint: sourceHintFor({
      allowedByTask,
      hasPriorForeshadowing,
      explicitlyForbidden,
      costOrLimit,
      authorizedMedium,
      resolvesCurrentCrisis,
      genericReference
    }),
    suggestedAction:
      severity === 'fail'
        ? '删除该新增内容，改用已有铺垫，或先在章节任务书中明确授权后再接受正文。'
        : confidence === 'low'
          ? '该人名识别置信度较低，请人工确认；它不会单独阻止草稿采纳。'
          : '仅在作者确认已有铺垫、任务书许可或明确代价时保留。',
    confidence,
    semanticEvidence: semanticSignals?.evidence
  }
}

export function uniqueNoveltyFindings(findings: NoveltyFinding[]): NoveltyFinding[] {
  const severityRank: Record<NoveltyFindingSeverity, number> = { info: 0, warning: 1, fail: 2 }
  const strongest = new Map<string, NoveltyFinding>()
  for (const finding of findings) {
    const key = `${finding.kind}:${normalizeForMatch(finding.text)}`
    const existing = strongest.get(key)
    const shouldReplace =
      !existing ||
      severityRank[finding.severity] > severityRank[existing.severity] ||
      (severityRank[finding.severity] === severityRank[existing.severity] &&
        Boolean(finding.semanticEvidence?.resolutionCue) &&
        !existing.semanticEvidence?.resolutionCue)
    if (shouldReplace) strongest.set(key, finding)
  }
  return [...strongest.values()]
}
