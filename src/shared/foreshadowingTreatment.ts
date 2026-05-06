import type { Foreshadowing, ForeshadowingStatus, ForeshadowingTreatmentMode, ForeshadowingWeight } from './types'

export const FORESHADOWING_TREATMENT_OPTIONS: Array<{
  value: ForeshadowingTreatmentMode
  label: string
  description: string
}> = [
  { value: 'hidden', label: '隐藏', description: '本章不提及。' },
  { value: 'hint', label: '暗示', description: '只放出轻微信号，不解释。' },
  { value: 'advance', label: '推进', description: '让伏笔产生新变化，但不揭底。' },
  { value: 'mislead', label: '误导', description: '制造错误方向的线索。' },
  { value: 'pause', label: '暂停', description: '暂时冻结，不进入当前 prompt。' },
  { value: 'payoff', label: '回收', description: '允许揭示并兑现。' }
]

export const TREATMENT_PRIORITY: Record<ForeshadowingTreatmentMode, number> = {
  payoff: 7,
  advance: 6,
  mislead: 5,
  hint: 4,
  pause: 2,
  hidden: 1
}

export function treatmentLabel(mode: ForeshadowingTreatmentMode): string {
  return FORESHADOWING_TREATMENT_OPTIONS.find((option) => option.value === mode)?.label ?? '暗示'
}

export function treatmentDescription(mode: ForeshadowingTreatmentMode): string {
  return FORESHADOWING_TREATMENT_OPTIONS.find((option) => option.value === mode)?.description ?? '只放出轻微信号，不解释。'
}

export function normalizeTreatmentMode(
  value: unknown,
  status: ForeshadowingStatus = 'unresolved',
  weight: ForeshadowingWeight = 'medium'
): ForeshadowingTreatmentMode {
  if (value === 'hidden' || value === 'hint' || value === 'advance' || value === 'mislead' || value === 'pause' || value === 'payoff') {
    return value
  }
  if (status === 'resolved' || status === 'abandoned') return 'pause'
  if (weight === 'payoff') return 'payoff'
  return 'hint'
}

export function effectiveTreatmentMode(
  item: Foreshadowing,
  overrides?: Record<string, ForeshadowingTreatmentMode>
): ForeshadowingTreatmentMode {
  return normalizeTreatmentMode(overrides?.[item.id] ?? item.treatmentMode, item.status, item.weight)
}

export function treatmentAllowsDefaultPrompt(mode: ForeshadowingTreatmentMode): boolean {
  return mode === 'hint' || mode === 'advance' || mode === 'mislead' || mode === 'payoff'
}

export function treatmentOmitReason(mode: ForeshadowingTreatmentMode): string {
  if (mode === 'hidden') return '当前处理方式为隐藏'
  if (mode === 'pause') return '当前处理方式为暂停'
  if (mode === 'hint') return 'token 预算不足，低于本章推进优先级'
  return 'token 预算不足，低于本章推进优先级'
}

export function treatmentPromptRules(mode: ForeshadowingTreatmentMode): string[] {
  if (mode === 'hidden') {
    return ['本章不应主动提及该伏笔', '除非用户明确要求，不要放入场景、对白或旁白', '不得推进、解释或回收']
  }
  if (mode === 'pause') {
    return ['本章应保持暂停', '不推进、不解释、不回收', '不要让角色围绕它做新判断']
  }
  if (mode === 'advance') {
    return ['允许推进该伏笔', '可以产生新变化或新证据', '不得完全揭示真相', '不得直接回收']
  }
  if (mode === 'mislead') {
    return ['允许制造误导性线索', '误导不能破坏后续真相', '不得把误导写成最终答案', '不得提前回收']
  }
  if (mode === 'payoff') {
    return ['允许回收该伏笔', '可以揭示真相', '应影响人物选择或剧情结果', '回收后保持与既有设定一致']
  }
  return ['只能轻微暗示', '不得解释来源', '不得让角色直接说破', '不得推进或回收']
}

export function shouldRecommendForeshadowing(item: Foreshadowing, nearPayoff: boolean): boolean {
  const mode = effectiveTreatmentMode(item)
  if (item.status === 'resolved' || item.status === 'abandoned') return false
  if (!treatmentAllowsDefaultPrompt(mode)) return false
  if (mode === 'payoff' || mode === 'advance' || mode === 'mislead') return true
  return item.weight === 'medium' || item.weight === 'high' || item.weight === 'payoff' || nearPayoff
}
