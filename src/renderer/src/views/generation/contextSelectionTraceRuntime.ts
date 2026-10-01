import type {
  CharacterStateFact,
  ContextNeedPlan,
  ContextSelectionMode,
  ContextSelectionTrace,
  HardCanonPack,
  ID
} from '../../../../shared/types'
import { TokenEstimator } from '../../../../services/TokenEstimator'

export function characterStateFactsPresentInPrompt(prompt: string, facts: CharacterStateFact[]): CharacterStateFact[] {
  const normalizedPrompt = prompt.replace(/\s+/g, '')
  return facts.filter((fact) => {
    const label = (fact.label || fact.key).replace(/\s+/g, '')
    if (label.length >= 2 && normalizedPrompt.includes(label)) return true
    const value = typeof fact.value === 'string' || typeof fact.value === 'number' || typeof fact.value === 'boolean'
      ? String(fact.value).replace(/\s+/g, '')
      : ''
    return value.length >= 4 && normalizedPrompt.includes(value.slice(0, Math.min(24, value.length)))
  })
}

export function hardCanonTraceFromPrompt(
  prompt: string,
  pack: HardCanonPack | null | undefined
): { itemCount: number; tokenEstimate: number; includedItemIds: ID[]; truncatedItemIds: ID[] } {
  if (!pack) return { itemCount: 0, tokenEstimate: 0, includedItemIds: [], truncatedItemIds: [] }
  const includedItems = pack.items.filter(
    (item) => item.status === 'active' && item.title.trim().length >= 2 && prompt.includes(item.title.trim())
  )
  return {
    itemCount: includedItems.length,
    tokenEstimate: TokenEstimator.estimate(includedItems.map((item) => `${item.title}：${item.content}`).join('\n')),
    includedItemIds: includedItems.map((item) => item.id),
    truncatedItemIds: []
  }
}

function uniqueBySource<T extends { blockType: string; sourceId?: ID | null }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.blockType}:${item.sourceId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function enrichContextSelectionTrace(
  baseTrace: ContextSelectionTrace | null | undefined,
  args: {
    jobId: ID
    contextNeedPlan: ContextNeedPlan | null
    includedCharacterStateFacts: CharacterStateFact[]
    hardCanonTrace: { itemCount: number; tokenEstimate: number; includedItemIds: ID[]; truncatedItemIds: ID[] }
    storyDirectionGuideId: ID | null
    selectionMode: ContextSelectionMode
    finalPromptTokenEstimate: number
  }
): ContextSelectionTrace | null {
  if (!baseTrace) return null
  const selectedBlocks = [...baseTrace.selectedBlocks]
  const droppedBlocks = [...baseTrace.droppedBlocks]
  const factsByCharacterId = new Set(args.includedCharacterStateFacts.map((fact) => fact.characterId))
  const includedHardCanonIds = new Set(args.hardCanonTrace.includedItemIds)
  const unmetNeeds = baseTrace.unmetNeeds.filter((need) => {
    if (need.sourceId && need.needType.includes('character_state') && factsByCharacterId.has(need.sourceId)) return false
    if (need.needType.includes('hard_canon')) {
      return need.sourceId ? !includedHardCanonIds.has(need.sourceId) : includedHardCanonIds.size === 0
    }
    if (need.needType.includes('story_direction')) {
      return need.sourceId ? need.sourceId !== args.storyDirectionGuideId : !args.storyDirectionGuideId
    }
    return true
  })

  for (const fact of args.includedCharacterStateFacts) {
    const stateNeed = args.contextNeedPlan?.contextNeeds.find(
      (need) => need.sourceHint === 'character_state' && need.sourceId === fact.characterId
    )
    selectedBlocks.push({
      blockType: 'character_state_fact',
      sourceId: fact.id,
      priority: fact.trackingLevel === 'hard' ? 'must' : 'high',
      uncertain: stateNeed?.uncertain ?? false,
      reasonCode: 'required_need',
      forced: fact.trackingLevel === 'hard',
      compressed: false,
      replacementSourceId: null,
      tokenEstimate: TokenEstimator.estimate([fact.label, fact.value, fact.evidence].filter(Boolean).join('\n')),
      reason: `角色状态账本事实「${fact.label || fact.key}」进入 prompt，约束本章连续性。`
    })
  }

  const hardCanonToken = args.hardCanonTrace.includedItemIds.length
    ? Math.max(1, Math.round(args.hardCanonTrace.tokenEstimate / args.hardCanonTrace.includedItemIds.length))
    : 0
  for (const itemId of args.hardCanonTrace.includedItemIds) {
    const needReason = args.contextNeedPlan?.contextNeeds.find(
      (need) => need.sourceHint === 'hardCanon' && need.sourceId === itemId
    )?.reason
    selectedBlocks.push({
      blockType: 'hard_canon',
      sourceId: itemId,
      priority: 'must',
      uncertain: false,
      reasonCode: 'required_need',
      forced: true,
      compressed: false,
      replacementSourceId: null,
      tokenEstimate: hardCanonToken,
      reason: needReason
        ? `HardCanonPack 条目进入 prompt，作为不可违背硬设定。需求理由：${needReason}`
        : 'HardCanonPack 条目进入 prompt，作为不可违背硬设定。'
    })
  }
  for (const itemId of args.hardCanonTrace.truncatedItemIds) {
    const needReason = args.contextNeedPlan?.contextNeeds.find(
      (need) => need.sourceHint === 'hardCanon' && need.sourceId === itemId
    )?.reason
    droppedBlocks.push({
      blockType: 'hard_canon',
      sourceId: itemId,
      priority: 'must',
      uncertain: false,
      reasonCode: 'budget_exceeded',
      forced: true,
      compressed: true,
      replacementSourceId: null,
      tokenEstimate: hardCanonToken,
      dropReason: needReason
        ? `HardCanonPack 超出预算，被压缩或截断。未满足需求：${needReason}`
        : 'HardCanonPack 超出预算，被压缩或截断。'
    })
    unmetNeeds.push({
      needType: 'hard_canon',
      priority: 'must',
      uncertain: false,
      reasonCode: 'budget_exceeded',
      reason: 'HardCanonPack 有 must/high 条目未完整进入 prompt。',
      sourceId: itemId
    })
  }

  for (const [characterId, categories] of Object.entries(args.contextNeedPlan?.requiredStateFactCategories ?? {})) {
    if (categories.length === 0 || factsByCharacterId.has(characterId)) continue
    const stateNeed = args.contextNeedPlan?.contextNeeds.find(
      (need) => need.sourceHint === 'character_state' && need.sourceId === characterId
    )
    unmetNeeds.push({
      needType: 'character_state',
      priority: stateNeed?.priority ?? 'must',
      uncertain: stateNeed?.uncertain ?? false,
      reasonCode: args.selectionMode === 'prompt_snapshot' ? 'snapshot_locked' : 'not_available',
      reason: `本章需求计划要求角色状态类别 ${categories.join(', ')}，但 prompt 未找到匹配状态事实。`,
      sourceId: characterId
    })
  }

  const seenUnmet = new Set<string>()
  const finalUnmetNeeds = unmetNeeds
    .map((item) => ({
      ...item,
      reasonCode: args.selectionMode === 'prompt_snapshot' ? ('snapshot_locked' as const) : item.reasonCode
    }))
    .filter((item) => {
      const key = `${item.needType}:${item.sourceId ?? ''}:${item.priority}`
      if (seenUnmet.has(key)) return false
      seenUnmet.add(key)
      return true
    })

  return {
    ...baseTrace,
    jobId: args.jobId,
    selectionMode: args.selectionMode,
    selectedBlocks: uniqueBySource(selectedBlocks),
    droppedBlocks: uniqueBySource(droppedBlocks),
    unmetNeeds: finalUnmetNeeds,
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
