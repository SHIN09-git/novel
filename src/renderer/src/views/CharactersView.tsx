import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type {
  Character,
  CharacterCardField,
  CharacterStateChangeCandidate,
  CharacterStateFact,
  CharacterStateLog,
  ID
} from '../../../shared/types'
import { CharacterStateService, type CharacterStateFactDraft } from '../../../services/CharacterStateService'
import { useConfirm } from '../components/ConfirmDialog'
import { EmptyState } from '../components/FormFields'
import { Header } from '../components/Layout'
import { useProjectData } from '../hooks/useProjectData'
import { newId, now } from '../utils/format'
import { CharacterFocusCard } from './characters/CharacterFocusCard'
import { CharacterListPane } from './characters/CharacterListPane'
import { CharacterProfilePanels } from './characters/CharacterProfilePanels'
import { CharacterStateLedgerPanel } from './characters/CharacterStateLedgerPanel'
import { CharacterStateLogPanel } from './characters/CharacterStateLogPanel'
import { CharacterWorkspaceTabs, type CharacterWorkspaceTab } from './characters/CharacterWorkspaceTabs'
import { STATE_TEMPLATES, parseStateValue } from './characters/characterStateUi'
import { useCharacterWorkspaceDraft } from './characters/useCharacterWorkspaceDraft'
import type { ProjectProps } from './viewTypes'
import { updateProjectTimestamp } from './viewTypes'

export function CharactersView({ data, project, saveData }: ProjectProps) {
  const confirmAction = useConfirm()
  const scoped = useProjectData(data, project.id)
  const characters = useMemo(
    () => [...scoped.characters].sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name)),
    [scoped.characters]
  )
  const chapters = useMemo(() => [...scoped.chapters].sort((a, b) => a.order - b.order), [scoped.chapters])
  const [selectedId, setSelectedId] = useState<ID | null>(characters[0]?.id ?? null)
  const [activeTab, setActiveTab] = useState<CharacterWorkspaceTab>('profile')
  const selected = useMemo(
    () => characters.find((character) => character.id === selectedId) ?? characters[0] ?? null,
    [characters, selectedId]
  )
  const selectedCharacterId = selected?.id ?? null
  const workspace = useCharacterWorkspaceDraft(project.id, selectedCharacterId, chapters.at(-1)?.order ?? null)
  const { note: logNote, chapter: logChapter, mode: logSaveMode } = workspace.forms.log
  const { logId: conversionLogId, draft: conversionDraft } = workspace.forms.conversion
  const { template: factTemplate, label: factLabel, category: factCategory, value: factValue } = workspace.forms.fact
  const stateFacts = useMemo(
    () =>
      scoped.characterStateFacts
        .filter((fact) => fact.characterId === selectedCharacterId && fact.status === 'active')
        .sort((a, b) => a.label.localeCompare(b.label)),
    [scoped.characterStateFacts, selectedCharacterId]
  )
  const stateCandidates = useMemo(
    () =>
      scoped.characterStateChangeCandidates
        .filter((candidate) => candidate.characterId === selectedCharacterId && candidate.status === 'pending')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [scoped.characterStateChangeCandidates, selectedCharacterId]
  )
  const logs = useMemo(
    () =>
      scoped.characterStateLogs
        .filter((log) => log.characterId === selectedCharacterId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [scoped.characterStateLogs, selectedCharacterId]
  )

  useEffect(() => {
    if (!selectedId && characters[0]) setSelectedId(characters[0].id)
    if (selectedId && !characters.some((character) => character.id === selectedId)) {
      setSelectedId(characters[0]?.id ?? null)
    }
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
      roleFunction: '',
      deepNeed: '',
      decisionLogic: '',
      abilitiesAndResources: '',
      weaknessAndCost: '',
      relationshipTension: '',
      futureHooks: '',
      lastChangedChapter: null,
      isMain: false,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const saved = await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      characters: [...current.characters, character]
    }))
    if (!saved.ok) return
    setSelectedId(character.id)
  }

  async function updateCharacter(id: ID, patch: Partial<Character>) {
    return saveData((current) => ({
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
    const saved = await saveData((current) => ({
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
    if (!saved.ok) return
    setSelectedId(null)
  }

  function chapterForOrder(order: number | null) {
    return order === null ? null : chapters.find((item) => item.order === order) ?? null
  }

  function inferLogDraft(character: Character, note: string, chapterOrder: number | null): CharacterStateFactDraft {
    return CharacterStateService.inferFactDraftFromLog(note, character, chapterForOrder(chapterOrder))
  }

  function beginConvertLog(character: Character, log: CharacterStateLog) {
    workspace.update('conversion', () => ({ logId: log.id, draft: inferLogDraft(character, log.note, log.chapterOrder) }))
  }

  function patchConversionDraft(patch: Partial<CharacterStateFactDraft>) {
    workspace.update('conversion', (previous) => ({ ...previous, draft: previous.draft ? { ...previous.draft, ...patch } : null }))
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
    await workspace.save('log', () => saveData((current) => {
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
    }), (submitted) => ({ ...submitted, note: '', mode: 'log_only' }), '日志已保存。')
  }

  function chooseStateTemplate(key: string) {
    const template = STATE_TEMPLATES.find((item) => item.key === key) ?? STATE_TEMPLATES[0]
    workspace.update('fact', () => ({ template: template.key, label: template.label, category: template.category, value: '' }))
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
    await workspace.save('fact', () => saveData((current) => CharacterStateService.createOrUpdateFact(factInput, {
      ...current,
      projects: updateProjectTimestamp(current, project.id)
    })), (submitted) => ({ ...submitted, value: '' }), '状态已写入账本。')
  }

  async function convertLogToFact(log: CharacterStateLog) {
    if (!selected) return
    const draft = conversionLogId === log.id && conversionDraft ? conversionDraft : inferLogDraft(selected, log.note, log.chapterOrder)
    await workspace.save('conversion', () => saveData((current) => ({
      ...CharacterStateService.createFactFromLog(log, draft, current),
      projects: updateProjectTimestamp(current, project.id)
    })), (submitted) => submitted.logId === log.id ? { logId: null, draft: null } : submitted, '日志已转入账本。')
  }

  async function convertLogToCandidate(log: CharacterStateLog) {
    if (!selected) return
    const draft = conversionLogId === log.id && conversionDraft ? conversionDraft : inferLogDraft(selected, log.note, log.chapterOrder)
    await workspace.save('conversion', () => saveData((current) => ({
      ...CharacterStateService.createCandidateFromLog(log, draft, current),
      projects: updateProjectTimestamp(current, project.id)
    })), (submitted) => submitted.logId === log.id ? { logId: null, draft: null } : submitted, '已创建待确认候选。')
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
        title="角色"
        actions={<button className="primary-button" onClick={addCharacter}><Plus size={16} aria-hidden="true" />新增角色</button>}
      />
      <section className="split-layout characters-workbench">
        <CharacterListPane characters={characters} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        <div className="editor-pane">
          {!selected ? (
            <EmptyState title="暂无角色" description="创建角色卡后，把基础设定和当前状态分区维护。" />
          ) : (
            <>
              <CharacterFocusCard character={selected} />
              <CharacterWorkspaceTabs activeTab={activeTab} onChange={setActiveTab} pendingCount={stateCandidates.length} />
              <section id="character-panel-profile" role="tabpanel" aria-labelledby="character-tab-profile" hidden={activeTab !== 'profile'}>
              <CharacterProfilePanels character={selected} onUpdate={(patch) => updateCharacter(selected.id, patch)} onDelete={() => deleteCharacter(selected)} />
              </section>
              <section id="character-panel-ledger" role="tabpanel" aria-labelledby="character-tab-ledger" hidden={activeTab !== 'ledger'}>
              <CharacterStateLedgerPanel
                draftKey={workspace.key}
                stateFacts={stateFacts}
                stateCandidates={stateCandidates}
                factTemplate={factTemplate}
                factCategory={factCategory}
                factLabel={factLabel}
                factValue={factValue}
                onChooseStateTemplate={chooseStateTemplate}
                onFactCategoryChange={(category) => workspace.update('fact', (form) => ({ ...form, category }))}
                onFactLabelChange={(label) => workspace.update('fact', (form) => ({ ...form, label }))}
                onFactValueChange={(value) => workspace.update('fact', (form) => ({ ...form, value }))}
                factSaving={Boolean(workspace.saving.fact)}
                factMessage={workspace.messages.fact ?? ''}
                onAddStateFact={() => addStateFact(selected)}
                onUpdateStateFactValue={updateStateFactValue}
                onUpdateStateFactLinkedFields={updateStateFactLinkedFields}
                onArchiveStateFact={archiveStateFact}
                onApplyStateCandidate={applyStateCandidate}
                onRejectStateCandidate={rejectStateCandidate}
              />
              </section>
              <section id="character-panel-logs" role="tabpanel" aria-labelledby="character-tab-logs" hidden={activeTab !== 'logs'}>
              <CharacterStateLogPanel
                draftKey={workspace.key}
                chapters={chapters}
                logs={logs}
                logNote={logNote}
                logChapter={logChapter}
                logSaveMode={logSaveMode}
                conversionLogId={conversionLogId}
                conversionDraft={conversionDraft}
                onLogNoteChange={(note) => workspace.update('log', (form) => ({ ...form, note }))}
                onLogChapterChange={(chapter) => workspace.update('log', (form) => ({ ...form, chapter }))}
                onLogSaveModeChange={(mode) => workspace.update('log', (form) => ({ ...form, mode }))}
                logSaving={Boolean(workspace.saving.log)}
                logMessage={workspace.messages.log ?? ''}
                conversionSaving={Boolean(workspace.saving.conversion)}
                conversionMessage={workspace.messages.conversion ?? ''}
                onRecordLog={() => void addStateLog(selected)}
                onBeginConvertLog={(log) => beginConvertLog(selected, log)}
                onConvertLogToCandidate={(log) => void convertLogToCandidate(log)}
                onPatchConversionDraft={(patch) => {
                  const category = patch.category
                  patchConversionDraft({
                    ...patch,
                    ...(category
                      ? { linkedCardFields: CharacterStateService.getDefaultLinkedCardFieldsForCategory(category) }
                      : {})
                  })
                }}
                onConfirmConvertLogToFact={(log) => void convertLogToFact(log)}
                onCancelConversion={() => {
                  workspace.update('conversion', () => ({ logId: null, draft: null }))
                }}
              />
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
