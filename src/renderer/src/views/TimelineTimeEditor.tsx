import type { TimelineEvent, TimelineTimeFields } from '../../../shared/types'
import { NumberInput, SelectField, TextArea, TextInput } from '../components/FormFields'

export function TimelineTimeEditor({ event, update }: {
  event: TimelineEvent
  update: (patch: TimelineTimeFields) => void
}) {
  const buffered = { debounceMs: 500, bufferKey: event.id }
  return <details>
    <summary>跨章时间核对</summary>
    <div className="form-grid">
      <TextInput label="时间线" placeholder="如：京城主线" value={event.timelineKey ?? ''} {...buffered} onChange={(timelineKey) => update({ timelineKey })} />
      <TextInput label="地点" value={event.location ?? ''} {...buffered} onChange={(location) => update({ location })} />
      <TextInput label="共同计时起点" placeholder="如：城门关闭" value={event.timeAnchor ?? ''} {...buffered} onChange={(timeAnchor) => update({ timeAnchor })} />
      <NumberInput label="距起点已过天数" min={0} value={event.elapsedDays ?? null} onChange={(n) => { if (n === null || Number.isSafeInteger(n) && n >= 0) update({ elapsedDays: n ?? undefined }) }} />
      <SelectField label="季节" value={event.season ?? ''} options={[
        { value: '', label: '未标注' }, { value: 'spring', label: '春' }, { value: 'summer', label: '夏' },
        { value: 'autumn', label: '秋' }, { value: 'winter', label: '冬' }
      ]} onChange={(season) => update({ season: season || undefined })} />
      <TextInput label="截止事项" placeholder="如：本次开闸" value={event.deadlineKey ?? ''} {...buffered} onChange={(deadlineKey) => update({ deadlineKey })} />
      <NumberInput label="距截止剩余天数" min={0} value={event.remainingDays ?? null} onChange={(n) => { if (n === null || Number.isSafeInteger(n) && n >= 0) update({ remainingDays: n ?? undefined }) }} />
      <SelectField label="叙事跳时" value={event.timeShift ?? ''} options={[
        { value: '', label: '未标注' }, { value: 'flashback', label: '闪回' }, { value: 'time_skip', label: '跳时 / 跨季' }
      ]} onChange={(timeShift) => update({ timeShift: timeShift || undefined })} />
      <TextArea label="本章正文原句" value={event.sourceExcerpt ?? ''} rows={2} {...buffered} onChange={(sourceExcerpt) => update({ sourceExcerpt })} />
    </div>
  </details>
}
