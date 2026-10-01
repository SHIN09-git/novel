import type { CharacterCardField, CharacterStateFact, StateFactCategory } from '../../../../shared/types'
import { CharacterStateService } from '../../../../services/CharacterStateService'

export const CARD_FIELD_LABELS: Record<CharacterCardField, string> = {
  roleFunction: '角色定位',
  surfaceGoal: '表层目标',
  deepNeed: '深层需求',
  coreFear: '核心恐惧',
  decisionLogic: '行动逻辑',
  abilitiesAndResources: '能力与资源',
  weaknessAndCost: '弱点与代价',
  relationshipTension: '关系张力',
  futureHooks: '后续钩子'
}

export const STATE_CATEGORY_OPTIONS: Array<{ value: StateFactCategory; label: string }> = [
  { value: 'resource', label: '资源/余额' },
  { value: 'inventory', label: '持有物品' },
  { value: 'location', label: '当前位置' },
  { value: 'physical', label: '伤势/身体' },
  { value: 'knowledge', label: '已知秘密' },
  { value: 'relationship', label: '关系状态' },
  { value: 'promise', label: '承诺/债务' },
  { value: 'ability', label: '能力限制' },
  { value: 'status', label: '当前目标/状态' },
  { value: 'custom', label: '自定义' }
]

export const STATE_TEMPLATES: Array<{
  label: string
  category: StateFactCategory
  key: string
  linkedCardFields: CharacterCardField[]
  valueHint: string
}> = [
  { label: '现金余额', category: 'resource', key: 'cash', linkedCardFields: ['abilitiesAndResources'], valueHint: '例如：5000' },
  { label: '持有物品', category: 'inventory', key: 'inventory', linkedCardFields: ['abilitiesAndResources'], valueHint: '例如：黑色钥匙、旧地图' },
  { label: '当前位置', category: 'location', key: 'location', linkedCardFields: ['surfaceGoal'], valueHint: '例如：倒悬都市押解通道尽头' },
  { label: '伤势/身体状态', category: 'physical', key: 'injury', linkedCardFields: ['weaknessAndCost', 'abilitiesAndResources'], valueHint: '例如：右臂灼痛，不能长时间挥剑' },
  { label: '已知秘密', category: 'knowledge', key: 'known_secret', linkedCardFields: ['abilitiesAndResources', 'relationshipTension'], valueHint: '例如：知道第一代牺牲品与自己同脸' },
  { label: '当前目标', category: 'status', key: 'current_goal', linkedCardFields: ['surfaceGoal'], valueHint: '例如：找到呼吸声来源' },
  { label: '承诺/债务', category: 'promise', key: 'promise', linkedCardFields: ['relationshipTension', 'weaknessAndCost'], valueHint: '例如：答应保护某人直到黎明' },
  { label: '能力限制', category: 'ability', key: 'ability_limit', linkedCardFields: ['abilitiesAndResources', 'weaknessAndCost'], valueHint: '例如：右臂能力每次使用后会灼痛' }
]

export function parseStateValue(category: StateFactCategory, raw: string): CharacterStateFact['value'] {
  if (category === 'resource') {
    const value = Number(raw)
    return Number.isFinite(value) ? value : 0
  }
  if (category === 'inventory' || category === 'knowledge') {
    return raw.split(/[,\n，、]/).map((item) => item.trim()).filter(Boolean)
  }
  return raw
}

export function factDisplayValue(fact: CharacterStateFact): string {
  return `${CharacterStateService.formatFactValue(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`
}

export function factEditableValue(fact: CharacterStateFact): string {
  return CharacterStateService.formatFactValue(fact.value)
}
