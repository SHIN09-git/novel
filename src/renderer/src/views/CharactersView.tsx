import { useEffect, useState } from 'react'
import type {
  Character,
  CharacterCardField,
  CharacterStateChangeCandidate,
  CharacterStateFact,
  CharacterStateLog,
  ID,
  StateFactCategory
} from '../../../shared/types'
import { CharacterStateService, type CharacterStateFactDraft } from '../../../services/CharacterStateService'
import { useConfirm } from '../components/ConfirmDialog'
import { EmptyState, NumberInput, SelectField, TextArea, TextInput, Toggle } from '../components/FormFields'
import { Header } from '../components/Layout'
import { StatusBadge } from '../components/UI'
import { formatDate, newId, now } from '../utils/format'
import { projectData } from '../utils/projectData'
import type { ProjectProps } from './viewTypes'
import { updateProjectTimestamp } from './viewTypes'

const CARD_FIELD_LABELS: Record<CharacterCardField, string> = {
  roleFunction: '角色定位',
  surfaceGoal: '表层目标',
  deepNeed: '深层需求',
  coreFear: '核心恐惧',
  decisionLogic: '行动逻辑',
  abilitiesAndResources: '能力与资源',
  weaknessAndCost: '弱点与代价',
  relationshipTension: '关系张力',
  futureHooks: '后续钩子'
}

const STATE_CATEGORY_OPTIONS: Array<{ value: StateFactCategory; label: string }> = [
  { value: 'resource', label: '资源/余额' },
  { value: 'inventory', label: '持有物品' },
  { value: 'location', label: '当前位置' },
  { value: 'physical', label: '伤势/身体' },
  { value: 'knowledge', label: '已知秘密' },
  { value: 'relationship', label: '关系状态' },
  { value: 'promise', label: '承诺/债务' },
  { value: 'ability', label: '能力限制' },
  { value: 'status', label: '当前目标/状态' },
  { value: 'custom', label: '自定义' }
]

const STATE_TEMPLATES: Array<{ label: string; category: StateFactCategory; key: string; linkedCardFields: CharacterCardField[]; valueHint: string }> = [
  { label: '现金余额', category: 'resource', key: 'cash', linkedCardFields: ['abilitiesAndResources'], valueHint: '例如：5000' },
  { label: '持有物品', category: 'inventory', key: 'inventory', linkedCardFields: ['abilitiesAndResources'], valueHint: '例如：黑色钥匙、旧地图' },
  { label: '当前位置', category: 'location', key: 'location', linkedCardFields: ['surfaceGoal'], valueHint: '例如：倒悬都市押解通道尽头' },
  { label: '伤势/身体状态', category: 'physical', key: 'injury', linkedCardFields: ['weaknessAndCost', 'abilitiesAndResources'], valueHint: '例如：右臂灼痛，不能长时间挥剑' },
  { label: '已知秘密', category: 'knowledge', key: 'known_secret', linkedCardFields: ['abilitiesAndResources', 'relationshipTension'], valueHint: '例如：知道第一代牺牲品与自己同脸' },
  { label: '当前目标', category: 'status', key: 'current_goal', linkedCardFields: ['surfaceGoal'], valueHint: '例如：找到呼吸声来源' },
  { label: '承诺/债务', category: 'promise', key: 'promise', linkedCardFields: ['relationshipTension', 'weaknessAndCost'], valueHint: '例如：答应保护某人直到黎明' },
  { label: '能力限制', category: 'ability', key: 'ability_limit', linkedCardFields: ['abilitiesAndResources', 'weaknessAndCost'], valueHint: '例如：右臂能力每次使用后会灼痛' }
]

function parseStateValue(category: StateFactCategory, raw: string): CharacterStateFact['value'] {
  if (category === 'resource') {
    const value = Number(raw)
    return Number.isFinite(value) ? value : 0
  }
  if (category === 'inventory' || category === 'knowledge') {
    return raw.split(/[,\n，、]/).map((item) => item.trim()).filter(Boolean)
  }
  return raw
}

function factDisplayValue(fact: CharacterStateFact): string {
  return `${CharacterStateService.formatFactValue(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`
}

type LogSaveMode = 'log_only' | 'fact' | 'candidate'

export function CharactersView({ data, project, saveData }: ProjectProps) {
  const confirmAction = useConfirm()
  const scoped = projectData(data, project.id)
  const characters = [...scoped.characters].sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name))
  const chapters = [...scoped.chapters].sort((a, b) => a.order - b.order)
  const [selectedId, setSelectedId] = useState<ID | null>(characters[0]?.id ?? null)
  const [logNote, setLogNote] = useState('')
  const [logChapter, setLogChapter] = useState<number | null>(chapters.at(-1)?.order ?? null)
  const [logSaveMode, setLogSaveMode] = useState<LogSaveMode>('log_only')
  const [conversionLogId, setConversionLogId] = useState<ID | null>(null)
  const [conversionDraft, setConversionDraft] = useState<CharacterStateFactDraft | null>(null)
  const selected = characters.find((character) => character.id === selectedId) ?? characters[0] ?? null
  const stateFacts = scoped.characterStateFacts
    .filter((fact) => fact.characterId === selected?.id && fact.status === 'active')
    .sort((a, b) => a.label.localeCompare(b.label))
  const stateCandidates = scoped.characterStateChangeCandidates
    .filter((candidate) => candidate.characterId === selected?.id && candidate.status === 'pending')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const logs = scoped.characterStateLogs
    .filter((log) => log.characterId === selected?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const [factTemplate, setFactTemplate] = useState(STATE_TEMPLATES[0].key)
  const [factLabel, setFactLabel] = useState(STATE_TEMPLATES[0].label)
  const [factCategory, setFactCategory] = useState<StateFactCategory>(STATE_TEMPLATES[0].category)
  const [factValue, setFactValue] = useState('')

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
      characterStateFacts: current.characterStateFacts.filter((fact) => fact.characterId !== character.id),
      characterStateTransactions: current.characterStateTransactions.filter((transaction) => transaction.characterId !== character.id),
      characterStateChangeCandidates: current.characterStateChangeCandidates.filter((candidate) => candidate.characterId !== character.id),
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

  function chapterForOrder(order: number | null) {
    return order === null ? null : chapters.find((item) => item.order === order) ?? null
  }

  function inferLogDraft(character: Character, note: string, chapterOrder: number | null): CharacterStateFactDraft {
    return CharacterStateService.inferFactDraftFromLog(note, character, chapterForOrder(chapterOrder))
  }

  function beginConvertLog(character: Character, log: CharacterStateLog) {
    setConversionLogId(log.id)
    setConversionDraft(inferLogDraft(character, log.note, log.chapterOrder))
  }

  function patchConversionDraft(patch: Partial<CharacterStateFactDraft>) {
    setConversionDraft((draft) => (draft ? { ...draft, ...patch } : draft))
  }

  async function addStateLog(character: Character) {
    if (!logNote.trim()) return
    const chapter = chapters.find((item) => item.order === logChapter)
    const timestamp = now()
    const log: CharacterStateLog = {
      id: newId(),
      projectId: project.id,
      characterId: character.id,
      chapterId: chapter?.id ?? null,
      chapterOrder: logChapter,
      note: logNote,
      linkedFactId: null,
      linkedCandidateId: null,
      convertedAt: null,
      createdAt: timestamp
    }
    await saveData((current) => {
      let next = {
        ...current,
        projects: updateProjectTimestamp(current, project.id),
        characterStateLogs: [...current.characterStateLogs, log],
        characters: current.characters.map((item) =>
          item.id === character.id ? { ...item, lastChangedChapter: logChapter, updatedAt: timestamp } : item
        )
      }
      const draft = inferLogDraft(character, log.note, log.chapterOrder)
      if (logSaveMode === 'fact') next = CharacterStateService.createFactFromLog(log, draft, next)
      if (logSaveMode === 'candidate') next = CharacterStateService.createCandidateFromLog(log, draft, next)
      return next
    })
    setLogNote('')
  }

  function chooseStateTemplate(key: string) {
    const template = STATE_TEMPLATES.find((item) => item.key === key) ?? STATE_TEMPLATES[0]
    setFactTemplate(template.key)
    setFactLabel(template.label)
    setFactCategory(template.category)
    setFactValue('')
  }

  async function addStateFact(character: Character) {
    if (!factLabel.trim()) return
    const template = STATE_TEMPLATES.find((item) => item.key === factTemplate) ?? STATE_TEMPLATES[0]
    const timestamp = now()
    const parsedValue = parseStateValue(factCategory, factValue)
    const factInput: Partial<CharacterStateFact> & { projectId: ID; characterId: ID; label: string } = {
      projectId: project.id,
      characterId: character.id,
      category: factCategory,
      key: template.key,
      label: factLabel.trim(),
      value: parsedValue,
      valueType: Array.isArray(parsedValue) ? 'list' : typeof parsedValue === 'number' ? 'number' : 'text',
      linkedCardFields: template.linkedCardFields,
      trackingLevel: factCategory === 'status' || factCategory === 'relationship' ? 'soft' : 'hard',
      promptPolicy: 'when_relevant',
      status: 'active',
      confidence: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData((current) => CharacterStateService.createOrUpdateFact(factInput, {
      ...current,
      projects: updateProjectTimestamp(current, project.id)
    }))
    setFactValue('')
  }

  async function convertLogToFact(log: CharacterStateLog) {
    if (!selected) return
    const draft = conversionLogId === log.id && conversionDraft ? conversionDraft : inferLogDraft(selected, log.note, log.chapterOrder)
    await saveData((current) => ({
      ...CharacterStateService.createFactFromLog(log, draft, current),
      projects: updateProjectTimestamp(current, project.id)
    }))
    setConversionLogId(null)
    setConversionDraft(null)
  }

  async function convertLogToCandidate(log: CharacterStateLog) {
    if (!selected) return
    const draft = conversionLogId === log.id && conversionDraft ? conversionDraft : inferLogDraft(selected, log.note, log.chapterOrder)
    await saveData((current) => ({
      ...CharacterStateService.createCandidateFromLog(log, draft, current),
      projects: updateProjectTimestamp(current, project.id)
    }))
    setConversionLogId(null)
    setConversionDraft(null)
  }

  async function updateStateFactValue(fact: CharacterStateFact, raw: string) {
    await saveData((current) =>
      CharacterStateService.createOrUpdateFact(
        {
          ...fact,
          value: parseStateValue(fact.category, raw),
          projectId: project.id,
          characterId: fact.characterId,
          label: fact.label
        },
        {
          ...current,
          projects: updateProjectTimestamp(current, project.id)
        }
      )
    )
  }

  async function archiveStateFact(fact: CharacterStateFact) {
    await saveData((current) =>
      CharacterStateService.createOrUpdateFact(
        { ...fact, status: 'inactive', projectId: project.id, characterId: fact.characterId, label: fact.label },
        {
          ...current,
          projects: updateProjectTimestamp(current, project.id)
        }
      )
    )
  }

  async function updateStateFactLinkedFields(fact: CharacterStateFact, field: CharacterCardField, enabled: boolean) {
    const linkedCardFields = enabled
      ? [...new Set([...fact.linkedCardFields, field])]
      : fact.linkedCardFields.filter((item) => item !== field)
    await saveData((current) =>
      CharacterStateService.createOrUpdateFact(
        { ...fact, linkedCardFields, projectId: project.id, characterId: fact.characterId, label: fact.label },
        {
          ...current,
          projects: updateProjectTimestamp(current, project.id)
        }
      )
    )
  }

  async function applyStateCandidate(candidate: CharacterStateChangeCandidate) {
    await saveData((current) => ({
      ...CharacterStateService.applyStateChangeCandidate(candidate.id, current),
      projects: updateProjectTimestamp(current, project.id)
    }))
  }

  async function rejectStateCandidate(candidate: CharacterStateChangeCandidate) {
    await saveData((current) => CharacterStateService.rejectStateChangeCandidate(candidate.id, current))
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
              <div className="panel character-state-ledger-panel">
                <h2>动态状态账本</h2>
                <p className="muted">只记录会导致硬伤的状态：钱、物品、位置、伤势、知识、承诺和能力限制。AI 候选必须确认后才写入。</p>
                <div className="form-grid compact">
                  <SelectField
                    label="常用模板"
                    value={factTemplate}
                    options={STATE_TEMPLATES.map((template) => ({ value: template.key, label: template.label }))}
                    onChange={chooseStateTemplate}
                  />
                  <SelectField label="类别" value={factCategory} options={STATE_CATEGORY_OPTIONS} onChange={setFactCategory} />
                  <TextInput label="状态名称" value={factLabel} onChange={setFactLabel} />
                  <TextInput
                    label="状态值"
                    value={factValue}
                    placeholder={STATE_TEMPLATES.find((item) => item.key === factTemplate)?.valueHint}
                    onChange={setFactValue}
                  />
                </div>
                <button className="primary-button" onClick={() => addStateFact(selected)}>
                  新增状态事实
                </button>
                <div className="state-ledger-groups">
                  {Object.entries(CARD_FIELD_LABELS).map(([field, label]) => {
                    const facts = stateFacts.filter((fact) => fact.linkedCardFields.includes(field as CharacterCardField))
                    if (!facts.length) return null
                    return (
                      <section key={field} className="state-ledger-group">
                        <h3>{label}</h3>
                        {facts.map((fact) => (
                          <article key={fact.id} className="state-fact-card">
                            <div>
                              <strong>{fact.label}</strong>
                              <span>{factDisplayValue(fact)}</span>
                              <small>
                                {fact.trackingLevel} · {fact.category} · {fact.promptPolicy}
                              </small>
                              <small>
                                来源：{fact.sourceChapterOrder ? `第 ${fact.sourceChapterOrder} 章` : '手动/未关联章节'}
                                {fact.evidence ? ` · 证据：${fact.evidence}` : ''}
                              </small>
                              <details className="state-link-editor">
                                <summary>修改挂接字段</summary>
                                <div className="checkbox-grid">
                                  {Object.entries(CARD_FIELD_LABELS).map(([fieldKey, fieldLabel]) => (
                                    <label key={fieldKey}>
                                      <input
                                        type="checkbox"
                                        checked={fact.linkedCardFields.includes(fieldKey as CharacterCardField)}
                                        onChange={(event) => updateStateFactLinkedFields(fact, fieldKey as CharacterCardField, event.target.checked)}
                                      />
                                      {fieldLabel}
                                    </label>
                                  ))}
                                </div>
                              </details>
                            </div>
                            <input value={factDisplayValue(fact)} onChange={(event) => updateStateFactValue(fact, event.target.value)} />
                            <button className="ghost-button" onClick={() => archiveStateFact(fact)}>
                              归档
                            </button>
                          </article>
                        ))}
                      </section>
                    )
                  })}
                  {stateFacts.length === 0 ? <p className="muted">暂无动态状态。建议先添加现金、持有物品、当前位置或伤势。</p> : null}
                  {stateFacts.filter((fact) => fact.linkedCardFields.length === 0).length > 0 ? (
                    <section className="state-ledger-group">
                      <h3>未归类状态</h3>
                      {stateFacts.filter((fact) => fact.linkedCardFields.length === 0).map((fact) => (
                        <article key={fact.id} className="state-fact-card">
                          <div>
                            <strong>{fact.label}</strong>
                            <span>{factDisplayValue(fact)}</span>
                            <small>
                              {fact.trackingLevel} · {fact.category} · {fact.promptPolicy}
                            </small>
                            <small>
                              来源：{fact.sourceChapterOrder ? `第 ${fact.sourceChapterOrder} 章` : '手动/未关联章节'}
                              {fact.evidence ? ` · 证据：${fact.evidence}` : ''}
                            </small>
                            <details className="state-link-editor">
                              <summary>修改挂接字段</summary>
                              <div className="checkbox-grid">
                                {Object.entries(CARD_FIELD_LABELS).map(([fieldKey, fieldLabel]) => (
                                  <label key={fieldKey}>
                                    <input
                                      type="checkbox"
                                      checked={fact.linkedCardFields.includes(fieldKey as CharacterCardField)}
                                      onChange={(event) => updateStateFactLinkedFields(fact, fieldKey as CharacterCardField, event.target.checked)}
                                    />
                                    {fieldLabel}
                                  </label>
                                ))}
                              </div>
                            </details>
                          </div>
                          <input value={factDisplayValue(fact)} onChange={(event) => updateStateFactValue(fact, event.target.value)} />
                          <button className="ghost-button" onClick={() => archiveStateFact(fact)}>
                            归档
                          </button>
                        </article>
                      ))}
                    </section>
                  ) : null}
                </div>
                {stateCandidates.length > 0 ? (
                  <div className="candidate-list">
                    <h3>待确认状态变化候选</h3>
                    {stateCandidates.map((candidate) => (
                      <article key={candidate.id} className="candidate-card">
                        <strong>{candidate.proposedFact?.label || candidate.proposedTransaction?.reason || '状态变化候选'}</strong>
                        <p>{candidate.evidence || '暂无证据文本'}</p>
                        <p>
                          {String(candidate.beforeValue ?? '未记录')} → {String(candidate.afterValue ?? candidate.proposedFact?.value ?? '未记录')}
                        </p>
                        <div className="row-actions">
                          <button className="primary-button" onClick={() => applyStateCandidate(candidate)}>
                            接受
                          </button>
                          <button className="ghost-button" onClick={() => rejectStateCandidate(candidate)}>
                            拒绝
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="panel character-log-panel">
                <h2>状态日志 / 历史记录</h2>
                <p className="muted">日志只记录一次状态变化，不会自动进入动态状态账本；需要选择同步入账，或在日志卡片上点击“转为状态事实 / 转为候选”。</p>
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
                  <select value={logSaveMode} onChange={(event) => setLogSaveMode(event.target.value as LogSaveMode)}>
                    <option value="log_only">仅记录日志</option>
                    <option value="fact">同步写入动态状态账本</option>
                    <option value="candidate">创建待确认候选</option>
                  </select>
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
                      {log.linkedFactId ? <StatusBadge tone="success">已转入账本：{log.linkedFactId}</StatusBadge> : null}
                      {log.linkedCandidateId ? <StatusBadge tone="info">已转为候选：{log.linkedCandidateId}</StatusBadge> : null}
                      {!log.linkedFactId && !log.linkedCandidateId ? (
                        <div className="row-actions">
                          <button className="ghost-button" onClick={() => beginConvertLog(selected, log)}>
                            转为状态事实
                          </button>
                          <button className="ghost-button" onClick={() => convertLogToCandidate(log)}>
                            转为候选
                          </button>
                        </div>
                      ) : null}
                      {conversionLogId === log.id && conversionDraft ? (
                        <div className="state-log-conversion-form">
                          <div className="form-grid compact">
                            <TextInput label="状态名称" value={conversionDraft.label} onChange={(label) => patchConversionDraft({ label, key: label })} />
                            <SelectField
                              label="类别"
                              value={conversionDraft.category ?? 'custom'}
                              options={STATE_CATEGORY_OPTIONS}
                              onChange={(category) =>
                                patchConversionDraft({
                                  category,
                                  linkedCardFields: CharacterStateService.getDefaultLinkedCardFieldsForCategory(category)
                                })
                              }
                            />
                            <TextInput label="状态值" value={String(conversionDraft.value ?? '')} onChange={(value) => patchConversionDraft({ value, valueType: 'text' })} />
                            <SelectField
                              label="追踪等级"
                              value={conversionDraft.trackingLevel ?? 'hard'}
                              options={[
                                { value: 'hard', label: 'hard' },
                                { value: 'soft', label: 'soft' },
                                { value: 'note', label: 'note' }
                              ]}
                              onChange={(trackingLevel) => patchConversionDraft({ trackingLevel })}
                            />
                            <SelectField
                              label="Prompt 策略"
                              value={conversionDraft.promptPolicy ?? 'when_relevant'}
                              options={[
                                { value: 'always', label: 'always' },
                                { value: 'when_relevant', label: 'when_relevant' },
                                { value: 'manual_only', label: 'manual_only' }
                              ]}
                              onChange={(promptPolicy) => patchConversionDraft({ promptPolicy })}
                            />
                          </div>
                          <div className="checkbox-grid">
                            {Object.entries(CARD_FIELD_LABELS).map(([fieldKey, fieldLabel]) => (
                              <label key={fieldKey}>
                                <input
                                  type="checkbox"
                                  checked={(conversionDraft.linkedCardFields ?? []).includes(fieldKey as CharacterCardField)}
                                  onChange={(event) => {
                                    const currentFields = conversionDraft.linkedCardFields ?? []
                                    patchConversionDraft({
                                      linkedCardFields: event.target.checked
                                        ? [...new Set([...currentFields, fieldKey as CharacterCardField])]
                                        : currentFields.filter((field) => field !== fieldKey)
                                    })
                                  }}
                                />
                                {fieldLabel}
                              </label>
                            ))}
                          </div>
                          <div className="row-actions">
                            <button className="primary-button" onClick={() => convertLogToFact(log)}>
                              确认转入账本
                            </button>
                            <button className="ghost-button" onClick={() => {
                              setConversionLogId(null)
                              setConversionDraft(null)
                            }}>
                              取消
                            </button>
                          </div>
                        </div>
                      ) : null}
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
