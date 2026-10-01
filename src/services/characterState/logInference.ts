import type { Chapter, Character, StateFactCategory } from '../../shared/types'
import type { CharacterStateFactDraft } from './stateValue'
import { defaultLinkedCardFields } from './stateValue'

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

function inferLabel(text: string, category: StateFactCategory): string {
  if (category === 'physical') {
    if (text.includes('右手') && text.includes('结晶')) return '右手结晶化'
    if (text.includes('右臂') && text.includes('灼痛')) return '右臂灼痛'
    if (text.includes('右臂')) return '右臂状态'
    if (text.includes('左臂')) return '左臂状态'
    if (text.includes('结晶')) return '身体结晶化'
    if (text.includes('骨裂')) return '骨裂'
    if (text.includes('出血')) return '出血'
    return '伤势/身体状态'
  }
  if (category === 'inventory') return includesAny(text, ['失去', '丢失']) ? '失去物品' : '持有物品'
  if (category === 'knowledge') return '已知信息'
  if (category === 'location') return '当前位置'
  if (category === 'resource') return '资源/余额'
  if (category === 'promise') return '承诺/债务'
  if (category === 'ability') return '能力限制'
  return '状态事实'
}

export function inferFactDraftFromLog(
  logText: string,
  character: Pick<Character, 'id' | 'projectId'>,
  chapter?: Pick<Chapter, 'id' | 'order'> | null
): CharacterStateFactDraft {
  const text = logText.trim()
  let category: StateFactCategory = 'custom'
  if (includesAny(text, ['手臂', '右臂', '左臂', '右手', '左手', '伤', '灼痛', '结晶', '骨裂', '出血', '疲惫'])) category = 'physical'
  else if (includesAny(text, ['持有', '得到', '获得', '失去', '丢失', '钥匙', '地图', '武器'])) category = 'inventory'
  else if (includesAny(text, ['知道', '得知', '发现', '明白', '记起', '秘密'])) category = 'knowledge'
  else if (includesAny(text, ['位置', '到达', '离开', '进入', '抵达'])) category = 'location'
  else if (includesAny(text, ['现金', '钱', '余额', '金币', '花费', '支付', '购买'])) category = 'resource'
  else if (includesAny(text, ['承诺', '答应', '欠', '债', '契约'])) category = 'promise'
  else if (includesAny(text, ['能力', '权限', '冷却', '代价', '无法使用'])) category = 'ability'

  const label = inferLabel(text, category)
  return {
    projectId: character.projectId,
    characterId: character.id,
    category,
    key: label,
    label,
    valueType: 'text',
    value: text,
    unit: '',
    linkedCardFields: defaultLinkedCardFields(category),
    trackingLevel: category === 'custom' ? 'note' : 'hard',
    promptPolicy: category === 'custom' ? 'manual_only' : 'when_relevant',
    status: 'active',
    sourceChapterId: chapter?.id ?? null,
    sourceChapterOrder: chapter?.order ?? null,
    evidence: text,
    confidence: category === 'custom' ? 0.5 : 0.85
  }
}
