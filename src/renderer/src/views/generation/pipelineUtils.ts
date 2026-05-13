import type {
  ChapterGenerationStepType,
  ChapterTask,
  CharacterStateFact,
  ContextBudgetMode,
  ContextNeedPlan,
  ContextSelectionTrace,
  ID,
  NoveltyAuditResult,
  PipelineMode,
  Project,
  PromptContextSnapshot,
  StoryDirectionGuide
} from '../../../../shared/types'
import { safeParseJson } from '../../../../services/AIJsonParser'
import { TokenEstimator } from '../../../../services/TokenEstimator'
import { StoryDirectionService } from '../../../../services/StoryDirectionService'

export const PIPELINE_STEP_ORDER: ChapterGenerationStepType[] = [
  'context_need_planning',
  'context_budget_selection',
  'build_context',
  'generate_chapter_plan',
  'context_need_planning_from_plan',
  'context_budget_selection_delta',
  'rebuild_context_with_plan',
  'generate_chapter_draft',
  'generate_chapter_review',
  'propose_character_updates',
  'propose_foreshadowing_updates',
  'consistency_review',
  'quality_gate',
  'await_user_confirmation'
]

export const PIPELINE_STEP_LABELS: Record<ChapterGenerationStepType, string> = {
  context_need_planning: '上下文需求规划',
  context_budget_selection: '上下文预算选择',
  build_context: '构建上下文',
  generate_chapter_plan: '生成任务书',
  context_need_planning_from_plan: '计划后需求补全',
  context_budget_selection_delta: '补选上下文',
  rebuild_context_with_plan: '重建计划上下文',
  generate_chapter_draft: '生成正文',
  generate_chapter_review: '复盘章节',
  propose_character_updates: '提取角色更新',
  propose_foreshadowing_updates: '提取伏笔更新',
  consistency_review: '一致性审稿',
  quality_gate: '质量门禁',
  await_user_confirmation: '等待确认'
}

export function serializeOutput(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export function parseOutput<T>(value: string, fallback: T): T {
  if (!value.trim()) return fallback
  const parsed = safeParseJson<T>(value, '流水线步骤输出')
  return parsed.ok ? parsed.data : fallback
}

export function pipelineContextFromStepOutput(output: string): string {
  const parsed = safeParseJson<{ finalPrompt?: string; context?: string; contextSource?: string }>(output, '流水线上下文输出')
  if (parsed.ok && typeof parsed.data.finalPrompt === 'string' && parsed.data.finalPrompt.trim()) return parsed.data.finalPrompt
  if (parsed.ok && typeof parsed.data.context === 'string' && parsed.data.context.trim()) return parsed.data.context
  return output
}

export function uniqueIds(ids: ID[]): ID[] {
  return [...new Set(ids.filter(Boolean))]
}

export function diffIds(next: ID[] = [], previous: ID[] = []): ID[] {
  const previousSet = new Set(previous)
  return uniqueIds(next.filter((id) => !previousSet.has(id)))
}

export function enrichContextSelectionTrace(
  baseTrace: ContextSelectionTrace | null | undefined,
  args: {
    jobId: ID
    contextNeedPlan: ContextNeedPlan | null
    includedCharacterStateFacts: CharacterStateFact[]
    hardCanonTrace: { itemCount: number; tokenEstimate: number; includedItemIds: ID[]; truncatedItemIds: ID[] }
    finalPromptTokenEstimate: number
  }
): ContextSelectionTrace | null {
  if (!baseTrace) return null
  const selectedBlocks = [...baseTrace.selectedBlocks]
  const droppedBlocks = [...baseTrace.droppedBlocks]
  const unmetNeeds = [...baseTrace.unmetNeeds]

  for (const fact of args.includedCharacterStateFacts) {
    selectedBlocks.push({
      blockType: 'character_state_fact',
      sourceId: fact.id,
      priority: fact.trackingLevel === 'hard' ? 'must' : 'high',
      tokenEstimate: TokenEstimator.estimate([fact.label, fact.value, fact.evidence].filter(Boolean).join('\n')),
      reason: `角色状态账本事实「${fact.label || fact.key}」进入 prompt，约束本章连续性。`
    })
  }

  const hardCanonToken = args.hardCanonTrace.includedItemIds.length
    ? Math.max(1, Math.round(args.hardCanonTrace.tokenEstimate / args.hardCanonTrace.includedItemIds.length))
    : 0
  for (const itemId of args.hardCanonTrace.includedItemIds) {
    const needReason = args.contextNeedPlan?.contextNeeds.find((need) => need.sourceHint === 'hardCanon' && need.sourceId === itemId)?.reason
    selectedBlocks.push({
      blockType: 'hard_canon',
      sourceId: itemId,
      priority: 'must',
      tokenEstimate: hardCanonToken,
      reason: needReason
        ? `HardCanonPack 条目进入 prompt，作为不可违背硬设定。需求理由：${needReason}`
        : 'HardCanonPack 条目进入 prompt，作为不可违背硬设定。'
    })
  }
  for (const itemId of args.hardCanonTrace.truncatedItemIds) {
    const needReason = args.contextNeedPlan?.contextNeeds.find((need) => need.sourceHint === 'hardCanon' && need.sourceId === itemId)?.reason
    droppedBlocks.push({
      blockType: 'hard_canon',
      sourceId: itemId,
      priority: 'must',
      tokenEstimate: hardCanonToken,
      dropReason: needReason
        ? `HardCanonPack 超出预算，被压缩或截断。未满足需求：${needReason}`
        : 'HardCanonPack 超出预算，被压缩或截断。'
    })
    unmetNeeds.push({
      needType: 'hard_canon',
      priority: 'must',
      reason: 'HardCanonPack 有 must/high 条目未完整进入 prompt。',
      sourceId: itemId
    })
  }

  const factsByCharacterId = new Set(args.includedCharacterStateFacts.map((fact) => fact.characterId))
  for (const [characterId, categories] of Object.entries(args.contextNeedPlan?.requiredStateFactCategories ?? {})) {
    if (categories.length > 0 && !factsByCharacterId.has(characterId)) {
      unmetNeeds.push({
        needType: 'character_state',
        priority: 'must',
        reason: `本章需求计划要求角色状态类别 ${categories.join(', ')}，但 prompt 未找到匹配状态事实。`,
        sourceId: characterId
      })
    }
  }

  const seenUnmet = new Set<string>()
  return {
    ...baseTrace,
    jobId: args.jobId,
    selectedBlocks,
    droppedBlocks,
    unmetNeeds: unmetNeeds.filter((item) => {
      const key = `${item.needType}:${item.sourceId ?? ''}:${item.priority}`
      if (seenUnmet.has(key)) return false
      seenUnmet.add(key)
      return true
    }),
    budgetSummary: {
      ...baseTrace.budgetSummary,
      usedTokens: args.finalPromptTokenEstimate,
      reservedTokens: Math.max(0, baseTrace.budgetSummary.totalBudget - args.finalPromptTokenEstimate),
      pressure:
        args.finalPromptTokenEstimate >= baseTrace.budgetSummary.totalBudget * 0.9 || droppedBlocks.length >= 12
          ? 'high'
          : args.finalPromptTokenEstimate >= baseTrace.budgetSummary.totalBudget * 0.7 || droppedBlocks.length >= 4
            ? 'medium'
            : 'low'
    }
  }
}

export function summarizeSnapshot(snapshot: PromptContextSnapshot) {
  return {
    contextSource: 'prompt_context_snapshot',
    snapshotId: snapshot.id,
    targetChapterOrder: snapshot.targetChapterOrder,
    mode: snapshot.mode,
    estimatedTokens: snapshot.estimatedTokens,
    selectedCharacterIds: snapshot.selectedCharacterIds,
    selectedForeshadowingIds: snapshot.selectedForeshadowingIds,
    foreshadowingTreatmentOverrides: snapshot.foreshadowingTreatmentOverrides,
    chapterTask: snapshot.chapterTask,
    contextNeedPlan: snapshot.contextNeedPlan,
    contextSelectionResult: snapshot.contextSelectionResult,
    note: snapshot.note
  }
}

export function normalizePipelineOptions(
  options: Partial<{
    targetChapterOrder: number
    pipelineMode: PipelineMode
    estimatedWordCount: string
    readerEmotionTarget: string
    budgetMode: ContextBudgetMode
    budgetMaxTokens: number
  }>,
  fallback: {
    targetChapterOrder: number
    pipelineMode: PipelineMode
    estimatedWordCount: string
    readerEmotionTarget: string
    budgetMode: ContextBudgetMode
    budgetMaxTokens: number
  }
) {
  return {
    targetChapterOrder: Number.isFinite(options.targetChapterOrder) ? Number(options.targetChapterOrder) : fallback.targetChapterOrder,
    pipelineMode: options.pipelineMode ?? fallback.pipelineMode,
    estimatedWordCount: options.estimatedWordCount || fallback.estimatedWordCount,
    readerEmotionTarget: options.readerEmotionTarget || fallback.readerEmotionTarget,
    budgetMode: options.budgetMode ?? fallback.budgetMode,
    budgetMaxTokens: Number.isFinite(options.budgetMaxTokens) ? Number(options.budgetMaxTokens) : fallback.budgetMaxTokens
  }
}

export function pipelineChapterTask(
  project: Project,
  options: ReturnType<typeof normalizePipelineOptions>,
  activeStoryDirectionGuide?: StoryDirectionGuide | null
): ChapterTask {
  const directionPatch = StoryDirectionService.deriveChapterTaskPatch(activeStoryDirectionGuide ?? null, options.targetChapterOrder)
  return {
    goal: directionPatch.goal || `生成第 ${options.targetChapterOrder} 章草稿`,
    conflict: directionPatch.conflict || '',
    suspenseToKeep: directionPatch.suspenseToKeep || '',
    allowedPayoffs: directionPatch.allowedPayoffs || '',
    forbiddenPayoffs: directionPatch.forbiddenPayoffs || '',
    endingHook: directionPatch.endingHook || '',
    readerEmotion: directionPatch.readerEmotion || options.readerEmotionTarget,
    targetWordCount: options.estimatedWordCount,
    styleRequirement: project.style
  }
}

export function minimumDraftTokens(expectedWordCount: string): number {
  const numbers = [...expectedWordCount.matchAll(/\d+/g)].map((match) => Number(match[0])).filter((value) => Number.isFinite(value))
  const minimumWords = numbers.length > 0 ? Math.min(...numbers) : 2000
  return Math.max(900, Math.min(2400, Math.round(minimumWords * 0.4)))
}

export function validateGeneratedChapterDraft(body: string, expectedWordCount: string, strict: boolean): string | null {
  const trimmed = body.trim()
  if (!trimmed) return '正文生成结果为空。'
  if (/^\s*[\[{]/.test(trimmed) && /"(?:body|chapterBody|chapterText|content)"\s*:/.test(trimmed)) {
    return 'AI 返回的是未解析完成的 JSON，而不是可用正文，可能已被截断。'
  }
  if (/【(?:世界规则|人物心理|主线推进|本章目标|角色节拍)】/.test(trimmed) || /^(本章目标|必须推进的冲突|角色节拍)：/m.test(trimmed)) {
    return 'AI 返回的是大纲/任务书摘要，不是章节正文。'
  }
  if (!/[。！？.!?」”]$/.test(trimmed)) {
    return '正文疑似中途截断，结尾没有完整句号或收束标点。'
  }
  if (strict) {
    const tokenEstimate = TokenEstimator.estimate(trimmed)
    const minTokens = minimumDraftTokens(expectedWordCount)
    if (tokenEstimate < minTokens) {
      return `正文过短（约 ${tokenEstimate} token），低于本章预计字数的最低可接受值（约 ${minTokens} token）。`
    }
  }
  return null
}

export function noveltyWarnings(audit: NoveltyAuditResult | null): string[] {
  if (!audit || audit.severity === 'pass') return []
  const findings = [
    ...audit.newNamedCharacters,
    ...audit.newWorldRules,
    ...audit.newSystemMechanics,
    ...audit.newOrganizationsOrRanks,
    ...audit.majorLoreReveals,
    ...audit.suspiciousDeusExRules,
    ...audit.untracedNames
  ]
  return [
    `Novelty audit ${audit.severity}: ${audit.summary}`,
    ...findings.slice(0, 6).map((finding) => `${finding.kind}: ${finding.text} - ${finding.evidenceExcerpt}`)
  ]
}

export function noveltyAdjustedConfidence(audit: NoveltyAuditResult | null, base: number): number {
  if (!audit) return base
  if (audit.severity === 'fail') return Math.min(base, 0.35)
  if (audit.severity === 'warning') return Math.min(base, 0.55)
  return base
}
