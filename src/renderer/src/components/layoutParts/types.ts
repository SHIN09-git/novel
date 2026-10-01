export type View =
  | 'dashboard'
  | 'inbox'
  | 'bible'
  | 'chapters'
  | 'reader'
  | 'characters'
  | 'foreshadowings'
  | 'timeline'
  | 'stages'
  | 'hardCanon'
  | 'direction'
  | 'prompt'
  | 'pipeline'
  | 'revision'
  | 'agentRuns'
  | 'settings'

export const viewLabels: Record<View, string> = {
  dashboard: '工作台',
  inbox: '决策收件箱',
  bible: '小说圣经',
  chapters: '章节',
  reader: '连贯阅读',
  characters: '角色',
  foreshadowings: '伏笔',
  timeline: '时间线',
  stages: '阶段摘要',
  hardCanon: '硬设定包',
  direction: '剧情导向',
  prompt: 'Prompt 构建器',
  pipeline: '生产流水线',
  revision: '修订工作台',
  agentRuns: 'Agent 批次',
  settings: '设置'
}
