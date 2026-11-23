import type { ChapterTask } from '../../shared/types'

export function taskConstraintLines(task: Partial<ChapterTask>, opening: boolean) {
  const { povPolicy: pov, storyTimeWindow: time, mustOpenWithBeat: beat } = task
  return [
    ...(pov ? [`视角边界：${pov.mode}；视角角色 ID：${pov.povCharacterId}；只经以下渠道感知：${pov.perceptionChannels.join('、')}。不得直接描写渠道外的现场或内心。`] : []),
    ...(time ? [`故事时间窗：${[time.date, time.weekday, time.range].filter(Boolean).join(' ')}。本章当下的行动不得跳出此窗。`] : []),
    ...(beat ? [`章首动作锚点：${beat}\n正文前 200 字${opening ? '从这个动作开场，不虚构前章' : '接住上一章末句定格的动作'}；不要求逐字复述。`] : [])
  ]
}

export function taskReviewContext(context: string, task: Partial<ChapterTask> | null | undefined, opening: boolean) {
  const lines = task && taskConstraintLines(task, opening)
  if (!lines?.length) return context
  return [context, ...lines.filter(line => !context.includes(line)),
    '逐项对照本章任务边界与正文。报告越界时引用正文证据；不要因正文未照抄锚点、日期或渠道名而判错。'].join('\n')
}
