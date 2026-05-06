export type View =
  | 'dashboard'
  | 'bible'
  | 'chapters'
  | 'characters'
  | 'foreshadowings'
  | 'timeline'
  | 'stages'
  | 'prompt'
  | 'pipeline'
  | 'revision'
  | 'settings'

export const viewLabels: Record<View, string> = {
  dashboard: '工作台',
  bible: '小说圣经',
  chapters: '章节',
  characters: '角色',
  foreshadowings: '伏笔',
  timeline: '时间线',
  stages: '阶段摘要',
  prompt: 'Prompt 构建器',
  pipeline: '生产流水线',
  revision: '修订工作台',
  settings: '设置'
}

export const viewIcons: Record<View, string> = {
  dashboard: 'D',
  bible: 'B',
  chapters: 'C',
  characters: 'R',
  foreshadowings: 'F',
  timeline: 'T',
  stages: 'S',
  prompt: '#',
  pipeline: 'P',
  revision: 'V',
  settings: 'G'
}
