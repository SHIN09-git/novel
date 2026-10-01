import type { ChapterGenerationStepType } from '../../../../shared/types'

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

const SKIPPABLE_PIPELINE_STEPS = new Set<ChapterGenerationStepType>([
  'generate_chapter_review',
  'propose_character_updates',
  'propose_foreshadowing_updates',
  'consistency_review'
])

export function canSkipPipelineStep(type: ChapterGenerationStepType): boolean {
  return SKIPPABLE_PIPELINE_STEPS.has(type)
}
