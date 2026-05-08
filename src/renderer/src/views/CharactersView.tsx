import { useEffect, useState } from 'react'
import type { Character, CharacterStateLog, ID } from '../../../shared/types'
import { useConfirm } from '../components/ConfirmDialog'
import { EmptyState, NumberInput, TextArea, TextInput, Toggle } from '../components/FormFields'
import { Header } from '../components/Layout'
import { StatusBadge } from '../components/UI'
import { formatDate, newId, now } from '../utils/format'
import { projectData } from '../utils/projectData'
import type { ProjectProps } from './viewTypes'
import { updateProjectTimestamp } from './viewTypes'

export function CharactersView({ data, project, saveData }: ProjectProps) {
  const confirmAction = useConfirm()
  const scoped = projectData(data, project.id)
  const characters = [...scoped.characters].sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name))
  const chapters = [...scoped.chapters].sort((a, b) => a.order - b.order)
  const [selectedId, setSelectedId] = useState<ID | null>(characters[0]?.id ?? null)
  const [logNote, setLogNote] = useState('')
  const [logChapter, setLogChapter] = useState<number | null>(chapters.at(-1)?.order ?? null)
  const selected = characters.find((character) => character.id === selectedId) ?? characters[0] ?? null
  const logs = scoped.characterStateLogs
    .filter((log) => log.characterId === selected?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  useEffect(() => {
    if (!selectedId && characters[0]) setSelectedId(characters[0].id)
  }, [characters, selectedId])

  async function addCharacter() {
    const timestamp = now()
    const character: Character = {
      id: newId(),
      projectId: project.id,
      name: '新角色',
      role: '',
      surfaceGoal: '',
      deepDesire: '',
      coreFear: '',
      selfDeception: '',
      knownInformation: '',
      unknownInformation: '',
      protagonistRelationship: '',
      emotionalState: '',
      nextActionTendency: '',
      forbiddenWriting: '',
      lastChangedChapter: null,
      isMain: false,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      characters: [...current.characters, character]
    }))
    setSelectedId(character.id)
  }

  async function updateCharacter(id: ID, patch: Partial<Character>) {
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      characters: current.characters.map((character) => (character.id === id ? { ...character, ...patch, updatedAt: now() } : character))
    }))
  }

  async function deleteCharacter(character: Character) {
    const confirmed = await confirmAction({
      title: '删除角色',
      message: `确定删除角色「${character.name}」吗？相关伏笔和时间线中的角色引用会被移除。`,
      confirmLabel: '删除角色',
      tone: 'danger'
    })
    if (!confirmed) return
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      characters: current.characters.filter((item) => item.id !== character.id),
      characterStateLogs: current.characterStateLogs.filter((log) => log.characterId !== character.id),
      foreshadowings: current.foreshadowings.map((item) => ({
        ...item,
        relatedCharacterIds: item.relatedCharacterIds.filter((id) => id !== character.id)
      })),
      timelineEvents: current.timelineEvents.map((event) => ({
        ...event,
        participantCharacterIds: event.participantCharacterIds.filter((id) => id !== character.id)
      }))
    }))
    setSelectedId(null)
  }

  async function addStateLog(character: Character) {
    if (!logNote.trim()) return
    const chapter = chapters.find((item) => item.order === logChapter)
    const log: CharacterStateLog = {
      id: newId(),
      projectId: project.id,
      characterId: character.id,
      chapterId: chapter?.id ?? null,
      chapterOrder: logChapter,
      note: logNote,
      createdAt: now()
    }
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      characterStateLogs: [...current.characterStateLogs, log],
      characters: current.characters.map((item) =>
        item.id === character.id ? { ...item, lastChangedChapter: logChapter, updatedAt: now() } : item
      )
    }))
    setLogNote('')
  }

  return (
    <div className="characters-view">
      <Header
        title="角色卡系统"
        description="角色卡记录当前戏剧状态，Prompt 默认只引入主要角色和当前相关角色。"
        actions={<button className="primary-button" onClick={addCharacter}>新增角色</button>}
      />
      <section className="split-layout characters-workbench">
        <aside className="list-pane">
          <div className="chapter-shelf-header">
            <span>角色</span>
            <strong>{characters.length}</strong>
          </div>
          {characters.map((character) => (
            <button key={character.id} className={character.id === selected?.id ? 'list-item active' : 'list-item'} onClick={() => setSelectedId(character.id)}>
              <strong>{character.name}</strong>
              <span>{character.role || '未设置定位'}</span>
              <small>{character.isMain ? '主要角色' : '次要角色'} · {character.emotionalState || '情绪待补'}</small>
            </button>
          ))}
        </aside>
        <div className="editor-pane">
          {!selected ? (
            <EmptyState title="暂无角色" description="创建角色卡后，把基础设定和当前状态分区维护。" />
          ) : (
            <>
              <div className="panel character-focus-card">
                <div>
                  <span className="chapter-kicker">Current Dramatic State</span>
                  <h2>{selected.name}</h2>
                  <p>{selected.role || '未设置角色定位'}</p>
                </div>
                <div className="character-state-grid">
                  <article>
                    <span>深层欲望</span>
                    <strong>{selected.deepDesire || '待补充'}</strong>
                  </article>
                  <article>
                    <span>核心恐惧</span>
                    <strong>{selected.coreFear || '待补充'}</strong>
                  </article>
                  <article>
                    <span>关系状态</span>
                    <strong>{selected.protagonistRelationship || '待补充'}</strong>
                  </article>
                </div>
                <div className="row-actions">
                  <StatusBadge tone={selected.isMain ? 'accent' : 'neutral'}>{selected.isMain ? '主要角色' : '次要角色'}</StatusBadge>
                  {selected.lastChangedChapter ? <StatusBadge tone="info">最近变化第 {selected.lastChangedChapter} 章</StatusBadge> : null}
                </div>
              </div>
              <div className="panel">
                <h2>基础设定</h2>
                <div className="form-grid compact">
                  <TextInput label="角色名" value={selected.name} onChange={(name) => updateCharacter(selected.id, { name })} />
                  <TextInput label="角色定位" value={selected.role} onChange={(role) => updateCharacter(selected.id, { role })} />
                </div>
                <div className="form-grid">
                  <TextArea label="表层目标" value={selected.surfaceGoal} onChange={(surfaceGoal) => updateCharacter(selected.id, { surfaceGoal })} />
                  <TextArea label="深层欲望" value={selected.deepDesire} onChange={(deepDesire) => updateCharacter(selected.id, { deepDesire })} />
                  <TextArea label="核心恐惧" value={selected.coreFear} onChange={(coreFear) => updateCharacter(selected.id, { coreFear })} />
                  <TextArea label="自我欺骗" value={selected.selfDeception} onChange={(selfDeception) => updateCharacter(selected.id, { selfDeception })} />
                  <TextArea label="禁止写法" value={selected.forbiddenWriting} onChange={(forbiddenWriting) => updateCharacter(selected.id, { forbiddenWriting })} />
                </div>
                <div className="row-actions">
                  <Toggle label="主要角色" checked={selected.isMain} onChange={(isMain) => updateCharacter(selected.id, { isMain })} />
                  <button className="danger-button" onClick={() => deleteCharacter(selected)}>
                    删除角色
                  </button>
                </div>
              </div>
              <div className="panel">
                <h2>当前状态</h2>
                <div className="form-grid">
                  <TextArea label="当前知道的信息" value={selected.knownInformation} onChange={(knownInformation) => updateCharacter(selected.id, { knownInformation })} />
                  <TextArea label="当前不知道的信息" value={selected.unknownInformation} onChange={(unknownInformation) => updateCharacter(selected.id, { unknownInformation })} />
                  <TextArea label="与主角关系状态" value={selected.protagonistRelationship} onChange={(protagonistRelationship) => updateCharacter(selected.id, { protagonistRelationship })} />
                  <TextArea label="当前情绪状态" value={selected.emotionalState} onChange={(emotionalState) => updateCharacter(selected.id, { emotionalState })} />
                  <TextArea label="下一阶段行为倾向" value={selected.nextActionTendency} onChange={(nextActionTendency) => updateCharacter(selected.id, { nextActionTendency })} />
                  <NumberInput label="最近一次变化发生章节" value={selected.lastChangedChapter} onChange={(lastChangedChapter) => updateCharacter(selected.id, { lastChangedChapter })} />
                </div>
              </div>
              <div className="panel character-log-panel">
                <h2>角色状态更新记录</h2>
                <div className="inline-form">
                  <select value={logChapter ?? ''} onChange={(event) => setLogChapter(event.target.value ? Number(event.target.value) : null)}>
                    <option value="">未关联章节</option>
                    {chapters.map((chapter) => (
                      <option key={chapter.id} value={chapter.order}>
                        第 {chapter.order} 章
                      </option>
                    ))}
                  </select>
                  <input value={logNote} placeholder="记录这次状态变化" onChange={(event) => setLogNote(event.target.value)} />
                  <button className="primary-button" onClick={() => addStateLog(selected)}>
                    记录
                  </button>
                </div>
                <div className="log-list">
                  {logs.map((log) => (
                    <article key={log.id}>
                      <strong>{log.chapterOrder ? `第 ${log.chapterOrder} 章` : '未关联章节'}</strong>
                      <p>{log.note}</p>
                      <small>{formatDate(log.createdAt)}</small>
                    </article>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
