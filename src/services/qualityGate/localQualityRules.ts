import type {
  ChapterDraftResult,
  ChapterPlan,
  ChapterTask,
  Character,
  CharacterStateFact,
  GeneratedChapterDraft,
  QualityGateDimensionScores,
  QualityGateIssue,
  RedundancyReport
} from '../../shared/types'
import { QUALITY_GATE_PASS_SCORE } from '../../shared/qualityGatePolicy'
import { CharacterStateService } from '../CharacterStateService'
import { ChapterTaskContractService } from '../ChapterTaskContractService'
import { analyzeRedundancy } from '../RedundancyService'
import { TokenEstimator } from '../TokenEstimator'

export interface LocalQualityEvaluation {
  overallScore: number
  pass: boolean
  dimensions: QualityGateDimensionScores
  issues: QualityGateIssue[]
  requiredFixes: string[]
  optionalSuggestions: string[]
}

export function clampQualityScore(value: number): number {
  if (!Number.isFinite(value)) return 70
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function qualityDimensionAverage(dimensions: QualityGateDimensionScores): number {
  const values = Object.values(dimensions)
  return clampQualityScore(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export function draftBody(chapterDraft: ChapterDraftResult | GeneratedChapterDraft): string {
  return 'body' in chapterDraft ? chapterDraft.body : ''
}

function draftTitle(chapterDraft: ChapterDraftResult | GeneratedChapterDraft): string {
  return 'title' in chapterDraft ? chapterDraft.title : ''
}

function treatmentViolations(body: string, context: string): QualityGateIssue[] {
  const issues: QualityGateIssue[] = []
  const blocks = context.match(/### 【[\s\S]*?(?=\n### 【|\n## |\n# |$)/g) ?? []
  for (const block of blocks) {
    const title = block.match(/^### 【(.+?)】/m)?.[1]?.trim()
    const mode = block.match(/当前处理方式：(.+)/)?.[1]?.trim()
    if (!title || !mode || !body.includes(title)) continue
    if (mode === '隐藏') {
      issues.push({ severity: 'high', type: 'foreshadowing_treatment_violation', description: '草稿明显提及了本章应隐藏的伏笔。', evidence: title, suggestedFix: '删除该伏笔在本章的直接提及，除非作者明确手动要求。' })
    } else if (mode === '暂停') {
      issues.push({ severity: 'medium', type: 'foreshadowing_treatment_violation', description: '草稿提及了本章应暂停的伏笔，需要确认是否越权推进。', evidence: title, suggestedFix: '检查该段是否推进、解释或回收了暂停伏笔；必要时改为不出现。' })
    } else if (mode === '暗示' && /真相|原来|解释|揭示|回收|说明/.test(body)) {
      issues.push({ severity: 'high', type: 'foreshadowing_treatment_violation', description: '草稿可能把只允许暗示的伏笔写成了解释或回收。', evidence: title, suggestedFix: '把该伏笔改回轻微信号，不让角色直接说破，也不解释来源。' })
    }
  }
  return issues
}

function stateIssueSeverity(type: string): QualityGateIssue['severity'] {
  return ['resource_underflow', 'missing_inventory', 'injury_reset', 'knowledge_leak', 'state_conflict'].includes(type) ? 'high' : 'medium'
}

function structuredStateViolations(body: string, facts: CharacterStateFact[], characters: Character[]): QualityGateIssue[] {
  return CharacterStateService.validateCharacterStateInText(body, facts, characters).map((issue) => ({
    severity: stateIssueSeverity(issue.type),
    type: issue.type,
    description: issue.description,
    evidence: issue.evidence,
    suggestedFix:
      issue.type === 'resource_underflow'
        ? '补充收入、借款、赊账等来源，或把支出改到当前余额以内。'
        : issue.type === 'missing_inventory'
          ? '先交代获得该物品，或改用账本中已有物品。'
          : issue.type === 'knowledge_leak'
            ? '把该信息改成猜测、误判或尚未确认，直到角色通过正文事件获得它。'
            : issue.type === 'state_conflict'
              ? '先在角色状态账本中合并或归档互相冲突的活动事实。'
              : '恢复状态约束，或补充足以解释本次变化的行动、代价和过程。'
  }))
}

function contextStateViolations(body: string, context: string): QualityGateIssue[] {
  const issues: QualityGateIssue[] = []
  const cashMatch = context.match(/现金余额[：:]\s*([0-9]+(?:\.[0-9]+)?)/)
  const cash = cashMatch ? Number(cashMatch[1]) : Number.NaN
  if (Number.isFinite(cash)) {
    for (const match of body.matchAll(/(花费|支付|买下|购买|付了|花了)\s*([0-9]+(?:\.[0-9]+)?)/g)) {
      const amount = Number(match[2])
      const nearby = body.slice(Math.max(0, (match.index ?? 0) - 80), (match.index ?? 0) + 120)
      if (Number.isFinite(amount) && amount > cash && !/收入|借|赊|偷|抢|预支/.test(nearby)) {
        issues.push({ severity: 'high', type: 'resource_underflow', description: '正文出现超过角色状态账本余额的支出，且没有交代资金来源。', evidence: match[0], suggestedFix: '补充收入、借款、赊账或偷取等来源，或把支出改到当前余额以内。' })
      }
    }
  }
  const inventoryMatch = context.match(/持有物品[：:]\s*([^\n。]+)/)
  const inventory = inventoryMatch?.[1]?.split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean) ?? []
  if (inventory.length) {
    for (const match of body.matchAll(/使用了?([^，。、“”\s]{2,12}(钥匙|地图|剑|枪|药|戒指|令牌|笔记|书))/g)) {
      const item = match[1]
      if (!inventory.some((owned) => item.includes(owned) || owned.includes(item))) {
        issues.push({ severity: 'high', type: 'missing_inventory', description: '正文使用了角色状态账本未记录持有的物品。', evidence: item, suggestedFix: '先在正文交代获得该物品，或改用账本中已有物品。' })
      }
    }
  }
  if (/伤势|身体状态|右臂|骨裂|受伤/.test(context) && /痊愈|完全恢复|毫无伤痛|行动自如/.test(body) && !/治疗|休养|药|包扎|解释/.test(body)) {
    issues.push({ severity: 'high', type: 'injury_reset', description: '角色伤势可能被无解释重置。', evidence: body.slice(0, 160), suggestedFix: '保留伤势影响，或补充明确治疗、休养或代价说明。' })
  }
  if (/能力限制|冷却|代价|过度使用/.test(context) && /无限|毫无限制|连续使用|反复发动/.test(body) && !/代价|冷却|消耗|痛/.test(body)) {
    issues.push({ severity: 'medium', type: 'ability_overuse', description: '角色能力限制可能被忽略。', evidence: body.slice(0, 160), suggestedFix: '恢复能力代价、冷却或失败风险，避免无成本连续使用。' })
  }
  return issues
}

function dedupeIssues(issues: QualityGateIssue[]): QualityGateIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.type}:${issue.evidence}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function buildLocalQualityEvaluation(
  chapterDraft: ChapterDraftResult | GeneratedChapterDraft,
  chapterPlan: ChapterPlan | null,
  context = '',
  characterStateFacts?: CharacterStateFact[],
  characters: Character[] = [],
  chapterTask?: ChapterTask | null,
  precomputedRedundancy?: RedundancyReport | null
): LocalQualityEvaluation {
  const body = draftBody(chapterDraft)
  const tokenCount = TokenEstimator.estimate(body)
  const stateIssues = characterStateFacts
    ? structuredStateViolations(body, characterStateFacts, characters)
    : contextStateViolations(body, context)
  const chapterTaskIssues = chapterTask
    ? ChapterTaskContractService.evaluate({ body, title: draftTitle(chapterDraft), chapterTask }).issues
    : []
  const issues = dedupeIssues([...treatmentViolations(body, context), ...stateIssues, ...chapterTaskIssues])
  const redundancy = precomputedRedundancy ?? analyzeRedundancy({ projectId: 'quality-gate', chapterId: null, draftId: null, body })
  const startsWithReset = /^(与此同时|不知过了多久|几天后|另一边|清晨|夜色|城市|世界|传说|在这座)/.test(body.trim())
  const hasContinuityContext = /上一章结尾衔接|Chapter Continuity Bridge|openingContinuationBeat|mustContinueFrom/.test(context)

  if (tokenCount < 500) {
    issues.push({ severity: 'high', type: 'length', description: '章节正文明显偏短，可能只是模板或未完成草稿。', evidence: `估算正文 token：${tokenCount}`, suggestedFix: '补足场景推进、角色行动、冲突升级和结尾钩子后再进入记忆更新。' })
  }
  if (chapterPlan?.conflictToPush && !body.includes(chapterPlan.conflictToPush.slice(0, 8))) {
    issues.push({ severity: 'medium', type: 'promptCompliance', description: '本地规则无法确认正文是否推进了任务书中的核心冲突。', evidence: chapterPlan.conflictToPush, suggestedFix: '人工核对正文是否明确推进本章冲突，必要时局部重写冲突段落。' })
  }
  if (/本地草稿模板|API Key|请根据/.test(body)) {
    issues.push({ severity: 'high', type: 'placeholder', description: '正文仍包含模板或配置提示，不能作为正式章节。', evidence: '检测到模板提示文本。', suggestedFix: '配置 API 后重新生成，或手动替换为真实章节正文。' })
  }
  if (hasContinuityContext && startsWithReset) {
    issues.push({ severity: 'high', type: 'chapter_continuity_break', description: '正文开头疑似重新开场，没有直接承接上一章结尾状态。', evidence: body.trim().slice(0, 120), suggestedFix: '执行“加强章节衔接”，让第一场戏从上一章结尾后的数秒到数分钟内开始。' })
  }
  if (redundancy.overallRedundancyScore >= 45) {
    issues.push({ severity: redundancy.overallRedundancyScore >= 70 ? 'medium' : 'low', type: 'redundancy_control', description: '正文存在重复词组、重复解释或可压缩描写。', evidence: [...redundancy.repeatedPhrases, ...redundancy.overusedIntensifiers].slice(0, 5).join('；'), suggestedFix: '执行“减少冗余”或“压缩描写”，删除重复解释和抽象强化词。' })
  }

  const dimensions: QualityGateDimensionScores = {
    plotCoherence: tokenCount < 500 || issues.some((issue) => ['chapter_task_length', 'chapter_task_forbidden_outing_decision', 'chapter_task_post_return_presence_break'].includes(issue.type)) ? 45 : 76,
    characterConsistency: 75,
    characterStateConsistency: issues.some((issue) => ['resource_underflow', 'missing_inventory', 'injury_reset', 'knowledge_leak', 'ability_overuse', 'location_jump', 'promise_ignored', 'state_conflict'].includes(issue.type)) ? 58 : 75,
    foreshadowingControl: issues.some((issue) => ['chapter_task_phrase_count', 'chapter_task_phrase_position', 'chapter_task_post_phrase_tail', 'chapter_task_forbidden_source_inquiry'].includes(issue.type))
      ? 45
      : issues.some((issue) => issue.type === 'foreshadowing_treatment_violation')
        ? 62
        : 75,
    chapterContinuity: issues.some((issue) => issue.type === 'chapter_continuity_break') ? 58 : 76,
    redundancyControl: Math.max(35, 82 - redundancy.overallRedundancyScore),
    styleMatch: issues.some((issue) => ['chapter_task_perspective', 'chapter_task_style_forbidden_term'].includes(issue.type)) ? 45 : draftTitle(chapterDraft) ? 74 : 68,
    pacing: tokenCount < 500 || issues.some((issue) => issue.type === 'chapter_task_length') ? 45 : 72,
    emotionalPayoff: 70,
    originality: /突然|命运|无法回头/.test(body) ? 68 : 73,
    promptCompliance: issues.some((issue) => issue.type === 'promptCompliance' || issue.type.startsWith('chapter_task_')) ? 45 : 76,
    contextRelevanceCompliance: context.includes('本章角色上下文切片') || context.includes('上下文需求计划') ? 76 : 70
  }
  const overallScore = qualityDimensionAverage(dimensions)
  return {
    overallScore,
    pass: overallScore >= QUALITY_GATE_PASS_SCORE && !issues.some((issue) => issue.severity === 'high'),
    dimensions,
    issues,
    requiredFixes: issues.filter((issue) => issue.severity === 'high').map((issue) => issue.suggestedFix),
    optionalSuggestions: issues.filter((issue) => issue.severity !== 'high').map((issue) => issue.suggestedFix)
  }
}
