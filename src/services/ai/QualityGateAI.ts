import { AIClient } from './AIClient'
import type {
  AIResult,
  Character,
  CharacterStateSuggestion,
  Chapter,
  ChapterDraftResult,
  ChapterPlan,
  ChapterReviewDraft,
  ConsistencyReviewData,
  ConsistencyReviewIssue,
  ConsistencySeverity,
  Foreshadowing,
  ForeshadowingCandidate,
  ForeshadowingExtractionResult,
  ForeshadowingStatusChangeSuggestion,
  ForeshadowingWeight,
  ID,
  NextChapterSuggestions,
  PipelineMode,
  QualityGateDimensionScores,
  QualityGateIssue,
  RevisionRequestType,
  RevisionResult,
  StageSummary
} from '../../shared/types'
import type { QualityGateEvaluation } from '../QualityGateService'
import { REVIEW_SYSTEM_PROMPT } from './AIPromptTemplates'
import { ensureQualityGateEvaluation, ensureRevisionCandidate } from './AIResponseNormalizer'
import { validateQualityGateSchema, validateRevisionCandidateSchema } from './AISchemaValidator'

export class QualityGateAI {
  constructor(private readonly client: AIClient) {}

  async generateQualityGateReport(
    chapterDraft: ChapterDraftResult,
    context: string,
    chapterPlan: ChapterPlan | null
  ): Promise<AIResult<QualityGateEvaluation>> {
    const fallback: QualityGateEvaluation = {
      overallScore: 68,
      pass: false,
      dimensions: {
        plotCoherence: 70,
        characterConsistency: 70,
        characterStateConsistency: 70,
        foreshadowingControl: 70,
        chapterContinuity: 70,
        redundancyControl: 70,
        styleMatch: 68,
        pacing: 65,
        emotionalPayoff: 65,
        originality: 68,
        promptCompliance: 70,
        contextRelevanceCompliance: 70
      },
      issues: [
        {
          severity: 'medium',
          type: 'manual_review_required',
          description: '未配置 API Key 或质量门禁未调用模型，本报告为本地保守模板。',
          evidence: '缺少模型级审稿证据。',
          suggestedFix: '人工核对剧情推进、角色一致性、伏笔控制和文风后再接受草稿。'
        }
      ],
      requiredFixes: [],
      optionalSuggestions: ['人工确认草稿没有污染长期设定后再应用章节复盘或记忆更新。']
    }

    const userPrompt = [
      'You are a quality gate reviewer for a long-form novel generation pipeline.',
      'You are a release gate reviewer, not a general editor. Your job is to decide whether this chapter draft is safe to move into human confirmation and memory-update review.',
      'Return strict JSON only. Do not output Markdown or explanatory text.',
      'Schema:',
      '{"overallScore":0,"pass":false,"dimensions":{"plotCoherence":0,"characterConsistency":0,"characterStateConsistency":0,"foreshadowingControl":0,"chapterContinuity":0,"redundancyControl":0,"styleMatch":0,"pacing":0,"emotionalPayoff":0,"originality":0,"promptCompliance":0,"contextRelevanceCompliance":0},"issues":[{"severity":"low","type":"","description":"","evidence":"","suggestedFix":""}],"requiredFixes":[],"optionalSuggestions":[]}',
      'Each dimension must be 0-100. pass should be false if score < 75, if characterConsistency < 70, if characterStateConsistency < 70, if foreshadowingControl < 70, if chapterContinuity < 70, or if any high severity issue exists.',
      'Evaluate: plot goal progress, current character state consistency, forbidden foreshadowing reveal, unregistered major canon, style sample match, pacing, reader emotion payoff, AI cliche / over-explanation, and compliance with the chapter plan.',
      'If the context includes a Consistency Review section, reference it as diagnostic input. Do not duplicate identical issues; instead set linkedConsistencyIssueId when you refer to an existing consistency issue. High severity consistency issues should reduce pass likelihood.',
      'Foreshadowing treatment modes are binding. Check whether the draft: paid off a non-payoff clue too early; turned hint into advance; turned advance into payoff; mentioned hidden clues; advanced paused clues; created mislead clues that contradict final truth; or let characters directly explain what should only be hinted.',
      'For those violations, use issue.type = "foreshadowing_treatment_violation". Severity guide: hidden clearly mentioned = medium/high; pause advanced = medium; hint explained or paid off = high; advance directly paid off = high; mislead contradicts final truth = high.',
      'Chapter continuity checks: first scene must directly continue the previous ending, preserve carried physical/emotional state, not skip unresolved action, not reset character state, and respond to the last hook.',
      'Redundancy checks: repeated environment descriptions, repeated canon/mechanism explanations, overused abstract intensifiers, redundant paragraphs, and repeated chapter-opening structure. If redundancyControl < 70, recommend reduce_redundancy / compress_description revision.',
      'Context need plan checks: verify that the draft respects the required character card fields, state fact categories, continuity checks, and exclusion rules present in the context. If it ignores key required state or uses excluded information, lower contextRelevanceCompliance and add a concrete issue.',
      'Character state ledger checks: verify resource balance, inventory ownership, injury persistence, character knowledge, ability limits, location continuity, and promises/debts. Use issue.type values such as resource_underflow, missing_inventory, injury_reset, knowledge_leak, ability_overuse, location_jump, promise_ignored, or state_conflict.',
      'Novelty checks: flag unauthorized new named characters, new world rules, new system mechanics, new organizations/ranks, and major lore reveals. Use issue.type values unauthorized_new_character, unauthorized_new_rule, unauthorized_new_organization, unauthorized_lore_reveal, or deus_ex_rule_patch.',
      'If a newly introduced rule directly solves the current crisis without prior foreshadowing or chapter-plan permission, pass must be false and severity should be high. If a new rule is explicitly allowed and carries cost/risk, it may pass but should be recorded.',
      '',
      `Chapter plan:\n${JSON.stringify(chapterPlan ?? {}, null, 2)}`,
      '',
      `Draft title: ${chapterDraft.title}`,
      `Draft body:\n${chapterDraft.body}`,
      '',
      `Context:\n${context}`
    ].join('\n')

    return this.client.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureQualityGateEvaluation, fallback, undefined, validateQualityGateSchema)
  }


  async generateRevisionCandidate(
    chapterDraft: ChapterDraftResult,
    issue: QualityGateIssue,
    context: string
  ): Promise<AIResult<{ revisionInstruction: string; revisedText: string }>> {
    const fallback = {
      revisionInstruction: issue.suggestedFix || '请根据质量门禁问题进行局部修订。',
      revisedText: ''
    }

    const userPrompt = [
      'You are revising a local problem in a novel chapter draft.',
      'Return strict JSON only: {"revisionInstruction":"","revisedText":""}',
      'Do not rewrite the whole chapter unless the issue requires it. Preserve canon and character state.',
      '',
      `Issue:\n${JSON.stringify(issue, null, 2)}`,
      '',
      `Draft title: ${chapterDraft.title}`,
      `Draft body:\n${chapterDraft.body}`,
      '',
      `Context:\n${context}`
    ].join('\n')

    return this.client.requestJson(REVIEW_SYSTEM_PROMPT, userPrompt, ensureRevisionCandidate, fallback, undefined, validateRevisionCandidateSchema)
  }

}
