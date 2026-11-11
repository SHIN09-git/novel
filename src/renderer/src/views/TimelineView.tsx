import { useMemo } from 'react'
import type { ID, TimelineEvent } from '../../../shared/types'
import { editTimelineEvent } from '../../../shared/normalizers/timeline'
import { useConfirm } from '../components/ConfirmDialog'
import { EmptyState, Field, NumberInput, TextArea, TextInput, Toggle } from '../components/FormFields'
import { Header } from '../components/Layout'
import { useProjectData } from '../hooks/useProjectData'
import { newId, now } from '../utils/format'
import type { ProjectProps } from './viewTypes'
import { updateProjectTimestamp } from './viewTypes'
import { TimelineTimeEditor } from './TimelineTimeEditor'

export function TimelineView({ data, project, saveData }: ProjectProps) {
  const confirmAction = useConfirm()
  const scoped = useProjectData(data, project.id)
  const events = useMemo(() => [...scoped.timelineEvents].sort((a, b) => a.narrativeOrder - b.narrativeOrder), [scoped.timelineEvents])
  const chapters = useMemo(() => [...scoped.chapters].sort((a, b) => a.order - b.order), [scoped.chapters])
  const chaptersById = useMemo(() => new Map(chapters.map((ch) => [ch.id, ch])), [chapters])

  async function addEvent() {
    const timestamp = now()
    const event: TimelineEvent = {
      id: newId(),
      projectId: project.id,
      title: '新事件',
      chapterOrder: null,
      storyTime: '',
      narrativeOrder: Math.max(0, ...events.map((item) => item.narrativeOrder)) + 1,
      participantCharacterIds: [],
      result: '',
      downstreamImpact: '',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      timelineEvents: [...current.timelineEvents, event]
    }))
  }

  async function updateEvent(id: ID, patch: Partial<TimelineEvent>) {
    return saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      timelineEvents: current.timelineEvents.map((event) => event.id === id && event.projectId === project.id
        ? editTimelineEvent(event, { ...patch, updatedAt: now() }, current.chapters) : event)
    }))
  }

  async function deleteEvent(event: TimelineEvent) {
    const confirmed = await confirmAction({
      title: '删除时间线事件',
      message: `确定删除时间线事件「${event.title}」吗？`,
      confirmLabel: '删除事件',
      tone: 'danger'
    })
    if (!confirmed) return
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      timelineEvents: current.timelineEvents.filter((item) => item.id !== event.id)
    }))
  }

  return (
    <div className="timeline-view">
      <Header title="时间线 / 事件系统" description="用故事内时间和真实叙事顺序防止长篇剧情错位。" actions={<button className="primary-button" onClick={addEvent}>新增事件</button>} />
      <section className="panel timeline-list">
        {events.length === 0 ? (
          <EmptyState title="暂无事件" description="记录关键事件、参与角色、结果和后续影响。" />
        ) : (
          events.map((event) => (
            <article key={event.id} className="timeline-item">
              <div className="timeline-head">
                <TextInput label="事件标题" value={event.title} debounceMs={500} bufferKey={event.id} onChange={(title) => updateEvent(event.id, { title })} />
                <NumberInput label="叙事顺序" value={event.narrativeOrder} onChange={(narrativeOrder) => updateEvent(event.id, { narrativeOrder: narrativeOrder ?? event.narrativeOrder })} />
                <Field label="所属章节">
                  <select value={event.chapterId ?? ''} onChange={(e) => updateEvent(event.id, { chapterId: e.target.value || null })}>
                    <option value="">{event.chapterOrder != null && !event.chapterId ? `第 ${event.chapterOrder} 章（未绑定）` : '未绑定'}</option>
                    {event.chapterId && !chaptersById.has(event.chapterId) && <option value={event.chapterId}>原章节已归档或无法定位</option>}
                    {chapters.map((ch) => <option key={ch.id} value={ch.id}>第 {ch.order} 章 · {ch.title}</option>)}
                  </select>
                </Field>
                {!event.chapterId && <NumberInput label="预留章号" min={1} value={event.chapterOrder} onChange={(chapterOrder) => updateEvent(event.id, { chapterOrder })} />}
              </div>
              <div className="form-grid">
                <TextArea label="故事内时间" value={event.storyTime} rows={2} debounceMs={500} bufferKey={event.id} onChange={(storyTime) => updateEvent(event.id, { storyTime })} />
                <TextArea label="事件结果" value={event.result} rows={2} debounceMs={500} bufferKey={event.id} onChange={(result) => updateEvent(event.id, { result })} />
                <TextArea label="对后续剧情的影响" value={event.downstreamImpact} rows={2} debounceMs={500} bufferKey={event.id} onChange={(downstreamImpact) => updateEvent(event.id, { downstreamImpact })} />
              </div>
              <div className="checkbox-grid">
                {scoped.characters.map((character) => (
                  <Toggle
                    key={character.id}
                    label={character.name}
                    checked={event.participantCharacterIds.includes(character.id)}
                    onChange={(checked) => {
                      const ids = checked
                        ? [...event.participantCharacterIds, character.id]
                        : event.participantCharacterIds.filter((id) => id !== character.id)
                      updateEvent(event.id, { participantCharacterIds: ids })
                    }}
                  />
                ))}
              </div>
              <TimelineTimeEditor event={event} update={(patch) => updateEvent(event.id, patch)} />
              <button className="danger-button" onClick={() => deleteEvent(event)}>
                删除事件
              </button>
            </article>
          ))
        )}
      </section>
    </div>
  )
}
