import type {
  ChapterAllowedNovelty,
  ChapterForbiddenNovelty,
  ChapterNoveltyPolicy,
  ChapterPlan,
  NoveltyFinding,
  NoveltyFindingKind
} from '../../shared/types'
import { textList, textMatches } from './noveltyText'

export type ChapterNoveltyMode = 'new_instance_opening' | 'reveal' | 'climax_solution' | 'standard'

export function allowedNoveltyText(value: ChapterPlan['allowedNovelty'] | null | undefined): string {
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

export function forbiddenNoveltyText(value: ChapterPlan['forbiddenNovelty'] | null | undefined): string {
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

function categoryAllowed(kind: NoveltyFindingKind, policy: ChapterNoveltyPolicy, source: string): boolean {
  if (kind === 'new_named_character' || kind === 'untraced_name') {
    return policy.allowNewNamedCharacters || /允许.*(新角色|命名角色|新增角色|人物出场)/.test(source)
  }
  if (kind === 'new_world_rule' || kind === 'deus_ex_rule' || kind === 'suspicious_deus_ex_rule') {
    return policy.allowNewWorldRules || /允许.*(新规则|新增规则|副本规则|规则公告|规则说明)/.test(source)
  }
  if (kind === 'new_system_mechanic') {
    return policy.allowNewSystemMechanics || /允许.*(新机制|新增机制|系统机制|系统权限|权限规则)/.test(source)
  }
  if (kind === 'new_organization_or_rank') {
    return policy.allowNewOrganizationsOrRanks || /允许.*(新组织|新增组织|新层级|管理员|身份层级)/.test(source)
  }
  if (kind === 'major_lore_reveal') {
    return policy.allowMajorLoreReveal || /允许.*(揭示|揭露|真相|设定|世界观)/.test(source)
  }
  return false
}

function categoryForbidden(kind: NoveltyFindingKind, source: string): boolean {
  if (!source) return false
  if (kind === 'new_named_character' || kind === 'untraced_name') {
    return /(?:禁止|不得)(?:新增|引入|命名)[^，,。；;\n]{0,48}(?:角色|人物)/.test(source)
  }
  if (kind === 'new_world_rule' || kind === 'deus_ex_rule' || kind === 'suspicious_deus_ex_rule') {
    return /(?:禁止|不得)(?:新增|引入)(?:任何|新的|世界|副本)?规则/.test(source)
  }
  if (kind === 'new_system_mechanic') {
    return /(?:禁止|不得)(?:新增|引入)(?:任何|新的|系统|核心)?(?:机制|权限)/.test(source)
  }
  if (kind === 'new_organization_or_rank') {
    return /(?:禁止|不得)(?:新增|引入)(?:任何|新的)?(?:组织|层级|管理员)/.test(source)
  }
  if (kind === 'major_lore_reveal') {
    return /(?:禁止|不得)(?:揭示|揭露|解释)(?:任何|新的|核心|完整)?(?:真相|设定|世界观|机制)/.test(source)
  }
  return false
}

export function noveltyAllowedByTask(
  plan: ChapterPlan | null,
  policy: ChapterNoveltyPolicy,
  term: string,
  kind: NoveltyFindingKind
): boolean {
  if (!term) return false
  const source = allowedSourceText(plan, policy)
  return textMatches(source, term) || categoryAllowed(kind, policy, source)
}

export function noveltyDirectlyForbidden(plan: ChapterPlan | null, policy: ChapterNoveltyPolicy, term: string): boolean {
  return Boolean(term) && textMatches(forbiddenSourceText(plan, policy), term)
}

export function noveltyCategoryForbidden(plan: ChapterPlan | null, policy: ChapterNoveltyPolicy, kind: NoveltyFindingKind): boolean {
  return categoryForbidden(kind, forbiddenSourceText(plan, policy))
}

export function inferChapterNoveltyMode(plan: ChapterPlan | null): ChapterNoveltyMode {
  const text = [
    plan?.chapterTitle,
    plan?.chapterGoal,
    plan?.conflictToPush,
    plan?.openingContinuationBeat,
    allowedNoveltyText(plan?.allowedNovelty),
    forbiddenNoveltyText(plan?.forbiddenNovelty)
  ]
    .filter(Boolean)
    .join('\n')
  if (/高潮|最终解法|脱困|危机解除|通关|逃离|破局/.test(text)) return 'climax_solution'
  if (/新副本|副本开场|规则公告|入场规则|开场章|第一次进入/.test(text)) return 'new_instance_opening'
  if (/揭露|揭示|真相|回收|解释谜团|设定揭示/.test(text)) return 'reveal'
  return 'standard'
}

function structuredAllowed(plan: ChapterPlan | null): ChapterAllowedNovelty | null {
  return plan?.allowedNovelty && typeof plan.allowedNovelty !== 'string' ? plan.allowedNovelty : null
}

export function createDefaultNoveltyPolicy(chapterPlan: ChapterPlan | null = null): ChapterNoveltyPolicy {
  const allowed = allowedNoveltyText(chapterPlan?.allowedNovelty)
  const forbidden = forbiddenNoveltyText(chapterPlan?.forbiddenNovelty)
  const structured = structuredAllowed(chapterPlan)
  const taskText = [allowed, chapterPlan?.chapterGoal, chapterPlan?.conflictToPush].filter(Boolean).join('\n')
  const revealLike = /揭露|揭示|真相|回收|新副本|新规则|规则说明|设定/.test(taskText)
  const allowsCharacter = Boolean(structured?.allowedNewCharacters.length) || /允许.*(新角色|新增角色|命名角色|人物出场)/.test(allowed)
  const allowsRule = Boolean(structured?.allowedNewRules.length) || /允许.*(新规则|新增规则|副本规则|规则公告|规则说明)/.test(allowed)
  const allowsMechanic = Boolean(structured?.allowedNewSystemMechanics.length) || /允许.*(新机制|新增机制|系统机制|系统权限|权限规则)/.test(allowed)
  const allowsOrganization =
    Boolean(structured?.allowedNewOrganizationsOrRanks.length) || /允许.*(新组织|新增组织|新层级|管理员|身份层级)/.test(allowed)
  return {
    allowNewNamedCharacters: allowsCharacter,
    maxNewNamedCharacters: structured?.allowedNewCharacters.length || (allowsCharacter ? 2 : 0),
    allowNewWorldRules: allowsRule,
    maxNewWorldRules: structured?.allowedNewRules.length || (allowsRule ? 2 : 0),
    allowNewSystemMechanics: allowsMechanic,
    maxNewSystemMechanics: structured?.allowedNewSystemMechanics.length || (allowsMechanic ? 1 : 0),
    allowNewOrganizationsOrRanks: allowsOrganization,
    maxNewOrganizationsOrRanks: structured?.allowedNewOrganizationsOrRanks.length || (allowsOrganization ? 1 : 0),
    allowMajorLoreReveal: Boolean(structured?.allowedLoreReveals.length) || revealLike,
    allowedNewCharacterNames: structured?.allowedNewCharacters.length ? structured.allowedNewCharacters : textList(allowed),
    allowedNewRuleTopics: structured?.allowedNewRules.length ? structured.allowedNewRules : allowed ? [allowed] : [],
    allowedSystemMechanicTopics: structured?.allowedNewSystemMechanics.length ? structured.allowedNewSystemMechanics : allowed ? [allowed] : [],
    allowedOrganizationOrRankTopics: structured?.allowedNewOrganizationsOrRanks.length
      ? structured.allowedNewOrganizationsOrRanks
      : allowed
        ? [allowed]
        : [],
    allowedLoreRevealTopics: structured?.allowedLoreReveals.length ? structured.allowedLoreReveals : allowed ? [allowed] : [],
    forbiddenNewRuleTopics: forbidden ? [forbidden] : [],
    forbiddenSystemMechanicTopics: forbidden ? [forbidden] : [],
    forbiddenOrganizationOrRankTopics: forbidden ? [forbidden] : [],
    forbiddenRevealTopics: forbidden ? [forbidden] : [],
    requireForeshadowingForNewRules: true,
    requireTraceForNewEntities: true
  }
}

function quotaFor(kind: NoveltyFindingKind, policy: ChapterNoveltyPolicy): number | null {
  if (kind === 'new_named_character' || kind === 'untraced_name') return policy.maxNewNamedCharacters
  if (kind === 'new_world_rule') return policy.maxNewWorldRules
  if (kind === 'new_system_mechanic') return policy.maxNewSystemMechanics
  if (kind === 'new_organization_or_rank') return policy.maxNewOrganizationsOrRanks
  return null
}

export function enforceNoveltyQuota(
  findings: NoveltyFinding[],
  kind: NoveltyFindingKind,
  policy: ChapterNoveltyPolicy
): NoveltyFinding[] {
  const quota = quotaFor(kind, policy)
  if (quota === null) return findings
  let allowedCount = 0
  return findings.map((finding) => {
    if (!finding.allowedByTask) return finding
    allowedCount += 1
    if (allowedCount <= Math.max(0, quota)) return finding
    const severity = kind === 'new_world_rule' || kind === 'new_system_mechanic' ? 'fail' : 'warning'
    return {
      ...finding,
      allowedByTask: false,
      severity,
      sourceHint: 'novelty_policy_limit_exceeded',
      reason: `${finding.reason} 本章允许的此类新增内容上限为 ${Math.max(0, quota)}，当前条目已超出配额。`,
      suggestedAction: '删除超额新增内容，或先在章节任务书中明确提高本章新增配额。'
    }
  })
}
