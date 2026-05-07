import type { ID, TimelineEvent } from '../../../shared/types'
import { EmptyState, NumberInput, TextArea, Toggle } from '../components/FormFields'
import { Header } from '../components/Layout'
import { newId, now } from '../utils/format'
import { projectData } from '../utils/projectData'
import type { ProjectProps } from './viewTypes'
import { updateProjectTimestamp } from './viewTypes'

export function TimelineView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const events = [...scoped.timelineEvents].sort((a, b) => a.narrativeOrder - b.narrativeOrder)

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
    await saveData({ ...data, projects: updateProjectTimestamp(data, project.id), timelineEvents: [...data.timelineEvents, event] })
  }

  async function updateEvent(id: ID, patch: Partial<TimelineEvent>) {
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      timelineEvents: data.timelineEvents.map((event) => (event.id === id ? { ...event, ...patch, updatedAt: now() } : event))
    })
  }

  async function deleteEvent(event: TimelineEvent) {
    if (!confirm(`确定删除时间线事件「${event.title}」吗？`)) return
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      timelineEvents: data.timelineEvents.filter((item) => item.id !== event.id)
    })
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
                <input value={event.title} onChange={(change) => updateEvent(event.id, { title: change.target.value })} />
                <NumberInput label="叙事顺序" value={event.narrativeOrder} onChange={(narrativeOrder) => updateEvent(event.id, { narrativeOrder: narrativeOrder ?? event.narrativeOrder })} />
                <NumberInput label="所属章节" value={event.chapterOrder} onChange={(chapterOrder) => updateEvent(event.id, { chapterOrder })} />
              </div>
              <div className="form-grid">
                <TextArea label="故事内时间" value={event.storyTime} rows={2} onChange={(storyTime) => updateEvent(event.id, { storyTime })} />
                <TextArea label="事件结果" value={event.result} rows={2} onChange={(result) => updateEvent(event.id, { result })} />
                <TextArea label="对后续剧情的影响" value={event.downstreamImpact} rows={2} onChange={(downstreamImpact) => updateEvent(event.id, { downstreamImpact })} />
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
