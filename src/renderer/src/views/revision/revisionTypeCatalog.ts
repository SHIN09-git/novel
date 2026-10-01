import type { QualityGateIssue, RevisionRequestType } from '../../../../shared/types'

export const revisionTypeOptions: Array<{ value: RevisionRequestType; label: string }> = [
  { value: 'reduce_ai_tone', label: '去 AI 味' },
  { value: 'strengthen_conflict', label: '加强冲突' },
  { value: 'polish_style', label: '润色文风' },
  { value: 'improve_dialogue', label: '优化对白' },
  { value: 'compress_pacing', label: '压缩节奏' },
  { value: 'enhance_emotion', label: '增强情绪' },
  { value: 'fix_ooc', label: '修复 OOC' },
  { value: 'fix_continuity', label: '修复连续性' },
  { value: 'fix_worldbuilding', label: '修复设定冲突' },
  { value: 'fix_character_knowledge', label: '修复角色知识越界' },
  { value: 'fix_foreshadowing', label: '修复伏笔误用' },
  { value: 'fix_plot_logic', label: '修复剧情逻辑' },
  { value: 'improve_continuity', label: '加强章节衔接' },
  { value: 'reduce_redundancy', label: '减少冗余' },
  { value: 'compress_description', label: '压缩描写' },
  { value: 'remove_repeated_explanation', label: '删除重复解释' },
  { value: 'strengthen_chapter_transition', label: '强化转场承接' },
  { value: 'rewrite_section', label: '重写局部段落' },
  { value: 'custom', label: '自定义指令' }
]

export const revisionQuickPresets: Array<{
  type: RevisionRequestType
  label: string
  instruction: string
}> = [
  {
    type: 'reduce_ai_tone',
    label: '去 AI 味（白名单）',
    instruction: '按 lieflat-less-ai-tone 白名单做最小改写；保留事实、结构与人物意图，未命中规则的文字原样保留。'
  },
  {
    type: 'improve_dialogue',
    label: '对白更自然',
    instruction: '保留信息量，通过停顿、潜台词和动作反应让对白更像人物本人。'
  },
  {
    type: 'compress_pacing',
    label: '压紧节奏',
    instruction: '删去重复解释和低价值过渡，保留关键动作、冲突升级与情绪转折。'
  },
  {
    type: 'enhance_emotion',
    label: '增强情绪',
    instruction: '不改变剧情事实，通过动作、感官和选择的代价增强情绪张力。'
  }
]

export function revisionVersionStatusLabel(status: string): string {
  if (status === 'pending') return '待确认'
  if (status === 'draft') return '可编辑'
  if (status === 'accepted') return '已接受'
  if (status === 'rejected') return '已拒绝'
  if (status === 'superseded') return '历史版本'
  return status
}

export function revisionTypeName(type: RevisionRequestType): string {
  return revisionTypeOptions.find((option) => option.value === type)?.label ?? '修订'
}

export function issueToRevisionType(issue: QualityGateIssue): RevisionRequestType {
  const text = `${issue.type} ${issue.description}`.toLowerCase()
  if (text.includes('continuity') || text.includes('transition') || text.includes('衔接') || text.includes('承接')) return 'improve_continuity'
  if (text.includes('redundancy') || text.includes('repeated') || text.includes('重复') || text.includes('冗余')) return 'reduce_redundancy'
  if (text.includes('description') || text.includes('描写')) return 'compress_description'
  if (text.includes('explanation') || text.includes('解释')) return 'remove_repeated_explanation'
  if (text.includes('ooc') || text.includes('character') || text.includes('角色')) return 'fix_ooc'
  if (text.includes('foreshadow') || text.includes('伏笔')) return 'fix_foreshadowing'
  if (text.includes('pacing') || text.includes('节奏') || text.includes('拖')) return 'compress_pacing'
  if (text.includes('dialogue') || text.includes('对白')) return 'improve_dialogue'
  if (text.includes('ai') || text.includes('套话') || text.includes('style') || text.includes('文风')) return 'reduce_ai_tone'
  return 'custom'
}
