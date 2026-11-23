import { useId } from 'react'
import type { ChapterTask, Character } from '../../../shared/types'

interface Props {
  task: ChapterTask
  characters?: Pick<Character, 'id' | 'name'>[]
  disabled?: boolean
  onChange: (task: ChapterTask) => void
}

export function ChapterTaskConstraintFields({ task, characters = [], disabled, onChange }: Props) {
  const list = useId()
  const { povPolicy: pov, storyTimeWindow: time } = task
  const weekdays = [...'一二三四五六日'].map(d => '周' + d)
  if (time?.weekday && !weekdays.includes(time.weekday)) weekdays.push(time.weekday)
  function set<K extends 'povPolicy' | 'storyTimeWindow' | 'mustOpenWithBeat'>(key: K, value: ChapterTask[K]) {
    const next = { ...task }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange(next)
  }
  return <>
    <label className="toggle"><input type="checkbox" checked={!!pov} disabled={disabled}
      onChange={e => set('povPolicy', e.target.checked ? { mode: 'third_limited_single', povCharacterId: '', perceptionChannels: ['on_site'] } : undefined)} /> 限定叙事视角</label>
    {pov && <>
      <label className="field"><span className="field-label">视角模式</span><input value={pov.mode} disabled={disabled} onChange={e => set('povPolicy', { ...pov, mode: e.target.value })} /></label>
      <label className="field"><span className="field-label">视角角色 ID</span><input list={list} value={pov.povCharacterId} disabled={disabled}
        onChange={e => set('povPolicy', { ...pov, povCharacterId: e.target.value })} /></label>
      <datalist id={list}>{characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</datalist>
      <label className="field"><span className="field-label">感知渠道（逗号分隔）</span><input value={pov.perceptionChannels.join(',')} disabled={disabled}
        onChange={e => set('povPolicy', { ...pov, perceptionChannels: e.target.value.split(/[,，、]/) })} /></label>
    </>}
    <label className="toggle"><input type="checkbox" checked={!!time} disabled={disabled}
      onChange={e => set('storyTimeWindow', e.target.checked ? { date: '', range: '' } : undefined)} /> 限定故事时间窗</label>
    {time && <>
      <label className="field"><span className="field-label">故事日期</span><input type="date" value={time.date} disabled={disabled} onChange={e => set('storyTimeWindow', { ...time, date: e.target.value })} /></label>
      <label className="field"><span className="field-label">故事星期</span><select value={time.weekday ?? ''} disabled={disabled} onChange={e => set('storyTimeWindow', { ...time, weekday: e.target.value || undefined })}>
        <option value="">未指定</option>{weekdays.map(d => <option key={d}>{d}</option>)}
      </select></label>
      <label className="field"><span className="field-label">起止时间</span><input value={time.range} placeholder="20:57–20:59" disabled={disabled} onChange={e => set('storyTimeWindow', { ...time, range: e.target.value })} /></label>
    </>}
    <label className="field"><span className="field-label">章首动作锚点</span><textarea name="mustOpenWithBeat" rows={2} value={task.mustOpenWithBeat ?? ''} disabled={disabled}
      onChange={e => set('mustOpenWithBeat', e.target.value || undefined)} /></label>
  </>
}
